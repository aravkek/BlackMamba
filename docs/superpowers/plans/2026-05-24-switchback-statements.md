# Switchback — Statement Ingestion Plan (Hackathon Demo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the wired Switchback dashboard, a user clicks "Upload statement", drags in one or more CSV and/or PDF bank statements, and within seconds sees their existing subscription cards annotated with `lastCharge` badges + any newly-discovered subscriptions added as additional cards. Bulk upload (multiple files at once) is supported. No DB — annotations live in process memory beside `savings-state.ts`.

**Architecture:** A new `/api/statements/upload` Next.js route accepts `multipart/form-data` with one or more files. For each file: CSV → parsed deterministically with PapaParse; PDF → extracted to text with `pdf-parse`, then JSON-extracted via Backboard's OpenAI-compatible chat completion (the same client `lib/backboard.ts` uses). Each parsed charge is canonicalized (Plan 1's `canonicalize`-style logic, rewritten in TS) and matched against `SUBSCRIPTIONS` (from `lib/data.ts`) by canonical name + amount tolerance. Matches enrich a process-memory store; unmatched subscriptions are added as new derived subs. The dashboard fetches the merged list on render and re-fetches after upload completion.

**Tech Stack:** Next.js 16 (existing), TypeScript, Tailwind v4 (existing), Framer Motion (existing). New deps: `papaparse`, `pdf-parse`. Reuses existing `lib/backboard.ts` pattern (OpenAI-compatible). Persistence: in-memory module like `lib/savings-state.ts`.

**Depends on:** Arav's `lib/data.ts`, `lib/backboard.ts`, the Switchback web app shell. Independent of any TUI or extension work.

---

## Scope check (what we are NOT doing)

- **No Gmail.** Dropped from today's scope.
- **No database.** Demo-grade in-memory store.
- **No per-bank CSV mapping wizard.** Auto-detect headers; one fallback prompt if unknown.
- **No cadence inference** from charge intervals — `SUBSCRIPTIONS` already declares cadence; statement upload only enriches.
- **No PDF OCR for scanned/image-only PDFs.** `pdf-parse` text extraction only. If text empty, we surface a clear "couldn't read this PDF" message.
- **No reconcile with Gmail** (there is no Gmail).
- **No statement storage** — uploaded files are parsed in memory, never written to disk.

---

## File Structure (additions/modifications)

```
lib/
  statements/
    types.ts            # ParsedCharge, MatchResult types
    canonicalize.ts     # merchant name canonicalization (ports our Plan 1 logic)
    csv.ts              # PapaParse-based parser w/ header auto-detect
    pdf.ts              # pdf-parse → text → backboard JSON extraction
    extract.ts          # unified entry: File → ParsedCharge[]
    match.ts            # ParsedCharge[] × SUBSCRIPTIONS → MatchResult
    store.ts            # in-memory subscription augmentations (parallels savings-state.ts)
app/
  api/
    statements/
      upload/route.ts   # POST multipart/form-data; returns MatchResult[]
    subscriptions/route.ts  # GET merged SUBSCRIPTIONS + augmentations
components/
  UploadModal.tsx       # drag-drop modal, multi-file, progress, toast
app/page.tsx            # MODIFY: render dashboard with cards, upload button, fetched subs
lib/data.ts             # MODIFY: extend Subscription with optional lastCharge, detectedFromStatement, isTrialVerify
package.json            # MODIFY: add papaparse, pdf-parse, @types/papaparse
```

---

## Task 1: Extend Subscription type + add the in-memory store

**Files:**
- Modify: `lib/data.ts`
- Create: `lib/statements/types.ts`, `lib/statements/store.ts`
- Test: `lib/statements/__tests__/store.test.ts`

We need a typed extension to `Subscription` and a module-level store, mirroring `savings-state.ts`. There are no tests in the project yet (no test runner installed). Add `vitest` since it integrates with Next/Vite trivially and we'll want it for the parser logic.

- [ ] **Step 1: Add vitest to devDeps**

Edit `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
},
"devDependencies": {
  "vitest": "^2",
  "@types/papaparse": "^5",
  ...existing...
}
```

Add at root `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node", include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"] },
});
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: vitest and types pull in cleanly.

- [ ] **Step 3: Extend Subscription type in `lib/data.ts`**

```ts
// Add to Subscription type (top of file):
export type LastCharge = { date: string; amount: number; source: string };

export type Subscription = {
  id: string;
  service: string;
  amount: number;
  frequency: "monthly" | "yearly";
  brandColor: string;
  accentText?: string;
  note?: string;
  /** Set by statement ingestion when a matching bank charge is found. */
  lastCharge?: LastCharge;
  /** True when this row was added from a statement (not in the seed list). */
  detectedFromStatement?: boolean;
  /** True when the most recent charge looks like a $0.01/$1.00 trial verify. */
  isTrialVerify?: boolean;
};
```

- [ ] **Step 4: Write failing tests for the store**

```ts
// lib/statements/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetAugmentations,
  recordMatch,
  recordNewSub,
  augmentedSubscriptions,
} from "@/lib/statements/store";

beforeEach(() => resetAugmentations());

