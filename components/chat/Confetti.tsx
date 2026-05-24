"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// Small celebratory burst — emerald/tangerine particles only, no emoji.
// Mounts on `active: true`, auto-cleans particles after 1.6s.

type Particle = {
  id: number;
  x: number; // initial x offset from origin (px)
  yEnd: number; // final fall distance (px)
  rot: number; // final rotation (deg)
  color: string;
  size: number;
  duration: number;
};

const COLORS = ["#10b981", "#F38B00", "#fef08a", "#ffffff"];

function makeParticles(count: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: i,
      x: (Math.random() - 0.5) * 240,
      yEnd: 80 + Math.random() * 120,
      rot: (Math.random() - 0.5) * 540,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 4 + Math.random() * 5,
      duration: 1.1 + Math.random() * 0.6,
    });
  }
  return out;
}

export function Confetti({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!active) return;
    setParticles(makeParticles(28));
    const t = setTimeout(() => setParticles([]), 1800);
    return () => clearTimeout(t);
  }, [active]);

  if (particles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute left-1/2 top-2 -translate-x-1/2">
        {particles.map((p) => (
          <motion.span
            key={p.id}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{
              x: p.x,
              y: p.yEnd,
              rotate: p.rot,
              opacity: 0,
            }}
            transition={{
              duration: p.duration,
              ease: [0.2, 0.7, 0.3, 1],
            }}
            style={{
              position: "absolute",
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
