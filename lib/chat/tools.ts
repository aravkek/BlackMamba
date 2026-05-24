// Tool schemas and executors for the BlackMamba chat assistant.
//
// TOOL_SCHEMAS: OpenAI-compatible tool-call JSON schema definitions.
// TOOL_EXECUTORS: Async functions invoked server-side when the LLM emits a tool_call.

import { augmentedSubscriptions } from "@/lib/statements/store";
import type { Subscription } from "@/lib/data";
import { canonicalize } from "@/lib/statements/canonicalize";

const DEFAULT_BASE = "https://app.backboard.io/api";
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-4o-mini";
const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:8001";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export type SubSummary = {
  id: string;
  service: string;
  amount: number;
  frequency: "monthly" | "yearly";
  annualized: number;
  lastCharge?: Subscription["lastCharge"];
  detectedFromStatement?: boolean;
  isTrialVerify?: boolean;
};

export type ToolContext = {
  /** Cached sub list so multiple tool calls in one turn share state. */
  subsCache?: SubSummary[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSubSummary(s: Subscription): SubSummary {
  const annualized =
    s.frequency === "monthly"
      ? Math.round(s.amount * 12 * 100) / 100
      : Math.round(s.amount * 100) / 100;
  return {
    id: s.id,
    service: s.service,
    amount: s.amount,
    frequency: s.frequency,
    annualized,
    lastCharge: s.lastCharge,
    detectedFromStatement: s.detectedFromStatement,
    isTrialVerify: s.isTrialVerify,
  };
}

function getSubSummaries(ctx: ToolContext): SubSummary[] {
  if (ctx.subsCache) return ctx.subsCache;
  const subs = augmentedSubscriptions().map(toSubSummary);
  ctx.subsCache = subs;
  return subs;
}

/** Simple Levenshtein distance for fuzzy matching. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the best matching subscription by canonicalized name.
 * Returns the matched subscription plus the top-3 closest alternatives.
 */
function findSubscription(
  merchant: string,
  subs: SubSummary[],
): { match: SubSummary | null; suggestions: SubSummary[] } {
  const needle = canonicalize(merchant);

  // Exact or substring match first
  const exactMatch = subs.find((s) => {
    const haystack = canonicalize(s.service);
    return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
  });

  if (exactMatch) {
    return { match: exactMatch, suggestions: [] };
  }

  // Levenshtein-ranked fallback
  const ranked = [...subs]
    .map((s) => ({ sub: s, dist: levenshtein(needle, canonicalize(s.service)) }))
    .sort((a, b) => a.dist - b.dist);

  return {
    match: null,
    suggestions: ranked.slice(0, 3).map((r) => r.sub),
  };
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_subscriptions",
      description:
        "List all of the user's current subscriptions with amounts and frequencies. Call this before answering cost questions or before canceling.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_subscription",
      description:
        "Cancel a subscription by merchant name. Launches a real browser agent — only call this when the user clearly wants to cancel.",
      parameters: {
        type: "object",
        properties: {
          merchant: {
            type: "string",
            description: "The subscription service name to cancel, e.g. 'Netflix'.",
          },
          headless: {
            type: "boolean",
            description: "Run the browser headless. Defaults to false.",
          },
        },
        required: ["merchant"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "total_at_stake",
      description:
        "Return the total annualized spend across all subscriptions. Use this for 'how much am I paying per year?' questions.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "most_expensive",
      description:
        "Return the top-N most expensive subscriptions by annual cost. Default n=3.",
      parameters: {
        type: "object",
        properties: {
          n: {
            type: "integer",
            description: "Number of results to return. Defaults to 3.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web and return a text summary. Use for questions about cancellation policies, pricing, or anything not in the subscription list.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_cancellation_url",
      description:
        "Find the official cancellation URL for a subscription service.",
      parameters: {
        type: "object",
        properties: {
          merchant: {
            type: "string",
            description: "The subscription service name, e.g. 'Netflix'.",
          },
        },
        required: ["merchant"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

async function execListSubscriptions(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<{ subscriptions: SubSummary[] }> {
  return { subscriptions: getSubSummaries(ctx) };
}

type CancelArgs = { merchant: string; headless?: boolean };
type StartedRun = {
  started: true;
  run_id: string;
  merchant: string;
};
type CancelResult =
  | StartedRun
  | { success: false; error: "subscription_not_found"; suggestions: SubSummary[] }
  | { success: false; merchant: string; error: string };

/**
 * Fire-and-forget cancel: starts the agent run via /cancel/start and returns
 * the run_id immediately. The UI polls /api/cancel-live?run_id=... for live
 * progress. Aria's reply is a single one-liner; the panel does the rest.
 */
async function execCancelSubscription(
  args: CancelArgs,
  ctx: ToolContext,
): Promise<CancelResult> {
  const subs = getSubSummaries(ctx);
  const { match, suggestions } = findSubscription(args.merchant, subs);

  if (!match) {
    return {
      success: false,
      error: "subscription_not_found",
      suggestions,
    };
  }

  try {
    const upstream = await fetch(`${AGENT_BASE_URL}/cancel/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: match.service,
        url: undefined,
        headless: args.headless ?? false,
        max_steps: 40,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("[chat/tools] cancel/start failed", upstream.status, detail.slice(0, 200));
      return {
        success: false,
        merchant: match.service,
        error: `agent_${upstream.status}`,
      };
    }

    const json = (await upstream.json()) as { run_id: string; merchant: string };
    return {
      started: true,
      run_id: json.run_id,
      merchant: json.merchant,
    };
  } catch (err) {
    console.error("[chat/tools] cancel/start fetch_failure", err);
    return {
      success: false,
      merchant: match.service,
      error: err instanceof Error ? err.message : "agent_unreachable",
    };
  }
}

async function execTotalAtStake(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<{ total: number; currency: "USD" }> {
  const subs = getSubSummaries(ctx);
  const total =
    Math.round(subs.reduce((sum, s) => sum + s.annualized, 0) * 100) / 100;
  return { total, currency: "USD" };
}

type MostExpensiveArgs = { n?: number };

async function execMostExpensive(
  args: MostExpensiveArgs,
  ctx: ToolContext,
): Promise<{ subscriptions: SubSummary[] }> {
  const n = typeof args.n === "number" && args.n > 0 ? args.n : 3;
  const subs = getSubSummaries(ctx);
  const top = [...subs].sort((a, b) => b.annualized - a.annualized).slice(0, n);
  return { subscriptions: top };
}

type WebSearchArgs = { query: string };

async function execWebSearch(
  args: WebSearchArgs,
): Promise<{ results: string } | { error: "web_search_unavailable" }> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return { error: "web_search_unavailable" };

  const base = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  const provider = process.env.BACKBOARD_PROVIDER ?? DEFAULT_PROVIDER;
  const model = process.env.BACKBOARD_MODEL ?? DEFAULT_MODEL;

  // One-shot Backboard message (no thread_id, no tools) with built-in web search.
  const payload = {
    content: `Search the web and summarize relevant results for: ${args.query}`,
    llm_provider: provider,
    model_name: model,
    stream: false,
    web_search: "Auto",
    system_prompt:
      "You are a web search assistant. Return a concise, factual summary with relevant URLs when available.",
  };

  try {
    const res = await fetch(`${base}/threads/messages`, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.error("[chat/tools] web_search non_ok", res.status);
      return { error: "web_search_unavailable" };
    }

    const json = (await res.json()) as { content?: string | null };
    const text = json.content?.trim() ?? "";
    return { results: text.length > 0 ? text : "No results found." };
  } catch (err) {
    console.error("[chat/tools] web_search failure", err);
    return { error: "web_search_unavailable" };
  }
}

type FindCancellationUrlArgs = { merchant: string };

async function execFindCancellationUrl(
  args: FindCancellationUrlArgs,
): Promise<{ url: string | null; raw: string }> {
  const searchResult = await execWebSearch({ query: `official cancel subscription URL for ${args.merchant}` });

  if ("error" in searchResult) {
    return { url: null, raw: "" };
  }

  const raw = searchResult.results;
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>)]+/);
  return { url: urlMatch?.[0] ?? null, raw };
}

// ---------------------------------------------------------------------------
// Executor registry
// ---------------------------------------------------------------------------

export const TOOL_EXECUTORS: Record<
  string,
  (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
> = {
  list_subscriptions: (args, ctx) =>
    execListSubscriptions(args as Record<string, never>, ctx),
  cancel_subscription: (args, ctx) =>
    execCancelSubscription(args as CancelArgs, ctx),
  total_at_stake: (args, ctx) =>
    execTotalAtStake(args as Record<string, never>, ctx),
  most_expensive: (args, ctx) =>
    execMostExpensive(args as MostExpensiveArgs, ctx),
  web_search: (args) => execWebSearch(args as WebSearchArgs),
  find_cancellation_url: (args) =>
    execFindCancellationUrl(args as FindCancellationUrlArgs),
};
