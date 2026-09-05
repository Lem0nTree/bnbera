import { createHash, randomUUID } from "node:crypto";

import {
  AgentIngestionService,
  PostgresIngestionRepository,
  type ClaimEvent,
  type ClaimMutation,
  type IdentityCandidate
} from "../packages/agent-ingestion/src/index.ts";
import { createDb, migrateDb } from "../packages/db/src/client.ts";
import { erc8004IdentityKey, type Erc8004Identity } from "../packages/domain/src/index.ts";

const MAX_SMOKE_RUNTIME_MS = 60_000;
const MAX_DB_CONNECTION_TIMEOUT_MS = 5_000;
const MAX_DB_QUERY_TIMEOUT_MS = 10_000;

class SmokeConfigurationError extends Error {
  public readonly code = "SMOKE_CONFIGURATION_INVALID";
}

class SmokeTimeoutError extends Error {
  public readonly code = "SMOKE_TIMEOUT";
}

class SmokeRollbackSentinel extends Error {
  public readonly code = "SMOKE_ROLLBACK_SENTINEL";
}

type SmokeCounts = {
  readonly sourceCount: number;
  readonly serviceCount: number;
  readonly capabilityCount: number;
  readonly observationCount: number;
  readonly probeCount: number;
  readonly claimEventCount: number;
  readonly registryReplayDuplicateCount: number;
  readonly promotedCount: number;
  readonly checkpointVersion: number;
};

type SmokeResult = {
  readonly identityKey: string;
  readonly expected: SmokeCounts;
  readonly actual: SmokeCounts;
  readonly checks: {
    readonly migrationReplay: boolean;
    readonly transactionRollback: boolean;
    readonly rollbackRowsAbsent: boolean;
    readonly discoveryReplayIdempotent: boolean;
    readonly registryReplayIdempotent: boolean;
    readonly persistenceRestart: boolean;
    readonly publicationOrVerificationSideEffect: false;
  };
};

type CleanupReport = {
  readonly deletedAgentRows: number;
  readonly deletedIdentityRows: number;
  readonly deletedCheckpointRows: number;
  readonly remainingRows: Readonly<Record<string, number>>;
};

