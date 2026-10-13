CREATE TYPE "app"."staff_role" AS ENUM('reviewer', 'admin');--> statement-breakpoint
CREATE TABLE "app"."staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "app"."staff_role" NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff" ADD CONSTRAINT "staff_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;