describe("statement store", () => {
  it("merges lastCharge onto an existing subscription by id", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 24.99, source: "chase.csv" });
    const out = augmentedSubscriptions();
    const net = out.find((s) => s.id === "netflix")!;
    expect(net.lastCharge?.amount).toBe(24.99);
    expect(net.lastCharge?.source).toBe("chase.csv");
  });

  it("flags trial verify when amount is exactly $0.01", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 0.01, source: "chase.csv" });
    const out = augmentedSubscriptions();
    expect(out.find((s) => s.id === "netflix")!.isTrialVerify).toBe(true);
  });

  it("appends new derived subscriptions for unmatched merchants", () => {
    recordNewSub({
      id: "openai",
      service: "OpenAI",
      amount: 20.0,
      frequency: "monthly",
      brandColor: "#10A37F",
      lastCharge: { date: "2026-05-02", amount: 20.0, source: "chase.csv" },
      detectedFromStatement: true,
    });
    const out = augmentedSubscriptions();
    expect(out.some((s) => s.id === "openai")).toBe(true);
    expect(out.find((s) => s.id === "openai")!.detectedFromStatement).toBe(true);
  });

  it("does not duplicate a derived sub on a second recordNewSub with same id", () => {
    const make = () => ({
      id: "openai", service: "OpenAI", amount: 20.0, frequency: "monthly" as const,
      brandColor: "#10A37F", detectedFromStatement: true,
    });
    recordNewSub(make());
    recordNewSub({ ...make(), amount: 22.0 });
    const out = augmentedSubscriptions().filter((s) => s.id === "openai");
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(22.0); // latest wins
  });

  it("resets cleanly", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 24.99, source: "x.csv" });
    resetAugmentations();
    expect(augmentedSubscriptions().find((s) => s.id === "netflix")?.lastCharge).toBeUndefined();
  });
});
```

- [ ] **Step 5: Write `lib/statements/types.ts`**

```ts
// lib/statements/types.ts
export type ParsedCharge = {
  postedAt: string;        // ISO date, YYYY-MM-DD
  merchantRaw: string;
  amount: number;          // always positive, in major currency unit
  currency: string;        // default "USD"
  source: string;          // filename
};

export type Augmentation = {
  lastCharge?: { date: string; amount: number; source: string };
  isTrialVerify?: boolean;
};

export type MatchResult = {
  matched: { subscriptionId: string; merchantRaw: string; amount: number }[];
  newSubs: { id: string; service: string; amount: number; sampleMerchantRaw: string }[];
  ignored: { merchantRaw: string; amount: number; reason: string }[];
  trialVerifyCount: number;
};
```

- [ ] **Step 6: Write `lib/statements/store.ts`**

```ts
// lib/statements/store.ts
// Process-local subscription augmentations + derived subs. Mirrors
// savings-state.ts: resets on server restart, fine for the demo.
import { SUBSCRIPTIONS, type Subscription, type LastCharge } from "@/lib/data";
import type { Augmentation } from "./types";

const VERIFY_AMOUNTS = new Set([0.01, 1.0]);

const _aug = new Map<string, Augmentation>();          // id → augmentation
const _new = new Map<string, Subscription>();           // id → derived sub

export function resetAugmentations(): void {
  _aug.clear();
  _new.clear();
}

export function recordMatch(subscriptionId: string, charge: LastCharge): void {
  const prev = _aug.get(subscriptionId) ?? {};
  const isVerify = VERIFY_AMOUNTS.has(Number(charge.amount.toFixed(2)));
  _aug.set(subscriptionId, {
    lastCharge: charge,
    isTrialVerify: isVerify || prev.isTrialVerify === true,
  });
}

export function recordNewSub(sub: Subscription): void {
  // Latest write wins so re-uploads don't pile up duplicates.
  _new.set(sub.id, sub);
}

