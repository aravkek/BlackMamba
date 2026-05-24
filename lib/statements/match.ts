// lib/statements/match.ts
import type { ParsedCharge, MatchResult } from "./types";
import type { Subscription } from "@/lib/data";
import { canonicalize } from "./canonicalize";

const AMOUNT_TOLERANCE = 2.0;
const VERIFY_AMOUNTS = new Set([0.01, 1.0]);

const isVerifyAmount = (n: number): boolean =>
  VERIFY_AMOUNTS.has(Math.round(n * 100) / 100);

function amountMatches(subAmount: number, chargeAmount: number): boolean {
  return Math.abs(subAmount - chargeAmount) <= AMOUNT_TOLERANCE;
}

function bestSubFor(
  canonicalMerchant: string,
  chargeAmount: number,
  subs: Subscription[],
): Subscription | null {
  const isVerify = isVerifyAmount(chargeAmount);
  for (const s of subs) {
    const subCanon = canonicalize(s.service);
    // Substring match either way — "netflix" matches "netflix" (service in charge)
    // and "disney+" contains "disney" (charge in service).
    if (subCanon.includes(canonicalMerchant) || canonicalMerchant.includes(subCanon)) {
      if (isVerify) return s;
      if (amountMatches(s.amount, chargeAmount)) return s;
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function matchCharges(
  charges: ParsedCharge[],
  subs: Subscription[],
): MatchResult {
  const matched: MatchResult["matched"] = [];
  const ignored: MatchResult["ignored"] = [];
  const newGroups = new Map<string, { sample: string; latestAmount: number }>();
  let trialVerifyCount = 0;

  for (const c of charges) {
    if (isVerifyAmount(c.amount)) trialVerifyCount++;

    const canon = canonicalize(c.merchantRaw);
    const sub = bestSubFor(canon, c.amount, subs);

    if (sub) {
      matched.push({ subscriptionId: sub.id, merchantRaw: c.merchantRaw, amount: c.amount });
      continue;
    }

    // Unmatched. Do not spawn a derived sub for verify-only amounts.
    if (isVerifyAmount(c.amount)) {
      ignored.push({ merchantRaw: c.merchantRaw, amount: c.amount, reason: "verify_amount_only" });
      continue;
    }

    // Group by canonical name; latest write wins for the amount.
    const existing = newGroups.get(canon);
    if (existing) {
      existing.latestAmount = c.amount;
    } else {
      newGroups.set(canon, { sample: c.merchantRaw, latestAmount: c.amount });
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
