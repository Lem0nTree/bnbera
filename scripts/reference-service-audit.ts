/** Read-only evidence for the authorized bounded allowance; no signing imports. */
import pg from "pg";
import { createPublicClient,http,formatEther,parseAbi } from "viem";
import { bscTestnet } from "viem/chains";
import { REFERENCE_ALLOWANCE as P,readReferenceCapacity } from "../packages/agent-commerce/src/reference-admission.ts";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const rpc=createPublicClient({chain:bscTestnet,transport:http(process.env.BSC_TESTNET_RPC_URL,{timeout:10_000,retryCount:0})});
try {
  if(await rpc.getChainId()!==97)throw new Error("CHAIN_MISMATCH");
  const slots=(await pool.query(`SELECT s.*,j.erc8183_job_id,j.state job_state,j.buyer_approval_address,j.buyer_approval_result_digest,j.buyer_approved_at,j.expires_at
    FROM reference_provider_slots s LEFT JOIN erc8183_jobs j ON j.commerce_job_id=s.commerce_job_id ORDER BY s.slot`)).rows;
  const operations=(await pool.query(`SELECT o.id,o.erc8183_job_id,o.operation_kind,o.status,o.transaction_hash,o.operation_context->'parameters'->>'eoaStep' step
    FROM erc8183_operations o JOIN erc8183_jobs j ON j.chain_id=o.chain_id AND j.commerce_contract=o.commerce_contract AND j.erc8183_job_id=o.erc8183_job_id
    JOIN reference_provider_slots s ON s.commerce_job_id=j.commerce_job_id ORDER BY o.created_at_unix`)).rows;
  const receipts=[];let cost=0n;
  for(const hash of [...new Set(operations.map(row=>row.transaction_hash).filter(Boolean))]) {
    const r=await rpc.getTransactionReceipt({hash});const fee=r.gasUsed*r.effectiveGasPrice;cost+=fee;
    receipts.push({hash,status:r.status,block:r.blockNumber.toString(),gas:r.gasUsed.toString(),gasPrice:r.effectiveGasPrice.toString(),nativeCost:formatEther(fee)});
  }
  const abi=parseAbi(["function balanceOf(address) view returns(uint256)","function allowance(address,address) view returns(uint256)"]);
  const balances={buyer:{native:formatEther(await rpc.getBalance({address:P.owner})),tokenAtomic:(await rpc.readContract({address:P.token,abi,functionName:"balanceOf",args:[P.owner]})).toString()},provider:{native:formatEther(await rpc.getBalance({address:P.provider})),tokenAtomic:(await rpc.readContract({address:P.token,abi,functionName:"balanceOf",args:[P.provider]})).toString()}};
  const counts=(await pool.query(`SELECT (SELECT count(*) FROM agents) agents,(SELECT count(*) FROM agent_versions) versions,
    (SELECT count(*) FROM commerce_jobs) commerce_jobs,(SELECT count(*) FROM erc8183_jobs) protocol_jobs,
    (SELECT count(*) FROM agent_enrichment_observations WHERE observation_type='registered_directory_v1') directory_observations,
    (SELECT count(*) FROM agent_enrichment_observations WHERE provider='bnbera-protocol-verifier') protocol_observations,
    (SELECT count(*) FROM commerce_job_reviews r JOIN reference_provider_slots s ON s.commerce_job_id=r.commerce_job_id) allowance_reviews`)).rows[0];
  console.log(JSON.stringify({at:new Date().toISOString(),chainId:97,capacity:await readReferenceCapacity(pool),slots,operations,receipts,totalNativeGas:formatEther(cost),balances,
    remainingAllowanceAtomic:(await rpc.readContract({address:P.token,abi,functionName:"allowance",args:[P.owner,P.commerce]})).toString(),counts},null,2));
}finally{await pool.end()}
