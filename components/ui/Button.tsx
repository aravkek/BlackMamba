"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[#F38B00] text-black hover:bg-[#ffa11f] active:bg-[#d97a00] focus-visible:ring-[#F38B00]/60",
  secondary:
    "bg-[#1a1a1a] text-[#ededed] border border-[#262626] hover:bg-[#202020] hover:border-[#3a3a3a] focus-visible:ring-[#3a3a3a]",
  ghost:
    "bg-transparent text-[#8a8a8a] hover:text-[#ededed] hover:bg-[#1a1a1a] focus-visible:ring-[#3a3a3a]",
  danger:
    "bg-transparent text-[#ededed] border border-[#262626] hover:border-[#E50914] hover:text-[#ff4d4d] focus-visible:ring-[#E50914]/40",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-6 text-[14px]",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "secondary", size = "md", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        {...rest}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md font-medium",
          "transition-all duration-150 ease-out outline-none",
          "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]",
          "disabled:opacity-40 disabled:pointer-events-none",
          "select-none",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
      />
    );
  },
);
