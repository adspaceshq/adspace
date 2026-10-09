import { describe, expect, it } from "vitest";
import { compactCount, headlineMetric } from "./post-display";

const metrics = { views: null, likes: null, reposts: null, replies: null, bookmarks: null, source: "manual", capturedAt: "2026-10-08T00:00:00Z" };

describe("post display", () => {
  it("compacts counts", () => {
    expect(compactCount(950)).toBe("950");
    expect(compactCount(48_200)).toBe("48.2k");
    expect(compactCount(2_000_000)).toBe("2m");
  });

  it("picks the strongest metric that has a value", () => {
    expect(headlineMetric(null)).toBeNull();
    expect(headlineMetric(metrics)).toBeNull();
    expect(headlineMetric({ ...metrics, views: 48_200, likes: 900 })).toEqual({ value: "48.2k", label: "views" });
    expect(headlineMetric({ ...metrics, views: 0, likes: 900 })).toEqual({ value: "900", label: "likes" });
  });
});
