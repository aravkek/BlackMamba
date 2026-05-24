"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NETFLIX_BIDS } from "@/lib/data";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/Button";

type Props = {
  open: boolean;
  onAccept: (bidId: string) => void;
  onSkip: () => void;
};

export function AuctionModal({ open, onAccept, onSkip }: Props) {
  // ESC to skip — keyboard a11y
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onSkip]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="auction-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auction-headline"
        >
          {/* radial accent — keeps it from feeling like a generic SaaS modal */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 0%, rgba(243,139,0,0.10) 0%, transparent 70%)",
            }}
          />

          <motion.div
            initial={{ y: 20, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 10, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative w-full max-w-6xl"
          >
            <div className="mb-10">
              <div className="eyebrow mb-3 text-[#F38B00]">
                ◍ live auction · 1.2s
              </div>
              <h2
                id="auction-headline"
                className="display text-[44px] md:text-[56px] leading-[0.95] max-w-3xl"
              >
                3 competitors are bidding to keep you{" "}
                <span className="text-[#F38B00]">watching.</span>
              </h2>
              <p className="text-[#8a8a8a] text-[15px] mt-3 max-w-xl">
                Netflix wants $24.99/mo to retain you. These three will pay you
                to leave it. Pick one — your card swaps in 4 seconds.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {NETFLIX_BIDS.map((bid, i) => (
                <motion.div
                  key={bid.id}
                  initial={{ y: 40, opacity: 0, rotateX: -10 }}
                  animate={{ y: 0, opacity: 1, rotateX: 0 }}
                  transition={{
                    delay: 0.25 + i * 0.18,
                    duration: 0.55,
                    ease: [0.2, 0.8, 0.2, 1],
                  }}
                  className={`relative rounded-xl p-6 border bg-[#141414] ${
                    bid.winner
                      ? "border-[#F38B00] glow-tangerine"
                      : "border-[#262626]"
                  }`}
                >
                  {bid.winner && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.0, duration: 0.3 }}
                      className="absolute -top-3 left-6 text-[10px] font-semibold uppercase tracking-widest bg-[#F38B00] text-black px-2 py-1 rounded"
                    >
                      Winning bid
                    </motion.div>
                  )}

                  <div className="flex items-center gap-3 mb-5">
                    <BrandMark id={bid.id} size={36} />
                    <div className="font-semibold text-[15px] tracking-tight">
                      {bid.brand}
                    </div>
                  </div>

                  <div
                    className={`display text-[28px] mb-1 ${
                      bid.winner ? "text-[#F38B00]" : "text-[#ededed]"
                    }`}
                  >
                    {bid.headline}
                  </div>
                  {bid.cashback && (
                    <div className="mono text-[12px] text-[#10b981] mb-4">
                      {bid.cashback}
                    </div>
                  )}

                  <ul className="space-y-2 mb-6 mt-4">
                    {bid.bullets.map((b) => (
                      <li
                        key={b}
                        className="text-[13px] text-[#8a8a8a] leading-snug flex gap-2"
                      >
                        <span className="text-[#3a3a3a] mt-[1px]">→</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={bid.winner ? "primary" : "secondary"}
                    size="md"
                    className="w-full"
                    onClick={() => onAccept(bid.id)}
                  >
                    {bid.winner
                      ? `Accept ${bid.brand}'s bid`
                      : `Take ${bid.brand}`}
                  </Button>
                </motion.div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-10 pt-6 border-t border-[#1a1a1a]">
              <div className="text-[11px] text-[#555] mono">
                Auctioneer ID #SW-NTX-{Math.floor(Math.random() * 9000 + 1000)}{" "}
                · bids verified · settled in milliseconds
              </div>
              <button
                onClick={onSkip}
                className="text-[12px] text-[#8a8a8a] hover:text-[#ededed] underline underline-offset-4 decoration-[#3a3a3a] hover:decoration-[#8a8a8a] transition-colors"
              >
                skip and just cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
