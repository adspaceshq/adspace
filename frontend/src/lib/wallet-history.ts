import type { ActivityItem, CreatorDashboard, SpotState } from "@/lib/api/types";
import { feeFor, listingFeePolicy } from "@/lib/fees";

export interface PendingEarning {
  spotId: string;
  spotIndex: number;
  listingId: string;
  listingTitle: string;
  state: Extract<SpotState, "funded" | "delivered">;
  gross: bigint;
  // Null when the listing has no fee snapshot (shouldn't happen once published).
  fee: bigint | null;
  net: bigint | null;
  // When the payout can be sent: the delivery deadline plus the sponsor's review window.
  payoutAt: Date;
  // Funded spots only pay out once proof is submitted by the delivery deadline.
  needsProof: boolean;
}

const PAYABLE = new Set<SpotState>(["funded", "delivered"]);

// Paid spots whose escrow hasn't been released to the creator yet, soonest payout first.
// The fee uses the listing's on-chain snapshot with the program's math, so the net matches the payout.
export function pendingEarnings(listings: CreatorDashboard["listings"]): PendingEarning[] {
  const items: PendingEarning[] = [];
  for (const listing of listings) {
    const fees = listingFeePolicy(listing);
    const payoutAt = new Date(new Date(listing.deliveryDueAt).getTime() + listing.reviewWindowSeconds * 1000);
    for (const spot of listing.spots) {
      if (!PAYABLE.has(spot.state) || spot.amount === null) continue;
      const gross = BigInt(spot.amount);
      const fee = fees ? feeFor(listing.mode, fees, BigInt(spot.price), gross) : null;
      items.push({
        spotId: spot.id,
        spotIndex: spot.index,
        listingId: listing.id,
        listingTitle: listing.title,
        state: spot.state as PendingEarning["state"],
        gross,
        fee,
        net: fee === null ? null : gross - fee,
        payoutAt,
        needsProof: spot.state === "funded",
      });
    }
  }
  return items.sort((a, b) => a.payoutAt.getTime() - b.payoutAt.getTime());
}

// Activity events that moved money in or out of escrow; the wallet history shows only these.
const MONEY_EVENTS = new Set(["claimed", "bid_placed", "seller_paid", "refunded", "dispute_resolved", "dispute_timed_out"]);

export const isMoneyEvent = (item: Pick<ActivityItem, "type">) => MONEY_EVENTS.has(item.type);
