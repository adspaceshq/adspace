import type { PublicListing } from "@/lib/api/types";
import { oversubscription, priceSummary, spotsLeft, spotsWithBids } from "@/lib/listing-display";

// What a listing's share card says. Wording mirrors components/market/ListingCard.tsx so the card
// never contradicts the app.

type CardListing = Pick<PublicListing, "mode" | "spots" | "state" | "deadline">;

const liveSpots = (listing: Pick<PublicListing, "spots">) => listing.spots.filter((spot) => spot.state !== "cancelled" && spot.state !== "refunded");

// "2 with bids · 1 open", "all 2 spots have bids", "1 of 3 spots left", "3 spots left", "sold out".
export function spotsLine(listing: Pick<PublicListing, "mode" | "spots">): string | null {
  const left = spotsLeft(listing);
  const withBids = spotsWithBids(listing);
  if (withBids > 0) return left > 0 ? `${withBids} with bids · ${left} open` : `all ${withBids} spot${withBids === 1 ? " has" : "s have"} bids`;
  const total = liveSpots(listing).length;
  if (total === 0) return null;
  if (left === 0) return listing.mode === "fixed" ? "sold out" : "all spots taken";
  return left < total ? `${left} of ${total} spots left` : `${left} spot${left === 1 ? "" : "s"} left`;
}

// Cards are cached for up to an hour, so the countdown stays coarse and far deadlines show a date.
export function closingLabel(listing: Pick<PublicListing, "state" | "deadline" | "mode">, now = Date.now()): { text: string; urgent: boolean } | null {
  if (listing.state === "closed") return { text: listing.mode === "auction" ? "bidding closed" : "closed", urgent: false };
  if (listing.state !== "published") return null;
  const deadline = new Date(listing.deadline).getTime();
  if (!Number.isFinite(deadline)) return null;
  const ms = deadline - now;
  if (ms <= 0) return { text: listing.mode === "auction" ? "bidding closed" : "closed", urgent: false };
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days >= 3) {
    const date = new Date(deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return { text: `closes ${date}`, urgent: false };
  }
  const urgent = ms < 24 * 60 * 60 * 1000;
  if (days > 0) return { text: `closes in ${days}d ${hours}h`, urgent };
  if (hours > 0) return { text: `closes in ${hours}h ${minutes % 60}m`, urgent };
  return { text: `closes in ${Math.max(1, minutes)}m`, urgent };
}

export interface ListingCardStats {
  price: { label: string; amount: string } | null;
  spots: string | null;
  oversubscribed: number;
  closing: { text: string; urgent: boolean } | null;
}

export function listingCardStats(listing: CardListing, now = Date.now()): ListingCardStats {
  return {
    price: priceSummary(listing),
    spots: spotsLine(listing),
    oversubscribed: oversubscription(listing),
    closing: closingLabel(listing, now),
  };
}
