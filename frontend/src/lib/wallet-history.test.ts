import { describe, expect, it } from "vitest";
import type { CreatorDashboard } from "@/lib/api/types";
import { isMoneyEvent, pendingEarnings } from "./wallet-history";

type DashListing = CreatorDashboard["listings"][number];

const spot = (index: number, state: string, amount: string | null, price = "100000000") => ({ id: `s${index}`, index, state, amount, price }) as unknown as DashListing["spots"][number];

const listing = (overrides: Partial<DashListing>): DashListing =>
  ({
    id: "l1",
    title: "laptop lid",
    mode: "fixed",
    feeBps: 500,
    upliftFeeBps: 0,
    maxFeeBps: 500,
    deliveryDueAt: "2026-10-20T00:00:00.000Z",
    reviewWindowSeconds: 72 * 3600,
    spots: [],
    ...overrides,
  }) as DashListing;

describe("pendingEarnings", () => {
  it("lists funded and delivered spots with the net after fee and the payout date", () => {
    const items = pendingEarnings([
      listing({ spots: [spot(0, "funded", "100000000"), spot(1, "delivered", "50000000"), spot(2, "settled", "10"), spot(3, "open", null)] }),
    ]);
    expect(items.map((item) => [item.spotIndex, item.gross, item.fee, item.net, item.needsProof])).toEqual([
      [0, 100_000_000n, 5_000_000n, 95_000_000n, true],
      [1, 50_000_000n, 2_500_000n, 47_500_000n, false],
    ]);
    expect(items[0].payoutAt.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("uses the auction fee rules and sorts by payout date", () => {
    const items = pendingEarnings([
      listing({ id: "late", deliveryDueAt: "2026-11-01T00:00:00.000Z", spots: [spot(0, "delivered", "10000000")] }),
      listing({
        id: "auction",
        mode: "auction",
        feeBps: 250,
        upliftFeeBps: 2000,
        maxFeeBps: 1000,
        spots: [spot(0, "funded", "200000000", "50000000")],
      }),
    ]);
    expect(items.map((item) => item.listingId)).toEqual(["auction", "late"]);
    expect(items[0].fee).toBe(20_000_000n);
  });

  it("leaves the fee unknown without a snapshot", () => {
    const [item] = pendingEarnings([listing({ feeBps: null, upliftFeeBps: null, maxFeeBps: null, spots: [spot(0, "funded", "1000")] })]);
    expect([item.fee, item.net]).toEqual([null, null]);
  });
});

describe("isMoneyEvent", () => {
  it("keeps payments and drops other activity", () => {
    expect(isMoneyEvent({ type: "seller_paid" })).toBe(true);
    expect(isMoneyEvent({ type: "proof_submitted" })).toBe(false);
  });
});
