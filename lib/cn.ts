import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatMoney(n: number, opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    ...opts,
  }).format(n);
}
