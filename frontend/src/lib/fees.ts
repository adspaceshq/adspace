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

// Same integer math as the program's calculate_fee.
export function feeFor(mode: PricingMode, fees: FeePolicy, startPrice: bigint, finalAmount: bigint): bigint {
  if (mode === "fixed") return applyBps(finalAmount, fees.feeBps);
  const base = finalAmount < startPrice ? finalAmount : startPrice;
  const calculated = applyBps(base, fees.feeBps) + applyBps(finalAmount - base, fees.upliftFeeBps);
  const cap = applyBps(finalAmount, fees.maxFeeBps);
  return calculated < cap ? calculated : cap;
}
