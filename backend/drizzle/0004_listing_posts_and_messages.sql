CREATE TABLE "app"."listing_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "app"."post_kind" NOT NULL,
	"url" text,
	"external_id" text,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "listing_posts_has_content" CHECK (url IS NOT NULL OR length(body) > 0 OR kind = 'photo'),
	CONSTRAINT "listing_posts_link_kinds_have_url" CHECK (kind IN ('photo', 'text') OR url IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."post_media" (
	"post_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "post_media_post_id_position_pk" PRIMARY KEY("post_id","position")
);
--> statement-breakpoint
CREATE TABLE "app"."post_metrics" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"source" "app"."metrics_source" NOT NULL,
	"views" bigint,
	"likes" bigint,
	"reposts" bigint,
	"replies" bigint,
	"bookmarks" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."spot_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"spot_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_messages_body_length" CHECK (length(body) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "app"."spot_proof_posts" (
	"spot_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	CONSTRAINT "spot_proof_posts_spot_id_post_id_pk" PRIMARY KEY("spot_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "app"."spots" ADD COLUMN "brand" jsonb;--> statement-breakpoint
ALTER TABLE "app"."spots" ADD COLUMN "proof_hash" text;--> statement-breakpoint
ALTER TABLE "app"."listing_posts" ADD CONSTRAINT "listing_posts_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "app"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."listing_posts" ADD CONSTRAINT "listing_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_media" ADD CONSTRAINT "post_media_post_id_listing_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "app"."listing_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_media" ADD CONSTRAINT "post_media_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."post_metrics" ADD CONSTRAINT "post_metrics_post_id_listing_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "app"."listing_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_messages" ADD CONSTRAINT "spot_messages_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_messages" ADD CONSTRAINT "spot_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_proof_posts" ADD CONSTRAINT "spot_proof_posts_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spot_proof_posts" ADD CONSTRAINT "spot_proof_posts_post_id_listing_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "app"."listing_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_posts_listing_idx" ON "app"."listing_posts" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX "post_metrics_post_idx" ON "app"."post_metrics" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "spot_messages_spot_idx" ON "app"."spot_messages" USING btree ("spot_id","created_at");