// lib/statements/__tests__/match.test.ts
import { describe, it, expect } from "vitest";
import { matchCharges } from "@/lib/statements/match";
import { SUBSCRIPTIONS } from "@/lib/data";

describe("matchCharges", () => {
  it("links a Netflix charge to the Netflix subscription", () => {
    const result = matchCharges(
      [
        { postedAt: "2026-05-01", merchantRaw: "NETFLIX.COM 866-579-7172 CA",
          amount: 24.99, currency: "USD", source: "chase.csv" },
      ],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toEqual([
      { subscriptionId: "netflix", merchantRaw: "NETFLIX.COM 866-579-7172 CA", amount: 24.99 },
    ]);
    expect(result.newSubs).toHaveLength(0);
  });

  it("accepts an amount within ±$2 tolerance", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "NETFLIX", amount: 26.99,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toHaveLength(1);
  });

  it("rejects when amount is far off", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "NETFLIX", amount: 199.00,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.matched).toHaveLength(0);
    expect(result.newSubs).toHaveLength(1);  // unmatched → derived
  });

  it("flags trial verify charges (still 'matched' but counted)", () => {
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "SPOTIFY", amount: 0.01,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.trialVerifyCount).toBe(1);
    expect(result.matched).toEqual([
      { subscriptionId: "spotify", merchantRaw: "SPOTIFY", amount: 0.01 },
    ]);
    expect(result.ignored).toHaveLength(0);
  });

  it("groups multiple charges of the same unknown merchant into one derived sub", () => {
    const charges = [
      { postedAt: "2026-04-01", merchantRaw: "OPENAI*CHATGPT", amount: 20.0, currency: "USD", source: "x.csv" },
      { postedAt: "2026-05-01", merchantRaw: "OPENAI*CHATGPT", amount: 20.0, currency: "USD", source: "x.csv" },
    ];
    const result = matchCharges(charges, SUBSCRIPTIONS);
    expect(result.newSubs).toHaveLength(1);
    expect(result.newSubs[0].sampleMerchantRaw).toBe("OPENAI*CHATGPT");
  });

  it("ignores tiny verify amounts when deciding to create a new sub", () => {
    // A lone $0.01 from an unknown merchant should NOT spawn a derived sub.
    const result = matchCharges(
      [{ postedAt: "2026-05-01", merchantRaw: "WEIRD MERCHANT", amount: 0.01,
         currency: "USD", source: "x.csv" }],
      SUBSCRIPTIONS,
    );
    expect(result.newSubs).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
  });
});
