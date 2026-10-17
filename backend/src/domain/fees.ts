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
  // Both components are summed before the one division, so the fee rounds down only once.
  const calculated = (baseValue * BigInt(fees.feeBps) + uplift * BigInt(fees.upliftFeeBps)) / 10_000n;
  const maximum = applyBps(balance, fees.maxFeeBps);
  return calculated < maximum ? calculated : maximum;
}

export function calculateDisputeSplit(fees: FeeSnapshot, spotPrice: bigint, balance: bigint, sellerShareBps: number) {
  const sellerGross = applyBps(balance, sellerShareBps);
  const buyerRefund = balance - sellerGross;
  const fee = applyBps(calculateFee(fees, spotPrice, balance), sellerShareBps);
  return { sellerNet: sellerGross - fee, buyerRefund, fee };
}
