import { describe, expect, it } from "vitest";
import type { PublicSpot } from "@/lib/api/types";
import { formatFollowers, listingHref, oversubscription, priceSummary, spotsLeft, spotsWithBids } from "./listing-display";

const spot = (overrides: Partial<PublicSpot>): PublicSpot => ({
  id: crypto.randomUUID(),
  index: 0,
  label: "",
  price: "1000000",
  layout: { x: 0, y: 0, w: 10 },
  brand: null,
  state: "open",
  amount: null,
  taken: false,
  ...overrides,
});

describe("listing display helpers", () => {
  it("summarises fixed prices by the cheapest open spot", () => {
    const listing = { mode: "fixed" as const, spots: [spot({ price: "2000000" }), spot({ price: "1500000" }), spot({ price: "900000", state: "funded" })] };
    expect(priceSummary(listing)).toEqual({ label: "from", amount: "1500000" });
    expect(spotsLeft(listing)).toBe(2);
  });

  it("counts auction spots with bids apart from open ones, and the oversubscription", () => {
    const listing = {
      mode: "auction" as const,
      spots: [spot({ price: "1000000", state: "funded", amount: "1000000" }), spot({ price: "1000000", state: "funded", amount: "3000000" }), spot({ price: "2000000" })],
    };
    expect(spotsLeft(listing)).toBe(1);
    expect(spotsWithBids(listing)).toBe(2);
    // start 4.00, current 1 + 3 + 2 = 6.00, so 50% over.
    expect(oversubscription(listing)).toBe(50);
    expect(oversubscription({ spots: [spot({ price: "1000000", state: "funded", amount: "1000000" })] })).toBe(0);
  });

  it("summarises auctions by the top live bid, else the starting price", () => {
    expect(priceSummary({ mode: "auction", spots: [spot({ price: "1000000" })] })).toEqual({ label: "bids from", amount: "1000000" });
    expect(
      priceSummary({ mode: "auction", spots: [spot({ state: "funded", amount: "3000000" }), spot({ state: "funded", amount: "4500000" })] }),
    ).toEqual({ label: "top bid", amount: "4500000" });
  });

  it("returns null when nothing is left", () => {
    expect(priceSummary({ mode: "fixed", spots: [spot({ state: "settled" })] })).toBeNull();
  });

  it("formats handles and follower counts", () => {
    expect(listingHref("@alice", "laptop-1")).toBe("/@alice/laptop-1");
    expect(formatFollowers(12400)).toBe("12k");
    expect(formatFollowers(5300)).toBe("5.3k");
    expect(formatFollowers(undefined)).toBeNull();
  });
});
