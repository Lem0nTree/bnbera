DROP INDEX IF EXISTS "erc8004_reputation_event_log_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "erc8004_reputation_event_log_unique" ON "erc8004_reputation_events" USING btree ("transaction_hash","log_index","block_hash");
