import { NextResponse } from "next/server";
import { dispatch, type ChatMessage } from "@/lib/chat/dispatcher";

// Agent runs can take minutes; bump the function timeout ceiling.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content:
    "You are the BlackMamba assistant. The user is reviewing their subscriptions. " +
    "Be direct. When they want to cancel, USE the cancel_subscription tool — do not ask for " +
    "confirmation unless they are ambiguous. When they ask about cost, USE list_subscriptions " +
    "or total_at_stake. Never invent subscriptions; if you do not see one, say so. " +
    "No emoji. One short paragraph max per turn.",
};

type IncomingMessage = {
  role?: unknown;
  content?: unknown;
  name?: unknown;
  tool_call_id?: unknown;
  tool_calls?: unknown;
};

type RequestBody = {
  messages?: unknown;
};

function isValidRole(role: unknown): role is ChatMessage["role"] {
  return (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "tool"
  );
}

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;

  const messages: ChatMessage[] = [];
  for (const item of raw as IncomingMessage[]) {
    if (!isValidRole(item.role)) continue;
    if (typeof item.content !== "string") continue;
    const msg: ChatMessage = {
      role: item.role,
      content: item.content,
    };
    if (typeof item.name === "string") msg.name = item.name;
    if (typeof item.tool_call_id === "string")
      msg.tool_call_id = item.tool_call_id;
    if (Array.isArray(item.tool_calls)) {
      // Pass through tool_calls verbatim — they are opaque to this layer.
      msg.tool_calls = item.tool_calls as ChatMessage["tool_calls"];
    }
    messages.push(msg);
  }

  return messages.length > 0 ? messages : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  // If the API key is missing return a clear deterministic fallback.
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

  const incomingMessages = parseMessages(body.messages);
  if (!incomingMessages) {
    return NextResponse.json(
      { error: "messages_required", detail: "Provide a non-empty messages array." },
      { status: 400 },
    );
  }

  // Prepend the system prompt (caller must not include their own system message
  // that conflicts, but we don't strip theirs — the model will see both).
  const messages: ChatMessage[] = [SYSTEM_PROMPT, ...incomingMessages];

  try {
    const result = await dispatch(messages);

    return NextResponse.json({
      message: {
        role: "assistant",
        content: result.content,
      },
      toolCalls: result.toolCalls,
    });
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
