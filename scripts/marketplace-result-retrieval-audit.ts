/** Repeat safe public reads of already proven receipt pointers. No chain action. */
import {readFile,writeFile} from "node:fs/promises";
import {keccak256,toBytes} from "viem";
import {canonicalSellerJson,externalSellerManifestSchema} from "../packages/agent-commerce/src/external-seller.ts";
import {createExternalSellerTransport} from "../apps/web/src/lib/external-seller-transport.ts";
const dir=new URL("../.runtime/mainnet-supply-upgrade/",import.meta.url);
async function main(){
  if(process.env.MAINNET_RESULT_RETRIEVAL_AUDIT_ENABLED!=="true")return;
  const prior=JSON.parse(await readFile(new URL(process.env.MAINNET_RESULT_HISTORY_V2==="true"?"provider-result-audit-v2.json":"provider-result-audit.json",dir),"utf8"));
  const pin=JSON.parse(await readFile(new URL("apex-chain56-readonly-audit.json",dir),"utf8")).addresses;
  const results:unknown[]=[];
  const selectedIds=process.env.MAINNET_RESULT_RETRIEVAL_JOB_IDS?.split(",");
  if(selectedIds&&(selectedIds.length>250||selectedIds.some(id=>!/^\d+$/u.test(id))))throw new Error("INVALID_JOB_SET");
  for(const row of prior.results.filter((r:{pointer?:string;jobId:string})=>r.pointer&&(!selectedIds||selectedIds.includes(r.jobId)))){
    const attempts:unknown[]=[];
    for(let i=0;i<2;i++){
      try{
        let raw=(await createExternalSellerTransport().get(row.pointer)).body as Record<string,unknown>;
        if(raw.success!==undefined){const{success,...manifest}=raw;if(success!==true)throw new Error("RESULT_NOT_SUCCESSFUL");raw=manifest;}
        if(raw.chain_id===undefined&&raw.contracts===undefined&&raw.tx_hash===row.transactionHash&&raw.deliverable_url===row.pointer){const{tx_hash:_tx,deliverable_url:_url,...projected}=raw;void _tx;void _url;raw={...projected,chain_id:56,contracts:{commerce:pin.commerceProxy,router:pin.routerProxy,policy:pin.policy}};}
        const manifest=externalSellerManifestSchema.parse(raw);
        if(manifest.job_id.toString()!==row.jobId||manifest.chain_id!==56||manifest.contracts.commerce.toLowerCase()!==pin.commerceProxy.toLowerCase()||manifest.contracts.router.toLowerCase()!==pin.routerProxy.toLowerCase()||manifest.contracts.policy.toLowerCase()!==pin.policy.toLowerCase()||keccak256(toBytes(canonicalSellerJson(manifest)))!==row.deliverable)throw new Error("HASH_MISMATCH");
        attempts.push({checkedAt:new Date().toISOString(),status:"HASH_VERIFIED_MANIFEST",contentLength:manifest.response.content.length});break;
      }catch(error){attempts.push({checkedAt:new Date().toISOString(),status:"UNAVAILABLE",reason:(error as {code?:string}).code??"MANIFEST_READ_OR_VALIDATION_FAILED"});}
    }
    results.push({candidateAgentId:row.agentId,candidateIdentityAttribution:"provider-wallet-only",providerAddress:row.providerAddress,jobId:row.jobId,transactionHash:row.transactionHash,pointer:row.pointer,deliverable:row.deliverable,attempts});
    console.log(JSON.stringify({candidateAgentId:row.agentId,status:(attempts.at(-1) as {status:string}).status}));
  }
  const audit={observedAt:new Date().toISOString(),results,chainWrites:false};
  const file=new URL(`result-retrieval-audit-${Date.now()}.json`,dir);await writeFile(file,JSON.stringify(audit,null,2),{mode:0o600});console.log(JSON.stringify({evidence:file.pathname,verified:results.filter(r=>(r as {attempts:{status:string}[]}).attempts.some(a=>a.status==="HASH_VERIFIED_MANIFEST")).length}));
}
main().catch(()=>{console.error("RESULT_RETRIEVAL_AUDIT_FAILED");process.exitCode=1;});
