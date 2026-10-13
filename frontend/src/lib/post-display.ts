import type { Post, PostMetrics } from "@/lib/api/types";

export const POST_SOURCE: Record<Post["kind"], string> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  link: "link",
  photo: "photo",
  text: "update",
};

export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString("en-US");
}

// The single most impressive number on a post, for headlines and share cards.
export function headlineMetric(metrics: PostMetrics | null): { value: string; label: string } | null {
  if (!metrics) return null;
  const order: Array<[keyof PostMetrics, string]> = [
    ["views", "views"],
    ["likes", "likes"],
    ["reposts", "reposts"],
    ["replies", "replies"],
  ];
  for (const [key, label] of order) {
    const value = metrics[key];
    if (typeof value === "number" && value > 0) return { value: compactCount(value), label };
  }
  return null;
}
