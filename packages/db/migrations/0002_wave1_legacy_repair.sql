-- Wave 1 compatibility repair
--
-- The migration runner replays 0001 statement-by-statement for a recognizable
-- branch-local Wave 1 database before Drizzle reaches this file. Each replayed
-- statement is protected by a savepoint and accepts duplicate-object errors
-- only. This migration supplies the columns that CREATE TABLE IF NOT EXISTS
-- cannot add to an existing branch-local table, then removes two obsolete
-- relationships only after their data/integrity preconditions hold.

ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "spec_revision" varchar(160);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "abi_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "evaluator_profile" varchar(160);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "confirmation_threshold" integer;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "min_expiry_lead_seconds" integer;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "max_expiry_horizon_seconds" integer;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "min_budget_atomic" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "max_budget_atomic" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "deployment_pin_digest" varchar(64);--> statement-breakpoint
UPDATE "erc8183_jobs"
SET "spec_revision" = COALESCE("spec_revision", 'legacy/unverified'),
    "abi_hash" = COALESCE("abi_hash", repeat('0', 64)),
    "evaluator_profile" = COALESCE("evaluator_profile", 'legacy/unverified'),
    "confirmation_threshold" = COALESCE("confirmation_threshold", 1),
    "min_expiry_lead_seconds" = COALESCE("min_expiry_lead_seconds", 1),
    "max_expiry_horizon_seconds" = COALESCE("max_expiry_horizon_seconds", 1),
    "min_budget_atomic" = COALESCE("min_budget_atomic", 0),
    "max_budget_atomic" = COALESCE("max_budget_atomic", "budget_atomic"),
    "deployment_pin_digest" = COALESCE("deployment_pin_digest", repeat('0', 64))
WHERE "spec_revision" IS NULL
   OR "abi_hash" IS NULL
   OR "evaluator_profile" IS NULL
   OR "confirmation_threshold" IS NULL
   OR "min_expiry_lead_seconds" IS NULL
   OR "max_expiry_horizon_seconds" IS NULL
   OR "min_budget_atomic" IS NULL
   OR "max_budget_atomic" IS NULL
   OR "deployment_pin_digest" IS NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "spec_revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "abi_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "evaluator_profile" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "confirmation_threshold" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "min_expiry_lead_seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "max_expiry_horizon_seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "min_budget_atomic" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "max_budget_atomic" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ALTER COLUMN "deployment_pin_digest" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "max_challenge_lifetime_seconds" integer;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "pin_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "configuration_version" integer;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "configuration_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "fixed_egress_profile" varchar(160);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "payout_address" varchar(42);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN IF NOT EXISTS "payout_verification_state" varchar(64);--> statement-breakpoint
UPDATE "payment_attempts"
SET "max_challenge_lifetime_seconds" = COALESCE("max_challenge_lifetime_seconds", 1),
    "pin_digest" = COALESCE("pin_digest", repeat('0', 64)),
    "configuration_version" = COALESCE("configuration_version", 1),
    "configuration_digest" = COALESCE("configuration_digest", repeat('0', 64)),
    "fixed_egress_profile" = COALESCE("fixed_egress_profile", 'legacy/unverified'),
    "payout_address" = COALESCE("payout_address", "expected_recipient"),
    "payout_verification_state" = COALESCE("payout_verification_state", 'verified')
WHERE "max_challenge_lifetime_seconds" IS NULL
   OR "pin_digest" IS NULL
   OR "configuration_version" IS NULL
   OR "configuration_digest" IS NULL
   OR "fixed_egress_profile" IS NULL
   OR "payout_address" IS NULL
   OR "payout_verification_state" IS NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "max_challenge_lifetime_seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "pin_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "configuration_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "configuration_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "fixed_egress_profile" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "payout_address" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "payout_verification_state" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "evidence_objects" ADD COLUMN IF NOT EXISTS "artifact_id" varchar(160);--> statement-breakpoint
UPDATE "evidence_objects" SET "artifact_id" = 'legacy:' || "id"::text WHERE "artifact_id" IS NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ALTER COLUMN "artifact_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN IF NOT EXISTS "artifact_schema_version" varchar(64) DEFAULT 'bnbera.evidence/v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "provider_label" varchar(128);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "configuration_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "configured_network" varchar(128);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "configured_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "evidence_publication_attempts"
SET "provider_label" = COALESCE("provider_label", 'legacy'),
    "configuration_digest" = COALESCE("configuration_digest", repeat('0', 64)),
    "configured_network" = COALESCE("configured_network", 'legacy')
