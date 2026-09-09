/** Singleton bounded chain-97 worker. No buyer action and no admission recycling. */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createPublicClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { buildSubmitCall, erc8183Addresses, encodeErc8183Manifest, type submitErc8183Deliverable } from "@altananetwork/sdk";
import { REFERENCE_ALLOWANCE as P, REFERENCE_ALLOWANCE_DIGEST, createReferenceProviderWorkerComposition, CommerceError, Erc8183AltanaAdapter, referenceProviderPinFromStandardsLock } from "../packages/agent-commerce/src/index.ts";
import { runQuotedReferenceWorker } from "./t5-reference-quoted-worker.ts";

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,statement_timeout:10_000});
const rpc=createPublicClient({chain:bscTestnet,transport:http(process.env.BSC_TESTNET_RPC_URL,{timeout:10_000,retryCount:0})});
let stop=false,heartbeatBusy=false;
const safe=(error:unknown)=>error instanceof Error&&/^[A-Z_]{3,80}$/u.test(error.message)?error.message:"REFERENCE_SERVICE_CHECK_FAILED";
const log=(value:unknown)=>console.log(JSON.stringify({at:new Date().toISOString(),...value as object}));
const stored=process.env.WALLET2_PRIVATE_KEY??"";
const account=(()=>{try{return privateKeyToAccount((stored.startsWith("0x")?stored:`0x${stored}`) as Hex)}catch{throw new Error("PROVIDER_SECRET_UNAVAILABLE")}})();
let networkVerifier:Erc8183AltanaAdapter|undefined;
let networkVerifiedAt=0;

function assertConfiguration() {
  const expected:Record<string,string>={T5_REFERENCE_PROVIDER_AGENT_ID:P.agentId,T5_REFERENCE_PROVIDER_CHAIN_ID:"97",T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY:P.registry,
    T5_REFERENCE_PROVIDER_ADDRESS:P.provider,T5_REFERENCE_PROVIDER_COMMERCE_CONTRACT:P.commerce,T5_REFERENCE_PROVIDER_ROUTER_CONTRACT:P.router,T5_REFERENCE_PROVIDER_POLICY_CONTRACT:P.policy,
    T5_REFERENCE_PROVIDER_CARD_URL:P.card,T5_REFERENCE_PROVIDER_SERVICE_URL:P.service,T5_REFERENCE_PROVIDER_PRICE_ATOMIC:P.price,T5_REFERENCE_PROVIDER_MAX_BUDGET_ATOMIC:P.price};
  for(const[key,value]of Object.entries(expected))if(process.env[key]?.toLowerCase()!==value.toLowerCase())throw new Error("EXACT_CONFIGURATION_MISMATCH");
  if(account.address.toLowerCase()!==P.provider||process.env.BSC_CHAIN_ID!=="97"||process.env.T5_REFERENCE_SERVICE_ENABLED!=="true")throw new Error("SIGNER_OR_SERVICE_DISABLED");
}

