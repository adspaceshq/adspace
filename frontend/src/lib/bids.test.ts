import { describe, expect, it } from "vitest";
import { canPurchase, minimumNextBid } from "./bids";

const listing = { doubleUp: false, minIncrement: "500000" };

describe("bids", () => {
  it("starts at the spot price, then adds the increment", () => {
    expect(minimumNextBid(listing, { state: "open", price: "1000000", amount: null })).toBe(1000000n);
    expect(minimumNextBid(listing, { state: "funded", price: "1000000", amount: "1500000" })).toBe(2000000n);
  });

  it("doubles for double-up auctions", () => {
    expect(minimumNextBid({ doubleUp: true, minIncrement: "0" }, { state: "funded", price: "1000000", amount: "3000000" })).toBe(6000000n);
  });

  it("only allows purchases on live, open spots", () => {
    const live = { mode: "auction" as const, state: "published" as const, deadline: new Date(Date.now() + 60_000).toISOString() };
    expect(canPurchase(live, { state: "funded" })).toBe(true);
    expect(canPurchase({ ...live, mode: "fixed" }, { state: "funded" })).toBe(false);
    expect(canPurchase({ ...live, deadline: new Date(Date.now() - 1).toISOString() }, { state: "open" })).toBe(false);
  });
});
