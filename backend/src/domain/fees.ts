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

// Which resolve_dispute destinations must be passed: the program requires a token account only for a
// leg above zero (ResolveAccountRequired) and accepts none otherwise. Decided from the share and fee
// rates as well as the computed split, so tokens landing in the vault before execution (which can turn a
// floored-to-zero amount positive) never leave a paid leg without its account.
export function disputeLegs(fees: FeeSnapshot, sellerShareBps: number, split: { sellerNet: bigint; buyerRefund: bigint; fee: bigint }) {
  const feeRate = fees.mode === "fixed" ? fees.feeBps > 0 : (fees.feeBps > 0 || fees.upliftFeeBps > 0) && fees.maxFeeBps > 0;
  return {
    seller: split.sellerNet > 0n || sellerShareBps > 0,
    buyer: split.buyerRefund > 0n || sellerShareBps < 10_000,
    treasury: split.fee > 0n || (sellerShareBps > 0 && feeRate),
  };
}
