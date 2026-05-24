// Stripe client + cardholder bootstrap for BlackMamba.
// Lazy-initialized so the module can be imported even without a key
// (the /api/cards route returns a mock card in that case).

import Stripe from "stripe";

let _client: Stripe | null = null;
let _cardholderPromise: Promise<string> | null = null;

export function getStripe(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_")) return null;
  // Omit apiVersion → use the account's default. Avoids literal-union pinning
  // headaches across Stripe SDK minor versions.
  _client = new Stripe(key, {
    appInfo: { name: "switchback-hackathon" },
  });
  return _client;
}

// Stripe Issuing requires a cardholder. We create one demo cardholder
// per process and cache the promise so concurrent requests share it.
export async function getOrCreateCardholder(): Promise<string> {
  if (_cardholderPromise) return _cardholderPromise;

  const stripe = getStripe();
  if (!stripe) throw new Error("stripe_not_configured");

  _cardholderPromise = (async () => {
    // Reuse existing demo cardholder if present (idempotent across restarts).
    const existing = await stripe.issuing.cardholders.list({ limit: 1 });
    if (existing.data.length > 0) return existing.data[0].id;

    const cardholder = await stripe.issuing.cardholders.create({
      type: "individual",
      name: "BlackMamba Demo",
      email: "demo@switchback.app",
      phone_number: "+14165550100",
      status: "active",
      billing: {
        address: {
          line1: "123 King St W",
          city: "Toronto",
          state: "ON",
          postal_code: "M5H1A1",
          country: "CA",
        },
      },
    });
    return cardholder.id;
  })().catch((err) => {
    // Reset on failure so the next request can retry instead of inheriting a rejected promise.
    _cardholderPromise = null;
    throw err;
  });

  return _cardholderPromise;
}
