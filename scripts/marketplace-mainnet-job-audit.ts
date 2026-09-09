/** Bounded finalized getJob inventory when a public RPC lacks old log indexes. */
import {readFile,writeFile} from "node:fs/promises";
import {createPublicClient,http,parseAbi} from "viem";
import {bsc} from "viem/chains";
const dir=new URL("../.runtime/mainnet-supply-upgrade/",import.meta.url);
async function main(){
  if(process.env.MAINNET_JOB_AUDIT_ENABLED!=="true")return;
  const offers=JSON.parse(await readFile(new URL("adapter-audit.json",dir),"utf8"));
  const client=createPublicClient({chain:bsc,transport:http(process.env.BSC_MAINNET_RPC_URL,{timeout:20000,retryCount:1})});
  if(await client.getChainId()!==56)throw new Error("CHAIN_MISMATCH");
  const block=await client.getBlock({blockTag:"finalized"});
  const abi=parseAbi(["function jobCounter() view returns(uint256)","function getJob(uint256) view returns((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))"]);
  const address=offers[0].binding.commerceContract as `0x${string}`;
  const counter=await client.readContract({address,abi,functionName:"jobCounter",blockNumber:block.number});
  const limit=Math.min(60000,Number(process.env.MAINNET_JOB_AUDIT_LIMIT??10000));
  const floor=counter>BigInt(limit)?counter-BigInt(limit):0n;
  const found:unknown[]=[];const failures:unknown[]=[];
  for(let end=counter;end>floor;end-=100n){
    const ids=Array.from({length:Number(end-floor>100n?100n:end-floor)},(_,i)=>end-BigInt(i));
    try{
      const jobs=await client.multicall({contracts:ids.map(id=>({address,abi,functionName:"getJob" as const,args:[id] as const})),blockNumber:block.number,batchSize:50000});
      for(let i=0;i<jobs.length;i++){const item=jobs[i]!;if(item.status!=="success"){failures.push({jobId:ids[i]!.toString(),reason:"READ_UNAVAILABLE"});continue;}
        const job=item.result;const offer=offers.find((x:{binding:{providerAddress:string}})=>x.binding.providerAddress.toLowerCase()===job.provider.toLowerCase());
        if(offer)found.push({agentId:offer.agentId,...job});
      }
    }catch{failures.push({fromJobId:ids.at(-1)!.toString(),toJobId:end.toString(),reason:"RPC_UNAVAILABLE"});}
    await writeFile(new URL("job-audit.json",dir),JSON.stringify({observedAt:new Date().toISOString(),blockNumber:block.number,jobCounter:counter,scannedThroughJobId:ids.at(-1),targetFloor:floor,found,failures,chainWrites:false},(_,v)=>typeof v==="bigint"?v.toString():v,2),{mode:0o600});
    if((counter-end)%1000n===0n)console.log(JSON.stringify({scannedThroughJobId:ids.at(-1)!.toString(),matches:found.length,failures:failures.length}));
  }
}
main().catch(()=>{console.error("MAINNET_JOB_AUDIT_FAILED");process.exitCode=1;});
