ALTER TABLE "evidence_locators" ADD COLUMN "provider_label" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_objects" ADD COLUMN "artifact_id" varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "provider_label" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "configuration_digest" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "configured_network" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "configured_bucket" varchar(128);--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "evidence_publication_attempts" ADD COLUMN "lease_expires_at" timestamp with time zone;