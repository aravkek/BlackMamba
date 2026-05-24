// Stripe client + cardholder bootstrap for BlackMamba.
// Lazy-initialized so the module can be imported even without a key
// (the /api/cards route returns a mock card in that case).

import Stripe from "stripe";

let _client: Stripe | null = null;
let _cardholderPromise: Promise<string> | null = null;

const CARDHOLDER_TAG = "blackmamba_v2"; // bump when shape changes

export function getStripe(): Stripe | null {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_")) return null;
  _client = new Stripe(key, {
    appInfo: { name: "blackmamba-hackathon" },
  });
  return _client;
}

// Stripe Issuing requires an ACTIVE cardholder. Test mode is USD-only and
// activation requires full individual details + a US billing address. We
// tag cardholders we create so we don't accidentally reuse a half-built
// older one (e.g. the v1 Toronto-address cardholder that can't activate).
export async function getOrCreateCardholder(): Promise<string> {
  if (_cardholderPromise) return _cardholderPromise;

  const stripe = getStripe();
  if (!stripe) throw new Error("stripe_not_configured");

  _cardholderPromise = (async () => {
    // Find a tagged-and-active cardholder we created previously.
    const list = await stripe.issuing.cardholders.list({ limit: 100 });
    const reusable = list.data.find(
      (c) =>
        c.status === "active" &&
        c.metadata &&
        c.metadata.blackmamba === CARDHOLDER_TAG,
    );
    if (reusable) return reusable.id;

    // Otherwise create a fresh US individual cardholder with all required
    // fields. This is a TEST-mode cardholder — the address/DOB/SSN are
    // canonical Stripe test values and don't represent a real person.
    const cardholder = await stripe.issuing.cardholders.create({
      type: "individual",
      name: "BlackMamba Demo",
      email: "demo@blackmamba.app",
      phone_number: "+15555550123",
      status: "active",
      billing: {
        address: {
          line1: "123 Main Street",
          city: "San Francisco",
          state: "CA",
          postal_code: "94103",
          country: "US",
        },
      },
      individual: {
        first_name: "BlackMamba",
        last_name: "Demo",
        dob: { day: 1, month: 1, year: 1990 },
      },
      metadata: { blackmamba: CARDHOLDER_TAG },
    });
    return cardholder.id;
  })().catch((err) => {
    _cardholderPromise = null;
    throw err;
  });

  return _cardholderPromise;
}
