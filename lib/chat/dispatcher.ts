// Tool-loop dispatcher for Backboard's thread-based assistant API.
//
// Flow per request:
//   1. POST /api/threads/messages with { content, tools, system_prompt, thread_id? }
//   2. If response.status === "REQUIRES_ACTION": execute each tool_call locally,
//      then POST /api/threads/tool-outputs with the results.
//   3. Repeat up to MAX_TOOL_TURNS or until status === "COMPLETED".
//
// Backboard manages conversation history server-side via thread_id, so we only
// send the latest user message — not the full messages[] array.

import { TOOL_SCHEMAS, TOOL_EXECUTORS, type ToolContext } from "./tools";

const DEFAULT_BASE = "https://app.backboard.io/api";
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_TURNS = 3;
const BACKBOARD_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type BackboardStatus =
  | "IN_PROGRESS"
  | "REQUIRES_ACTION"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

type BackboardMessageResponse = {
  message?: string;
  thread_id?: string;
  content?: string | null;
  message_id?: string | null;
  role?: string;
  status?: BackboardStatus;
  tool_calls?: ToolCall[] | null;
  run_id?: string | null;
};

export type DispatchRecord = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

export type DispatchResult = {
  content: string;
  toolCalls: DispatchRecord[];
  threadId: string | null;
};

export type DispatchInput = {
  /** The latest user message text. */
  userContent: string;
  /** Existing Backboard thread id, if this is a continuing conversation. */
  threadId?: string;
  /** System prompt — passed per-message since Backboard does not persist it. */
  systemPrompt?: string;
  /** Override the model for this dispatch (else uses env / default). */
  model?: string;
  /** Override the provider for this dispatch (else uses env / default). */
  provider?: string;
};

// ---------------------------------------------------------------------------
// Backboard fetch helpers
// ---------------------------------------------------------------------------

function getBaseAndKey(): { base: string; key: string } | null {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return null;
  const base = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  return { base, key };
}

async function sendMessage(
  body: Record<string, unknown>,
): Promise<BackboardMessageResponse | null> {
  const env = getBaseAndKey();
  if (!env) return null;

  const res = await fetch(`${env.base}/threads/messages`, {
    method: "POST",
    headers: {
      "X-API-Key": env.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BACKBOARD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[dispatcher] sendMessage non_ok", res.status, detail.slice(0, 300));
    return null;
  }

  return (await res.json()) as BackboardMessageResponse;
}

async function submitToolOutputs(
  threadId: string,
  toolOutputs: Array<{ tool_call_id: string; output: string }>,
): Promise<BackboardMessageResponse | null> {
  const env = getBaseAndKey();
  if (!env) return null;

  const res = await fetch(`${env.base}/threads/tool-outputs`, {
    method: "POST",
    headers: {
      "X-API-Key": env.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      thread_id: threadId,
      tool_outputs: toolOutputs,
      stream: false,
    }),
    signal: AbortSignal.timeout(BACKBOARD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      "[dispatcher] submitToolOutputs non_ok",
      res.status,
      detail.slice(0, 300),
    );
    return null;
  }

  return (await res.json()) as BackboardMessageResponse;
}

async function withRetry<T>(
  fn: () => Promise<T | null>,
  label: string,
): Promise<T | null> {
  try {
    const result = await fn();
    if (result !== null) return result;
  } catch (err) {
    console.error(`[dispatcher] ${label} first attempt threw`, err);
  }

  try {
    return await fn();
  } catch (err) {
    console.error(`[dispatcher] ${label} retry threw`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function runToolCalls(
  toolCalls: ToolCall[],
  ctx: ToolContext,
  log: DispatchRecord[],
): Promise<Array<{ tool_call_id: string; output: string }>> {
  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        console.error("[dispatcher] failed to parse tool args for", name);
      }

      const executor = TOOL_EXECUTORS[name];
      let result: unknown;
      if (executor) {
        try {
          result = await executor(args, ctx);
        } catch (err) {
          console.error("[dispatcher] tool executor error", name, err);
          result = { error: "tool_execution_failed" };
        }
      } else {
        result = { error: "unknown_tool" };
      }

      log.push({ name, args, result });
      return { tool_call_id: tc.id, output: JSON.stringify(result) };
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const FALLBACK_UNREACHABLE =
  "I'm having trouble reaching the AI backend right now. Please try again shortly.";
const FALLBACK_TOOL_LIMIT =
  "I ran into a problem getting a final answer. Please try again.";
const FALLBACK_NO_THREAD =
  "The assistant did not return a thread id, so I can't continue the conversation. Please try again.";

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const ctx: ToolContext = {};
  const toolCallLog: DispatchRecord[] = [];

  const provider = input.provider ?? process.env.BACKBOARD_PROVIDER ?? DEFAULT_PROVIDER;
  const model = input.model ?? process.env.BACKBOARD_MODEL ?? DEFAULT_MODEL;

  const initialBody: Record<string, unknown> = {
    content: input.userContent,
    llm_provider: provider,
    model_name: model,
    stream: false,
    tools: TOOL_SCHEMAS,
  };
  if (input.threadId) initialBody.thread_id = input.threadId;
  if (input.systemPrompt) initialBody.system_prompt = input.systemPrompt;

  let response = await withRetry(
    () => sendMessage(initialBody),
    "sendMessage",
  );

  if (!response) {
    return { content: FALLBACK_UNREACHABLE, toolCalls: toolCallLog, threadId: input.threadId ?? null };
  }

  const threadId = response.thread_id ?? input.threadId ?? null;

  if (!threadId) {
    return { content: FALLBACK_NO_THREAD, toolCalls: toolCallLog, threadId: null };
  }

  let turns = 0;
  while (
    response &&
    response.status === "REQUIRES_ACTION" &&
    response.tool_calls &&
    response.tool_calls.length > 0 &&
    turns < MAX_TOOL_TURNS
  ) {
    const outputs = await runToolCalls(response.tool_calls, ctx, toolCallLog);
    response = await withRetry(
      () => submitToolOutputs(threadId, outputs),
      "submitToolOutputs",
    );
    turns++;
  }

  if (!response) {
    return { content: FALLBACK_UNREACHABLE, toolCalls: toolCallLog, threadId };
  }

  if (response.status === "REQUIRES_ACTION") {
    return { content: FALLBACK_TOOL_LIMIT, toolCalls: toolCallLog, threadId };
  }

  return {
    content: (response.content ?? "").trim(),
    toolCalls: toolCallLog,
    threadId,
  };
}
