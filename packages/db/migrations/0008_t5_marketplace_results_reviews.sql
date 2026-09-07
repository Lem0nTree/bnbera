CREATE TABLE "commerce_job_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commerce_job_id" uuid NOT NULL,
	"erc8183_job_record_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"commerce_contract" varchar(42) NOT NULL,
	"protocol_job_id" text NOT NULL,
	"buyer_user_id" uuid,
	"buyer_address" varchar(42) NOT NULL,
	"identity_namespace" varchar(128) NOT NULL,
	"identity_chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"identity_agent_id" text NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"provider_address" varchar(42) NOT NULL,
	"provider_binding" jsonb NOT NULL,
	"result_sha256" varchar(64) NOT NULL,
	"result_keccak" varchar(66) NOT NULL,
	"result_url" text,
	"result_payload" jsonb,
	"submission_transaction_hash" varchar(66) NOT NULL,
	"submission_block_number" bigint NOT NULL,
	"submission_block_hash" varchar(66) NOT NULL,
	"submission_log_index" integer,
	"submitted_at" timestamp with time zone NOT NULL,
	"state" varchar(16) DEFAULT 'submitted' NOT NULL,
	"settlement_transaction_hash" varchar(66),
	"settlement_block_number" bigint,
	"settlement_block_hash" varchar(66),
	"settlement_log_index" integer,
	"settled_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_job_result_chain_check" CHECK ("commerce_job_results"."chain_id" in (56, 97) AND "commerce_job_results"."identity_chain_id" = "commerce_job_results"."chain_id"),
	CONSTRAINT "commerce_job_result_contract_check" CHECK ("commerce_job_results"."commerce_contract" ~ '^0x[0-9A-Fa-f]{40}$' AND "commerce_job_results"."identity_registry" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "commerce_job_result_protocol_job_id_check" CHECK ("commerce_job_results"."protocol_job_id" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "commerce_job_result_address_check" CHECK ("commerce_job_results"."buyer_address" ~ '^0x[0-9A-Fa-f]{40}$' AND "commerce_job_results"."provider_address" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "commerce_job_result_agent_id_check" CHECK ("commerce_job_results"."identity_agent_id" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "commerce_job_result_version_check" CHECK ("commerce_job_results"."agent_version" > 0),
	CONSTRAINT "commerce_job_result_sha_check" CHECK ("commerce_job_results"."result_sha256" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_result_keccak_check" CHECK ("commerce_job_results"."result_keccak" ~ '^0x[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_result_submission_hash_check" CHECK ("commerce_job_results"."submission_transaction_hash" ~ '^0x[0-9A-Fa-f]{64}$' AND "commerce_job_results"."submission_block_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_result_settlement_state_check" CHECK ("commerce_job_results"."state" in ('submitted', 'settled')),
	CONSTRAINT "commerce_job_result_settlement_fields_check" CHECK (num_nonnulls("commerce_job_results"."settlement_transaction_hash", "commerce_job_results"."settlement_block_number", "commerce_job_results"."settlement_block_hash", "commerce_job_results"."settled_at") in (0, 4)),
	CONSTRAINT "commerce_job_result_settled_state_check" CHECK (("commerce_job_results"."state" = 'settled') = ("commerce_job_results"."settlement_transaction_hash" IS NOT NULL)),
	CONSTRAINT "commerce_job_result_log_index_check" CHECK (("commerce_job_results"."submission_log_index" IS NULL OR "commerce_job_results"."submission_log_index" >= 0) AND ("commerce_job_results"."settlement_log_index" IS NULL OR "commerce_job_results"."settlement_log_index" >= 0))
);
--> statement-breakpoint
CREATE TABLE "commerce_job_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commerce_job_result_id" uuid NOT NULL,
	"commerce_job_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"buyer_address" varchar(42) NOT NULL,
	"identity_namespace" varchar(128) NOT NULL,
	"identity_chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"identity_agent_id" text NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"provider_binding" jsonb NOT NULL,
	"result_sha256" varchar(64) NOT NULL,
	"result_keccak" varchar(66) NOT NULL,
	"settlement_transaction_hash" varchar(66) NOT NULL,
	"score" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"review_state" varchar(16) DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"active_review_key" uuid,
	"supersedes_review_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(240),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_job_review_chain_check" CHECK ("commerce_job_reviews"."identity_chain_id" in (56, 97)),
	CONSTRAINT "commerce_job_review_address_check" CHECK ("commerce_job_reviews"."buyer_address" ~ '^0x[0-9A-Fa-f]{40}$' AND "commerce_job_reviews"."identity_registry" ~ '^0x[0-9A-Fa-f]{40}$'),
	CONSTRAINT "commerce_job_review_agent_id_check" CHECK ("commerce_job_reviews"."identity_agent_id" ~ '^(0|[1-9][0-9]*)$'),
	CONSTRAINT "commerce_job_review_version_check" CHECK ("commerce_job_reviews"."agent_version" > 0),
	CONSTRAINT "commerce_job_review_sha_check" CHECK ("commerce_job_reviews"."result_sha256" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_review_keccak_check" CHECK ("commerce_job_reviews"."result_keccak" ~ '^0x[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_review_receipt_check" CHECK ("commerce_job_reviews"."settlement_transaction_hash" ~ '^0x[0-9A-Fa-f]{64}$'),
	CONSTRAINT "commerce_job_review_score_check" CHECK ("commerce_job_reviews"."score" between 1 and 5),
	CONSTRAINT "commerce_job_review_state_check" CHECK ("commerce_job_reviews"."review_state" in ('active', 'superseded', 'revoked')),
	CONSTRAINT "commerce_job_review_active_key_check" CHECK (("commerce_job_reviews"."review_state" = 'active') = ("commerce_job_reviews"."active_review_key" IS NOT NULL)),
	CONSTRAINT "commerce_job_review_revocation_check" CHECK (("commerce_job_reviews"."review_state" = 'revoked') = ("commerce_job_reviews"."revoked_at" IS NOT NULL)),
	CONSTRAINT "commerce_job_review_revision_check" CHECK ("commerce_job_reviews"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_job_results" ADD CONSTRAINT "commerce_job_results_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_job_results" ADD CONSTRAINT "commerce_job_results_erc8183_job_record_id_erc8183_jobs_id_fk" FOREIGN KEY ("erc8183_job_record_id") REFERENCES "public"."erc8183_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_job_results" ADD CONSTRAINT "commerce_job_results_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_job_reviews" ADD CONSTRAINT "commerce_job_reviews_commerce_job_result_id_commerce_job_results_id_fk" FOREIGN KEY ("commerce_job_result_id") REFERENCES "public"."commerce_job_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_job_reviews" ADD CONSTRAINT "commerce_job_reviews_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_job_reviews" ADD CONSTRAINT "commerce_job_reviews_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_job_result_protocol_unique" ON "commerce_job_results" USING btree ("chain_id","commerce_contract","protocol_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_job_result_erc8183_job_unique" ON "commerce_job_results" USING btree ("erc8183_job_record_id");--> statement-breakpoint
CREATE INDEX "commerce_job_result_identity_idx" ON "commerce_job_results" USING btree ("identity_namespace","identity_chain_id","identity_registry","identity_agent_id","agent_version_id");--> statement-breakpoint
CREATE INDEX "commerce_job_result_settled_idx" ON "commerce_job_results" USING btree ("state","settled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_job_review_active_unique" ON "commerce_job_reviews" USING btree ("active_review_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_job_review_revision_unique" ON "commerce_job_reviews" USING btree ("commerce_job_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_job_review_idempotency_unique" ON "commerce_job_reviews" USING btree ("buyer_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "commerce_job_review_identity_idx" ON "commerce_job_reviews" USING btree ("identity_namespace","identity_chain_id","identity_registry","identity_agent_id","agent_version_id","review_state");--> statement-breakpoint
CREATE INDEX "commerce_job_review_result_idx" ON "commerce_job_reviews" USING btree ("commerce_job_result_id","review_state");