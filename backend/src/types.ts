export type Mode = "fixed" | "auction";
export type SpotStatus = "open" | "claimed" | "sold";

/**
 * Current terms version: recorded when a listing is published, and required (and recorded) for every
 * claim, bid and first onboarding. Source of truth: the app reads it from GET /api/v2/status, and
 * frontend/src/lib/terms.test.ts fails if TERMS_VERSION in frontend/src/components/legal/LegalPage.tsx drifts.
 */
export const TERMS_VERSION = "v1";

export interface Bid {
  bidder: string;
  amount: number;
  at: string;
}

export interface Spot {
  id: string;
  listingId: string;
  chainAddress?: string;
  chainVaultAddress?: string;
  chainSignature?: string;
  chainClaimSignature?: string;
  chainBidSignature?: string;
  chainProofSignature?: string;
  chainDisputeSignature?: string;
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
  /** Delivery evidence photos pinned by the seller (Step 9 proof). */
  proofPhotos?: string[];
  /** X post distributing the delivered campaign. */
  proofPost?: string;
  /** Buyer receipt: confirmed delivery (early payout release). */
  confirmedAt?: string;
  /** Open buyer dispute (blocks payout until withdrawn). */
  disputedAt?: string;
  disputeReason?: string;
  /** Platform-recorded payout (devnet-USDC ledger). */
  paidAt?: string;
  payoutAmount?: number;
  payoutFee?: number;
  payoutReference?: string;
  payoutDestination?: string;
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
  feeBps?: number;
  upliftFeeBps?: number;
  maxFeeBps?: number;
  reviewWindowSeconds?: number;
  deliveryDeadline?: string;
  chainAddress?: string;
  chainSignatures?: string[];
  spots: Spot[];
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
  emailVerified?: boolean;
}

export interface AuthenticatedIdentity extends Omit<SessionUser, "id"> { xUserId?: string }
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

export type AccountType = "creator" | "sponsor" | "both";
export const SOCIAL_PLATFORMS = ["x", "instagram", "youtube", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const BRAND_CATEGORIES = ["crypto", "fintech", "gaming", "consumer", "saas", "fitness", "media", "other"] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

/** Chosen once after login; decides which dashboard the user gets later. */
export interface Onboarding {
  accountType: AccountType;
  creator?: { socials: Partial<Record<SocialPlatform, string>> };
  sponsor?: { brandName: string; category: BrandCategory; website?: string };
}

export interface UpdateProfileRequest {
  displayName?: string;
  handle?: string;
  avatar?: string | null;
  bio?: string;
  payoutWallet?: string;
}
