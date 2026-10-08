import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// New tables live in their own Postgres schema so the legacy `public` tables keep serving
// the current backend until cutover.
export const app = pgSchema("app");

// All money is USDC base units (6 decimals) in bigint; never floats.
const usdc = (name: string) => bigint(name, { mode: "bigint" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const at = (name: string) => timestamp(name, { withTimezone: true });

// ---------- enums ----------

export const userIntent = app.enum("user_intent", ["sell", "sponsor", "both", "browse"]);
export const surface = app.enum("surface", ["laptop", "tshirt", "car", "suitcase", "bike", "digital", "other"]);
export const pricingMode = app.enum("pricing_mode", ["fixed", "auction"]);

export const listingState = app.enum("listing_state", [
  "draft",
  "in_review",
  "changes_requested",
  "rejected",
  "approved",
  "publishing",
  "published",
  "closed",
]);

// Mirrors the on-chain spot lifecycle; written only from confirmed transactions.
export const spotState = app.enum("spot_state", [
  "open",
  "funded",
  "delivered",
  "disputed",
  "settled",
  "refunded",
  "cancelled",
]);

export const disputeState = app.enum("dispute_state", ["open", "withdrawn", "resolved", "timed_out"]);
export const settlementKind = app.enum("settlement_kind", ["payout", "refund", "dispute_split", "timeout_refund"]);

export const chainOp = app.enum("chain_op", [
  "publish_listing",
  "claim_spot",
  "place_bid",
  "submit_proof",
  "raise_dispute",
  "withdraw_dispute",
  "resolve_dispute",
  "timeout_dispute",
  "withdraw_seller",
  "refund_spot",
  "close_spot",
  "close_listing",
  "wallet_withdrawal",
  "pause_protocol",
  "set_dispute_timeout",
]);
export const chainTxStatus = app.enum("chain_tx_status", ["pending", "submitted", "confirmed", "failed"]);

export const assetKind = app.enum("asset_kind", ["avatar", "listing_photo", "post_media", "brand_logo", "evidence"]);
export const postKind = app.enum("post_kind", ["x", "instagram", "tiktok", "youtube", "link", "photo", "text"]);
export const metricsSource = app.enum("metrics_source", ["manual", "x_api", "instagram_api", "tiktok_api", "youtube_api"]);

export interface SponsorBrand {
  name: string;
  link?: string;
  handle?: string;
  logoUrl?: string;
}
export const withdrawalState = app.enum("withdrawal_state", ["pending", "submitted", "confirmed", "failed"]);

// ---------- identity ----------

export const users = app.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    privyDid: text("privy_did").notNull().unique(),
    xUserId: text("x_user_id").unique(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    bio: text("bio").notNull().default(""),
    email: text("email"),
    // Set when Privy reports a linked (OTP-verified) email; required before onboarding.
    emailVerifiedAt: at("email_verified_at"),
    walletAddress: text("wallet_address").unique(),
    intent: userIntent("intent"),
    onboarding: jsonb("onboarding").$type<Record<string, unknown>>(),
    payoutWallet: text("payout_wallet"),
    verified: boolean("verified").notNull().default(false),
    isReviewer: boolean("is_reviewer").notNull().default(false),
    gaslessEnabledAt: at("gasless_enabled_at"),
    onboardedAt: at("onboarded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_handle_lower_idx").on(sql`lower(handle)`),
    // X usernames, or `user-xxxxxxxx` for accounts without X; stored without the leading @.
    check("users_handle_format", sql`handle ~ '^[A-Za-z0-9_-]{1,40}$'`),
  ],
);

export const sessions = app.table(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const mediaAssets = app.table(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    url: text("url").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256"),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_owner_idx").on(t.ownerId, t.kind), check("media_assets_bytes_positive", sql`bytes > 0`)],
);

// ---------- marketplace ----------

