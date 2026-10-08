import { describe, expect, it } from "vitest";
import type { OwnedListing } from "@/lib/api/types";
import { emptyWizard, fromOwnedListing, templateSpots, toDraftInput, validateStep } from "./sell-draft";

const NOW = Date.UTC(2026, 9, 8, 12);

describe("sell draft", () => {
  it("starts each surface from a sensible spot grid", () => {
    expect(templateSpots("laptop")).toHaveLength(6);
    expect(templateSpots("suitcase")).toHaveLength(2);
    expect(templateSpots("laptop").every((spot) => spot.layout.x >= 0 && spot.layout.x <= 100)).toBe(true);
  });

  it("validates each step with specific messages", () => {
    const state = emptyWizard("laptop", NOW);
    expect(validateStep("basics", state, NOW)).toMatchObject({ title: expect.any(String), photos: expect.any(String) });
    const filled = { ...state, title: "Lid at Token2049", photos: [{ assetId: "a1", url: "https://x/y.jpg" }] };
    expect(validateStep("basics", filled, NOW)).toEqual({});
    expect(validateStep("spots", { ...filled, spots: [{ ...filled.spots[0], price: "abc" }] }, NOW)).toHaveProperty("spot-0");
    expect(validateStep("pricing", { ...filled, mode: "auction", minIncrement: "0" }, NOW)).toHaveProperty("minIncrement");
    expect(validateStep("pricing", { ...filled, deadline: "2026-10-08T12:10" }, NOW)).toHaveProperty("deadline");
  });

  it("builds the API draft with base-unit-safe prices and computed delivery date", () => {
    const state = {
      ...emptyWizard("laptop", NOW),
      title: "  Lid  ",
      followers: "12400",
      event: "Token2049",
      photos: [{ assetId: "a1", url: "https://x/y.jpg" }],
      deadline: "2026-10-15T18:00",
      deliveryDays: "5",
    };
    const draft = toDraftInput(state);
    expect(draft.title).toBe("Lid");
    expect(draft.audience).toEqual({ followers: 12400, event: "Token2049" });
    expect(draft.photoAssetIds).toEqual(["a1"]);
    expect(new Date(draft.deliveryDueAt!).getTime() - new Date(draft.deadline).getTime()).toBe(5 * 24 * 60 * 60 * 1000);
    expect(draft.minIncrement).toBeUndefined();
  });

  it("round-trips a saved draft back into the wizard", () => {
    const listing = {
      surface: "car",
      title: "Car door",
      description: "",
      audience: { location: "Denver" },
      mode: "auction",
      minIncrement: "500000",
      doubleUp: false,
      deadline: "2026-10-20T10:00:00.000Z",
      deliveryDueAt: "2026-10-27T10:00:00.000Z",
      photos: [{ id: "a9", url: "https://x/car.jpg", width: 1, height: 1 }],
      spots: [{ id: "s1", label: "door", price: "25000000", layout: { x: 40, y: 50, w: 20 } }],
    } as unknown as OwnedListing;
    const state = fromOwnedListing(listing);
    expect(state.photos).toEqual([{ assetId: "a9", url: "https://x/car.jpg" }]);
    expect(state.spots[0].price).toBe("25");
    expect(state.minIncrement).toBe("0.5");
    expect(state.deliveryDays).toBe("7");
  });
});