async function healthCheck() {
  assertConfiguration();
  if(await rpc.getChainId()!==97)throw new Error("CHAIN_MISMATCH");
  if(!networkVerifier)throw new Error("STANDARDS_VERIFIER_UNAVAILABLE");
  if(Date.now()-networkVerifiedAt>30_000){await networkVerifier.verifyNetwork();networkVerifiedAt=Date.now()}
  const [balance,gasPrice]=await Promise.all([rpc.getBalance({address:account.address}),rpc.getGasPrice()]);
  if(balance<BigInt(P.gasBudget))throw new Error("PROVIDER_GAS_BALANCE_INSUFFICIENT");
  if(gasPrice>BigInt(P.gasPrice))throw new Error("GAS_PRICE_EXCEEDED");
  const listing=await pool.query(`SELECT a.current_version_id,i.id identity_id,i.owner_address,i.agent_wallet FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id
    WHERE i.namespace='eip155' AND i.chain_id=97 AND lower(i.identity_registry)=$1 AND i.agent_id=$2`,[P.registry,P.agentId]);
  const row=listing.rows[0];
  if(listing.rows.length!==1||row.current_version_id!==P.versionId||row.owner_address?.toLowerCase()!==P.owner||row.agent_wallet?.toLowerCase()!==P.provider)throw new Error("PUBLISHED_IDENTITY_MISMATCH");
  const probes=await pool.query(`SELECT validation_status,observed_at FROM agent_service_probe_results WHERE url=$1 AND identity_id=$2 AND kind='a2a' ORDER BY observed_at DESC,id DESC LIMIT 1`,[P.card,row.identity_id]);
  const probeAge=Date.now()-new Date(probes.rows[0]?.observed_at??0).getTime();
  if(probes.rows[0]?.validation_status!=="healthy"||probeAge<0||probeAge>120_000)throw new Error("PROVIDER_ENDPOINT_STALE");
  const foreign=await pool.query(`SELECT 1 FROM erc8183_jobs j LEFT JOIN reference_provider_slots s ON s.commerce_job_id=j.commerce_job_id
    WHERE j.chain_id=97 AND lower(j.commerce_contract)=$1 AND j.provider_binding->'identity'->>'agentId'=$2
      AND j.erc8183_job_id<>$3 AND s.slot IS NULL LIMIT 1`,[P.commerce,P.agentId,P.baselineJob]);
  if(foreign.rows.length)throw new Error("UNADMITTED_REFERENCE_JOB");
  const uncertain=await pool.query("SELECT 1 FROM reference_provider_slots WHERE state IN ('blocked','signing','unknown') LIMIT 1");
  if(uncertain.rows.length)throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
}

async function heartbeat() {
  if(heartbeatBusy)return;heartbeatBusy=true;
  try {
    let reason="READY",healthy=true;
    try{await healthCheck()}catch(error){reason=safe(error);healthy=false}
    await pool.query("UPDATE reference_provider_allowance SET healthy=$2,reason=$3,heartbeat=now(),worker_pid=$4 WHERE id=$1 AND config_digest=$5",[P.id,healthy,reason,process.pid,REFERENCE_ALLOWANCE_DIGEST]);
  }finally{heartbeatBusy=false}
}

/** SDK builds the exact calldata/manifest; the existing commerce service owns receipts/results.
 * This EOA transport replaces the unbounded relay only for this one authorized provider.
 * Persist the signed transaction's PUBLIC hash/nonce BEFORE broadcast. Never persist raw bytes.
 */
