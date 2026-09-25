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
  /** Which Mac photo the sticker lives on: "lid" or "inside". */
  view?: string;
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

/* Mac photos (public/mac/). The lid and the top-down deck shot are both sticker surfaces on the gear
 * spec sheet; the open shot is only the card hero. */
export const MAC_LID_PHOTO = "/mac/macbook.png";
export const MAC_HERO_PHOTO = "/mac/macbook-open.png";
export const MAC_INSIDE_PHOTO = "/mac/mac-inside.png";

/**
 * Spec-sheet view ids. A sticker lives on exactly one view — the lid (`LID_VIEW_ID`) or the deck
 * (`INSIDE_VIEW_ID`) — because the two crops lay out differently, so each view owns its own
 * coordinates. A spot with no view recorded is a lid spot: that was every spot before the deck view.
 */
export const LID_VIEW_ID = "main";
export const INSIDE_VIEW_ID = "inside";

/**
 * Sticker slots on the lid photo, in % of the image. Rows sit 34% apart — enough for a
 * sticker plus its price caption even on a phone — and the Apple logo near 50%/47% stays clear.
 */
const MAC_LID_SLOTS = [
  { x: 50, y: 16 }, // 0  top centre
  { x: 16, y: 16 }, // 1  top left
  { x: 84, y: 16 }, // 2  top right
  { x: 16, y: 50 }, // 3  mid left
  { x: 84, y: 50 }, // 4  mid right
  { x: 16, y: 84 }, // 5  bottom left
  { x: 50, y: 84 }, // 6  bottom centre
  { x: 84, y: 84 }, // 7  bottom right
  { x: 33, y: 33 }, // 8  upper left shoulder
  { x: 67, y: 33 }, // 9  upper right shoulder
  { x: 33, y: 67 }, // 10 lower left hip
  { x: 67, y: 67 }, // 11 lower right hip
];

/** Slot order per spot count, so few spots spread across the lid instead of clustering. */
const MAC_LID_LAYOUTS = [
  [0],
  [1, 2],
  [1, 0, 2],
  [1, 2, 3, 4],
  [1, 0, 2, 3, 4],
  [1, 2, 3, 4, 5, 7],
  [1, 2, 0, 3, 4, 5, 7],
  [1, 2, 0, 3, 4, 5, 6, 7],
];

const MAC_LID_INNER = [8, 9, 10, 11];

function lidSlots(n: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const order =
    n <= MAC_LID_LAYOUTS.length
      ? MAC_LID_LAYOUTS[n - 1]
      : [...MAC_LID_LAYOUTS[MAC_LID_LAYOUTS.length - 1], ...MAC_LID_INNER];
  return Array.from({ length: n }, (_, i) => {
    if (i < order.length) return MAC_LID_SLOTS[order[i]];
    // Past twelve spots the lid is full — reuse the inner slots, nudged down.
    const p = MAC_LID_SLOTS[MAC_LID_INNER[i % MAC_LID_INNER.length]];
    return { x: p.x, y: Math.min(88, p.y + 8) };
  });
}

/*
 * Sticker slots on the deck photo, in % of the image. The deck is the second sticker surface, so it
 * gets its own preset points the same way the lid does — palm rests first, then the strips beside the
 * trackpad and the speaker grilles — leaving the keyboard and the trackpad itself clear.
 */
const MAC_INSIDE_SLOTS = [
  { x: 15, y: 80 }, // 0  left palm rest
  { x: 85, y: 80 }, // 1  right palm rest
  { x: 14, y: 62 }, // 2  left, beside the trackpad
  { x: 86, y: 62 }, // 3  right, beside the trackpad
  { x: 7, y: 28 }, //  4  left speaker strip
  { x: 93, y: 28 }, // 5  right speaker strip
];

function insideSlots(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const slot = MAC_INSIDE_SLOTS[i % MAC_INSIDE_SLOTS.length];
    const wrap = Math.floor(i / MAC_INSIDE_SLOTS.length);
    // Past six spots the deck is full — stack the extras just below their slot rather than on top of it.
    return wrap ? { x: slot.x, y: Math.min(88, slot.y + 5 * wrap) } : slot;
  });
}

/* Photo aspect ratios. Stickers are square in pixels, so a width in % of a photo becomes a height in %
 * of that same photo via the photo's own ratio — and the two Mac shots have different crops. */
const MAC_LID_AR = 1484 / 1060;
const MAC_INSIDE_AR = 1402 / 1122;

/**
 * A sticker the seller positioned or sized by hand, in % of the photo it sits on. Omitted fields fall back
 * to the auto layout — no `x`/`y` keeps the preset slot, no `w` keeps the auto width — so a sticker can be
 * moved without being resized, and resized without being moved.
 */
export type LidPlacement = { x?: number; y?: number; w?: number };

/** A concrete point on a photo, in % of that photo. */
type LidPoint = { x: number; y: number };

