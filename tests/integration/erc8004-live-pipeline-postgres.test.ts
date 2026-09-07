import { afterAll, describe, expect, it } from "vitest";
import { createDb, migrateDb } from "../../packages/db/src/client.js";
import {
  BoundedMetadataResolver,
  BoundedServiceProbe,
  Erc8004MarketplaceCompositionRunner,
  Erc8004Pipeline,
  PgCategoryPredictionSink,
  PgVectorSemanticRepository,
  PostgresIngestionRepository,
  AgentIngestionService,
  type EmbeddingProvider,
  type MarketplaceCompositionPublicationResult,
  type ServiceProbeTransport,
  type RegistryEvent
} from "../../packages/agent-ingestion/src/index.js";
import {
  PostgresMarketplacePublicationService,
  IngestionMarketplaceSource,
  InMemoryMarketplaceMetadataSource,
  MarketplaceReadService,
  VectorMarketplaceSemanticRetriever,
  createDevelopmentFixture,
  metadataFromFixture
} from "../../packages/marketplace/src/index.js";
import { erc8004IdentityKey, type Erc8004Identity } from "../../packages/domain/src/index.js";

/**
 * This is an explicitly labelled disposable fixture test. It exercises the
 * real PostgreSQL adapters and read seam, but its deterministic 1536-vector
 * provider is not live provider evidence and no rows are retained.
 */
const databaseUrl = process.env.DATABASE_URL?.trim() || null;
const requireDatabaseTests = process.env.BNBERA_REQUIRE_DATABASE_TESTS === "true";
const pools: ReturnType<typeof createDb>["pool"][] = [];

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
});

