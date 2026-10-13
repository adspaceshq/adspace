import { describe, expect, it } from "vitest";
import { bucketByWeek, niceCeiling } from "./earnings";

describe("earnings", () => {
  const wednesday = Date.UTC(2026, 9, 7, 15); // Wed 7 Oct 2026

  it("buckets days into Monday-start weeks ending this week", () => {
    const weeks = bucketByWeek(
      [
        { day: "2026-10-05", earned: "1000000" },
        { day: "2026-10-07", earned: "2500000" },
        { day: "2026-09-30", earned: "500000" },
        { day: "2025-01-01", earned: "999000000" },
      ],
      wednesday,
      3,
    );
    expect(weeks.map((week) => week.start.toISOString().slice(0, 10))).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(weeks.map((week) => week.earned)).toEqual([0n, 500000n, 3500000n]);
  });

  it("rounds the axis up to a readable ceiling", () => {
    expect(niceCeiling(0)).toBe(10);
    expect(niceCeiling(3.2)).toBe(5);
    expect(niceCeiling(21)).toBe(25);
    expect(niceCeiling(180)).toBe(200);
  });
});
