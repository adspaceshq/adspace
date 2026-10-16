import type { ListingState, SpotState } from "@/lib/api/types";
import { Badge, type BadgeTone } from "./Badge";

type Perspective = "creator" | "sponsor" | "public";

const listingCopy: Record<ListingState, { label: string; tone: BadgeTone }> = {
  draft: { label: "draft", tone: "neutral" },
  in_review: { label: "in review", tone: "accent" },
  changes_requested: { label: "changes requested", tone: "warning" },
  rejected: { label: "not approved", tone: "danger" },
  approved: { label: "approved", tone: "success" },
  publishing: { label: "publishing", tone: "accent" },
  published: { label: "live", tone: "accent" },
  closed: { label: "closed", tone: "neutral" },
};

const spotCopy: Record<SpotState, Record<Perspective, string> & { tone: BadgeTone }> = {
  open: { creator: "open", sponsor: "available", public: "available", tone: "neutral" },
  funded: { creator: "paid · awaiting proof", sponsor: "awaiting delivery", public: "taken", tone: "accent" },
  delivered: { creator: "delivered · in review", sponsor: "delivered · review it", public: "taken", tone: "success" },
  disputed: { creator: "disputed", sponsor: "dispute open", public: "taken", tone: "warning" },
  settled: { creator: "paid out", sponsor: "complete", public: "taken", tone: "success" },
  // A refunded spot can't be bought again (only open spots can), so the public never sees "available".
  refunded: { creator: "refunded", sponsor: "refunded", public: "not available", tone: "neutral" },
  cancelled: { creator: "closed", sponsor: "closed", public: "closed", tone: "neutral" },
};

export const listingStateLabel = (state: ListingState) => listingCopy[state].label;

export function ListingStateBadge({ state }: { state: ListingState }) {
  const { label, tone } = listingCopy[state];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

// `bidding`: an auction spot with a bid while bidding is still open reads "has bids", not "taken".
export function SpotStateBadge({ state, perspective = "public", bidding = false }: { state: SpotState; perspective?: Perspective; bidding?: boolean }) {
  if (bidding && state === "funded" && perspective === "public") {
    return (
      <Badge tone="accent" dot>
        has bids
      </Badge>
    );
  }
  const copy = spotCopy[state];
  return (
    <Badge tone={copy.tone} dot>
      {copy[perspective]}
    </Badge>
  );
}