export function augmentedSubscriptions(): Subscription[] {
  const base = SUBSCRIPTIONS.map((s) => {
    const a = _aug.get(s.id);
    if (!a) return s;
    return { ...s, lastCharge: a.lastCharge, isTrialVerify: a.isTrialVerify };
  });
  return [...base, ..._new.values()];
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test`
Expected: 5/5 pass.

- [ ] **Step 8: Commit and push**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts lib/data.ts lib/statements/
git commit -m "feat(statements): store + extended Subscription type for ingestion"
git push origin main
```

---

## Task 2: Merchant canonicalization

**Files:**
- Create: `lib/statements/canonicalize.ts`, `lib/statements/__tests__/canonicalize.test.ts`

We port the Python `canonicalize` from the archived Plan 1 (`docs/archive/blackmamba/2026-05-24-plan-1-vertical-slice.md` Task 9). Match against `SUBSCRIPTIONS` happens by canonical name comparison.

- [ ] **Step 1: Write failing tests**

```ts
// lib/statements/__tests__/canonicalize.test.ts
import { describe, it, expect } from "vitest";
import { canonicalize } from "@/lib/statements/canonicalize";

describe("canonicalize", () => {
  it.each([
    ["NETFLIX.COM 866-579-7172 CA", "netflix"],
    ["SPOTIFY USA  NEW YORK NY", "spotify usa"],
    ["AMZN*PRIME 877-NEWPRIME", "prime"],
    ["SQ *Coffee Shop", "coffee shop"],
    ["PAYPAL *NYTimes", "nytimes"],
    ["  Netflix   ", "netflix"],
    ["DISNEY PLUS", "disney"],
    ["GOODLIFE FITNESS - MEMBERSHIP", "goodlife fitness"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

Run: `pnpm test lib/statements/__tests__/canonicalize.test.ts`
Expected: file-not-found / import error.

- [ ] **Step 3: Implement `canonicalize.ts`**

```ts
// lib/statements/canonicalize.ts
// Strip merchant prefixes (AMZN*, SQ*, PAYPAL*, TST*, POS), trailing
// phone/location tokens, generic ".COM", and collapse whitespace.

const PREFIX_RE = /^(amzn\s*\*|sq\s*\*|paypal\s*\*|tst\s*\*|pos\s+|sp\s*\*)/i;
const PHONE_RE = /\s+\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/g;
const TOLLFREE_RE = /\s+\d{3}[-\s]?[A-Z]+(\b|$)/g; // 877-NEWPRIME
const STATE_SUFFIX_RE = /\s+[A-Z]{2}\s*$/;
const DOTCOM_RE = /\.com\b/i;
const SUFFIX_NOISE = /\b(plus|premium|membership|subscription|usa|inc|llc|com)\b/gi;
const DASH_AFTER_NAME = /\s+-\s+.*$/;

export function canonicalize(raw: string): string {
  let s = raw ?? "";
  s = s.replace(PREFIX_RE, "");
  s = s.replace(PHONE_RE, " ");
  s = s.replace(TOLLFREE_RE, " ");
  s = s.replace(DOTCOM_RE, " ");
  s = s.replace(DASH_AFTER_NAME, "");
  s = s.replace(STATE_SUFFIX_RE, "");
  s = s.replace(SUFFIX_NOISE, " ");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}
```

- [ ] **Step 4: Run tests, iterate until green**

Run: `pnpm test lib/statements/__tests__/canonicalize.test.ts`
Expected: 8/8 pass. If a case fails, narrow the regex — don't add an exception list yet, the regexes should be general.

- [ ] **Step 5: Commit and push**

```bash
git add lib/statements/canonicalize.ts lib/statements/__tests__/canonicalize.test.ts
git commit -m "feat(statements): merchant canonicalization with prefix/phone/suffix stripping"
git push origin main
```

---

## Task 3: CSV parser

**Files:**
- Create: `lib/statements/csv.ts`, `lib/statements/__tests__/csv.test.ts`, `lib/statements/__tests__/fixtures/chase.csv`, `lib/statements/__tests__/fixtures/amex.csv`

- [ ] **Step 1: Install papaparse**

Modify `package.json` deps: add `"papaparse": "^5"`. Run `pnpm install`.

- [ ] **Step 2: Create fixtures**

```csv
# lib/statements/__tests__/fixtures/chase.csv
Transaction Date,Post Date,Description,Category,Type,Amount,Memo
01/02/2026,01/02/2026,NETFLIX.COM 866-579-7172 CA,Entertainment,Sale,-24.99,
01/03/2026,01/03/2026,SPOTIFY USA  NEW YORK NY,Entertainment,Sale,-11.99,
01/04/2026,01/04/2026,STARBUCKS STORE 1234,Food,Sale,-5.25,
01/05/2026,01/05/2026,OPENAI*CHATGPT,Services,Sale,-0.01,
01/06/2026,01/06/2026,PAYMENT THANK YOU,Payment,Payment,250.00,
```

```csv
# lib/statements/__tests__/fixtures/amex.csv
Date,Description,Card Member,Account #,Amount
01/06/2026,NETFLIX.COM,JOHN DOE,12345,24.99
01/07/2026,SPOTIFY,JOHN DOE,12345,11.99
01/08/2026,UBER TRIP,JOHN DOE,12345,18.50
```

- [ ] **Step 3: Write failing tests**

```ts
// lib/statements/__tests__/csv.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/lib/statements/csv";

const load = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf-8");

describe("parseCsv", () => {
  it("parses Chase format (negative_is_debit, MM/DD/YYYY)", () => {
    const charges = parseCsv(load("chase.csv"), "chase.csv");
    // 4 debits, payment row is a credit and skipped
    expect(charges).toHaveLength(4);
    expect(charges[0].postedAt).toBe("2026-01-02");
    expect(charges[0].merchantRaw).toBe("NETFLIX.COM 866-579-7172 CA");
    expect(charges[0].amount).toBe(24.99);
    expect(charges[0].source).toBe("chase.csv");
  });

  it("parses Amex format (positive_is_debit, MM/DD/YYYY)", () => {
    const charges = parseCsv(load("amex.csv"), "amex.csv");
    expect(charges).toHaveLength(3);
    expect(charges[0].amount).toBe(24.99);
  });

  it("skips rows missing required fields", () => {
    const csv = "Date,Description,Amount\n01/01/2026,,-5.00\n01/02/2026,X,not-a-number";
    const charges = parseCsv(csv, "broken.csv");
    expect(charges).toHaveLength(0);
  });

  it("auto-detects sign convention from majority of rows", () => {
    // Three negatives → negative_is_debit; positive 250 is the payment (credit).
    const csv = "Date,Description,Amount\n01/01/2026,A,-5.00\n01/02/2026,B,-7.00\n01/03/2026,Payment,250.00";
    const charges = parseCsv(csv, "x.csv");
    expect(charges).toHaveLength(2);
    expect(charges.every((c) => c.amount > 0)).toBe(true);
  });
});
```

- [ ] **Step 4: Implement `csv.ts`**

```ts
// lib/statements/csv.ts
import Papa from "papaparse";
import type { ParsedCharge } from "./types";

const DATE_COL_RE = /^(transaction date|post date|date|posting date)$/i;
const AMOUNT_COL_RE = /^(amount|debit|charge)$/i;
const MERCHANT_COL_RE = /^(description|merchant|details|payee|memo)$/i;

function pickColumn(headers: string[], re: RegExp): string | null {
  const found = headers.find((h) => re.test(h.trim()));
  return found ?? null;
}

function parseDate(s: string): string | null {
  const trimmed = (s ?? "").trim();
  // MM/DD/YYYY
  let m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // YYYY-MM-DD
  m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // DD/MM/YYYY (treat any > 12 in second slot as DD/MM)
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && Number(m[2]) > 12) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseAmount(s: string): number | null {
  const cleaned = (s ?? "").toString().replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string, sourceName: string): ParsedCharge[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const dateCol = pickColumn(headers, DATE_COL_RE);
  const amountCol = pickColumn(headers, AMOUNT_COL_RE);
  const merchantCol = pickColumn(headers, MERCHANT_COL_RE);
  if (!dateCol || !amountCol || !merchantCol) return [];

  // Collect numeric amounts to infer the sign convention.
  const numericAmounts: number[] = [];
  for (const r of rows) {
    const n = parseAmount(r[amountCol]);
    if (n !== null && n !== 0) numericAmounts.push(n);
  }
  if (numericAmounts.length === 0) return [];
  const negatives = numericAmounts.filter((n) => n < 0).length;
  // If most rows are negative, negatives are debits.
  const negativeIsDebit = negatives >= numericAmounts.length / 2;

  const charges: ParsedCharge[] = [];
  for (const r of rows) {
    const amt = parseAmount(r[amountCol]);
    if (amt === null || amt === 0) continue;
    const isDebit = negativeIsDebit ? amt < 0 : amt > 0;
    if (!isDebit) continue;
    const absAmt = Math.abs(amt);
    const postedAt = parseDate(r[dateCol]);
    if (!postedAt) continue;
    const merchant = (r[merchantCol] ?? "").trim();
    if (!merchant) continue;
    charges.push({
      postedAt,
      merchantRaw: merchant,
      amount: Math.round(absAmt * 100) / 100,
      currency: "USD",
      source: sourceName,
    });
  }
  return charges;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test lib/statements/__tests__/csv.test.ts`
Expected: 4/4 pass.

- [ ] **Step 6: Commit and push**

```bash
git add package.json pnpm-lock.yaml lib/statements/csv.ts lib/statements/__tests__/
git commit -m "feat(statements): CSV parser with header auto-detect and sign inference"
git push origin main
```

---

## Task 4: PDF extraction via Backboard

**Files:**
- Create: `lib/statements/pdf.ts`, `lib/statements/__tests__/pdf.test.ts`

PDF text extraction is deterministic (`pdf-parse`); turning that text into structured charges is LLM-driven (Backboard, same client pattern as `lib/backboard.ts`). The Backboard call returns a JSON array of `{date, merchant, amount}`.

- [ ] **Step 1: Install pdf-parse**

Modify `package.json` deps: add `"pdf-parse": "^1.1"`. Add `"@types/pdf-parse": "^1.1"` to devDeps. Run `pnpm install`.

- [ ] **Step 2: Write failing tests**

We test the orchestration logic by injecting a fake LLM. We do NOT test `pdf-parse` itself (third-party).

```ts
// lib/statements/__tests__/pdf.test.ts
import { describe, it, expect } from "vitest";
import { extractFromPdfText } from "@/lib/statements/pdf";

describe("extractFromPdfText", () => {
  it("returns parsed charges from a successful LLM response", async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { date: "2026-05-01", merchant: "NETFLIX.COM", amount: 24.99 },
        { date: "2026-05-02", merchant: "SPOTIFY USA", amount: 11.99 },
      ]);
    const out = await extractFromPdfText("dummy pdf text", "stmt.pdf", fakeLlm);
    expect(out).toHaveLength(2);
    expect(out[0].postedAt).toBe("2026-05-01");
    expect(out[0].merchantRaw).toBe("NETFLIX.COM");
    expect(out[0].amount).toBe(24.99);
    expect(out[0].source).toBe("stmt.pdf");
  });

  it("returns [] when LLM output isn't JSON", async () => {
    const fakeLlm = async () => "not json";
    const out = await extractFromPdfText("x", "x.pdf", fakeLlm);
    expect(out).toEqual([]);
  });

  it("returns [] on empty pdf text", async () => {
    const called = { yes: false };
    const fakeLlm = async () => { called.yes = true; return "[]"; };
    const out = await extractFromPdfText("", "x.pdf", fakeLlm);
    expect(out).toEqual([]);
    expect(called.yes).toBe(false);
  });

  it("filters non-positive or non-finite amounts", async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { date: "2026-05-01", merchant: "A", amount: 0 },
        { date: "2026-05-01", merchant: "B", amount: -5 },
        { date: "2026-05-01", merchant: "C", amount: "NaN" },
        { date: "2026-05-01", merchant: "D", amount: 9.99 },
      ]);
    const out = await extractFromPdfText("x", "x.pdf", fakeLlm);
    expect(out.map((c) => c.merchantRaw)).toEqual(["D"]);
  });
});
```

- [ ] **Step 3: Implement `pdf.ts`**

```ts
// lib/statements/pdf.ts
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
```

- [ ] **Step 4: Run tests**

Run: `pnpm test lib/statements/__tests__/pdf.test.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Commit and push**

