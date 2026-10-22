import type { ListingState } from "@/lib/api/types";

// Where a creator's own listing opens: drafts and change requests go back to the wizard, everything else
// to the control room.
export const listingLink = (listing: { id: string; state: ListingState }) =>
  listing.state === "draft" || listing.state === "changes_requested" ? `/sell/drafts/${listing.id}` : `/sell/listings/${listing.id}`;
