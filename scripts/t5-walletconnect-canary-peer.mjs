/** Operator-controlled WalletConnect test wallet. No approval is automatic.
 * Memory-only session storage; private Unix socket; one 0.001 U job maximum.
 * Start only for an explicitly authorized testnet browser acceptance run.
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import pg from "pg";
import { createPublicClient, createWalletClient, http, hexToString } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { buildErc8183EoaCall, ERC8183_EOA_CONTRACTS } from "../packages/agent-commerce/dist/eoa.js";

if(process.env.T5_WALLET_PEER_CANARY_ENABLED!=="true")throw new Error("CANARY_DISABLED");
const origin=new URL(process.env.APP_URL).origin;
if(!origin.startsWith("https://"))throw new Error("HTTPS_ORIGIN_REQUIRED");
const started=Math.floor(Date.now()/1000);const memory=new Map();
const storage={getItem:async key=>memory.get(key),setItem:async(key,value)=>{memory.set(key,value)},removeItem:async key=>{memory.delete(key)},getKeys:async()=>[...memory.keys()],getEntries:async()=>[...memory.entries()]};
const dep=readdirSync("node_modules/.pnpm").find(name=>name.startsWith("@walletconnect+sign-client@2.21.1_")&&name.endsWith("zod@3.24.1"));
if(!dep)throw new Error("PINNED_SIGN_CLIENT_UNAVAILABLE");
const require=createRequire(import.meta.url);const {SignClient}=require(resolve("node_modules/.pnpm",dep,"node_modules/@walletconnect/sign-client/dist/index.cjs.js"));
const raw=process.env.WALLET_PRIVATE_KEY;const account=privateKeyToAccount(raw.startsWith("0x")?raw:`0x${raw}`);
const provider=process.env.WALLET2_ADDRESS.toLowerCase();
const projectId=/^NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=(.+)$/m.exec(readFileSync("apps/web/.env.local","utf8"))?.[1]?.replace(/^['"]|['"]$/g,"");
const silent={level:"silent",trace(){},debug(){},info(){},warn(){},error(){},fatal(){},child(){return this}};
const client=await SignClient.init({projectId,storage,logger:silent,metadata:{name:"BNBEra authorized test wallet",description:"Operator-controlled testnet acceptance wallet",url:origin,icons:[]}});
const publicClient=createPublicClient({chain:bscTestnet,transport:http(process.env.BSC_TESTNET_RPC_URL,{timeout:15000,retryCount:0})});
const wallet=createWalletClient({account,chain:bscTestnet,transport:http(process.env.BSC_TESTNET_RPC_URL,{timeout:15000,retryCount:0})});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
const proposals=new Map(),requests=new Map(),attempted=new Set();let boundCommerceJob=null,created=false;
client.on("session_proposal",proposal=>{proposals.set(proposal.id,proposal);console.log(JSON.stringify({pending:"connection",id:proposal.id,origin:proposal.params.proposer.metadata.url}));});
client.on("session_request",request=>{requests.set(request.id,request);console.log(JSON.stringify({pending:"wallet_request",id:request.id,method:request.params.request.method,chainId:request.params.chainId}));});
async function approve(id){
 const proposal=proposals.get(id);
 if(proposal){
  if(new URL(proposal.params.proposer.metadata.url).origin!==origin)throw new Error("ORIGIN_MISMATCH");
  const result=await client.approve({id,namespaces:{eip155:{accounts:[`eip155:97:${account.address}`,`eip155:56:${account.address}`],chains:["eip155:97","eip155:56"],methods:["personal_sign","eth_sendTransaction","wallet_switchEthereumChain"],events:["accountsChanged","chainChanged"]}}});
  await result.acknowledged();proposals.delete(id);return{approved:"connection",address:account.address};
 }
 const event=requests.get(id);if(!event||attempted.has(id))throw new Error("REQUEST_NOT_APPROVABLE");
 const {method,params}=event.params.request;let result;
 if(method==="personal_sign"){
  const message=String(params[0]).startsWith("0x")?hexToString(params[0]):String(params[0]);
  if(String(params[1]).toLowerCase()!==account.address.toLowerCase()||!message.startsWith(`${new URL(origin).host} wants you to sign in with your Ethereum account:`)||!message.includes(`URI: ${origin}`)||!message.includes("Chain ID: 97")||event.params.chainId!=="eip155:97")throw new Error("SIWE_SCOPE_MISMATCH");
  attempted.add(id);result=await account.signMessage({message});
 }else if(method==="wallet_switchEthereumChain"){
  const chain=Number(BigInt(params[0].chainId));if(![56,97].includes(chain))throw new Error("CHAIN_NOT_ALLOWED");
  await client.emit({topic:event.topic,chainId:`eip155:${chain}`,event:{name:"chainChanged",data:chain}});result=null;
 }else if(method==="eth_sendTransaction"){
  if(process.env.T5_WALLET_PEER_PAYMENTS_ENABLED!=="true"||event.params.chainId!=="eip155:97"||await publicClient.getChainId()!==97)throw new Error("TESTNET_PAYMENT_DISABLED");
  const tx=params[0];if(tx.from.toLowerCase()!==account.address.toLowerCase()||BigInt(tx.value??0)!==0n)throw new Error("TRANSACTION_ACTOR_OR_VALUE_MISMATCH");
  const rows=(await pool.query(`select * from erc8183_operations where chain_id=97 and status='unknown' and transaction_hash is null and operation_context->>'dispatchClaimed'='true' and lower(operation_context->>'to')=$1 and lower(operation_context->>'data')=$2 and created_at_unix >= $3`,[tx.to.toLowerCase(),tx.data.toLowerCase(),started])).rows;
  if(rows.length!==1)throw new Error("EXACT_PERSISTED_INTENT_REQUIRED");
  const op=rows[0],context=op.operation_context,p=context.parameters;
  const canonical=op.erc8183_job_id===null?null:(await pool.query("select * from erc8183_jobs where chain_id=97 and lower(commerce_contract)=lower($1) and erc8183_job_id=$2",[op.commerce_contract,op.erc8183_job_id])).rows[0];
  const providerAddress=p.providerAddress??canonical?.provider_address,budgetAtomic=p.budgetAtomic??canonical?.budget_atomic,commerceJobId=p.commerceJobId??canonical?.commerce_job_id,binding=p.providerBinding??canonical?.provider_binding;
  if(context.signerAddress.toLowerCase()!==account.address.toLowerCase()||p.connector!=="walletConnect"||providerAddress?.toLowerCase()!==provider||budgetAtomic!=="1000000000000000"||binding?.identity?.agentId!==process.env.T5_REFERENCE_PROVIDER_AGENT_ID||binding?.identity?.chainId!==97)throw new Error("BOUNDED_TERMS_MISMATCH");
  const other=await pool.query("select id from erc8183_jobs where chain_id=97 and provider_binding->'identity'->>'agentId'=$1 and erc8183_job_id<>'1171' and commerce_job_id<>$2::uuid limit 1",[process.env.T5_REFERENCE_PROVIDER_AGENT_ID,commerceJobId]);
  if(!(await pool.query("select 1 from reference_provider_slots where commerce_job_id=$1",[commerceJobId])).rows.length)throw new Error("DURABLE_ADMISSION_REQUIRED");
  if(other.rows.length)throw new Error("ONE_PERSISTED_JOB_LIMIT");
  const call=buildErc8183EoaCall({chainId:97,contracts:ERC8183_EOA_CONTRACTS,step:p.eoaStep,providerAddress:p.providerAddress,task:p.task,budgetAtomic:p.budgetAtomic,expiredAtUnix:p.expiredAtUnix,...(op.erc8183_job_id===null?{}:{jobId:op.erc8183_job_id})});
  if(call.to.toLowerCase()!==tx.to.toLowerCase()||call.data.toLowerCase()!==tx.data.toLowerCase()||attempted.has(op.id))throw new Error("CALL_MISMATCH_OR_ALREADY_ATTEMPTED");
  if(boundCommerceJob!==null&&commerceJobId!==boundCommerceJob)throw new Error("ONE_JOB_LIMIT");
  if(p.eoaStep==="create"&&created)throw new Error("ONE_CREATE_LIMIT");
  const gas=(await publicClient.estimateGas({account,to:call.to,data:call.data,value:0n}))*12n/10n+1n;
  const gasPrice=await publicClient.getGasPrice();if(gas>1000000n||gasPrice>20000000000n||gas*gasPrice>10000000000000000n)throw new Error("GAS_CAP_EXCEEDED");
  attempted.add(id);attempted.add(op.id);boundCommerceJob=commerceJobId;if(p.eoaStep==="create")created=true;
  if(await publicClient.getChainId()!==97)throw new Error("CHAIN_CHANGED_BEFORE_SEND");
  result=await wallet.sendTransaction({to:call.to,data:call.data,value:0n,gas,gasPrice});
  console.log(JSON.stringify({broadcast:true,step:p.eoaStep,operationId:op.id,transactionHash:result,chainId:97}));
 }else throw new Error("METHOD_NOT_ALLOWED");
 await client.respond({topic:event.topic,response:{jsonrpc:"2.0",id,result}});requests.delete(id);return{approved:method,id};
}
const socket=resolve(".runtime/protocol-commerce-review/wallet-peer.sock");
const server=createServer(connection=>{let data="";connection.on("data",async chunk=>{data+=chunk.toString();if(data.length>8192){connection.destroy();return}if(!data.includes("\n"))return;try{const command=JSON.parse(data);let result;if(command.action==="pair"){await client.pair({uri:command.uri});result={pairingRequested:true}}else if(command.action==="approve")result=await approve(command.id);else if(command.action==="status")result={proposals:[...proposals.keys()],requests:[...requests].map(([id,r])=>({id,method:r.params.request.method})),created};else if(command.action==="reject"){const r=requests.get(command.id);if(!r)throw new Error("REQUEST_MISSING");await client.respond({topic:r.topic,response:{jsonrpc:"2.0",id:command.id,error:{code:4001,message:"Explicit canary wallet rejection"}}});requests.delete(command.id);result={rejected:true}}else throw new Error("COMMAND_NOT_ALLOWED");connection.end(JSON.stringify(result))}catch(error){connection.end(JSON.stringify({error:/^[A-Z_]{3,80}$/.test(error.message)?error.message:"CANARY_REQUEST_FAILED"}))}})});
server.listen(socket,()=>{chmodSync(socket,0o600);console.log(JSON.stringify({ready:true,address:account.address,paymentsEnabled:process.env.T5_WALLET_PEER_PAYMENTS_ENABLED==="true"}))});
// Pairing transport only, bound to loopback. Approval/signing is never exposed
// through HTTP; it requires the mode-0600 operator Unix socket above.
createHttpServer((request,response)=>{let body="";if(request.method!=="POST"||request.url!=="/pair"){response.writeHead(404).end();return}request.on("data",chunk=>{body+=chunk.toString();if(body.length>8192)request.destroy()});request.on("end",async()=>{try{const {uri}=JSON.parse(body);if(typeof uri!=="string"||!uri.startsWith("wc:"))throw new Error();await client.pair({uri});response.setHeader("content-type","application/json");response.end(JSON.stringify({pairingRequested:true}))}catch{response.writeHead(400).end('{"paired":false}')}})}).listen(3055,"127.0.0.1");
