\set ON_ERROR_STOP on
SET lock_timeout='5s';
SET statement_timeout='10min';
SELECT pid,pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity
WHERE datname=current_database() AND backend_type='client backend' AND state='active'
AND query_start<now()-interval '60 seconds' AND pid<>pg_backend_pid()
AND (query LIKE 'select * from (select distinct on(i.id) eo.agent_version_id,eo.normalized_payload,i.chain_id,i.agent_id%'
 OR query LIKE 'with snapshots as materialized (select distinct on(i.id)%'
 OR query LIKE 'SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id, i.owner_address, i.agent_wallet,%');
CREATE INDEX CONCURRENTLY bnbera_directory_profile_latest_idx
ON agent_enrichment_observations(agent_version_id,source_timestamp DESC,"createdAt" DESC)
WHERE observation_type='registered_directory_v1' AND validation_state='valid' AND provider IN ('8004scan','bnbera-registry-review');
CREATE INDEX CONCURRENTLY bnbera_directory_service_latest_idx
ON agent_enrichment_observations(agent_version_id,source_timestamp DESC,"createdAt" DESC)
WHERE observation_type='service_verification_v1' AND validation_state='valid' AND provider='bnbera-protocol-verifier';
SELECT c.relname,i.indisvalid,i.indisready,pg_size_pretty(pg_relation_size(c.oid)) AS size FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname IN ('bnbera_directory_profile_latest_idx','bnbera_directory_service_latest_idx');
CREATE INDEX CONCURRENTLY IF NOT EXISTS bnbera_a2a_probe_latest_idx
ON agent_service_probe_results (identity_id, observed_at DESC)
INCLUDE (url, validation_status) WHERE kind='a2a';
CREATE INDEX CONCURRENTLY IF NOT EXISTS bnbera_enrichment_latest_idx
ON agent_enrichment_observations (agent_version_id, source_timestamp DESC NULLS LAST, "createdAt" DESC);
