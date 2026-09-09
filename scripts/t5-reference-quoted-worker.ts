/** One explicitly selected, funded testnet job. Immutable quote is the only task source. */
import pg from "pg";
import { canonicalSha256Hex } from "../packages/domain/src/index.ts";
import { parseReferenceBuyerTask } from "../packages/agent-commerce/src/reference-task.ts";
import { runReferenceProviderWorker, sanitizeReferenceProviderRun } from "./t5-reference-provider-worker.ts";
import { fileURLToPath } from "node:url";
import type { ReferenceProviderWorkerDependencies } from "./t5-reference-provider-worker.ts";

export async function runQuotedReferenceWorker(dependencies?: ReferenceProviderWorkerDependencies, env=process.env) {
  if (process.env.T5_REFERENCE_PROVIDER_WORKER_ENABLED !== "true") { console.log(JSON.stringify({status:"disabled"})); return; }
  const jobId=env.T5_REFERENCE_PROVIDER_JOB_ID;
  if(!jobId || !/^[1-9][0-9]*$/u.test(jobId)) throw new Error("EXACT_JOB_REQUIRED");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  try {
    const rows=(await pool.query(`select j.*,c.quote,c.task_input_digest,c.price from erc8183_jobs j join commerce_jobs c on c.id=j.commerce_job_id
      where j.chain_id=97 and j.erc8183_job_id=$1 and lower(j.commerce_contract)=lower($2)`,[jobId,process.env.T5_REFERENCE_PROVIDER_COMMERCE_CONTRACT])).rows;
    if(rows.length!==1)throw new Error("EXACT_JOB_REQUIRED");
    const row=rows[0],quote=row.quote;
    if(!["funded","submitted","completed"].includes(row.state)||row.provider_binding.identity.agentId!==process.env.T5_REFERENCE_PROVIDER_AGENT_ID||
      row.provider_binding.identity.identityRegistry.toLowerCase()!==process.env.T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY?.toLowerCase()||
      row.provider_address.toLowerCase()!==process.env.T5_REFERENCE_PROVIDER_ADDRESS?.toLowerCase()||row.budget_atomic!=="1000000000000000"||row.price!==row.budget_atomic||
      quote.taskDigest!==canonicalSha256Hex(quote.task)||row.description_digest!==quote.taskDigest||row.task_input_digest!==quote.taskDigest)throw new Error("IMMUTABLE_JOB_BINDING_MISMATCH");
    const buyerTask=parseReferenceBuyerTask(quote.task);
    const taskInput={account:row.client_address,chainId:97,protocol:"buyer-attested lending snapshot",requestedAtUnix:Math.floor(Date.parse(quote.issuedAt)/1000),lendingSnapshot:{
      collateralValueUsd:buyerTask.collateralValueUsd,debtValueUsd:buyerTask.debtValueUsd,liquidationThresholdBps:buyerTask.liquidationThresholdBps,
      observedAtUnix:buyerTask.observedAtUnix,sourceKind:"caller_attested",sourceReference:`buyer-quote:${row.commerce_job_id}:${quote.taskDigest}`
    }};
    const result=await runReferenceProviderWorker({env:{...env,T5_REFERENCE_PROVIDER_TASK_INPUT_JSON:JSON.stringify(taskInput)},...(dependencies?{dependencies}:{})});
    console.log(JSON.stringify({...sanitizeReferenceProviderRun(result),inputSource:"immutable-buyer-quote",commerceJobId:row.commerce_job_id,jobId}));
    return result;
  }finally{await pool.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))runQuotedReferenceWorker().catch(error=>{console.error(JSON.stringify({status:"blocked",code:/^[A-Z_]{3,80}$/u.test(error?.message)?error.message:error?.code??"QUOTED_PROVIDER_FAILED"}));process.exitCode=1;});
