-- Rebuildable directory metadata cache. Pause writers while first populating.
-- Full source history remains untouched. REFRESH CONCURRENTLY before resuming discovery.
CREATE MATERIALIZED VIEW IF NOT EXISTS bnbera_directory_catalog_cache AS
SELECT id AS identity_id,agent_version_id,profile,source_timestamp,category FROM (
select distinct on(i.id) i.id,i.chain_id,i.agent_id,a.origin_type,a.verification_status,a.runtime_status,
 a.listing_status,eo.agent_version_id,jsonb_build_object('name',eo.normalized_payload->'name','description',eo.normalized_payload->'description','protocols',eo.normalized_payload->'protocols','skills',eo.normalized_payload->'skills','services',eo.normalized_payload->'services','tags',eo.normalized_payload->'tags','scores',eo.normalized_payload->'scores','semanticDigest',eo.normalized_payload->'semanticDigest') as profile,eo.source_timestamp,
 coalesce(eo.normalized_payload->>'category',v.public_metadata->>'category','uncategorized') as category
 from erc8004_identities i join agents a on a.identity_id=i.id join agent_versions v on v.agent_id=a.id
 join agent_enrichment_observations eo on eo.agent_version_id=v.id
 where eo.observation_type='registered_directory_v1' and eo.provider in('8004scan','bnbera-registry-review') and eo.validation_state='valid'
 and i.chain_id in(56,97) and i.read_consistency='finalized' and a.listing_status not in('delisted','suspended') and a.verification_status<>'rejected'
 and exists(select 1 from agent_discovery_sources s where s.identity_id=i.id and s.normalized_ingestion_version in ('bnbera-directory-v1','bnbera-directory-full-v1'))
 order by i.id,eo.source_timestamp desc,eo."createdAt" desc
) latest;
CREATE UNIQUE INDEX IF NOT EXISTS bnbera_directory_catalog_cache_identity_idx ON bnbera_directory_catalog_cache(identity_id);
ANALYZE bnbera_directory_catalog_cache;
