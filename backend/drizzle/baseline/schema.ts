import { pgTable, index, foreignKey, unique, check, uuid, text, numeric, timestamp, boolean, jsonb, integer, bigint } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const walletWithdrawals = pgTable("wallet_withdrawals", {
	id: uuid().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	sourceWallet: text("source_wallet").notNull(),
	destinationWallet: text("destination_wallet").notNull(),
	amount: numeric({ precision: 20, scale:  6 }).notNull(),
	status: text().notNull(),
	signature: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("wallet_withdrawals_user_created_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "wallet_withdrawals_user_id_fkey"
		}).onDelete("cascade"),
	unique("wallet_withdrawals_signature_key").on(table.signature),
	check("wallet_withdrawals_status_check", sql`status = ANY (ARRAY['pending'::text, 'processing'::text, 'confirmed'::text, 'failed'::text])`),
]);

export const users = pgTable("users", {
	id: uuid().primaryKey().notNull(),
	privyDid: text("privy_did").notNull(),
	xUserId: text("x_user_id"),
	xHandle: text("x_handle").notNull(),
	displayName: text("display_name"),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	bio: text().default(').notNull(),
	payoutWallet: text("payout_wallet").default(').notNull(),
	verified: boolean().default(true).notNull(),
	email: text(),
	walletAddress: text("wallet_address"),
	onboarding: jsonb(),
}, (table) => [
	unique("users_privy_did_key").on(table.privyDid),
	unique("users_x_user_id_key").on(table.xUserId),
]);

export const sessions = pgTable("sessions", {
	tokenHash: text("token_hash").primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	csrfToken: text("csrf_token").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sessions_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_fkey"
		}).onDelete("cascade"),
]);

