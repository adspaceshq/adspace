import { describe, expect, it } from "vitest";
import { normalizeView, spotsOnView, spotView, viewLabel, withView } from "./spot-views";

const at = (view?: string) => ({ x: 10, y: 10, w: 10, ...(view === undefined ? {} : { view }) });

describe("spot views", () => {
  it("reads the photo index, treating missing or bad views as the cover", () => {
    expect(spotView(at())).toBe(0);
    expect(spotView(at("0"))).toBe(0);
    expect(spotView(at("1"))).toBe(1);
    expect(spotView(at("lid"))).toBe(0);
    expect(spotView(at("-1"))).toBe(0);
    expect(spotView(at("1.5"))).toBe(0);
  });

  it("falls back to the cover when the photo is gone", () => {
    expect(spotView(at("2"), 3)).toBe(2);
    expect(spotView(at("2"), 2)).toBe(0);
    expect(spotView(at("1"), 0)).toBe(0);
  });

  it("stores the cover without a view", () => {
    expect(withView(at("2"), 0)).toEqual(at());
    expect(withView(at(), 1)).toEqual(at("1"));
    expect(normalizeView(at("0"), 2)).toEqual(at());
    expect(normalizeView(at("3"), 2)).toEqual(at());
    expect(normalizeView(at("1"), 2)).toEqual(at("1"));
  });

  it("filters spots to one photo", () => {
    const spots = [{ id: "a", layout: at() }, { id: "b", layout: at("1") }, { id: "c", layout: at("0") }, { id: "d", layout: at("4") }];
    expect(spotsOnView(spots, 0).map((spot) => spot.id)).toEqual(["a", "c"]);
    expect(spotsOnView(spots, 1).map((spot) => spot.id)).toEqual(["b"]);
    expect(spotsOnView(spots, 0, 2).map((spot) => spot.id)).toEqual(["a", "c", "d"]);
  });

  it("names mockup photos after the part of the laptop", () => {
    expect(viewLabel(0, "lid-silver")).toBe("lid");
    expect(viewLabel(1, "inside-midnight")).toBe("keyboard deck");
    expect(viewLabel(2)).toBe("surface 3");
  });
});
