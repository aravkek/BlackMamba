// Tool-loop dispatcher: manages the multi-turn LLM ↔ tool conversation.
//
// Runs up to MAX_TOOL_TURNS of tool-call rounds. On each round it:
//   1. Calls Backboard with the current messages + tool schemas.
//   2. If the LLM returned tool_calls, executes each in parallel and appends results.
//   3. Repeats until no more tool_calls or MAX_TOOL_TURNS is reached.
//   4. Forces a final plain-text completion if the last response still had tool_calls.

import { TOOL_SCHEMAS, TOOL_EXECUTORS, type ToolContext } from "./tools";

const DEFAULT_BASE = "https://api.backboard.io";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TOOL_TURNS = 3;
const BACKBOARD_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type BackboardChoice = {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
};

type BackboardResponse = {
  choices?: BackboardChoice[];
};

export type DispatchRecord = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

export type DispatchResult = {
  content: string;
  toolCalls: DispatchRecord[];
};

// ---------------------------------------------------------------------------
// Backboard fetch helper
// ---------------------------------------------------------------------------

async function callBackboard(
  messages: ChatMessage[],
  toolChoice?: "none",
): Promise<BackboardResponse | null> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return null;

  const base = (process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  const model = process.env.BACKBOARD_MODEL ?? DEFAULT_MODEL;

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 600,
  };

  if (toolChoice === "none") {
    payload.tool_choice = "none";
  } else {
    payload.tools = TOOL_SCHEMAS;
    payload.tool_choice = "auto";
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(BACKBOARD_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[dispatcher] backboard non_ok", res.status, detail.slice(0, 200));
    return null;
  }

  return (await res.json()) as BackboardResponse;
}

/** One Backboard call with a single retry on 5xx. */
async function callBackboardWithRetry(
  messages: ChatMessage[],
  toolChoice?: "none",
): Promise<BackboardResponse | null> {
  try {
    const result = await callBackboard(messages, toolChoice);
    return result;
  } catch (err) {
    console.error("[dispatcher] first attempt failed, retrying", err);
  }

  try {
    const result = await callBackboard(messages, toolChoice);
    return result;
  } catch (err) {
    console.error("[dispatcher] retry also failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the LLM + tool loop until settled or MAX_TOOL_TURNS exhausted.
 * Returns the final assistant text plus a log of every tool call made.
 */
export async function dispatch(
  messages: ChatMessage[],
): Promise<DispatchResult> {
  const ctx: ToolContext = {};
  const toolCallLog: DispatchRecord[] = [];
  const workingMessages: ChatMessage[] = [...messages];

  let turns = 0;

  while (turns < MAX_TOOL_TURNS) {
    const response = await callBackboardWithRetry(workingMessages);

    if (!response) {
      return {
        content: "I'm having trouble reaching the AI backend right now. Please try again shortly.",
        toolCalls: toolCallLog,
      };
    }

    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) {
      return {
        content: "Received an unexpected response from the backend.",
        toolCalls: toolCallLog,
      };
    }

    const toolCalls = assistantMessage.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — we have our final answer.
      return {
        content: assistantMessage.content?.trim() ?? "",
        toolCalls: toolCallLog,
      };
    }

    // Push the assistant message (with tool_calls) into history.
    workingMessages.push({
      role: "assistant",
      content: assistantMessage.content ?? "",
      tool_calls: toolCalls,
    });

    // Execute all tool calls in parallel.
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

        toolCallLog.push({ name, args, result });
        return { tc, result };
      }),
    );

    // Append tool results to message history.
    for (const { tc, result } of results) {
      workingMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(result),
      });
    }

    turns++;
  }

  // Force a final plain-text completion after exhausting tool turns.
  const finalResponse = await callBackboardWithRetry(workingMessages, "none");

  if (!finalResponse) {
    return {
      content: "I ran into a problem getting a final answer. Please try again.",
      toolCalls: toolCallLog,
    };
  }

  const finalContent =
    finalResponse.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    content: finalContent,
    toolCalls: toolCallLog,
  };
}
