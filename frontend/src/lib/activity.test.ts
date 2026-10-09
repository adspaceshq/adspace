import { describe, expect, it } from "vitest";
import type { ActivityItem } from "@/lib/api/types";
import { activityLabel, ago, groupByDay } from "./activity";

const now = new Date(2026, 9, 8, 12).getTime();
const item = (id: string, hoursAgo: number) => ({ id, createdAt: new Date(now - hoursAgo * 3_600_000).toISOString() }) as ActivityItem;

describe("activity", () => {
  it("labels known and unknown events", () => {
    expect(activityLabel("seller_paid")).toBe("payout sent");
    expect(activityLabel("brand_updated")).toBe("brand updated");
  });

  it("formats relative time", () => {
    expect(ago(new Date(now - 30_000).toISOString(), now)).toBe("1m");
    expect(ago(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h");
    expect(ago(new Date(now - 50 * 3_600_000).toISOString(), now)).toBe("2d");
  });

  it("groups into today, yesterday and dates in order", () => {
    const groups = groupByDay([item("a", 1), item("b", 2), item("c", 20), item("d", 80)], now);
    expect(groups.map((group) => [group.day, group.items.map((entry) => entry.id)])).toEqual([
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      [expect.any(String), ["d"]],
    ]);
  });
});
