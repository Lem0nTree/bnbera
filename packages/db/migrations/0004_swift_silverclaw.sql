CREATE TABLE "marketplace_discovery_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(160) NOT NULL,
	"chain_id" integer NOT NULL,
	"identity_registry" varchar(42) NOT NULL,
	"page_size" integer NOT NULL,
	"next_offset" bigint DEFAULT 0 NOT NULL,
	"total" bigint,
	"sweep" integer DEFAULT 0 NOT NULL,
	"last_page_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_ingestion_retries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_stage" varchar(64),
	"last_error_code" varchar(64),
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_ingestion_retries" ADD CONSTRAINT "marketplace_ingestion_retries_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_discovery_cursor_scope_unique" ON "marketplace_discovery_cursors" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "marketplace_discovery_cursor_due_idx" ON "marketplace_discovery_cursors" USING btree ("updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_ingestion_retry_identity_unique" ON "marketplace_ingestion_retries" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "marketplace_ingestion_retry_due_idx" ON "marketplace_ingestion_retries" USING btree ("next_attempt_at","updatedAt");