function boundedSubmit(commerceJobId:string,jobId:string):typeof submitErc8183Deliverable {
  return (async (...args:unknown[])=>{
    const authority=args[0] as {address?:string},params=args[2] as {jobId:bigint;manifest?:Parameters<typeof encodeErc8183Manifest>[0];deliverable?:Hex;deliverableUrl?:string;optParams?:Hex};
    if(authority.address?.toLowerCase()!==P.provider||params.jobId.toString()!==jobId||jobId===P.baselineJob)throw new Error("SUBMIT_SCOPE_MISMATCH");
    await healthCheck();
    const manifestText=params.manifest?encodeErc8183Manifest(params.manifest):undefined;
    const deliverable=manifestText?keccak256(toHex(manifestText)):params.deliverable;
    if(!deliverable)throw new Error("DELIVERABLE_REQUIRED");
    const call=buildSubmitCall({addresses:erc8183Addresses(97),jobId:params.jobId,deliverable,optParams:manifestText?toHex(JSON.stringify({deliverable_url:params.deliverableUrl??""})):params.optParams??"0x"});
    if(call.to.toLowerCase()!==P.commerce)throw new Error("SUBMIT_TARGET_MISMATCH");
    const gasPrice=await rpc.getGasPrice(),gasEstimate=await rpc.estimateGas({account,to:call.to,data:call.data,value:0n});
    if(gasPrice>BigInt(P.gasPrice)||gasEstimate*12n/10n>BigInt(P.gasLimit))throw new Error("SUBMIT_GAS_CAP_EXCEEDED");
    const claimed=await pool.query("UPDATE reference_provider_slots SET state='signing',updated_at=now() WHERE commerce_job_id=$1 AND state='claimed' AND transaction_hash IS NULL RETURNING slot",[commerceJobId]);
    if(claimed.rows.length!==1)throw new Error("SUBMIT_ALREADY_ATTEMPTED");
    const nonce=await rpc.getTransactionCount({address:account.address,blockTag:"pending"});
    const raw=await account.signTransaction({chainId:97,type:"legacy",nonce,to:call.to,data:call.data,value:0n,gas:BigInt(P.gasLimit),gasPrice});
    const hash=keccak256(raw);
    await pool.query("UPDATE reference_provider_slots SET transaction_hash=$2,nonce=$3,state='unknown',updated_at=now() WHERE commerce_job_id=$1 AND state='signing'",[commerceJobId,hash,nonce]);
    // Atomically move the existing SDK operation from its reserved signature state to
    // UNKNOWN with its recovery hash before send; no later caller can dispatch it again.
    const operation=await pool.query(`UPDATE erc8183_operations SET transaction_hash=$3,status='unknown',failure_code='BOUNDED_DISPATCH_IN_FLIGHT',updated_at_unix=extract(epoch from now())::bigint WHERE chain_id=97 AND lower(commerce_contract)=$1 AND erc8183_job_id=$2 AND operation_kind='submit' AND status='awaiting_signature' AND transaction_hash IS NULL RETURNING id`,[P.commerce,jobId,hash]);
    if(operation.rows.length!==1)throw new Error("EXACT_SUBMIT_OPERATION_REQUIRED");
    try {
      if(await rpc.getChainId()!==97)throw new Error("CHAIN_CHANGED_BEFORE_SEND");
      const returned=await rpc.sendRawTransaction({serializedTransaction:raw});
      if(returned.toLowerCase()!==hash.toLowerCase())throw new Error("TRANSACTION_HASH_MISMATCH");
      const receipt=await rpc.waitForTransactionReceipt({hash,timeout:25_000});
      await recordReceipt(commerceJobId,hash,receipt);
      log({event:"provider_submission",commerceJobId,jobId,transactionHash:hash,gasUsed:receipt.gasUsed.toString(),gasPrice:receipt.effectiveGasPrice.toString()});
      return {callsId:hash,transactionHash:hash,status:receipt.status==="success"?"CONFIRMED":"FAILED",jobId:params.jobId,deliverable,...(manifestText?{manifestText}:{})};
    }catch {
      throw new CommerceError({code:"TRANSACTION_UNKNOWN",message:"The bounded submission has a durable hash; reconcile it without rebroadcasting.",transactionHash:hash,nextAction:"reconcile_transaction"});
    }
  }) as typeof submitErc8183Deliverable;
}

async function recordReceipt(commerceJobId:string,hash:Hex,receipt:{gasUsed:bigint;effectiveGasPrice:bigint;status:string}) {
  await pool.query("UPDATE reference_provider_slots SET state=$3,gas_spent=$4,updated_at=now() WHERE commerce_job_id=$1 AND transaction_hash=$2",[commerceJobId,hash,receipt.status==="success"?"submitted":"blocked",(receipt.gasUsed*receipt.effectiveGasPrice).toString()]);
}

