"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

import { BrandMark } from "@/components/BrandMark";
import {
  ChatComposer,
  ChatThread,
  SubscriptionRail,
  type ChatMessage,
  type ToolInvocation,
} from "@/components/chat";
import { UploadModal } from "@/components/UploadModal";
import { VirtualCardReveal } from "@/components/VirtualCardReveal";
import { Button } from "@/components/shadcn/button";
import { SUBSCRIPTIONS, type Subscription } from "@/lib/data";

type ApiChatResponse = {
  message: { role: string; content: string };
  toolCalls: ToolInvocation[];
};

type CancelResult = {
  success?: boolean;
  [key: string]: unknown;
};

type WalletCard = {
  cardId: string;
  merchant: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  monthlyCapCents: number;
  issuedAt: string;
  status: "active" | "revoked";
  mock: boolean;
};

type RevealState = {
  open: boolean;
  merchant: string;
  limit: number;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(SUBSCRIPTIONS);
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [walletCards, setWalletCards] = useState<WalletCard[]>([]);
  const [reveal, setReveal] = useState<RevealState>({
    open: false,
    merchant: "",
    limit: 0,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions");
      if (!res.ok) return;
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (data && typeof data === "object" && "subscriptions" in data) {
        const payload = data as { subscriptions: Subscription[] };
        if (Array.isArray(payload.subscriptions)) {
          setSubscriptions(payload.subscriptions);
        }
      }
    } catch {
      // silently keep the seeded list on network failure
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      if (!res.ok) return;
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (data && typeof data === "object" && "cards" in data) {
        const payload = data as { cards: WalletCard[] };
        if (Array.isArray(payload.cards)) {
          setWalletCards(payload.cards);
        }
      }
    } catch {
      // silently keep prior list — wallet is a non-blocking display surface
    }
  }, []);

  useEffect(() => {
    void refresh();
    void fetchWallet();
  }, [refresh, fetchWallet]); // eslint-disable-line react-hooks/set-state-in-effect

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = {
        id: globalThis.crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setPending(true);

      try {
        const apiMessages = nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        let data: ApiChatResponse | null = null;
        try {
          data = (await res.json()) as ApiChatResponse;
        } catch {
          data = null;
        }

        if (!data) {
          throw new Error("Malformed response from server.");
        }

        const assistantMsg: ChatMessage = {
          id: globalThis.crypto.randomUUID(),
          role: "assistant",
          content: data.message.content,
          toolCalls: data.toolCalls ?? [],
          createdAt: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // If any tool call was a successful cancel, mark it and refresh
        const toolCalls: ToolInvocation[] = data.toolCalls ?? [];
        const newlyCancelledIds = new Set<string>();
        let revealTarget: { merchant: string; limit: number } | null = null;

        for (const call of toolCalls) {
          if (call.name === "cancel_subscription") {
            const result = call.result as CancelResult | null;
            if (result && result.success === true) {
              const matched = subscriptions.find(
                (s) =>
                  s.service.toLowerCase() ===
                  (call.args as Record<string, unknown>).service
                    ?.toString()
                    .toLowerCase(),
              );
              if (matched) {
                newlyCancelledIds.add(matched.id);
                // First successful cancel in this turn drives the reveal —
                // wallet section then re-fetches once the overlay opens.
                if (!revealTarget) {
                  revealTarget = {
                    merchant: matched.service,
                    limit: Math.max(1, Math.round(matched.amount)),
                  };
                }
              }
            }
          }
        }

        if (newlyCancelledIds.size > 0) {
          setCancelledIds((prev) => {
            const next = new Set(prev);
            for (const id of newlyCancelledIds) next.add(id);
            return next;
          });
          void refresh();
        }

        if (revealTarget) {
          setReveal({
            open: true,
            merchant: revealTarget.merchant,
            limit: revealTarget.limit,
          });
          // Stripe issuance is fast; give the API a beat to persist before
          // we read the wallet back. A second nudge covers the slow path.
          window.setTimeout(() => void fetchWallet(), 600);
          window.setTimeout(() => void fetchWallet(), 2000);
        }
      } catch {
        const errorMsg: ChatMessage = {
          id: globalThis.crypto.randomUUID(),
          role: "assistant",
          content: "Something broke. Try again.",
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setPending(false);
      }
    },
    [messages, subscriptions, refresh, fetchWallet],
  );

  const handleRailPick = useCallback(
    (sub: Subscription) => {
      void sendMessage(`cancel ${sub.service}`);
    },
    [sendMessage],
  );

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0a0a] text-[#ededed] overflow-hidden relative z-10">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex items-center justify-between px-8 py-6 border-b border-white/[0.06] shrink-0"
      >
        <div className="flex items-center gap-3">
          <BrandMark id="tangerine" size={22} />
          <span className="serif text-[20px] tracking-tight leading-none">
            Switchback
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setUploadOpen(true)}
          className="border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.03] text-[#ededed]"
        >
          Upload statement
        </Button>
      </motion.header>

      {/* Main body: chat column + subscription rail */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[1fr_320px] overflow-hidden"
      >
        {/* Chat column */}
        <div className="flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 px-8 md:px-12 pt-8 pb-2">
            <ChatThread messages={messages} pendingAssistant={pending} />
          </div>
          <ChatComposer onSend={sendMessage} disabled={pending} />
        </div>

        {/* Subscription rail + persistent wallet */}
        <div className="overflow-y-auto no-scrollbar px-8 pt-8 pb-8 border-l border-white/[0.06] hidden md:block">
          <SubscriptionRail
            subscriptions={subscriptions}
            onPick={handleRailPick}
            cancelledIds={cancelledIds}
          />
          <WalletSection cards={walletCards} />
        </div>
      </motion.div>

      {/* Upload modal */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setUploadOpen(false);
          void refresh();
        }}
      />

      {/* Card-issuance reveal — fires once per successful cancel */}
      <VirtualCardReveal
        open={reveal.open}
        merchant={reveal.merchant}
        limit={reveal.limit}
        onClose={() => {
          setReveal((prev) => ({ ...prev, open: false }));
          // One last refetch on close — in case the card landed late.
          void fetchWallet();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet — persistent record of every card BlackMamba has issued.    */
/* Sits below the subscription rail so the cancel→card story is       */
/* visible even after the reveal overlay closes.                      */
/* ------------------------------------------------------------------ */

function WalletSection({ cards }: { cards: WalletCard[] }) {
  return (
    <section className="mt-10">
      <div className="px-1">
        <div className="eyebrow text-[#8a8a8a]">BLACKMAMBA WALLET</div>
        <h2 className="display text-[20px] tracking-tight text-[#ededed] mt-1.5 leading-tight">
          Cards issued, merchants locked out.
        </h2>
        <div className="mt-4 h-px bg-[#1f1f1f]" />
      </div>

      <div className="mt-5 px-1">
        {cards.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-[#5a5a5a] leading-relaxed">
            No cards yet. Cancel a subscription to issue your first revocable
            card.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4">
            {cards.map((card) => (
              <li key={card.cardId}>
                <WalletCardChip card={card} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WalletCardChip({ card }: { card: WalletCard }) {
  const masked = `•••• •••• •••• ${card.last4}`;
  const revoked = card.status === "revoked";
  const capDollars = Math.round(card.monthlyCapCents / 100);
  const issuedTime = formatIssuedTime(card.issuedAt);

  return (
    <div>
      <div
        className={[
          "relative w-full h-[140px] rounded-xl overflow-hidden p-4 flex flex-col justify-between",
          "transition-opacity",
          revoked ? "opacity-55" : "opacity-100",
        ].join(" ")}
        style={{
          background: "linear-gradient(135deg, #0c0c0c 0%, #1a1a1a 100%)",
          border: "1px solid #262626",
          boxShadow:
            "0 14px 30px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.03)",
        }}
      >
        {/* tangerine accent arc */}
        <div
          aria-hidden
          className="absolute -right-12 -top-12 w-32 h-32 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(243,139,0,0.14) 0%, transparent 65%)",
          }}
        />

        {/* Top row: monogram + brand */}
        <div className="flex items-start justify-between relative">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="text-[#F38B00] text-[14px] leading-none"
            >
              ◆
            </span>
            <span className="mono text-[10px] text-[#ededed] tracking-[0.18em]">
              B/M
            </span>
          </div>
          <span className="mono text-[10px] text-[#8a8a8a] tracking-[0.18em] uppercase">
            {card.brand}
          </span>
        </div>

        {/* Middle: merchant name */}
        <div className="display text-[15px] tracking-tight text-[#ededed] leading-tight truncate">
          {card.merchant.toUpperCase()}
        </div>

        {/* Bottom: PAN + cap */}
        <div className="flex items-end justify-between relative">
          <div className="mono text-[11px] tracking-[0.14em] text-[#ededed]">
            {masked}
          </div>
          <div className="mono text-[10px] text-[#8a8a8a]">
            ${capDollars}/mo
          </div>
        </div>
      </div>

      {/* Caption row */}
      <div className="mt-2 px-1 flex items-center justify-between">
        <span
          className={[
            "eyebrow",
            revoked ? "text-[#c0392b]" : "text-[#8a8a8a]",
          ].join(" ")}
        >
          {revoked ? "REVOKED" : "ACTIVE"} · ISSUED {issuedTime}
        </span>
        {card.mock && <span className="eyebrow text-[#555]">DEMO</span>}
      </div>
    </div>
  );
}

function formatIssuedTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d
      .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      .toUpperCase();
  } catch {
    return "—";
  }
}
