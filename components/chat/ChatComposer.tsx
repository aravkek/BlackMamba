"use client";

import { useRef, useState, useCallback, type KeyboardEvent, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";

const MAX_ROWS = 6;

type ChatComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 24;
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      resizeTextarea();
    },
    [resizeTextarea],
  );

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter") {
        const isModifier = e.metaKey || e.ctrlKey;
        if (isModifier || !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      }
    },
    [submit],
  );

  const hasContent = value.trim().length > 0;

  return (
    <div className="border-t border-[#262626] bg-[#0a0a0a] px-6 py-4 max-sm:px-4 max-sm:py-3">
      <div className="flex items-end gap-3">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder ?? "Message Aria…"}
            rows={1}
            aria-label="Message input"
            className="
              w-full resize-none bg-transparent
              text-[15px] text-[#ededed] placeholder:text-[#555]
              leading-relaxed outline-none
              disabled:opacity-40
              overflow-y-auto no-scrollbar
            "
          />
        </div>
        {hasContent && (
          <span
            className="mono text-[11px] text-[#3a3a3a] pb-1 shrink-0 select-none"
            aria-hidden="true"
          >
            Cmd &#8629;
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={disabled || !hasContent}
          aria-label={disabled ? "Sending message" : "Send message"}
          className="shrink-0 mb-px"
        >
          {disabled ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
