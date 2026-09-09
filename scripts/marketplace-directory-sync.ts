/** Bounded, restart-safe read-only-chain ingestion into the existing PostgreSQL store. */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { canonicalSha256Hex, erc8004IdentityKey } from "../packages/domain/src/index.ts";
import { AgentIngestionService, PostgresIngestionRepository, EightHundredFourScanHttpClient,
  JsonRpcClient, JsonRpcRegistryChainReader, createOfficialErc8004RegistryReadDefinitions,
  BoundedMetadataResolver, classifyAgent } from "../packages/agent-ingestion/src/index.ts";
import { directoryObservationType, directorySnapshotSchema, normalizeDirectorySnapshot,
  publicRecord, publicText, publicDate } from "../packages/agent-ingestion/src/directory.ts";

const version = "bnbera-directory-v1";
const maxAgents = Math.min(100, Math.max(1, Number(process.env.MARKETPLACE_DIRECTORY_LIMIT ?? "100")));
const safeCode = (error: unknown) => {
  const code = publicRecord(error).code;
  return typeof code === "string" && /^(?:[A-Z][A-Z0-9_]{2,63}|[0-9A-Z]{5})$/u.test(code) ? code : "DIRECTORY_SOURCE_UNAVAILABLE";
};
const log = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function main() {
  if (process.env.MARKETPLACE_DIRECTORY_SYNC_ENABLED !== "true") { log({status:"disabled"}); return; }
  if (!Number.isSafeInteger(maxAgents)) throw new Error("INVALID_DIRECTORY_CAP");
  const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json",import.meta.url),"utf8"));
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, max:4});
  const guard = await pool.connect();
  if (!(await guard.query("SELECT pg_try_advisory_lock(8004100) AS acquired")).rows[0]?.acquired) { guard.release(); await pool.end(); log({status:"already_running"}); return; }
  const repository = new PostgresIngestionRepository(pool);
  const ingest = new AgentIngestionService(repository);
  const client = EightHundredFourScanHttpClient.fromEnvironment(process.env,{timeoutMs:15000,maxRetries:2,minRequestIntervalMs:2200,maxResponseBytes:4*1024*1024});
  const resolver = new BoundedMetadataResolver({timeoutMs:8000,maxBytes:1024*1024,ipfsGateways:(process.env.ERC8004_IPFS_GATEWAYS??"").split(",").filter(Boolean)});
  try {
    // Membership is the persisted source marker. It survives a crash before metadata is ready.
    const memberQuery = `SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id FROM erc8004_identities i
      WHERE EXISTS (SELECT 1 FROM agent_discovery_sources s WHERE s.identity_id=i.id AND s.normalized_ingestion_version=$1)
      ORDER BY i.chain_id, i.agent_id::numeric`;
    let members = (await pool.query(memberQuery,[version])).rows;
    for (const chainId of [56,97]) {
      const quota = chainId === 56 ? Math.ceil(maxAgents*0.8) : Math.floor(maxAgents*0.2);
      const registry = lock.networks[String(chainId)].erc8004.identityRegistry;
      const keys = new Set(members.filter(m=>m.chain_id===chainId).map(m=>String(m.agent_id)));
      const add = async (raw: unknown) => {
        const v = publicRecord(raw); const tokenId = String(v.token_id);
        if (keys.size >= quota || keys.has(tokenId) || v.chain_id !== chainId || String(v.contract_address).toLowerCase() !== registry || !/^\d+$/u.test(tokenId)) return;
        const identity = {namespace:"eip155",chainId,identityRegistry:registry,agentId:tokenId};
        await ingest.ingestCandidate({identity,source:"8004scan",sourceReference:`https://8004scan.io/agents/${chainId===56?"bsc":"bsc-testnet"}/${tokenId}`,observedAt:new Date(),rawResponseDigest:canonicalSha256Hex(raw),normalizedIngestionVersion:version});
        keys.add(tokenId);
      };
      // Keep the user-specified reference and the retained useful testnet examples in scope.
      for (const id of chainId===56?["341628"]:["2206","2283"]) {
        if(keys.size>=quota) break;
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
      members=(await pool.query(memberQuery,[version])).rows;
    }
    const counts={enriched:0,failed:0,metadataResolved:0,cardsReachable:0};
    const complete = new Set((await pool.query(`SELECT DISTINCT i.chain_id || ':' || i.agent_id AS key
      FROM agent_enrichment_observations eo JOIN agent_versions v ON v.id=eo.agent_version_id
      JOIN agents a ON a.id=v.agent_id JOIN erc8004_identities i ON i.id=a.identity_id
      WHERE eo.observation_type=$1 AND eo.validation_state='valid'`,[directoryObservationType])).rows.map(row=>row.key));
    const refresh = members.filter(member=>process.env.MARKETPLACE_DIRECTORY_ONLY_MISSING!=="true" || !complete.has(`${member.chain_id}:${member.agent_id}`));
    for (const member of refresh.slice(0,Math.min(maxAgents,Number(process.env.MARKETPLACE_DIRECTORY_MAX_REFRESH??100)))) {
      const identity={namespace:member.namespace,chainId:member.chain_id,identityRegistry:member.identity_registry,agentId:member.agent_id};
      let stage="vendor_detail";
      try {
        const raw=await client.getCandidateByIdentity(identity);
        const vendor=publicRecord(raw);
        if(vendor.chain_id!==identity.chainId||String(vendor.token_id)!==identity.agentId||String(vendor.contract_address).toLowerCase()!==identity.identityRegistry) throw new Error("DIRECTORY_IDENTITY_MISMATCH");
        stage="registry_read";
        const ercLock=lock.networks[String(identity.chainId)].erc8004;
        const endpoint=process.env[identity.chainId===56?"BSC_MAINNET_RPC_URL":"BSC_TESTNET_RPC_URL"];
        if(!endpoint) throw new Error("DIRECTORY_RPC_MISSING");
        const reader=new JsonRpcRegistryChainReader({chainId:identity.chainId,identityRegistry:identity.identityRegistry,client:new JsonRpcClient(endpoint,{timeoutMs:15000}),...createOfficialErc8004RegistryReadDefinitions({expectedAbiSha256:ercLock.abiHashes.identityRegistry}),readConsistency:"finalized"});
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
        if((snapshot.feedback.count??0)>0) {
          try {
            const params=new URLSearchParams({chain_id:String(identity.chainId),agent_token_id:identity.agentId,limit:"5",offset:"0",is_testnet:String(identity.chainId===97),sort_by:"submitted_at",sort_order:"desc"});
            const response=await fetch(`https://api.8004scan.io/api/v1/feedbacks?${params}`,{headers:process.env.EIGHTSCAN_API_KEY?{"X-API-Key":process.env.EIGHTSCAN_API_KEY}:{},signal:AbortSignal.timeout(10000)});
            if(response.ok) {const body=publicRecord(await response.json());const list=Array.isArray(body.items)?body.items:[];snapshot={...snapshot,feedback:{...snapshot.feedback,items:list.flatMap(item=>{const f=publicRecord(item);if(f.is_revoked===true||f.revoked===true)return [];return [{reviewer:publicText(f.client_address??f.reviewer_address,160),value:publicText(String(f.value??f.score??""),100),comment:publicText(f.comment??f.text??f.feedback),tag:publicText(f.tag1??f.tag,128),observedAt:publicDate(f.submitted_at??f.created_at)}];})}};}
          }catch {/* Optional feedback does not withhold the registered profile. */}
        }
        stage="validate_snapshot";
        snapshot=directorySnapshotSchema.parse(snapshot);
        const category=classifyAgent({name:snapshot.name,description:snapshot.description,supportedProtocols:snapshot.protocols,advertisedSkills:snapshot.skills}).category;
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
            SELECT $1::uuid,'8004scan',$2::varchar,$3::jsonb,$4::timestamptz,$5::bigint,'fresh','valid',$6::varchar WHERE NOT EXISTS(SELECT 1 FROM agent_enrichment_observations WHERE agent_version_id=$1::uuid AND observation_type=$2::varchar AND payload_digest=$6::varchar)`,[v.id,directoryObservationType,payload,snapshot.fetchedAt,canonical.observedBlock,payloadDigest]);
          await tx.query("COMMIT");
        } catch(error){await tx.query("ROLLBACK");throw error;}finally{tx.release();}
        counts.enriched++;
        log({stage:"enrichment",identity:erc8004IdentityKey(identity),name:snapshot.name,registration:snapshot.registration.status,card:snapshot.cardCheck.status,score:snapshot.scores.overall,feedback:snapshot.feedback.count,progress:counts.enriched+counts.failed,total:members.length});
      }catch(error){counts.failed++;log({stage:"enrichment",step:stage,identity:erc8004IdentityKey(identity),error:safeCode(error)});}
    }
    log({status:counts.failed?"partial":"completed",cap:maxAgents,members:members.length,...counts});
  } finally {await guard.query("SELECT pg_advisory_unlock(8004100)");guard.release();await pool.end();}
}
main().catch(error=>{log({status:"failed",error:safeCode(error)});process.exitCode=1;});
