"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage } from "./types";
import { MessageBubble } from "./MessageBubble";

const NEAR_BOTTOM_THRESHOLD = 80;

const MSG_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
    },
  },
};

function PendingDots() {
  return (
    <div className="mt-8" role="status" aria-label="Aria is responding">
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="mono text-[10px] uppercase tracking-widest text-[#5a5a5f]">
          aria
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 1.4,
              ease: "easeInOut",
              repeat: Infinity,
              delay: i * 0.1,
            }}
            className="text-[#F38B00] text-[16px] leading-none select-none"
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
    <div className="flex flex-col items-center justify-center h-full">
      <h1 className="serif text-6xl text-[#ededed] tracking-tight">
        Switchback.
      </h1>
      <p className="mt-4 mono text-xs uppercase tracking-widest text-[#5a5a5f]">
        cancel &middot; classify &middot; audit
      </p>
    </div>
  );
}

type ChatThreadProps = {
  messages: ChatMessage[];
  pendingAssistant?: boolean;
};

export function ChatThread({
  messages,
  pendingAssistant = false,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isNearBottom = (): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return (
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD
    );
  };

  useEffect(() => {
    if (isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pendingAssistant]);

  const isEmpty = messages.length === 0 && !pendingAssistant;

  return (
    <div ref={scrollRef} className="overflow-y-auto px-1 h-full no-scrollbar">
      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                variants={MSG_VARIANTS}
                initial="hidden"
                animate="visible"
              >
                <MessageBubble message={msg} />
              </motion.div>
            ))}
          </AnimatePresence>
          {pendingAssistant && <PendingDots />}
        </>
      )}
      <div ref={bottomRef} className="h-px" aria-hidden="true" />
    </div>
  );
}
