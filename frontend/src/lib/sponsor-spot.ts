import type { SponsorDashboard } from "@/lib/api/types";
import { formatUsd } from "@/lib/money";
import type { BadgeTone } from "@/components/ui/Badge";

// Plain-language state for one spot on the sponsor dashboard: what happened, what's next, what it cost.

export type SponsorSpot = SponsorDashboard["spots"][number];

export const FINISHED_SPOT_STATES = new Set(["settled", "refunded", "cancelled"]);

export const isFinished = (spot: Pick<SponsorSpot, "state">) => FINISHED_SPOT_STATES.has(spot.state);

// What actually left the sponsor's wallet. Before settlement the full amount sits in escrow;
// after it, the refunded part came back, so only the creator's share and the fee count.
export function spentOn(spot: Pick<SponsorSpot, "amount" | "settlement">): bigint {
  if (spot.settlement) return BigInt(spot.settlement.sellerNet) + BigInt(spot.settlement.fee);
  return BigInt(spot.amount ?? 0);
}

export interface Outcome {
  text: string;
  tone: BadgeTone;
}

// How a finished spot ended, in the sponsor's words. Null while the spot is still active.
export function outcomeOf(spot: Pick<SponsorSpot, "state" | "settlement">): Outcome | null {
  const settlement = spot.settlement;
  if (settlement) {
    const refunded = formatUsd(settlement.buyerRefund);
    if (settlement.kind === "payout") return { text: "delivered · paid to creator", tone: "success" };
    if (settlement.kind === "refund") return { text: `delivery missed · refunded ${refunded}`, tone: "neutral" };
    if (settlement.kind === "timeout_refund") return { text: `dispute timed out · refunded ${refunded}`, tone: "neutral" };
    const paid = formatUsd(BigInt(settlement.sellerNet) + BigInt(settlement.fee));
    return { text: `dispute split: ${refunded} refunded, ${paid} paid`, tone: "warning" };
  }
  if (spot.state === "settled") return { text: "delivered · paid to creator", tone: "success" };
  if (spot.state === "refunded") return { text: "refunded", tone: "neutral" };
  if (spot.state === "cancelled") return { text: "closed before anyone paid", tone: "neutral" };
  return null;
}

export interface NextStep {
  text: string;
  countdown?: { prefix: string; to: string };
  tone: "neutral" | "action" | "warning";
}

// The one thing to know about an active spot right now.
export function nextStepOf(
  spot: Pick<SponsorSpot, "state" | "reviewUntil" | "listing">,
  now = Date.now(),
): NextStep | null {
  const { listing } = spot;
  if (spot.state === "funded") {
    if (listing.mode === "auction" && new Date(listing.deadline).getTime() > now) {
      return { text: "you're the top bid", countdown: { prefix: "bidding closes in", to: listing.deadline }, tone: "neutral" };
    }
    if (new Date(listing.deliveryDueAt).getTime() <= now) return { text: "delivery missed · you can take a refund", tone: "warning" };
    return { text: "the creator is placing your logo", countdown: { prefix: "delivery due in", to: listing.deliveryDueAt }, tone: "neutral" };
  }
  if (spot.state === "delivered") {
    if (spot.reviewUntil && new Date(spot.reviewUntil).getTime() > now) {
      return { text: "proof is in · check it", countdown: { prefix: "review closes in", to: spot.reviewUntil }, tone: "action" };
    }
    return { text: "review closed · payout to the creator is next", tone: "neutral" };
  }
  if (spot.state === "disputed") return { text: "dispute open · a reviewer will decide", tone: "warning" };
  return null;
}

export const PROGRESS_STEPS = ["paid", "delivered", "complete"] as const;

// How many of paid -> delivered -> complete are done.
export function progressOf(spot: Pick<SponsorSpot, "state" | "proofSubmittedAt">): number {
  if (spot.state === "settled") return 3;
  if (spot.state === "delivered") return 2;
  if (spot.state === "disputed") return spot.proofSubmittedAt ? 2 : 1;
  if (spot.state === "funded") return 1;
  return 0;
}
