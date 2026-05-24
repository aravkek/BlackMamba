"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { AnimatedCounter } from "@/components/AnimatedCounter";
import { BrandMark } from "@/components/BrandMark";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { Button } from "@/components/ui/Button";
import { SUBSCRIPTIONS, YEARLY_AT_STAKE, type Subscription } from "@/lib/data";

type AgentStep = {
  index: number;
  action: string;
  url?: string | null;
  note?: string | null;
};

type AgentResult = {
  success: boolean;
  merchant: string;
  duration_ms: number;
  steps: AgentStep[];
  final_url?: string | null;
  error?: string | null;
};

type CardState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "success"; result: AgentResult; expanded: boolean }
  | { kind: "error"; message: string };

/** Annualized dollar value for a sub. */
function annualValue(sub: Subscription) {
  return sub.frequency === "monthly" ? sub.amount * 12 : sub.amount;
}

export default function HomePage() {
  const [savings, setSavings] = useState(0);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>(() =>
    Object.fromEntries(SUBSCRIPTIONS.map((s) => [s.id, { kind: "idle" }])),
  );

  // Only one in-flight cancel at a time. Keeps the demo deterministic and
  // prevents the browser-agent backend from being slammed by concurrent runs.
  const inFlight = useRef<string | null>(null);

  const yearlyAtStake = useMemo(() => Math.round(YEARLY_AT_STAKE), []);

  const handleCancel = useCallback(
    async (sub: Subscription) => {
      if (inFlight.current) return;
      const state = cardStates[sub.id];
      if (state?.kind === "success" || state?.kind === "running") return;

      inFlight.current = sub.id;
      setCardStates((prev) => ({
        ...prev,
        [sub.id]: { kind: "running", startedAt: Date.now() },
      }));

      try {
        const res = await fetch("/api/cancel-live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchant: sub.service }),
        });

        // Parse defensively — the proxy may return non-JSON on infra errors.
        let data: AgentResult | null = null;
        try {
          data = (await res.json()) as AgentResult;
        } catch {
          data = null;
        }

        if (!data) {
          setCardStates((prev) => ({
            ...prev,
            [sub.id]: {
              kind: "error",
              message: `Network ${res.status}. Couldn't reach Aria.`,
            },
          }));
          return;
        }

        if (data.success) {
          setCardStates((prev) => ({
            ...prev,
            [sub.id]: { kind: "success", result: data, expanded: false },
          }));
          setSavings((s) => s + annualValue(sub));
        } else {
          setCardStates((prev) => ({
            ...prev,
            [sub.id]: {
              kind: "error",
              message:
                data.error?.toString().trim() ||
                "Cancellation did not complete.",
            },
          }));
        }
      } catch (err) {
        setCardStates((prev) => ({
          ...prev,
          [sub.id]: {
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Unknown error reaching the agent.",
          },
        }));
      } finally {
        inFlight.current = null;
      }
    },
    [cardStates],
  );

  const toggleExpanded = useCallback((id: string) => {
    setCardStates((prev) => {
      const s = prev[id];
      if (!s || s.kind !== "success") return prev;
      return { ...prev, [id]: { ...s, expanded: !s.expanded } };
    });
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-[#ededed]">
      <Header />

      <main className="mx-auto w-full max-w-6xl px-6 sm:px-10 pb-24">
        <AtStake savings={savings} yearlyAtStake={yearlyAtStake} />

        <section className="mt-14">
          <div className="flex items-end justify-between mb-6">
            <div>
              <div className="eyebrow">Active subscriptions</div>
              <h2 className="display text-2xl sm:text-3xl mt-2">
                Six cards. Six cancel buttons.
              </h2>
            </div>
            <div className="hidden sm:block text-[12px] text-[#8a8a8a] mono">
              {SUBSCRIPTIONS.length} live · 0 cancelled
            </div>
          </div>

          <div className="hairline mb-6" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SUBSCRIPTIONS.map((sub) => {
              const state = cardStates[sub.id] ?? { kind: "idle" };
              return (
                <CancellableRow
                  key={sub.id}
                  sub={sub}
                  state={state}
                  onCancel={() => handleCancel(sub)}
                  onToggleExpanded={() => toggleExpanded(sub.id)}
                />
              );
            })}
          </div>
        </section>

        <ConnectedFooter />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-[#262626]">
      <div className="mx-auto w-full max-w-6xl px-6 sm:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark id="tangerine" size={26} />
          <span className="display text-[18px] tracking-tight">SWITCHBACK</span>
        </div>
        <div className="hidden md:block text-[12px] text-[#8a8a8a] max-w-md text-right leading-snug">
          Every cancel is an auction. Every subscription a revocable card.
        </div>
      </div>
    </header>
  );
}

function AtStake({
  savings,
  yearlyAtStake,
}: {
  savings: number;
  yearlyAtStake: number;
}) {
  return (
    <section className="pt-16 sm:pt-24">
      <div className="eyebrow">Annual at-stake</div>
      <div className="mt-4 flex items-baseline gap-5 flex-wrap">
        <AnimatedCounter
          value={yearlyAtStake}
          prefix="$"
          suffix="/yr"
          className="display text-[64px] sm:text-[96px] leading-none text-[#F38B00] tabular-nums"
        />
        <div className="text-[#8a8a8a] text-sm max-w-sm leading-snug">
          What this household pays every year for the six subscriptions below.
          Click any cancel button to watch Aria do the work in a real browser.
        </div>
      </div>

      <div className="mt-6 flex items-center gap-6 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="eyebrow !text-[#8a8a8a]">Saved so far</span>
          <AnimatedCounter
            value={savings}
            prefix="$"
            className="mono text-[#10b981] font-semibold tabular-nums"
          />
        </div>
        <span className="text-[#3a3a3a]">·</span>
        <span className="text-[#8a8a8a] text-[12px] mono">
          {SUBSCRIPTIONS.length} merchants tracked
        </span>
      </div>
    </section>
  );
}

function CancellableRow({
  sub,
  state,
  onCancel,
  onToggleExpanded,
}: {
  sub: Subscription;
  state: CardState;
  onCancel: () => void;
  onToggleExpanded: () => void;
}) {
  const isRunning = state.kind === "running";
  const isSuccess = state.kind === "success";
  const isError = state.kind === "error";

  return (
    <div className="flex flex-col">
      {/* The base card. We use the existing SubscriptionCard for idle + cancelled
          visual states; for "running" we render a custom overlay row so the
          existing component doesn't have to learn a new state machine. */}
      {isRunning ? (
        <RunningRow sub={sub} startedAt={state.startedAt} />
      ) : (
        <SubscriptionCard
          sub={sub}
          state={isSuccess ? "cancelled" : "active"}
          onCancel={isError ? onCancel : onCancel}
        />
      )}

      {/* Success: expandable step list */}
      <AnimatePresence initial={false}>
        {isSuccess && (
          <motion.div
            key="success-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-1 mr-1 rounded-lg border border-[#2a1a00] bg-[#0f0a04]">
              <button
                onClick={onToggleExpanded}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left text-[12px]"
              >
                <span className="text-[#F38B00] mono uppercase tracking-widest text-[10px]">
                  Cancelled in {(state.result.duration_ms / 1000).toFixed(1)}s ·{" "}
                  {state.result.steps.length} steps
                </span>
                <span className="text-[#8a8a8a] text-[11px]">
                  {state.expanded ? "Hide" : "View agent steps"}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {state.expanded && (
                  <motion.ol
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-[#2a1a00] divide-y divide-[#1a1208]"
                  >
                    {state.result.steps.map((step) => (
                      <li
                        key={step.index}
                        className="px-4 py-2 text-[12px] text-[#cccccc] flex gap-3"
                      >
                        <span className="mono text-[#F38B00] w-6 shrink-0">
                          {String(step.index).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 break-words">
                          {step.action}
                        </span>
                      </li>
                    ))}
                  </motion.ol>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error inline */}
      <AnimatePresence initial={false}>
        {isError && (
          <motion.div
            key="error-detail"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="mt-2 px-4 py-2.5 rounded-lg border border-[#3a1414] bg-[#1a0808] text-[12px] text-[#ff8a8a] flex items-center justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="font-semibold">
                Aria couldn&apos;t complete it.
              </span>{" "}
              <span className="text-[#cc6e6e]">{state.message}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Retry
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RunningRow({
  sub,
  startedAt,
}: {
  sub: Subscription;
  startedAt: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="relative bg-[#141414] border border-[#F38B00]/40 rounded-xl p-5 overflow-hidden"
      aria-busy="true"
      aria-live="polite"
    >
      <motion.div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#F38B00]"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BrandMark id={sub.id} size={36} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight">
              {sub.service}
            </h3>
            <motion.div
              className="text-[12px] text-[#F38B00] mt-0.5"
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{
                duration: 1.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              Aria is canceling {sub.service}…
            </motion.div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="mono text-[15px] font-semibold tabular-nums">
            {elapsed}s
          </div>
          <div className="text-[10px] uppercase tracking-widest text-[#555]">
            elapsed
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-[#8a8a8a]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F38B00] live-dot" />
            <span className="mono uppercase tracking-widest text-[10px] text-[#F38B00]">
              Browser agent live
            </span>
          </span>
        </div>
        <Button variant="secondary" size="sm" disabled>
          Canceling…
        </Button>
      </div>
    </motion.div>
  );
}

function ConnectedFooter() {
  return (
    <div className="mt-16 flex justify-center">
      <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-[#262626] bg-[#141414] text-[12px] text-[#8a8a8a]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] live-dot" />
        <span className="mono uppercase tracking-widest text-[10px]">
          Connected to
        </span>
        <span className="text-[#ededed] font-semibold">TANGERINE</span>
        <span className="text-[#3a3a3a]">·</span>
        <span className="text-[11px]">via Plaid</span>
      </div>
    </div>
  );
}
