// Process-local subscription augmentations + derived subs. Mirrors
// savings-state.ts: resets on server restart, fine for the demo.
import { SUBSCRIPTIONS, type Subscription, type LastCharge } from "@/lib/data";
import type { Augmentation } from "./types";

const VERIFY_AMOUNTS = new Set([0.01, 1.0]);

const _aug = new Map<string, Augmentation>();         // id → augmentation
const _new = new Map<string, Subscription>();          // id → derived sub

/** Wipe all augmentations and derived subscriptions. */
export function resetAugmentations(): void {
  _aug.clear();
  _new.clear();
}

/**
 * Record that a statement charge matched an existing subscription.
 * Sets `lastCharge` and flags `isTrialVerify` for $0.01 / $1.00 amounts.
 */
export function recordMatch(subscriptionId: string, charge: LastCharge): void {
  const prev = _aug.get(subscriptionId) ?? {};
  const isVerify = VERIFY_AMOUNTS.has(Number(charge.amount.toFixed(2)));
  _aug.set(subscriptionId, {
    lastCharge: charge,
    isTrialVerify: isVerify || prev.isTrialVerify === true,
  });
}

/**
 * Add or overwrite a derived subscription discovered from a statement.
 * Latest write wins — re-uploads don't pile up duplicates.
 */
export function recordNewSub(sub: Subscription): void {
  _new.set(sub.id, sub);
}

/** Return the seed subscriptions merged with any augmentations, followed by derived subs. */
export function augmentedSubscriptions(): Subscription[] {
  const base = SUBSCRIPTIONS.map((s) => {
    const a = _aug.get(s.id);
    if (!a) return s;
    return { ...s, lastCharge: a.lastCharge, isTrialVerify: a.isTrialVerify };
  });
  return [...base, ..._new.values()];
}
