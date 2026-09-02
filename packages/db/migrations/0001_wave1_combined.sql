CREATE TYPE "public"."erc8183_job_event_type" AS ENUM('job_created', 'provider_set', 'budget_set', 'job_funded', 'job_submitted', 'job_completed', 'job_rejected', 'job_expired', 'reconciliation_requested', 'reconciliation_succeeded', 'reconciliation_failed');--> statement-breakpoint
CREATE TYPE "public"."erc8183_job_state" AS ENUM('open', 'funded', 'submitted', 'completed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."evidence_readback_status" AS ENUM('not_attempted', 'matched', 'missing', 'corrupt', 'timeout', 'provider_failed');--> statement-breakpoint
CREATE TYPE "public"."evidence_verification_status" AS ENUM('not_verified', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('challenged', 'authorized', 'relay_pending', 'relayed', 'settlement_pending', 'settled', 'delivered', 'rejected', 'expired', 'unknown', 'partial_failure', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."payment_challenge_status" AS ENUM('issued', 'authorized', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_event_type" AS ENUM('challenge_issued', 'payment_authorized', 'relay_started', 'relay_completed', 'settlement_observed', 'response_delivered', 'payment_rejected', 'payment_expired', 'payment_unknown', 'payment_partial_failure', 'reconciliation_requested', 'reconciliation_succeeded', 'reconciliation_failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('eip3009', 'permit2_exact');--> statement-breakpoint
CREATE TYPE "public"."payment_rail" AS ENUM('x402_b402');--> statement-breakpoint
CREATE TYPE "public"."payment_receipt_status" AS ENUM('settled', 'rejected', 'unknown', 'partial_failure');--> statement-breakpoint
CREATE TYPE "public"."payment_reconciliation_state" AS ENUM('pending', 'in_progress', 'reconciled', 'failed', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."payment_replay_state" AS ENUM('inflight', 'consumed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."publication_attempt_state" AS ENUM('pending', 'validating', 'creating_object', 'submitted', 'uploading', 'awaiting_seal', 'reading_back', 'verified', 'validation_failed', 'create_failed', 'upload_failed', 'seal_timeout', 'readback_failed', 'hash_mismatch', 'duplicate', 'provider_failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."publication_provider" AS ENUM('ipfs', 'greenfield');--> statement-breakpoint
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
	"actor_type" varchar(32) NOT NULL,
	"actor_id" varchar(160) NOT NULL,
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
CREATE TABLE "agent_service_probe_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"kind" "service_kind" NOT NULL,
	"url" text NOT NULL,
	"validation_status" "service_validation_status" NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"safe_capability_probe" jsonb,
	"error_code" varchar(64),
	"observed_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erc8183_job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"erc8183_job_id" uuid NOT NULL,
	"event_key" varchar(240) NOT NULL,
	"event_type" "erc8183_job_event_type" NOT NULL,
	"previous_state" "erc8183_job_state",
	"next_state" "erc8183_job_state",
	"actor_address" varchar(42),
	"transaction_hash" varchar(66),
	"block_number" bigint,
	"block_hash" varchar(66),
	"log_index" integer,
	"confirmation_state" "chain_observation_state" DEFAULT 'canonical' NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" varchar(160) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erc8183_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commerce_job_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"erc8183_job_id" text NOT NULL,
	"spec_revision" varchar(160) NOT NULL,
	"abi_hash" varchar(64) NOT NULL,
	"evaluator_profile" varchar(160) NOT NULL,
	"confirmation_threshold" integer NOT NULL,
	"min_expiry_lead_seconds" integer NOT NULL,
	"max_expiry_horizon_seconds" integer NOT NULL,
	"min_budget_atomic" numeric(78, 0) NOT NULL,
	"max_budget_atomic" numeric(78, 0) NOT NULL,
	"deployment_pin_digest" varchar(64) NOT NULL,
	"payment_token" varchar(42) NOT NULL,
	"payment_decimals" integer NOT NULL,
	"client_address" varchar(42) NOT NULL,
	"provider_address" varchar(42),
	"evaluator_address" varchar(42) NOT NULL,
	"hook_address" varchar(42),
	"budget_atomic" numeric(78, 0) NOT NULL,
	"description_digest" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" "erc8183_job_state" DEFAULT 'open' NOT NULL,
	"deliverable_digest" varchar(64),
	"funding_transaction_hash" varchar(66),
	"submission_transaction_hash" varchar(66),
	"completion_transaction_hash" varchar(66),
	"rejection_transaction_hash" varchar(66),
	"refund_transaction_hash" varchar(66),
	"last_observed_block" bigint,
	"last_observed_block_hash" varchar(66),
	"last_observed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erc8183_job_chain_check" CHECK ("erc8183_jobs"."chain_id" in (56, 97)),
	CONSTRAINT "erc8183_job_decimals_check" CHECK ("erc8183_jobs"."payment_decimals" between 0 and 255),
	CONSTRAINT "erc8183_job_budget_check" CHECK ("erc8183_jobs"."budget_atomic" >= 0),
	CONSTRAINT "erc8183_job_contract_check" CHECK ("erc8183_jobs"."commerce_contract" ~ '^0x[0-9A-Fa-f]{40}$' AND "erc8183_jobs"."payment_token" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "erc8183_job_spec_check" CHECK (char_length("erc8183_jobs"."spec_revision") > 0 AND char_length("erc8183_jobs"."evaluator_profile") > 0),
	CONSTRAINT "erc8183_job_abi_hash_check" CHECK ("erc8183_jobs"."abi_hash" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "erc8183_job_pin_digest_check" CHECK ("erc8183_jobs"."deployment_pin_digest" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "erc8183_job_confirmation_check" CHECK ("erc8183_jobs"."confirmation_threshold" > 0),
	CONSTRAINT "erc8183_job_expiry_bounds_check" CHECK ("erc8183_jobs"."min_expiry_lead_seconds" > 0 AND "erc8183_jobs"."max_expiry_horizon_seconds" >= "erc8183_jobs"."min_expiry_lead_seconds"),
	CONSTRAINT "erc8183_job_pin_budget_bounds_check" CHECK ("erc8183_jobs"."min_budget_atomic" >= 0 AND "erc8183_jobs"."max_budget_atomic" >= "erc8183_jobs"."min_budget_atomic" AND "erc8183_jobs"."budget_atomic" between "erc8183_jobs"."min_budget_atomic" and "erc8183_jobs"."max_budget_atomic"),
	CONSTRAINT "erc8183_job_id_decimal_check" CHECK ("erc8183_jobs"."erc8183_job_id" ~ '^(0|[1-9][0-9]*)$')
);
--> statement-breakpoint
CREATE TABLE "evidence_locators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"publication_attempt_id" uuid,
	"provider" "publication_provider" NOT NULL,
	"provider_label" varchar(128) NOT NULL,
	"network" varchar(128) NOT NULL,
	"uri" text NOT NULL,
	"bucket" varchar(128),
	"object_name" text,
	"provider_reference" text,
	"version" integer NOT NULL,
	"sha256_digest" varchar(64) NOT NULL,
	"keccak256_digest" varchar(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"immutable" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_publication_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"provider" "publication_provider" NOT NULL,
	"provider_label" varchar(128) NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"configuration_digest" varchar(64) NOT NULL,
	"configured_network" varchar(128) NOT NULL,
	"configured_bucket" varchar(128),
	"revision" integer DEFAULT 0 NOT NULL,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"object_name" text NOT NULL,
	"state" "publication_attempt_state" DEFAULT 'pending' NOT NULL,
	"provider_reference" text,
	"creation_transaction_hash" varchar(66),
	"seal_transaction_hash" varchar(66),
	"submitted_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"sanitized_error" varchar(500),
	"retryable" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_verification_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"publication_attempt_id" uuid,
	"status" "evidence_verification_status" DEFAULT 'not_verified' NOT NULL,
	"seal_confirmed" boolean,
	"readback_status" "evidence_readback_status" DEFAULT 'not_attempted' NOT NULL,
	"expected_sha256_digest" varchar(64) NOT NULL,
	"observed_sha256_digest" varchar(64),
	"expected_keccak256_digest" varchar(64) NOT NULL,
	"observed_keccak256_digest" varchar(64),
	"expected_size_bytes" bigint NOT NULL,
	"observed_size_bytes" bigint,
	"hashes_match" boolean DEFAULT false NOT NULL,
	"size_matches" boolean DEFAULT false NOT NULL,
	"reason_code" varchar(64),
	"checked_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempt_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"event_key" varchar(240) NOT NULL,
	"event_type" "payment_event_type" NOT NULL,
	"previous_status" "payment_attempt_status",
	"next_status" "payment_attempt_status",
	"payment_transaction_hash" varchar(66),
	"settlement_transaction_hash" varchar(66),
	"payload_digest" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" varchar(240) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commerce_job_id" uuid,
	"agent_id" uuid,
	"challenge_id" uuid NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"request_id" varchar(240) NOT NULL,
	"idempotency_key" varchar(240) NOT NULL,
	"challenge_digest" varchar(64) NOT NULL,
	"authorization_digest" varchar(64),
	"payer_address" varchar(42),
	"settlement_network" integer NOT NULL,
	"settlement_asset" varchar(42) NOT NULL,
	"settlement_decimals" integer NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"expected_recipient" varchar(42) NOT NULL,
	"method" "payment_method" NOT NULL,
	"destination" text NOT NULL,
	"facilitator_endpoint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_challenge_lifetime_seconds" integer NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'challenged' NOT NULL,
	"relay_request_digest" varchar(64),
	"pin_digest" varchar(64) NOT NULL,
	"configuration_version" integer NOT NULL,
	"configuration_digest" varchar(64) NOT NULL,
	"fixed_egress_profile" varchar(160) NOT NULL,
	"payout_address" varchar(42) NOT NULL,
	"payout_verification_state" varchar(64) NOT NULL,
	"failure_code" varchar(240),
	"sanitized_failure" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempt_network_check" CHECK ("payment_attempts"."settlement_network" in (56, 97)),
	CONSTRAINT "payment_attempt_decimals_check" CHECK ("payment_attempts"."settlement_decimals" between 0 and 255),
	CONSTRAINT "payment_attempt_amount_check" CHECK ("payment_attempts"."amount_atomic" > 0),
	CONSTRAINT "payment_attempt_pin_digest_check" CHECK ("payment_attempts"."pin_digest" ~ '^[0-9A-Fa-f]{64}$' AND "payment_attempts"."configuration_digest" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "payment_attempt_configuration_version_check" CHECK ("payment_attempts"."configuration_version" > 0),
	CONSTRAINT "payment_attempt_challenge_lifetime_check" CHECK ("payment_attempts"."max_challenge_lifetime_seconds" > 0),
	CONSTRAINT "payment_attempt_payout_verification_check" CHECK ("payment_attempts"."payout_verification_state" = 'verified'),
	CONSTRAINT "payment_attempt_address_check" CHECK ("payment_attempts"."settlement_asset" ~ '^0x[0-9A-Fa-f]{40}$' AND "payment_attempts"."expected_recipient" ~ '^0x[0-9A-Fa-f]{40}$' AND "payment_attempts"."payout_address" ~ '^0x[0-9A-Fa-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "payment_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" varchar(240) NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"version" varchar(240) NOT NULL,
	"challenge_digest" varchar(64) NOT NULL,
	"settlement_network" integer NOT NULL,
	"settlement_asset" varchar(42) NOT NULL,
	"settlement_decimals" integer NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"recipient" varchar(42) NOT NULL,
	"method" "payment_method" NOT NULL,
	"destination" text NOT NULL,
	"facilitator_endpoint" text NOT NULL,
	"nonce_digest" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "payment_challenge_status" DEFAULT 'issued' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_challenge_network_check" CHECK ("payment_challenges"."settlement_network" in (56, 97)),
	CONSTRAINT "payment_challenge_decimals_check" CHECK ("payment_challenges"."settlement_decimals" between 0 and 255),
	CONSTRAINT "payment_challenge_amount_check" CHECK ("payment_challenges"."amount_atomic" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"status" "payment_receipt_status" NOT NULL,
	"settlement_network" integer NOT NULL,
	"settlement_asset" varchar(42) NOT NULL,
	"settlement_decimals" integer NOT NULL,
	"amount_atomic" numeric(78, 0) NOT NULL,
	"expected_recipient" varchar(42) NOT NULL,
	"actual_recipient" varchar(42),
	"method" "payment_method" NOT NULL,
	"destination" text NOT NULL,
	"payment_transaction_hash" varchar(66),
	"settlement_transaction_hash" varchar(66),
	"payout_address" varchar(42),
	"payout_verified" boolean DEFAULT false NOT NULL,
	"facilitator_request_reference" varchar(240),
	"response_status" integer,
	"response_digest" varchar(64),
	"receipt_digest" varchar(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_receipt_network_check" CHECK ("payment_receipts"."settlement_network" in (56, 97)),
	CONSTRAINT "payment_receipt_decimals_check" CHECK ("payment_receipts"."settlement_decimals" between 0 and 255),
	CONSTRAINT "payment_receipt_amount_check" CHECK ("payment_receipts"."amount_atomic" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"reason_code" varchar(240) NOT NULL,
	"state" "payment_reconciliation_state" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"observed_payment_transaction_hash" varchar(66),
	"observed_settlement_transaction_hash" varchar(66),
	"detail_digest" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_replay_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replay_key" varchar(64) NOT NULL,
	"attempt_id" uuid NOT NULL,
	"state" "payment_replay_state" DEFAULT 'inflight' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"response_digest" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "commerce_erc8183_job_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claimant_address" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_owner_address_at_verification" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_agent_wallet_at_verification" varchar(42);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_last_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verification_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verification_observed_block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "claim_verification_read_consistency" varchar(16);--> statement-breakpoint
-- Existing seller rows predate immutable configuration digests. A zero digest
-- marks their configuration as legacy, and disabling those rows prevents an
-- unverified configuration from enabling paid traffic after this migration.
ALTER TABLE "b402_seller_configurations" ADD COLUMN "configuration_digest" varchar(64);--> statement-breakpoint
UPDATE "b402_seller_configurations"
SET "configuration_digest" = repeat('0', 64), "enabled" = false
WHERE "configuration_digest" IS NULL;--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ALTER COLUMN "configuration_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chain_ingestion_checkpoints" ADD COLUMN "indexer_version" varchar(64) DEFAULT 'registry-indexer-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ADD COLUMN "normalized_content_digest" varchar(64);--> statement-breakpoint
-- Legacy observations did not persist field-level provenance. Keep them
-- readable while making the missing provenance explicit to new consumers.
ALTER TABLE "erc8004_chain_observations" ADD COLUMN "observed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ALTER COLUMN "observed_fields" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "erc8004_chain_observations" ADD COLUMN "payload_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "agent_uri_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "content_digest_observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "observed_block" bigint;--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "observed_block_hash" varchar(66);--> statement-breakpoint
ALTER TABLE "erc8004_identities" ADD COLUMN "read_consistency" varchar(16);--> statement-breakpoint
-- Use a stable per-row legacy identifier for existing evidence records. New
-- writes must provide a caller-owned artifact id through the application API.
ALTER TABLE "evidence_objects" ADD COLUMN "artifact_id" varchar(160);--> statement-breakpoint
UPDATE "evidence_objects"
SET "artifact_id" = 'legacy:' || "id"::text
WHERE "artifact_id" IS NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ALTER COLUMN "artifact_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN "artifact_schema_version" varchar(64) DEFAULT 'bnbera.evidence/v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_capability_observations" ADD CONSTRAINT "agent_capability_observations_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claim_events" ADD CONSTRAINT "agent_claim_events_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_service_observations" ADD CONSTRAINT "agent_service_observations_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_service_probe_results" ADD CONSTRAINT "agent_service_probe_results_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc8183_job_events" ADD CONSTRAINT "erc8183_job_events_erc8183_job_id_erc8183_jobs_id_fk" FOREIGN KEY ("erc8183_job_id") REFERENCES "public"."erc8183_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_jobs_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_locators" ADD CONSTRAINT "evidence_locators_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_locators" ADD CONSTRAINT "evidence_locators_publication_attempt_id_evidence_publication_attempts_id_fk" FOREIGN KEY ("publication_attempt_id") REFERENCES "public"."evidence_publication_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD CONSTRAINT "evidence_publication_attempts_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verification_results" ADD CONSTRAINT "evidence_verification_results_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verification_results" ADD CONSTRAINT "evidence_verification_results_publication_attempt_id_evidence_publication_attempts_id_fk" FOREIGN KEY ("publication_attempt_id") REFERENCES "public"."evidence_publication_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempt_events" ADD CONSTRAINT "payment_attempt_events_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_challenge_id_payment_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."payment_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_challenge_id_payment_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."payment_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_replay_reservations" ADD CONSTRAINT "payment_replay_reservations_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_capability_observation_unique" ON "agent_capability_observations" USING btree ("identity_id","schema_version","manifest_digest");--> statement-breakpoint
CREATE INDEX "agent_capability_observation_source_idx" ON "agent_capability_observations" USING btree ("source","observed_at");--> statement-breakpoint
CREATE INDEX "agent_claim_event_identity_time_idx" ON "agent_claim_events" USING btree ("identity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_claim_event_type_idx" ON "agent_claim_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_reorg_reconciliation_network_idx" ON "agent_reorg_reconciliations" USING btree ("chain_id","identity_registry","started_at");--> statement-breakpoint
CREATE INDEX "agent_reorg_reconciliation_status_idx" ON "agent_reorg_reconciliations" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_service_observation_unique" ON "agent_service_observations" USING btree ("identity_id","kind","url");--> statement-breakpoint
CREATE INDEX "agent_service_observation_validation_idx" ON "agent_service_observations" USING btree ("validation_status","observed_at");--> statement-breakpoint
CREATE INDEX "agent_service_probe_identity_time_idx" ON "agent_service_probe_results" USING btree ("identity_id","kind","url","observed_at");--> statement-breakpoint
CREATE INDEX "agent_service_probe_status_idx" ON "agent_service_probe_results" USING btree ("validation_status","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_event_key_unique" ON "erc8183_job_events" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_event_chain_log_unique" ON "erc8183_job_events" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "erc8183_job_event_job_time_idx" ON "erc8183_job_events" USING btree ("erc8183_job_id","observed_at");--> statement-breakpoint
CREATE INDEX "erc8183_job_event_state_idx" ON "erc8183_job_events" USING btree ("confirmation_state","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_commerce_job_unique" ON "erc8183_jobs" USING btree ("commerce_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_network_identity_unique" ON "erc8183_jobs" USING btree ("chain_id","commerce_contract","erc8183_job_id");--> statement-breakpoint
CREATE INDEX "erc8183_job_state_idx" ON "erc8183_jobs" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "erc8183_job_provider_idx" ON "erc8183_jobs" USING btree ("provider_address","state");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_locator_uri_unique" ON "evidence_locators" USING btree ("provider","uri");--> statement-breakpoint
CREATE INDEX "evidence_locator_object_provider_idx" ON "evidence_locators" USING btree ("evidence_object_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_publication_idempotency_unique" ON "evidence_publication_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "evidence_publication_object_provider_idx" ON "evidence_publication_attempts" USING btree ("evidence_object_id","provider");--> statement-breakpoint
CREATE INDEX "evidence_publication_state_idx" ON "evidence_publication_attempts" USING btree ("state","updatedAt");--> statement-breakpoint
CREATE INDEX "evidence_verification_object_time_idx" ON "evidence_verification_results" USING btree ("evidence_object_id","checked_at");--> statement-breakpoint
CREATE INDEX "evidence_verification_status_idx" ON "evidence_verification_results" USING btree ("status","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_event_key_unique" ON "payment_attempt_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "payment_attempt_event_attempt_time_idx" ON "payment_attempt_events" USING btree ("attempt_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_rail_idempotency_unique" ON "payment_attempts" USING btree ("rail","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempt_challenge_unique" ON "payment_attempts" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "payment_attempt_status_idx" ON "payment_attempts" USING btree ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "payment_attempt_request_idx" ON "payment_attempts" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_challenge_id_unique" ON "payment_challenges" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_challenge_digest_unique" ON "payment_challenges" USING btree ("challenge_digest");--> statement-breakpoint
CREATE INDEX "payment_challenge_expiry_idx" ON "payment_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipt_attempt_unique" ON "payment_receipts" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_receipt_digest_unique" ON "payment_receipts" USING btree ("receipt_digest");--> statement-breakpoint
CREATE INDEX "payment_receipt_status_time_idx" ON "payment_receipts" USING btree ("status","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reconciliation_reason_unique" ON "payment_reconciliations" USING btree ("attempt_id","reason_code");--> statement-breakpoint
CREATE INDEX "payment_reconciliation_due_idx" ON "payment_reconciliations" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_replay_key_unique" ON "payment_replay_reservations" USING btree ("replay_key");--> statement-breakpoint
CREATE INDEX "payment_replay_state_expiry_idx" ON "payment_replay_reservations" USING btree ("state","expires_at");--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ADD CONSTRAINT "b402_seller_network_check" CHECK ("b402_seller_configurations"."settlement_network" in (56, 97));--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ADD CONSTRAINT "b402_seller_decimals_check" CHECK ("b402_seller_configurations"."settlement_decimals" between 0 and 255);--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ADD CONSTRAINT "b402_seller_configuration_version_check" CHECK ("b402_seller_configurations"."configuration_version" > 0);--> statement-breakpoint
ALTER TABLE "b402_seller_configurations" ADD CONSTRAINT "b402_seller_configuration_digest_check" CHECK ("b402_seller_configurations"."configuration_digest" ~ '^[0-9A-Fa-f]{64}$');
