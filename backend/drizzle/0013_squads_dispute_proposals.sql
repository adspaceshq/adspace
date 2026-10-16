ALTER TYPE "app"."chain_op" ADD VALUE 'squads_proposal';--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "squads_multisig" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "squads_transaction_index" bigint;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "squads_vault_transaction" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "squads_proposal" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "proposed_seller_share_bps" smallint;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "proposed_decision" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "decision_hash" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "decision_uri" text;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "proposed_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_proposal_complete" CHECK ((squads_transaction_index IS NULL) = (squads_multisig IS NULL)
        AND (squads_transaction_index IS NULL) = (squads_vault_transaction IS NULL)
        AND (squads_transaction_index IS NULL) = (squads_proposal IS NULL)
        AND (squads_transaction_index IS NULL) = (proposed_seller_share_bps IS NULL)
        AND (squads_transaction_index IS NULL) = (proposed_decision IS NULL)
        AND (squads_transaction_index IS NULL) = (decision_hash IS NULL)
        AND (squads_transaction_index IS NULL) = (decision_uri IS NULL)
        AND (squads_transaction_index IS NULL) = (proposed_at IS NULL));--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_proposed_share_range" CHECK (proposed_seller_share_bps IS NULL OR proposed_seller_share_bps BETWEEN 0 AND 10000);