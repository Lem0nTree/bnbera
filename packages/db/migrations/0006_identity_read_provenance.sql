ALTER TABLE "agents" ADD COLUMN "claim_verification_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verification_observed_block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verification_read_consistency" varchar(16);--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "agent_uri_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "content_digest_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "observed_block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "read_consistency" varchar(16);
