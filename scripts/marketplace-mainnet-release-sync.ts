/** Local additive admission / read-only health refresh. No signer, funded
 * notification, task execution, chain transaction or destructive SQL. */
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { canonicalSha256Hex } from "../packages/domain/src/index.ts";
import { AgentIngestionService, PostgresIngestionRepository, JsonRpcClient, JsonRpcRegistryChainReader, createOfficialErc8004RegistryReadDefinitions, HttpServiceProbeTransport, BoundedMetadataResolver } from "../packages/agent-ingestion/src/index.ts";
import { directoryObservationType, directorySnapshotSchema, directorySlug, normalizeDirectorySnapshot, serviceVerificationSchema, serviceVerificationObservationType } from "../packages/agent-ingestion/src/directory.ts";
import { Erc8183AltanaAdapter } from "../packages/agent-commerce/src/chain.ts";
import { commercePinFromStandardsLock } from "../apps/web/src/lib/commerce-server.ts";
import { createExternalSellerReadinessResolver } from "../apps/web/src/lib/external-seller-provider.ts";
import { mainnetSellerProfiles } from "../apps/web/src/lib/mainnet-seller-catalog.ts";
import type { CommerceProviderReadinessInput } from "../apps/web/src/lib/commerce-reservations.ts";

async function main() {
  if (process.env.MAINNET_SELLER_SYNC_ENABLED !== "true") return;
  const refreshOnly = process.env.MAINNET_SELLER_REFRESH_ONLY === "true";
  const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8"));
  const deployment = lock.networks["56"].erc8183;
  const pin = commercePinFromStandardsLock(lock, 56);
  const rpcUrl = process.env.BSC_MAINNET_RPC_URL ?? "";
  const chain = new Erc8183AltanaAdapter({ pin, standardsLock: lock, externalMainnetBrowserEnabled: true, runtimeEnvironment: "preview" });
  await chain.verifyNetwork();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const guard = await pool.connect();
  const results: Record<string, unknown>[] = [];
  try {
    if (!(await guard.query("SELECT pg_try_advisory_lock(8004102) AS acquired")).rows[0]?.acquired) return;
    const reader = new JsonRpcRegistryChainReader({ chainId: 56, identityRegistry: lock.networks["56"].erc8004.identityRegistry,
      client: new JsonRpcClient(rpcUrl, { timeoutMs: 12000 }), ...createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: lock.networks["56"].erc8004.abiHashes.identityRegistry }), readConsistency: "finalized" });
    const ingestion = new AgentIngestionService(new PostgresIngestionRepository(pool));
    const resolver = createExternalSellerReadinessResolver({ pin, routerContract: deployment.routerProxy, policyContract: deployment.policy, rpcUrl });
    const pending = [];
    for (const profile of mainnetSellerProfiles) {
      try {
      const identity = { namespace: "eip155", chainId: 56, identityRegistry: lock.networks["56"].erc8004.identityRegistry, agentId: profile.agentId };
      if (!refreshOnly) {
        // Vendor indexing is optional. This primary-source fallback records
        // unknown vendor metrics, never invented score/feedback/availability.
        const present = await pool.query(`SELECT a.id FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id WHERE i.chain_id=56 AND i.identity_registry=$1 AND i.agent_id=$2 AND EXISTS(SELECT 1 FROM agent_versions v JOIN agent_enrichment_observations eo ON eo.agent_version_id=v.id WHERE v.agent_id=a.id AND eo.observation_type=$3)`, [identity.identityRegistry, identity.agentId, directoryObservationType]);
        if (!present.rows.length) {
          const sourceUrl = `https://bscscan.com/token/${identity.identityRegistry}?a=${identity.agentId}`;
          await ingestion.ingestCandidate({ identity, source: "manual", sourceReference: sourceUrl, observedAt: new Date(), normalizedIngestionVersion: "bnbera-directory-pending-v1" });
          const canonical = await ingestion.reconcileIdentity(reader, identity, "mainnet-primary-source-fallback");
          if (!canonical.agentUri || canonical.agentWallet?.toLowerCase() !== profile.wallet.toLowerCase()) throw new Error("PRIMARY_IDENTITY_UNAVAILABLE");
          const resolved = await new BoundedMetadataResolver({ timeoutMs: 8000, maxBytes: 1048576 }).resolve(canonical.agentUri, canonical.contentDigest);
          const snapshot = directorySnapshotSchema.parse({ ...normalizeDirectorySnapshot({ chain_id: 56, contract_address: identity.identityRegistry, token_id: identity.agentId }, resolved.document), sourceUrl, sourceLabel: "Finalized ERC-8004 registry", registration: { status: "resolved", uri: canonical.agentUri, digest: resolved.contentDigest, reason: null } });
          await guard.query("BEGIN");
          try {
            const a = (await guard.query(`SELECT a.id,i.id AS identity_id FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id WHERE i.chain_id=56 AND i.identity_registry=$1 AND i.agent_id=$2 FOR UPDATE OF a`, [identity.identityRegistry, identity.agentId])).rows[0];
            const v = (await guard.query(`INSERT INTO agent_versions(agent_id,version,public_metadata,capability_manifest,pricing_manifest) VALUES($1,(SELECT COALESCE(MAX(version),0)+1 FROM agent_versions WHERE agent_id=$1),$2,$3,$4) RETURNING id`, [a.id, JSON.stringify({ name: snapshot.name, description: snapshot.description, directoryOnly: true }), JSON.stringify({ schemaVersion: "bnbera-directory-v1", capabilities: [] }), JSON.stringify({ model: "unavailable" })])).rows[0];
            await guard.query(`INSERT INTO agent_enrichment_observations(agent_version_id,provider,observation_type,normalized_payload,source_timestamp,source_block,freshness,validation_state,payload_digest) VALUES($1,'bnbera-registry-review',$2,$3,$4,$5,'fresh','valid',$6)`, [v.id, directoryObservationType, JSON.stringify(snapshot), snapshot.fetchedAt, canonical.observedBlock, canonicalSha256Hex(snapshot)]);
            const active = (await guard.query(`SELECT i.id,i.agent_id FROM erc8004_identities i WHERE i.chain_id=56 AND EXISTS(SELECT 1 FROM agent_discovery_sources s WHERE s.identity_id=i.id AND s.normalized_ingestion_version='bnbera-directory-v1') ORDER BY i.agent_id::numeric DESC`)).rows;
            const additions = active.some(member => member.id === a.identity_id) ? 0 : 1;
            const victims = active.filter(member => !mainnetSellerProfiles.some(p => p.agentId === member.agent_id) && !["45422", "49637", "341628"].includes(member.agent_id)).slice(0, Math.max(0, active.length + additions - 80));
            if (active.length + additions - victims.length > 80) throw new Error("NO_SAFE_MEMBERSHIP_SLOT");
            for (const victim of victims) await guard.query(`UPDATE agent_discovery_sources SET normalized_ingestion_version='bnbera-directory-archived-v1' WHERE identity_id=$1 AND normalized_ingestion_version='bnbera-directory-v1'`, [victim.id]);
            await guard.query(`UPDATE agent_discovery_sources SET normalized_ingestion_version='bnbera-directory-v1' WHERE identity_id=$1 AND normalized_ingestion_version='bnbera-directory-pending-v1'`, [a.identity_id]);
            await guard.query("COMMIT");
            console.log(JSON.stringify({ status: "primary_registry_fallback", agentId: profile.agentId, archived: victims.map(victim => victim.agent_id), deleted: 0 }));
          } catch (cause) { await guard.query("ROLLBACK"); throw cause; }
        }
      }
      const rows = await pool.query(`SELECT a.id,a.identity_id,a.current_version_id,a.listing_status,a.verification_status,a.runtime_status,a.authority_status,
        v.id AS latest_version_id,v.version,v.public_metadata,v.capability_manifest,v.pricing_manifest,
        (SELECT eo.normalized_payload FROM agent_enrichment_observations eo JOIN agent_versions ev ON ev.id=eo.agent_version_id
          WHERE ev.agent_id=a.id AND eo.observation_type=$2 AND eo.validation_state='valid' ORDER BY eo.source_timestamp DESC LIMIT 1) AS snapshot
        FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id
        JOIN LATERAL (SELECT * FROM agent_versions WHERE agent_id=a.id ORDER BY version DESC LIMIT 1) v ON TRUE
        WHERE i.chain_id=56 AND i.identity_registry=$3 AND i.agent_id=$1`, [profile.agentId, directoryObservationType, identity.identityRegistry]);
      const row = rows.rows[0];
      if (!row || ["delisted", "suspended"].includes(row.listing_status) || row.verification_status === "rejected" || row.runtime_status === "paused" || row.authority_status !== "none") throw new Error("CATALOG_PREREQUISITE_MISSING");
      if (refreshOnly && (row.public_metadata.mainnetSellerReviewDigest !== canonicalSha256Hex(profile) || row.current_version_id !== row.latest_version_id)) throw new Error("SELLER_NOT_ADMITTED");
      const snapshot = directorySnapshotSchema.parse(row.snapshot);
      if (!snapshot.services.some(service => service.name.toLowerCase() === "a2a" && service.url === profile.card)) throw new Error("REGISTERED_SERVICE_MISMATCH");
      const canonical = await ingestion.reconcileIdentity(reader, identity, "mainnet-seller-review");
      if (canonical.agentWallet?.toLowerCase() !== profile.wallet.toLowerCase()) throw new Error("FINALIZED_WALLET_MISMATCH");
      const probe = await new HttpServiceProbeTransport().probe({ kind: "a2a", url: profile.card, timeoutMs: 8000, maxResponseBytes: 1048576 });
      const observedAt = new Date().toISOString();
      const healthy = probe.contractStatus === "healthy" && Array.isArray(probe.safeCapabilityProbe?.invocationUrls) && probe.safeCapabilityProbe.invocationUrls.includes(profile.endpoint);
      if (!healthy) {
        await pool.query(`INSERT INTO agent_service_probe_results(identity_id,kind,url,validation_status,status_code,latency_ms,error_code,observed_at) VALUES($1,'a2a',$2,'unhealthy',$3,$4,'MAINNET_CARD_UNAVAILABLE',$5)`, [row.identity_id, profile.card, probe.statusCode, probe.latencyMs, observedAt]);
        if (refreshOnly) { results.push({ agentId: profile.agentId, status: "unavailable" }); continue; }
        throw new Error("MAINNET_CARD_UNAVAILABLE");
      }
      const readiness: CommerceProviderReadinessInput = { identity, ownerAddress: canonical.ownerAddress, ownerObservedBlock: canonical.ownerObservedBlock,
        agentWallet: canonical.agentWallet, agentWalletObservedBlock: canonical.agentWalletObservedBlock, identityObservedBlock: canonical.observedBlock,
        identityObservedBlockHash: canonical.observedBlockHash, identityReadConsistency: canonical.readConsistency, providerAddress: profile.wallet,
        service: { kind: "a2a", url: profile.card, protocolVersion: "0.3.0", observedAt, probeObservedAt: observedAt }, chainId: 56,
        commerceContract: pin.commerceContract, paymentToken: pin.paymentToken, paymentDecimals: pin.paymentDecimals,
        priceAtomic: String(row.pricing_manifest.amountAtomic ?? row.pricing_manifest.minAtomic ?? "1"), authorityStatus: "none", version: { id: row.latest_version_id, number: row.version } };
      await resolver.resolve(readiness);
      const offer = refreshOnly ? undefined : await resolver.negotiate!(readiness, profile.exampleTask);
      pending.push({ profile, row, snapshot, probe, observedAt, offer });
      results.push({ agentId: profile.agentId, status: refreshOnly ? "card_and_identity_verified" : "signed_offer_verified", priceAtomic: offer?.priceAtomic, historicalJobId: profile.historicalJobId });
      console.log(JSON.stringify(results.at(-1)));
      } catch (cause) {
        if (!refreshOnly) throw cause;
        // One changed/offline seller must not prevent the other independent
        // sellers' valid probes from being refreshed. Never republish it.
        await pool.query(`INSERT INTO agent_service_probe_results(identity_id,kind,url,validation_status,error_code,observed_at)
          SELECT id,'a2a',$3,'unhealthy','MAINNET_READINESS_CHANGED',now() FROM erc8004_identities WHERE chain_id=56 AND identity_registry=$1 AND agent_id=$2`, [identityRegistryAddress(lock), profile.agentId, profile.card]);
        results.push({ agentId: profile.agentId, status: "unavailable", reason: "MAINNET_READINESS_CHANGED" });
        console.log(JSON.stringify(results.at(-1)));
      }
    }
    if (!refreshOnly && pending.length !== 10) throw new Error("TEN_SUPPORTED_SELLERS_REQUIRED");
    await guard.query("BEGIN");
    const rollback = [];
    try {
      for (const item of pending) {
        const { profile, row, snapshot, probe, observedAt, offer } = item;
        let versionId = row.current_version_id ?? row.latest_version_id;
        const reviewDigest = canonicalSha256Hex(profile);
        rollback.push({ agentId: profile.agentId, before: { currentVersionId: row.current_version_id, listingStatus: row.listing_status, verificationStatus: row.verification_status, runtimeStatus: row.runtime_status } });
        const locked = (await guard.query(`SELECT a.current_version_id,a.listing_status,a.verification_status,a.runtime_status,a.authority_status,
          (SELECT id FROM agent_versions WHERE agent_id=a.id ORDER BY version DESC LIMIT 1) AS latest_version_id
          FROM agents a WHERE a.id=$1 FOR UPDATE`, [row.id])).rows[0];
        if (!locked || ["current_version_id", "latest_version_id", "listing_status", "verification_status", "runtime_status", "authority_status"].some(key => locked[key] !== row[key]) ||
            ["delisted", "suspended"].includes(locked.listing_status) || locked.verification_status === "rejected" || locked.authority_status !== "none") {
          throw new Error("SELLER_CHANGED_DURING_REVIEW");
        }
        if (!refreshOnly && row.public_metadata.mainnetSellerReviewDigest !== reviewDigest) {
          const version = (await guard.query(`INSERT INTO agent_versions(agent_id,version,public_metadata,capability_manifest,pricing_manifest)
            VALUES($1,(SELECT COALESCE(MAX(version),0)+1 FROM agent_versions WHERE agent_id=$1),$2,$3,$4) RETURNING id`,
          [row.id, JSON.stringify({ ...row.public_metadata, name: snapshot.name, description: snapshot.description, slug: directorySlug(snapshot), mainnetSellerReviewDigest: reviewDigest, deliveryHistory: profile.historicalJobId ? "historical_result_verified" : "unverified" }),
            JSON.stringify(row.capability_manifest), JSON.stringify({ model: "fixed", network: 56, tokenAddress: pin.paymentToken, tokenSymbol: "U", decimals: pin.paymentDecimals, amountAtomic: offer!.priceAtomic, minAtomic: offer!.priceAtomic, maxAtomic: offer!.priceAtomic, observedAt, priceSource: "provider-signed-offer; fresh quote required" })])).rows[0];
          versionId = version.id;
        }
        await guard.query(`INSERT INTO agent_services(agent_version_id,kind,url,protocol_version,discovery_source,validation_status,observed_at,latency_ms,safe_capability_probe)
          VALUES($1,'a2a',$2,'0.3.0','manual','healthy',$3,$4,$5) ON CONFLICT(agent_version_id,kind,url) DO UPDATE SET validation_status='healthy',observed_at=excluded.observed_at,latency_ms=excluded.latency_ms,safe_capability_probe=excluded.safe_capability_probe,"updatedAt"=now()`, [versionId, profile.card, observedAt, probe.latencyMs, JSON.stringify(probe.safeCapabilityProbe)]);
        await guard.query(`INSERT INTO agent_service_probe_results(identity_id,kind,url,validation_status,status_code,latency_ms,safe_capability_probe,observed_at) VALUES($1,'a2a',$2,'healthy',$3,$4,$5,$6)`, [row.identity_id, profile.card, probe.statusCode, probe.latencyMs, JSON.stringify(probe.safeCapabilityProbe), observedAt]);
        const check = serviceVerificationSchema.parse({ name: snapshot.services.find(service => service.url === profile.card)!.name, url: profile.card, protocol: "a2a", status: "verified", checkedAt: observedAt, expiresAt: new Date(Date.parse(observedAt) + 120000).toISOString(),
          latencyMs: probe.latencyMs ?? null, httpStatus: probe.statusCode ?? null, reason: null, source: "bnbera-protocol-verifier-v1", protocolVersion: probe.safeCapabilityProbe?.protocolVersion ?? null,
          capabilityCount: probe.safeCapabilityProbe?.skillCount ?? null, capabilityNames: [], invocationUrls: [profile.endpoint], responseDigest: probe.safeCapabilityProbe?.agentCardDigest ?? null, evidence: "agent-card-schema" });
        const evidence = { services: [check] };
        await guard.query(`INSERT INTO agent_enrichment_observations(agent_version_id,provider,observation_type,normalized_payload,source_timestamp,freshness,validation_state,payload_digest) VALUES($1,'bnbera-protocol-verifier',$2,$3,$4,'fresh','valid',$5)`, [versionId, serviceVerificationObservationType, JSON.stringify(evidence), observedAt, canonicalSha256Hex(evidence)]);
        if (!refreshOnly) await guard.query(`UPDATE agents SET current_version_id=$2,listing_status='published',verification_status='verified',runtime_status='live',"updatedAt"=now() WHERE id=$1`, [row.id, versionId]);
        else if (row.runtime_status === "unavailable") await guard.query(`UPDATE agents SET runtime_status='live',"updatedAt"=now() WHERE id=$1 AND runtime_status='unavailable'`, [row.id]);
      }
      // Preserve an exact local recovery record before committing promotion.
      if (!refreshOnly) await writeFile(new URL(`../.runtime/mainnet-supply-upgrade/seller-integration-${Date.now()}.json`, import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), results, offers: pending.map(item => ({ agentId: item.profile.agentId, quote: item.offer })), rollback, transaction: "prepared", scope: "seller promotion only; primary-source fallback membership additions are separately committed and logged", chainWrites: false, fundedNotifications: false }, null, 2), { mode: 0o600 });
      await guard.query("COMMIT");
      console.log(JSON.stringify({ status: "committed", reviewed: pending.length, refreshOnly, deleted: 0, chainWrites: false }));
    } catch (cause) { await guard.query("ROLLBACK"); throw cause; }
  } finally { await guard.query("SELECT pg_advisory_unlock(8004102)"); guard.release(); await pool.end(); }
}
function identityRegistryAddress(lock: { networks: Record<string, { erc8004: { identityRegistry: string } }> }): string { return lock.networks["56"]!.erc8004.identityRegistry; }
main().catch(error => { console.error(JSON.stringify({ status: "failed", reason: typeof error?.code === "string" && /^[A-Z_]+$/u.test(error.code) ? error.code : /^[A-Z_]+$/u.test(error?.message ?? "") ? error.message : "MAINNET_SELLER_SYNC_FAILED" })); process.exitCode = 1; });
