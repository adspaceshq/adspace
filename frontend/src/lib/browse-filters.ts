import type { BrowseFilters, PricingMode, Surface } from "@/lib/api/types";
import { SURFACE_LABELS } from "@/lib/listing-display";

// Shared by the browse page (server, for page 1) and BrowseView (browser, for everything after).
export const BROWSE_PAGE_SIZE = 24;
export const BROWSE_SURFACES = Object.keys(SURFACE_LABELS) as Surface[];
export const BROWSE_SORTS: Array<{ value: NonNullable<BrowseFilters["sort"]>; label: string }> = [
  { value: "closing", label: "closing soon" },
  { value: "newest", label: "newest" },
  { value: "price", label: "lowest price" },
];

// Unknown values fall back to the defaults, so a hand-edited URL never breaks the page.
export function readBrowseFilters(params: Pick<URLSearchParams, "get">): BrowseFilters {
  const surface = params.get("surface") as Surface | null;
  const mode = params.get("mode") as PricingMode | null;
  const sort = params.get("sort") as BrowseFilters["sort"] | null;
  return {
    q: params.get("q") ?? undefined,
    surface: surface && BROWSE_SURFACES.includes(surface) ? surface : undefined,
    mode: mode === "fixed" || mode === "auction" ? mode : undefined,
    sort: sort && BROWSE_SORTS.some((option) => option.value === sort) ? sort : "closing",
  };
}

// The API query for one page of results; the same string on the server and in the browser.
export function browseQuery(filters: BrowseFilters, limit: number, offset: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, limit, offset })) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}
