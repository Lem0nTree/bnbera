/** Check reversible directory membership against retained history, rolling back the trial. */
import pg from "pg";
import {writeFile} from "node:fs/promises";
async function main(){
  if(process.env.DIRECTORY_MEMBERSHIP_DB_CHECK_ENABLED!=="true")return;
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});const tx=await pool.connect();
  const query=`SELECT DISTINCT i.id,i.chain_id,i.agent_id FROM erc8004_identities i JOIN agents a ON a.identity_id=i.id JOIN agent_versions v ON v.agent_id=a.id
    JOIN agent_enrichment_observations eo ON eo.agent_version_id=v.id WHERE eo.observation_type='registered_directory_v1' AND eo.provider='8004scan' AND eo.validation_state='valid'
    AND i.chain_id IN(56,97) AND i.read_consistency='finalized' AND a.listing_status NOT IN('delisted','suspended') AND a.verification_status<>'rejected'
    AND EXISTS(SELECT 1 FROM agent_discovery_sources s WHERE s.identity_id=i.id AND s.normalized_ingestion_version='bnbera-directory-v1')`;
  try{
    await tx.query("BEGIN");await tx.query("SELECT pg_advisory_xact_lock(8004100)");
    const before=(await tx.query(query)).rows;
    if(before.length!==100||before.filter(r=>r.chain_id===56).length!==80||before.filter(r=>r.chain_id===97).length!==20)throw new Error("DIRECTORY_QUOTA_MISMATCH");
    const selected=before.find(r=>r.chain_id===56&&r.agent_id==="208760");if(!selected)throw new Error("PRIORITY_PROFILE_MISSING");
    const historyBefore=(await tx.query("SELECT count(*)::integer AS count FROM agent_enrichment_observations")).rows[0].count;
    await tx.query("UPDATE agent_discovery_sources SET normalized_ingestion_version='bnbera-directory-archived-v1' WHERE identity_id=$1 AND normalized_ingestion_version='bnbera-directory-v1'",[selected.id]);
    const hidden=(await tx.query(query)).rows;
    if(hidden.length!==99||hidden.some(r=>r.id===selected.id))throw new Error("ARCHIVED_PROFILE_STILL_VISIBLE");
    const historyAfter=(await tx.query("SELECT count(*)::integer AS count FROM agent_enrichment_observations")).rows[0].count;
    if(historyBefore!==historyAfter)throw new Error("HISTORY_MUTATED");
    await tx.query("ROLLBACK");
    const restored=(await tx.query(query)).rows;if(restored.length!==100||!restored.some(r=>r.id===selected.id))throw new Error("RESTORE_FAILED");
    const archived=(await tx.query("SELECT i.agent_id FROM erc8004_identities i JOIN agent_discovery_sources s ON s.identity_id=i.id WHERE s.normalized_ingestion_version='bnbera-directory-archived-v1' ORDER BY i.agent_id::numeric")).rows.map(r=>r.agent_id);
    const evidence={observedAt:new Date().toISOString(),visible:100,mainnet:80,testnet:20,archived,trialHidden:1,trialRolledBack:true,historyPreserved:true,deleted:0};
    await writeFile(new URL("../.runtime/mainnet-supply-upgrade/directory-membership-check.json",import.meta.url),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
  }catch(error){await tx.query("ROLLBACK");throw error;}finally{tx.release();await pool.end();}
}
main().catch((error:unknown)=>{console.error("DIRECTORY_MEMBERSHIP_CHECK_FAILED",error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"DATABASE_OPERATION_FAILED");process.exitCode=1;});