/** Sticker width bounds, in % of the photo, for the seller's resize handle. */
export const STICKER_MIN_W = 6;
export const STICKER_MAX_W = 34;

/** Keep a hand-picked sticker width inside the range a photo can actually hold. */
export function clampStickerWidth(w: number): number {
  if (!Number.isFinite(w)) return STICKER_MIN_W;
  return Math.min(STICKER_MAX_W, Math.max(STICKER_MIN_W, w));
}

/** Keep a hand-placed sticker (and the price caption under it) on its photo instead of hanging off an edge. */
function clampToPhoto({ x, y }: LidPoint, w: number, ar: number): LidPoint {
  const half = w / 2;
  const halfHeight = (w * ar) / 2;
  return {
    x: Math.min(100 - half - 1, Math.max(half + 1, x)),
    // The caption sits below the sticker, so leave it room at the bottom edge.
    y: Math.min(100 - halfHeight - 9, Math.max(halfHeight + 1, y)),
  };
}

/** Pointer position → % of the photo the seller clicked, for the click-to-place editor. */
export function lidPointFromPointer(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): LidPoint {
  const pct = (offset: number, size: number) => (size <= 0 ? 50 : (offset / size) * 100);
  return {
    x: Math.min(100, Math.max(0, pct(clientX - rect.left, rect.width))),
    y: Math.min(100, Math.max(0, pct(clientY - rect.top, rect.height))),
  };
}

/**
 * Auto sticker width, in % of the photo: a single row can be big, but once rows stack the stickers
 * shrink so each sticker and the price caption under it stay in their lane even on a phone.
 */
function autoStickerWidth(count: number): number {
  const maxW = count <= 3 ? 18 : 13;
  return Math.min(maxW, Math.max(9, 108 / Math.max(1, count)));
}

/** Photo mockup: spots as stickers on the MacBook lid, price caption below each. */
export function gearPhotoView(spotIds: string[], placements?: Record<string, LidPlacement>): MockupView {
  const slots = lidSlots(spotIds.length);
  const autoW = autoStickerWidth(spotIds.length);
  return {
    id: LID_VIEW_ID,
    label: "MacBook lid",
    photo: MAC_LID_PHOTO,
    // Per spot: a hand-picked width beats the auto width, a hand-picked point beats the preset slot.
    // Everything untouched auto-lays out exactly as before.
    spots: spotIds.map((id, i) => {
      const placed = placements?.[id];
      const w = clampStickerWidth(placed?.w ?? autoW);
      const point =
        placed?.x != null && placed?.y != null
          ? clampToPhoto({ x: placed.x, y: placed.y }, w, MAC_LID_AR)
          : slots[i];
      return { id, x: point.x, y: point.y, w };
    }),
    dims: { h: "", v: "" },
  };
}

/**
 * Deck mockup: the same sticker treatment as the lid, on the top-down flat-lay of the keyboard deck.
 * It is a sticker surface in its own right — the seller can drop spots here — so it always carries a
 * `spots` list, empty when nothing lives on the deck. That list is what tells `SpecSheet` a view
 * accepts clicks (and, on a buyer's page, that a view has a claimed count to report).
 */
export function gearInsideView(spotIds: string[] = [], placements?: Record<string, LidPlacement>): MockupView {
  const slots = insideSlots(spotIds.length);
  const autoW = autoStickerWidth(spotIds.length);
  return {
    id: INSIDE_VIEW_ID,
    label: "MacBook inside",
    photo: MAC_INSIDE_PHOTO,
    spots: spotIds.map((id, i) => {
      const placed = placements?.[id];
      const w = clampStickerWidth(placed?.w ?? autoW);
      const point =
        placed?.x != null && placed?.y != null
          ? clampToPhoto({ x: placed.x, y: placed.y }, w, MAC_INSIDE_AR)
          : slots[i];
      return { id, x: point.x, y: point.y, w };
    }),
    dims: { h: "", v: "" },
  };
}

/** Card thumbnail: the listing's own photo, else the MacBook hero shot (gear is the only surface the listing flow creates today). */
export function cardPhoto(listing: { image: string; surface?: string }): string {
  if (listing.image) return listing.image;
  return !listing.surface || listing.surface === "gear" ? MAC_HERO_PHOTO : "";
}

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
    view: s.view === "inside" ? "inside" : "lid",
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
  // Stickers live on exactly one photo: the lid gets every non-inside spot, the deck only its own.
  const lidIds = spots.filter((s) => s.view !== "inside").map((s) => s.id);
  const deckIds = spots.filter((s) => s.view === "inside").map((s) => s.id);
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
      views: image
        ? [{ id: "main", label: "Overview", photo: image, dims: { h: "", v: "" } }]
        : a.surface === "gear"
          ? [gearPhotoView(lidIds), gearInsideView(deckIds)]
          : [{
              id: "main",
              label: "Spots",
              grid: chunk(spots.map((s) => s.id), 3).map((row) =>
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
