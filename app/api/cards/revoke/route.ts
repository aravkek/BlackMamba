import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { revokeWalletCard } from "@/lib/wallet-state";

export const dynamic = "force-dynamic";

type RevokeBody = { cardId?: unknown; merchant?: unknown };

type RevokeResponse = {
  success: boolean;
  cardId: string;
  stripe: "canceled" | "mock" | "error";
  message: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: RevokeBody;
  try {
    body = (await req.json()) as RevokeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  if (!cardId) {
    return NextResponse.json({ error: "cardId_required" }, { status: 400 });
  }

  // Mock-card cardIds start with "ic_mock" — short-circuit to local-only revoke.
  if (cardId.startsWith("ic_mock")) {
    revokeWalletCard(cardId);
    const resp: RevokeResponse = {
      success: true,
      cardId,
      stripe: "mock",
      message: "Mock card revoked (local state only — no Stripe call).",
    };
    return NextResponse.json(resp);
  }

  const stripe = getStripe();
  if (!stripe) {
    // Stripe not configured: still update local state so the UI reflects intent.
    revokeWalletCard(cardId);
    const resp: RevokeResponse = {
      success: true,
      cardId,
      stripe: "mock",
      message: "Stripe not configured. Local wallet shows revoked.",
    };
    return NextResponse.json(resp);
  }

  try {
    // Real Stripe Issuing cancellation — irreversible. Merchant attempts to
    // charge get declined permanently after this call.
    const updated = await stripe.issuing.cards.update(cardId, {
      status: "canceled",
    });
    revokeWalletCard(cardId);
    const resp: RevokeResponse = {
      success: true,
      cardId: updated.id,
      stripe: "canceled",
      message: `Card ${updated.last4} canceled at Stripe. Merchant declines on next charge.`,
    };
    return NextResponse.json(resp);
  } catch (err) {
    console.error("[cards/revoke] stripe_failure", err);
    // Best-effort local update so UI doesn't get stuck.
    revokeWalletCard(cardId);
    const resp: RevokeResponse = {
      success: false,
      cardId,
      stripe: "error",
      message: err instanceof Error ? err.message : "Unknown Stripe error",
    };
    return NextResponse.json(resp, { status: 502 });
  }
}
