import { createHash } from "node:crypto";
import {
  AgentIngestionService,
  PostgresIngestionRepository,
  type ClaimEvent,
  type ClaimMutation,
  type IdentityCandidate
} from "../packages/agent-ingestion/src/index.ts";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required for the PostgreSQL ingestion smoke test.");
}

const registry = "0x8004a818bfb912233c491871b3d84c89a494bd9e";
const chainId = 97;
const identity = {
  namespace: "erc8004",
  chainId,
  identityRegistry: registry,
  // A high, deterministic test-only token id avoids colliding with fixtures.
  agentId: (9_000_000_000_000_000n + BigInt(Date.now())).toString(10)
} as const;
const owner = "0x1111111111111111111111111111111111111111";
const agentWallet = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"ab".repeat(32)}`;
const transactionHash = `0x${createHash("sha256").update(`bnbera-postgres-smoke:${identity.agentId}`).digest("hex")}`;
const contentDigest = createHash("sha256").update("bnbera-postgres-smoke").digest("hex");
const observedAt = new Date("2026-01-01T00:00:00.000Z");
const identityKey = [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId].join(":");

const repository = new PostgresIngestionRepository(databaseUrl, { now: () => observedAt });
try {
  const service = new AgentIngestionService(repository, { internalOperatorId: "postgres-smoke" });
  const candidate: IdentityCandidate = {
    identity,
    source: "manual",
    sourceReference: `postgres-smoke:${identity.agentId}`,
    observedAt,
    normalizedIngestionVersion: "postgres-smoke-v1",
    metadata: { name: "PostgreSQL smoke identity", purpose: "durable-adapter-test" },
    services: [{ kind: "a2a", url: "https://example.com/bnbera-smoke", protocolVersion: "0.3" }],
    capabilityManifest: { schemaVersion: "bnbera.capability/v1", capabilities: ["smoke"] }
  };

  const ingested = await service.ingestCandidate(candidate);
  const eventResult = await service.ingestRegistryEvents([
    {
      identity,
      eventType: "Registered",
      transactionHash,
      logIndex: 0,
      blockNumber: 10,
      blockHash,
      ownerAddress: owner,
      agentWallet,
      agentUri: "https://example.com/bnbera-smoke.json",
      contentDigest,
      changedFields: ["ownerAddress", "agentWallet", "agentUri", "contentDigest"],
      observedAt
    }
  ], { chainId, identityRegistry: registry });

  const promoted = await repository.withTransaction(async (unit) => {
    const canonical = await unit.markCanonical({
      chainId,
      identityRegistry: registry,
      throughBlock: 10,
      canonicalizedAt: observedAt
    });
    return unit.applyCanonicalState({
      identity,
      ownerAddress: owner,
      agentWallet,
      agentUri: "https://example.com/bnbera-smoke.json",
      contentDigest,
      observedBlock: 10,
      observedBlockHash: blockHash,
      readConsistency: "finalized",
      ownerObservedBlock: 10,
      agentWalletObservedBlock: 10,
      agentUriObservedBlock: 10,
      contentDigestObservedBlock: 10
    }).then((record) => ({ record, canonicalCount: canonical.length }));
  });

  const claimTime = new Date("2026-01-01T00:01:00.000Z");
  const claim: ClaimMutation = {
    identityKey,
    expectedVersion: null,
    expectedStatus: null,
    expectedOwnerAddress: owner,
    expectedCanonicalRead: { observedBlock: 10, observedBlockHash: blockHash, readConsistency: "finalized" },
    claim: {
      identityKey,
      version: 1,
      status: "claimed",
      claimantAddress: owner,
      ownerAddressAtVerification: owner,
      agentWalletAtVerification: agentWallet,
      verifiedAt: claimTime,
      staleAt: null,
      lastReason: "claimed",
      verificationObservedBlock: 10,
      verificationObservedBlockHash: blockHash,
      verificationReadConsistency: "finalized"
    },
    event: {
      identityKey,
      eventType: "claimed",
      claimantAddress: owner,
      observedOwnerAddress: owner,
      observedAgentWallet: agentWallet,
      proofDigest: contentDigest,
      actorType: "owner",
      actorId: owner,
      reason: "PostgreSQL adapter smoke test",
      occurredAt: claimTime
    } satisfies ClaimEvent,
    actor: { type: "owner", walletAddress: owner, proofDigest: contentDigest }
  };
  await repository.mutateClaim(claim);

  const checkpoint = await repository.saveCheckpoint({
    chainId,
    identityRegistry: registry,
    indexerVersion: "postgres-smoke-v1",
    lastScannedBlock: 10,
    lastScannedBlockHash: blockHash,
    lastFinalizedBlock: 10,
    lastFinalizedBlockHash: blockHash,
    confirmationThreshold: 1,
    cursorVersion: 1,
    lastReconciliationAt: null
  }, { expectedCursorVersion: null, expectedLastScannedBlockHash: null });

  await repository.appendProbeResult({
    identityKey,
    kind: "a2a",
    url: "https://example.com/bnbera-smoke",
    validationStatus: "healthy",
    statusCode: 200,
    latencyMs: 5,
    safeCapabilityProbe: { smoke: true },
    errorCode: null,
    observedAt
  });

  const reopened = new PostgresIngestionRepository(databaseUrl, { now: () => observedAt });
  try {
    const persisted = await reopened.findIdentity(identity);
    const persistedClaim = await reopened.getClaim(identityKey);
    const persistedSources = await reopened.listSources(identityKey);
    const persistedServices = await reopened.listServices(identityKey);
    const persistedObservations = await reopened.listObservations({ chainId, identityRegistry: registry });
    const persistedProbes = await reopened.listProbeResults(identityKey);
    if (persisted === null || persistedClaim?.status !== "claimed" || persistedSources.length < 1 || persistedServices.length < 1 || persistedObservations.length < 1 || persistedProbes.length < 1) {
      throw new Error(`Durable ingestion assertions failed after reopening the pool: identity=${persisted !== null} claim=${persistedClaim?.status ?? "none"} sources=${persistedSources.length} services=${persistedServices.length} observations=${persistedObservations.length} probes=${persistedProbes.length}`);
    }
    console.log(JSON.stringify({
      ok: true,
      identityKey,
      ingestedIdentityId: ingested.identity.id,
      registryObservationCount: eventResult.observations.length,
      promotedCount: promoted.canonicalCount,
      claimStatus: persistedClaim.status,
      checkpointVersion: checkpoint.cursorVersion,
      sourceCount: persistedSources.length,
      serviceCount: persistedServices.length,
      probeCount: persistedProbes.length
    }));
  } finally {
    await reopened.close();
  }
} finally {
  await repository.close();
}
