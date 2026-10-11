ALTER TABLE "app"."chain_txs" ADD COLUMN "prepared_tx" text;--> statement-breakpoint
ALTER TABLE "app"."chain_txs" ADD COLUMN "last_valid_block_height" bigint;