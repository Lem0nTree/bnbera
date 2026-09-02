CREATE TYPE "public"."erc8183_job_event_type" AS ENUM('job_created', 'provider_set', 'budget_set', 'job_funded', 'job_submitted', 'job_completed', 'job_rejected', 'job_expired', 'reconciliation_requested', 'reconciliation_succeeded', 'reconciliation_failed');--> statement-breakpoint
CREATE TYPE "public"."erc8183_job_state" AS ENUM('open', 'funded', 'submitted', 'completed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('challenged', 'authorized', 'relay_pending', 'relayed', 'settlement_pending', 'settled', 'delivered', 'rejected', 'expired', 'unknown', 'partial_failure', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."payment_challenge_status" AS ENUM('issued', 'authorized', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_event_type" AS ENUM('challenge_issued', 'payment_authorized', 'relay_started', 'relay_completed', 'settlement_observed', 'response_delivered', 'payment_rejected', 'payment_expired', 'payment_unknown', 'payment_partial_failure', 'reconciliation_requested', 'reconciliation_succeeded', 'reconciliation_failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('eip3009', 'permit2_exact');--> statement-breakpoint
CREATE TYPE "public"."payment_rail" AS ENUM('x402_b402');--> statement-breakpoint
CREATE TYPE "public"."payment_receipt_status" AS ENUM('settled', 'rejected', 'unknown', 'partial_failure');--> statement-breakpoint
CREATE TYPE "public"."payment_reconciliation_state" AS ENUM('pending', 'in_progress', 'reconciled', 'failed', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."payment_replay_state" AS ENUM('inflight', 'consumed', 'rejected');--> statement-breakpoint
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
	CONSTRAINT "erc8183_job_id_decimal_check" CHECK ("erc8183_jobs"."erc8183_job_id" ~ '^(0|[1-9][0-9]*)$')
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
	"status" "payment_attempt_status" DEFAULT 'challenged' NOT NULL,
	"relay_request_digest" varchar(64),
	"receipt_id" uuid,
	"failure_code" varchar(240),
	"sanitized_failure" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempt_network_check" CHECK ("payment_attempts"."settlement_network" in (56, 97)),
	CONSTRAINT "payment_attempt_decimals_check" CHECK ("payment_attempts"."settlement_decimals" between 0 and 255),
	CONSTRAINT "payment_attempt_amount_check" CHECK ("payment_attempts"."amount_atomic" > 0)
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
ALTER TABLE "erc8183_job_events" ADD CONSTRAINT "erc8183_job_events_erc8183_job_id_erc8183_jobs_id_fk" FOREIGN KEY ("erc8183_job_id") REFERENCES "public"."erc8183_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_jobs_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempt_events" ADD CONSTRAINT "payment_attempt_events_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_challenge_id_payment_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."payment_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_challenge_id_payment_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."payment_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_replay_reservations" ADD CONSTRAINT "payment_replay_reservations_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_event_key_unique" ON "erc8183_job_events" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_event_chain_log_unique" ON "erc8183_job_events" USING btree ("transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "erc8183_job_event_job_time_idx" ON "erc8183_job_events" USING btree ("erc8183_job_id","observed_at");--> statement-breakpoint
CREATE INDEX "erc8183_job_event_state_idx" ON "erc8183_job_events" USING btree ("confirmation_state","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_commerce_job_unique" ON "erc8183_jobs" USING btree ("commerce_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_job_network_identity_unique" ON "erc8183_jobs" USING btree ("chain_id","commerce_contract","erc8183_job_id");--> statement-breakpoint
CREATE INDEX "erc8183_job_state_idx" ON "erc8183_jobs" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "erc8183_job_provider_idx" ON "erc8183_jobs" USING btree ("provider_address","state");--> statement-breakpoint
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
CREATE INDEX "payment_replay_state_expiry_idx" ON "payment_replay_reservations" USING btree ("state","expires_at");