WHERE "provider_label" IS NULL OR "configuration_digest" IS NULL OR "configured_network" IS NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ALTER COLUMN "provider_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ALTER COLUMN "configuration_digest" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ALTER COLUMN "configured_network" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_locators" ADD COLUMN IF NOT EXISTS "provider_label" varchar(128);--> statement-breakpoint
UPDATE "evidence_locators" SET "provider_label" = COALESCE("provider_label", 'legacy') WHERE "provider_label" IS NULL;--> statement-breakpoint
ALTER TABLE "evidence_locators" ALTER COLUMN "provider_label" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_contract_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_contract_check"
      CHECK ("commerce_contract" ~ '^0x[0-9A-Fa-f]{40}$' AND "payment_token" ~ '^0x[0-9A-Fa-f]{40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_spec_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_spec_check"
      CHECK (char_length("spec_revision") > 0 AND char_length("evaluator_profile") > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_abi_hash_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_abi_hash_check" CHECK ("abi_hash" ~ '^[0-9A-Fa-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_pin_digest_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_pin_digest_check" CHECK ("deployment_pin_digest" ~ '^[0-9A-Fa-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_confirmation_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_confirmation_check" CHECK ("confirmation_threshold" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_expiry_bounds_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_expiry_bounds_check"
      CHECK ("min_expiry_lead_seconds" > 0 AND "max_expiry_horizon_seconds" >= "min_expiry_lead_seconds");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erc8183_job_pin_budget_bounds_check') THEN
    ALTER TABLE "erc8183_jobs" ADD CONSTRAINT "erc8183_job_pin_budget_bounds_check"
      CHECK ("min_budget_atomic" >= 0 AND "max_budget_atomic" >= "min_budget_atomic" AND "budget_atomic" between "min_budget_atomic" and "max_budget_atomic");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempt_pin_digest_check') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempt_pin_digest_check"
      CHECK ("pin_digest" ~ '^[0-9A-Fa-f]{64}$' AND "configuration_digest" ~ '^[0-9A-Fa-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempt_configuration_version_check') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempt_configuration_version_check" CHECK ("configuration_version" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempt_challenge_lifetime_check') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempt_challenge_lifetime_check" CHECK ("max_challenge_lifetime_seconds" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempt_payout_verification_check') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempt_payout_verification_check" CHECK ("payout_verification_state" = 'verified');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempt_address_check') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempt_address_check"
      CHECK ("settlement_asset" ~ '^0x[0-9A-Fa-f]{40}$' AND "expected_recipient" ~ '^0x[0-9A-Fa-f]{40}$' AND "payout_address" ~ '^0x[0-9A-Fa-f]{40}$');
  END IF;
END $$;--> statement-breakpoint

-- Do not discard an old receipt pointer until every non-null pointer agrees
-- with the canonical receipt owner. A mismatch is a data-integrity failure,
-- not a migration conflict to be silently repaired.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_attempts' AND column_name = 'receipt_id'
  ) AND EXISTS (
    SELECT 1
    FROM "payment_attempts" attempt
    LEFT JOIN "payment_receipts" receipt ON receipt.id = attempt.receipt_id
    WHERE attempt.receipt_id IS NOT NULL
      AND (receipt.id IS NULL OR receipt.attempt_id <> attempt.id)
  ) THEN
    RAISE EXCEPTION 'Cannot remove payment_attempts.receipt_id: legacy receipt ownership is inconsistent';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP COLUMN IF EXISTS "receipt_id";--> statement-breakpoint

-- The old global job-id uniqueness prevents the same ERC-8183 numeric id from
-- being represented on independent deployments. Remove it only after the
-- canonical network/deployment identity and one-to-one parent link exist.
DO $$
BEGIN
  IF to_regclass('public.commerce_erc8183_job_unique') IS NOT NULL
     AND (
       to_regclass('public.erc8183_job_network_identity_unique') IS NULL
       OR to_regclass('public.erc8183_job_commerce_job_unique') IS NULL
     ) THEN
    RAISE EXCEPTION 'Cannot remove commerce_erc8183_job_unique before canonical ERC-8183 identity indexes exist';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "commerce_erc8183_job_unique";
