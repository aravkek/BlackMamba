"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type CancelStep = {
  index: number;
  action: string;
  url?: string | null;
  note?: string | null;
};

type JobStatus = "pending" | "running" | "success" | "failed";

type JobState = {
  run_id: string;
  merchant: string;
  status: JobStatus;
  steps: CancelStep[];
  final_url?: string | null;
  error?: string | null;
  duration_ms: number;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 360_000; // give up after 6 minutes

type LiveCancelPanelProps = {
  runId: string;
  merchant: string;
};

export function LiveCancelPanel({ runId, merchant }: LiveCancelPanelProps) {
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/cancel-live?run_id=${encodeURIComponent(runId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (!cancelled) setError(`agent_${res.status}`);
          return;
        }
        const data = (await res.json()) as JobState;
        if (cancelled) return;
        setJob(data);
        if (data.status === "success" || data.status === "failed") return;
        if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
          setError("poll_timeout");
          return;
        }
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "network_error");
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [runId]);

  const status = job?.status ?? "pending";
  const steps = job?.steps ?? [];

  return (
    <div
      className="mt-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label={`Cancelling ${merchant}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--border)]">
        <div className="flex items-center gap-2.5 min-w-0">
          <StatusDot status={status} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--fg-muted)] shrink-0">
            {statusLabel(status)}
          </span>
          <span className="text-[13px] text-[color:var(--fg)] truncate">
            {merchant}
          </span>
        </div>
        <span className="mono text-[10px] text-[color:var(--fg-dim)] tabular-nums shrink-0">
          {formatDuration(job?.duration_ms ?? 0)}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 max-h-64 overflow-y-auto no-scrollbar">
        {error ? (
          <p className="mono text-[12px] text-[#ef4444]">error: {error}</p>
        ) : steps.length === 0 ? (
          <p className="mono text-[11px] text-[color:var(--fg-dim)]">
            agent warming up — chrome launching…
          </p>
        ) : (
          <ol
            className="space-y-1.5"
            aria-label={`${steps.length} agent steps`}
          >
            <AnimatePresence initial={false}>
              {steps.map((step) => (
                <motion.li
                  key={step.index}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                  className="mono text-[11px] leading-snug flex items-baseline gap-2"
                >
                  <span className="text-[color:var(--fg-dim)] tabular-nums shrink-0">
                    {String(step.index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[color:var(--tangerine)] shrink-0">
                    {step.action}
                  </span>
                  {step.url && (
                    <span className="text-[color:var(--fg-muted)] truncate min-w-0">
                      {prettifyUrl(step.url)}
                    </span>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>

      {/* Footer with final outcome */}
      {(status === "success" || status === "failed") && (
        <div className="px-4 py-2.5 border-t border-[color:var(--border)] flex items-baseline justify-between gap-3">
          <span
            className={`mono text-[11px] ${
              status === "success"
                ? "text-[#10b981]"
                : "text-[#ef4444]"
            }`}
          >
            {status === "success"
              ? "cancelled"
              : describeError(job?.error ?? null)}
          </span>
          {job?.final_url && (
            <span className="mono text-[10px] text-[color:var(--fg-dim)] truncate">
              {prettifyUrl(job.final_url)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: JobStatus }) {
  const color =
    status === "success"
      ? "bg-[#10b981]"
      : status === "failed"
        ? "bg-[#ef4444]"
        : "bg-[color:var(--tangerine)]";
  const pulse =
    status === "running" || status === "pending" ? "animate-pulse" : "";
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 rounded-full ${color} ${pulse} shrink-0`}
    />
  );
}

function statusLabel(s: JobStatus): string {
  if (s === "pending") return "queued";
  if (s === "running") return "live";
  if (s === "success") return "done";
  return "failed";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function prettifyUrl(u: string): string {
  try {
    const parsed = new URL(u);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return u;
  }
}

function describeError(code: string | null): string {
  if (!code) return "failed";
  if (code === "credentials_needed") return "sign-in required";
  if (code === "human_action_required") return "captcha or 2FA blocked";
  if (code === "agent_did_not_signal_done") return "agent gave up";
  return code;
}
