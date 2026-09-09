/** Back up retained data and validate forward migration/delivery claims on an
 * explicitly disposable restore. Does not migrate or mutate retained rows. */
import { spawnSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrateDb } from "../packages/db/src/client.ts";
import { PostgresExternalDeliveryStore } from "../packages/agent-commerce/src/external-delivery.ts";
async function main() {
  if (process.env.EXTERNAL_SELLER_DB_CHECK_ENABLED !== "true") return;
  const databaseUrl = process.env.DATABASE_URL!; const url = new URL(databaseUrl);
  const backup = new URL("../.runtime/mainnet-supply-upgrade/before-external-delivery.dump", import.meta.url).pathname;
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/bnbera_erc8004") throw new Error("UNEXPECTED_RETAINED_DATABASE");
  // Match the retained PostgreSQL16 server tools; the host pg_dump18 emits
  // restore settings unsupported by PostgreSQL16.
  const output = openSync(backup,"w",0o600);
  const dump = spawnSync("sudo", ["docker","exec","bnbera_erc8004_pgvector","pg_dump","-U",decodeURIComponent(url.username),"-d",url.pathname.slice(1),"--format=custom"], { stdio: ["ignore",output,"ignore"] });
  closeSync(output);
  if (dump.status !== 0) throw new Error("BACKUP_FAILED"); await chmod(backup, 0o600);
  const retained = new pg.Pool({connectionString:databaseUrl});
  const database = `bnbera_external_check_${randomUUID().replaceAll("-","")}`;
  await retained.query(`CREATE DATABASE ${database}`); await retained.end();
  const inputFile = openSync(backup,"r");
  const restored = spawnSync("sudo", ["docker","exec","-i","bnbera_erc8004_pgvector","pg_restore","-U",decodeURIComponent(url.username),"--no-owner","--exit-on-error","--dbname",database],{stdio:[inputFile,"ignore","ignore"]}); closeSync(inputFile);
  if (restored.status !== 0) throw new Error("RESTORE_FAILED");
  url.pathname = `/${database}`;
  await migrateDb(url.toString()); await migrateDb(url.toString());
  let pool = new pg.Pool({connectionString:url.toString()});
  const found = await pool.query<{id:string;buyer_user_id:string}>("SELECT id,buyer_user_id FROM commerce_jobs WHERE buyer_user_id IS NOT NULL LIMIT 1");
  const row=found.rows[0]; if (!row) throw new Error("RESTORED_JOB_MISSING");
  const input={commerceJobId:row.id,buyerUserId:row.buyer_user_id,protocolJobId:"56758",quoteDigest:"ab".repeat(32)};
  const claims=await Promise.all(Array.from({length:4},()=>new PostgresExternalDeliveryStore(pool).claim(input)));
  if(claims.filter(x=>x.claimed).length!==1) throw new Error("DUPLICATE_CLAIM");
  await new PostgresExternalDeliveryStore(pool).finish({...input,status:"unknown",responseDigest:null});
  await pool.end(); pool=new pg.Pool({connectionString:url.toString()});
  const recovered=await new PostgresExternalDeliveryStore(pool).claim(input);
  if(recovered.claimed||recovered.state.status!=="unknown") throw new Error("RECOVERY_FAILED");
  let conflict=false;try{await new PostgresExternalDeliveryStore(pool).claim({...input,quoteDigest:"cd".repeat(32)})}catch{conflict=true}
  if(!conflict) throw new Error("IMMUTABLE_BINDING_FAILED");
  const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='external_seller_deliveries'");
  await pool.end();
  const evidence={observedAt:new Date().toISOString(),backup,disposableDatabase:database,migrationRestart:true,concurrentClaims:claims.length,claimed:1,recoveredStatus:recovered.state.status,immutableConflictRejected:true,columns:columns.rows.map(x=>x.column_name),retainedMutation:false};
  await writeFile(new URL("../.runtime/mainnet-supply-upgrade/delivery-db-check.json",import.meta.url),JSON.stringify(evidence,null,2),{mode:0o600}); console.log(JSON.stringify(evidence));
}
main().catch((error: unknown)=>{const e=error as {message?:string;code?:string};console.error("EXTERNAL_SELLER_DB_CHECK_FAILED",e.message&&/^[A-Z_]+$/u.test(e.message)?e.message:e.code??"DATABASE_OPERATION_FAILED");process.exitCode=1;});
