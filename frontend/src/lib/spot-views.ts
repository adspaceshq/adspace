import type { SpotLayout } from "@/lib/api/types";

// A spot sits on one of the listing's photos. `layout.view` is that photo's index as a string
// ("1" = second photo); absent (or "0") means the cover, so older spots stay on the cover.

export const MAX_VIEWS = 10;

// The photo index a spot sits on. Anything unreadable or past the last photo falls back to the cover,
// so a spot never disappears when a photo is removed.
export function spotView(layout: Pick<SpotLayout, "view">, photoCount = MAX_VIEWS): number {
  const view = layout.view;
  if (typeof view !== "string" || !/^\d{1,2}$/.test(view)) return 0;
  const index = Number(view);
  return index < Math.min(photoCount, MAX_VIEWS) ? index : 0;
}

// The layout moved to a photo; the cover is stored without a view.
export function withView(layout: SpotLayout, view: number): SpotLayout {
  const rest: SpotLayout = { ...layout };
  delete rest.view;
  return view > 0 ? { ...rest, view: String(view) } : rest;
}

// Drops views that point at the cover or at a photo that no longer exists.
export function normalizeView(layout: SpotLayout, photoCount: number): SpotLayout {
  return withView(layout, spotView(layout, photoCount));
}

export function spotsOnView<T extends { layout: Pick<SpotLayout, "view"> }>(spots: T[], view: number, photoCount = MAX_VIEWS): T[] {
  return spots.filter((spot) => spotView(spot.layout, photoCount) === view);
}

// "lid" / "keyboard deck" for the built-in MacBook mockup photos, otherwise "photo N".
export function viewLabel(index: number, preset?: string): string {
  if (preset?.startsWith("lid-")) return "lid";
  if (preset?.startsWith("inside-")) return "keyboard deck";
  return `photo ${index + 1}`;
}