export const listings = app.table(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    surface: surface("surface").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    audience: jsonb("audience").$type<{ followers?: number; event?: string; location?: string }>().notNull().default({}),
    mode: pricingMode("mode").notNull(),
    state: listingState("state").notNull().default("draft"),

    deadline: at("deadline").notNull(),
    artworkDueAt: at("artwork_due_at").notNull(),
    deliveryDueAt: at("delivery_due_at").notNull(),
    reviewWindowSeconds: integer("review_window_seconds").notNull().default(172_800),
    minIncrement: usdc("min_increment").notNull().default(sql`0`),
    doubleUp: boolean("double_up").notNull().default(false),

    // Fee policy is set by the reviewer and snapshotted on-chain at publish time.
    feeBps: smallint("fee_bps"),
    upliftFeeBps: smallint("uplift_fee_bps"),
    maxFeeBps: smallint("max_fee_bps"),

    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: at("reviewed_at"),
    termsVersion: text("terms_version"),
    termsAcceptedAt: at("terms_accepted_at"),

    chainAddress: text("chain_address").unique(),
    sellerWallet: text("seller_wallet"),
    publishedAt: at("published_at"),
    closedAt: at("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("listings_state_deadline_idx").on(t.state, t.deadline),
    index("listings_seller_idx").on(t.sellerId),
    // deadline <= artwork_due_at holds at creation only: on-chain anti-sniping can extend the deadline later.
    check("listings_dates_ordered", sql`delivery_due_at > artwork_due_at`),
    check("listings_review_window", sql`review_window_seconds BETWEEN 60 AND 2592000`),
    check(
      "listings_fee_policy",
      sql`fee_bps IS NULL OR (
        fee_bps BETWEEN 0 AND 10000 AND
        CASE WHEN mode = 'fixed'
          THEN uplift_fee_bps = 0 AND max_fee_bps = fee_bps
          ELSE fee_bps <= max_fee_bps AND max_fee_bps <= uplift_fee_bps AND uplift_fee_bps <= 10000
        END)`,
    ),
    check("listings_auction_increment", sql`mode = 'fixed' OR double_up OR min_increment > 0`),
    check(
      "listings_reviewed_fees",
      sql`state IN ('draft', 'in_review', 'changes_requested', 'rejected') OR fee_bps IS NOT NULL`,
    ),
    check("listings_published_chain", sql`state NOT IN ('published', 'closed') OR chain_address IS NOT NULL`),
  ],
);

export const listingPhotos = app.table(
  "listing_photos",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.position] })],
);

export const spots = app.table(
  "spots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    index: smallint("index").notNull(),
    label: text("label").notNull().default(""),
    price: usdc("price").notNull(),
    layout: jsonb("layout").$type<{ x: number; y: number; w: number; h?: number; view?: string }>().notNull(),
    state: spotState("state").notNull().default("open"),

    buyerId: uuid("buyer_id").references(() => users.id, { onDelete: "restrict" }),
    buyerWallet: text("buyer_wallet"),
    amount: usdc("amount"),

    // Sponsor brand given at checkout; the creator puts this on the spot.
    brand: jsonb("brand").$type<SponsorBrand>(),
    proofHash: text("proof_hash"),
    proofSubmittedAt: at("proof_submitted_at"),
    buyerConfirmedAt: at("buyer_confirmed_at"),

    chainAddress: text("chain_address").unique(),
    vaultAddress: text("vault_address").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("spots_listing_index_idx").on(t.listingId, t.index),
    index("spots_state_idx").on(t.state),
    index("spots_buyer_idx").on(t.buyerId),
    check("spots_index_range", sql`index BETWEEN 0 AND 59`),
    check("spots_price_positive", sql`price > 0`),
    check(
      "spots_holder_matches_state",
      sql`(state IN ('open', 'cancelled') AND buyer_id IS NULL AND amount IS NULL)
        OR (state NOT IN ('open', 'cancelled') AND buyer_id IS NOT NULL AND buyer_wallet IS NOT NULL AND amount >= price)`,
    ),
    check("spots_proof_before_delivered", sql`state <> 'delivered' OR proof_submitted_at IS NOT NULL`),
  ],
);

// ---------- listing posts (creator updates, delivery proof, insights) ----------

// Only the creator and reviewers post; posts are public on the listing page.
export const listingPosts = app.table(
  "listing_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: postKind("kind").notNull(),
    url: text("url"),
    externalId: text("external_id"),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
    deletedAt: at("deleted_at"),
  },
  (t) => [
    index("listing_posts_listing_idx").on(t.listingId, t.createdAt),
    check("listing_posts_has_content", sql`url IS NOT NULL OR length(body) > 0 OR kind = 'photo'`),
    check("listing_posts_link_kinds_have_url", sql`kind IN ('photo', 'text') OR url IS NOT NULL`),
  ],
);

export const postMedia = app.table(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => listingPosts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.position] })],
);

// Posts tagged as delivery proof for a spot; their hash is what goes on-chain.
export const spotProofPosts = app.table(
  "spot_proof_posts",
  {
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => listingPosts.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.spotId, t.postId] })],
);

