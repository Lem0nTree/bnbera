/** Read-only onboarding audit. Negotiation asks for terms; never funds or notifies a job. */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { directoryObservationType, directorySnapshotSchema, publicRecord } from "../packages/agent-ingestion/src/directory.ts";
import { BoundedMetadataResolver, resolveSafePublicNetworkTarget } from "../packages/agent-ingestion/src/metadata.ts";
async function main(){
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 try{
  const rows=(await pool.query(`select distinct on(i.id) eo.normalized_payload from agent_enrichment_observations eo join agent_versions v on v.id=eo.agent_version_id join agents a on a.id=v.agent_id join erc8004_identities i on i.id=a.identity_id where eo.observation_type=$1 and eo.validation_state='valid' order by i.id,eo.source_timestamp desc`,[directoryObservationType])).rows.slice(0,100);
  const resolver=new BoundedMetadataResolver({timeoutMs:8000,maxBytes:1024*1024});
  for(const row of rows){
   const s=directorySnapshotSchema.parse(row.normalized_payload);
   if(s.identity.chainId===56){console.log(JSON.stringify({chainId:56,agentId:s.identity.agentId,status:"MAINNET_COMMERCE_PINS_UNVERIFIED"}));continue;}
   const negotiates=s.skills.some(skill=>/negotiate/iu.test(skill.id));const card=s.services.find(service=>service.name.toLowerCase()==="a2a");
   if(!negotiates||!card){console.log(JSON.stringify({chainId:97,agentId:s.identity.agentId,status:"NO_EXECUTABLE_PAYMENT_CONTRACT"}));continue;}
   try{
    const document=publicRecord((await resolver.resolve(card.url,null)).document);
    const interfaces=Array.isArray(document.supportedInterfaces)?document.supportedInterfaces:[];
    const endpoint=typeof document.url==="string"?document.url:publicRecord(interfaces[0]).url;
    if(typeof endpoint!=="string")throw new Error("NO_INVOCATION_URL");
    const target=await resolveSafePublicNetworkTarget(endpoint);if(target.url.protocol!=="https:")throw new Error("HTTPS_REQUIRED");
    const response=await fetch(target.url,{method:"POST",redirect:"manual",headers:{"content-type":"application/json",accept:"application/json"},signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:"2.0",id:randomUUID(),method:"message/send",params:{message:{messageId:randomUUID(),role:"user",parts:[{kind:"data",data:{skill:"negotiate",task_description:"Read-only lending risk calculation: collateral 1000 USD, debt 400 USD, liquidation threshold 8000 bps. Return the exact ratio and interpretation. Caller-attested reference input; no trades or transactions.",terms:{deliverables:"A reproducible health-factor ratio and source-labelled explanation",quality_standards:"Read-only calculation, no strategy transactions; maximum price 0.001 U on BSC testnet 97"}}}]}}})});
    const reader=response.body?.getReader();let text="",size=0;if(reader){try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536)throw new Error("RESPONSE_TOO_LARGE");text+=new TextDecoder().decode(next.value);}}finally{await reader.cancel();}}
    let body:unknown=null;try{body=JSON.parse(text)}catch{/* invalid response */}
    const publicTerms:Record<string,unknown>[]=[];
    const visit=(value:unknown,depth=0)=>{if(depth>12||!value||typeof value!=="object")return;for(const [key,item]of Object.entries(value)){if(/^(price|currency|chain_id|chainId|provider_address|payment_token|commerce_contract|error|code)$/u.test(key)&&typeof item!=="object")publicTerms.push({[key]:item});if(typeof item==="object")visit(item,depth+1);if(key==="text"&&typeof item==="string"){try{visit(JSON.parse(item),depth+1)}catch{/* text is not a terms object */}}}};visit(body);
    console.log(JSON.stringify({chainId:97,agentId:s.identity.agentId,status:"NEGOTIATION_INSPECTED",httpStatus:response.status,publicTerms:publicTerms.slice(0,20)}));
   }catch{console.log(JSON.stringify({chainId:97,agentId:s.identity.agentId,status:"NEGOTIATION_UNAVAILABLE"}));}
  }
 }finally{await pool.end()}
}
main().catch(()=>{console.log(JSON.stringify({status:"AUDIT_FAILED"}));process.exitCode=1});
