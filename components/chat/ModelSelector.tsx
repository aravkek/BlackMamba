"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai" },
  { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", provider: "anthropic" },
  { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", provider: "anthropic" },
];

type Props = {
  value: string;
  onChange: (id: string) => void;
};

export function ModelSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = MODEL_OPTIONS.find((m) => m.id === value) ?? MODEL_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 mono text-[10px] uppercase tracking-widest text-[color:var(--fg-dim)] hover:text-[color:var(--fg)] transition-colors select-none px-2 py-1 -mx-2 rounded"
      >
        <span>{current.label}</span>
        <ChevronDown className="size-3" aria-hidden />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full mb-2 left-0 min-w-[180px] rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)] py-1 z-20"
        >
          {MODEL_OPTIONS.map((m) => {
            const selected = m.id === value;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[color:var(--fg)] hover:bg-[color:var(--surface-3)] transition-colors"
                >
                  <span>{m.label}</span>
                  {selected && <Check className="size-3.5 text-[color:var(--tangerine)]" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
