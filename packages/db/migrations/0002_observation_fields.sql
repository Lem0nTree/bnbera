ALTER TABLE "erc8004_chain_observations" ADD COLUMN "observed_fields" jsonb NOT NULL DEFAULT '["ownerAddress", "agentWallet", "agentUri", "contentDigest"]'::jsonb;
--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ALTER COLUMN "observed_fields" DROP DEFAULT;
