ALTER TABLE "app"."users" ADD COLUMN "usdc_seen" bigint;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "usdc_seen_at" timestamp with time zone;