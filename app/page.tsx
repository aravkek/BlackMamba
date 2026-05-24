"use client";

import { useCallback, useEffect, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import {
  ChatComposer,
  ChatThread,
  SubscriptionRail,
  type ChatMessage,
  type ToolInvocation,
} from "@/components/chat";
import { UploadModal } from "@/components/UploadModal";
import { Button } from "@/components/ui/Button";
import { SUBSCRIPTIONS, type Subscription } from "@/lib/data";

type ApiChatResponse = {
  message: { role: string; content: string };
  toolCalls: ToolInvocation[];
};

type CancelResult = {
  success?: boolean;
  [key: string]: unknown;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(SUBSCRIPTIONS);
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);

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

  useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect

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
    [messages, subscriptions, refresh],
  );

  const handleRailPick = useCallback(
    (sub: Subscription) => {
      void sendMessage(`cancel ${sub.service}`);
    },
    [sendMessage],
  );

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0a0a] text-[#ededed] overflow-hidden">
      {/* Header */}
      <header className="border-b border-[#262626] px-6 sm:px-10 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <BrandMark id="tangerine" size={26} />
          <span className="display text-[18px] tracking-tight">BLACKMAMBA</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
          Upload statement
        </Button>
      </header>

      {/* Main body: chat column + subscription rail */}
      {/*
        Mobile (< md): flex-col-reverse so rail stacks ABOVE chat visually,
        but the composer is sticky below via the outer flex column.
        Desktop (md+): side-by-side grid with the rail on the right.
      */}
      <div className="flex-1 min-h-0 flex flex-col-reverse md:grid md:grid-cols-[1fr_320px] overflow-hidden">
        {/* Chat column */}
        <div className="flex flex-col min-h-0 overflow-hidden border-t border-[#262626] md:border-t-0 md:border-r md:border-[#262626]">
          <div className="flex-1 min-h-0 px-6 sm:px-10 pt-8 pb-2">
            <ChatThread messages={messages} pendingAssistant={pending} />
          </div>
          <ChatComposer onSend={sendMessage} disabled={pending} />
        </div>

        {/* Subscription rail */}
        <div className="overflow-y-auto no-scrollbar px-6 sm:px-0 pr-0 sm:pr-6 md:pr-10 pt-8 pb-4">
          <SubscriptionRail
            subscriptions={subscriptions}
            onPick={handleRailPick}
            cancelledIds={cancelledIds}
          />
        </div>
      </div>

      {/* Upload modal */}
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setUploadOpen(false);
          void refresh();
        }}
      />
    </div>
  );
}
