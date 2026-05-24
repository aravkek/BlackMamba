"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Props = {
  value: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

/**
 * Single-purpose count-up. RequestAnimationFrame driven, ease-out cubic.
 * Respects prefers-reduced-motion (snaps directly to target).
 */
export function AnimatedCounter({
  value,
  durationMs = 1200,
  prefix = "",
  suffix = "",
  className,
}: Props) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const start = useRef<number | null>(null);
  const from = useRef<number>(reduced ? value : 0);
  const to = useRef<number>(value);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    from.current = shown;
    to.current = value;
    start.current = null;

    let raf = 0;
    const tick = (t: number) => {
      if (start.current === null) start.current = t;
      const elapsed = t - start.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from.current + (to.current - from.current) * eased;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, reduced]);

  const formatted = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 0,
  }).format(Math.round(shown));

  return (
    <motion.span className={className} aria-live="polite">
      {prefix}
      {formatted}
      {suffix}
    </motion.span>
  );
}
