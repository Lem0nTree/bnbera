CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."agent_category" AS ENUM('rebalancing', 'grid-trading', 'yield-optimisation', 'health-factor', 'uncategorized');--> statement-breakpoint
CREATE TYPE "public"."authority_status" AS ENUM('none', 'active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."chain_observation_state" AS ENUM('provisional', 'canonical', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('unclaimed', 'claimed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."commerce_job_status" AS ENUM('draft', 'negotiating', 'funded', 'accepted', 'submitted', 'completed', 'rejected', 'disputed', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deployment_state" AS ENUM('draft', 'awaiting_authority', 'authority_confirming', 'queued', 'validating', 'building', 'provisioning_secrets', 'deploying_runtime', 'configuring_ingress', 'health_checking', 'registering_identity', 'configuring_commerce', 'executing_canary', 'publishing_evidence', 'verifying', 'listed', 'failed', 'paused', 'revoked', 'destroying', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."discovery_source" AS ENUM('8004scan', 'registry_event', 'manual', 'creator');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('draft', 'awaiting_authority', 'authority_confirming', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_actor_type" AS ENUM('user', 'agent', 'system', 'administrator');--> statement-breakpoint
CREATE TYPE "public"."evidence_state" AS ENUM('pending', 'validating', 'creating_object', 'uploading', 'awaiting_seal', 'reading_back', 'verified', 'validation_failed', 'create_failed', 'upload_failed', 'seal_timeout', 'readback_failed', 'hash_mismatch');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'published', 'paused', 'suspended', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."origin_type" AS ENUM('discovered', 'manual_import', 'created');--> statement-breakpoint
CREATE TYPE "public"."runtime_status" AS ENUM('live', 'unavailable', 'paused');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('a2a', 'mcp', 'x402', 'mpp', 'readiness', 'adapter');--> statement-breakpoint
CREATE TYPE "public"."service_validation_status" AS ENUM('pending', 'healthy', 'unhealthy', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."template_release_status" AS ENUM('draft', 'review', 'activated', 'retired');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'degraded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."wallet_provider" AS ENUM('altana', 'external', 'unknown');--> statement-breakpoint
CREATE TABLE "agent_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"draft_id" uuid,
	"chain_id" integer NOT NULL,
	"wallet_provider" "wallet_provider" NOT NULL,
	"execution_wallet" varchar(42),
	"altana_smart_wallet" varchar(42),
	"admin_wallet" varchar(42),
	"session_public_address" varchar(42),
	"calls_allowlist" jsonb NOT NULL,
	"spend_limits" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"keystore_registration_tx" varchar(66),
	"last_verified_block" bigint,
	"status" "authority_status" DEFAULT 'none' NOT NULL,
	"secret_reference" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_authority_owner_check" CHECK (num_nonnulls("agent_id", "draft_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "agent_category_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"predicted_category" "agent_category" NOT NULL,
	"structured_score" numeric(5, 2) NOT NULL,
	"semantic_score" numeric(5, 2) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"evidence" jsonb NOT NULL,
	"method" varchar(64) NOT NULL,
	"classifier_version" varchar(64) NOT NULL,
	"review_state" varchar(64) NOT NULL,
	"reviewer" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"draft_id" uuid,
	"provider" varchar(64) NOT NULL,
	"region" varchar(64) NOT NULL,
	"agent_core_arn" text,
	"ingress_identifier" text,
	"public_url" text,
	"template_digest" varchar(64) NOT NULL,
	"configuration_digest" varchar(64) NOT NULL,
	"state" "deployment_state" DEFAULT 'draft' NOT NULL,
	"current_step" varchar(128),
	"attempt" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"sanitized_error" varchar(500),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_discovery_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"source" "discovery_source" NOT NULL,
	"source_reference" text NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"raw_response_digest" varchar(64),
	"normalized_ingestion_version" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" varchar(2000) NOT NULL,
	"configuration" jsonb NOT NULL,
	"pricing_configuration" jsonb NOT NULL,
	"derived_policy" jsonb NOT NULL,
	"status" "draft_status" DEFAULT 'draft' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"publication_consent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_enrichment_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"provider" varchar(128) NOT NULL,
	"observation_type" varchar(128) NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"source_timestamp" timestamp with time zone,
	"source_block" bigint,
	"freshness" varchar(64) NOT NULL,
	"validation_state" varchar(64) NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"service_id" uuid,
	"endpoint_status" varchar(64) NOT NULL,
	"protocol_checks" jsonb NOT NULL,
	"authority_status" "authority_status" NOT NULL,
	"data_freshness" jsonb NOT NULL,
	"latency_ms" integer,
	"observed_block" bigint,
	"observed_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_listing_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"provider" varchar(128) NOT NULL,
	"model" varchar(128) NOT NULL,
	"model_version" varchar(128) NOT NULL,
	"dimension" integer DEFAULT 1536 NOT NULL,
	"source_text_digest" varchar(64) NOT NULL,
	"semantic_document_schema_version" varchar(64) NOT NULL,
	"classifier_version" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"job_id" uuid,
	"template_id" uuid,
	"template_version" varchar(32),
	"input_snapshot" jsonb NOT NULL,
	"decision_summary" jsonb NOT NULL,
	"selected_action" jsonb,
	"before_state" jsonb,
	"after_state" jsonb,
	"transaction_hash" varchar(66),
	"outcome" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"kind" "service_kind" NOT NULL,
	"url" text NOT NULL,
	"protocol_version" varchar(128) NOT NULL,
	"discovery_source" "discovery_source" NOT NULL,
	"validation_status" "service_validation_status" DEFAULT 'pending' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"latency_ms" integer,
	"safe_capability_probe" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"semantic_version" varchar(32) NOT NULL,
	"category" "agent_category" NOT NULL,
	"display_metadata" jsonb NOT NULL,
	"configuration_schema" jsonb NOT NULL,
	"capability_manifest" jsonb NOT NULL,
	"protocol_manifest" jsonb NOT NULL,
	"contract_selector_allowlist" jsonb NOT NULL,
	"artifact_digest" varchar(64) NOT NULL,
	"source_commit" varchar(64) NOT NULL,
	"release_status" "template_release_status" DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"public_metadata" jsonb NOT NULL,
	"capability_manifest" jsonb NOT NULL,
	"pricing_manifest" jsonb NOT NULL,
	"greenfield_profile_reference" jsonb,
	"template_id" uuid,
	"template_digest" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"creator_user_id" uuid,
	"observed_external_owner" varchar(42),
	"origin_type" "origin_type" NOT NULL,
	"claim_status" "claim_status" DEFAULT 'unclaimed' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"runtime_status" "runtime_status" DEFAULT 'unavailable' NOT NULL,
	"authority_status" "authority_status" DEFAULT 'none' NOT NULL,
	"listing_status" "listing_status" DEFAULT 'draft' NOT NULL,
	"owner_claim_verified_at" timestamp with time zone,
	"category" "agent_category" DEFAULT 'uncategorized' NOT NULL,
	"current_version_id" uuid,
	"execution_wallet" varchar(42),
	"wallet_provider" "wallet_provider" DEFAULT 'unknown' NOT NULL,
	"current_service_set_version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "event_actor_type" NOT NULL,
	"actor_id" varchar(160),
	"action" varchar(160) NOT NULL,
	"resource_type" varchar(160) NOT NULL,
	"resource_id" varchar(160) NOT NULL,
	"input_digest" varchar(64),
	"output_digest" varchar(64),
	"request_id" varchar(160) NOT NULL,
	"block_number" bigint,
	"transaction_hash" varchar(66),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(253) NOT NULL,
	"chain_id" integer NOT NULL,
	"nonce_digest" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_digest" varchar(128) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320),
	"display_name" varchar(160),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "b402_seller_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"merchant_environment" varchar(64) NOT NULL,
	"merchant_account_reference" varchar(160) NOT NULL,
	"merchant_credential_reference" text,
	"facilitator_endpoint" text NOT NULL,
	"settlement_network" integer NOT NULL,
	"settlement_asset" varchar(42) NOT NULL,
	"settlement_decimals" integer NOT NULL,
	"payout_address" varchar(42) NOT NULL,
	"payout_verification_state" varchar(64) NOT NULL,
	"fixed_egress_profile" varchar(160) NOT NULL,
	"public_x402_url" text NOT NULL,
	"agent_core_relay_authentication_reference" text,
	"price_usd" numeric(20, 8) NOT NULL,
	"configuration_version" integer DEFAULT 1 NOT NULL,
	"last_paid_canary_result" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_ingestion_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"last_scanned_block" bigint NOT NULL,
	"last_scanned_block_hash" varchar(66) NOT NULL,
	"last_finalized_block" bigint NOT NULL,
	"last_finalized_block_hash" varchar(66) NOT NULL,
	"confirmation_threshold" integer NOT NULL,
	"cursor_version" integer DEFAULT 1 NOT NULL,
	"last_reconciliation_at" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"erc8183_job_id" text NOT NULL,
	"buyer_user_id" uuid,
	"provider_agent_id" uuid NOT NULL,
	"quote" jsonb NOT NULL,
	"price" numeric(78, 0) NOT NULL,
	"task_input_digest" varchar(64) NOT NULL,
	"status" "commerce_job_status" DEFAULT 'draft' NOT NULL,
	"funding_transaction_hash" varchar(66),
	"fulfillment_transaction_hash" varchar(66),
	"dispute_transaction_hash" varchar(66),
	"settlement_transaction_hash" varchar(66),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"previous_state" "deployment_state",
	"next_state" "deployment_state" NOT NULL,
	"status_message" varchar(500) NOT NULL,
	"external_resource_references" jsonb,
	"transaction_hash" varchar(66),
	"retryable" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erc8004_chain_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"confirmation_state" "chain_observation_state" NOT NULL,
	"normalized_owner" varchar(42),
	"normalized_agent_uri" text,
	"normalized_agent_wallet" varchar(42),
	"first_observed_at" timestamp with time zone NOT NULL,
	"canonicalized_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"payload" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erc8004_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" varchar(128) NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"agent_id" text NOT NULL,
	"owner_address" varchar(42),
	"owner_observed_block" bigint,
	"agent_wallet" varchar(42),
	"agent_wallet_observed_block" bigint,
	"agent_uri" text,
	"content_digest" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"benchmark_id" varchar(160),
	"object_type" varchar(64) NOT NULL,
	"resource_id" varchar(160) NOT NULL,
	"version" integer NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"state" "evidence_state" DEFAULT 'pending' NOT NULL,
	"ipfs_uri" text,
	"greenfield_bucket" varchar(128),
	"greenfield_object" text,
	"creation_transaction_hash" varchar(66),
	"seal_transaction_hash" varchar(66),
	"sha256_digest" varchar(64),
	"keccak256_digest" varchar(64),
	"size_bytes" bigint,
	"mime_type" varchar(128),
	"readback_verified_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_request_digest" varchar(64) NOT NULL,
	"eligible_agents" jsonb NOT NULL,
	"excluded_agents" jsonb NOT NULL,
	"component_scores" jsonb NOT NULL,
	"exclusion_reasons" jsonb NOT NULL,
	"selected_agent_id" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_ownership_verified_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_authorities" ADD CONSTRAINT "agent_authorities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorities" ADD CONSTRAINT "agent_authorities_draft_id_agent_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_category_predictions" ADD CONSTRAINT "agent_category_predictions_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD CONSTRAINT "agent_deployments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD CONSTRAINT "agent_deployments_draft_id_agent_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."agent_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_discovery_sources" ADD CONSTRAINT "agent_discovery_sources_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrichment_observations" ADD CONSTRAINT "agent_enrichment_observations_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_health_snapshots" ADD CONSTRAINT "agent_health_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_health_snapshots" ADD CONSTRAINT "agent_health_snapshots_service_id_agent_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."agent_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_listing_embeddings" ADD CONSTRAINT "agent_listing_embeddings_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_job_id_commerce_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_template_id_agent_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agent_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ADD CONSTRAINT "b402_seller_configurations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_jobs" ADD CONSTRAINT "commerce_jobs_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_jobs" ADD CONSTRAINT "commerce_jobs_provider_agent_id_agents_id_fk" FOREIGN KEY ("provider_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_events" ADD CONSTRAINT "deployment_events_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ADD CONSTRAINT "erc8004_chain_observations_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD CONSTRAINT "evidence_objects_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_selected_agent_id_agents_id_fk" FOREIGN KEY ("selected_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_authority_agent_status_idx" ON "agent_authorities" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_authority_expiry_idx" ON "agent_authorities" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_category_prediction_version_idx" ON "agent_category_predictions" USING btree ("agent_version_id","createdAt");--> statement-breakpoint
CREATE INDEX "agent_category_prediction_category_idx" ON "agent_category_predictions" USING btree ("predicted_category","review_state");--> statement-breakpoint
CREATE INDEX "agent_deployment_state_idx" ON "agent_deployments" USING btree ("state","createdAt");--> statement-breakpoint
CREATE INDEX "agent_deployment_agent_idx" ON "agent_deployments" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_discovery_source_unique" ON "agent_discovery_sources" USING btree ("identity_id","source","source_reference");--> statement-breakpoint
CREATE INDEX "agent_discovery_source_source_idx" ON "agent_discovery_sources" USING btree ("source","last_observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_draft_creator_idempotency_unique" ON "agent_drafts" USING btree ("creator_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_draft_creator_status_idx" ON "agent_drafts" USING btree ("creator_user_id","status");--> statement-breakpoint
CREATE INDEX "agent_enrichment_version_provider_idx" ON "agent_enrichment_observations" USING btree ("agent_version_id","provider");--> statement-breakpoint
CREATE INDEX "agent_health_agent_time_idx" ON "agent_health_snapshots" USING btree ("agent_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_listing_embedding_version_unique" ON "agent_listing_embeddings" USING btree ("agent_version_id","model_version");--> statement-breakpoint
CREATE INDEX "agent_listing_embedding_model_idx" ON "agent_listing_embeddings" USING btree ("provider","model","dimension");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_time_idx" ON "agent_runs" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_service_url_unique" ON "agent_services" USING btree ("agent_version_id","kind","url");--> statement-breakpoint
CREATE INDEX "agent_service_validation_idx" ON "agent_services" USING btree ("validation_status","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_template_slug_version_unique" ON "agent_templates" USING btree ("slug","semantic_version");--> statement-breakpoint
CREATE INDEX "agent_template_category_status_idx" ON "agent_templates" USING btree ("category","release_status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_number_unique" ON "agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "agent_version_template_idx" ON "agent_versions" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_identity_unique" ON "agents" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "agents_listing_search_idx" ON "agents" USING btree ("listing_status","verification_status","category");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("creator_user_id","claim_status");--> statement-breakpoint
CREATE INDEX "audit_resource_time_idx" ON "audit_events" USING btree ("resource_type","resource_id","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_nonces_nonce_digest_unique" ON "auth_nonces" USING btree ("nonce_digest");--> statement-breakpoint
CREATE INDEX "auth_nonces_context_idx" ON "auth_nonces" USING btree ("domain","chain_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_digest_unique" ON "auth_sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "b402_seller_agent_unique" ON "b402_seller_configurations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "b402_seller_enabled_idx" ON "b402_seller_configurations" USING btree ("enabled","settlement_network");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_ingestion_checkpoint_unique" ON "chain_ingestion_checkpoints" USING btree ("chain_id","identity_registry");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_erc8183_job_unique" ON "commerce_jobs" USING btree ("erc8183_job_id");--> statement-breakpoint
CREATE INDEX "commerce_provider_status_idx" ON "commerce_jobs" USING btree ("provider_agent_id","status");--> statement-breakpoint
CREATE INDEX "deployment_events_deployment_idx" ON "deployment_events" USING btree ("deployment_id","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8004_observation_log_unique" ON "erc8004_chain_observations" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "erc8004_observation_block_idx" ON "erc8004_chain_observations" USING btree ("identity_id","block_number");--> statement-breakpoint
CREATE INDEX "erc8004_observation_state_idx" ON "erc8004_chain_observations" USING btree ("confirmation_state","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8004_identity_key_unique" ON "erc8004_identities" USING btree ("namespace","chain_id","identity_registry","agent_id");--> statement-breakpoint
CREATE INDEX "erc8004_identity_owner_idx" ON "erc8004_identities" USING btree ("chain_id","owner_address");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_idempotency_unique" ON "evidence_objects" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_resource_version_unique" ON "evidence_objects" USING btree ("object_type","resource_id","version");--> statement-breakpoint
CREATE INDEX "evidence_state_idx" ON "evidence_objects" USING btree ("state","createdAt");--> statement-breakpoint
CREATE INDEX "match_request_time_idx" ON "match_events" USING btree ("buyer_request_digest","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_chain_address_unique" ON "wallet_addresses" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "wallet_addresses_user_idx" ON "wallet_addresses" USING btree ("user_id");