export const listings = pgTable("listings", {
	id: uuid().primaryKey().notNull(),
	slug: text().notNull(),
	sellerUserId: uuid("seller_user_id").notNull(),
	sellerHandle: text("seller_handle").notNull(),
	title: text().notNull(),
	surface: text().default(').notNull(),
	story: text().default(').notNull(),
	imageUrl: text("image_url").default(').notNull(),
	mode: text().notNull(),
	currency: text().default('USD').notNull(),
	deadline: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	artworkClose: text("artwork_close").default(').notNull(),
	minIncrement: numeric("min_increment", { precision: 14, scale:  2 }),
	doubleUp: boolean("double_up").default(false).notNull(),
	status: text().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	fabric: text().default('#f6f6f7').notNull(),
	sellerWallet: text("seller_wallet"),
	chainListingAddress: text("chain_listing_address"),
	chainTxSignature: text("chain_tx_signature"),
	reviewNote: text("review_note").default(').notNull(),
	termsVersion: text("terms_version").default(').notNull(),
	termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true, mode: 'string' }),
	feeBps: integer("fee_bps"),
	upliftFeeBps: integer("uplift_fee_bps"),
	maxFeeBps: integer("max_fee_bps"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	reviewWindowSeconds: bigint("review_window_seconds", { mode: "number" }),
	deliveryDeadline: timestamp("delivery_deadline", { withTimezone: true, mode: 'string' }),
	chainAddress: text("chain_address"),
	chainSignatures: text("chain_signatures").array().default([""]).notNull(),
	platformFeeBps: integer("platform_fee_bps"),
	settlementWindowHours: integer("settlement_window_hours"),
}, (table) => [
	index("listings_seller_created_idx").using("btree", table.sellerUserId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.sellerUserId],
			foreignColumns: [users.id],
			name: "listings_seller_user_id_fkey"
		}).onDelete("restrict"),
	unique("listings_slug_key").on(table.slug),
	unique("listings_chain_listing_address_key").on(table.chainListingAddress),
	unique("listings_chain_tx_signature_key").on(table.chainTxSignature),
	check("listings_mode_check", sql`mode = ANY (ARRAY['fixed'::text, 'auction'::text])`),
	check("listings_status_check", sql`status = ANY (ARRAY['active'::text, 'approved'::text, 'submitted'::text, 'closed'::text])`),
]);

export const spots = pgTable("spots", {
	id: uuid().primaryKey().notNull(),
	listingId: uuid("listing_id").notNull(),
	label: text().notNull(),
	location: text().default(').notNull(),
	size: text().default(').notNull(),
	price: numeric({ precision: 14, scale:  2 }).notNull(),
	currency: text().notNull(),
	status: text().default('open').notNull(),
	buyerUserId: uuid("buyer_user_id"),
	buyerHandle: text("buyer_handle"),
	currentBid: numeric("current_bid", { precision: 14, scale:  2 }),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	fulfilledAt: timestamp("fulfilled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	view: text().default('lid').notNull(),
	websiteUrl: text("website_url").default(').notNull(),
	logoUrl: text("logo_url").default(').notNull(),
	x: numeric({ precision: 6, scale:  2 }),
	y: numeric({ precision: 6, scale:  2 }),
	w: numeric({ precision: 6, scale:  2 }),
	chainListingAddress: text("chain_listing_address"),
	chainSpotAddress: text("chain_spot_address"),
	chainVaultAddress: text("chain_vault_address"),
	chainBuyerWallet: text("chain_buyer_wallet"),
	chainTxSignature: text("chain_tx_signature"),
	artworkSubmittedAt: timestamp("artwork_submitted_at", { withTimezone: true, mode: 'string' }),
	proofPhotos: text("proof_photos").array().default([""]).notNull(),
	proofPost: text("proof_post").default(').notNull(),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: 'string' }),
	disputedAt: timestamp("disputed_at", { withTimezone: true, mode: 'string' }),
	disputeReason: text("dispute_reason").default(').notNull(),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	payoutAmount: numeric("payout_amount", { precision: 14, scale:  2 }),
	payoutFee: numeric("payout_fee", { precision: 14, scale:  2 }).default('0').notNull(),
	payoutReference: text("payout_reference").default(').notNull(),
	payoutDestination: text("payout_destination").default(').notNull(),
	chainAddress: text("chain_address"),
	chainSignature: text("chain_signature"),
	chainClaimSignature: text("chain_claim_signature"),
	chainBidSignature: text("chain_bid_signature"),
	chainProofSignature: text("chain_proof_signature"),
	chainSettlementSignature: text("chain_settlement_signature"),
	chainDisputeSignature: text("chain_dispute_signature"),
	chainResolutionSignature: text("chain_resolution_signature"),
}, (table) => [
	index("spots_buyer_user_id_idx").using("btree", table.buyerUserId.asc().nullsLast().op("uuid_ops")),
	index("spots_listing_status_idx").using("btree", table.listingId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.buyerUserId],
			foreignColumns: [users.id],
			name: "spots_buyer_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.listingId],
			foreignColumns: [listings.id],
			name: "spots_listing_id_fkey"
		}).onDelete("cascade"),
	unique("spots_chain_tx_signature_key").on(table.chainTxSignature),
	check("spots_price_check", sql`price > (0)::numeric`),
	check("spots_status_check", sql`status = ANY (ARRAY['open'::text, 'claimed'::text, 'sold'::text])`),
]);

export const bids = pgTable("bids", {
	id: uuid().primaryKey().notNull(),
	spotId: uuid("spot_id").notNull(),
	bidderUserId: uuid("bidder_user_id").notNull(),
	bidderHandle: text("bidder_handle").notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bids_bidder_user_id_idx").using("btree", table.bidderUserId.asc().nullsLast().op("uuid_ops")),
	index("bids_spot_created_idx").using("btree", table.spotId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.bidderUserId],
			foreignColumns: [users.id],
			name: "bids_bidder_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.spotId],
			foreignColumns: [spots.id],
			name: "bids_spot_id_fkey"
		}).onDelete("cascade"),
	check("bids_amount_check", sql`amount > (0)::numeric`),
]);
