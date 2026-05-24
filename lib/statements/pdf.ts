// PDF → text via pdf-parse, then text → charges via an injected LLM
// extractor. The LLM is called via Backboard's OpenAI-compatible endpoint
// at the route layer; here we accept a `Llm` callable so the unit test
// can substitute a deterministic stub.

import type { ParsedCharge } from "./types";

export type Llm = (prompt: string) => Promise<string>;

const EXTRACTION_PROMPT = (text: string) => `\
Extract every bank/credit-card transaction (a debit / purchase / charge — NOT
credits/payments/refunds) from this statement text. Output ONLY a JSON array,
no prose, no markdown fences. Each element:
  { "date": "YYYY-MM-DD", "merchant": "raw merchant string", "amount": positive number in major units }

If you can't find any transactions, output [].

Statement text:
${text.slice(0, 15000)}
`;

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

export async function extractFromPdfText(
  pdfText: string,
  sourceName: string,
  llm: Llm,
): Promise<ParsedCharge[]> {
  if (!pdfText || pdfText.trim().length === 0) return [];
  const raw = await llm(EXTRACTION_PROMPT(pdfText));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ParsedCharge[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const date = typeof r.date === "string" ? r.date.trim() : "";
    const merchant = typeof r.merchant === "string" ? r.merchant.trim() : "";
    const amount = isFiniteNumber(r.amount) ? r.amount : Number(r.amount);
    if (!date || !merchant) continue;
    if (!isFiniteNumber(amount) || amount <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      postedAt: date,
      merchantRaw: merchant,
      amount: Math.round(amount * 100) / 100,
      currency: "USD",
      source: sourceName,
    });
  }
  return out;
}

/** Read a PDF file's bytes into plain text via pdf-parse. */
export async function pdfBufferToText(buf: Buffer): Promise<string> {
  // Lazy import: pdf-parse pulls in heavy code; keep it out of cold start unless used.
  const { default: pdfParse } = await import("pdf-parse");
  const result = await pdfParse(buf);
  return result.text ?? "";
}
