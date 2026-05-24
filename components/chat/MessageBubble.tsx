"use client";

import type { ChatMessage } from "./types";
import { ToolInvocationDisplay } from "./ToolInvocation";

function formatTime(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, "0");
  return `${h}:${m} ${ampm}`;
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

      {/* Tool call trace */}
      {toolCalls && toolCalls.length > 0 && (
        <div role="list" aria-label="Tool calls">
          {toolCalls.map((tc, i) => (
            <div key={`${tc.name}-${i}`} role="listitem">
              <ToolInvocationDisplay invocation={tc} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
