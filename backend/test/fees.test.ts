import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDisputeSplit, calculateFee, type FeeSnapshot } from "../src/domain/fees.js";

const fixed: FeeSnapshot = { mode: "fixed", feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 };
const auction: FeeSnapshot = { mode: "auction", feeBps: 250, upliftFeeBps: 2000, maxFeeBps: 1000 };

test("fixed listings take a flat fee", () => {
  assert.equal(calculateFee(fixed, 100n, 100_000_000n), 5_000_000n);
});

test("auction uplift is charged above the starting price and capped", () => {
  // 50 start, 60 final: 1.25 base + 2.00 uplift = 3.25, under the 6.00 cap
  assert.equal(calculateFee(auction, 50_000_000n, 60_000_000n), 3_250_000n);
  // 50 start, 200 final: 1.25 + 30 = 31.25, capped at 20
  assert.equal(calculateFee(auction, 50_000_000n, 200_000_000n), 20_000_000n);
});

test("auction fee sums both components before rounding down once", () => {
  // base 50.000039 * 2.5% = 1.250000975, uplift 0.000004 * 20% = 0.0000008: two floors give 1.250000,
  // the program's single floor over the sum gives 1.250001.
  assert.equal(calculateFee(auction, 50_000_039n, 50_000_043n), 1_250_001n);
  // Tiny amounts: each component alone rounds to 0, the sum does not.
  assert.equal(calculateFee(auction, 39n, 43n), 1n);
  // Still capped at max_fee_bps of the balance.
  assert.equal(calculateFee({ ...auction, maxFeeBps: 250 }, 39n, 43n), 1n);
  assert.equal(calculateFee({ ...auction, maxFeeBps: 250 }, 39n, 41n), 1n);
  assert.equal(calculateFee({ ...auction, maxFeeBps: 100 }, 39n, 43n), 0n);
  // The dispute fee scales the single-rounded full fee.
  assert.equal(calculateDisputeSplit(auction, 50_000_039n, 50_000_043n, 10_000).fee, 1_250_001n);
  assert.equal(calculateDisputeSplit(auction, 50_000_039n, 50_000_043n, 5_000).fee, 625_000n);
});

test("floor division matches the program for tiny balances", () => {
  assert.equal(calculateFee(fixed, 1n, 1n), 0n);
  assert.equal(calculateFee(fixed, 19n, 19n), 0n);
  assert.equal(calculateFee(fixed, 20n, 20n), 1n);
});

test("dispute splits always add up to the balance", () => {
  for (const share of [0, 2500, 5000, 7333, 10000]) {
    const balance = 123_456_789n;
    const split = calculateDisputeSplit(auction, 100_000_000n, balance, share);
    assert.equal(split.sellerNet + split.buyerRefund + split.fee, balance);
  }
  assert.deepEqual(calculateDisputeSplit(fixed, 100n, 1_000n, 0), { sellerNet: 0n, buyerRefund: 1_000n, fee: 0n });
});
