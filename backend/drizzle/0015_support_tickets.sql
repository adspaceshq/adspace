CREATE TYPE "app"."support_state" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "app"."support_topic" AS ENUM('buying', 'selling', 'payments', 'disputes', 'account', 'bug', 'other');--> statement-breakpoint
ALTER TYPE "app"."asset_kind" ADD VALUE 'support';--> statement-breakpoint
CREATE TABLE "app"."support_attachments" (
	"message_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "support_attachments_message_id_position_pk" PRIMARY KEY("message_id","position")
);
--> statement-breakpoint
CREATE TABLE "app"."support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"from_staff" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_body_length" CHECK (length(body) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "app"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" "app"."support_topic" NOT NULL,
	"subject" text NOT NULL,
	"state" "app"."support_state" DEFAULT 'open' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_tickets_subject_length" CHECK (length(subject) BETWEEN 3 AND 120)
);
--> statement-breakpoint
ALTER TABLE "app"."support_attachments" ADD CONSTRAINT "support_attachments_message_id_support_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."support_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_attachments" ADD CONSTRAINT "support_attachments_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "app"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "app"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_messages" ADD CONSTRAINT "support_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "app"."support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "app"."support_tickets" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "support_tickets_state_idx" ON "app"."support_tickets" USING btree ("state","updated_at");