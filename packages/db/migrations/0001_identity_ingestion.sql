CREATE TABLE "agent_capability_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"source" "discovery_source" NOT NULL,
	"schema_version" varchar(64) NOT NULL,
	"capability_manifest" jsonb NOT NULL,
	"manifest_digest" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"claimant_address" varchar(42),
	"observed_owner_address" varchar(42),
	"observed_agent_wallet" varchar(42),
	"proof_digest" varchar(64),
	"reason" varchar(500) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_reorg_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"previous_scanned_block" bigint NOT NULL,
	"common_ancestor_block" bigint NOT NULL,
	"affected_identity_keys" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_service_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"kind" "service_kind" NOT NULL,
	"url" text NOT NULL,
	"protocol_version" varchar(128) NOT NULL,
	"discovery_source" "discovery_source" NOT NULL,
	"validation_status" "service_validation_status" DEFAULT 'pending' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"latency_ms" integer,
	"safe_capability_probe" jsonb,
	"capability_manifest_digest" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claim_events" ADD CONSTRAINT "agent_claim_events_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_service_observations" ADD CONSTRAINT "agent_service_observations_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_capability_observation_unique" ON "agent_capability_observations" USING btree ("identity_id","schema_version","manifest_digest");--> statement-breakpoint
CREATE INDEX "agent_capability_observation_source_idx" ON "agent_capability_observations" USING btree ("source","observed_at");--> statement-breakpoint
CREATE INDEX "agent_claim_event_identity_time_idx" ON "agent_claim_events" USING btree ("identity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_claim_event_type_idx" ON "agent_claim_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_reorg_reconciliation_network_idx" ON "agent_reorg_reconciliations" USING btree ("chain_id","identity_registry","started_at");--> statement-breakpoint
CREATE INDEX "agent_reorg_reconciliation_status_idx" ON "agent_reorg_reconciliations" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_service_observation_unique" ON "agent_service_observations" USING btree ("identity_id","kind","url");--> statement-breakpoint
CREATE INDEX "agent_service_observation_validation_idx" ON "agent_service_observations" USING btree ("validation_status","observed_at");
