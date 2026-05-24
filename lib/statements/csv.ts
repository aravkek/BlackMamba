import Papa from "papaparse";
import type { ParsedCharge } from "./types";

const DATE_COL_RE = /^(transaction date|post date|date|posting date)$/i;
const AMOUNT_COL_RE = /^(amount|debit|charge)$/i;
const MERCHANT_COL_RE = /^(description|merchant|details|payee|memo)$/i;

function pickColumn(headers: string[], re: RegExp): string | null {
  return headers.find((h) => re.test(h.trim())) ?? null;
}

function parseDate(s: string): string | null {
  const trimmed = (s ?? "").trim();
  // YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // MM/DD/YYYY by default; DD/MM/YYYY only when the day slot is unambiguous.
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first > 31 || second > 31) return null;
    if (first > 12 && second <= 12) {
      return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    if (second > 12 && first <= 12) {
      return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
    if (first <= 12 && second <= 12) {
      return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return null;
}

function parseAmount(s: string): number | null {
  const cleaned = (s ?? "").toString().replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string, sourceName: string): ParsedCharge[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = result.data;
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const dateCol = pickColumn(headers, DATE_COL_RE);
  const amountCol = pickColumn(headers, AMOUNT_COL_RE);
  const merchantCol = pickColumn(headers, MERCHANT_COL_RE);
  if (!dateCol || !amountCol || !merchantCol) return [];

  const numericAmounts: number[] = [];
  for (const r of rows) {
    const n = parseAmount(r[amountCol]);
    if (n !== null && n !== 0) numericAmounts.push(n);
  }
  if (numericAmounts.length === 0) return [];

  const negativeCount = numericAmounts.filter((n) => n < 0).length;
  const negativeIsDebit = negativeCount >= numericAmounts.length / 2;

  const charges: ParsedCharge[] = [];
  for (const r of rows) {
    const amt = parseAmount(r[amountCol]);
    if (amt === null || amt === 0) continue;
    const isDebit = negativeIsDebit ? amt < 0 : amt > 0;
    if (!isDebit) continue;
    const postedAt = parseDate(r[dateCol]);
    if (!postedAt) continue;
    const merchant = (r[merchantCol] ?? "").trim();
    if (!merchant) continue;
    charges.push({
      postedAt,
      merchantRaw: merchant,
      amount: Math.round(Math.abs(amt) * 100) / 100,
      currency: "USD",
      source: sourceName,
    });
  }
  return charges;
}
