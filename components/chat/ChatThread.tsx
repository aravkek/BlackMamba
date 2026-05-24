"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { ChatMessage } from "./types";
import { MessageBubble } from "./MessageBubble";

const NEAR_BOTTOM_THRESHOLD = 80;

const DOT_VARIANTS = {
  animate: (i: number) => ({
    opacity: [0.3, 1, 0.3],
    y: [0, -3, 0],
    transition: {
      duration: 1.2,
      ease: "easeInOut" as const,
      repeat: Infinity,
      delay: i * 0.2,
    },
  }),
};

function PendingDots() {
  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="mono text-[11px] uppercase text-[#555] tracking-wide">
          aria
        </span>
      </div>
      <div
        className="flex items-center gap-1"
        role="status"
        aria-label="Aria is responding"
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            custom={i}
            animate="animate"
            variants={DOT_VARIANTS}
            className="text-[#8a8a8a] text-[18px] leading-none select-none"
            aria-hidden="true"
          >
            &bull;
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
      <span className="eyebrow">Statement Assistant</span>
      <span className="mono text-[12px] text-[#555]">
        try: &ldquo;cancel my spotify&rdquo;
      </span>
    </div>
  );
}

type ChatThreadProps = {
  messages: ChatMessage[];
  pendingAssistant?: boolean;
};

export function ChatThread({ messages, pendingAssistant = false }: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isNearBottom = (): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD;
  };

  useEffect(() => {
    if (isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pendingAssistant]);

  const isEmpty = messages.length === 0 && !pendingAssistant;

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto px-1 h-full no-scrollbar"
    >
      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {pendingAssistant && <PendingDots />}
        </>
      )}
      <div ref={bottomRef} className="h-px" aria-hidden="true" />
    </div>
  );
}
