import {readFile,writeFile,rename,mkdir,stat} from 'node:fs/promises';
const file=new URL('../.runtime/full-directory/provider-cooldown.json',import.meta.url);
const envModified=process.env.BNBERA_ENV_FILE ? (await stat(process.env.BNBERA_ENV_FILE)).mtimeMs : 0;
let previous=null;
try {previous=JSON.parse(await readFile(file,'utf8'));}catch{}
if(previous?.blockedUntil>Date.now() && previous.envModified===envModified){console.log(JSON.stringify({stage:'provider_cooldown',...previous}));process.exit(75);}
if(!process.env.EIGHTSCAN_API_KEY){console.log(JSON.stringify({errorCode:'SCAN_KEY_MISSING'}));process.exit(78);}
try {
 const response=await fetch('https://api.8004scan.io/api/v1/agents?chain_id=97&limit=1',{headers:{'X-API-Key':process.env.EIGHTSCAN_API_KEY},signal:AbortSignal.timeout(10000)});
 if(response.status===429){
  const body=await response.json();
  const seconds=Number(response.headers.get('retry-after')??body.retry_after??3600);
  const delay=Number.isFinite(seconds)&&seconds>0?Math.min(seconds,86400):3600;
  const record={blockedUntil:Date.now()+delay*1000,envModified,reason:'SCAN_RATE_LIMITED',limitType:body.limit_type==='day'?'day':'provider',limit:Number(body.limit_value)||null};
  await mkdir(new URL('../.runtime/full-directory/',import.meta.url),{recursive:true});
  const temporary=new URL(`provider-cooldown.${process.pid}.tmp`,file);
  await writeFile(temporary,JSON.stringify(record));await rename(temporary,file);
  console.log(JSON.stringify({stage:'provider_cooldown',...record}));process.exitCode=75;
 }else if(!response.ok){await response.body?.cancel();console.log(JSON.stringify({errorCode:'SCAN_PROVIDER_UNAVAILABLE',status:response.status}));process.exitCode=75;}
 else {await response.body?.cancel();console.log(JSON.stringify({stage:'provider_ready'}));}
}catch{console.log(JSON.stringify({errorCode:'SCAN_PROVIDER_UNAVAILABLE'}));process.exitCode=75;}
