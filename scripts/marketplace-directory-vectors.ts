import {canonicalSha256Hex} from "../packages/domain/src/index.ts";
/** Vectorize persisted, finalized public directory profiles without changing execution eligibility. */
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadRuntimeConfig, validateSemanticEmbeddingLock } from '../packages/config/src/runtime.ts';
import { buildDirectorySemanticDocument, createEmbeddingProviderFromRuntimeConfig, ensureSemanticVector, PgVectorSemanticRepository, PostgresMarketplaceIngestionState } from '../packages/agent-ingestion/src/index.ts';
import { directoryObservationType, directorySnapshotSchema } from '../packages/agent-ingestion/src/directory.ts';

async function main() {
  if(process.env.MARKETPLACE_DIRECTORY_VECTORS_ENABLED !== 'true') return;
  const runtime=loadRuntimeConfig(process.env);
  const lock=JSON.parse(await readFile(new URL('../config/standards.lock.json',import.meta.url),'utf8'));
  validateSemanticEmbeddingLock(lock,runtime);
  const provider=createEmbeddingProviderFromRuntimeConfig(runtime,ref=>process.env[ref]);
  const pool=new pg.Pool({connectionString:runtime.databaseUrl,max:3});
  const guard=await pool.connect();
  try {
    if(!(await guard.query('select pg_try_advisory_lock(8004110) acquired')).rows[0].acquired)return;
    const repository=new PgVectorSemanticRepository(pool);
    const limit=Number(process.env.MARKETPLACE_DIRECTORY_VECTOR_BATCH??100);
    if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error('INVALID_VECTOR_BATCH');
    const state=new PostgresMarketplaceIngestionState(pool);
    const cursor=await state.ensureDiscoveryCursor({scope:'directory-vectors-v1',chainId:56,identityRegistry:lock.networks['56'].erc8004.identityRegistry,pageSize:limit});
    const rows=(await pool.query(`select d.* from (select distinct on(i.id) eo.agent_version_id,eo.normalized_payload,eo.source_timestamp,eo.provider,eo.source_block
      from agent_enrichment_observations eo join agent_versions v on v.id=eo.agent_version_id join agents a on a.id=v.agent_id join erc8004_identities i on i.id=a.identity_id
      where eo.observation_type=$1 and eo.validation_state='valid' and i.read_consistency='finalized'
      and i.chain_id in(56,97) and a.listing_status not in('delisted','suspended') and a.verification_status<>'rejected'
      and exists(select 1 from agent_discovery_sources s where s.identity_id=i.id and s.normalized_ingestion_version in ('bnbera-directory-v1','bnbera-directory-full-v1'))
      order by i.id,eo.source_timestamp desc,eo."createdAt" desc) d
      order by d.agent_version_id limit $2 offset $3`,[directoryObservationType,limit,cursor.nextOffset])).rows;
    let generated=0,reused=0,failed=0;
    for(const row of rows) {
      try {
        const s=directorySnapshotSchema.parse(row.normalized_payload);
        const document=buildDirectorySemanticDocument(s);
        const result=await ensureSemanticVector({agentVersionId:row.agent_version_id,document,classifierVersion:null,provider},repository);
        if(result.generated)generated++; else reused++;
        if(s.semanticDigest!==document.digest || s.category!==document.document.category) {
          const payload={...s,category:document.document.category,semanticDigest:document.digest};
          await pool.query(`insert into agent_enrichment_observations(agent_version_id,provider,observation_type,normalized_payload,source_timestamp,source_block,freshness,validation_state,payload_digest)
            select $1::uuid,$2::varchar,$3::varchar,$4::jsonb,$5::timestamptz,$6::bigint,'fresh','valid',$7::varchar
            where not exists(select 1 from agent_enrichment_observations where agent_version_id=$1 and observation_type=$3 and payload_digest=$7)`,
            [row.agent_version_id,row.provider,directoryObservationType,JSON.stringify(payload),row.source_timestamp,row.source_block,canonicalSha256Hex(payload)]);
        }
      }catch(error) {failed++; const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'DIRECTORY_VECTOR_FAILED'; console.log(JSON.stringify({stage:'directory_vector_failure',versionId:row.agent_version_id,code:/^[A-Z][A-Z0-9_]{2,63}$/u.test(code)?code:'DIRECTORY_VECTOR_FAILED'}));}
    }
    await state.advanceDiscoveryCursor({scope:cursor.scope,expectedOffset:cursor.nextOffset,nextOffset:rows.length<limit?0:cursor.nextOffset+rows.length,total:null,pageAt:new Date()});
    console.log(JSON.stringify({stage:'directory_vectors',selected:rows.length,generated,reused,failed,modelVersion:provider.modelVersion}));
    if(failed)process.exitCode=1;
  } finally {await guard.query('select pg_advisory_unlock(8004110)');guard.release();await pool.end();}
}
main().catch(()=>{console.error(JSON.stringify({errorCode:'DIRECTORY_VECTORS_FAILED'}));process.exitCode=1;});