```bash
git add package.json pnpm-lock.yaml lib/statements/pdf.ts lib/statements/__tests__/pdf.test.ts
git commit -m "feat(statements): PDF text extraction + LLM-driven charge parsing"
git push origin main
```

---

## Task 5: Match parsed charges to subscriptions

**Files:**
- Create: `lib/statements/match.ts`, `lib/statements/__tests__/match.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/statements/__tests__/match.test.ts
import { describe, it, expect } from "vitest";
import { matchCharges } from "@/lib/statements/match";
import { SUBSCRIPTIONS } from "@/lib/data";

describe("matchCharges", () => {
  it("links a Netflix charge to the Netflix subscription", () => {
    const result = matchCharges(
      [
        { postedAt: "2026-05-01", merchantRaw: "NETFLIX.COM 866-579-7172 CA",
          amount: 24.99, currency: "USD", source: "chase.csv" },
      ],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toEqual([
      { subscriptionId: "netflix", merchantRaw: "NETFLIX.COM 866-579-7172 CA", amount: 24.99 },
    ]);
    expect(result.newSubs).toHaveLength(0);
  });

  it("accepts an amount within ±$2 tolerance", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "NETFLIX", amount: 26.99,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toHaveLength(1);
  });

  it("rejects when amount is far off", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "NETFLIX", amount: 199.00,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toHaveLength(0);
    expect(result.newSubs).toHaveLength(1);  // unmatched → derived
  });

  it("flags trial verify charges (still 'matched' but counted)", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "SPOTIFY", amount: 0.01,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.trialVerifyCount).toBe(1);
  });

  it("groups multiple charges of the same unknown merchant into one derived sub", () => {
    const charges = [
      { postedAt: "2026-04-01", merchantRaw: "OPENAI*CHATGPT", amount: 20.0, currency: "USD", source: "x.csv" },
      { postedAt: "2026-05-01", merchantRaw: "OPENAI*CHATGPT", amount: 20.0, currency: "USD", source: "x.csv" },
    ];
    const result = matchCharges(charges, SUBSCRIPTIONS);
    expect(result.newSubs).toHaveLength(1);
    expect(result.newSubs[0].sampleMerchantRaw).toBe("OPENAI*CHATGPT");
  });

  it("ignores tiny verify amounts when deciding to create a new sub", () => {
    // A lone $0.01 from an unknown merchant should NOT spawn a derived sub.
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "WEIRD MERCHANT", amount: 0.01,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.newSubs).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `match.ts`**

```ts
// lib/statements/match.ts
import type { ParsedCharge, MatchResult } from "./types";
import type { Subscription } from "@/lib/data";
import { canonicalize } from "./canonicalize";

