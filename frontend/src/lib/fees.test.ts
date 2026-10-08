import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, feeFor, feePolicyError } from "./fees";

describe("fees", () => {
  it("accepts the defaults and enforces the program's rules", () => {
    expect(feePolicyError("fixed", DEFAULT_FEES.fixed, 250)).toBeNull();
    expect(feePolicyError("auction", DEFAULT_FEES.auction, 250)).toBeNull();
    expect(feePolicyError("fixed", { feeBps: 200, upliftFeeBps: 0, maxFeeBps: 200 }, 250)).toMatch(/floor/);
    expect(feePolicyError("fixed", { feeBps: 500, upliftFeeBps: 100, maxFeeBps: 500 }, 250)).toMatch(/flat/);
    expect(feePolicyError("auction", { feeBps: 250, upliftFeeBps: 900, maxFeeBps: 1000 }, 250)).toMatch(/cap/);
  });

  it("matches the program's fee math", () => {
    expect(feeFor("fixed", DEFAULT_FEES.fixed, 0n, 100_000_000n)).toBe(5_000_000n);
    expect(feeFor("auction", DEFAULT_FEES.auction, 50_000_000n, 60_000_000n)).toBe(3_250_000n);
    expect(feeFor("auction", DEFAULT_FEES.auction, 50_000_000n, 200_000_000n)).toBe(20_000_000n);
  });
});
