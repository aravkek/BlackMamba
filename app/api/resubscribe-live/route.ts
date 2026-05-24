import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://localhost:8001";

type Body = {
  merchant?: unknown;
  cardNumber?: unknown;
  cvc?: unknown;
  expMonth?: unknown;
  expYear?: unknown;
  cardholderName?: unknown;
  url?: unknown;
  headless?: unknown;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const merchant =
    typeof body.merchant === "string" ? body.merchant.trim() : "";
  const rawCard =
    typeof body.cardNumber === "string" ? body.cardNumber : "";
  const cardNumber = rawCard.replace(/\s+/g, "");
  const cvc = typeof body.cvc === "string" ? body.cvc : "";
  const expMonth =
    typeof body.expMonth === "number" ? body.expMonth : Number(body.expMonth);
  const expYear =
    typeof body.expYear === "number" ? body.expYear : Number(body.expYear);
  const cardholderName =
    typeof body.cardholderName === "string" && body.cardholderName.trim()
      ? body.cardholderName.trim()
      : "Aarya Prakash";

  if (
    !merchant ||
    cardNumber.length < 12 ||
    !cvc ||
    !Number.isFinite(expMonth) ||
    !Number.isFinite(expYear)
  ) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${AGENT_BASE_URL}/resubscribe/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant,
        card_number: cardNumber,
        cvc,
        exp_month: expMonth,
        exp_year: expYear,
        cardholder_name: cardholderName,
        url: typeof body.url === "string" ? body.url : undefined,
        headless:
          typeof body.headless === "boolean" ? body.headless : false,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[resubscribe-live] start_failed",
        upstream.status,
        detail.slice(0, 200),
      );
      return NextResponse.json(
        { error: `agent_${upstream.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json(await upstream.json());
  } catch (err) {
    console.error("[resubscribe-live] start_fetch_failure", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agent_unreachable" },
      { status: 502 },
    );
  }
}