function metadataUri(capabilityManifest: unknown): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Disposable PostgreSQL pipeline fixture",
    description: "Fixture yield discovery and enrichment for the PostgreSQL seam test.",
    supportedProtocols: ["readiness"],
    capabilityManifest,
    services: [{ type: "readiness", url: "https://agent.example/fixture-ready", version: "1" }]
  }))}`;
}

describe("disposable PostgreSQL ERC-8004 publication pipeline fixture", () => {
  it("upserts an identity before persisting its first registry observation", async () => {
    if (requireDatabaseTests) expect(databaseUrl).not.toBeNull();
    if (databaseUrl === null) return;

    await migrateDb(databaseUrl);
    const { pool } = createDb(databaseUrl);
    pools.push(pool);
    const now = new Date("2026-09-07T00:00:00.000Z");
    const repository = new PostgresIngestionRepository(pool, { now: () => now });
    const identity: Erc8004Identity = {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0x1111111111111111111111111111111111111111",
      agentId: `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`
    };
    const transactionHash = `0x${Date.now().toString(16).padStart(64, "0")}`;
    const event: RegistryEvent = {
      identity,
      eventType: "Registered",
      transactionHash,
      logIndex: 0,
      blockNumber: 100,
      blockHash: `0x${"ab".repeat(32)}`,
      ownerAddress: "0x2222222222222222222222222222222222222222",
      agentUri: "https://agent.example/first-observation.json",
      changedFields: ["ownerAddress", "agentUri"],
      observedAt: now,
      payload: { event: "Registered" }
    };
    const ingestion = new AgentIngestionService(repository, { now: () => now });

    try {
      const first = await ingestion.ingestRegistryEvents([event], {
        chainId: identity.chainId,
        identityRegistry: identity.identityRegistry
      });
      expect(first.duplicateCount).toBe(0);
      expect(await repository.findIdentity(identity)).not.toBeNull();
      expect(await repository.listObservations({
        chainId: identity.chainId,
        identityRegistry: identity.identityRegistry
      })).toHaveLength(1);

      const replay = await ingestion.ingestRegistryEvents([event], {
        chainId: identity.chainId,
        identityRegistry: identity.identityRegistry
      });
      expect(replay.duplicateCount).toBe(1);
      expect(await repository.listObservations({
        chainId: identity.chainId,
        identityRegistry: identity.identityRegistry
      })).toHaveLength(1);
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query(
          "DELETE FROM agents WHERE identity_id = (SELECT id FROM erc8004_identities WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4)",
          [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
        );
        await cleanup.query(
          "DELETE FROM erc8004_identities WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4",
          [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
        );
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK");
        throw error;
      } finally {
        cleanup.release();
      }
    }
  });

  it("covers discovery, enrichment, category, embedding, version, publication, and read API seams", async () => {
    if (requireDatabaseTests) expect(databaseUrl).not.toBeNull();
    if (databaseUrl === null) return;

    await migrateDb(databaseUrl);
    const { pool } = createDb(databaseUrl);
    pools.push(pool);
    const repository = new PostgresIngestionRepository(pool, { now: () => now });
    const identity: Erc8004Identity = {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0x1111111111111111111111111111111111111111",
      agentId: `${Date.now()}${Math.floor(Math.random() * 1_000)}`
    };
    const identityKey = erc8004IdentityKey(identity);
    const now = new Date();
    const capabilityManifest = {
      schemaVersion: "fixture-capabilities-v1",
      capabilities: [{
        id: "yield-optimizer",
        description: "Compare public lending yield opportunities.",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        requiredProtocols: ["readiness"],
        allowedActions: ["quote"]
      }]
    };
    const blockHash = `0x${"ab".repeat(32)}`;
    const serviceUrl = "https://agent.example/fixture-ready";
    const registryReader = {
      getLatestBlock: async () => 100,
      getTrustedBlockHash: async () => blockHash,
      readIdentity: async () => ({
        ownerAddress: "0x2222222222222222222222222222222222222222",
        agentWallet: null,
        agentUri: metadataUri(capabilityManifest),
        contentDigest: null,
        observedBlock: 100,
        observedBlockHash: blockHash,
        readConsistency: "finalized" as const,
        ownerObservedBlock: 100,
        agentWalletObservedBlock: null,
        agentUriObservedBlock: 100,
        contentDigestObservedBlock: null
      })
    } as never;
    const probeTransport: ServiceProbeTransport = {
      probe: async () => ({
        statusCode: 200,
        latencyMs: 4,
        contractStatus: "healthy" as const,
        safeCapabilityProbe: { protocol: "readiness", ready: true }
      })
    };
    const provider: EmbeddingProvider = {
      provider: "fixture-provider",
      model: "fixture-model",
      modelVersion: "fixture-v1",
      dimension: 1536,
      embed: async () => [1, ...Array.from({ length: 1535 }, () => 0)]
    };
    const publication = new PostgresMarketplacePublicationService(pool, { now: () => now });
    const vectors = new PgVectorSemanticRepository(pool);
    const pipeline = new Erc8004Pipeline({
      repository,
      registryReader,
      metadataResolver: new BoundedMetadataResolver(),
      serviceProbe: new BoundedServiceProbe(probeTransport, { now: () => now }),
      serviceProbeOptions: { maxConcurrency: 1, minIntervalMs: 0, maxServices: 4 },
      gates: { ERC8004_INGESTION_ENABLED: true },
      now: () => now
    });
    const categorySink = new PgCategoryPredictionSink(pool, publication.versionIdForIdentityKey, () => now);
    const runner = new Erc8004MarketplaceCompositionRunner({
      repository,
      pipeline,
      publisher: {
        async publish(input): Promise<MarketplaceCompositionPublicationResult> {
          const result = await publication.publish(input);
          return {
            status: result.status,
            versionId: result.versionId,
            diagnostics: result.diagnostics.map((diagnostic) => ({ code: diagnostic.code }))
          };
        }
      },
      categorySink,
      semanticEmbeddingEnabled: true,
      embeddingProvider: provider,
      vectorRepository: vectors,
      maxCandidates: 1
    });

    try {
      const result = await runner.run({
        candidates: [{
          identity,
          source: "manual",
          sourceReference: "fixture:disposable-postgres-live-pipeline",
          observedAt: now,
          normalizedIngestionVersion: "fixture-live-pipeline-v1"
        }]
      });
      expect(result.status).toBe("completed");
      expect(result.stageCounts).toMatchObject({
        discovered: 1,
        chainRead: 1,
        metadataResolved: 1,
        categoriesPersisted: 1,
        published: 1
      });
      expect(result.reasons).toMatchObject({ SEMANTIC_EMBEDDING_GENERATED: 1 });

      const versionId = result.candidates[0]?.versionId;
      expect(versionId).toMatch(/^[0-9a-f-]{36}$/iu);
      const vector = await vectors.find(versionId!, provider.modelVersion);
      expect(vector?.dimension).toBe(provider.dimension);

      const fixtureListing = createDevelopmentFixture({
        agentId: 1,
        slug: "fixture-disposable-pipeline",
        name: "Fixture Disposable Pipeline",
        category: "yield-optimisation",
        description: "Fixture yield discovery and enrichment for the PostgreSQL seam test.",
        protocol: "readiness",
        action: "quote",
        priceAtomic: "0"
      });
      const readMetadata = {
        ...metadataFromFixture(fixtureListing),
        identityKey,
        slug: "fixture-disposable-pipeline",
        name: "Fixture Disposable Pipeline",
        description: "Fixture yield discovery and enrichment for the PostgreSQL seam test.",
        fixture: null
      };
      const source = new IngestionMarketplaceSource(
        repository,
        new InMemoryMarketplaceMetadataSource([readMetadata]),
        { now: () => now }
      );
      const retriever = new VectorMarketplaceSemanticRetriever(provider, vectors, {
        versionIdForIdentityKey: publication.versionIdForIdentityKey,
        identityKeyForVersionId: async (candidateVersionId) => candidateVersionId === versionId ? identityKey : null
      });
      const readService = new MarketplaceReadService(source, {
        now: () => now,
        requestId: () => "req-disposable-postgres-fixture",
        semanticRetrievalEnabled: true,
        semanticRetriever: retriever
      });
      const response = await readService.search({ query: "yield" });
      expect(response.meta.retrievalMode).toBe("hybrid");
      expect(response.results[0]?.identityKey).toBe(identityKey);
      expect(response.results[0]?.provenance.sourceKind).toBe("ingestion");
      expect(response.results[0]?.provenance.fixture).toBeNull();
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("DELETE FROM agents WHERE identity_id = (SELECT id FROM erc8004_identities WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4)", [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]);
        await cleanup.query("DELETE FROM erc8004_identities WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4", [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]);
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK");
        throw error;
      } finally {
        cleanup.release();
      }
    }
  });
});
