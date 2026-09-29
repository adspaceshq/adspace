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
  /** Which photo the sticker lives on: "lid" | "inside" (Mac) or "tee-front" | "tee-back" | "tee-left" | "tee-right" (T-shirt). */
  view?: string;
  /** Buyer brand assets attached at purchase (from the server echo). */
  logoImage?: string;
  website?: string;
  /** Seller hand placement in % of the photo. Absent → auto layout. */
  x?: number;
  y?: number;
  w?: number;
  bid?: number;
  bidBy?: string;
  bids?: Bid[];
  claimedBy?: string;
  logoColor?: string;
  /** Approved (sold) — the only state that accepts artwork intake. */
  sold?: boolean;
  /** When the buyer submitted final artwork (Step 7 intake). */
  artworkSubmittedAt?: string;
  /** When the seller marked the campaign delivered (Step 8). */
  fulfilledAt?: string;
  /** Delivery evidence photos pinned by the seller (Step 9 proof). */
  proofPhotos?: string[];
  /** X post distributing the delivered campaign. */
  proofPost?: string;
  /** Buyer receipt: confirmed delivery (early payout release). */
  confirmedAt?: string;
  /** Open buyer dispute (blocks payout until withdrawn). */
  disputedAt?: string;
  disputeReason?: string;
  /** Manual-USDC payout record (reviewer-posted transfer signature). */
  paidAt?: string;
  payoutAmount?: number;
  payoutFee?: number;
  payoutReference?: string;
  payoutDestination?: string;
  chainTransaction?: string;
}

/** Price uplift for a contested auction spot. A single opening bid is not oversubscription. */
export function spotOversubscription(spot: Spot): number {
  const bidCount = spot.bids?.length ?? (spot.bid != null ? 1 : 0);
  if (bidCount < 2 || !spot.bid || spot.price <= 0) return 0;
  return Math.max(0, Math.round(((spot.bid - spot.price) / spot.price) * 100));
}

/** Solana tx signatures are 64 raw bytes → 87–88 base58 chars. */
export function isSignatureLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value);
}

