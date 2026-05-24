"use client";

import type { ToolInvocation } from "./types";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isArrayWithLength(val: unknown): val is { length: number } {
  return Array.isArray(val);
}

function getSummary(
  name: string,
  result: unknown,
): { text: string; isError: boolean } {
  switch (name) {
    case "list_subscriptions": {
      if (
        isRecord(result) &&
        "subscriptions" in result &&
        isArrayWithLength(result.subscriptions)
      ) {
        return {
          text: `listed ${result.subscriptions.length} subscriptions`,
          isError: false,
        };
      }
      return { text: "listed subscriptions", isError: false };
    }

    case "cancel_subscription": {
      if (isRecord(result)) {
        if (result.success === true) {
          const merchant =
            typeof result.merchant === "string"
              ? result.merchant
              : "subscription";
          const duration =
            typeof result.duration_ms === "number"
              ? formatDuration(result.duration_ms)
              : null;
          const text = duration
            ? `cancelled ${merchant} in ${duration}`
            : `cancelled ${merchant}`;
          return { text, isError: false };
        } else {
          const reason =
            typeof result.reason === "string" ? result.reason : "unknown error";
          return { text: `could not cancel: ${reason}`, isError: true };
        }
      }
      return { text: "cancel attempted", isError: false };
    }

    case "total_at_stake": {
      if (isRecord(result) && typeof result.total === "number") {
        return {
          text: `${formatCurrency(result.total)}/yr at stake`,
          isError: false,
        };
      }
      return { text: "calculated total", isError: false };
    }

    case "most_expensive": {
      if (
        isRecord(result) &&
        "subscriptions" in result &&
        isArrayWithLength(result.subscriptions)
      ) {
        return {
          text: `top ${result.subscriptions.length} by cost`,
          isError: false,
        };
      }
      return { text: "found top subscriptions", isError: false };
    }

    case "web_search": {
      if (isRecord(result) && result.error) {
        return { text: "search unavailable", isError: true };
      }
      return { text: "searched the web", isError: false };
    }

    case "find_cancellation_url": {
      if (isRecord(result) && result.url != null && result.url !== "") {
        return { text: "found URL", isError: false };
      }
      return { text: "no URL found", isError: false };
    }

    default: {
      if (isRecord(result) && (result.error || result.success === false)) {
        return { text: `${name} · failed`, isError: true };
      }
      return { text: `${name} · ok`, isError: false };
    }
  }
}

type ToolInvocationProps = {
  invocation: ToolInvocation;
};

export function ToolInvocationDisplay({ invocation }: ToolInvocationProps) {
  const { name, result } = invocation;
  const { text, isError } = getSummary(name, result);

  return (
    <div className="mt-3 text-[11px] mono text-[#5a5a5f] flex items-baseline gap-1.5">
      <span aria-hidden="true">&rarr;</span>
      <span className="text-[#8a8a8f]">{name}</span>
      <span aria-hidden="true">&middot;</span>
      <span className={isError ? "text-[#ff8a8a]" : "text-[#F38B00]"}>
        {text}
      </span>
    </div>
  );
}
