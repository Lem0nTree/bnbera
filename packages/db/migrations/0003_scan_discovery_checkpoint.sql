CREATE TABLE "scan_discovery_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(160) NOT NULL,
	"query_digest" varchar(64) NOT NULL,
	"initial_offset" bigint,
	"initial_cursor" varchar(256),
	"next_offset" bigint,
	"next_cursor" varchar(256),
	"page_size" integer NOT NULL,
	"total" bigint,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"candidates_processed" integer DEFAULT 0 NOT NULL,
	"last_page_digest" varchar(64),
	"cursor_version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_discovery_checkpoint_query_digest_check" CHECK ("scan_discovery_checkpoints"."query_digest" ~ '^[0-9A-Fa-f]{64}$'),
	CONSTRAINT "scan_discovery_checkpoint_cursor_check" CHECK (("scan_discovery_checkpoints"."next_offset" IS NULL OR "scan_discovery_checkpoints"."next_cursor" IS NULL)),
	CONSTRAINT "scan_discovery_checkpoint_counters_check" CHECK ("scan_discovery_checkpoints"."page_size" > 0 AND "scan_discovery_checkpoints"."pages_processed" >= 0 AND "scan_discovery_checkpoints"."candidates_processed" >= 0 AND "scan_discovery_checkpoints"."cursor_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scan_discovery_checkpoint_scope_unique" ON "scan_discovery_checkpoints" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "scan_discovery_checkpoint_updated_idx" ON "scan_discovery_checkpoints" USING btree ("updatedAt");
