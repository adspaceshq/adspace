CREATE TYPE "app"."email_state" AS ENUM('pending', 'sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"email_state" "app"."email_state" DEFAULT 'pending' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "app"."spot_events" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "app"."notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "app"."notifications" USING btree ("created_at") WHERE email_state = 'pending';--> statement-breakpoint
CREATE INDEX "spot_events_unnotified_idx" ON "app"."spot_events" USING btree ("created_at") WHERE notified_at is null;--> statement-breakpoint
-- Events from before notifications existed are treated as already handled (no backfill emails).
UPDATE "app"."spot_events" SET "notified_at" = now() WHERE "notified_at" IS NULL;
