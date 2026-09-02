ALTER TABLE "agents" ADD COLUMN "claimant_address" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_owner_address_at_verification" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_agent_wallet_at_verification" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_last_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "chain_ingestion_checkpoints" ADD COLUMN "indexer_version" varchar(64) DEFAULT 'registry-indexer-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ADD COLUMN "normalized_content_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ADD COLUMN "payload_digest" varchar(64);