// Point-in-time snapshots; the latest per post is what the UI shows.
export const postMetrics = app.table(
  "post_metrics",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => listingPosts.id, { onDelete: "cascade" }),
    source: metricsSource("source").notNull(),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    reposts: bigint("reposts", { mode: "number" }),
    replies: bigint("replies", { mode: "number" }),
    bookmarks: bigint("bookmarks", { mode: "number" }),
    capturedAt: createdAt(),
  },
  (t) => [index("post_metrics_post_idx").on(t.postId, t.capturedAt)],
);

// Private thread per spot between sponsor and creator; reviewers can read and post.
export const spotMessages = app.table(
  "spot_messages",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("spot_messages_spot_idx").on(t.spotId, t.createdAt),
    check("spot_messages_body_length", sql`length(body) BETWEEN 1 AND 2000`),
  ],
);

// Append-only; bids are never deleted.
export const bids = app.table(
  "bids",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "cascade" }),
    bidderId: uuid("bidder_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bidderWallet: text("bidder_wallet").notNull(),
    amount: usdc("amount").notNull(),
    chainTxId: uuid("chain_tx_id").references(() => chainTxs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("bids_spot_amount_idx").on(t.spotId, t.amount), check("bids_amount_positive", sql`amount > 0`)],
);

export const disputes = app.table(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "cascade" }),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    state: disputeState("state").notNull().default("open"),
    reason: text("reason").notNull(),
    sellerShareBps: smallint("seller_share_bps"),
    decision: text("decision"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: createdAt(),
    closedAt: at("closed_at"),
  },
  (t) => [
    // One active dispute per spot; history of withdrawn disputes is kept.
    uniqueIndex("disputes_one_open_idx").on(t.spotId).where(sql`state = 'open'`),
    check("disputes_share_range", sql`seller_share_bps IS NULL OR seller_share_bps BETWEEN 0 AND 10000`),
    check(
      "disputes_resolution_complete",
      sql`state <> 'resolved' OR (seller_share_bps IS NOT NULL AND decision IS NOT NULL AND resolved_by IS NOT NULL)`,
    ),
  ],
);

export const disputeEvidence = app.table(
  "dispute_evidence",
  {
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.disputeId, t.position] })],
);

export const settlements = app.table(
  "settlements",
  {
    spotId: uuid("spot_id")
      .primaryKey()
      .references(() => spots.id, { onDelete: "restrict" }),
    kind: settlementKind("kind").notNull(),
    gross: usdc("gross").notNull(),
    fee: usdc("fee").notNull(),
    sellerNet: usdc("seller_net").notNull(),
    buyerRefund: usdc("buyer_refund").notNull(),
    chainTxId: uuid("chain_tx_id")
      .notNull()
      .references(() => chainTxs.id, { onDelete: "restrict" }),
    settledAt: createdAt(),
  },
  (t) => [
    check("settlements_balanced", sql`fee + seller_net + buyer_refund = gross`),
    check("settlements_non_negative", sql`fee >= 0 AND seller_net >= 0 AND buyer_refund >= 0`),
  ],
);

// ---------- chain bookkeeping ----------

// Written as `pending` before sending, so a crash after confirmation is recoverable.
export const chainTxs = app.table(
  "chain_txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    op: chainOp("op").notNull(),
    status: chainTxStatus("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    spotId: uuid("spot_id").references(() => spots.id, { onDelete: "set null" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    signature: text("signature").unique(),
    error: text("error"),
    attempts: smallint("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    confirmedAt: at("confirmed_at"),
  },
  (t) => [
    index("chain_txs_status_idx").on(t.status, t.updatedAt),
    index("chain_txs_spot_idx").on(t.spotId),
    check("chain_txs_confirmed_signature", sql`status <> 'confirmed' OR (signature IS NOT NULL AND confirmed_at IS NOT NULL)`),
  ],
);

export const spotEvents = app.table(
  "spot_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    spotId: uuid("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "cascade" }),
    fromState: spotState("from_state"),
    toState: spotState("to_state"),
    type: text("type").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    chainTxId: uuid("chain_tx_id").references(() => chainTxs.id, { onDelete: "set null" }),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("spot_events_spot_idx").on(t.spotId, t.createdAt)],
);

export const withdrawals = app.table(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: usdc("amount").notNull(),
    destination: text("destination").notNull(),
    state: withdrawalState("state").notNull().default("pending"),
    chainTxId: uuid("chain_tx_id").references(() => chainTxs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("withdrawals_user_created_idx").on(t.userId, t.createdAt),
    check("withdrawals_amount_positive", sql`amount > 0`),
  ],
);
