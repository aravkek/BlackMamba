"use client";

import type { ChatMessage, ToolInvocation } from "./types";
import { ToolInvocationDisplay } from "./ToolInvocation";
import { LiveCancelPanel } from "./LiveCancelPanel";

function formatTime(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, "0");
  return `${h}:${m} ${ampm}`;
}

function isLiveCancel(
  tc: ToolInvocation,
): { runId: string; merchant: string } | null {
  if (tc.name !== "cancel_subscription") return null;
  const r = tc.result;
  if (typeof r !== "object" || r === null) return null;
  const rec = r as Record<string, unknown>;
  if (rec.started !== true) return null;
  if (typeof rec.run_id !== "string" || typeof rec.merchant !== "string") {
    return null;
  }
  return { runId: rec.run_id, merchant: rec.merchant };
}

type MessageBubbleProps = {
  message: ChatMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, toolCalls, createdAt } = message;

  const roleLabel = role === "user" ? "you" : "aria";
  const time = formatTime(createdAt);

  return (
    <div className="mt-8">
      {/* Role + timestamp eyebrow */}
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--fg-dim)]">
          {roleLabel}
        </span>
        <span className="mono text-[10px] text-[color:var(--fg-dim)]">&middot;</span>
        <span className="mono text-[10px] text-[color:var(--fg-dim)]">{time}</span>
      </div>

      {/* Message content */}
      <p className="text-[15px] text-[color:var(--fg)] leading-relaxed whitespace-pre-wrap">
        {content}
      </p>

      {/* Tool call trace + live cancel panels */}
      {toolCalls && toolCalls.length > 0 && (
        <div role="list" aria-label="Tool calls">
          {toolCalls.map((tc, i) => {
            const live = isLiveCancel(tc);
            if (live) {
              return (
                <div
                  key={`live-${live.runId}`}
                  role="listitem"
                >
                  <LiveCancelPanel
                    runId={live.runId}
                    merchant={live.merchant}
                  />
                </div>
              );
            }
            return (
              <div key={`${tc.name}-${i}`} role="listitem">
                <ToolInvocationDisplay invocation={tc} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
