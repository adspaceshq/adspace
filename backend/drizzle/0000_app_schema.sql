CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."asset_kind" AS ENUM('avatar', 'listing_photo', 'artwork', 'proof', 'evidence');--> statement-breakpoint
CREATE TYPE "app"."chain_op" AS ENUM('publish_listing', 'claim_spot', 'place_bid', 'submit_proof', 'raise_dispute', 'withdraw_dispute', 'resolve_dispute', 'timeout_dispute', 'withdraw_seller', 'refund_spot', 'close_spot', 'close_listing', 'wallet_withdrawal');--> statement-breakpoint
CREATE TYPE "app"."chain_tx_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "app"."dispute_state" AS ENUM('open', 'withdrawn', 'resolved', 'timed_out');--> statement-breakpoint
CREATE TYPE "app"."listing_state" AS ENUM('draft', 'in_review', 'changes_requested', 'rejected', 'approved', 'publishing', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "app"."pricing_mode" AS ENUM('fixed', 'auction');--> statement-breakpoint
CREATE TYPE "app"."settlement_kind" AS ENUM('payout', 'refund', 'dispute_split', 'timeout_refund');--> statement-breakpoint
CREATE TYPE "app"."spot_state" AS ENUM('open', 'funded', 'delivered', 'disputed', 'settled', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."surface" AS ENUM('laptop', 'tshirt', 'car', 'suitcase', 'bike', 'digital', 'other');--> statement-breakpoint
CREATE TYPE "app"."user_intent" AS ENUM('sell', 'sponsor', 'browse');--> statement-breakpoint
CREATE TYPE "app"."withdrawal_state" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "app"."bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"spot_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"bidder_wallet" text NOT NULL,
	"amount" bigint NOT NULL,
	"chain_tx_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."chain_txs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"op" "app"."chain_op" NOT NULL,
	"status" "app"."chain_tx_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"listing_id" uuid,
	"spot_id" uuid,
	"actor_id" uuid,
	"signature" text,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "chain_txs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "chain_txs_signature_unique" UNIQUE("signature"),
	CONSTRAINT "chain_txs_confirmed_signature" CHECK (status <> 'confirmed' OR (signature IS NOT NULL AND confirmed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."dispute_evidence" (
	"dispute_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "dispute_evidence_dispute_id_position_pk" PRIMARY KEY("dispute_id","position")
);
--> statement-breakpoint
CREATE TABLE "app"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"state" "app"."dispute_state" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"seller_share_bps" smallint,
	"decision" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "disputes_share_range" CHECK (seller_share_bps IS NULL OR seller_share_bps BETWEEN 0 AND 10000),
	CONSTRAINT "disputes_resolution_complete" CHECK (state <> 'resolved' OR (seller_share_bps IS NOT NULL AND decision IS NOT NULL AND resolved_by IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."listing_photos" (
	"listing_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "listing_photos_listing_id_position_pk" PRIMARY KEY("listing_id","position")
);
--> statement-breakpoint
CREATE TABLE "app"."listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"seller_id" uuid NOT NULL,
	"surface" "app"."surface" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mode" "app"."pricing_mode" NOT NULL,
	"state" "app"."listing_state" DEFAULT 'draft' NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"artwork_due_at" timestamp with time zone NOT NULL,
	"delivery_due_at" timestamp with time zone NOT NULL,
	"review_window_seconds" integer DEFAULT 172800 NOT NULL,
	"min_increment" bigint DEFAULT 0 NOT NULL,
	"double_up" boolean DEFAULT false NOT NULL,
	"fee_bps" smallint,
	"uplift_fee_bps" smallint,
	"max_fee_bps" smallint,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"chain_address" text,
	"seller_wallet" text,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_slug_unique" UNIQUE("slug"),
	CONSTRAINT "listings_chain_address_unique" UNIQUE("chain_address"),
	CONSTRAINT "listings_dates_ordered" CHECK (artwork_due_at >= deadline AND delivery_due_at > artwork_due_at),
	CONSTRAINT "listings_review_window" CHECK (review_window_seconds BETWEEN 60 AND 2592000),
	CONSTRAINT "listings_fee_policy" CHECK (fee_bps IS NULL OR (
        fee_bps BETWEEN 0 AND 10000 AND
        CASE WHEN mode = 'fixed'
          THEN uplift_fee_bps = 0 AND max_fee_bps = fee_bps
          ELSE fee_bps <= max_fee_bps AND max_fee_bps <= uplift_fee_bps AND uplift_fee_bps <= 10000
        END)),
	CONSTRAINT "listings_auction_increment" CHECK (mode = 'fixed' OR double_up OR min_increment > 0),
	CONSTRAINT "listings_reviewed_fees" CHECK (state IN ('draft', 'in_review', 'changes_requested', 'rejected') OR fee_bps IS NOT NULL),
	CONSTRAINT "listings_published_chain" CHECK (state NOT IN ('published', 'closed') OR chain_address IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "app"."asset_kind" NOT NULL,
	"url" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_bytes_positive" CHECK (bytes > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."settlements" (
	"spot_id" uuid PRIMARY KEY NOT NULL,
	"kind" "app"."settlement_kind" NOT NULL,
	"gross" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"seller_net" bigint NOT NULL,
	"buyer_refund" bigint NOT NULL,
	"chain_tx_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_balanced" CHECK (fee + seller_net + buyer_refund = gross),
	CONSTRAINT "settlements_non_negative" CHECK (fee >= 0 AND seller_net >= 0 AND buyer_refund >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."spot_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"spot_id" uuid NOT NULL,
	"from_state" "app"."spot_state",
	"to_state" "app"."spot_state",
	"type" text NOT NULL,
	"actor_id" uuid,
	"chain_tx_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."spot_proof_photos" (
	"spot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "spot_proof_photos_spot_id_position_pk" PRIMARY KEY("spot_id","position")
);
--> statement-breakpoint
CREATE TABLE "app"."spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"index" smallint NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"price" bigint NOT NULL,
	"layout" jsonb NOT NULL,
	"state" "app"."spot_state" DEFAULT 'open' NOT NULL,
	"buyer_id" uuid,
	"buyer_wallet" text,
	"amount" bigint,
	"artwork_asset_id" uuid,
	"artwork_submitted_at" timestamp with time zone,
	"proof_post_url" text,
	"proof_submitted_at" timestamp with time zone,
	"buyer_confirmed_at" timestamp with time zone,
	"chain_address" text,
	"vault_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spots_chain_address_unique" UNIQUE("chain_address"),
	CONSTRAINT "spots_vault_address_unique" UNIQUE("vault_address"),
	CONSTRAINT "spots_index_range" CHECK (index BETWEEN 0 AND 59),
	CONSTRAINT "spots_price_positive" CHECK (price > 0),
	CONSTRAINT "spots_holder_matches_state" CHECK ((state IN ('open', 'cancelled') AND buyer_id IS NULL AND amount IS NULL)
        OR (state NOT IN ('open', 'cancelled') AND buyer_id IS NOT NULL AND buyer_wallet IS NOT NULL AND amount >= price)),
	CONSTRAINT "spots_proof_before_delivered" CHECK (state <> 'delivered' OR proof_submitted_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_did" text NOT NULL,
	"x_user_id" text,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"email" text,
	"wallet_address" text,
	"intent" "app"."user_intent",
	"is_reviewer" boolean DEFAULT false NOT NULL,
	"gasless_enabled_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_did_unique" UNIQUE("privy_did"),
	CONSTRAINT "users_x_user_id_unique" UNIQUE("x_user_id"),
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_handle_format" CHECK (handle ~ '^[A-Za-z0-9_]{1,30}$')
);
--> statement-breakpoint
CREATE TABLE "app"."withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"destination" text NOT NULL,
	"state" "app"."withdrawal_state" DEFAULT 'pending' NOT NULL,
	"chain_tx_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."bids" ADD CONSTRAINT "bids_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bids" ADD CONSTRAINT "bids_bidder_id_users_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bids" ADD CONSTRAINT "bids_chain_tx_id_chain_txs_id_fk" FOREIGN KEY ("chain_tx_id") REFERENCES "app"."chain_txs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chain_txs" ADD CONSTRAINT "chain_txs_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "app"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chain_txs" ADD CONSTRAINT "chain_txs_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chain_txs" ADD CONSTRAINT "chain_txs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "app"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."listing_photos" ADD CONSTRAINT "listing_photos_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "app"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."listing_photos" ADD CONSTRAINT "listing_photos_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."listings" ADD CONSTRAINT "listings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."media_assets" ADD CONSTRAINT "media_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_chain_tx_id_chain_txs_id_fk" FOREIGN KEY ("chain_tx_id") REFERENCES "app"."chain_txs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_events" ADD CONSTRAINT "spot_events_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_events" ADD CONSTRAINT "spot_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_events" ADD CONSTRAINT "spot_events_chain_tx_id_chain_txs_id_fk" FOREIGN KEY ("chain_tx_id") REFERENCES "app"."chain_txs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_proof_photos" ADD CONSTRAINT "spot_proof_photos_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_proof_photos" ADD CONSTRAINT "spot_proof_photos_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spots" ADD CONSTRAINT "spots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "app"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spots" ADD CONSTRAINT "spots_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spots" ADD CONSTRAINT "spots_artwork_asset_id_media_assets_id_fk" FOREIGN KEY ("artwork_asset_id") REFERENCES "app"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."withdrawals" ADD CONSTRAINT "withdrawals_chain_tx_id_chain_txs_id_fk" FOREIGN KEY ("chain_tx_id") REFERENCES "app"."chain_txs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_spot_amount_idx" ON "app"."bids" USING btree ("spot_id","amount");--> statement-breakpoint
CREATE INDEX "chain_txs_status_idx" ON "app"."chain_txs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "chain_txs_spot_idx" ON "app"."chain_txs" USING btree ("spot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_one_open_idx" ON "app"."disputes" USING btree ("spot_id") WHERE state = 'open';--> statement-breakpoint
CREATE INDEX "listings_state_deadline_idx" ON "app"."listings" USING btree ("state","deadline");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "app"."listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "app"."media_assets" USING btree ("owner_id","kind");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "app"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "app"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "spot_events_spot_idx" ON "app"."spot_events" USING btree ("spot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spots_listing_index_idx" ON "app"."spots" USING btree ("listing_id","index");--> statement-breakpoint
CREATE INDEX "spots_state_idx" ON "app"."spots" USING btree ("state");--> statement-breakpoint
CREATE INDEX "spots_buyer_idx" ON "app"."spots" USING btree ("buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_lower_idx" ON "app"."users" USING btree (lower(handle));--> statement-breakpoint
CREATE INDEX "withdrawals_user_created_idx" ON "app"."withdrawals" USING btree ("user_id","created_at");