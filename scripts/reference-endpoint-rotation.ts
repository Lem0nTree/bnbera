/** Reviewed local allowance rebind: preserve all lifetime slots and spend caps. */
import {spawnSync} from "node:child_process";
import {openSync,closeSync} from "node:fs";
import {writeFile} from "node:fs/promises";
import pg from "pg";
import {canonicalSha256Hex} from "../packages/domain/src/index.ts";
import {REFERENCE_ALLOWANCE as P,REFERENCE_ALLOWANCE_DIGEST} from "../packages/agent-commerce/src/reference-admission.ts";
async function main(){
  if(process.env.REFERENCE_ENDPOINT_ROTATION_ENABLED!=="true")return;
  const url=new URL(process.env.DATABASE_URL!);
  if(url.hostname!=="127.0.0.1"||url.port!=="55432"||url.pathname!=="/bnbera_erc8004")throw new Error("UNEXPECTED_RETAINED_DATABASE");
  const backup=new URL(`../.runtime/mainnet-supply-upgrade/before-directory-reference-rotation-${Date.now()}.dump`,import.meta.url).pathname;
  const fd=openSync(backup,"wx",0o600);
  const dump=spawnSync("sudo",["docker","exec","bnbera_erc8004_pgvector","pg_dump","-U",decodeURIComponent(url.username),"-d",url.pathname.slice(1),"--format=custom"],{stdio:["ignore",fd,"ignore"]});closeSync(fd);
  if(dump.status!==0)throw new Error("BACKUP_FAILED");
  const oldDigest=canonicalSha256Hex({...P,version:3,versionId:"ff5c45c8-dd0e-5d67-a0b3-d774502617ba"});
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});const tx=await pool.connect();
  try{
    await tx.query("BEGIN");await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[P.id]);
    const policy=(await tx.query("SELECT * FROM reference_provider_allowance WHERE id=$1 FOR UPDATE",[P.id])).rows[0];
    const before=(await tx.query("SELECT * FROM reference_provider_slots ORDER BY slot FOR UPDATE")).rows;
    if(policy?.config_digest!==oldDigest||before.length!==1||before.some(row=>String(row.gas_reserved)!==P.gasReservation))throw new Error("REVIEWED_ALLOWANCE_CHANGED");
    const versions=(await tx.query(`SELECT v.id,v.version FROM agent_versions v JOIN agents a ON a.id=v.agent_id JOIN erc8004_identities i ON i.id=a.identity_id
      WHERE i.chain_id=97 AND i.identity_registry=$1 AND i.agent_id=$2 ORDER BY v.version DESC LIMIT 1`,[P.registry,P.agentId])).rows[0];
    if(versions?.id!==P.versionId||versions?.version!==P.version)throw new Error("REFERENCE_VERSION_MISMATCH");
    await tx.query("UPDATE reference_provider_allowance SET config_digest=$2,healthy=false,reason='WORKER_RESTART_REQUIRED',heartbeat=NULL WHERE id=$1",[P.id,REFERENCE_ALLOWANCE_DIGEST]);
    const after=(await tx.query("SELECT * FROM reference_provider_slots ORDER BY slot")).rows;
    const slotsDigest=canonicalSha256Hex(JSON.parse(JSON.stringify(before)));
    if(slotsDigest!==canonicalSha256Hex(JSON.parse(JSON.stringify(after))))throw new Error("SLOT_MUTATION_DETECTED");
    await tx.query("COMMIT");
    const evidence={observedAt:new Date().toISOString(),backup,oldDigest,newDigest:REFERENCE_ALLOWANCE_DIGEST,slotsPreserved:before.length,slotsDigest,remaining:P.maxJobs-before.length,enabledUnchanged:policy.enabled,chainWrites:false};
    await writeFile(new URL(`../.runtime/mainnet-supply-upgrade/reference-endpoint-rotation-v${P.version}.json`,import.meta.url),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
  }catch(error){await tx.query("ROLLBACK");throw error;}finally{tx.release();await pool.end();}
}
main().catch((error:unknown)=>{console.error("REFERENCE_ROTATION_FAILED",error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:(error as {code?:string}).code??"LOCAL_OPERATION_FAILED",error instanceof Error?error.stack?.split("\n").filter(line=>line.includes("reference-endpoint-rotation.ts")):[]);process.exitCode=1;});
