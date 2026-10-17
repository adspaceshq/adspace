import type { PricingMode } from "@/lib/api/types";

export interface FeePolicy {
  feeBps: number;
  upliftFeeBps: number;
  maxFeeBps: number;
}

export const DEFAULT_FEES: Record<PricingMode, FeePolicy> = {
  fixed: { feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 },
  auction: { feeBps: 250, upliftFeeBps: 2000, maxFeeBps: 1000 },
};

// Mirrors the program's validate_fee_policy and the backend check.
export function feePolicyError(mode: PricingMode, fees: FeePolicy, floorBps: number): string | null {
  const values = [fees.feeBps, fees.upliftFeeBps, fees.maxFeeBps];
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000)) return "fees must be whole basis points, 0-10000";
  if (fees.feeBps < floorBps) return `base fee must be at least the platform floor (${floorBps / 100}%)`;
  if (mode === "fixed") {
    if (fees.upliftFeeBps !== 0 || fees.maxFeeBps !== fees.feeBps) return "fixed listings use one flat fee";
  } else if (!(fees.feeBps <= fees.maxFeeBps && fees.maxFeeBps <= fees.upliftFeeBps)) {
    return "auctions need base ≤ cap ≤ uplift";
  }
  return null;
}

const applyBps = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10_000n;

// Same integer math as the program's calculate_fee: both auction components are summed before one
// floor division, then capped at max_fee_bps of the final amount.
export function feeFor(mode: PricingMode, fees: FeePolicy, startPrice: bigint, finalAmount: bigint): bigint {
  if (mode === "fixed") return applyBps(finalAmount, fees.feeBps);
  const base = finalAmount < startPrice ? finalAmount : startPrice;
  const calculated = (base * BigInt(fees.feeBps) + (finalAmount - base) * BigInt(fees.upliftFeeBps)) / 10_000n;
  const cap = applyBps(finalAmount, fees.maxFeeBps);
  return calculated < cap ? calculated : cap;
}

// Fees above this get an extra confirmation: the policy is fixed on-chain at publish.
export const HIGH_FEE_BPS = 1000;

// What a fee-% field may hold while someone is typing: digits, at most one dot, at most two decimals
// (one basis point is 0.01%). "", "2" and "2." are all fine mid-edit.
export function isPercentDraft(input: string): boolean {
  return /^\d{0,3}(\.\d{0,2})?$/.test(input.trim());
}

// "2.5" -> 250. Null for anything that isn't a whole number of basis points between 0 and 100%.
export function parsePercentToBps(input: string): number | null {
  const text = input.trim();
  const match = /^(\d{1,3})?(?:\.(\d{0,2}))?$/.exec(text);
  if (!match || (match[1] === undefined && !match[2])) return null;
  const bps = Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

// 250 -> "2.5"; the canonical text a field settles on after blur.
export function bpsToPercentText(bps: number): string {
  return String(bps / 100);
}

// The most a sale can ever pay, as a share of the final amount. In auctions the uplift rate is
// normally above the cap (base <= cap <= uplift), so the cap is what bounds the fee.
export function effectiveMaxFeeBps(fees: FeePolicy): number {
  return Math.max(fees.feeBps, fees.maxFeeBps);
}

// The policy recorded on a listing at approval. Null until a reviewer has set one.
export function listingFeePolicy(listing: { feeBps: number | null; upliftFeeBps: number | null; maxFeeBps: number | null }): FeePolicy | null {
  if (listing.feeBps === null || listing.upliftFeeBps === null || listing.maxFeeBps === null) return null;
  return { feeBps: listing.feeBps, upliftFeeBps: listing.upliftFeeBps, maxFeeBps: listing.maxFeeBps };
}

export interface DisputeSplit {
  buyerRefund: bigint;
  // The creator's share before the fee.
  creatorGross: bigint;
  fee: bigint;
  creatorNet: bigint;
}

// Same integer math as the program's resolve_dispute: the creator's share of the escrow pays the
// full fee scaled by that share (calculate_dispute_fee), each step rounding down.
export function disputeSplit(mode: PricingMode, fees: FeePolicy, startPrice: bigint, balance: bigint, creatorShareBps: number): DisputeSplit {
  const creatorGross = applyBps(balance, creatorShareBps);
  const fee = applyBps(feeFor(mode, fees, startPrice, balance), creatorShareBps);
  return { buyerRefund: balance - creatorGross, creatorGross, fee, creatorNet: creatorGross - fee };
}
