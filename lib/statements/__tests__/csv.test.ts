import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/lib/statements/csv";

const load = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf-8");

describe("parseCsv", () => {
  it("parses Chase format (negative_is_debit, MM/DD/YYYY)", () => {
    const charges = parseCsv(load("chase.csv"), "chase.csv");
    // 4 debits, payment row is a credit and skipped
    expect(charges).toHaveLength(4);
    expect(charges[0].postedAt).toBe("2026-01-02");
    expect(charges[0].merchantRaw).toBe("NETFLIX.COM 866-579-7172 CA");
    expect(charges[0].amount).toBe(24.99);
    expect(charges[0].source).toBe("chase.csv");
  });

  it("parses Amex format (positive_is_debit, MM/DD/YYYY)", () => {
    const charges = parseCsv(load("amex.csv"), "amex.csv");
    expect(charges).toHaveLength(3);
    expect(charges[0].amount).toBe(24.99);
  });

  it("skips rows missing required fields", () => {
    const csv = "Date,Description,Amount\n01/01/2026,,-5.00\n01/02/2026,X,not-a-number";
    const charges = parseCsv(csv, "broken.csv");
    expect(charges).toHaveLength(0);
  });

  it("auto-detects sign convention from majority of rows", () => {
    // Three negatives → negative_is_debit; positive 250 is the payment (credit).
    const csv = "Date,Description,Amount\n01/01/2026,A,-5.00\n01/02/2026,B,-7.00\n01/03/2026,Payment,250.00";
    const charges = parseCsv(csv, "x.csv");
    expect(charges).toHaveLength(2);
    expect(charges.every((c) => c.amount > 0)).toBe(true);
  });
});
