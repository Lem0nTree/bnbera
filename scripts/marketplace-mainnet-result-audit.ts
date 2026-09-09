/** Resolve historical provider submissions by their finalized job timestamp;
 * public RPCs can serve blocks/receipts even without a historical log index. */
import {readFile,writeFile,rename} from "node:fs/promises";
import {createPublicClient,http,parseAbiItem,decodeEventLog,hexToString,keccak256,toBytes} from "viem";
import {canonicalSellerJson,externalSellerManifestSchema} from "../packages/agent-commerce/src/external-seller.ts";
import {createExternalSellerTransport} from "../apps/web/src/lib/external-seller-transport.ts";
import {ERC8183_COMMERCE_EVENTS_ABI} from "../packages/agent-commerce/src/chain.ts";
import {assertPublicPayloadSafe} from "../packages/agent-commerce/src/validation.ts";
import {selectPendingEvidence} from "./mainnet-audit-selection.ts";
const dir=new URL("../.runtime/mainnet-supply-upgrade/",import.meta.url);
type HistoricalAuditJob={id:string;agentId:string|null;agentIds?:string[];provider:string;submittedAt:string;description:string;deliverable:string;status:number};
async function main(){
  if(process.env.MAINNET_RESULT_AUDIT_ENABLED!=="true")return;
  const history=process.env.MAINNET_RESULT_HISTORY_MODE==="true";
  const expanded=process.env.MAINNET_RESULT_HISTORY_V2==="true";
  const source=JSON.parse(await readFile(new URL(expanded?"provider-history-v2.json":history?"provider-history.json":"job-audit.json",dir),"utf8"));
  const audit=history||expanded?{...source,found:expanded
    ? Array.from({length:20},(_,i)=>source.providers.flatMap((p:{agentIds:string[];jobs:Record<string,unknown>[]})=>p.jobs[i]?[{...p.jobs[i],agentId:p.agentIds[0]??null,agentIds:p.agentIds}]:[])).flat()
    : source.providers.filter((p:{agentIds:string[]})=>p.agentIds.length).map((p:{agentIds:string[];jobs:Record<string,unknown>[]})=>({...p.jobs[0],agentId:p.agentIds[0]}))}:source;
  const offers=JSON.parse(await readFile(new URL("adapter-audit.json",dir),"utf8"));
  const deployment=JSON.parse(await readFile(new URL("apex-chain56-readonly-audit.json",dir),"utf8"));
  const jobs=audit.found.filter((x:{status:number;agentId:string},i:number,a:{status:number;agentId:string}[])=>[2,3].includes(x.status)&&(expanded||a.findIndex(y=>y.agentId===x.agentId&&[2,3].includes(y.status))===i));
  const client=createPublicClient({transport:http(process.env.BSC_MAINNET_RPC_URL,{timeout:15000,retryCount:1})});
  if(await client.getChainId()!==56)throw new Error("CHAIN_MISMATCH");
  const cache=new Map<string,bigint>();const results:unknown[]=[];
  const outputName=expanded?"provider-result-audit-v2.json":history?"provider-result-audit.json":"result-audit.json";
  if(expanded){try{results.push(...JSON.parse(await readFile(new URL(outputName,dir),"utf8")).results)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
  if(expanded&&process.env.MAINNET_RESULT_RETRY_TRANSIENT==="true")for(let index=results.length-1;index>=0;index--)if(["RPC_UNAVAILABLE","SUBMISSION_RECEIPT_UNAVAILABLE"].includes((results[index] as {status:string}).status))results.splice(index,1);
  // Apply the run cap after excluding previous observations, so older/newly
  // discovered providers cannot starve behind an already-reviewed prefix.
  const pending=selectPendingEvidence<HistoricalAuditJob>(jobs,expanded?results.map(row=>(row as {jobId:string}).jobId):[],250);
  const initialised=parseAbiItem("event JobInitialised(uint256 indexed jobId,bytes32 deliverable,uint64 submittedAt,bytes optParams)");
  for(const job of pending){
    let stage="timestamp-search";
    const offer=offers.find((x:{agentId:string})=>x.agentId===job.agentId)??{binding:{commerceContract:deployment.addresses.commerceProxy,routerContract:deployment.addresses.routerProxy,policyContract:deployment.addresses.policy}};const target=BigInt(job.submittedAt);
    try{
      let low=1n,high=BigInt(audit.blockNumber);
      while(low<high){const mid=(low+high)/2n;let timestamp=cache.get(mid.toString());if(timestamp===undefined){timestamp=(await client.getBlock({blockNumber:mid})).timestamp;cache.set(mid.toString(),timestamp)}if(timestamp<target)low=mid+1n;else high=mid;}
      let found=false;
      for(let n=low;n<low+10n;n++){
        stage="submission-receipts";
        const block=await client.getBlock({blockNumber:n,includeTransactions:true});if(block.timestamp>target+1n)break;
        const receipts=expanded?await client.getBlockReceipts({blockNumber:n}):await Promise.all(block.transactions.filter(tx=>tx.from.toLowerCase()===job.provider.toLowerCase()).map(tx=>client.getTransactionReceipt({hash:tx.hash})));
        for(const receipt of receipts){
          if(receipt.status!=="success")continue;
          const submissions=receipt.logs.filter(log=>log.address.toLowerCase()===offer.binding.commerceContract.toLowerCase()).flatMap(log=>{try{const event=decodeEventLog({abi:ERC8183_COMMERCE_EVENTS_ABI,data:log.data,topics:log.topics});return event.eventName==="JobSubmitted"&&event.args.jobId.toString()===job.id&&event.args.provider.toLowerCase()===job.provider.toLowerCase()&&event.args.deliverable===job.deliverable?[event]:[]}catch{return []}});
          if(submissions.length!==1)continue;
          const tx={hash:receipt.transactionHash};
          const events=receipt.logs.filter(log=>log.address.toLowerCase()===offer.binding.policyContract.toLowerCase()).flatMap(log=>{try{const e=decodeEventLog({abi:[initialised],data:log.data,topics:log.topics});return e.args.jobId.toString()===job.id&&e.args.deliverable===job.deliverable?[e.args]:[]}catch{return []}});
          if(events.length!==1)continue;
          stage="policy-pointer-decode";
          const pointer=JSON.parse(hexToString(events[0]!.optParams)).deliverable_url;let resultStatus="POINTER_FOUND",content:string|null=null;
          try{let raw=typeof pointer==="string"&&pointer.startsWith("data:application/json;base64,")?JSON.parse(Buffer.from(pointer.slice(29),"base64").toString("utf8")):(await createExternalSellerTransport().get(pointer)).body;
            if(raw&&typeof raw==="object"&&"success" in raw){const{success,...manifest}=raw;if(success!==true)throw new Error("RESULT_NOT_SUCCESSFUL");raw=manifest;}
            const projection=raw as Record<string,unknown>;
            if(projection.chain_id===undefined&&projection.contracts===undefined&&projection.tx_hash===tx.hash&&projection.deliverable_url===pointer){const{tx_hash:_tx,deliverable_url:_url,...manifest}=projection;void _tx;void _url;raw={...manifest,chain_id:56,contracts:{commerce:offer.binding.commerceContract,router:offer.binding.routerContract,policy:offer.binding.policyContract}};}
            const m=externalSellerManifestSchema.parse(raw);assertPublicPayloadSafe(m);if(m.job_id.toString()===job.id&&m.chain_id===56&&m.contracts.commerce.toLowerCase()===offer.binding.commerceContract.toLowerCase()&&m.contracts.router.toLowerCase()===offer.binding.routerContract.toLowerCase()&&m.contracts.policy.toLowerCase()===offer.binding.policyContract.toLowerCase()&&keccak256(toBytes(canonicalSellerJson(m)))===job.deliverable){resultStatus="HASH_VERIFIED_MANIFEST";content=m.response.content}else resultStatus="MANIFEST_MISMATCH"}catch{resultStatus="MANIFEST_UNAVAILABLE"}
          results.push({agentId:job.agentId,agentIds:job.agentIds,candidateIdentityAttribution:"provider-wallet-only",providerAddress:job.provider,jobDescription:job.description,jobId:job.id,state:job.status,blockNumber:n.toString(),transactionHash:tx.hash,deliverable:job.deliverable,pointer,resultStatus,content});found=true;
        }
      }
      if(!found)results.push({agentId:job.agentId,jobId:job.id,status:"SUBMISSION_RECEIPT_UNAVAILABLE",approximateBlock:low.toString()});
    }catch(error){results.push({agentId:job.agentId,jobId:job.id,status:stage==="policy-pointer-decode"?"POLICY_POINTER_INVALID":"RPC_UNAVAILABLE",stage,errorName:error instanceof Error?error.name:"unknown"});}
    const temporary=new URL(`${outputName}.next`,dir);
    await writeFile(temporary,JSON.stringify({observedAt:new Date().toISOString(),results,chainWrites:false},null,2),{mode:0o600});await rename(temporary,new URL(outputName,dir));console.log(JSON.stringify({agentId:job.agentId,resultCount:results.length,lastStatus:(results.at(-1) as {resultStatus?:string;status?:string})?.resultStatus??(results.at(-1) as {status?:string})?.status}));
  }
}
main().catch((error:unknown)=>{console.error("MAINNET_RESULT_AUDIT_FAILED",error instanceof SyntaxError?"AUDIT_FILE_BEING_UPDATED":error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"READ_FAILED");process.exitCode=1;});
