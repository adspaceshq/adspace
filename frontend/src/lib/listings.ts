import type { ApiListing, ApiMode, ApiSpot } from "./types";

export interface Bid {
  bidder: string;
  amount: number;
  at: string;
}

export interface Spot {
  id: string;
  label: string;
  location?: string;
  size: string;
  price: number;
  currency?: string;
  bid?: number;
  bidBy?: string;
  bids?: Bid[];
  claimedBy?: string;
  logoColor?: string;
}

export interface MockupSpot {
  id: string;
  x: number;
  y: number;
  w: number;
}

export interface GridCell {
  spot?: string;
  logo?: boolean;
  span: number;
}

export interface MockupView {
  id: string;
  label: string;
  photo?: string;
  spots?: MockupSpot[];
  grid?: GridCell[][];
  dims?: { h: string; v: string };
}

export interface Listing {
  id: string;
  title: string;
  goal: string;
  description: string;
  image: string;
  surface: string;
  seller: { name: string; handle: string; color: string };
  deadline: string;
  endsAt: string;
  priceType: "fixed" | "auction";
  currency?: string;
  minIncrement?: number;
  doubleUp?: boolean;
  spots: Spot[];
  mockup: { views: MockupView[] };
}

export const surfaceLabels: Record<string, string> = {
  gear: "Gear",
  body: "Body",
  physical: "Physical space",
  digital: "Digital space",
  reach: "Reach",
};

export function formatMoney(n: number, currency?: string): string {
  if ((currency ?? "USD").toUpperCase() === "EUR") return "€" + n.toLocaleString("en-US");
  return "$" + n.toLocaleString("en-US");
}

/** Minimum acceptable bid (mirrors backend Store.placeBid). */
export function minBidFor(listing: Listing, spot: Spot): number {
  if (spot.bid == null) return spot.price;
  if (listing.doubleUp) return spot.bid * 2;
  return spot.bid + (listing.minIncrement ?? 10);
}

const SELLER_COLORS = [
  "#4166fb", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

export function sellerColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SELLER_COLORS[h % SELLER_COLORS.length];
}

export function deadlineLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function usableImage(image: string): string {
  return image && !image.startsWith("/demo/") ? image : "";
}

export function apiSpotToUi(s: ApiSpot, mode: ApiMode): Spot {
  const claimed = mode === "fixed" && s.status !== "open" && !!s.buyer;
  const topBid = mode === "auction" ? s.currentBid : undefined;
  const actor = claimed ? s.buyer! : topBid != null ? s.buyer : undefined;
  return {
    id: s.id,
    label: s.label,
    location: s.location || undefined,
    size: s.size,
    price: s.price,
    currency: s.currency,
    bid: topBid ?? (claimed ? s.price : undefined),
    bidBy: mode === "auction" ? s.buyer : undefined,
    bids: s.bids?.map((b) => ({ bidder: b.bidder, amount: b.amount, at: b.at })),
    claimedBy: claimed ? s.buyer : undefined,
    logoColor: actor ? sellerColor(actor) : undefined,
  };
}

export function applyApiSpotToUi(ui: Spot, api: ApiSpot, mode: ApiMode): Spot {
  return { ...ui, ...apiSpotToUi(api, mode), id: ui.id };
}

export function apiListingToUi(a: ApiListing): Listing {
  const image = usableImage(a.image);
  const spots = a.spots.map((s) => apiSpotToUi(s, a.mode));
  const description = a.artworkClose ? `${a.story} (Artwork: ${a.artworkClose}.)` : a.story;
  return {
    id: a.slug,
    title: a.title,
    goal: a.story,
    description,
    image,
    surface: a.surface,
    seller: { name: a.seller, handle: a.sellerHandle, color: sellerColor(a.seller) },
    deadline: deadlineLabel(a.deadline),
    endsAt: a.deadline,
    priceType: a.mode,
    currency: a.currency,
    minIncrement: a.minIncrement,
    doubleUp: a.doubleUp,
    spots,
    mockup: {
      views: [{
        id: "main",
        label: image ? "Overview" : "Spots",
        photo: image || undefined,
        grid: image ? undefined : chunk(spots.map((s) => s.id), 3).map((row) =>
          row.map((spot) => ({ spot, span: Math.max(1, Math.floor(12 / row.length)) })),
        ),
        dims: { h: "", v: "" },
      }],
    },
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function remapMockupIds(
  mockup: Listing["mockup"],
  idMap: Map<string, string>,
): Listing["mockup"] {
  const remap = (id: string) => idMap.get(id) ?? id;
  return {
    views: mockup.views.map((v) => ({
      ...v,
      spots: v.spots?.map((p) => ({ ...p, id: remap(p.id) })),
      grid: v.grid?.map((row) =>
        row.map((c) => ({ ...c, spot: c.spot ? remap(c.spot) : c.spot })),
      ),
    })),
  };
}
