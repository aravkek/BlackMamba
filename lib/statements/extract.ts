import type { ParsedCharge } from "./types";
import { parseCsv } from "./csv";
import { extractFromPdfText, type Llm } from "./pdf";

export type ExtractInput = {
  filename: string;
  bytes: Buffer;
  llm: Llm;
  pdfToText: (buf: Buffer) => Promise<string>;
};

export async function extractCharges(input: ExtractInput): Promise<ParsedCharge[]> {
  const lower = input.filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    return parseCsv(input.bytes.toString("utf-8"), input.filename);
  }
  if (lower.endsWith(".pdf")) {
    const text = await input.pdfToText(input.bytes);
    return extractFromPdfText(text, input.filename, input.llm);
  }
  return [];
}
