import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { dispatch } from "@/lib/chat/dispatcher";
import { getThreadId, setThreadId } from "@/lib/chat/threadStore";

// Agent runs can take minutes; bump the function timeout ceiling.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SESSION_COOKIE = "bm_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const SYSTEM_PROMPT = [
  "You are Aria, the BlackMamba (Switchback) subscription auditor.",
  "",
  "STYLE RULES (NON-NEGOTIABLE):",
  "- No emoji. Ever.",
  "- One short paragraph. Maximum two sentences.",
  "- Never use filler: no 'feel free to ask', 'let me know', 'happy to help', 'shortly'.",
  "- Never ask for confirmation before cancelling unless the merchant name is genuinely ambiguous.",
  "- Never claim a cancel succeeded. The live panel reports the outcome, not you.",
  "",
  "WHEN THE USER ASKS TO CANCEL A SUBSCRIPTION:",
  "1. Call cancel_subscription with the merchant name. It returns immediately with {started:true, run_id, merchant}.",
  "2. Reply with ONE sentence in this style — name what the agent is doing right now, not vague reassurance:",
  "     'Driving Chrome through Toronto Star's cancel flow now — declining retention offers automatically.'",
  "     'Spinning up the browser agent on Netflix's account page — it'll click through every confirm modal.'",
  "     'Starting the cancel run on Spotify — the panel below shows each step as the agent navigates.'",
  "3. Do NOT say 'you should receive a confirmation', 'I've started the process', or anything generic. The panel does the play-by-play; your job is to FRAME what the agent is doing.",
  "",
  "WHAT THE AGENT ACTUALLY DOES (use this knowledge in your framing):",
  "It launches the user's real Chrome with a persistent BlackMamba profile, navigates to the merchant's account page, finds the cancel link, declines retention offers ('50% off to stay', 'pause instead'), and confirms through every modal. It does NOT enter payment info, accept counter-offers, or click through CAPTCHAs/2FA.",
  "",
  "OTHER TOOLS:",
  "- list_subscriptions: show what the user is paying for (parsed from their uploaded statement).",
  "- total_at_stake: annual spend across everything.",
  "- most_expensive: top-N by annual cost.",
  "- web_search: only for things outside the subscription list (e.g. 'is X worth it?').",
  "- find_cancellation_url: get a merchant's cancel page URL.",
  "Never invent subscriptions. If the user names a service that isn't in their list, say so — don't make one up.",
  "",
  "ERROR CODES FROM cancel_subscription:",
  "- 'subscription_not_found' → service isn't in their statement-derived list. Suggest the closest matches the tool returned.",
  "- 'agent_unreachable' / 'agent_5xx' → the local browser-agent service is offline.",
  "Do NOT pre-mention 'credentials_needed' or 'human_action_required' — the panel surfaces those. Only address them if the user asks why a run failed after it ends.",
  "",
  "BONUS PRODUCT CONTEXT (no tool, but real):",
  "BlackMamba can issue single-use virtual cards via Stripe Issuing (the 'wallet' section). They revoke themselves after the first charge — protection against forgotten free trials re-billing. You can acknowledge this exists if asked.",
].join("\n");

type IncomingMessage = { role?: unknown; content?: unknown };
type RequestBody = { messages?: unknown; model?: unknown };

// Model IDs as Backboard exposes them via /api/models/provider/{name}.
const MODEL_PROVIDERS: Record<string, string> = {
  "gpt-4o-mini": "openai",
  "gpt-4o": "openai",
  "claude-sonnet-4-5-20250929": "anthropic",
  "claude-sonnet-4-6": "anthropic",
  "claude-opus-4-7": "anthropic",
  "claude-haiku-4-5-20251001": "anthropic",
};

function resolveModel(raw: unknown): { model?: string; provider?: string } {
  if (typeof raw !== "string") return {};
  const provider = MODEL_PROVIDERS[raw];
  if (!provider) return {};
  return { model: raw, provider };
}

function extractLatestUserContent(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (let i = raw.length - 1; i >= 0; i--) {
    const item = raw[i] as IncomingMessage;
    if (item?.role === "user" && typeof item.content === "string" && item.content.trim()) {
      return item.content;
    }
  }
  return null;
}

function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.BACKBOARD_API_KEY) {
    return NextResponse.json({
      message: {
        role: "assistant",
        content:
          "BlackMamba assistant is not configured: BACKBOARD_API_KEY is missing. " +
          "Add it to your .env.local and restart the dev server.",
      },
      toolCalls: [],
    });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const userContent = extractLatestUserContent(body.messages);
  if (!userContent) {
    return NextResponse.json(
      { error: "messages_required", detail: "Provide a non-empty messages array with a user message." },
      { status: 400 },
    );
  }

  let sessionId = readSessionCookie(req);
  let setCookie = false;
  if (!sessionId) {
    sessionId = randomUUID();
    setCookie = true;
  }

  const priorThreadId = getThreadId(sessionId);

  try {
    const { model, provider } = resolveModel(body.model);
    const result = await dispatch({
      userContent,
      threadId: priorThreadId,
      systemPrompt: SYSTEM_PROMPT,
      model,
      provider,
    });

    if (result.threadId) {
      setThreadId(sessionId, result.threadId);
    }

    const res = NextResponse.json({
      message: {
        role: "assistant",
        content: result.content,
      },
      toolCalls: result.toolCalls,
    });

    if (setCookie) {
      res.cookies.set({
        name: SESSION_COOKIE,
        value: sessionId,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_MAX_AGE,
      });
    }

    return res;
  } catch (err) {
    console.error("[api/chat] unhandled dispatch error", err);
    return NextResponse.json({
      message: {
        role: "assistant",
        content:
          "Something went wrong on the backend. Please try again in a moment.",
      },
      toolCalls: [],
    });
  }
}
