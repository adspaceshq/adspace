// Shapes returned by the backend /api/v2. Money is a decimal string of USDC base units
// (6 decimals); dates are ISO strings. Convert money only through lib/money.

export type BaseUnits = string;
export type IsoDate = string;

export type Surface = "laptop" | "tshirt" | "car" | "suitcase" | "bike" | "digital" | "other";
export type PricingMode = "fixed" | "auction";
export type ListingState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "rejected"
  | "approved"
  | "publishing"
  | "published"
  | "closed";
export type SpotState = "open" | "funded" | "delivered" | "disputed" | "settled" | "refunded" | "cancelled";

export interface Onboarding {
  accountType: "creator" | "sponsor" | "both";
  creator?: { socials: Partial<Record<"x" | "instagram" | "youtube" | "tiktok", string>> };
  sponsor?: { brandName: string; category: string; website?: string };
}

export interface Session {
  id: string;
  did: string;
  handle: string;
  name?: string;
  avatar?: string;
  email?: string;
  walletAddress?: string;
  hasX: boolean;
  emailVerified?: boolean;
  csrfToken: string;
  expiresAt: IsoDate;
  isReviewer: boolean;
  isAdmin: boolean;
  onboarding: Onboarding | null;
}

export interface PublicProfile {
  id: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  bio: string;
  payoutWallet?: string;
  verified: boolean;
}

export interface SpotLayout {
  x: number;
  y: number;
  w: number;
  h?: number;
  view?: string;
}

export interface SponsorBrand {
  name: string;
  link?: string;
  handle?: string;
  logoUrl?: string;
}

export interface PublicSpot {
  id: string;
  index: number;
  label: string;
  price: BaseUnits;
  layout: SpotLayout;
  state: SpotState;
  amount: BaseUnits | null;
  taken: boolean;
  // The sponsor's chosen brand, public once the spot is sold.
  brand: { name: string; logoUrl?: string; link?: string; handle?: string } | null;
  // The sponsor's adspaces profile, on the listing page once the spot is sold or has a top bid.
  sponsor?: { handle: string; displayName: string; avatarUrl: string | null } | null;
}

