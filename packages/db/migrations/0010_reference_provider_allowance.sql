CREATE TABLE "reference_provider_allowance" (
	"id" text PRIMARY KEY NOT NULL,
	"config_digest" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"healthy" boolean DEFAULT false NOT NULL,
	"heartbeat" timestamp with time zone,
	"reason" text DEFAULT 'NOT_STARTED' NOT NULL,
	"worker_pid" integer,
	CONSTRAINT "reference_allowance_exact_id" CHECK ("reference_provider_allowance"."id" = 'reference-2293-after-1171-v1')
);
--> statement-breakpoint
CREATE TABLE "reference_provider_slots" (
	"slot" integer PRIMARY KEY NOT NULL,
	"commerce_job_id" uuid NOT NULL,
	"gas_reserved" numeric(78, 0) NOT NULL,
	"gas_spent" numeric(78, 0),
	"state" text DEFAULT 'reserved' NOT NULL,
	"transaction_hash" text,
	"nonce" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_provider_slots_commerce_job_id_unique" UNIQUE("commerce_job_id"),
	CONSTRAINT "reference_slots_hard_cap" CHECK ("reference_provider_slots"."slot" BETWEEN 1 AND 3),
	CONSTRAINT "reference_slot_gas_cap" CHECK ("reference_provider_slots"."gas_reserved" = 100000000000000 AND ("reference_provider_slots"."gas_spent" IS NULL OR ("reference_provider_slots"."gas_spent" >= 0 AND "reference_provider_slots"."gas_spent" <= "reference_provider_slots"."gas_reserved")))
);
--> statement-breakpoint
ALTER TABLE "reference_provider_slots" ADD CONSTRAINT "reference_provider_slots_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE no action ON UPDATE no action;