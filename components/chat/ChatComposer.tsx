"use client";

import {
  useRef,
  useState,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { ModelSelector } from "./ModelSelector";

const MAX_ROWS = 6;

type ChatComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  model: string;
  onModelChange: (id: string) => void;
};

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder,
  model,
  onModelChange,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const hasContent = value.trim().length > 0;

  return (
    <div className="px-8 md:px-12 pb-8 pt-6">
      <div
        className={[
          "glass rounded-2xl max-w-3xl mx-auto transition-shadow duration-200",
          focused
            ? "shadow-[0_0_0_1px_rgba(243,139,0,0.10),0_8px_32px_-8px_rgba(0,0,0,0.6)]"
            : "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)]",
        ].join(" ")}
      >
        <div className="px-4 pt-4 pb-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            placeholder={placeholder ?? "Message Aria…"}
            rows={1}
            aria-label="Message input"
            className="
              w-full resize-none bg-transparent
              text-[15px] text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)]
              leading-relaxed outline-none border-none
              disabled:opacity-40
              overflow-y-auto no-scrollbar
            "
          />
        </div>

        {/* Bottom action row */}
        <div className="flex items-center justify-between px-4 pb-3">
          <ModelSelector value={model} onChange={onModelChange} />
          <div className="flex items-center gap-2">
            {hasContent && (
              <span
                className="mono text-[11px] text-[color:var(--fg-dim)] select-none"
                aria-hidden="true"
              >
                &#8629;
              </span>
            )}
            <Button
              onClick={submit}
              disabled={disabled || !hasContent}
              aria-label={disabled ? "Sending message" : "Send message"}
              size="sm"
              className="bg-[#F38B00] hover:bg-[#ff9a14] text-black border-0 shrink-0"
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
