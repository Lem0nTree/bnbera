/** Disposable-only concurrency/restart acceptance. Never mutates retained DB. */
import assert from "node:assert/strict";
import pg from "pg";
import { REFERENCE_ALLOWANCE as P,REFERENCE_ALLOWANCE_DIGEST,readReferenceCapacity,reserveReferenceCapacity } from "../packages/agent-commerce/src/reference-admission.ts";
const url=new URL(process.env.DATABASE_URL??"");url.pathname="/bnbera_reference_allowance_disposable";
const pool=new pg.Pool({connectionString:url.href,max:5});
try {
  assert.equal((await pool.query("select current_database() name")).rows[0].name,"bnbera_reference_allowance_disposable");
  await pool.query("insert into reference_provider_allowance(id,config_digest,enabled,healthy,heartbeat) values($1,$2,true,true,now()) on conflict(id) do update set enabled=true,healthy=true,heartbeat=now()",[P.id,REFERENCE_ALLOWANCE_DIGEST]);
  const ids=(await pool.query('select id from commerce_jobs order by "createdAt" limit 4')).rows.map(row=>row.id);
  const results=await Promise.all(ids.map(async quoteId=>{const client=await pool.connect();try{await client.query("BEGIN");await reserveReferenceCapacity(client,{quoteId,identity:{namespace:"eip155",chainId:97,identityRegistry:P.registry,agentId:P.agentId},chainId:97,agentVersionId:P.versionId,agentVersion:2,providerAddress:P.provider,commerceContract:P.commerce,paymentToken:P.token,paymentDecimals:18,priceAtomic:P.price,service:{url:P.card}});await client.query("COMMIT");return"admitted"}catch{await client.query("ROLLBACK");return"denied"}finally{client.release()}}));
  assert.equal(results.filter(r=>r==="admitted").length,3);assert.equal(results.filter(r=>r==="denied").length,1);
  assert.deepEqual((await readReferenceCapacity(pool)).remaining,0);
  await assert.rejects(pool.query("insert into reference_provider_slots(slot,commerce_job_id,gas_reserved) values(4,$1,$2)",[ids[3],P.gasReservation]));
  const reopened=new pg.Pool({connectionString:url.href});
  assert.equal((await readReferenceCapacity(reopened)).remaining,0);await reopened.end();
  console.log(JSON.stringify({disposableOnly:true,concurrentAdmissions:3,denied:1,sqlFourthSlotDenied:true,restartCapacity:0,gasReservationWei:P.gasBudget}));
}finally{await pool.end()}
