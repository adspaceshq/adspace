// Mirrors adspaces-program/programs/adspaces/src/fees.rs exactly (integer math, floor division).
// Used to record settlement amounts; the program remains the source of truth for transfers.

export interface FeeSnapshot {
  mode: "fixed" | "auction";
  feeBps: number;
  upliftFeeBps: number;
  maxFeeBps: number;
}

const applyBps = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10_000n;

export function calculateFee(fees: FeeSnapshot, spotPrice: bigint, balance: bigint): bigint {
  if (fees.mode === "fixed") return applyBps(balance, fees.feeBps);
  const baseValue = balance < spotPrice ? balance : spotPrice;
  const uplift = balance - baseValue;
  const calculated = applyBps(baseValue, fees.feeBps) + applyBps(uplift, fees.upliftFeeBps);
  const maximum = applyBps(balance, fees.maxFeeBps);
  return calculated < maximum ? calculated : maximum;
}

export function calculateDisputeSplit(fees: FeeSnapshot, spotPrice: bigint, balance: bigint, sellerShareBps: number) {
  const sellerGross = applyBps(balance, sellerShareBps);
  const buyerRefund = balance - sellerGross;
  const fee = applyBps(calculateFee(fees, spotPrice, balance), sellerShareBps);
  return { sellerNet: sellerGross - fee, buyerRefund, fee };
}
