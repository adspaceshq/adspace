CREATE TYPE "app"."metrics_source" AS ENUM('manual', 'x_api', 'instagram_api', 'tiktok_api', 'youtube_api');--> statement-breakpoint
CREATE TYPE "app"."post_kind" AS ENUM('x', 'instagram', 'tiktok', 'youtube', 'link', 'photo', 'text');--> statement-breakpoint
ALTER TABLE "app"."spot_proof_photos" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app"."spot_proof_photos" CASCADE;--> statement-breakpoint
ALTER TABLE "app"."spots" DROP CONSTRAINT "spots_artwork_asset_id_media_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "app"."media_assets" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "app"."asset_kind";--> statement-breakpoint
CREATE TYPE "app"."asset_kind" AS ENUM('avatar', 'listing_photo', 'post_media', 'brand_logo', 'evidence');--> statement-breakpoint
ALTER TABLE "app"."media_assets" ALTER COLUMN "kind" SET DATA TYPE "app"."asset_kind" USING "kind"::"app"."asset_kind";--> statement-breakpoint
ALTER TABLE "app"."spots" DROP COLUMN "artwork_asset_id";--> statement-breakpoint
ALTER TABLE "app"."spots" DROP COLUMN "artwork_submitted_at";--> statement-breakpoint
ALTER TABLE "app"."spots" DROP COLUMN "proof_post_url";