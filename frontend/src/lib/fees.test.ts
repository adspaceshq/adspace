import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, bpsToPercentText, disputeSplit, effectiveMaxFeeBps, feeFor, feePolicyError, isPercentDraft, listingFeePolicy, parsePercentToBps } from "./fees";

describe("fees", () => {
  it("accepts the defaults and enforces the program's rules", () => {
    expect(feePolicyError("fixed", DEFAULT_FEES.fixed, 250)).toBeNull();
    expect(feePolicyError("auction", DEFAULT_FEES.auction, 250)).toBeNull();
    expect(feePolicyError("fixed", { feeBps: 200, upliftFeeBps: 0, maxFeeBps: 200 }, 250)).toMatch(/floor/);
    expect(feePolicyError("fixed", { feeBps: 500, upliftFeeBps: 100, maxFeeBps: 500 }, 250)).toMatch(/flat/);
    expect(feePolicyError("auction", { feeBps: 250, upliftFeeBps: 900, maxFeeBps: 1000 }, 250)).toMatch(/cap/);
    expect(feePolicyError("auction", { feeBps: 1200, upliftFeeBps: 2000, maxFeeBps: 1000 }, 250)).toMatch(/cap/);
  });

  it("matches the program's fee math", () => {
    expect(feeFor("fixed", DEFAULT_FEES.fixed, 0n, 100_000_000n)).toBe(5_000_000n);
    expect(feeFor("auction", DEFAULT_FEES.auction, 50_000_000n, 60_000_000n)).toBe(3_250_000n);
    expect(feeFor("auction", DEFAULT_FEES.auction, 50_000_000n, 200_000_000n)).toBe(20_000_000n);
  });
});

describe("fee % inputs", () => {
  it("lets partial decimals through while typing", () => {
    for (const draft of ["", "2", "2.", "2.5", "2.55", ".5", "100", " 2.5 "]) expect(isPercentDraft(draft)).toBe(true);
    for (const bad of ["2.555", "abc", "2..5", "1000.0", "-1", "2,5", "1e2"]) expect(isPercentDraft(bad)).toBe(false);
  });

  it("parses to whole basis points", () => {
    expect(parsePercentToBps("2")).toBe(200);
    expect(parsePercentToBps("2.")).toBe(200);
    expect(parsePercentToBps("2.5")).toBe(250);
    expect(parsePercentToBps("2.55")).toBe(255);
    expect(parsePercentToBps(".5")).toBe(50);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("100")).toBe(10_000);
    expect(parsePercentToBps(" 10 ")).toBe(1000);
  });

  it("rejects empty, out of range and malformed input", () => {
    for (const bad of ["", ".", "100.01", "101", "2.555", "abc", "-1", "NaN"]) expect(parsePercentToBps(bad)).toBeNull();
  });

  it("round-trips to canonical text", () => {
    expect(bpsToPercentText(250)).toBe("2.5");
    expect(bpsToPercentText(500)).toBe("5");
    expect(bpsToPercentText(1)).toBe("0.01");
    expect(parsePercentToBps(bpsToPercentText(1234))).toBe(1234);
  });

  it("bounds the fee by the cap, not the uplift", () => {
    expect(effectiveMaxFeeBps(DEFAULT_FEES.auction)).toBe(1000);
    expect(effectiveMaxFeeBps(DEFAULT_FEES.fixed)).toBe(500);
  });
});

describe("listingFeePolicy", () => {
  it("reads the snapshot, or nothing before review", () => {
    expect(listingFeePolicy({ feeBps: 250, upliftFeeBps: 2000, maxFeeBps: 1000 })).toEqual(DEFAULT_FEES.auction);
    expect(listingFeePolicy({ feeBps: null, upliftFeeBps: null, maxFeeBps: null })).toBeNull();
  });

  it("splits a dispute like resolve_dispute: the fee scales with the creator's share, rounding down", () => {
    expect(disputeSplit("fixed", DEFAULT_FEES.fixed, 100_000_001n, 100_000_001n, 3333)).toEqual({
      creatorGross: 33_330_000n,
      fee: 1_666_500n,
      creatorNet: 31_663_500n,
      buyerRefund: 66_670_001n,
    });
    expect(disputeSplit("auction", DEFAULT_FEES.auction, 50_000_000n, 200_000_000n, 5000)).toEqual({
      creatorGross: 100_000_000n,
      fee: 10_000_000n,
      creatorNet: 90_000_000n,
      buyerRefund: 100_000_000n,
    });
    const none = disputeSplit("fixed", DEFAULT_FEES.fixed, 10n, 10_000_000n, 0);
    expect([none.fee, none.creatorNet, none.buyerRefund]).toEqual([0n, 0n, 10_000_000n]);
  });
});
