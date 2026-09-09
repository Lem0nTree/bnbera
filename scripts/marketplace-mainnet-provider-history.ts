/** Read-only, bounded history ranking. No signer, funded notification or membership mutation. */
import {readFile,writeFile,rename} from "node:fs/promises";
import {createPublicClient,http,parseAbi} from "viem";
import {bsc} from "viem/chains";
const dir=new URL("../.runtime/mainnet-supply-upgrade/",import.meta.url);
async function main(){
  if(process.env.MAINNET_PROVIDER_HISTORY_ENABLED!=="true")return;
  const candidates=JSON.parse(await readFile(new URL("candidate-audit.json",dir),"utf8")).candidates;
  const direct=JSON.parse(await readFile(new URL("direct-identity-audit.json",dir),"utf8")).results;
  for(const row of direct)if(!candidates.some((candidate:{agentId:string})=>candidate.agentId===row.agentId))candidates.push({agentId:row.agentId});
  try{const census=JSON.parse(await readFile(new URL("census-discovery.json",dir),"utf8")).candidates;for(const row of census)if(!candidates.some((candidate:{agentId:string})=>candidate.agentId===row.agentId))candidates.push({agentId:row.agentId});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const deployment=JSON.parse(await readFile(new URL("apex-chain56-readonly-audit.json",dir),"utf8"));
  const client=createPublicClient({chain:bsc,transport:http(process.env.BSC_MAINNET_RPC_URL,{timeout:20000,retryCount:1})});
  if(await client.getChainId()!==56)throw new Error("CHAIN_MISMATCH");
  let block=await client.getBlock({blockTag:"finalized"});
  const registry="0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" as const;
  const walletAbi=parseAbi(["function getAgentWallet(uint256) view returns(address)"]);
  const abi=parseAbi(["function jobCounter() view returns(uint256)","function getJob(uint256) view returns((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))"]);
  const address=deployment.addresses.commerceProxy as `0x${string}`;
  const counter=await client.readContract({address,abi,functionName:"jobCounter",blockNumber:block.number});
  const walletMap=new Map<string,string[]>();const walletFailures:string[]=[];
  for(let offset=0;offset<candidates.length;offset+=20){
    block=await client.getBlock({blockTag:"finalized"});
    const selected=candidates.slice(offset,offset+20);
    const result=await client.multicall({contracts:selected.map((c:{agentId:string})=>({address:registry,abi:walletAbi,functionName:"getAgentWallet" as const,args:[BigInt(c.agentId)]})),blockNumber:block.number,batchSize:4000});
    result.forEach((r,i)=>{const c=selected[i];if(r.status!=="success"){walletFailures.push(c.agentId);return;}const wallet=String(r.result).toLowerCase();if(/^0x0{40}$/u.test(wallet))return;walletMap.set(wallet,[...(walletMap.get(wallet)??[]),c.agentId]);});
  }
  const limit=Math.min(60000,Math.max(1,Number(process.env.MAINNET_PROVIDER_HISTORY_LIMIT??6000)));
  if(!Number.isSafeInteger(limit))throw new Error("INVALID_HISTORY_CAP");
  const resume=process.env.MAINNET_PROVIDER_HISTORY_RESUME==="true"
    ? JSON.parse(await readFile(new URL("provider-history-v2.json",dir),"utf8")):null;
  if(resume&&(resume.observationMode!=="per-batch-explicit-finalized"||resume.chainWrites!==false||!/^\d+$/u.test(resume.scannedThroughJobId)||BigInt(resume.jobCounter)>counter))throw new Error("INVALID_HISTORY_RESUME");
  const originalCounter=resume?BigInt(resume.jobCounter):counter;
  if(resume&&BigInt(resume.scanned+resume.failures.length)!==originalCounter-BigInt(resume.scannedThroughJobId)+1n)throw new Error("HISTORY_COVERAGE_GAP");
  const refreshHead=process.env.MAINNET_PROVIDER_HISTORY_REFRESH_HEAD==="true";
  if(refreshHead&&(!resume||resume.scannedThroughJobId!=="1"||resume.targetFloor!=="0"||resume.failures.length))throw new Error("FULL_HISTORY_REQUIRED_FOR_HEAD_REFRESH");
  // Commit a head refresh as one atomic batch; never publish a complete cursor
  // while lower IDs in a larger new head have not yet been observed.
  if(refreshHead&&counter-originalCounter>10n)throw new Error("HEAD_REFRESH_REQUIRES_FRESH_BOUNDED_SCAN");
  const floor=refreshHead?originalCounter:originalCounter>BigInt(limit)?originalCounter-BigInt(limit):0n;
  const providers=new Map<string,{provider:string;agentIds:string[];count:number;jobs:unknown[]}>();const failures:string[]=[];
  let scanned=resume?.scanned??0;
  if(resume){for(const provider of resume.providers)providers.set(provider.provider,{...provider,agentIds:walletMap.get(provider.provider)??[]});failures.push(...resume.failures);}
  const start=refreshHead?counter:resume?BigInt(resume.scannedThroughJobId)-1n:counter;
  for(let end=start;end>floor;end-=10n){
    // Public BSC RPCs prune historical state quickly. Each read still uses an
    // explicit finalized block; retain that exact block on every sampled job.
    block=await client.getBlock({blockTag:"finalized"});
    const ids=Array.from({length:Number(end-floor>10n?10n:end-floor)},(_,i)=>end-BigInt(i));
    const result=await client.multicall({contracts:ids.map(id=>({address,abi,functionName:"getJob" as const,args:[id]})),blockNumber:block.number,batchSize:2000});
    result.forEach((r,i)=>{if(r.status!=="success"){failures.push(ids[i]!.toString());return;}scanned++;const job=r.result;if(![2,3].includes(job.status))return;const wallet=job.provider.toLowerCase();const entry=providers.get(wallet)??{provider:wallet,agentIds:walletMap.get(wallet)??[],count:0,jobs:[]};entry.count++;if(refreshHead){entry.jobs.push({...job,observationBlock:block.number});entry.jobs.sort((a,b)=>Number(BigInt((b as {id:string|bigint}).id)-BigInt((a as {id:string|bigint}).id)));entry.jobs=entry.jobs.slice(0,20);}else if(entry.jobs.length<20)entry.jobs.push({...job,observationBlock:block.number});providers.set(wallet,entry);});
    const output={observedAt:new Date().toISOString(),blockNumber:block.number,observationMode:"per-batch-explicit-finalized",jobCounter:refreshHead?counter:originalCounter,latestObservedJobCounter:counter,scannedThroughJobId:refreshHead?"1":ids.at(-1),targetFloor:refreshHead?0n:floor,scanned,failures,walletFailures,providers:[...providers.values()].sort((a,b)=>Number(b.agentIds.length>0)-Number(a.agentIds.length>0)||b.count-a.count),chainWrites:false};
    const temporary=new URL("provider-history-v2.next.json",dir);
    await writeFile(temporary,JSON.stringify(output,(_,v)=>typeof v==="bigint"?v.toString():v,2),{mode:0o600});
    await rename(temporary,new URL("provider-history-v2.json",dir));
    if((start-end)%200n===0n)console.log(JSON.stringify({scanned,through:ids.at(-1)!.toString(),providers:providers.size,candidateProviders:[...providers.values()].filter(x=>x.agentIds.length).length,failures:failures.length}));
  }
}
main().catch((error:unknown)=>{console.error("PROVIDER_HISTORY_READ_FAILED",error instanceof Error?error.name:"unknown",error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"READ_UNAVAILABLE",error instanceof Error?error.stack?.split("\n").filter(line=>line.includes("marketplace-mainnet-provider-history.ts")):[]);process.exitCode=1;});
