import type { PublicListing, PublicSpot, Surface } from "@/lib/api/types";

export const SURFACE_LABELS: Record<Surface, string> = {
  laptop: "laptop",
  tshirt: "t-shirt",
  car: "car",
  suitcase: "bag & suitcase",
  bike: "bike",
  digital: "digital",
  other: "other",
};

const handleOf = (handle: string) => handle.replace(/^@+/, "");

export const profileHref = (handle: string) => `/@${handleOf(handle)}`;
export const listingHref = (handle: string, slug: string) => `/@${handleOf(handle)}/${slug}`;

export const isAvailable = (spot: PublicSpot) => spot.state === "open";

// Headline price for cards: cheapest open fixed spot, or the top live bid / starting price for auctions.
export function priceSummary(listing: Pick<PublicListing, "mode" | "spots">): { label: string; amount: string } | null {
  const open = listing.spots.filter((spot) => spot.state === "open" || (listing.mode === "auction" && spot.state === "funded"));
  if (open.length === 0) return null;
  if (listing.mode === "fixed") {
    const min = open.reduce((low, spot) => (BigInt(spot.price) < BigInt(low) ? spot.price : low), open[0].price);
    return { label: open.length > 1 ? "from" : "price", amount: min };
  }
  const bids = open.filter((spot) => spot.amount !== null).map((spot) => BigInt(spot.amount!));
  if (bids.length > 0) return { label: "top bid", amount: bids.reduce((a, b) => (b > a ? b : a)).toString() };
  const start = open.reduce((low, spot) => (BigInt(spot.price) < BigInt(low) ? spot.price : low), open[0].price);
  return { label: "bids from", amount: start };
}

// Spots nobody has claimed or bid on yet.
export function spotsLeft(listing: Pick<PublicListing, "mode" | "spots">): number {
  return listing.spots.filter((spot) => spot.state === "open").length;
}

// Auction spots that already have a top bid (still open to higher bids until bidding closes).
export function spotsWithBids(listing: Pick<PublicListing, "mode" | "spots">): number {
  return listing.mode === "auction" ? listing.spots.filter((spot) => spot.state === "funded" && spot.amount !== null).length : 0;
}

// How far the listing's current total is above its starting total, in whole percent; 0 when not above.
// Current total = top bid (or paid amount) for spots that have one, starting price for the rest.
export function oversubscription(listing: Pick<PublicListing, "spots">): number {
  const live = listing.spots.filter((spot) => spot.state !== "cancelled" && spot.state !== "refunded");
  const start = live.reduce((sum, spot) => sum + BigInt(spot.price), 0n);
  if (start === 0n) return 0;
  const current = live.reduce((sum, spot) => {
    const amount = spot.amount !== null ? BigInt(spot.amount) : 0n;
    return sum + (amount > BigInt(spot.price) ? amount : BigInt(spot.price));
  }, 0n);
  return Number(((current - start) * 100n) / start);
}

export function formatFollowers(count: number | undefined): string | null {
  if (!count) return null;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}
