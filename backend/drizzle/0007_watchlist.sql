CREATE TABLE "app"."watchlist" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_user_id_listing_id_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
ALTER TABLE "app"."watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."watchlist" ADD CONSTRAINT "watchlist_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "app"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_listing_idx" ON "app"."watchlist" USING btree ("listing_id");