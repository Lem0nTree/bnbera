CREATE TABLE "external_seller_deliveries" (
	"commerce_job_id" uuid PRIMARY KEY NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"quote_digest" varchar(64) NOT NULL,
	"protocol_job_id" text NOT NULL,
	"status" varchar(24) NOT NULL,
	"response_digest" varchar(64),
	"result_digest" varchar(64),
	"last_checked_block" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_seller_delivery_status_check" CHECK ("external_seller_deliveries"."status" in ('claimed','notified','unknown','result_verified')),
	CONSTRAINT "external_seller_delivery_quote_digest_check" CHECK ("external_seller_deliveries"."quote_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "external_seller_delivery_job_id_check" CHECK ("external_seller_deliveries"."protocol_job_id" ~ '^[1-9][0-9]*$')
);
--> statement-breakpoint
ALTER TABLE "external_seller_deliveries" ADD CONSTRAINT "external_seller_deliveries_commerce_job_id_commerce_jobs_id_fk" FOREIGN KEY ("commerce_job_id") REFERENCES "public"."commerce_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_seller_deliveries" ADD CONSTRAINT "external_seller_deliveries_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
