CREATE TABLE "erc8183_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"chain_id" integer NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"erc8183_job_id" text,
	"operation_kind" varchar(32) NOT NULL,
	"signer_role" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'awaiting_signature' NOT NULL,
	"transaction_hash" varchar(66),
	"block_number" bigint,
	"block_hash" varchar(66),
	"log_index" integer,
	"failure_code" varchar(80),
	"operation_context" jsonb,
	"created_at_unix" bigint NOT NULL,
	"updated_at_unix" bigint NOT NULL,
	CONSTRAINT "erc8183_operation_chain_check" CHECK ("erc8183_operations"."chain_id" in (56, 97)),
	CONSTRAINT "erc8183_operation_contract_check" CHECK ("erc8183_operations"."commerce_contract" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "erc8183_operation_digest_check" CHECK ("erc8183_operations"."request_digest" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "erc8183_operation_job_id_check" CHECK ("erc8183_operations"."erc8183_job_id" IS NULL OR "erc8183_operations"."erc8183_job_id" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "erc8183_operation_kind_check" CHECK ("erc8183_operations"."operation_kind" in ('create', 'register', 'set_budget', 'approve', 'fund', 'submit', 'settle', 'claim_refund', 'mark_expired', 'cancel', 'reject', 'dispute', 'vote')),
	CONSTRAINT "erc8183_operation_role_check" CHECK ("erc8183_operations"."signer_role" in ('client', 'provider', 'evaluator', 'voter', 'system')),
	CONSTRAINT "erc8183_operation_status_check" CHECK ("erc8183_operations"."status" in ('awaiting_signature', 'submitted', 'confirmed', 'reverted', 'unknown', 'reconciled', 'manual_review')),
	CONSTRAINT "erc8183_operation_hash_check" CHECK (("erc8183_operations"."transaction_hash" IS NULL OR "erc8183_operations"."transaction_hash" ~ '^0x[0-9A-Fa-f]{64}$') AND ("erc8183_operations"."block_hash" IS NULL OR "erc8183_operations"."block_hash" ~ '^0x[0-9A-Fa-f]{64}$')),
	CONSTRAINT "erc8183_operation_log_check" CHECK ("erc8183_operations"."log_index" IS NULL OR "erc8183_operations"."log_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN "provider_binding" jsonb;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN "buyer_approval_address" varchar(42);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN "buyer_approval_result_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN "buyer_approved_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "erc8183_operation_idempotency_unique" ON "erc8183_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "erc8183_operation_job_idx" ON "erc8183_operations" USING btree ("chain_id","commerce_contract","erc8183_job_id");--> statement-breakpoint
CREATE INDEX "erc8183_operation_status_idx" ON "erc8183_operations" USING btree ("status","updated_at_unix");--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_buyer_approval_check" CHECK (num_nonnulls("erc8183_jobs"."buyer_approval_address", "erc8183_jobs"."buyer_approval_result_digest", "erc8183_jobs"."buyer_approved_at") in (0, 3));--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_buyer_approval_address_check" CHECK ("erc8183_jobs"."buyer_approval_address" IS NULL OR "erc8183_jobs"."buyer_approval_address" ~ '^0x[0-9A-Fa-f]{40}$');--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_buyer_approval_digest_check" CHECK ("erc8183_jobs"."buyer_approval_result_digest" IS NULL OR "erc8183_jobs"."buyer_approval_result_digest" ~ '^[0-9A-Fa-f]{64}$');