const AMOUNT_TOLERANCE = 2.0;
const VERIFY_AMOUNTS = new Set([0.01, 1.0]);

const isVerifyAmount = (n: number) =>
  VERIFY_AMOUNTS.has(Math.round(n * 100) / 100);

function amountMatches(subAmount: number, chargeAmount: number): boolean {
  return Math.abs(subAmount - chargeAmount) <= AMOUNT_TOLERANCE;
}

function bestSubFor(
  canonicalMerchant: string,
  chargeAmount: number,
  subs: Subscription[],
): Subscription | null {
  for (const s of subs) {
    const subCanon = canonicalize(s.service);
    // Substring either way — "netflix" matches "netflix.com" and "amazon prime" matches "prime".
    if (subCanon.includes(canonicalMerchant) || canonicalMerchant.includes(subCanon)) {
      if (amountMatches(s.amount, chargeAmount)) return s;
    }
  }
  return null;
}

export function matchCharges(
  charges: ParsedCharge[],
  subs: Subscription[],
): MatchResult {
  const matched: MatchResult["matched"] = [];
  const ignored: MatchResult["ignored"] = [];
  const newGroups = new Map<string, { sample: string; latestAmount: number; count: number }>();
  let trialVerifyCount = 0;

  for (const c of charges) {
    if (isVerifyAmount(c.amount)) trialVerifyCount++;
    const canon = canonicalize(c.merchantRaw);
    const sub = bestSubFor(canon, c.amount, subs);
    if (sub) {
      matched.push({ subscriptionId: sub.id, merchantRaw: c.merchantRaw, amount: c.amount });
      continue;
    }
    // Unmatched. Only spawn derived sub if amount looks like a real charge.
    if (isVerifyAmount(c.amount)) {
      ignored.push({ merchantRaw: c.merchantRaw, amount: c.amount, reason: "verify_amount_only" });
      continue;
    }
    const existing = newGroups.get(canon);
    if (existing) {
      existing.count += 1;
      existing.latestAmount = c.amount;
    } else {
      newGroups.set(canon, { sample: c.merchantRaw, latestAmount: c.amount, count: 1 });
    }
  }

  const newSubs: MatchResult["newSubs"] = Array.from(newGroups.entries()).map(
    ([canon, g]) => ({
      id: canon.replace(/\s+/g, "-"),
      service: titleCase(g.sample),
      amount: g.latestAmount,
      sampleMerchantRaw: g.sample,
    }),
  );

  return { matched, newSubs, ignored, trialVerifyCount };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 3: Run tests, iterate**

Run: `pnpm test lib/statements/__tests__/match.test.ts`
Expected: 6/6 pass. Tweak canonicalization and amount-tolerance rules if the substring rule mis-fires; do NOT add merchant-specific code.

- [ ] **Step 4: Commit and push**

```bash
git add lib/statements/match.ts lib/statements/__tests__/match.test.ts
git commit -m "feat(statements): match parsed charges to subscriptions + derive new ones"
git push origin main
```

---

## Task 6: Unified extract entry point

**Files:**
- Create: `lib/statements/extract.ts`, `lib/statements/__tests__/extract.test.ts`

This is the seam the API route calls. It picks CSV vs PDF by file extension and the injected `Llm` handles PDF extraction.

- [ ] **Step 1: Write failing tests**

```ts
// lib/statements/__tests__/extract.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCharges } from "@/lib/statements/extract";

describe("extractCharges", () => {
  it("dispatches CSV files to the CSV parser", async () => {
    const buf = Buffer.from(
      readFileSync(join(__dirname, "fixtures", "chase.csv"), "utf-8"),
    );
    const out = await extractCharges({
      filename: "chase.csv",
      bytes: buf,
      llm: async () => "[]",
      pdfToText: async () => "",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].source).toBe("chase.csv");
  });

  it("dispatches PDF files through pdfToText + llm", async () => {
    let pdfCalled = false;
    let llmCalled = false;
    const out = await extractCharges({
      filename: "stmt.pdf",
      bytes: Buffer.from("fake"),
      llm: async () => {
        llmCalled = true;
        return JSON.stringify([
          { date: "2026-05-01", merchant: "NETFLIX.COM", amount: 24.99 },
        ]);
      },
      pdfToText: async () => {
        pdfCalled = true;
        return "fake pdf body";
      },
    });
    expect(pdfCalled).toBe(true);
    expect(llmCalled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("stmt.pdf");
  });

  it("returns [] for unsupported extensions", async () => {
    const out = await extractCharges({
      filename: "stmt.xlsx",
      bytes: Buffer.from(""),
      llm: async () => "[]",
      pdfToText: async () => "",
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `extract.ts`**

```ts
// lib/statements/extract.ts
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
```

- [ ] **Step 3: Run tests**

Run: `pnpm test lib/statements/__tests__/extract.test.ts`
Expected: 3/3 pass.

- [ ] **Step 4: Commit and push**

```bash
git add lib/statements/extract.ts lib/statements/__tests__/extract.test.ts
git commit -m "feat(statements): unified extract entry dispatching CSV/PDF"
git push origin main
```

---

## Task 7: Upload API route (multipart, bulk)

**Files:**
- Create: `app/api/statements/upload/route.ts`, `app/api/subscriptions/route.ts`

The route accepts multipart/form-data with one or more files, extracts charges from each, matches, updates the store, and returns a per-file summary.

- [ ] **Step 1: Implement `/api/statements/upload/route.ts`**

```ts
// app/api/statements/upload/route.ts
import { NextResponse } from "next/server";
import { extractCharges } from "@/lib/statements/extract";
import { matchCharges } from "@/lib/statements/match";
import { recordMatch, recordNewSub } from "@/lib/statements/store";
import { pdfBufferToText } from "@/lib/statements/pdf";
import { SUBSCRIPTIONS } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BACKBOARD_BASE = process.env.BACKBOARD_BASE_URL ?? "https://api.backboard.io";
const BACKBOARD_MODEL = process.env.BACKBOARD_MODEL ?? "gpt-4o-mini";

async function backboardExtract(prompt: string): Promise<string> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return "[]";
  const base = BACKBOARD_BASE.replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BACKBOARD_MODEL,
      messages: [
        { role: "system", content: "You extract transactions from bank statements as strict JSON arrays." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return "[]";
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "[]";
}

type PerFileSummary = {
  filename: string;
  parsedCount: number;
  matched: number;
  newSubs: number;
  trialVerify: number;
  error?: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  const summaries: PerFileSummary[] = [];
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const charges = await extractCharges({
        filename: file.name,
        bytes,
        llm: backboardExtract,
        pdfToText: pdfBufferToText,
      });
      const match = matchCharges(charges, SUBSCRIPTIONS);
      // Apply to store.
      for (const m of match.matched) {
        const sourceCharge = charges.find(
          (c) => c.merchantRaw === m.merchantRaw && c.amount === m.amount,
        );
        if (!sourceCharge) continue;
        recordMatch(m.subscriptionId, {
          date: sourceCharge.postedAt,
          amount: sourceCharge.amount,
          source: file.name,
        });
      }
      for (const n of match.newSubs) {
        recordNewSub({
          id: n.id,
          service: n.service,
          amount: n.amount,
          frequency: "monthly",
          brandColor: "#7c7c7c",
          accentText: "#a0a0a0",
          note: `Detected from ${file.name}`,
          detectedFromStatement: true,
          lastCharge: {
            date: charges.find((c) => c.merchantRaw === n.sampleMerchantRaw)?.postedAt ?? "",
            amount: n.amount,
            source: file.name,
          },
        });
      }
      summaries.push({
        filename: file.name,
        parsedCount: charges.length,
        matched: match.matched.length,
        newSubs: match.newSubs.length,
        trialVerify: match.trialVerifyCount,
      });
    } catch (e) {
      summaries.push({
        filename: file.name,
        parsedCount: 0,
        matched: 0,
        newSubs: 0,
        trialVerify: 0,
        error: e instanceof Error ? e.message : "unknown_error",
      });
    }
  }

  return NextResponse.json({ files: summaries });
}
```

- [ ] **Step 2: Implement `/api/subscriptions/route.ts`**

```ts
// app/api/subscriptions/route.ts
import { NextResponse } from "next/server";
import { augmentedSubscriptions } from "@/lib/statements/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ subscriptions: augmentedSubscriptions() });
}
```

- [ ] **Step 3: Smoke test the route manually**

Run `pnpm dev` in one terminal, then in another:

```bash
echo "Date,Description,Amount
01/02/2026,NETFLIX.COM,-24.99
01/03/2026,SPOTIFY,-11.99" > /tmp/smoke.csv

