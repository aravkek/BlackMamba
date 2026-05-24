// Process-local subscription augmentations + derived subs. Mirrors
// savings-state.ts: resets on server restart, fine for the demo.
import { SUBSCRIPTIONS, type Subscription, type LastCharge } from "@/lib/data";
import type { Augmentation } from "./types";

const VERIFY_AMOUNTS = new Set([0.01, 1.0]);

const _aug = new Map<string, Augmentation>();         // id → augmentation
const _new = new Map<string, Subscription>();          // id → derived sub
const _cancelled = new Set<string>();                  // ids removed from rail

/** Wipe all augmentations, derived subscriptions, and cancellations. */
export function resetAugmentations(): void {
  _aug.clear();
  _new.clear();
  _cancelled.clear();
}

/** Mark a subscription as cancelled — drops it from augmentedSubscriptions(). */
export function markCancelled(subscriptionId: string): void {
  _cancelled.add(subscriptionId);
}

/** Resolve a merchant name (case-insensitive, fuzzy-trimmed) to a sub id. */
export function findSubscriptionIdByService(merchant: string): string | null {
  const needle = merchant.trim().toLowerCase();
  for (const s of SUBSCRIPTIONS) {
    if (s.service.toLowerCase() === needle) return s.id;
  }
  for (const s of _new.values()) {
    if (s.service.toLowerCase() === needle) return s.id;
  }
  // Loose substring fallback so "Toronto Star" matches "The Toronto Star".
  for (const s of SUBSCRIPTIONS) {
    if (s.service.toLowerCase().includes(needle)) return s.id;
  }
  for (const s of _new.values()) {
    if (s.service.toLowerCase().includes(needle)) return s.id;
  }
  return null;
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

/** Return the seed subscriptions merged with any augmentations, followed by derived subs. Cancelled subs are filtered out. */
export function augmentedSubscriptions(): Subscription[] {
  const base = SUBSCRIPTIONS.filter((s) => !_cancelled.has(s.id)).map((s) => {
    const a = _aug.get(s.id);
    if (!a) return s;
    return { ...s, lastCharge: a.lastCharge, isTrialVerify: a.isTrialVerify };
  });
  const derived = Array.from(_new.values()).filter(
    (s) => !_cancelled.has(s.id),
  );
  return [...base, ...derived];
}
