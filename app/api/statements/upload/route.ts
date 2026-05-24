import { NextResponse } from "next/server";
import { extractCharges } from "@/lib/statements/extract";
import { matchCharges } from "@/lib/statements/match";
import { recordMatch, recordNewSub, augmentedSubscriptions } from "@/lib/statements/store";
import { pdfBufferToText } from "@/lib/statements/pdf";
import type { ParsedCharge } from "@/lib/statements/types";
import type { Subscription } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BACKBOARD_BASE = (
  process.env.BACKBOARD_BASE_URL ?? "https://api.backboard.io"
).replace(/\/+$/, "");
const BACKBOARD_MODEL = process.env.BACKBOARD_MODEL ?? "gpt-4o-mini";

type ChatChoice = { message?: { content?: string | null } };
type ChatResponse = { choices?: ChatChoice[] };

async function backboardExtract(prompt: string): Promise<string> {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) return "[]";

  const payload = {
    model: BACKBOARD_MODEL,
    messages: [
      { role: "system", content: "You are a precise data extraction assistant." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 2048,
  };

  try {
    const res = await fetch(`${BACKBOARD_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-API-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      console.error("[statements/upload] backboard_non_ok", res.status);
      return "[]";
    }

    const json = (await res.json()) as ChatResponse;
    const text = json.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : "[]";
  } catch (err) {
    console.error("[statements/upload] backboard_failure", err);
    return "[]";
  }
}

type PerFileSummary = {
  filename: string;
  parsedCount: number;
  matched: number;
  newSubs: number;
  trialVerify: number;
  error?: string;
};

function findCharge(
  charges: ParsedCharge[],
  merchantRaw: string,
  amount: number,
): ParsedCharge | undefined {
  return charges.find(
    (c) => c.merchantRaw === merchantRaw && c.amount === amount,
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const fileEntries = formData.getAll("files");
  if (fileEntries.length === 0) {
    return NextResponse.json({ error: "no_files" }, { status: 400 });
  }

  const summaries: PerFileSummary[] = [];

  for (const entry of fileEntries) {
    if (!(entry instanceof File)) {
      summaries.push({
        filename: "(unknown)",
        parsedCount: 0,
        matched: 0,
        newSubs: 0,
        trialVerify: 0,
        error: "not_a_file",
      });
      continue;
    }

    const filename = entry.name;
    try {
      const bytes = Buffer.from(await entry.arrayBuffer());

      const charges = await extractCharges({
        filename,
        bytes,
        llm: backboardExtract,
        pdfToText: pdfBufferToText,
      });

      const subs = augmentedSubscriptions();
      const matchResult = matchCharges(charges, subs);

      for (const m of matchResult.matched) {
        const source = findCharge(charges, m.merchantRaw, m.amount);
        recordMatch(m.subscriptionId, {
          date: source?.postedAt ?? new Date().toISOString().slice(0, 10),
          amount: m.amount,
          source: filename,
        });
      }

      for (const ns of matchResult.newSubs) {
        const source = findCharge(charges, ns.sampleMerchantRaw, ns.amount);
        const newSub: Subscription = {
          id: ns.id,
          service: ns.service,
          amount: ns.amount,
          frequency: "monthly",
          brandColor: "#7c7c7c",
          accentText: "#a0a0a0",
          note: `Detected from ${filename}`,
          detectedFromStatement: true,
          lastCharge: {
            date: source?.postedAt ?? new Date().toISOString().slice(0, 10),
            amount: ns.amount,
            source: filename,
          },
        };
        recordNewSub(newSub);
      }

      summaries.push({
        filename,
        parsedCount: charges.length,
        matched: matchResult.matched.length,
        newSubs: matchResult.newSubs.length,
        trialVerify: matchResult.trialVerifyCount,
      });
    } catch (err) {
      summaries.push({
        filename,
        parsedCount: 0,
        matched: 0,
        newSubs: 0,
        trialVerify: 0,
        error: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }

  return NextResponse.json({ files: summaries });
}
