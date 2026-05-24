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
  // MM/DD/YYYY
  let m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // YYYY-MM-DD
  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // DD/MM/YYYY: only unambiguous when day slot > 12
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && Number(m[1]) > 12) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
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
