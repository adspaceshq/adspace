ALTER TYPE "app"."user_intent" ADD VALUE 'both' BEFORE 'browse';--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "email_verified_at" timestamp with time zone;