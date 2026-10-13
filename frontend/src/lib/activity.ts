import type { ActivityItem } from "@/lib/api/types";

const LABELS: Record<string, string> = {
  claimed: "spot claimed",
  bid_placed: "new bid",
  outbid: "new top bid",
  proof_submitted: "proof submitted",
  dispute_raised: "dispute opened",
  dispute_withdrawn: "dispute withdrawn",
  dispute_resolved: "dispute resolved",
  dispute_timed_out: "dispute timed out",
  seller_paid: "payout sent",
  refunded: "refund sent",
  closed: "spot closed",
};

export const activityLabel = (type: string) => LABELS[type] ?? type.replace(/_/g, " ");

export function ago(iso: string, now: number): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

// "today", "yesterday", or a date, in the viewer's time zone; groups keep feed order.
export function groupByDay(items: ActivityItem[], now: number): Array<{ day: string; items: ActivityItem[] }> {
  const key = (time: number) => new Date(time).toDateString();
  const today = key(now);
  const yesterday = key(now - 86_400_000);
  const groups: Array<{ day: string; items: ActivityItem[] }> = [];
  for (const item of items) {
    const time = new Date(item.createdAt).getTime();
    const day = key(time) === today ? "today" : key(time) === yesterday ? "yesterday" : new Date(time).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
