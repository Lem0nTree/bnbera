CREATE TABLE "erc8004_reputation_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"reputation_registry" varchar(42) NOT NULL,
	"indexer_version" varchar(64) DEFAULT 'reputation-indexer-v1' NOT NULL,
	"last_scanned_block" bigint NOT NULL,
	"last_scanned_block_hash" varchar(66) NOT NULL,
	"last_finalized_block" bigint NOT NULL,
	"last_finalized_block_hash" varchar(66) NOT NULL,
	"confirmation_threshold" integer NOT NULL,
	"cursor_version" integer DEFAULT 1 NOT NULL,
	"last_reconciliation_at" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erc8004_reputation_checkpoint_registry_check" CHECK ("erc8004_reputation_checkpoints"."identity_registry" ~ '^0x[0-9A-Fa-f]{40}$' AND "erc8004_reputation_checkpoints"."reputation_registry" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "erc8004_reputation_checkpoint_block_check" CHECK ("erc8004_reputation_checkpoints"."last_finalized_block" <= "erc8004_reputation_checkpoints"."last_scanned_block" AND "erc8004_reputation_checkpoints"."confirmation_threshold" >= 0 AND "erc8004_reputation_checkpoints"."cursor_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "erc8004_reputation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"namespace" varchar(128) NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"reputation_registry" varchar(42) NOT NULL,
	"agent_id" text NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"client_address" varchar(42) NOT NULL,
	"feedback_index" text NOT NULL,
	"value" text,
	"value_decimals" integer,
	"indexed_tag1" text,
	"tag1" text,
	"tag2" text,
	"endpoint" text,
	"feedback_uri" text,
	"feedback_hash" varchar(66),
	"transaction_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"confirmation_state" "chain_observation_state" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"canonicalized_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"payload_digest" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erc8004_reputation_event_type_check" CHECK ("erc8004_reputation_events"."event_type" in ('NewFeedback', 'FeedbackRevoked')),
	CONSTRAINT "erc8004_reputation_event_identity_registry_check" CHECK ("erc8004_reputation_events"."identity_registry" ~ '^0x[0-9A-Fa-f]{40}$' AND "erc8004_reputation_events"."reputation_registry" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "erc8004_reputation_event_agent_id_check" CHECK ("erc8004_reputation_events"."agent_id" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "erc8004_reputation_event_feedback_index_check" CHECK ("erc8004_reputation_events"."feedback_index" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "erc8004_reputation_event_value_check" CHECK ("erc8004_reputation_events"."value" IS NULL OR "erc8004_reputation_events"."value" ~ '^-?(0|[1-9][0-9]*)$'),
	CONSTRAINT "erc8004_reputation_event_value_decimals_check" CHECK ("erc8004_reputation_events"."value_decimals" IS NULL OR "erc8004_reputation_events"."value_decimals" between 0 and 255),
	CONSTRAINT "erc8004_reputation_event_payload_digest_check" CHECK ("erc8004_reputation_events"."payload_digest" ~ '^[0-9A-Fa-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "erc8004_reputation_events" ADD CONSTRAINT "erc8004_reputation_events_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erc8004_reputation_checkpoint_unique" ON "erc8004_reputation_checkpoints" USING btree ("chain_id","identity_registry","reputation_registry");--> statement-breakpoint
CREATE INDEX "erc8004_reputation_checkpoint_updated_idx" ON "erc8004_reputation_checkpoints" USING btree ("updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8004_reputation_event_log_unique" ON "erc8004_reputation_events" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "erc8004_reputation_event_identity_state_idx" ON "erc8004_reputation_events" USING btree ("identity_id","confirmation_state","block_number");--> statement-breakpoint
CREATE INDEX "erc8004_reputation_event_feedback_key_idx" ON "erc8004_reputation_events" USING btree ("identity_id","client_address","feedback_index");
