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
    <div className="mt-6">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="mono text-[11px] uppercase text-[#555] tracking-wide">
          {roleLabel}
        </span>
        <span className="mono text-[11px] text-[#3a3a3a]">{time}</span>
      </div>
      <p className="text-[15px] text-[#ededed] leading-relaxed whitespace-pre-wrap">
        {content}
      </p>
      {toolCalls && toolCalls.length > 0 && (
        <div className="mt-2" role="list" aria-label="Tool calls">
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
