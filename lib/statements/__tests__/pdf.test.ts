import { describe, it, expect } from "vitest";
import { extractFromPdfText } from "@/lib/statements/pdf";

describe("extractFromPdfText", () => {
  it("returns parsed charges from a successful LLM response", async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { date: "2026-05-01", merchant: "NETFLIX.COM", amount: 24.99 },
        { date: "2026-05-02", merchant: "SPOTIFY USA", amount: 11.99 },
      ]);
    const out = await extractFromPdfText("dummy pdf text", "stmt.pdf", fakeLlm);
    expect(out).toHaveLength(2);
    expect(out[0].postedAt).toBe("2026-05-01");
    expect(out[0].merchantRaw).toBe("NETFLIX.COM");
    expect(out[0].amount).toBe(24.99);
    expect(out[0].source).toBe("stmt.pdf");
  });

  it("returns [] when LLM output isn't JSON", async () => {
    const fakeLlm = async () => "not json";
    const out = await extractFromPdfText("x", "x.pdf", fakeLlm);
    expect(out).toEqual([]);
  });

  it("returns [] on empty pdf text", async () => {
    const called = { yes: false };
    const fakeLlm = async () => { called.yes = true; return "[]"; };
    const out = await extractFromPdfText("", "x.pdf", fakeLlm);
    expect(out).toEqual([]);
    expect(called.yes).toBe(false);
  });

  it("filters non-positive or non-finite amounts", async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { date: "2026-05-01", merchant: "A", amount: 0 },
        { date: "2026-05-01", merchant: "B", amount: -5 },
        { date: "2026-05-01", merchant: "C", amount: "NaN" },
        { date: "2026-05-01", merchant: "D", amount: 9.99 },
      ]);
    const out = await extractFromPdfText("x", "x.pdf", fakeLlm);
    expect(out.map((c) => c.merchantRaw)).toEqual(["D"]);
  });
});
