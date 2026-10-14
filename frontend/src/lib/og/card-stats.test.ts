import { describe, expect, it } from "vitest";
import type { PublicSpot } from "@/lib/api/types";
import { closingLabel, listingCardStats, spotsLine } from "./card-stats";

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

const NOW = Date.parse("2026-10-13T11:00:00Z");

describe("listing share card stats", () => {
  it("says every auction spot has a bid instead of claiming they are left", () => {
    const listing = {
      mode: "auction" as const,
      state: "published" as const,
      deadline: "2026-10-13T13:41:00Z",
      spots: [spot({ state: "funded", amount: "5000000" }), spot({ state: "funded", amount: "5000000" })],
    };
    expect(listingCardStats(listing, NOW)).toEqual({
      price: { label: "top bid", amount: "5000000" },
      spots: "all 2 spots have bids",
      oversubscribed: 400,
      closing: { text: "closes in 2h 41m", urgent: true },
    });
  });

  it("splits auction spots into bid on and open", () => {
    expect(spotsLine({ mode: "auction", spots: [spot({ state: "funded", amount: "2000000" }), spot({}), spot({})] })).toBe("1 with bids · 2 open");
    expect(spotsLine({ mode: "auction", spots: [spot({ state: "funded", amount: "2000000" })] })).toBe("all 1 spot has bids");
  });

  it("counts fixed price spots left and sold out", () => {
    expect(spotsLine({ mode: "fixed", spots: [spot({}), spot({}), spot({ state: "funded", amount: "1000000" })] })).toBe("2 of 3 spots left");
    expect(spotsLine({ mode: "fixed", spots: [spot({}), spot({})] })).toBe("2 spots left");
    expect(spotsLine({ mode: "fixed", spots: [spot({ state: "settled", amount: "1000000" }), spot({ state: "cancelled" })] })).toBe("sold out");
    expect(spotsLine({ mode: "fixed", spots: [] })).toBeNull();
  });

  it("shows a coarse countdown, a date when far off, and closed when over", () => {
    const base = { mode: "auction" as const, state: "published" as const };
    expect(closingLabel({ ...base, deadline: "2026-10-14T15:30:00Z" }, NOW)).toEqual({ text: "closes in 1d 4h", urgent: false });
    expect(closingLabel({ ...base, deadline: "2026-10-13T11:20:00Z" }, NOW)).toEqual({ text: "closes in 20m", urgent: true });
    expect(closingLabel({ ...base, deadline: "2026-10-20T09:00:00Z" }, NOW)).toEqual({ text: "closes Oct 20", urgent: false });
    expect(closingLabel({ ...base, deadline: "2026-10-12T09:00:00Z" }, NOW)).toEqual({ text: "bidding closed", urgent: false });
    expect(closingLabel({ ...base, state: "closed", deadline: "2026-10-20T09:00:00Z" }, NOW)?.text).toBe("bidding closed");
    expect(closingLabel({ ...base, state: "draft", deadline: "2026-10-20T09:00:00Z" }, NOW)).toBeNull();
  });
});
