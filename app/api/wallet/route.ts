import { NextResponse } from "next/server";
import { listWalletCards } from "@/lib/wallet-state";

// Process-local read of every BlackMamba-issued card. The dashboard polls
// this after each successful cancel to refresh the wallet section.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ cards: listWalletCards() });
}
