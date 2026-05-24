import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "bg-[#141414] border border-[#262626] rounded-xl",
        "transition-colors",
        className,
      )}
    />
  );
}