export interface Spot {
  id: string;
  listingId: string;
  index: number;
  label: string;
  price: BaseUnits;
  layout: SpotLayout;
  state: SpotState;
  buyerId: string | null;
  buyerWallet: string | null;
  amount: BaseUnits | null;
  brand: SponsorBrand | null;
  proofHash: string | null;
  proofSubmittedAt: IsoDate | null;
  buyerConfirmedAt: IsoDate | null;
  chainAddress: string | null;
  vaultAddress: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Listing {
  id: string;
  slug: string;
  sellerId: string;
  surface: Surface;
  title: string;
  description: string;
  audience: { followers?: number; event?: string; location?: string };
  mode: PricingMode;
  state: ListingState;
  deadline: IsoDate;
  artworkDueAt: IsoDate;
  deliveryDueAt: IsoDate;
  reviewWindowSeconds: number;
  minIncrement: BaseUnits;
  doubleUp: boolean;
  feeBps: number | null;
  upliftFeeBps: number | null;
  maxFeeBps: number | null;
  reviewNote: string | null;
  reviewedAt: IsoDate | null;
  termsVersion: string | null;
  termsAcceptedAt: IsoDate | null;
  chainAddress: string | null;
  sellerWallet: string | null;
  publishedAt: IsoDate | null;
  closedAt: IsoDate | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ListingSeller {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  hasX: boolean;
  verified: boolean;
}

export interface ListingPhoto {
  id?: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PublicListing extends Listing {
  spots: PublicSpot[];
  photos: ListingPhoto[];
  seller: ListingSeller;
}

export interface BrowseFilters {
  q?: string;
  surface?: Surface;
  mode?: PricingMode;
  sort?: "closing" | "newest" | "price";
  limit?: number;
  offset?: number;
}

export interface BrowsePage {
  items: PublicListing[];
  hasMore: boolean;
}

export interface OwnedListing extends Listing {
  spots: Spot[];
  photos?: ListingPhoto[];
  spotCount?: number;
  soldCount?: number;
}

export type PostKind = "x" | "instagram" | "tiktok" | "youtube" | "link" | "photo" | "text";

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  source: string;
  capturedAt: IsoDate;
}

export interface Post {
  id: string;
  kind: PostKind;
  url: string | null;
  externalId: string | null;
  body: string;
  createdAt: IsoDate;
  authorId: string;
  media: Array<{ url: string; width: number | null; height: number | null }>;
  metrics: PostMetrics | null;
  proofForSpotIds: string[];
}

export interface Message {
  id: string;
  body: string;
  createdAt: IsoDate;
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
}

export interface Settlement {
  spotId: string;
  kind: "payout" | "refund" | "dispute_split" | "timeout_refund";
  gross: BaseUnits;
  fee: BaseUnits;
  sellerNet: BaseUnits;
  buyerRefund: BaseUnits;
  chainTxId: string;
  settledAt: IsoDate;
}

export type NeedsYouType =
  | "proof_due"
  | "accept_terms"
  | "changes_requested"
  | "dispute_open"
  | "payout_ready"
  | "review_proof"
  | "refund_available"
  | "outbid"
  | "dispute_timeout_ready";

export interface NeedsYouItem {
  type: NeedsYouType;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  sellerHandle: string;
  spotId?: string;
  spotIndex?: number;
  dueAt?: IsoDate;
}

export interface CreatorDashboard {
  stats: { earned: BaseUnits; pendingEscrow: BaseUnits; liveListings: number; spotsSold: number; onTimeRate: number | null };
  needsYou: NeedsYouItem[];
  listings: Array<OwnedListing & { spotCount: number; soldCount: number }>;
}

export interface SponsorDashboard {
  stats: { spent: BaseUnits; inEscrow: BaseUnits; active: number; delivered: number };
  needsYou: NeedsYouItem[];
  spots: Array<
    Spot & {
      listing: {
        id: string;
        slug: string;
        title: string;
        mode: PricingMode;
        deadline: IsoDate;
        deliveryDueAt: IsoDate;
        sellerHandle: string;
        // Ordered by position; the spot sits on photos[spotView(layout)].
        photos: Array<{ url: string; width: number | null; height: number | null }>;
      };
      reviewUntil: IsoDate | null;
      // Set once the spot finished (paid out, refunded, or split in a dispute).
      settlement: Pick<Settlement, "kind" | "gross" | "fee" | "sellerNet" | "buyerRefund" | "settledAt"> | null;
    }
  >;
}

export interface TimelineEvent {
  id: string;
  type: string;
  fromState: SpotState | null;
  toState: SpotState | null;
  data: Record<string, unknown>;
  createdAt: IsoDate;
  signature: string | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  toState: SpotState | null;
  createdAt: IsoDate;
  spotId: string;
  spotIndex: number;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  signature: string | null;
  role: "creator" | "sponsor";
}

export interface Withdrawal {
  id: string;
  userId: string;
  amount: BaseUnits;
  destination: string;
  state: "pending" | "submitted" | "confirmed" | "failed";
  chainTxId: string | null;
  signature: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface ProtocolStatus {
  authority: string;
  treasury: string;
  feeBps: number;
  paused: boolean;
  disputeTimeoutSeconds: number;
  // Can only pause; null when not set up or disabled.
  pauseGuardian: string | null;
  // False when the config authority is the multisig: the server then proposes instead of signing.
  serverIsAuthority: boolean;
  squadsMultisig: string | null;
}

// A Squads proposal the server opened; members approve and execute it in the Squads app.
export interface SquadsPending {
  multisig: string;
  transactionIndex: number;
  vaultTransaction: string;
  proposal: string;
  url: string;
  // When the program stops accepting it (admin proposals); null for dispute resolutions, which are bound
  // to their dispute and its timeout instead. Older servers leave it out.
  validUntil?: string | null;
}

export interface ChainResult<T> {
  signature: string;
  spot?: Spot;
  settlement?: Settlement;
  data?: T;
}

export interface DraftInput {
  surface: Surface;
  title: string;
  description?: string;
  audience?: Listing["audience"];
  mode: PricingMode;
  deadline: IsoDate;
  artworkDueAt?: IsoDate;
  deliveryDueAt?: IsoDate;
  minIncrement?: string;
  doubleUp?: boolean;
  spots: Array<{ label?: string; price: string; layout: SpotLayout }>;
  photoAssetIds?: string[];
}

export interface ReviewDecision {
  action: "approve" | "request_changes" | "reject";
  note?: string;
  fees?: { feeBps: number; upliftFeeBps: number; maxFeeBps: number };
  reviewWindowSeconds?: number;
  deliveryDueAt?: IsoDate;
}

export interface SpotDetail {
  role: "sponsor" | "creator" | "reviewer";
  spot: {
    id: string;
    index: number;
    label: string;
    price: BaseUnits;
    layout: SpotLayout;
    state: SpotState;
    amount: BaseUnits | null;
    brand: SponsorBrand | null;
    proofSubmittedAt: IsoDate | null;
    chainAddress: string | null;
    vaultAddress: string | null;
    buyerIsYou: boolean;
  };
  listing: {
    id: string;
    slug: string;
    title: string;
    mode: PricingMode;
    surface: Surface;
    deadline: IsoDate;
    deliveryDueAt: IsoDate;
    reviewWindowSeconds: number;
    chainAddress: string | null;
    // Fee policy snapshotted on-chain at publish; null before approval.
    feeBps: number | null;
    upliftFeeBps: number | null;
    maxFeeBps: number | null;
    photos: ListingPhoto[];
  };
  seller: { id: string; handle: string; displayName: string; avatarUrl: string | null; verified: boolean };
  proofPosts: Array<{ id: string; kind: PostKind; url: string | null; body: string; createdAt: IsoDate }>;
  dispute: {
    id: string;
    state: "open" | "withdrawn" | "resolved" | "timed_out";
    reason: string;
    openedAt: IsoDate;
    closedAt: IsoDate | null;
    sellerShareBps: number | null;
    decision: string | null;
    // Full refund to the sponsor if nobody resolves it by then (the timeout captured when it was raised).
    timeoutAt: IsoDate;
    // Images the sponsor attached when raising the dispute.
    evidence: Array<{ id: string; url: string; width: number | null; height: number | null }>;
  } | null;
  settlement: Settlement | null;
  deadlines: { deliveryDueAt: IsoDate; reviewUntil: IsoDate };
}

export type AssetKind = "listing_photo" | "post_media" | "brand_logo" | "evidence" | "avatar";

export interface UploadSignature {
  kind: AssetKind;
  cloudName: string;
  apiKey: string;
  folder: string;
  timestamp: number;
  allowedFormats?: string;
  signature: string;
  uploadUrl: string;
}

export interface MediaAsset {
  id: string;
  ownerId: string;
  kind: AssetKind;
  url: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: IsoDate;
}

// A multisig resolve proposal whose dispute closed another way (withdrawn or timed out). It can never
// execute (DisputeMismatch), so someone should cancel it in Squads; listed until Squads shows it cancelled.
export interface StaleSquadsProposal {
  disputeId: string;
  spotId: string;
  spotIndex: number;
  listingTitle: string;
  transactionIndex: number;
  proposal: string | null;
  disputeState: "withdrawn" | "timed_out";
  closedAt: IsoDate | null;
  // Squads' own status, null when it couldn't be read.
  status: string | null;
  // e.g. "the dispute was withdrawn; cancel Squads proposal #12"
  message: string;
}

export interface ReviewSummary {
  counts: { listingsInReview: number; openDisputes: number; payoutsReady: number; failedTxs: number; staleProposals?: number };
  staleProposals?: StaleSquadsProposal[];
  disputes: Array<{
    dispute: {
      id: string;
      spotId: string;
      buyerId: string;
      state: string;
      reason: string;
      openedAt: IsoDate;
      // Set while a decision waits for multisig approval.
      squadsTransactionIndex: number | null;
      proposedSellerShareBps: number | null;
      proposedAt: IsoDate | null;
    };
    spotId: string;
    spotIndex: number;
    amount: BaseUnits | null;
    listingId: string;
    listingTitle: string;
    sellerHandle: string;
    buyerHandle: string;
    // When the dispute refunds the sponsor in full if not resolved. The list is sorted by it.
    timeoutAt: IsoDate;
    // A resolve proposal is still waiting in Squads, so a new one would be refused. Optional for older APIs.
    proposalLive?: boolean;
    // The Squads proposal's state ("active", "approved", "executed", ...), null when unknown.
    proposalStatus?: string | null;
  }>;
  payoutsReady: Array<{ spotId: string; spotIndex: number; amount: BaseUnits | null; listingId: string; listingTitle: string }>;
  failedTxs: Array<{ id: string; op: string; error: string | null; signature: string | null; updatedAt: IsoDate; spotId: string | null }>;
}

export type ReviewQueueItem = Omit<PublicListing, "spots"> & {
  spots: Spot[];
  // Delivery is more than adminApprovalAfterDays out: only an admin can approve.
  needsAdminApproval?: boolean;
  adminApprovalAfterDays?: number;
};

// The creator's record on other listings, for the reviewer decision screen.
export interface SellerHistory {
  listingsSubmitted: number;
  listingsLive: number;
  listingsRejected: number;
  spotsSold: number;
  spotsPaidOut: number;
  spotsRefunded: number;
  disputes: number;
  openDisputes: number;
  onTimeRate: number | null;
}

export type ReviewListingDetail = ReviewQueueItem & { sellerHistory: SellerHistory };

export interface ProfilePage {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  verified: boolean;
  hasX: boolean;
  memberSince: IsoDate;
  socials: Partial<Record<"x" | "instagram" | "tiktok" | "youtube", string>>;
  stats: { spotsSold: number; spotsSponsored: number; deliveries: number; onTimeRate: number | null; activeListings: number };
  listings: PublicListing[];
}

export interface BidHistory {
  spotId: string;
  bidders: number;
  items: Array<{ id: string; amount: BaseUnits; createdAt: IsoDate; signature: string | null; bidder: string; profile: { handle: string; displayName: string; avatarUrl: string | null } | null; isYou: boolean; isTop: boolean }>;
}

export interface WatchItem {
  savedAt: IsoDate;
  listing: PublicListing;
}

export type NotificationCategory = "sales" | "bidding" | "delivery" | "disputes" | "payments" | "listings" | "messages" | "reminders";

export interface AppNotification {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  href: string | null;
  readAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface SponsoredSpot {
  listing: PublicListing;
  spot: { id: string; index: number; state: SpotState };
  brand: SponsorBrand;
}

export interface LedgerListingHit {
  id: string;
  title: string;
  slug: string;
  state: ListingState;
  mode: PricingMode;
  createdAt: IsoDate;
  sellerHandle: string;
  spotCount: number;
  soldCount: number;
}

export interface LedgerMove {
  party: "sponsor" | "creator" | "treasury" | "escrow";
  wallet: string | null;
  handle: string | null;
  amount: BaseUnits;
}

export interface ListingLedger {
  listing: { id: string; title: string; slug: string; mode: PricingMode; state: ListingState; seller: { handle: string; wallet: string | null } };
  totals: { sponsorsPaid: BaseUnits; refundedToSponsors: BaseUnits; creatorEarned: BaseUnits; platformFees: BaseUnits; heldInEscrow: BaseUnits };
  spots: Array<{ index: number; state: SpotState; price: BaseUnits; amount: BaseUnits | null; escrowIn: BaseUnits; escrowOut: BaseUnits; held: BaseUnits; expectedHeld: BaseUnits; balanced: boolean }>;
  entries: Array<{
    id: string;
    createdAt: IsoDate;
    op: string;
    status: string;
    signature: string | null;
    error: string | null;
    spotIndex: number | null;
    actor: { handle: string; wallet: string | null } | null;
    moves: LedgerMove[];
  }>;
  flags: Array<{ type: "failed_tx" | "unsettled_tx" | "escrow_mismatch"; entryId: string | null; message: string }>;
}

export interface LedgerVerification {
  entryId: string;
  chain: "ok" | "failed" | "missing";
  matches: boolean;
  actual: Record<string, BaseUnits>;
}

export interface TeamMember {
  userId: string;
  // Owners come from server settings, so they have no grant date.
  role: "owner" | "reviewer" | "admin";
  grantedAt: IsoDate | null;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  grantedByHandle: string | null;
}

// Admin rent reclaim. Lamports are read from chain; a closed account counts as 0.
export interface RentSpot {
  id: string;
  index: number;
  chainAddress: string;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  deadline: IsoDate;
  lamports: number;
  // The listing's on-chain rent payer; true when it is a former reviewer key (adopt before closing).
  rentPayer?: string | null;
  needsAdoption?: boolean;
}

export interface RentListing {
  id: string;
  title: string;
  slug: string;
  chainAddress: string;
  lamports: number;
  rentPayer?: string | null;
  needsAdoption?: boolean;
}

export interface RentReport {
  // Unsold spots on published listings whose deadline has passed.
  spots: RentSpot[];
  // Published listings whose spots are all finished.
  listings: RentListing[];
  reclaimableLamports: number;
  // Rent recorded to a former reviewer key: closing it needs the listings adopted first.
  needsAdoptionLamports?: number;
  serverRentPayer?: string | null;
}

// POST /admin/listings/adopt: moves live listings off a former reviewer key after a rotation.
export interface AdoptListingsReport {
  reviewer: string;
  adopted: Array<{ listingId: string; title: string; previousRentPayer: string; signature: string }>;
  skipped: Array<{ listingId: string; title: string; reason: string }>;
  failed: Array<{ listingId: string; title: string; error: string }>;
}

// Public protocol status (GET /status): no session needed; the pause flag is cached server-side.
export interface PublicStatus {
  paused: boolean;
  cluster: string;
  termsVersion: string;
}