curl -sX POST http://localhost:3000/api/statements/upload \
  -F "files=@/tmp/smoke.csv"
```

Expected: JSON like `{"files":[{"filename":"smoke.csv","parsedCount":2,"matched":2,"newSubs":0,"trialVerify":0}]}`.

Then:

```bash
curl -s http://localhost:3000/api/subscriptions | jq '.subscriptions[] | select(.lastCharge)'
```

Expected: Netflix and Spotify entries with `lastCharge` populated.

- [ ] **Step 4: Commit and push**

```bash
git add app/api/statements/upload/route.ts app/api/subscriptions/route.ts
git commit -m "feat(api): /api/statements/upload (bulk multipart) + /api/subscriptions"
git push origin main
```

---

## Task 8: Upload modal component

**Files:**
- Create: `components/UploadModal.tsx`

- [ ] **Step 1: Implement `UploadModal.tsx`**

```tsx
// components/UploadModal.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";

type FileSummary = {
  filename: string;
  parsedCount: number;
  matched: number;
  newSubs: number;
  trialVerify: number;
  error?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function UploadModal({ open, onClose, onSuccess }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [summaries, setSummaries] = useState<FileSummary[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFiles([]);
    setSummaries(null);
    setBusy(false);
  };

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const accepted = Array.from(incoming).filter((f) =>
      /\.(csv|pdf)$/i.test(f.name),
    );
    setFiles((cur) => [...cur, ...accepted]);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    try {
      const res = await fetch("/api/statements/upload", { method: "POST", body: fd });
      const json = await res.json();
      setSummaries(json.files ?? []);
      onSuccess();
    } catch {
      setSummaries([{
        filename: "(upload)", parsedCount: 0, matched: 0, newSubs: 0,
        trialVerify: 0, error: "request_failed",
      }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="upload-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl px-6"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="relative w-full max-w-xl bg-[#0d0d0d] border border-[#262626] rounded-2xl p-8"
          >
            <div className="eyebrow mb-2 text-[#F38B00]">◍ upload statement</div>
            <h2 className="display text-[28px] leading-tight mb-1">
              Drop CSV or PDF statements
            </h2>
            <p className="text-[13px] text-[#8a8a8a] mb-6">
              Multiple files supported. CSV parses instantly. PDF runs through the agent.
            </p>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className="border border-dashed border-[#3a3a3a] hover:border-[#F38B00] transition-colors rounded-xl p-8 text-center cursor-pointer"
            >
              <div className="mono text-[12px] text-[#8a8a8a]">
                drop files here · or click to browse
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".csv,.pdf,application/pdf,text/csv"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-4 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="text-[12px] text-[#ededed] mono flex justify-between">
                    <span>{f.name}</span>
                    <span className="text-[#555]">{(f.size / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            )}

            {summaries && (
              <div className="mt-6 space-y-2">
                {summaries.map((s) => (
                  <div key={s.filename} className="text-[12px] flex justify-between mono">
                    <span className="text-[#ededed]">{s.filename}</span>
                    <span className={s.error ? "text-[#ff4d4d]" : "text-[#10b981]"}>
                      {s.error
                        ? `error: ${s.error}`
                        : `${s.parsedCount} charges · matched ${s.matched} · new ${s.newSubs}${s.trialVerify ? ` · ${s.trialVerify} trial verify` : ""}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-8">
              <button
                onClick={() => { reset(); onClose(); }}
                className="text-[12px] text-[#8a8a8a] hover:text-[#ededed] uppercase tracking-widest"
              >
                {summaries ? "done" : "cancel"}
              </button>
              {!summaries && (
                <Button
                  variant="primary"
                  size="md"
                  onClick={submit}
                  disabled={busy || files.length === 0}
                >
                  {busy ? "Uploading…" : `Upload ${files.length || ""}`.trim()}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit and push**

```bash
git add components/UploadModal.tsx
git commit -m "feat(ui): UploadModal with drag-drop, bulk files, per-file results"
git push origin main
```

---

## Task 9: Wire the dashboard page (`app/page.tsx`)

**Files:**
- Replace: `app/page.tsx`

This task does two things at once because they're inseparable: render the existing components, and add the upload-statement button. We keep the auction → card → voice flow that Arav built; we just give it a page to live on.

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
// app/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { SUBSCRIPTIONS, type Subscription, YEARLY_AT_STAKE, CRAVE_REPLACEMENT } from "@/lib/data";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { AuctionModal } from "@/components/AuctionModal";
import { VirtualCardReveal } from "@/components/VirtualCardReveal";
import { UploadModal } from "@/components/UploadModal";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/Button";

type DashboardState = {
  subscriptions: Subscription[];
  cancelled: Set<string>;
  replaced: Map<string, Subscription>;
};

export default function Home() {
  const [subs, setSubs] = useState<Subscription[]>(SUBSCRIPTIONS);
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());
  const [replaced, setReplaced] = useState<Map<string, Subscription>>(new Map());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [auctionOpen, setAuctionOpen] = useState(false);
  const [cardRevealOpen, setCardRevealOpen] = useState(false);
  const [activeCancel, setActiveCancel] = useState<{ merchant: string; limit: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/subscriptions", { cache: "no-store" });
      const json = await res.json();
      if (Array.isArray(json.subscriptions)) setSubs(json.subscriptions);
    } catch {
      // fall back to seed list silently
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onCancel = (sub: Subscription) => {
    if (sub.id === "netflix") {
      setAuctionOpen(true);
      return;
    }
    void runCancel(sub);
  };

  const runCancel = async (sub: Subscription, switchTo?: string) => {
    setCancelled((s) => new Set(s).add(sub.id));
    try {
      const res = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: sub.service,
          switchTo,
          cardLimit: Math.max(5, Math.ceil(sub.amount)),
        }),
      });
      const json = await res.json();
      if (switchTo === "Crave") {
        setReplaced((m) => new Map(m).set(sub.id, { ...CRAVE_REPLACEMENT, id: sub.id }));
      }
      setActiveCancel({
        merchant: switchTo ?? sub.service,
        limit: json.cardLimit ?? Math.max(5, Math.ceil(sub.amount)),
      });
      setCardRevealOpen(true);
    } catch {
      // demo-grade: ignore but un-cancel optimistic state would be nicer
    }
  };

  const onAuctionAccept = async (bidId: string) => {
    setAuctionOpen(false);
    const netflix = subs.find((s) => s.id === "netflix");
    if (!netflix) return;
    const switchTo = bidId === "crave" ? "Crave" : bidId === "tubi" ? "Tubi" : "Apple TV+";
    await runCancel(netflix, switchTo);
  };

  const onAuctionSkip = async () => {
    setAuctionOpen(false);
    const netflix = subs.find((s) => s.id === "netflix");
    if (netflix) await runCancel(netflix);
  };

  const totalAnnualAtStake = subs.reduce(
    (sum, s) => sum + s.amount * (s.frequency === "monthly" ? 12 : 1),
    0,
  );

  return (
    <div className="min-h-screen bg-black text-[#ededed]">
      <header className="border-b border-[#1a1a1a] px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark id="switchback" size={28} />
          <div className="font-semibold text-[15px] tracking-tight">Switchback</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
          Upload statement
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        <section className="mb-12">
          <div className="eyebrow text-[#F38B00] mb-3">◍ subscriptions at stake</div>
          <h1 className="display text-[44px] md:text-[56px] leading-[0.95] mb-4">
            <AnimatedCounter value={totalAnnualAtStake} prefix="$" />{" "}
            <span className="text-[#8a8a8a] text-[28px]">/yr</span>
          </h1>
          <p className="text-[#8a8a8a] text-[15px] max-w-xl">
            Every card a switch waiting to happen. Upload a statement to surface
            the ones you forgot about.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {subs.map((sub) => {
            const replacement = replaced.get(sub.id);
            const display = replacement ?? sub;
            const state: "active" | "cancelled" | "replaced" =
              replacement ? "replaced" : cancelled.has(sub.id) ? "cancelled" : "active";
            return (
              <SubscriptionCard
                key={sub.id}
                sub={display}
                state={state}
                onCancel={() => onCancel(sub)}
              />
            );
          })}
        </section>
      </main>

      <AuctionModal open={auctionOpen} onAccept={onAuctionAccept} onSkip={onAuctionSkip} />
      <VirtualCardReveal
        open={cardRevealOpen}
        merchant={activeCancel?.merchant ?? ""}
        limit={activeCancel?.limit ?? 0}
        onClose={() => setCardRevealOpen(false)}
      />
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => { void refresh(); }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Smoke test in browser**

Run `pnpm dev`, open http://localhost:3000. Confirm:
- 6 subscription cards render, header shows total annual at-stake.
- "Upload statement" button opens the modal; drop a CSV → see summary → cards update with badges (the badges themselves we add in Task 10).
- Clicking Cancel on Netflix opens auction; accepting Crave triggers card reveal.

- [ ] **Step 3: Commit and push**

```bash
git add app/page.tsx
git commit -m "feat(ui): wire Switchback dashboard — cards, auction, card-reveal, upload"
git push origin main
```

---

## Task 10: Statement-detected badges on `SubscriptionCard`

**Files:**
- Modify: `components/SubscriptionCard.tsx`

We surface `lastCharge`, `detectedFromStatement`, and `isTrialVerify` as small pills under the merchant name. Subtle — the design is already dense.

- [ ] **Step 1: Add badge rendering**

In `components/SubscriptionCard.tsx`, inside the merchant info block (after the `<h3>` line), add:

```tsx
{sub.detectedFromStatement && (
  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#F38B00] border border-[#3a2200] bg-[#1a0f00] px-1.5 py-0.5 rounded">
    Statement
  </span>
)}
{sub.isTrialVerify && (
  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#FFD166] border border-[#3a3320] bg-[#1a1500] px-1.5 py-0.5 rounded">
    Trial verify
  </span>
)}
```

And in the "card · •• xxxx" footer area, add (only when `sub.lastCharge` is set):

```tsx
{sub.lastCharge && (
  <span className="mono text-[10px] text-[#555]">
    · last ${sub.lastCharge.amount.toFixed(2)} on {sub.lastCharge.date}
  </span>
)}
```

- [ ] **Step 2: Smoke test**

Upload `chase.csv` from the fixtures via the modal. Confirm Netflix and Spotify cards now show "last $X on YYYY-MM-DD" and the $0.01 OpenAI entry comes back as a derived card with both "Statement" and "Trial verify" badges.

- [ ] **Step 3: Commit and push**

```bash
git add components/SubscriptionCard.tsx
git commit -m "feat(ui): statement-detected and trial-verify badges on subscription cards"
git push origin main
```

---

## Task 11: End-to-end dogfood + demo prep

No automated tests — manual.

- [ ] **Step 1: Final test run**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Lint clean**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Real-statement smoke**

Use one of your team's actual exported CSVs (last 90 days). Upload through the modal. Expected:
- Known subs (Netflix, Spotify, etc. if present) light up with `lastCharge` + green Statement badge.
- Unknown recurring merchants appear as new derived cards.
- Tiny ($0.01 or $1.00) charges show "Trial verify" badge.

- [ ] **Step 4: PDF smoke**

If you have a Backboard API key set, upload an actual PDF statement. Confirm:
- Parse takes 10-30s (LLM round-trip).
- Modal shows the per-file summary.
- At least one charge gets extracted; check the JSON `/api/subscriptions` to verify.

- [ ] **Step 5: Demo flow rehearsal**

The 90-second demo loop:
1. Land on dashboard, total annual at-stake counter ticks up.
2. Click "Upload statement", drag in 2 files (one CSV, one PDF). Show parsing summary.
3. Dashboard updates with badges + new derived subs.
4. Click Cancel on Netflix → auction → accept Crave → virtual card reveal with Aria voice.
5. Cumulative savings counter increments in the header.

- [ ] **Step 6: File issues for any regressions**

Anything mis-canonicalized, mis-matched, mis-detected — file an issue with the merchant string + expected behavior. Becomes input for post-hackathon iteration.

---

## Self-review

- **Spec coverage:** Plan focuses solely on statement ingestion + dashboard wiring as agreed. Bulk upload (Q from user) is supported via `multiple` on the file input and a loop in the API route. PDF is in (per the "real banks use PDFs" decision). Auto-detect columns (no per-bank wizard) per the "simpler than the original Plan 3" decision.
- **Placeholders:** None in code blocks. Step bodies are complete.
- **Type consistency:** `LastCharge` exported from `lib/data.ts` and reused by `store.ts`. `ParsedCharge`, `MatchResult` defined once in `lib/statements/types.ts`. `Llm` is the only injected callable, defined in `pdf.ts` and re-used in `extract.ts`.
- **Out of scope (explicit):** No Gmail, no DB, no per-bank mapping wizard, no PDF OCR for scanned PDFs, no cadence inference, no statement file storage.
- **Trade-offs flagged:** In-memory persistence means a Vercel cold start clears state — acceptable for demo, not for prod. Backboard PDF extraction is slow (10-30s) and occasionally hallucinates; the demo's safer path is CSV.