export function explorerTxUrl(signature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
  const base = `https://explorer.solana.com/tx/${signature}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}

/** Lazy 3-day review window from fulfillment (mirrors the API rule). */
export const REVIEW_WINDOW_MS = 3 * 86_400_000;

/** Payout-releasable: undisputed AND (confirmed OR the window elapsed). */
export function payoutReleased(spot: { fulfilledAt?: string; confirmedAt?: string; disputedAt?: string }): boolean {
  if (!spot.fulfilledAt) return false;
  if (spot.disputedAt) return false;
  if (spot.confirmedAt) return true;
  return new Date(spot.fulfilledAt).getTime() + REVIEW_WINDOW_MS <= Date.now();
}

/** Whole days left in the buyer's review window (0 once elapsed). */
export function reviewDaysLeft(fulfilledAt: string | undefined): number {
  if (!fulfilledAt) return 0;
  const t = new Date(fulfilledAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t + REVIEW_WINDOW_MS - Date.now()) / 86_400_000));
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
  /** Flat-photo tint (#rrggbb): the seller's tee base color, multiplied over the white flat art. */
  tint?: string;
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
  /** Tee base color (#rrggbb) chosen by the seller. */
  fabric?: string;
  seller: { name: string; handle: string; color: string };
  deadline: string;
  endsAt: string;
  /** Artwork due ISO date (empty = none). */
  artworkClose?: string;
  priceType: "fixed" | "auction";
  currency?: string;
  minIncrement?: number;
  doubleUp?: boolean;
  status?: "active" | "approved" | "submitted" | "closed";
  spots: Spot[];
  mockup: { views: MockupView[] };
}

export const surfaceLabels: Record<string, string> = {
  gear: "Gear",
  apparel: "T-shirt",
  body: "Body",
  physical: "Physical space",
  digital: "Digital space",
  reach: "Reach",
};

/** Seller-offered tee base colors. */
export const FABRIC_PRESETS = [
  { key: "white", label: "White", hex: "#f6f6f7" },
  { key: "black", label: "Black", hex: "#1b1b20" },
  { key: "navy", label: "Navy", hex: "#24406b" },
  { key: "forest", label: "Forest", hex: "#33503c" },
  { key: "sand", label: "Sand", hex: "#e7d9c3" },
] as const;

export const DEFAULT_FABRIC = FABRIC_PRESETS[0].hex;

/** Any strict #rrggbb, else the default white — mirrors the backend's parseFabric verbatim. */
export function normalizeFabric(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_FABRIC;
  const hex = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_FABRIC;
}

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
 * Sticker slots on the lid photo, in % of the image. Rows sit 30% apart — enough for a
 * sticker plus its price caption even on a phone — the top row keeps a clear gap below the
 * lid's top edge, the bottom row keeps the caption on the lid, and the Apple logo near
 * 50%/47% stays clear.
 */
const MAC_LID_SLOTS = [
  { x: 50, y: 20 }, // 0  top centre
  { x: 16, y: 20 }, // 1  top left
  { x: 84, y: 20 }, // 2  top right
  { x: 16, y: 50 }, // 3  mid left
  { x: 84, y: 50 }, // 4  mid right
  { x: 16, y: 77 }, // 5  bottom left
  { x: 50, y: 77 }, // 6  bottom centre
  { x: 84, y: 77 }, // 7  bottom right
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
    // Past twelve spots the lid is full — reuse the inner slots, nudged down but still clear of the bottom edge.
    const p = MAC_LID_SLOTS[MAC_LID_INNER[i % MAC_LID_INNER.length]];
    return { x: p.x, y: Math.min(78, p.y + 8) };
  });
}

/*
 * Sticker slots on the deck photo, in % of the image. The deck is the second sticker surface, so it
 * gets its own preset points the same way the lid does — palm rests first, then the strips beside the
 * trackpad and the speaker grilles — leaving the keyboard and the trackpad itself clear.
 */
const MAC_INSIDE_SLOTS = [
  { x: 15, y: 73 }, // 0  left palm rest
  { x: 85, y: 73 }, // 1  right palm rest
  { x: 14, y: 58 }, // 2  left, beside the trackpad
  { x: 86, y: 58 }, // 3  right, beside the trackpad
  { x: 7, y: 28 }, //  4  left speaker strip
  { x: 93, y: 28 }, // 5  right speaker strip
];

function insideSlots(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const slot = MAC_INSIDE_SLOTS[i % MAC_INSIDE_SLOTS.length];
    const wrap = Math.floor(i / MAC_INSIDE_SLOTS.length);
    // Past six spots the deck is full — stack the extras just below their slot, still clear of the bottom edge.
    return wrap ? { x: slot.x, y: Math.min(76, slot.y + 5 * wrap) } : slot;
  });
}

/** Minimal draft shape for layout helpers: which photo, plus any hand placement. */
export interface DraftSpot {
  view?: string;
  x?: number;
  y?: number;
  w?: number;
}

/**
 * Freeze the auto layout into explicit points: every draft without a hand-picked
 * x/y keeps the exact slot it sits on right now, so adding or removing a sticker
 * never teleports the ones already placed. Width stays auto until resized by hand.
 * Slots are per view: Mac lid / deck keep their own layouts, each tee angle its own.
 */
export function pinDraftPositions<T extends DraftSpot>(drafts: T[], unlabeledView?: string): T[] {
  // Bucket per view so each photo lays out only its own stickers; a draft with
  // no view yet belongs to the caller's working view (lid for Mac, front for tee).
  const orders: Record<string, number[]> = {};
  drafts.forEach((d, i) => {
    const key = d.view ?? unlabeledView ?? LID_VIEW_ID;
    (orders[key] ??= []).push(i);
  });
  const slotsByView: Record<string, { x: number; y: number }[]> = {};
  for (const key of Object.keys(orders)) {
    slotsByView[key] =
      key === INSIDE_VIEW_ID
        ? insideSlots(orders[key].length)
        : key === TEE_FRONT_VIEW_ID || key === TEE_BACK_VIEW_ID || key === TEE_LEFT_VIEW_ID || key === TEE_RIGHT_VIEW_ID
          ? teeSlots(orders[key].length, key)
          : lidSlots(orders[key].length);
  }
  const slotFor = (d: T, i: number) => {
    const key = d.view ?? unlabeledView ?? LID_VIEW_ID;
    const slots = slotsByView[key];
    return slots[orders[key].indexOf(i)];
  };
  return drafts.map((d, i) => {
    if (d.x != null && d.y != null) return d;
    return { ...d, x: slotFor(d, i)?.x ?? 50, y: slotFor(d, i)?.y ?? 50 };
  });
}

/**
 * Pick a home for a toolbar-added sticker: the preset slot farthest from every
 * sticker already on that view, so it lands in open space instead of a pile.
 */
export function freeSlotOnView(taken: LidPoint[], viewId: string): LidPoint {
  const slots =
    viewId === INSIDE_VIEW_ID
      ? MAC_INSIDE_SLOTS
      : viewId === TEE_BACK_VIEW_ID
        ? TEE_BACK_SLOTS
        : viewId === TEE_LEFT_VIEW_ID || viewId === TEE_RIGHT_VIEW_ID
          ? TEE_SIDE_SLOTS
          : viewId === TEE_FRONT_VIEW_ID
            ? TEE_FRONT_SLOTS
            : MAC_LID_SLOTS;
  let best = slots[0];
  let bestDistance = -1;
  for (const slot of slots) {
    const nearest = taken.length
      ? Math.min(...taken.map((t) => Math.hypot(t.x - slot.x, t.y - slot.y)))
      : Infinity;
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = slot;
    }
  }
  return { x: best.x, y: best.y };
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
export type LidPoint = { x: number; y: number };

/** Sticker width bounds, in % of the photo, for the seller's resize handle. */
export const STICKER_MIN_W = 6;
export const STICKER_MAX_W = 34;

/** Keep a hand-picked sticker width inside the range a photo can actually hold. */
export function clampStickerWidth(w: number): number {
  if (!Number.isFinite(w)) return STICKER_MIN_W;
  return Math.min(STICKER_MAX_W, Math.max(STICKER_MIN_W, w));
}

/** Keep a sticker (and the two-line price caption under it) on its photo instead of hanging off an edge. */
function clampToPhoto({ x, y }: LidPoint, w: number, ar: number): LidPoint {
  const half = w / 2;
  const halfHeight = (w * ar) / 2;
  return {
    x: Math.min(100 - half - 1, Math.max(half + 1, x)),
    // The caption sits below the sticker, so leave it room at the bottom edge.
    y: Math.min(100 - halfHeight - 12, Math.max(halfHeight + 1, y)),
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
    // Every point — placed or preset — goes through the photo clamp, so stickers and their
    // captions never hang off an edge (the bottom row used to spill past the lid).
    spots: spotIds.map((id, i) => {
      const placed = placements?.[id];
      const w = clampStickerWidth(placed?.w ?? autoW);
      const point =
        placed?.x != null && placed?.y != null
          ? clampToPhoto({ x: placed.x, y: placed.y }, w, MAC_LID_AR)
          : clampToPhoto(slots[i], w, MAC_LID_AR);
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
          : clampToPhoto(slots[i], w, MAC_INSIDE_AR);
      return { id, x: point.x, y: point.y, w };
    }),
    dims: { h: "", v: "" },
  };
}

/* T-shirt (apparel surface). Four model shots are the seller's editor
 * surfaces and the buyer's views — the same sticker treatment as the Mac
 * lid. Each angle owns its own preset slots, since the crops lay out
 * differently: chest box on the front, upper back on the back, the torso
 * strip on the sides. */
export const TEE_FRONT_VIEW_ID = "tee-front";
export const TEE_BACK_VIEW_ID = "tee-back";
export const TEE_LEFT_VIEW_ID = "tee-left";
export const TEE_RIGHT_VIEW_ID = "tee-right";
export const TEE_FRONT_PHOTO = "/tee/tee-front.png";
export const TEE_BACK_PHOTO = "/tee/tee-back.png";
export const TEE_LEFT_PHOTO = "/tee/tee-left.png";
export const TEE_RIGHT_PHOTO = "/tee/tee-right.png";

const TEE_FRONT_SLOTS = [
  { x: 50, y: 33 }, // 0  chest centre (the "YOUR BRAND HERE" box)
  { x: 50, y: 26 }, // 1  upper chest
  { x: 50, y: 41 }, // 2  lower chest
  { x: 41, y: 33 }, // 3  left chest
  { x: 59, y: 33 }, // 4  right chest
  { x: 41, y: 41 }, // 5  left lower
  { x: 59, y: 41 }, // 6  right lower
];

const TEE_BACK_SLOTS = [
  { x: 50, y: 27 }, // 0  upper-back centre
  { x: 50, y: 20 }, // 1  nape
  { x: 50, y: 36 }, // 2  lower back
  { x: 42, y: 27 }, // 3  left back
  { x: 58, y: 27 }, // 4  right back
];

const TEE_SIDE_SLOTS = [
  { x: 50, y: 30 }, // 0  torso centre
  { x: 50, y: 23 }, // 1  upper torso
  { x: 50, y: 38 }, // 2  lower torso
  { x: 45, y: 30 }, // 3  front edge
  { x: 55, y: 30 }, // 4  back edge
];

/* Portrait model photos (roughly 2:3): a width-% maps to a smaller height-%. */
const TEE_AR = 2 / 3;

function teeSlots(n: number, viewId: string): { x: number; y: number }[] {
  const base =
    viewId === TEE_BACK_VIEW_ID
      ? TEE_BACK_SLOTS
      : viewId === TEE_LEFT_VIEW_ID || viewId === TEE_RIGHT_VIEW_ID
        ? TEE_SIDE_SLOTS
        : TEE_FRONT_SLOTS;
  return Array.from({ length: n }, (_, i) => {
    const slot = base[i % base.length];
    const wrap = Math.floor(i / base.length);
    return wrap ? { x: slot.x, y: Math.min(60, slot.y + 6 * wrap) } : slot;
  });
}

/**
 * Tee print zones are large: one zone can fill the chest, so the auto width starts
 * bigger than a Mac sticker and shrinks as zones stack.
 */
function autoTeeWidth(count: number): number {
  return Math.min(30, Math.max(16, 120 / Math.max(1, count)));
}

function teeView(
  viewId: string,
  label: string,
  photo: string,
  spotIds: string[],
  placements?: Record<string, LidPlacement>,
): MockupView {
  const slots = teeSlots(spotIds.length, viewId);
  const autoW = autoTeeWidth(spotIds.length);
  return {
    id: viewId,
    label,
    photo,
    spots: spotIds.map((id, i) => {
      const placed = placements?.[id];
      const w = clampStickerWidth(placed?.w ?? autoW);
      const point =
        placed?.x != null && placed?.y != null
          ? clampToPhoto({ x: placed.x, y: placed.y }, w, TEE_AR)
          : clampToPhoto(slots[i], w, TEE_AR);
      return { id, x: point.x, y: point.y, w };
    }),
    dims: { h: "", v: "" },
  };
}

/* No tint on any tee view: the shots are full-bleed (skin, backdrop), not
 * white flat art, so multiplying a fabric color would recolor the whole image. */
export function teeFrontView(spotIds: string[] = [], placements?: Record<string, LidPlacement>): MockupView {
  return teeView(TEE_FRONT_VIEW_ID, "Front", TEE_FRONT_PHOTO, spotIds, placements);
}

/** Upper back of the tee on the model. */
export function teeBackView(spotIds: string[] = [], placements?: Record<string, LidPlacement>): MockupView {
  return teeView(TEE_BACK_VIEW_ID, "Back", TEE_BACK_PHOTO, spotIds, placements);
}

/** Side profile of the tee on the model. */
export function teeLeftView(spotIds: string[] = [], placements?: Record<string, LidPlacement>): MockupView {
  return teeView(TEE_LEFT_VIEW_ID, "Left", TEE_LEFT_PHOTO, spotIds, placements);
}

/** Other side profile of the tee on the model. */
export function teeRightView(spotIds: string[] = [], placements?: Record<string, LidPlacement>): MockupView {
  return teeView(TEE_RIGHT_VIEW_ID, "Right", TEE_RIGHT_PHOTO, spotIds, placements);
}

/** URL handle without the leading @, e.g. `@notcodesid` → `notcodesid`. */
export function handleSlug(handleOrName: string): string {
  return (handleOrName ?? '').trim().replace(/^@+/, '') || 'seller';
}

/** Seller profile path, e.g. `/notcodesid`. */
export function sellerUrl(handleOrName: string): string {
  return `/${encodeURIComponent(handleSlug(handleOrName))}`;
}

/** All listings belonging to one seller (handle or name, with/without @, case-insensitive). */
export function sellerListings(listings: Listing[], handleParam: string): Listing[] {
  const clean = (handleParam ?? '').trim().replace(/^@+/, '').toLowerCase();
  return listings.filter((l) => {
    const h = (l.seller.handle ?? '').replace(/^@+/, '').toLowerCase();
    const n = (l.seller.name ?? '').replace(/^@+/, '').toLowerCase();
    return h === clean || n === clean;
  });
}

/**
 * Short per-seller listing key. The store is newest-first, so reverse to
 * oldest-first: the seller's first Mac space is `mac`, the next `mac-2`,
 * and so on — new listings never steal an existing URL.
 */
export function listingShortKey(listing: Listing, allListings?: Listing[]): string {
  if (listing.surface && listing.surface !== 'gear') return listing.id;
  const scope = allListings ?? [listing];
  const oldestFirst = sellerListings(scope, listing.seller.handle || listing.seller.name).slice().reverse();
  const idx = oldestFirst.findIndex((l) => l.id === listing.id);
  return idx <= 0 ? 'mac' : `mac-${idx + 1}`;
}

/** Nested listing path, e.g. `/notcodesid/mac`. */
export function listingUrl(listing: Listing, allListings?: Listing[]): string {
  const handle = listing.seller.handle || listing.seller.name;
  return `${sellerUrl(handle)}/${listingShortKey(listing, allListings)}`;
}

/**
 * Resolve a nested `/:handle/:listing` URL. `mac` / `mac-2` … map to the
 * seller's spaces oldest-first; the full slug still resolves (and the page
 * redirects it to the short canonical URL).
 */
export function resolveNestedListing(
  listings: Listing[],
  handleParam: string,
  listingParam: string,
): Listing | undefined {
  const mine = sellerListings(listings, handleParam);
  if (mine.length === 0) return undefined;
  const key = decodeURIComponent(listingParam ?? '').trim().toLowerCase();
  const macMatch = key.match(/^mac(?:-(\d+))?$/);
  if (macMatch) {
    const oldestFirst = mine.slice().reverse();
    const idx = macMatch[1] ? Number(macMatch[1]) - 1 : 0;
    return oldestFirst[idx];
  }
  return (
    mine.find((l) => l.id.toLowerCase() === key) ??
    mine.find((l) => l.id.toLowerCase().endsWith(key))
  );
}

/** Card thumbnail: the listing's own photo, else the MacBook hero shot for gear, the tee flat for apparel. */
export function cardPhoto(listing: { image: string; surface?: string }): string {
  if (listing.image) return listing.image;
  if (!listing.surface || listing.surface === "gear") return MAC_HERO_PHOTO;
  if (listing.surface === "apparel") return TEE_FRONT_PHOTO;
  return "";
}

export function formatMoney(n: number, currency?: string): string {
  if ((currency ?? "USD").toUpperCase() === "EUR") return "€" + n.toLocaleString("en-US");
  return "$" + n.toLocaleString("en-US");
}

/** Minimum acceptable bid (mirrors backend Store.placeBid). */
export function minBidFor(listing: Listing, spot: Spot): number {
  if (spot.bid == null) return spot.price;
  if (listing.doubleUp) return spot.bid * 2;
  return spot.bid + (listing.minIncrement ?? 1);
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

/** One seller label: the handle when name and handle match, otherwise both. */
export function sellerDisplay(seller: { name: string; handle: string }): string {
  const handle = (seller.handle ?? '').trim();
  const name = (seller.name ?? '').trim();
  if (!handle) return name;
  if (!name || name.replace(/^@+/, '').toLowerCase() === handle.replace(/^@+/, '').toLowerCase()) return handle;
  return `${name} ${handle}`;
}

/** X username without the @, for avatar lookup. */
export function sellerUsername(seller: { name: string; handle: string }): string {
  const from = seller.handle || seller.name;
  return (from ?? '').trim().replace(/^@+/, '');
}

export function deadlineLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Step 5: lazy deadline — a listing is over once its ISO deadline passes. */
export function isEnded(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}

function usableImage(image: string): string {
  return image && !image.startsWith("/demo/") ? image : "";
}

export function apiSpotToUi(s: ApiSpot, mode: ApiMode): Spot {
  const claimed = mode === "fixed" && s.status !== "open" && !!s.buyer;
  const topBid = mode === "auction" ? s.currentBid : undefined;
  const actor = claimed ? s.buyer! : topBid != null ? s.buyer : undefined;
  const placement = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  // Views pass through: Mac ("lid"/"inside") and the four tee angles
  // ("tee-front"/"tee-back"/"tee-left"/"tee-right").
  // Anything else (legacy/unknown) reads as a lid spot, exactly as before.
  const view =
    s.view === "inside" || s.view === "tee-front" || s.view === "tee-back" || s.view === "tee-left" || s.view === "tee-right" ? s.view : "lid";
  return {
    id: s.id,
    label: s.label,
    location: s.location || undefined,
    size: s.size,
    price: s.price,
    currency: s.currency,
    view,
    x: placement(s.x),
    y: placement(s.y),
    w: placement(s.w),
    website: s.website || undefined,
    logoImage: s.logoUrl || undefined,
    bid: topBid ?? (claimed ? s.price : undefined),
    bidBy: mode === "auction" ? s.buyer : undefined,
    bids: s.bids?.map((b) => ({ bidder: b.bidder, amount: b.amount, at: b.at })),
    claimedBy: claimed ? s.buyer : undefined,
    logoColor: actor ? sellerColor(actor) : undefined,
    sold: s.status === "sold",
    artworkSubmittedAt: s.artworkSubmittedAt || undefined,
    fulfilledAt: s.fulfilledAt || undefined,
    proofPhotos: s.proofPhotos?.length ? [...s.proofPhotos] : undefined,
    proofPost: s.proofPost || undefined,
    confirmedAt: s.confirmedAt || undefined,
    disputedAt: s.disputedAt || undefined,
    disputeReason: s.disputeReason || undefined,
    paidAt: s.paidAt || undefined,
    payoutAmount: s.payoutAmount,
    payoutFee: s.payoutFee,
    payoutReference: s.payoutReference || undefined,
    payoutDestination: s.payoutDestination || undefined,
    chainTransaction: s.chainDisputeSignature || s.chainProofSignature || s.chainBidSignature || s.chainClaimSignature || s.chainSignature,
  };
}

export function applyApiSpotToUi(ui: Spot, api: ApiSpot, mode: ApiMode): Spot {
  return { ...ui, ...apiSpotToUi(api, mode), id: ui.id };
}

export function apiListingToUi(a: ApiListing): Listing {
  const image = usableImage(a.image);
  const spots = a.spots.map((s) => apiSpotToUi(s, a.mode));
  const closeLabel = (() => {
    if (!a.artworkClose) return "";
    const t = new Date(a.artworkClose).getTime();
    return ` (Artwork due ${Number.isNaN(t) ? a.artworkClose : deadlineLabel(a.artworkClose)}.)`;
  })();
  const description = `${a.story}${closeLabel}`;
  // Stickers live on exactly one photo: the lid gets every non-inside spot, the deck only its own.
  // Hand placements ride along — buyers see the seller's exact layout, not a re-layout.
  // Tee listings split across the four model shots; a spot with no recorded
  // view (or a legacy unknown one) reads as front, so nothing goes missing.
  const isTee = a.surface === "apparel";
  const fabric = normalizeFabric(a.fabric);
  const lidIds = isTee ? [] : spots.filter((s) => s.view !== "inside").map((s) => s.id);
  const deckIds = isTee ? [] : spots.filter((s) => s.view === "inside").map((s) => s.id);
  const onTeeView = (v: string) => (isTee ? spots.filter((s) => s.view === v).map((s) => s.id) : []);
  const frontIds = isTee ? [...onTeeView("tee-front"), ...onTeeView("lid")] : [];
  const backIds = onTeeView("tee-back");
  const leftIds = onTeeView("tee-left");
  const rightIds = onTeeView("tee-right");
  const placed: Record<string, LidPlacement> = {};
  for (const s of spots) {
    if (s.x != null || s.y != null || s.w != null) placed[s.id] = { x: s.x, y: s.y, w: s.w };
  }
  return {
    id: a.slug,
    title: a.title,
    goal: a.story,
    description,
    image,
    surface: a.surface,
    fabric,
    seller: { name: a.seller, handle: a.sellerHandle, color: sellerColor(a.seller) },
    deadline: deadlineLabel(a.deadline),
    endsAt: a.deadline,
    artworkClose: a.artworkClose || undefined,
    priceType: a.mode,
    currency: a.currency,
    minIncrement: a.minIncrement,
    doubleUp: a.doubleUp,
    status: a.status,
    spots,
      mockup: {
        views: image
          ? [{ id: "main", label: "Overview", photo: image, dims: { h: "", v: "" } }]
          : isTee
            ? [teeFrontView(frontIds, placed), teeBackView(backIds, placed), teeLeftView(leftIds, placed), teeRightView(rightIds, placed)]
            : a.surface === "gear"
              ? [gearPhotoView(lidIds, placed), gearInsideView(deckIds, placed)]
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
