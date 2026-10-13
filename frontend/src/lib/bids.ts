import type { PublicListing, PublicSpot } from "@/lib/api/types";

// Mirrors backend minimumBid: first bid >= start price; then double-up or + minimum increment.
export function minimumNextBid(listing: Pick<PublicListing, "doubleUp" | "minIncrement">, spot: Pick<PublicSpot, "state" | "price" | "amount">): bigint {
  if (spot.state === "open" || spot.amount === null) return BigInt(spot.price);
  const current = BigInt(spot.amount);
  return listing.doubleUp ? current * 2n : current + BigInt(listing.minIncrement);
}

export function canPurchase(listing: Pick<PublicListing, "mode" | "deadline" | "state">, spot: Pick<PublicSpot, "state">, now = Date.now()) {
  if (listing.state !== "published" || new Date(listing.deadline).getTime() <= now) return false;
  return spot.state === "open" || (listing.mode === "auction" && spot.state === "funded");
}
