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
ALTER TABLE "agent_service_probe_results" ADD CONSTRAINT "agent_service_probe_results_identity_id_erc8004_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."erc8004_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_service_probe_identity_time_idx" ON "agent_service_probe_results" USING btree ("identity_id","kind","url","observed_at");--> statement-breakpoint
CREATE INDEX "agent_service_probe_status_idx" ON "agent_service_probe_results" USING btree ("validation_status","observed_at");