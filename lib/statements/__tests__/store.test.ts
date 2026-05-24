import { describe, it, expect, beforeEach } from "vitest";
import {
  resetAugmentations,
  recordMatch,
  recordNewSub,
  augmentedSubscriptions,
} from "@/lib/statements/store";

beforeEach(() => resetAugmentations());

describe("statement store", () => {
  it("merges lastCharge onto an existing subscription by id", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 24.99, source: "chase.csv" });
    const out = augmentedSubscriptions();
    const net = out.find((s) => s.id === "netflix")!;
    expect(net.lastCharge?.amount).toBe(24.99);
    expect(net.lastCharge?.source).toBe("chase.csv");
  });

  it("flags trial verify when amount is exactly $0.01", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 0.01, source: "chase.csv" });
    const out = augmentedSubscriptions();
    expect(out.find((s) => s.id === "netflix")!.isTrialVerify).toBe(true);
  });

  it("appends new derived subscriptions for unmatched merchants", () => {
    recordNewSub({
      id: "openai",
      service: "OpenAI",
      amount: 20.0,
      frequency: "monthly",
      brandColor: "#10A37F",
      lastCharge: { date: "2026-05-02", amount: 20.0, source: "chase.csv" },
      detectedFromStatement: true,
    });
    const out = augmentedSubscriptions();
    expect(out.some((s) => s.id === "openai")).toBe(true);
    expect(out.find((s) => s.id === "openai")!.detectedFromStatement).toBe(true);
  });

  it("does not duplicate a derived sub on a second recordNewSub with same id", () => {
    const make = () => ({
      id: "openai", service: "OpenAI", amount: 20.0, frequency: "monthly" as const,
      brandColor: "#10A37F", detectedFromStatement: true,
    });
    recordNewSub(make());
    recordNewSub({ ...make(), amount: 22.0 });
    const out = augmentedSubscriptions().filter((s) => s.id === "openai");
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(22.0); // latest wins
  });

  it("resets cleanly", () => {
    recordMatch("netflix", { date: "2026-05-01", amount: 24.99, source: "x.csv" });
    resetAugmentations();
    expect(augmentedSubscriptions().find((s) => s.id === "netflix")?.lastCharge).toBeUndefined();
  });
});
