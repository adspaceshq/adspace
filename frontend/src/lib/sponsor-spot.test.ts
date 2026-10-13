import { describe, expect, it } from "vitest";
import { nextStepOf, outcomeOf, progressOf, spentOn, type SponsorSpot } from "./sponsor-spot";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-13T12:00:00Z");
const at = (offset: number) => new Date(NOW + offset).toISOString();

const settlement = (kind: NonNullable<SponsorSpot["settlement"]>["kind"], refund: string, net: string, fee: string): SponsorSpot["settlement"] => ({
  kind,
  gross: (BigInt(refund) + BigInt(net) + BigInt(fee)).toString(),
  buyerRefund: refund,
  sellerNet: net,
  fee,
  settledAt: at(0),
});

const listing = (overrides: Partial<SponsorSpot["listing"]> = {}): SponsorSpot["listing"] => ({
  id: "l",
  slug: "s",
  title: "t",
  mode: "fixed",
  deadline: at(-HOUR),
  deliveryDueAt: at(24 * HOUR),
  sellerHandle: "maker",
  photos: [],
  ...overrides,
});

describe("sponsor spot outcome", () => {
  it("explains a dispute split and counts only the kept part as spent", () => {
    const spot = { state: "settled" as const, amount: "1100000", settlement: settlement("dispute_split", "550000", "522500", "27500") };
    expect(outcomeOf(spot)?.text).toBe("dispute split: $0.55 refunded, $0.55 paid");
    expect(spentOn(spot)).toBe(550_000n);
  });

  it("explains payouts and refunds", () => {
    expect(outcomeOf({ state: "settled", settlement: settlement("payout", "0", "1045000", "55000") })?.text).toBe("delivered · paid to creator");
    expect(outcomeOf({ state: "refunded", settlement: settlement("refund", "1100000", "0", "0") })?.text).toBe("delivery missed · refunded $1.10");
    expect(outcomeOf({ state: "refunded", settlement: settlement("timeout_refund", "1100000", "0", "0") })?.text).toBe("dispute timed out · refunded $1.10");
    expect(spentOn({ amount: "1100000", settlement: settlement("refund", "1100000", "0", "0") })).toBe(0n);
  });

  it("has no outcome while active and counts escrow as spent", () => {
    expect(outcomeOf({ state: "funded", settlement: null })).toBeNull();
    expect(spentOn({ amount: "1100000", settlement: null })).toBe(1_100_000n);
  });
});

describe("sponsor spot next step", () => {
  it("counts down to delivery, then flags a missed delivery", () => {
    expect(nextStepOf({ state: "funded", reviewUntil: null, listing: listing() }, NOW)?.countdown?.prefix).toBe("delivery due in");
    expect(nextStepOf({ state: "funded", reviewUntil: null, listing: listing({ deliveryDueAt: at(-HOUR) }) }, NOW)?.tone).toBe("warning");
  });

  it("shows the bidding deadline for a leading auction bid", () => {
    const step = nextStepOf({ state: "funded", reviewUntil: null, listing: listing({ mode: "auction", deadline: at(HOUR) }) }, NOW);
    expect(step?.countdown?.to).toBe(at(HOUR));
  });

  it("asks for a review while the window is open", () => {
    expect(nextStepOf({ state: "delivered", reviewUntil: at(HOUR), listing: listing() }, NOW)?.tone).toBe("action");
    expect(nextStepOf({ state: "delivered", reviewUntil: at(-HOUR), listing: listing() }, NOW)?.countdown).toBeUndefined();
  });

  it("tracks progress through paid, delivered, complete", () => {
    expect(progressOf({ state: "funded", proofSubmittedAt: null })).toBe(1);
    expect(progressOf({ state: "disputed", proofSubmittedAt: null })).toBe(1);
    expect(progressOf({ state: "disputed", proofSubmittedAt: at(0) })).toBe(2);
    expect(progressOf({ state: "settled", proofSubmittedAt: at(0) })).toBe(3);
  });
});
