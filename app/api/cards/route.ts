import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getOrCreateCardholder, getStripe } from "@/lib/stripe";
import { addWalletCard } from "@/lib/wallet-state";

// Avoid caching — every request mints a fresh card.
export const dynamic = "force-dynamic";

type CardBody = {
  merchant?: unknown;
  limit?: unknown;
};

type CardResponse = {
  cardNumber: string;
  last4: string;
  expMonth: number;
  expYear: number;
  brand: string;
  cardId: string;
  mock?: boolean;
};

const MOCK_CARD: CardResponse = {
  cardNumber: "4242 4242 4242 4242",
  last4: "4242",
  expMonth: 12,
  expYear: 2027,
  brand: "Visa",
  cardId: "ic_mock",
  mock: true,
};

function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request): Promise<NextResponse> {
  // Parse + validate input — never trust the client.
  let body: CardBody;
  try {
    body = (await req.json()) as CardBody;
  } catch {
    return badRequest("invalid_json");
  }

  const merchant =
    typeof body.merchant === "string" ? body.merchant.trim() : "";
  const limit =
    typeof body.limit === "number" ? body.limit : Number(body.limit);

  if (!merchant) return badRequest("merchant_required");
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10000) {
    return badRequest("limit_invalid");
  }

  const stripe = getStripe();
  if (!stripe) {
    // Demo-mode fallback so the frontend keeps working without a real key.
    // Still persist to the wallet so the dashboard "My BlackMamba Cards"
    // section populates even in mock mode.
    addWalletCard({
      cardId: `${MOCK_CARD.cardId}_${Date.now()}`,
      merchant,
      last4: MOCK_CARD.last4,
      brand: MOCK_CARD.brand,
      expMonth: MOCK_CARD.expMonth,
      expYear: MOCK_CARD.expYear,
      monthlyCapCents: Math.round(limit * 100),
      mock: true,
    });
    return NextResponse.json(MOCK_CARD);
  }

  try {
    const cardholderId = await getOrCreateCardholder();

    const created = await stripe.issuing.cards.create({
      cardholder: cardholderId,
      currency: "cad",
      type: "virtual",
      status: "active",
      spending_controls: {
        spending_limits: [
          {
            amount: Math.round(limit * 100), // cents
            interval: "monthly",
          },
        ],
      },
      metadata: { merchant, source: "switchback" },
    });

    // Re-fetch with expanded number + cvc — only works in test mode without
    // additional PCI scope, which is exactly what we want for the demo.
    const full = await stripe.issuing.cards.retrieve(created.id, {
      expand: ["number", "cvc"],
    });

    const raw =
      (full as Stripe.Issuing.Card & { number?: string }).number ?? "";
    const formatted = raw
      ? raw.replace(/(.{4})/g, "$1 ").trim()
      : `**** **** **** ${full.last4}`;

    const response: CardResponse = {
      cardNumber: formatted,
      last4: full.last4,
      expMonth: full.exp_month,
      expYear: full.exp_year,
      brand: (full.brand ?? "Visa").replace(/^\w/, (c) => c.toUpperCase()),
      cardId: full.id,
    };

    addWalletCard({
      cardId: full.id,
      merchant,
      last4: full.last4,
      brand: response.brand,
      expMonth: full.exp_month,
      expYear: full.exp_year,
      monthlyCapCents: Math.round(limit * 100),
      mock: false,
    });

    return NextResponse.json(response);
  } catch (err) {
    // Log full context server-side; return generic error to client.
    console.error("[cards] stripe_failure", err);
    // Fall back to mock so the demo never visibly breaks on stage.
    // Still persist a wallet row so the dashboard renders something.
    addWalletCard({
      cardId: `${MOCK_CARD.cardId}_fallback_${Date.now()}`,
      merchant,
      last4: MOCK_CARD.last4,
      brand: MOCK_CARD.brand,
      expMonth: MOCK_CARD.expMonth,
      expYear: MOCK_CARD.expYear,
      monthlyCapCents: Math.round(limit * 100),
      mock: true,
    });
    return NextResponse.json({ ...MOCK_CARD, fallback: true });
  }
}
