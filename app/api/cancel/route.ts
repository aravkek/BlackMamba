import { NextResponse } from "next/server";
import { SUBSCRIPTIONS, type Subscription } from "@/lib/data";
import {
  fallbackSwitchMessage,
  generateSwitchMessage,
  type SwitchPlan,
} from "@/lib/backboard";
import { addAnnualSavings, getAnnualSavings } from "@/lib/savings-state";

export const dynamic = "force-dynamic";

type CancelBody = {
  service?: unknown;
  switchTo?: unknown;
  cardLimit?: unknown;
};

type CancelResponse = {
  success: true;
  service: string;
  switchTo?: string;
  monthlySavings: number;
  annualSavings: number;
  cumulativeAnnualSavings: number;
  cardLimit: number;
  message: string;
};

function findSub(name: string): Subscription | undefined {
  const needle = name.toLowerCase();
  return SUBSCRIPTIONS.find((s) => s.service.toLowerCase() === needle);
}

function monthlyOf(sub: Subscription): number {
  return sub.frequency === "yearly" ? sub.amount / 12 : sub.amount;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: CancelBody;
  try {
    body = (await req.json()) as CancelBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const service = typeof body.service === "string" ? body.service.trim() : "";
  if (!service) {
    return NextResponse.json({ error: "service_required" }, { status: 400 });
  }

  const sub = findSub(service);
  if (!sub) {
    return NextResponse.json({ error: "unknown_service" }, { status: 404 });
  }

  const switchTo =
    typeof body.switchTo === "string" && body.switchTo.trim().length > 0
      ? body.switchTo.trim()
      : undefined;

  const rawLimit =
    typeof body.cardLimit === "number"
      ? body.cardLimit
      : Number(body.cardLimit);
  const cardLimit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 1000)
      : Math.max(5, Math.ceil(monthlyOf(sub)));

  const monthlySavings = monthlyOf(sub);
  const annualSavings = monthlySavings * 12;
  const cumulative = addAnnualSavings(annualSavings);

  const plan: SwitchPlan = {
    service: sub.service,
    switchTo,
    monthlySavings,
    annualSavings,
    cardLimit,
  };

  const agentMessage = await generateSwitchMessage(plan);
  const message = agentMessage ?? fallbackSwitchMessage(plan);

  const response: CancelResponse = {
    success: true,
    service: sub.service,
    switchTo,
    monthlySavings: Number(monthlySavings.toFixed(2)),
    annualSavings: Number(annualSavings.toFixed(2)),
    cumulativeAnnualSavings: Number(getAnnualSavings().toFixed(2)),
    cardLimit,
    message,
  };

  return NextResponse.json(response);
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    cumulativeAnnualSavings: Number(getAnnualSavings().toFixed(2)),
  });
}
