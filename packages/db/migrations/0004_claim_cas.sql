ALTER TABLE "agents" ADD COLUMN "claim_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_claim_events" ADD COLUMN "actor_type" varchar(32);--> statement-breakpoint
ALTER TABLE "agent_claim_events" ADD COLUMN "actor_id" varchar(160);--> statement-breakpoint
UPDATE "agent_claim_events"
SET "actor_type" = COALESCE("actor_type", 'operator'),
    "actor_id" = COALESCE("actor_id", 'migration:legacy')
WHERE "actor_type" IS NULL OR "actor_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_claim_events" ALTER COLUMN "actor_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_claim_events" ALTER COLUMN "actor_id" SET NOT NULL;
