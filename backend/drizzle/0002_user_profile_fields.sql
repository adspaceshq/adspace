ALTER TABLE "app"."users" DROP CONSTRAINT "users_handle_format";--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "onboarding" jsonb;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "payout_wallet" text;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_handle_format" CHECK (handle ~ '^[A-Za-z0-9_-]{1,40}$');