async function tick() {
  // Reconcile hashes before claiming anything. Missing receipts never authorize a retry.
  const pending=await pool.query("SELECT s.*,j.erc8183_job_id FROM reference_provider_slots s JOIN erc8183_jobs j ON j.commerce_job_id=s.commerce_job_id WHERE s.state IN ('unknown','signing','claimed','submitted') ORDER BY s.slot");
  for(const row of pending.rows) {
    if(row.state==="signing")throw new Error("SIGNING_OUTCOME_REQUIRES_REVIEW");
    if(row.transaction_hash) {
      const receipt=await rpc.getTransactionReceipt({hash:row.transaction_hash}).catch(()=>null);
      if(!receipt)throw new Error("SUBMISSION_PENDING_NO_REBROADCAST");
      await recordReceipt(row.commerce_job_id,row.transaction_hash,receipt);
      if(receipt.status!=="success")throw new Error("SUBMISSION_REVERTED");
    }
    const result=await runQuotedReferenceWorker({compose:input=>createReferenceProviderWorkerComposition({...input,sdk:{submit:boundedSubmit(row.commerce_job_id,row.erc8183_job_id)}})},{...process.env,T5_REFERENCE_PROVIDER_JOB_ID:row.erc8183_job_id});
    if(result&&["submitted","replayed","reconciled"].includes(result.status))await pool.query("UPDATE reference_provider_slots SET state='reconciled',updated_at=now() WHERE commerce_job_id=$1 AND transaction_hash IS NOT NULL",[row.commerce_job_id]);
    else if(result&&["manual_review","reverted"].includes(result.status))await pool.query("UPDATE reference_provider_slots SET state='blocked',updated_at=now() WHERE commerce_job_id=$1",[row.commerce_job_id]);
    else if(result?.status==="pending")await pool.query("UPDATE reference_provider_slots SET state='unknown',updated_at=now() WHERE commerce_job_id=$1",[row.commerce_job_id]);
    return;
  }
  await healthCheck();
  const candidate=await pool.query(`UPDATE reference_provider_slots SET state='claimed',updated_at=now() WHERE slot=(
    SELECT s.slot FROM reference_provider_slots s JOIN erc8183_jobs j ON j.commerce_job_id=s.commerce_job_id
    WHERE s.state='reserved' AND j.state='funded' AND j.chain_id=97 AND lower(j.commerce_contract)=$1
      AND j.erc8183_job_id<>$2 AND j.provider_binding->>'agentVersionId'=$3 AND lower(j.provider_address)=$4 AND j.budget_atomic=$5 AND lower(j.payment_token)=$6
    ORDER BY s.slot LIMIT 1 FOR UPDATE OF s SKIP LOCKED) RETURNING commerce_job_id`,[P.commerce,P.baselineJob,P.versionId,P.provider,P.price,P.token]);
  if(candidate.rows.length)log({event:"funded_job_claimed",commerceJobId:candidate.rows[0].commerce_job_id});
}

async function main() {
  assertConfiguration();
  // Lock lifetime equals process lifetime. No TTL stealing of a signing worker.
  const lock=await pool.connect();lock.on("error",()=>process.exit(1));
  if(!(await lock.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked",[`${P.id}:worker`])).rows[0].locked)throw new Error("WORKER_ALREADY_RUNNING");
  const standards=JSON.parse(await readFile(new URL("../config/standards.lock.json",import.meta.url),"utf8"));
  if(standards===null)throw new Error("STANDARDS_UNAVAILABLE");
  networkVerifier=new Erc8183AltanaAdapter({pin:referenceProviderPinFromStandardsLock(standards),standardsLock:standards,developmentCanaryEnabled:true,runtimeEnvironment:"preview"});
  await pool.query("INSERT INTO reference_provider_allowance(id,config_digest) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",[P.id,REFERENCE_ALLOWANCE_DIGEST]);
  const policy=(await pool.query("SELECT config_digest FROM reference_provider_allowance WHERE id=$1",[P.id])).rows[0];
  if(policy.config_digest!==REFERENCE_ALLOWANCE_DIGEST)throw new Error("ALLOWANCE_CONFIG_CHANGED");
  await heartbeat();log({event:"service_started",pid:process.pid,allowance:P.id,maxJobs:P.maxJobs,gasBudgetWei:P.gasBudget});
  const timer=setInterval(()=>void heartbeat().catch(()=>process.exit(1)),5_000);
  process.on("SIGTERM",()=>{stop=true});process.on("SIGINT",()=>{stop=true});
  while(!stop){try{await tick()}catch(error){log({event:"worker_backoff",reason:safe(error)})}await new Promise(resolve=>setTimeout(resolve,5_000));}
  clearInterval(timer);await pool.query("UPDATE reference_provider_allowance SET healthy=false,reason='WORKER_STOPPED',heartbeat=now() WHERE id=$1",[P.id]);
  lock.release();await pool.end();
}
main().catch(error=>{log({event:"service_failed",reason:safe(error)});process.exit(1)});
