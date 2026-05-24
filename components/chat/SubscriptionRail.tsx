"use client";

import { type Subscription } from "@/lib/data";

type Props = {
  subscriptions: Subscription[];
  onPick: (sub: Subscription) => void;
  cancelledIds?: ReadonlySet<string>;
};

function formatAnnualTotal(subscriptions: Subscription[]): string {
  const total = subscriptions.reduce((sum, s) => {
    return sum + (s.frequency === "monthly" ? s.amount * 12 : s.amount);
  }, 0);
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

export function SubscriptionRail({
  subscriptions,
  onPick,
  cancelledIds,
}: Props) {
  const annualTotal = formatAnnualTotal(subscriptions);

  return (
    <aside className="w-full md:w-80 shrink-0 pl-6 pt-12 flex flex-col">
      <div className="eyebrow mb-4">Subscriptions</div>
      <div className="hairline mb-3" />

      {subscriptions.length === 0 ? (
        <p className="mono text-[13px] text-[#555] text-center py-4">
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
                  onClick={() => onPick(sub)}
                  aria-label={buildAriaLabel(sub)}
                  className={[
                    "w-full flex items-center justify-between py-2.5 text-left",
                    "-mx-2 px-2 rounded",
                    "transition-colors duration-150",
                    isCancelled
                      ? "opacity-40 cursor-default"
                      : "hover:bg-[#141414] cursor-pointer",
                  ]
                    .join(" ")
                    .trim()}
                >
                  <span
                    className={[
                      "text-[14px] text-[#ededed] flex items-center",
                      isCancelled ? "line-through" : "",
                    ]
                      .join(" ")
                      .trim()}
                  >
                    {sub.detectedFromStatement && (
                      <span
                        aria-hidden
                        className="inline-block w-1 h-1 rounded-full bg-[#F38B00] mr-2 align-middle"
                      />
                    )}
                    {sub.service}
                  </span>
                  <span
                    className={`mono text-[14px] tabular-nums ${amountColor}`}
                  >
                    ${sub.amount.toFixed(2)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {subscriptions.length > 0 && (
        <>
          <div className="hairline mt-3 mb-3" />
          <div className="eyebrow">Annual at-stake</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="mono text-[20px] text-[#F38B00] tabular-nums">
              {annualTotal}
            </span>
            <span className="text-[11px] text-[#555]">/yr</span>
          </div>
        </>
      )}
    </aside>
  );
}
