CREATE TYPE "publication_provider" AS ENUM ('ipfs', 'greenfield');--> statement-breakpoint
CREATE TYPE "publication_attempt_state" AS ENUM ('pending', 'validating', 'creating_object', 'submitted', 'uploading', 'awaiting_seal', 'reading_back', 'verified', 'validation_failed', 'create_failed', 'upload_failed', 'seal_timeout', 'readback_failed', 'hash_mismatch', 'duplicate', 'provider_failed', 'retrying');--> statement-breakpoint
CREATE TYPE "evidence_verification_status" AS ENUM ('not_verified', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "evidence_readback_status" AS ENUM ('not_attempted', 'matched', 'missing', 'corrupt', 'timeout', 'provider_failed');--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN "artifact_schema_version" varchar(64) DEFAULT 'bnbera.evidence/v1' NOT NULL;--> statement-breakpoint
CREATE TABLE "evidence_publication_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"provider" "publication_provider" NOT NULL,
	"idempotency_key" varchar(256) NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
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
);--> statement-breakpoint
CREATE TABLE "evidence_locators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_object_id" uuid NOT NULL,
	"publication_attempt_id" uuid,
	"provider" "publication_provider" NOT NULL,
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
);--> statement-breakpoint
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
);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD CONSTRAINT "evidence_publication_attempts_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_locators" ADD CONSTRAINT "evidence_locators_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_locators" ADD CONSTRAINT "evidence_locators_publication_attempt_id_evidence_publication_attempts_id_fk" FOREIGN KEY ("publication_attempt_id") REFERENCES "public"."evidence_publication_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verification_results" ADD CONSTRAINT "evidence_verification_results_evidence_object_id_evidence_objects_id_fk" FOREIGN KEY ("evidence_object_id") REFERENCES "public"."evidence_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_verification_results" ADD CONSTRAINT "evidence_verification_results_publication_attempt_id_evidence_publication_attempts_id_fk" FOREIGN KEY ("publication_attempt_id") REFERENCES "public"."evidence_publication_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_publication_idempotency_unique" ON "evidence_publication_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "evidence_publication_object_provider_idx" ON "evidence_publication_attempts" USING btree ("evidence_object_id", "provider");--> statement-breakpoint
CREATE INDEX "evidence_publication_state_idx" ON "evidence_publication_attempts" USING btree ("state", "updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_locator_uri_unique" ON "evidence_locators" USING btree ("provider", "uri");--> statement-breakpoint
CREATE INDEX "evidence_locator_object_provider_idx" ON "evidence_locators" USING btree ("evidence_object_id", "provider");--> statement-breakpoint
CREATE INDEX "evidence_verification_object_time_idx" ON "evidence_verification_results" USING btree ("evidence_object_id", "checked_at");--> statement-breakpoint
CREATE INDEX "evidence_verification_status_idx" ON "evidence_verification_results" USING btree ("status", "checked_at");
