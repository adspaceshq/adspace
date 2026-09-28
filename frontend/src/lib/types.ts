// Mirror of backend/src/types.ts — keep in sync with CONTRACT.md.

export type ApiMode = "fixed" | "auction";
export type ApiSpotStatus = "open" | "claimed" | "sold";

export interface ApiBid {
  bidder: string;
  amount: number;
  at: string;
}

export interface ApiSpot {
  id: string;
  listingId: string;
  chainAddress?: string;
  chainVaultAddress?: string;
  chainSignature?: string;
  chainClaimSignature?: string;
  label: string;
  location: string;
  size: string;
  price: number;
  currency: string;
  /** Which photo the sticker lives on: "lid" | "inside" (Mac) or "tee-front" | "tee-back" | "tee-left" | "tee-right" (T-shirt). */
  view: string;
  /** Seller hand placement in % of the photo. Absent → auto layout. */
  x?: number | null;
  y?: number | null;
  w?: number | null;
  /** Buyer brand assets attached at purchase; replaced on takeover. */
  website?: string;
  logoUrl?: string;
  status: ApiSpotStatus;
  currentBid?: number;
  buyer?: string;
  bids?: ApiBid[];
  fulfilledAt?: string;
  artworkSubmittedAt?: string;
  proofPhotos?: string[];
  proofPost?: string;
  confirmedAt?: string;
  disputedAt?: string;
  disputeReason?: string;
  /** Manual-USDC payout record (reviewer-posted transfer signature). */
  paidAt?: string;
  payoutAmount?: number;
  payoutFee?: number;
  payoutReference?: string;
  payoutDestination?: string;
}

export interface ApiListing {
  id: string;
  slug: string;
  title: string;
  seller: string;
  sellerHandle: string;
  surface: string;
  story: string;
  image: string;
  /** Tee base color as #rrggbb (apparel surface). */
  fabric: string;
  mode: ApiMode;
  currency: string;
  deadline: string;
  artworkClose: string;
  minIncrement?: number;
  doubleUp?: boolean;
  status: "active" | "approved" | "submitted" | "closed";
  reviewNote?: string;
  termsVersion?: string;
  termsAcceptedAt?: string;
  feeBps?: number;
  upliftFeeBps?: number;
  maxFeeBps?: number;
  reviewWindowSeconds?: number;
  deliveryDeadline?: string;
  chainAddress?: string;
  chainSignatures?: string[];
  spots: ApiSpot[];
}

export interface TermsDoc {
  version: string;
  text: string;
}

export interface ApiListingSummary {
  id: string;
  slug: string;
  title: string;
  seller: string;
  surface: string;
  image: string;
  mode: ApiMode;
  currency: string;
  fromPrice: number;
  raised: number;
  open: number;
  total: number;
}

export interface ApiCreateListingRequest {
  title: string;
  surface?: string;
  story?: string;
  fabric?: string;
  mode?: string;
  currency?: string;
  deadline?: string;
  artworkClose?: string;
  spots?: ApiCreateSpotRequest[];
}

export interface ApiCreateSpotRequest {
  label?: string;
  location?: string;
  size?: string;
  price?: number;
  view?: string;
  x?: number;
  y?: number;
  w?: number;
}

export interface SessionUser {
  id: string;
  did: string;
  handle: string;
  name?: string;
  avatar?: string;
  email?: string;
  walletAddress?: string;
  hasX: boolean;
  csrfToken: string;
  expiresAt: string;
  isReviewer: boolean;
}

/** Public seller profile at /{username}. payoutWallet is only ever returned to the owner. */
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
  mode: ApiMode;
  currency: string;
  sold: number;
  open: number;
  total: number;
  paid: number;
  revenue: number;
  feeBps?: number;
  upliftFeeBps?: number;
  maxFeeBps?: number;
  reviewWindowSeconds?: number;
  deliveryDeadline?: string;
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
  status: "pending" | "approved" | "delivered" | "disputed";
  artworkReceived: boolean;
  disputeReason?: string;
}

export interface SellerDashboard {
  summary: { activeListings: number; openSpots: number; pendingApproval: number; revenue: number; paidOut: number; currency: string };
  listings: SellerDashboardListing[];
  attention: SellerAttentionItem[];
}

export interface PayoutItem {
  spotId: string;
  listingId: string;
  listingSlug: string;
  listingTitle: string;
  spotLabel: string;
  seller: string;
  buyer: string;
  amount: number;
  currency: string;
  releasedAt: string;
}

export interface ReviewPolicyRequest {
  feeBps: number;
  upliftFeeBps: number;
  maxFeeBps: number;
  reviewWindowSeconds: number;
  deliveryDeadline: string;
}

export interface WalletWithdrawal {
  id: string;
  source: string;
  destination: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'failed';
  signature?: string;
  createdAt: string;
  confirmedAt?: string;
}
