import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractCharges } from "@/lib/statements/extract";

describe("extractCharges", () => {
  it("dispatches CSV files to the CSV parser", async () => {
    const buf = Buffer.from(
      readFileSync(join(__dirname, "fixtures", "chase.csv"), "utf-8"),
    );
    const out = await extractCharges({
      filename: "chase.csv",
      bytes: buf,
      llm: async () => "[]",
      pdfToText: async () => "",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].source).toBe("chase.csv");
  });

  it("dispatches PDF files through pdfToText + llm", async () => {
    let pdfCalled = false;
    let llmCalled = false;
    const out = await extractCharges({
      filename: "stmt.pdf",
      bytes: Buffer.from("fake"),
      llm: async () => {
        llmCalled = true;
        return JSON.stringify([
          { date: "2026-05-01", merchant: "NETFLIX.COM", amount: 24.99 },
        ]);
      },
      pdfToText: async () => {
        pdfCalled = true;
        return "fake pdf body";
      },
    });
    expect(pdfCalled).toBe(true);
    expect(llmCalled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("stmt.pdf");
  });

  it("returns [] for unsupported extensions", async () => {
    const out = await extractCharges({
      filename: "stmt.xlsx",
      bytes: Buffer.from(""),
      llm: async () => "[]",
      pdfToText: async () => "",
    });
    expect(out).toEqual([]);
  });
});
