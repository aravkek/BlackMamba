import { NextResponse } from "next/server";
import {
  findSubscriptionIdByService,
  markCancelled,
} from "@/lib/statements/store";

// Called by the LiveCancelPanel once the agent reaches success status.
// Idempotent: re-calling for the same merchant is a no-op (Set semantics).

export const dynamic = "force-dynamic";

type Body = { merchant?: unknown };

export async function POST(req: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const merchant =
    typeof body.merchant === "string" ? body.merchant.trim() : "";
  if (!merchant) {
    return NextResponse.json({ error: "merchant_required" }, { status: 400 });
  }

  const id = findSubscriptionIdByService(merchant);
  if (!id) {
    return NextResponse.json(
      { error: "subscription_not_found", merchant },
      { status: 404 },
    );
  }

  markCancelled(id);
  return NextResponse.json({ ok: true, id, merchant });
}
