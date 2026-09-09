/** Bounded, restart-safe read-only-chain ingestion into the existing PostgreSQL store. */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { canonicalSha256Hex, erc8004IdentityKey } from "../packages/domain/src/index.ts";
import { AgentIngestionService, PostgresIngestionRepository, EightHundredFourScanHttpClient,
  JsonRpcClient, JsonRpcRegistryChainReader, createOfficialErc8004RegistryReadDefinitions,
  BoundedMetadataResolver, classifyAgent, buildDirectorySemanticDocument, PostgresMarketplaceIngestionState } from "../packages/agent-ingestion/src/index.ts";
import { directoryObservationType, directorySnapshotSchema, normalizeDirectorySnapshot,
  publicRecord, publicText, publicDate } from "../packages/agent-ingestion/src/directory.ts";

const version = "bnbera-directory-v1";
const pendingVersion = "bnbera-directory-pending-v1";
const archivedVersion = "bnbera-directory-archived-v1";
const fullScan = process.env.MARKETPLACE_DIRECTORY_FULL_SCAN === "true";
const chainFilter = Number(process.env.ERC8004_SCAN_CHAIN_ID ?? "0");
const maxRefresh=Number(process.env.MARKETPLACE_DIRECTORY_MAX_REFRESH??100);
const maxAgents = Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_DIRECTORY_LIMIT ?? "100")));
const priorityIds = (process.env.MARKETPLACE_DIRECTORY_PRIORITY_MAINNET_IDS ?? "").split(",").filter(Boolean);
const safeCode = (error: unknown) => {
  const code = publicRecord(error).code;
  return typeof code === "string" && /^(?:[A-Z][A-Z0-9_]{2,63}|[0-9A-Z]{5})$/u.test(code) ? code : "DIRECTORY_SOURCE_UNAVAILABLE";
};
const log = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function main() {
  if (process.env.MARKETPLACE_DIRECTORY_SYNC_ENABLED !== "true") { log({status:"disabled"}); return; }
  if (!Number.isSafeInteger(maxRefresh)||maxRefresh<1||maxRefresh>1000||![0,56,97].includes(chainFilter))throw new Error("INVALID_DIRECTORY_BATCH");
  if (!Number.isSafeInteger(maxAgents)) throw new Error("INVALID_DIRECTORY_CAP");
  if (priorityIds.length > 10 || priorityIds.some(id => !/^[1-9][0-9]*$/u.test(id))) throw new Error("INVALID_PRIORITY_IDENTITIES");
  const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json",import.meta.url),"utf8"));
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max:4});
  const guard = await pool.connect();
  if (!(await guard.query("SELECT pg_try_advisory_lock(8004100) AS acquired")).rows[0]?.acquired) { guard.release(); await pool.end(); log({status:"already_running"}); return; }
  const repository = new PostgresIngestionRepository(pool);
  const state = new PostgresMarketplaceIngestionState(pool);
  const ingest = new AgentIngestionService(repository);
  const client = EightHundredFourScanHttpClient.fromEnvironment(process.env,{timeoutMs:fullScan?8000:15000,maxRetries:fullScan?0:2,minRequestIntervalMs:2200,maxResponseBytes:4*1024*1024});
  const resolver = new BoundedMetadataResolver({timeoutMs:8000,maxBytes:1024*1024,ipfsGateways:(process.env.ERC8004_IPFS_GATEWAYS??"").split(",").filter(Boolean)});
  try {
    // Membership is the persisted source marker. It survives a crash before metadata is ready.
    const memberQuery = `SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id FROM erc8004_identities i
      WHERE EXISTS (SELECT 1 FROM agent_discovery_sources s WHERE s.identity_id=i.id AND (s.normalized_ingestion_version ${fullScan ? "in ($1,'bnbera-directory-full-v1')" : '= $1'}
        OR (s.normalized_ingestion_version='bnbera-directory-pending-v1' AND i.chain_id=56 AND i.agent_id=ANY($2::text[]))))
      ORDER BY CASE WHEN i.chain_id=56 AND i.agent_id=ANY($2::text[]) THEN 0 ELSE 1 END, i.chain_id, i.agent_id::numeric`;
    let members = (await pool.query(memberQuery,[version,priorityIds])).rows;
    for (const chainId of fullScan ? [] : [56,97]) {
      const quota = chainId === 56 ? Math.ceil(maxAgents*0.8) : Math.floor(maxAgents*0.2);
      const registry = lock.networks[String(chainId)].erc8004.identityRegistry;
      const keys = new Set(members.filter(m=>m.chain_id===chainId).map(m=>String(m.agent_id)));
      const add = async (raw: unknown) => {
        const v = publicRecord(raw); const tokenId = String(v.token_id);
        if (keys.size >= quota && !(chainId===56 && priorityIds.includes(tokenId)) || keys.has(tokenId) || v.chain_id !== chainId || String(v.contract_address).toLowerCase() !== registry || !/^\d+$/u.test(tokenId)) return;
        const identity = {namespace:"eip155",chainId,identityRegistry:registry,agentId:tokenId};
        // Above-quota priorities stay invisible until their complete finalized
        // snapshot and a reversible membership swap commit atomically below.
        await ingest.ingestCandidate({identity,source:"8004scan",sourceReference:`https://8004scan.io/agents/${chainId===56?"bsc":"bsc-testnet"}/${tokenId}`,observedAt:new Date(),rawResponseDigest:canonicalSha256Hex(raw),normalizedIngestionVersion:keys.size>=quota?pendingVersion:version});
        keys.add(tokenId);
      };
      // Keep the user-specified reference and the retained useful testnet examples in scope.
      for (const id of chainId===56?[...priorityIds,"341628"]:["2206","2283"]) {
        if(keys.size>=quota && !(chainId===56 && priorityIds.includes(id))) break;
        if(keys.has(id)) continue;
        try {await add(await client.getCandidateByIdentity({namespace:"eip155",chainId,identityRegistry:registry,agentId:id}));} catch(error){log({stage:"reference",chainId,agentId:id,error:safeCode(error)});}
      }
      const sorts = ["total_score","quality_score","activity_score","created_at"] as const;
      for (let page=0; page<8 && keys.size<quota; page++) {
        const sortBy=sorts[page%sorts.length]!;
        const pageSize=Math.min(20,quota-keys.size);
        const offset=Math.floor(page/sorts.length)*20;
        try {
          const result=await client.listCandidates({chainId,isTestnet:chainId===97,limit:pageSize,offset,sortBy,sortOrder:"desc"});
          for(const raw of result.items) await add(raw);
          log({stage:"discovery",chainId,sortBy,offset,vendorTotal:result.total,selected:keys.size,cap:quota});
        }catch(error){log({stage:"discovery",chainId,sortBy,offset,error:safeCode(error)});}
      }
      members=(await pool.query(memberQuery,[version,priorityIds])).rows;
    }
    const counts={enriched:0,failed:0,metadataResolved:0,cardsReachable:0};
    const complete = new Set((await pool.query(`SELECT DISTINCT i.namespace || ':' || i.chain_id || ':' || i.identity_registry || ':' || i.agent_id AS key
      FROM agent_enrichment_observations eo JOIN agent_versions v ON v.id=eo.agent_version_id
      JOIN agents a ON a.id=v.agent_id JOIN erc8004_identities i ON i.id=a.identity_id
      WHERE eo.observation_type=$1 AND eo.validation_state='valid' AND eo.normalized_payload->'registration'->>'status'='resolved'`,[directoryObservationType])).rows.map(row=>row.key));
    const refresh = members.filter(member=>(!chainFilter || member.chain_id===chainFilter) && (process.env.MARKETPLACE_DIRECTORY_ONLY_MISSING!=="true" || !complete.has(`${member.namespace}:${member.chain_id}:${member.identity_registry}:${member.agent_id}`)));
    // Retry failures after backoff; one unreachable identity cannot pin the batch.
    const due = [];
    for (const member of refresh) {
      if (fullScan && !(await state.isRetryDue(erc8004IdentityKey({namespace:member.namespace,chainId:member.chain_id,identityRegistry:member.identity_registry,agentId:member.agent_id}),new Date()))) continue;
      due.push(member);
      if(due.length>=maxRefresh) break;
    }
    for (const member of due.slice(0,fullScan ? due.length : maxAgents)) {
      const identity={namespace:member.namespace,chainId:member.chain_id,identityRegistry:member.identity_registry,agentId:member.agent_id};
      let stage="vendor_detail";
      // A killed process must not immediately choose the same stalled identity again.
      if(fullScan)await state.recordRetry(erc8004IdentityKey(identity),{stage:'failed',errorCode:'DIRECTORY_ATTEMPT_IN_PROGRESS',attemptedAt:new Date(),retryBaseDelayMs:600000,retryMaxDelayMs:86400000});
      try {
        const prior=fullScan ? (await pool.query(`select eo.normalized_payload,eo.provider from erc8004_identities i join agents a on a.identity_id=i.id join agent_versions v on v.agent_id=a.id join agent_enrichment_observations eo on eo.agent_version_id=v.id
          where i.namespace=$1 and i.chain_id=$2 and i.identity_registry=$3 and i.agent_id=$4 and eo.observation_type=$5 and eo.validation_state='valid'
          order by eo.source_timestamp desc,eo."createdAt" desc limit 1`,[identity.namespace,identity.chainId,identity.identityRegistry,identity.agentId,directoryObservationType])).rows[0] : undefined;
        const previous=prior ? directorySnapshotSchema.parse(prior.normalized_payload) : null;
        const raw=fullScan ? {chain_id:identity.chainId,contract_address:identity.identityRegistry,token_id:identity.agentId,
          ...(previous ? {name:previous.name,description:previous.description,supported_protocols:previous.protocols} : {})} : await client.getCandidateByIdentity(identity);
        const snapshotProvider=fullScan ? (prior?.provider??'bnbera-registry-review') : '8004scan';
        const vendor=publicRecord(raw);
        if(vendor.chain_id!==identity.chainId||String(vendor.token_id)!==identity.agentId||String(vendor.contract_address).toLowerCase()!==identity.identityRegistry) throw new Error("DIRECTORY_IDENTITY_MISMATCH");
        stage="registry_read";
        const ercLock=lock.networks[String(identity.chainId)].erc8004;
        const endpoint=process.env[identity.chainId===56?"BSC_MAINNET_RPC_URL":"BSC_TESTNET_RPC_URL"];
        if(!endpoint) throw new Error("DIRECTORY_RPC_MISSING");
        const reader=new JsonRpcRegistryChainReader({chainId:identity.chainId,identityRegistry:identity.identityRegistry,client:new JsonRpcClient(endpoint,{timeoutMs:fullScan?5000:15000}),...createOfficialErc8004RegistryReadDefinitions({expectedAbiSha256:ercLock.abiHashes.identityRegistry}),readConsistency:"finalized"});
        const canonical=await ingest.reconcileIdentity(reader,identity);
        if(!canonical.ownerAddress || /^0x0{40}$/u.test(canonical.ownerAddress)) throw new Error("DIRECTORY_OWNER_MISSING");
        let metadata:unknown=null; let digest:string|null=null; let reason:string|null=null;
        try {
          if(!canonical.agentUri) throw new Error("DIRECTORY_URI_MISSING");
          const resolved=await resolver.resolve(canonical.agentUri,canonical.contentDigest);
          metadata=resolved.document; digest=resolved.contentDigest; counts.metadataResolved++;
        } catch(error) {reason=safeCode(error);}
        stage="normalize_snapshot";
        let snapshot=normalizeDirectorySnapshot(raw,metadata);
        if(fullScan && previous) snapshot={...snapshot,sourceUrl:previous.sourceUrl,sourceLabel:previous.sourceLabel,scores:previous.scores,feedback:previous.feedback,stats:previous.stats,vendorHealth:previous.vendorHealth,vendorUpdatedAt:previous.vendorUpdatedAt};
        else if(fullScan) snapshot={...snapshot,sourceLabel:'Finalized ERC-8004 registry',sourceUrl:`https://${identity.chainId===56?'bscscan.com':'testnet.bscscan.com'}/token/${identity.identityRegistry}?a=${identity.agentId}`};
        snapshot={...snapshot,registration:{status:metadata===null?"unavailable":"resolved",uri:canonical.agentUri,digest,reason}};
        const card=snapshot.services.find(s=>s.name.toLowerCase()==="a2a");
        if(card) {
          const started=Date.now();
          try {
            const result=await resolver.resolve(card.url,null);const data=publicRecord(result.document);
            const skills=Array.isArray(data.skills)?data.skills.flatMap(rawSkill=>{const s=publicRecord(rawSkill);const name=publicText(s.name,160);const id=publicText(s.id,160)??name;return id&&name?[{id,name,description:publicText(s.description)??name}]:[]}).slice(0,32):[];
            snapshot={...snapshot,skills,cardCheck:{status:"reachable",observedAt:new Date().toISOString(),latencyMs:Date.now()-started,url:card.url,reason:null}};
            counts.cardsReachable++;
          } catch(error) {snapshot={...snapshot,cardCheck:{status:"unreachable",observedAt:new Date().toISOString(),latencyMs:Date.now()-started,url:card.url,reason:safeCode(error)}};}
        }
        if(!fullScan && (snapshot.feedback.count??0)>0) {
          try {
            const params=new URLSearchParams({chain_id:String(identity.chainId),agent_token_id:identity.agentId,limit:"5",offset:"0",is_testnet:String(identity.chainId===97),sort_by:"submitted_at",sort_order:"desc"});
            const response=await fetch(`https://api.8004scan.io/api/v1/feedbacks?${params}`,{headers:process.env.EIGHTSCAN_API_KEY?{"X-API-Key":process.env.EIGHTSCAN_API_KEY}:{},signal:AbortSignal.timeout(10000)});
            if(response.ok) {const body=publicRecord(await response.json());const list=Array.isArray(body.items)?body.items:[];snapshot={...snapshot,feedback:{...snapshot.feedback,items:list.flatMap(item=>{const f=publicRecord(item);if(f.is_revoked===true||f.revoked===true)return [];return [{reviewer:publicText(f.client_address??f.reviewer_address,160),value:publicText(String(f.value??f.score??""),100),comment:publicText(f.comment??f.text??f.feedback),tag:publicText(f.tag1??f.tag,128),observedAt:publicDate(f.submitted_at??f.created_at)}];})}};}
          }catch {/* Optional feedback does not withhold the registered profile. */}
        }
        stage="validate_snapshot";
        snapshot=directorySnapshotSchema.parse(snapshot);
        const category=classifyAgent({name:snapshot.name,description:snapshot.description,supportedProtocols:snapshot.protocols,advertisedSkills:snapshot.skills}).category;
        snapshot={...snapshot,category,semanticDigest:buildDirectorySemanticDocument(snapshot).digest};
        stage="persist_snapshot";
        const tx=await pool.connect();
        try {
          await tx.query("BEGIN");
          const a=(await tx.query(`SELECT a.id FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id WHERE i.namespace=$1 AND i.chain_id=$2 AND i.identity_registry=$3 AND i.agent_id=$4 FOR UPDATE OF a`,[identity.namespace,identity.chainId,identity.identityRegistry,identity.agentId])).rows[0];
          let v=(await tx.query(`SELECT id FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC LIMIT 1`,[a.id])).rows[0];
          // A metadata-only version can exist without pretending an executable capability exists.
          if(!v) v=(await tx.query(`INSERT INTO agent_versions(agent_id,version,public_metadata,capability_manifest,pricing_manifest) VALUES($1,1,$2,$3,$4) RETURNING id`,[a.id,JSON.stringify({name:snapshot.name,description:snapshot.description,category,directoryOnly:true}),JSON.stringify({schemaVersion:version,capabilities:[]}),JSON.stringify({model:"unavailable"})])).rows[0];
          const payload=JSON.stringify(snapshot); const payloadDigest=canonicalSha256Hex(snapshot);
          await tx.query(`INSERT INTO agent_enrichment_observations(agent_version_id,provider,observation_type,normalized_payload,source_timestamp,source_block,freshness,validation_state,payload_digest)
            SELECT $1::uuid,$7::varchar,$2::varchar,$3::jsonb,$4::timestamptz,$5::bigint,'fresh','valid',$6::varchar WHERE NOT EXISTS(SELECT 1 FROM agent_enrichment_observations WHERE agent_version_id=$1::uuid AND observation_type=$2::varchar AND payload_digest=$6::varchar)`,[v.id,directoryObservationType,payload,snapshot.fetchedAt,canonical.observedBlock,payloadDigest,snapshotProvider]);
          if(!fullScan && identity.chainId===56 && priorityIds.includes(identity.agentId)) {
            const active=(await tx.query(`SELECT i.id,i.agent_id FROM erc8004_identities i WHERE i.chain_id=56
              AND EXISTS(SELECT 1 FROM agent_discovery_sources s WHERE s.identity_id=i.id AND s.normalized_ingestion_version=$1)
              ORDER BY i.agent_id::numeric DESC`,[version])).rows;
            const alreadyActive=active.some(row=>row.agent_id===identity.agentId);
            if(!alreadyActive || active.length>Math.ceil(maxAgents*0.8)) {
              const quota=Math.ceil(maxAgents*0.8);
              const added=alreadyActive?0:1;
              const victims=active.filter(row=>!priorityIds.includes(row.agent_id)&&!["45422","49637","341628"].includes(row.agent_id)).slice(0,Math.max(0,active.length-quota+added));
              if(active.length-victims.length+added>quota)throw new Error("DIRECTORY_ROTATION_HAS_NO_SAFE_SLOT");
              for(const victim of victims) await tx.query("UPDATE agent_discovery_sources SET normalized_ingestion_version=$1 WHERE identity_id=$2 AND normalized_ingestion_version=$3",[archivedVersion,victim.id,version]);
              await tx.query(`UPDATE agent_discovery_sources s SET normalized_ingestion_version=$1 FROM erc8004_identities i
                WHERE s.identity_id=i.id AND i.namespace=$2 AND i.chain_id=$3 AND i.identity_registry=$4 AND i.agent_id=$5 AND s.normalized_ingestion_version=$6`,[version,identity.namespace,identity.chainId,identity.identityRegistry,identity.agentId,pendingVersion]);
              log({stage:"membership_rotation",activated:alreadyActive?null:identity.agentId,archived:victims.map(row=>row.agent_id),deleted:0,cap:maxAgents});
            }
          }
          await tx.query("COMMIT");
        } catch(error){await tx.query("ROLLBACK");throw error;}finally{tx.release();}
        if(fullScan && snapshot.registration.status==='resolved')await state.recordRetry(erc8004IdentityKey(identity),{stage:'published',errorCode:null,attemptedAt:new Date(),successDelayMs:86400000});
        if(fullScan && snapshot.registration.status==='unavailable')await state.recordRetry(erc8004IdentityKey(identity),{stage:'failed',errorCode:'DIRECTORY_METADATA_UNAVAILABLE',attemptedAt:new Date(),retryBaseDelayMs:300000,retryMaxDelayMs:86400000});
        counts.enriched++;
        log({stage:"enrichment",identity:erc8004IdentityKey(identity),name:snapshot.name,registration:snapshot.registration.status,card:snapshot.cardCheck.status,score:snapshot.scores.overall,feedback:snapshot.feedback.count,progress:counts.enriched+counts.failed,total:members.length});
      }catch(error){counts.failed++; if(fullScan) await state.recordRetry(erc8004IdentityKey(identity),{stage:"failed",errorCode:safeCode(error),attemptedAt:new Date(),retryBaseDelayMs:300000,retryMaxDelayMs:86400000}); log({stage:"enrichment",step:stage,identity:erc8004IdentityKey(identity),error:safeCode(error)}); if(fullScan && safeCode(error)==="SCAN_RATE_LIMITED") break;}
    }
    members=(await pool.query(memberQuery,[version,[]])).rows;
    log({status:counts.failed?"partial":"completed",cap:fullScan?null:maxAgents,members:members.length,...counts});
  } finally {await guard.query("SELECT pg_advisory_unlock(8004100)");guard.release();await pool.end();}
}
main().catch(error=>{log({status:"failed",error:safeCode(error)});process.exitCode=1;});
