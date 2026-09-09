import pg from 'pg';
async function main(){
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 try {
  const scans=(await pool.query(`select scope,pages_processed,candidates_processed,next_offset,total,completed_at,"updatedAt" from scan_discovery_checkpoints where scope like 'directory-full-v1:%' order by scope`)).rows;
  const coverage=(await pool.query(`with members as(select i.id,i.chain_id from erc8004_identities i where exists(select 1 from agent_discovery_sources s where s.identity_id=i.id and s.normalized_ingestion_version in ('bnbera-directory-v1','bnbera-directory-full-v1'))),
    latest as(select distinct on(m.id) m.id,m.chain_id,eo.agent_version_id,eo.normalized_payload from members m join agents a on a.identity_id=m.id join agent_versions v on v.agent_id=a.id join agent_enrichment_observations eo on eo.agent_version_id=v.id where eo.observation_type='registered_directory_v1' and eo.validation_state='valid' order by m.id,eo.source_timestamp desc,eo."createdAt" desc)
    select m.chain_id,count(*)::int as discovered,count(l.id)::int as enriched,
      count(*) filter(where l.normalized_payload->'registration'->>'status'='resolved')::int as metadata_resolved,
      count(*) filter(where exists(select 1 from agent_listing_embeddings e where e.agent_version_id=l.agent_version_id and e.source_text_digest=l.normalized_payload->>'semanticDigest'))::int as vectorized
    from members m left join latest l on l.id=m.id group by m.chain_id order by m.chain_id`)).rows;
  console.log(JSON.stringify({observedAt:new Date().toISOString(),scans,coverage}));
 }finally{await pool.end();}
}
main().catch(()=>{console.error(JSON.stringify({errorCode:'DIRECTORY_STATUS_FAILED'}));process.exitCode=1;});
