CREATE TABLE "app"."terms_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context" text NOT NULL,
	"spot_id" uuid,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_context" CHECK (context IN ('onboarding', 'claim', 'bid')),
	CONSTRAINT "terms_acceptances_version_length" CHECK (length(terms_version) BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "app"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."terms_acceptances" ADD CONSTRAINT "terms_acceptances_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "app"."spots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terms_acceptances_user_idx" ON "app"."terms_acceptances" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE INDEX "terms_acceptances_spot_idx" ON "app"."terms_acceptances" USING btree ("spot_id");