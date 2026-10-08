// Single source of truth for spot lifecycle rules. Mirrors the on-chain program:
// a spot only changes state after the matching transaction is confirmed.

export type SpotState = "open" | "funded" | "delivered" | "disputed" | "settled" | "refunded" | "cancelled";

export type SpotEvent =
  | "claimed"
  | "bid_placed"
  | "outbid"
  | "proof_submitted"
  | "dispute_raised"
  | "dispute_withdrawn"
  | "dispute_resolved"
  | "dispute_timed_out"
  | "seller_paid"
  | "refunded"
  | "closed";

const transitions: Record<SpotState, Partial<Record<SpotEvent, SpotState>>> = {
  open: { claimed: "funded", bid_placed: "funded", closed: "cancelled" },
  funded: {
    outbid: "funded",
    proof_submitted: "delivered",
    dispute_raised: "disputed",
    refunded: "refunded",
  },
  delivered: { dispute_raised: "disputed", seller_paid: "settled", refunded: "refunded" },
  disputed: {
    dispute_withdrawn: "funded",
    dispute_resolved: "settled",
    dispute_timed_out: "refunded",
  },
  settled: {},
  refunded: {},
  cancelled: {},
};

export class InvalidTransitionError extends Error {
  readonly status = 409;
  constructor(readonly from: SpotState, readonly event: SpotEvent) {
    super(`spot cannot go from ${from} via ${event}`);
  }
}

export function nextSpotState(from: SpotState, event: SpotEvent, context: { proofSubmitted?: boolean } = {}): SpotState {
  const to = transitions[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  // On-chain a withdrawn dispute returns to FUNDED; if proof exists the spot is effectively delivered.
  if (event === "dispute_withdrawn" && context.proofSubmitted) return "delivered";
  return to;
}

export function canTransition(from: SpotState, event: SpotEvent): boolean {
  return transitions[from][event] !== undefined;
}

export const terminalSpotStates: ReadonlySet<SpotState> = new Set(["settled", "refunded", "cancelled"]);
