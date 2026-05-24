"use client";

import { type Subscription } from "@/lib/data";

type Props = {
  subscriptions: Subscription[];
  onPick: (sub: Subscription) => void;
  cancelledIds?: ReadonlySet<string>;
};

function computeAnnualTotal(subscriptions: Subscription[]): number {
  return subscriptions.reduce((sum, s) => {
    return sum + (s.frequency === "monthly" ? s.amount * 12 : s.amount);
  }, 0);
}

function formatTotal(total: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(total);
}

function buildAriaLabel(sub: Subscription): string {
  const freq = sub.frequency === "monthly" ? "per month" : "per year";
  return `Cancel ${sub.service} subscription, $${sub.amount.toFixed(2)} ${freq}`;
}

function formatAmount(sub: Subscription): string {
  return `$${sub.amount.toFixed(2)}`;
}

export function SubscriptionRail({
  subscriptions,
  onPick,
  cancelledIds,
}: Props) {
  const annualTotal = computeAnnualTotal(subscriptions);
  const totalFormatted = formatTotal(annualTotal);

  return (
    <aside className="w-full md:w-80 shrink-0 flex flex-col">
      {/* Eyebrow header */}
      <div className="mono text-[10px] uppercase tracking-widest text-[#5a5a5f] mb-3">
        Subscriptions
      </div>

      {/* Hairline separator */}
      <div className="h-px bg-white/[0.06] mb-3" />

      {/* Subscription list */}
      {subscriptions.length === 0 ? (
        <p className="mono text-[12px] text-[#5a5a5f] text-center py-4">
          no subscriptions yet
        </p>
      ) : (
        <ul className="flex flex-col">
          {subscriptions.map((sub) => {
            const isCancelled = cancelledIds?.has(sub.id) ?? false;
            const amountColor = sub.isTrialVerify
              ? "text-[#F38B00]"
              : "text-[#ededed]";

            return (
              <li key={sub.id}>
                <button
                  type="button"
                  disabled={isCancelled}
                  onClick={() => !isCancelled && onPick(sub)}
                  aria-label={buildAriaLabel(sub)}
                  className={[
                    "w-full flex items-center justify-between py-2.5 -mx-2 px-2 rounded-md text-left transition-colors duration-150",
                    isCancelled
                      ? "opacity-40 line-through cursor-default"
                      : "hover:bg-[#161616] cursor-pointer",
                  ].join(" ")}
                >
                  <span className="text-[14px] text-[#ededed] flex items-center min-w-0">
                    {sub.detectedFromStatement && (
                      <span
                        aria-hidden
                        className="text-[#F38B00] mr-2 shrink-0"
                      >
                        &bull;
                      </span>
                    )}
                    <span className="truncate">{sub.service}</span>
                  </span>
                  <span
                    className={`mono text-[14px] tabular-nums shrink-0 ml-3 ${amountColor}`}
                  >
                    {formatAmount(sub)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Annual at-stake total */}
      {subscriptions.length > 0 && (
        <>
          <div className="h-px bg-white/[0.06] mt-3 mb-6" />
          <div className="mono text-[10px] uppercase tracking-widest text-[#5a5a5f]">
            Annual at-stake
          </div>
          <div className="mt-2 flex items-baseline">
            <span className="serif text-4xl text-[#ededed] tabular-nums leading-none">
              {totalFormatted}
            </span>
            <span className="mono text-[11px] text-[#5a5a5f] ml-2">/yr</span>
          </div>
        </>
      )}
    </aside>
  );
}
