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

const SYSTEM_PROMPT =
  "You are the BlackMamba assistant. The user is reviewing their subscriptions. " +
  "Be direct. When they want to cancel, USE the cancel_subscription tool — do not ask for " +
  "confirmation unless they are ambiguous. When they ask about cost, USE list_subscriptions " +
  "or total_at_stake. Never invent subscriptions; if you do not see one, say so. " +
  "cancel_subscription is FIRE-AND-FORGET: it returns immediately with {started:true, run_id, merchant}. " +
  "When you see that, reply with ONE short line like 'Cancelling <merchant> now — watch the panel.' " +
  "Do NOT narrate steps or claim success: a live panel in the UI handles all progress and the final outcome. " +
  "If the tool returns success:false, READ the error field and tell the user the real reason: " +
  "'subscription_not_found' → tell them the service isn't in their list and suggest the closest matches; " +
  "'agent_unreachable' or agent_5xx → tell them the cancel service is offline. " +
  "No emoji. One short paragraph max per turn.";

type IncomingMessage = { role?: unknown; content?: unknown };
type RequestBody = { messages?: unknown; model?: unknown };

const MODEL_PROVIDERS: Record<string, string> = {
  "gpt-4o-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4.1-mini": "openai",
  "claude-3-5-sonnet-latest": "anthropic",
  "claude-3-5-haiku-latest": "anthropic",
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
