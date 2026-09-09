/** Refresh only the retained capped directory. No discovery, invocation, signatures or payments. */
import pg from "pg";
import { canonicalSha256Hex } from "../packages/domain/src/index.ts";
import { directorySnapshotSchema, directoryObservationType, serviceVerificationObservationType, type ServiceVerification } from "../packages/agent-ingestion/src/directory.ts";
import { verifyDirectoryService } from "../packages/agent-ingestion/src/directory-verification.ts";

async function main() {
  if (process.env.MARKETPLACE_SERVICE_REFRESH_ENABLED !== "true") { console.log(JSON.stringify({status:"disabled"})); return; }
  const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const guard = await pool.connect();
  try {
    if (!(await guard.query("select pg_try_advisory_lock(8004101) acquired")).rows[0]?.acquired) { console.log(JSON.stringify({status:"already_running"})); return; }
    const rows=(await pool.query(`select * from (select distinct on(i.id) eo.agent_version_id,eo.normalized_payload,i.chain_id,i.agent_id
      from agent_enrichment_observations eo join agent_versions v on v.id=eo.agent_version_id join agents a on a.id=v.agent_id join erc8004_identities i on i.id=a.identity_id
      where eo.observation_type=$1 and eo.validation_state='valid' and i.chain_id in(56,97) and i.read_consistency='finalized'
        and exists(select 1 from agent_discovery_sources membership where membership.identity_id=i.id and membership.normalized_ingestion_version='bnbera-directory-v1')
        and a.listing_status not in ('delisted','suspended') and a.verification_status <> 'rejected'
      order by i.id,eo.source_timestamp desc,eo."createdAt" desc) members order by chain_id,agent_id::numeric limit 100`,[directoryObservationType])).rows;
    const counts:Record<string,number>={}; const cache=new Map<string,Promise<ServiceVerification>>(); let index=0,completed=0;
    const run=async()=>{
      while(index<rows.length) {
        const row=rows[index++]; const snapshot=directorySnapshotSchema.parse(row.normalized_payload);
        const results:ServiceVerification[]=[];
        for(const service of snapshot.services) {
          const key=JSON.stringify([service.name.toLowerCase(),service.url,service.version]);
          let pending=cache.get(key); if(!pending){pending=verifyDirectoryService(service);cache.set(key,pending);}
          const result=await pending; results.push({...result,name:service.name});
          const status=`${result.protocol}:${result.status}`;counts[status]=(counts[status]??0)+1;
        }
        const at=new Date().toISOString(); const payload={schemaVersion:serviceVerificationObservationType,identity:snapshot.identity,services:results,checkedAt:at};
        const digest=canonicalSha256Hex(payload);
        await pool.query(`insert into agent_enrichment_observations(agent_version_id,provider,observation_type,normalized_payload,source_timestamp,freshness,validation_state,payload_digest)
          select $1::uuid,'bnbera-protocol-verifier',$2::varchar,$3::jsonb,$4::timestamptz,'fresh','valid',$5::varchar where not exists(select 1 from agent_enrichment_observations where agent_version_id=$1::uuid and observation_type=$2::varchar and payload_digest=$5::varchar)`,[row.agent_version_id,serviceVerificationObservationType,JSON.stringify(payload),at,digest]);
        completed++;console.log(JSON.stringify({stage:"verified",chainId:row.chain_id,agentId:row.agent_id,services:results.map(s=>({protocol:s.protocol,status:s.status,reason:s.reason})),completed,total:rows.length}));
      }
    };
    await Promise.all(Array.from({length:4},run));console.log(JSON.stringify({status:"completed",agents:completed,uniqueServices:cache.size,counts}));
  }finally{await guard.query("select pg_advisory_unlock(8004101)");guard.release();await pool.end();}
}
main().catch(()=>{console.error(JSON.stringify({status:"failed",reason:"SERVICE_REFRESH_FAILED"}));process.exitCode=1;});
