"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type CardData = {
  cardNumber: string;
  last4: string;
  expMonth: number;
  expYear: number;
  brand: string;
};

type Props = {
  open: boolean;
  merchant: string;
  limit: number;
  onClose: () => void;
};

const VOICE_TEXT = (merchant: string, limit: number) =>
  `Switching you to ${merchant}. Issuing a virtual card with a ${limit} dollar monthly cap.`;

const CAPTION = (merchant: string) =>
  `${merchant} can charge once. Then this card dies. No retention bots. No forgotten trials.`;

const MOCK_CARD: CardData = {
  cardNumber: "4242 4242 4242 4242",
  last4: "4242",
  expMonth: 12,
  expYear: 2027,
  brand: "Visa",
};

export function VirtualCardReveal({ open, merchant, limit, onClose }: Props) {
  const [card, setCard] = useState<CardData | null>(null);
  const [phase, setPhase] = useState<"loading" | "flipping" | "complete">(
    "loading",
  );
  const [typed, setTyped] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fire both the card issuance + voice in parallel as soon as the modal opens.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCard(null);
    setPhase("loading");
    setTyped("");

    // Parallel: card issuance
    const issueCard = async () => {
      try {
        const res = await fetch("/api/cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchant, limit }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as Partial<CardData>;
        if (cancelled) return;
        setCard({
          cardNumber: json.cardNumber ?? MOCK_CARD.cardNumber,
          last4: json.last4 ?? MOCK_CARD.last4,
          expMonth: json.expMonth ?? MOCK_CARD.expMonth,
          expYear: json.expYear ?? MOCK_CARD.expYear,
          brand: json.brand ?? MOCK_CARD.brand,
        });
      } catch {
        // API not wired yet — use mock so demo never breaks
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 700));
        if (!cancelled) setCard(MOCK_CARD);
      }
    };

    // Parallel: voice
    const playVoice = async () => {
      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: VOICE_TEXT(merchant, limit) }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        // Autoplay may be blocked — best-effort
        audio.play().catch(() => {});
      } catch {
        // voice not wired — silent fallback
      }
    };

    void issueCard();
    void playVoice();

    return () => {
      cancelled = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [open, merchant, limit]);

  // Once card arrives, advance to flipping then complete
  useEffect(() => {
    if (!card) return;
    setPhase("flipping");
    const t = setTimeout(() => setPhase("complete"), 900);
    return () => clearTimeout(t);
  }, [card]);

  // Typewriter for the caption
  useEffect(() => {
    if (phase !== "complete") return;
    const full = CAPTION(merchant);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(full.slice(0, i));
      if (i >= full.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [phase, merchant]);

  // Auto-dismiss after caption fully typed + breathing room
  useEffect(() => {
    if (phase !== "complete") return;
    const id = setTimeout(onClose, 4800);
    return () => clearTimeout(id);
  }, [phase, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="card-reveal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-2xl px-6"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl flex flex-col items-center">
            <div className="eyebrow mb-6 text-[#F38B00]">
              ◍ provisioning · stripe issuing
            </div>

            {/* Card flip stage */}
            <div
              className="relative"
              style={{ perspective: 1400, width: 420, height: 260 }}
            >
              <AnimatePresence mode="wait">
                {!card && (
                  <motion.div
                    key="skeleton"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    className="absolute inset-0 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center"
                  >
                    <div className="flex items-center gap-2 text-[12px] text-[#8a8a8a] mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F38B00] live-dot" />
                      issuing virtual card…
                    </div>
                  </motion.div>
                )}

                {card && (
                  <motion.div
                    key="card"
                    initial={{ rotateY: 180, opacity: 0, scale: 0.9 }}
                    animate={{ rotateY: 0, opacity: 1, scale: 1 }}
                    transition={{
                      duration: 0.9,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                    className="absolute inset-0 preserve-3d"
                  >
                    <VirtualCard
                      card={card}
                      merchant={merchant}
                      limit={limit}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Caption */}
            <div className="mt-10 min-h-[60px] max-w-xl text-center">
              {phase === "complete" && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="text-[16px] text-[#ededed] leading-relaxed"
                >
                  {typed}
                  <span className="inline-block w-[2px] h-[14px] bg-[#F38B00] ml-[2px] -mb-[1px] animate-pulse" />
                </motion.p>
              )}
            </div>

            <button
              onClick={onClose}
              className="mt-10 text-[11px] text-[#555] hover:text-[#8a8a8a] uppercase tracking-widest"
            >
              dismiss
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VirtualCard({
  card,
  merchant,
  limit,
}: {
  card: CardData;
  merchant: string;
  limit: number;
}) {
  const masked = `•••• •••• •••• ${card.last4}`;
  const exp = `${String(card.expMonth).padStart(2, "0")}/${String(
    card.expYear,
  ).slice(-2)}`;

  return (
    <div
      className="w-full h-full rounded-2xl backface-hidden p-7 flex flex-col justify-between relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #0e0e0e 0%, #1a1a1a 60%, #0a0a0a 100%)",
        border: "1px solid #262626",
        boxShadow:
          "0 30px 60px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* tangerine arc — restrained accent */}
      <div
        aria-hidden
        className="absolute -right-20 -top-20 w-60 h-60 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(243,139,0,0.18) 0%, transparent 60%)",
        }}
      />
      {/* chip */}
      <div className="flex items-start justify-between">
        <div
          aria-hidden
          className="w-10 h-7 rounded"
          style={{
            background:
              "linear-gradient(135deg, #c8a356 0%, #8c6e2a 50%, #c8a356 100%)",
          }}
        />
        <div className="text-right">
          <div className="eyebrow text-[#F38B00]">switchback</div>
          <div className="text-[10px] text-[#8a8a8a] mt-0.5 uppercase tracking-widest">
            single-use · ${limit}/mo cap
          </div>
        </div>
      </div>

      <div>
        <div className="mono text-[20px] tracking-[0.18em] text-[#ededed]">
          {masked}
        </div>
        <div className="mt-3 flex items-end justify-between text-[10px] text-[#8a8a8a] uppercase tracking-widest">
          <div>
            <div className="text-[9px] text-[#555]">merchant</div>
            <div className="text-[12px] text-[#ededed] normal-case tracking-normal font-semibold">
              {merchant.toUpperCase()}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-[#555]">expires</div>
            <div className="text-[12px] text-[#ededed] mono">{exp}</div>
          </div>
          <div className="text-[14px] text-[#ededed] font-semibold tracking-normal">
            {card.brand}
          </div>
        </div>
      </div>
    </div>
  );
}
