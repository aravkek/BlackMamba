import { NextResponse } from "next/server";
import { augmentedSubscriptions } from "@/lib/statements/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ subscriptions: augmentedSubscriptions() });
}