function boundedDatabaseUrl(input: string): string {
  const value = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SmokeConfigurationError("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new SmokeConfigurationError("DATABASE_URL must use the PostgreSQL URL scheme.");
  }

  // pg accepts these connection-string parameters and applies the server-side
  // timeouts to every pooled session. This keeps a smoke run bounded without
  // printing or otherwise exposing the original credential-bearing URL.
  parsed.searchParams.set(
    "connection_timeout",
    String(Math.ceil(MAX_DB_CONNECTION_TIMEOUT_MS / 1_000))
  );
  parsed.searchParams.set("query_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("statement_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("lock_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set(
    "idle_in_transaction_session_timeout",
    String(MAX_DB_QUERY_TIMEOUT_MS)
  );
  return parsed.toString();
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const value = String((error as { readonly code?: unknown }).code ?? "UNKNOWN");
  return /^[A-Z0-9_]{1,64}$/u.test(value) ? value : "UNKNOWN";
}

function assertWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) {
    throw new SmokeTimeoutError("PostgreSQL ingestion smoke exceeded its bounded runtime.");
  }
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function cleanupTestRows(
  connectionString: string,
  databaseSsl: boolean,
  namespace: string,
  chainId: number,
  registry: string,
  agentId: string,
  indexerVersion: string
): Promise<CleanupReport> {
  const { pool } = createDb(connectionString, { ssl: databaseSsl });
  try {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      // Delete the projection first because agents intentionally restrict
      // identity deletion. Its dependent observations/provenance rows cascade.
      const deletedAgents = await client.query(
        `DELETE FROM agents
           WHERE identity_id IN (
             SELECT id FROM erc8004_identities
              WHERE namespace=$1 AND chain_id=$2 AND identity_registry=$3 AND agent_id=$4
           )`,
        [namespace, chainId, registry, agentId]
      );
      const deletedIdentities = await client.query(
        `DELETE FROM erc8004_identities
          WHERE namespace=$1 AND chain_id=$2 AND identity_registry=$3 AND agent_id=$4`,
        [namespace, chainId, registry, agentId]
      );
      const deletedCheckpoints = await client.query(
        `DELETE FROM chain_ingestion_checkpoints
          WHERE chain_id=$1 AND identity_registry=$2 AND indexer_version=$3`,
        [chainId, registry, indexerVersion]
      );
      await client.query("COMMIT");
      committed = true;

      // Verify cleanup after commit. A success line must never be emitted when
      // test rows were left behind, even if the ingestion assertions passed.
      const remainingResult = await client.query<{
        readonly identity_count: string;
        readonly agent_count: string;
        readonly source_count: string;
        readonly service_count: string;
        readonly capability_count: string;
        readonly observation_count: string;
        readonly probe_count: string;
        readonly claim_event_count: string;
        readonly checkpoint_count: string;
      }>(
        `WITH target_identity AS (
           SELECT id FROM erc8004_identities
            WHERE namespace=$1 AND chain_id=$2 AND identity_registry=$3 AND agent_id=$4
         ), target_agent AS (
           SELECT id FROM agents WHERE identity_id IN (SELECT id FROM target_identity)
         )
         SELECT
           (SELECT count(*) FROM target_identity)::text AS identity_count,
           (SELECT count(*) FROM target_agent)::text AS agent_count,
           (SELECT count(*) FROM agent_discovery_sources WHERE identity_id IN (SELECT id FROM target_identity))::text AS source_count,
           (SELECT count(*) FROM agent_service_observations WHERE identity_id IN (SELECT id FROM target_identity))::text AS service_count,
           (SELECT count(*) FROM agent_capability_observations WHERE identity_id IN (SELECT id FROM target_identity))::text AS capability_count,
           (SELECT count(*) FROM erc8004_chain_observations WHERE identity_id IN (SELECT id FROM target_identity))::text AS observation_count,
           (SELECT count(*) FROM agent_service_probe_results WHERE identity_id IN (SELECT id FROM target_identity))::text AS probe_count,
           (SELECT count(*) FROM agent_claim_events WHERE identity_id IN (SELECT id FROM target_identity))::text AS claim_event_count,
           (SELECT count(*) FROM chain_ingestion_checkpoints
              WHERE chain_id=$2 AND identity_registry=$3 AND indexer_version=$5)::text AS checkpoint_count`,
        [namespace, chainId, registry, agentId, indexerVersion]
      );
      const remainingRow = remainingResult.rows[0];
      if (remainingRow === undefined) {
        throw new Error("PostgreSQL ingestion smoke cleanup verification returned no row.");
      }
      const remainingRows = Object.fromEntries(
        Object.entries(remainingRow).map(([key, value]) => [key, Number(value)])
      );
      if (Object.values(remainingRows).some((value) => value !== 0)) {
        throw new Error("PostgreSQL ingestion smoke cleanup left test rows behind.");
      }
      return {
        deletedAgentRows: deletedAgents.rowCount ?? 0,
        deletedIdentityRows: deletedIdentities.rowCount ?? 0,
        deletedCheckpointRows: deletedCheckpoints.rowCount ?? 0,
        remainingRows
      };
    } catch {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the sanitized cleanup failure below.
        }
      }
      throw new Error("PostgreSQL ingestion smoke cleanup failed.");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function exerciseIngestion(
  connectionString: string,
  databaseSsl: boolean,
  runScope: string,
  namespace: string,
  chainId: number,
  registry: string,
  agentId: string,
  identity: Erc8004Identity,
  identityKey: string,
  owner: string,
  agentWallet: string,
  blockHash: string,
  transactionHash: string,
  contentDigest: string,
  observedAt: Date,
  serviceUrl: string,
  agentUri: string,
  indexerVersion: string,
  migrationReplay: boolean,
  deadline: number
): Promise<SmokeResult> {
  const repository = new PostgresIngestionRepository(connectionString, {
    now: () => observedAt,
    ssl: databaseSsl
  });
  try {
    const service = new AgentIngestionService(repository, { internalOperatorId: "postgres-smoke" });
    const candidate: IdentityCandidate = {
      identity,
      source: "manual",
      sourceReference: `postgres-smoke:${runScope}`,
      observedAt,
      normalizedIngestionVersion: "postgres-smoke-v3",
      metadata: { name: "PostgreSQL smoke identity", purpose: "durable-adapter-test" },
      services: [{ kind: "a2a", url: serviceUrl, protocolVersion: "0.3" }],
      capabilityManifest: {
        schemaVersion: "bnbera.capability/v1",
        capabilities: [{
          id: "smoke",
          description: "Persisted PostgreSQL ingestion smoke capability.",
          inputSchema: {},
          outputSchema: {},
          requiredProtocols: ["a2a"],
          allowedActions: ["read"]
        }]
      }
    };

    // Deliberately fail after writes inside one repository transaction. The
    // same identity is then ingested successfully below, proving rollback
    // rather than relying on cleanup to hide a partial commit.
    const rollbackSentinel = new SmokeRollbackSentinel("smoke rollback sentinel");
    let transactionRollback = false;
    try {
      await repository.withTransaction(async (unitOfWork) => {
        await service.ingestCandidatesWithinTransaction(unitOfWork, [candidate]);
        throw rollbackSentinel;
      });
      throw new Error("PostgreSQL ingestion smoke rollback transaction unexpectedly committed.");
    } catch (error) {
      if (error !== rollbackSentinel) throw error;
      transactionRollback = true;
    }
    const afterRollback = await repository.findIdentity(identity);
    const rollbackRowsAbsent = afterRollback === null;
    assertCondition(transactionRollback && rollbackRowsAbsent, "PostgreSQL ingestion transaction rollback was not durable.");

    assertWithinDeadline(deadline);
    // Replaying a discovery page must update the same identity/source/
    // service/capability rows rather than creating duplicates.
    const firstIngestion = await service.ingestCandidate(candidate);
    const replayIngestion = await service.ingestCandidate(candidate);
    const replaySources = await repository.listSources(identityKey);
    const replayServices = await repository.listServices(identityKey);
    const replayCapabilities = await repository.listCapabilities(identityKey);
    const discoveryReplayIdempotent =
      firstIngestion.identity.id === replayIngestion.identity.id &&
      replaySources.length === 1 &&
      replayServices.length === 1 &&
      replayCapabilities.length === 1;
    assertCondition(discoveryReplayIdempotent, "PostgreSQL discovery replay was not idempotent.");

    assertWithinDeadline(deadline);
    const event = {
      identity,
      eventType: "Registered",
      transactionHash,
      logIndex: 0,
      blockNumber: 10,
      blockHash,
      ownerAddress: owner,
      agentWallet,
      agentUri,
      contentDigest,
      changedFields: ["ownerAddress", "agentWallet", "agentUri", "contentDigest"] as const,
      observedAt
    };
    const firstEvents = await service.ingestRegistryEvents([event], { chainId, identityRegistry: registry });
    const replayEvents = await service.ingestRegistryEvents([event], { chainId, identityRegistry: registry });
    const registryReplayIdempotent =
      firstEvents.duplicateCount === 0 &&
      replayEvents.duplicateCount === 1 &&
      firstEvents.observations.length === 1 &&
      replayEvents.observations.length === 1;
    assertCondition(registryReplayIdempotent, "PostgreSQL registry event replay was not idempotent.");

    assertWithinDeadline(deadline);
    const promoted = await repository.withTransaction(async (unitOfWork) => {
      const canonical = await unitOfWork.markCanonical({
        chainId,
        identityRegistry: registry,
        throughBlock: 10,
        canonicalizedAt: observedAt
      });
      const record = await unitOfWork.applyCanonicalState({
        identity,
        ownerAddress: owner,
        agentWallet,
        agentUri,
        contentDigest,
        observedBlock: 10,
        observedBlockHash: blockHash,
        readConsistency: "finalized",
        ownerObservedBlock: 10,
        agentWalletObservedBlock: 10,
        agentUriObservedBlock: 10,
        contentDigestObservedBlock: 10
      });
      return { record, canonicalCount: canonical.length };
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
    await repository.withTransaction((unitOfWork) => unitOfWork.mutateClaim(claim));

    assertWithinDeadline(deadline);
    const checkpoint = await repository.saveCheckpoint({
      chainId,
      identityRegistry: registry,
      indexerVersion,
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
      url: serviceUrl,
      validationStatus: "healthy",
      statusCode: 200,
      latencyMs: 5,
      safeCapabilityProbe: { smoke: true },
      errorCode: null,
      observedAt
    });

    // A fresh repository instance must see all committed ingestion state.
    const reopened = new PostgresIngestionRepository(connectionString, {
      now: () => observedAt,
      ssl: databaseSsl
    });
    try {
      assertWithinDeadline(deadline);
      const persisted = await reopened.findIdentity(identity);
      const persistedClaim = await reopened.getClaim(identityKey);
      const persistedSources = await reopened.listSources(identityKey);
      const persistedServices = await reopened.listServices(identityKey);
      const persistedCapabilities = await reopened.listCapabilities(identityKey);
      const persistedObservations = await reopened.listObservations({ chainId, identityRegistry: registry });
      const persistedProbes = await reopened.listProbeResults(identityKey);
      const persistedClaimEvents = await reopened.listClaimEvents(identityKey);
      const persistedCheckpoint = await reopened.getCheckpoint(chainId, registry);
      const persistenceRestart = persisted !== null &&
        persisted.id === firstIngestion.identity.id &&
        persisted.originType === "manual_import" &&
        persisted.ownerAddress === owner &&
        persisted.agentWallet === agentWallet &&
        persistedClaim?.status === "claimed" &&
        persistedSources.length === 2 &&
        persistedServices.length === 1 &&
        persistedCapabilities.length === 1 &&
        persistedObservations.length === 1 &&
        persistedObservations[0]?.confirmationState === "canonical" &&
        persistedProbes.length === 1 &&
        persistedClaimEvents.length === 1 &&
        persistedCheckpoint?.cursorVersion === checkpoint.cursorVersion &&
        persisted.state.verificationStatus === "pending" &&
        persisted.state.runtimeStatus === "unavailable" &&
        persisted.state.authorityStatus === "none" &&
        persisted.state.listingStatus === "draft";
      assertCondition(persistenceRestart, "PostgreSQL ingestion state did not survive pool restart.");
      assertCondition(persistedCheckpoint !== null, "PostgreSQL checkpoint disappeared after persistence check.");

      const expected: SmokeCounts = {
        sourceCount: 2,
        serviceCount: 1,
        capabilityCount: 1,
        observationCount: 1,
        probeCount: 1,
        claimEventCount: 1,
        registryReplayDuplicateCount: 1,
        promotedCount: 1,
        checkpointVersion: 1
      };
      const actual: SmokeCounts = {
        sourceCount: persistedSources.length,
        serviceCount: persistedServices.length,
        capabilityCount: persistedCapabilities.length,
        observationCount: persistedObservations.length,
        probeCount: persistedProbes.length,
        claimEventCount: persistedClaimEvents.length,
        registryReplayDuplicateCount: replayEvents.duplicateCount,
        promotedCount: promoted.canonicalCount,
        checkpointVersion: persistedCheckpoint.cursorVersion
      };
      assertCondition(JSON.stringify(actual) === JSON.stringify(expected), "PostgreSQL ingestion smoke expected counts differ from actual counts.");
      return {
        identityKey,
        expected,
        actual,
        checks: {
          migrationReplay,
          transactionRollback,
          rollbackRowsAbsent,
          discoveryReplayIdempotent,
          registryReplayIdempotent,
          persistenceRestart,
          publicationOrVerificationSideEffect: false
        }
      };
    } finally {
      await reopened.close();
    }
  } finally {
    await repository.close();
  }
}

async function main(): Promise<void> {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (rawDatabaseUrl === undefined || rawDatabaseUrl.trim() === "") {
    console.error("PostgreSQL ingestion smoke failed: DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }
  const rawDatabaseSsl = process.env.DATABASE_SSL;
  if (rawDatabaseSsl !== undefined && rawDatabaseSsl !== "true" && rawDatabaseSsl !== "false") {
    console.error("PostgreSQL ingestion smoke failed: DATABASE_SSL must be true or false.");
    process.exitCode = 1;
    return;
  }

  let connectionString: string;
  try {
    connectionString = boundedDatabaseUrl(rawDatabaseUrl);
  } catch (error) {
    console.error(`PostgreSQL ingestion smoke failed: ${errorCode(error)}.`);
    process.exitCode = 1;
    return;
  }

  const databaseSsl = rawDatabaseSsl === "true";
  const runScope = randomUUID();
  const chainId = 97;
  const namespace = "bnbera-smoke";
  // This smoke test is database-only. A per-run synthetic registry keeps its
  // checkpoint isolated from real ERC-8004 ingestion and from other runs.
  const registry = `0x${createHash("sha256").update(`registry:${runScope}`).digest("hex").slice(0, 40)}`;
  const agentId = BigInt(`0x${createHash("sha256").update(`agent:${runScope}`).digest("hex")}`).toString(10);
  const identity: Erc8004Identity = { namespace, chainId, identityRegistry: registry, agentId };
  const identityKey = erc8004IdentityKey(identity);
  const owner = "0x1111111111111111111111111111111111111111";
  const agentWallet = "0x2222222222222222222222222222222222222222";
  const blockHash = `0x${createHash("sha256").update(`block:${runScope}`).digest("hex")}`;
  const transactionHash = `0x${createHash("sha256").update(`transaction:${runScope}`).digest("hex")}`;
  const contentDigest = createHash("sha256").update(`content:${runScope}`).digest("hex");
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const serviceUrl = `https://example.com/bnbera-smoke/${runScope}`;
  const agentUri = `${serviceUrl}.json`;
  const indexerVersion = `postgres-smoke-v3-${runScope}`;
  const startedAt = Date.now();
  const deadline = Date.now() + MAX_SMOKE_RUNTIME_MS;

  let migrationsReady = false;
  let result: SmokeResult | null = null;
  let failureCode: string | null = null;
  try {
    assertWithinDeadline(deadline);
    await migrateDb(connectionString, { ssl: databaseSsl });
    migrationsReady = true;
    assertWithinDeadline(deadline);
    // A second migration invocation must be a no-op, proving the checked-in
    // migration history can be restarted safely.
    await migrateDb(connectionString, { ssl: databaseSsl });
    assertWithinDeadline(deadline);
    result = await exerciseIngestion(
      connectionString,
      databaseSsl,
      runScope,
      namespace,
      chainId,
      registry,
      agentId,
      identity,
      identityKey,
      owner,
      agentWallet,
      blockHash,
      transactionHash,
      contentDigest,
      observedAt,
      serviceUrl,
      agentUri,
      indexerVersion,
      true,
      deadline
    );
  } catch (error) {
    failureCode = errorCode(error);
  }

  let cleanup: CleanupReport | null = null;
  if (migrationsReady) {
    try {
      cleanup = await cleanupTestRows(
        connectionString,
        databaseSsl,
        namespace,
        chainId,
        registry,
        agentId,
        indexerVersion
      );
    } catch (error) {
      failureCode = failureCode ?? errorCode(error);
    }
  }

  if (failureCode !== null || result === null || cleanup === null) {
    console.error(`PostgreSQL ingestion smoke failed: ${failureCode ?? "SMOKE_NO_RESULT"}.`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    runScope,
    durationMs: Date.now() - startedAt,
    maxRuntimeMs: MAX_SMOKE_RUNTIME_MS,
    identityKey: result.identityKey,
    expected: result.expected,
    actual: result.actual,
    checks: result.checks,
    cleanup
  }));
}

await main();
