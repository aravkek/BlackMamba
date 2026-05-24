// lib/statements/__tests__/canonicalize.test.ts
import { describe, it, expect } from "vitest";
import { canonicalize } from "@/lib/statements/canonicalize";

describe("canonicalize", () => {
  it.each([
    ["NETFLIX.COM 866-579-7172 CA", "netflix"],
    ["SPOTIFY USA  NEW YORK NY", "spotify usa"],
    ["AMZN*PRIME 877-NEWPRIME", "prime"],
    ["SQ *Coffee Shop", "coffee shop"],
    ["PAYPAL *NYTimes", "nytimes"],
    ["  Netflix   ", "netflix"],
    ["DISNEY PLUS", "disney"],
    ["GOODLIFE FITNESS - MEMBERSHIP", "goodlife fitness"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });
});
