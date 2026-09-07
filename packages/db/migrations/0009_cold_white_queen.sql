ALTER TABLE "auth_sessions" ADD COLUMN "wallet_address" varchar(42);--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "chain_id" integer;--> statement-breakpoint
CREATE INDEX "auth_sessions_wallet_context_idx" ON "auth_sessions" USING btree ("wallet_address","chain_id");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_wallet_binding_check" CHECK (("auth_sessions"."wallet_address" IS NULL AND "auth_sessions"."chain_id" IS NULL) OR ("auth_sessions"."wallet_address" IS NOT NULL AND "auth_sessions"."chain_id" IN (56, 97)));