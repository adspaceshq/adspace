export type Mode = "fixed" | "auction";
export type SpotStatus = "open" | "claimed" | "sold";

/** Current seller terms. Bumped by hand; accept calls pin this exact version. */
export const TERMS_VERSION = "v1";

export const TERMS_TEXT = `Adspaces seller terms (v1, demo).

1. Demo only — claims and bids mark spots. No real money moves yet.
2. Describe your surface honestly: what buyers get, where, and for how long.
3. Deliver the campaign as listed, or refund the buyer off-platform.
4. You approve every claim; unapproved spots never count as sold.
5. Artwork closes on the date you set. Late artwork may forfeit the spot.
6. The platform may remove listings that mislead buyers, with a reason.
7. Payouts are manual until on-chain settlement ships.`;

export interface TermsDoc {
  version: string;
  text: string;
}

export interface Bid {
  bidder: string;
  amount: number;
  at: string;
}

export interface Spot {
  id: string;
  listingId: string;
  label: string;
  location: string;
  size: string;
  price: number;
  currency: string;
  /** Which photo the sticker lives on: "lid" | "inside" (Mac) or "tee-front" | "tee-back" | "tee-left" | "tee-right" (T-shirt). */
  view: string;
  /** Seller hand placement in % of the photo (position + width). Absent → auto layout. */
  x?: number;
  y?: number;
  w?: number;
  /** Buyer brand assets attached at purchase; replaced on takeover. */
  website?: string;
  logoUrl?: string;
  status: SpotStatus;
  currentBid?: number;
  buyer?: string;
  bids?: Bid[];
  fulfilledAt?: string;
  /** When the buyer submitted final artwork (Step 7 intake). */
  artworkSubmittedAt?: string;
}

export interface Listing {
  id: string;
  slug: string;
  title: string;
  seller: string;
  sellerHandle: string;
  sellerUserId?: string;
  surface: string;
  story: string;
  image: string;
  /** Tee base color as #rrggbb (apparel surface). Anything else → default white. */
  fabric: string;
  mode: Mode;
  currency: string;
  deadline: string;
  artworkClose: string;
  minIncrement?: number;
  doubleUp?: boolean;
  status: "active" | "approved" | "submitted" | "closed";
  /** Why the platform rejected this submission (set on reject, cleared on approve/resubmit). */
  reviewNote?: string;
  /** Terms version accepted for this listing, and when (set on accept-terms). */
  termsVersion?: string;
  termsAcceptedAt?: string;
  spots: Spot[];
}

export interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  seller: string;
  surface: string;
  image: string;
  mode: Mode;
  currency: string;
  fromPrice: number;
  raised: number;
  open: number;
  total: number;
}

export interface CreateListingRequest {
  title: string;
  surface?: string;
  story?: string;
  /** Seller's surface photo as a data:image/* URL (mock-grade until object storage). */
  image?: string;
  fabric?: string;
  mode?: string;
  currency?: string;
  deadline?: string;
  artworkClose?: string;
  spots?: CreateSpotRequest[];
}

export interface CreateSpotRequest {
  label?: string;
  location?: string;
  size?: string;
  price?: number;
  view?: string;
  x?: number;
  y?: number;
  w?: number;
}

/** Brand assets a buyer attaches when claiming or bidding. */
export interface PurchaseAssets {
  website?: string;
  logoUrl?: string;
}

export interface SessionUser {
  id: string;
  did: string;
  handle: string;
  name?: string;
  avatar?: string;
}

export interface AuthenticatedIdentity extends Omit<SessionUser, "id"> { xUserId: string }
export interface SessionResponse extends SessionUser { csrfToken: string; expiresAt: string; isReviewer: boolean }

/** Public seller profile at 3000/{username}. payoutWallet is only ever returned to the owner. */
export interface PublicProfile {
  id: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  bio: string;
  payoutWallet?: string;
  verified: boolean;
}

export interface UpdateProfileRequest {
  bio?: string;
  payoutWallet?: string;
}

export interface SellerDashboardListing {
  id: string;
  slug: string;
  title: string;
  image: string;
  status: "active" | "approved" | "submitted" | "closed";
  deadline: string;
  reviewNote?: string;
  mode: Mode;
  currency: string;
  sold: number;
  open: number;
  total: number;
  revenue: number;
}

export interface SellerAttentionItem {
  spotId: string;
  listingId: string;
  listingSlug: string;
  listingTitle: string;
  spotLabel: string;
  buyer: string;
  amount: number;
  currency: string;
  submittedAt: string;
  status: "pending" | "approved";
  artworkReceived: boolean;
}

export interface SellerDashboard {
  summary: { activeListings: number; openSpots: number; pendingApproval: number; revenue: number; currency: string };
  listings: SellerDashboardListing[];
  attention: SellerAttentionItem[];
}
