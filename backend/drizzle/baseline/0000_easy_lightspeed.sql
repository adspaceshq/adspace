-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "wallet_withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source_wallet" text NOT NULL,
	"destination_wallet" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"status" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "wallet_withdrawals_signature_key" UNIQUE("signature"),
	CONSTRAINT "wallet_withdrawals_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'confirmed'::text, 'failed'::text]))
);
--> statement-breakpoint
ALTER TABLE "wallet_withdrawals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"privy_did" text NOT NULL,
	"x_user_id" text,
	"x_handle" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"payout_wallet" text DEFAULT '' NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"email" text,
	"wallet_address" text,
	"onboarding" jsonb,
	CONSTRAINT "users_privy_did_key" UNIQUE("privy_did"),
	CONSTRAINT "users_x_user_id_key" UNIQUE("x_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"seller_handle" text NOT NULL,
	"title" text NOT NULL,
	"surface" text DEFAULT '' NOT NULL,
	"story" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"mode" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"artwork_close" text DEFAULT '' NOT NULL,
	"min_increment" numeric(14, 2),
	"double_up" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fabric" text DEFAULT '#f6f6f7' NOT NULL,
	"seller_wallet" text,
	"chain_listing_address" text,
	"chain_tx_signature" text,
	"review_note" text DEFAULT '' NOT NULL,
	"terms_version" text DEFAULT '' NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"fee_bps" integer,
	"uplift_fee_bps" integer,
	"max_fee_bps" integer,
	"review_window_seconds" bigint,
	"delivery_deadline" timestamp with time zone,
	"chain_address" text,
	"chain_signatures" text[] DEFAULT '{""}' NOT NULL,
	"platform_fee_bps" integer,
	"settlement_window_hours" integer,
	CONSTRAINT "listings_slug_key" UNIQUE("slug"),
	CONSTRAINT "listings_chain_listing_address_key" UNIQUE("chain_listing_address"),
	CONSTRAINT "listings_chain_tx_signature_key" UNIQUE("chain_tx_signature"),
	CONSTRAINT "listings_mode_check" CHECK (mode = ANY (ARRAY['fixed'::text, 'auction'::text])),
	CONSTRAINT "listings_status_check" CHECK (status = ANY (ARRAY['active'::text, 'approved'::text, 'submitted'::text, 'closed'::text]))
);
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"label" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"buyer_user_id" uuid,
	"buyer_handle" text,
	"current_bid" numeric(14, 2),
	"claimed_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"view" text DEFAULT 'lid' NOT NULL,
	"website_url" text DEFAULT '' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"x" numeric(6, 2),
	"y" numeric(6, 2),
	"w" numeric(6, 2),
	"chain_listing_address" text,
	"chain_spot_address" text,
	"chain_vault_address" text,
	"chain_buyer_wallet" text,
	"chain_tx_signature" text,
	"artwork_submitted_at" timestamp with time zone,
	"proof_photos" text[] DEFAULT '{""}' NOT NULL,
	"proof_post" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"dispute_reason" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone,
	"payout_amount" numeric(14, 2),
	"payout_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payout_reference" text DEFAULT '' NOT NULL,
	"payout_destination" text DEFAULT '' NOT NULL,
	"chain_address" text,
	"chain_signature" text,
	"chain_claim_signature" text,
	"chain_bid_signature" text,
	"chain_proof_signature" text,
	"chain_settlement_signature" text,
	"chain_dispute_signature" text,
	"chain_resolution_signature" text,
	CONSTRAINT "spots_chain_tx_signature_key" UNIQUE("chain_tx_signature"),
	CONSTRAINT "spots_price_check" CHECK (price > (0)::numeric),
	CONSTRAINT "spots_status_check" CHECK (status = ANY (ARRAY['open'::text, 'claimed'::text, 'sold'::text]))
);
--> statement-breakpoint
ALTER TABLE "spots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"spot_id" uuid NOT NULL,
	"bidder_user_id" uuid NOT NULL,
	"bidder_handle" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_amount_check" CHECK (amount > (0)::numeric)
);
--> statement-breakpoint
ALTER TABLE "bids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallet_withdrawals" ADD CONSTRAINT "wallet_withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots" ADD CONSTRAINT "spots_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots" ADD CONSTRAINT "spots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_user_id_fkey" FOREIGN KEY ("bidder_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "public"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_withdrawals_user_created_idx" ON "wallet_withdrawals" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "listings_seller_created_idx" ON "listings" USING btree ("seller_user_id" uuid_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "spots_buyer_user_id_idx" ON "spots" USING btree ("buyer_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "spots_listing_status_idx" ON "spots" USING btree ("listing_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "bids_bidder_user_id_idx" ON "bids" USING btree ("bidder_user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "bids_spot_created_idx" ON "bids" USING btree ("spot_id" timestamptz_ops,"created_at" timestamptz_ops);
*/