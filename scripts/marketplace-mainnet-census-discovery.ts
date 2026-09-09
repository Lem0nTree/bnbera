/** Independent census is an untrusted discovery lead only. Every identity and
 * wallet is re-read from the official finalized chain56 registry. No invocation. */
import {readFile,writeFile,rename} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createPublicClient,http,parseAbi} from "viem";
import {bsc} from "viem/chains";
import {publicRecord,publicText,publicHttpsUrl} from "../packages/agent-ingestion/src/directory.ts";
const dir=new URL("../.runtime/mainnet-supply-upgrade/",import.meta.url);
async function main(){
  if(process.env.MAINNET_CENSUS_DISCOVERY_ENABLED!=="true")return;
  const sourceUrl="https://brainonbnb.com/api-agents.json";
  const response=await fetch(sourceUrl,{redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.headers.get("content-type")?.includes("application/json")||!response.body)throw new Error("CENSUS_SOURCE_UNAVAILABLE");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>8*1024*1024)throw new Error("CENSUS_SOURCE_TOO_LARGE");chunks.push(next.value);}}finally{await reader.cancel();}
  const body=Buffer.concat(chunks);const source=publicRecord(JSON.parse(body.toString("utf8")));
  if(!Array.isArray(source.agents)||source.agents.length>2000)throw new Error("CENSUS_SOURCE_INVALID");
  const candidates=source.agents.flatMap(item=>{
    const row=publicRecord(item);const agentId=String(row.id);
    if(!/^\d{1,20}$/u.test(agentId)||BigInt(agentId)===0n)return [];
    return [{agentId,name:publicText(row.name,160),card:publicHttpsUrl(row.agent_card),services:Array.isArray(row.declared_services)?row.declared_services.slice(0,32).flatMap(item=>{const service=publicRecord(item);const url=publicHttpsUrl(service.endpoint);return url?[{name:publicText(service.name,64),url}]:[]}):[],negotiationAdvertised:/negotiate|ERC.?8183 quote/iu.test(JSON.stringify(row.skills)),hireable:false}];
  });
  const client=createPublicClient({chain:bsc,transport:http(process.env.BSC_MAINNET_RPC_URL,{timeout:15000,retryCount:1})});
  if(await client.getChainId()!==56)throw new Error("CHAIN_MISMATCH");
  const address="0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;
  const abi=parseAbi(["function getAgentWallet(uint256) view returns(address)","function ownerOf(uint256) view returns(address)"]);
  const history=JSON.parse(await readFile(new URL("provider-history-v2.json",dir),"utf8"));
  const results:Record<string,unknown>[]=[];
  for(let offset=0;offset<candidates.length;offset+=20){
    const block=await client.getBlock({blockTag:"finalized"});const selected=candidates.slice(offset,offset+20);
    const reads=await client.multicall({contracts:selected.flatMap(c=>[{address,abi,functionName:"getAgentWallet" as const,args:[BigInt(c.agentId)]},{address,abi,functionName:"ownerOf" as const,args:[BigInt(c.agentId)]}]),blockNumber:block.number,batchSize:4000});
    selected.forEach((candidate,index)=>{const wallet=reads[index*2],owner=reads[index*2+1];if(wallet?.status!=="success"||owner?.status!=="success"){results.push({...candidate,status:"FINALIZED_IDENTITY_UNAVAILABLE"});return;}const matched=history.providers.find((p:{provider:string})=>p.provider===String(wallet.result).toLowerCase());results.push({...candidate,status:"FINALIZED_IDENTITY_VERIFIED",finalizedIdentity:{agentWallet:wallet.result,owner:owner.result,blockNumber:block.number.toString()},submittedJobCount:matched?.count??0,sampledJobIds:matched?.jobs.map((job:{id:string})=>job.id)??[]});});
    const temporary=new URL("census-discovery.next.json",dir);
    await writeFile(temporary,JSON.stringify({observedAt:new Date().toISOString(),sourceUrl,sourceSha256:createHash("sha256").update(body).digest("hex"),sourceTrust:"discovery-only",sourceMeasuredAt:publicText(source.measured_at,80),candidates:results,chainWrites:false},null,2),{mode:0o600});await rename(temporary,new URL("census-discovery.json",dir));
    console.log(JSON.stringify({reviewed:results.length,total:candidates.length,withSubmittedJobs:results.filter(row=>Number(row.submittedJobCount)>0).length}));
  }
}
main().catch((error:unknown)=>{console.error("CENSUS_DISCOVERY_FAILED",error instanceof Error?error.name:"unknown",error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"READ_UNAVAILABLE",error instanceof Error?error.stack?.split("\n").filter(line=>line.includes("marketplace-mainnet-census-discovery.ts")):[]);process.exitCode=1;});
