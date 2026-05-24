"use client";

import { motion } from "framer-motion";
import { type Subscription } from "@/lib/data";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/Button";
import { formatMoney } from "@/lib/cn";

type Props = {
  sub: Subscription;
  state?: "active" | "cancelled" | "replaced";
  onCancel?: () => void;
};

export function SubscriptionCard({ sub, state = "active", onCancel }: Props) {
  const isCancelled = state === "cancelled";
  const isReplaced = state === "replaced";
  const isDiscovered = sub.detectedFromStatement === true;

  const lastChargeDisplay = sub.lastCharge
    ? {
        amount: `$${sub.lastCharge.amount.toFixed(2)}`,
        date: sub.lastCharge.date.slice(5).replace("-", "/"),
      }
    : null;

  const liveDotColor = sub.isTrialVerify ? "#F38B00" : "#10b981";
  const liveTextColor = sub.isTrialVerify ? "#F38B00" : "#10b981";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isCancelled ? 0.4 : 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative group bg-[#141414] border border-[#262626] rounded-xl p-5 lift overflow-hidden"
    >
      {/* brand accent stripe */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: sub.brandColor }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BrandMark id={sub.id} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className={`text-[15px] font-semibold tracking-tight ${
                  isCancelled ? "line-through text-[#8a8a8a]" : ""
                }`}
              >
                {sub.service}
              </h3>
              {isCancelled && (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#ff4d4d] border border-[#3a1414] bg-[#1a0808] px-1.5 py-0.5 rounded">
                  Cancelled
                </span>
              )}
              {isReplaced && (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#F38B00] border border-[#3a2200] bg-[#1a0f00] px-1.5 py-0.5 rounded">
                  Switched
                </span>
              )}
              {isDiscovered && !isCancelled && !isReplaced && (
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#F38B00] border border-[#3a2200] bg-[#1a0f00] px-1.5 py-0.5 rounded">
                  Discovered
                </span>
              )}
            </div>
            {sub.note && (
              <div className="text-[11px] text-[#8a8a8a] mt-0.5 truncate">
                {sub.note}
              </div>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="mono text-[15px] font-semibold text-[#ededed]">
            {formatMoney(sub.amount)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-[#555]">
            /{sub.frequency === "monthly" ? "mo" : "yr"}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-[#555]">
          <span className="mono">
            card · •• {hashLast4(sub.id)}
            {lastChargeDisplay && (
              <> · last {lastChargeDisplay.amount} · {lastChargeDisplay.date}</>
            )}
          </span>
          {!isCancelled && (
            <span className="inline-flex items-center gap-1">
              <span
                className="w-1 h-1 rounded-full live-dot"
                style={{ background: liveDotColor }}
              />
              <span
                className="uppercase tracking-widest text-[10px]"
                style={{ color: liveTextColor }}
              >
                live
              </span>
            </span>
          )}
        </div>

        {!isCancelled && !isReplaced && (
          <Button variant="danger" size="sm" onClick={onCancel}>
            Cancel & Switch
          </Button>
        )}
        {isReplaced && (
          <span className="text-[11px] text-[#F38B00] mono">↳ via Crave</span>
        )}
      </div>
    </motion.div>
  );
}

/** Deterministic last-4 from id for visual polish. */
function hashLast4(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return ((n % 9000) + 1000).toString();
}
