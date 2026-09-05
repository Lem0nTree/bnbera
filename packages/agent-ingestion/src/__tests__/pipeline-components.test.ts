import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "@bnbera/config";
import {
  BoundedMetadataResolver,
  buildSemanticDocument,
  classifyAgent,
  embedSemanticDocument,
  InMemorySemanticVectorRepository,
  PgCategoryPredictionSink,
  PgVectorSemanticRepository,
  ensureSemanticVector,
  Erc8004Pipeline,
  createErc8004PipelineFromRuntimeConfig,
  InMemoryIngestionRepository,
  type EmbeddingProvider
} from "../index.js";

const identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "900719925474099312345"
} as const;

describe("bounded ERC-8004 metadata resolution", () => {
  it("decodes bounded data URIs and parses legacy registration warnings", async () => {
    const body = JSON.stringify({
      name: "Yield helper",
      description: "A public helper",
      services: [{ type: "a2a", url: "https://agent.example/a2a", version: "1" }],
      registrations: [{ agentId: identity.agentId, agentRegistry: "eip155:97:0x1111111111111111111111111111111111111111" }]
    });
    const uri = `data:application/json,${encodeURIComponent(body)}`;
    const resolver = new BoundedMetadataResolver({ maxBytes: 16_384 });
    const resolution = await resolver.resolve(uri);
    expect(resolution.contentType).toBe("application/json");
    expect(resolution.digestMatches).toBeNull();
    expect(resolver.parseRegistration(resolution).warnings).toContain("REGISTRATION_TYPE_MISSING");
  });

  it("blocks private targets and validates redirects and MIME", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }] as const);
    const resolver = new BoundedMetadataResolver({ fetch: fetcher, lookup });
    await expect(resolver.resolve("https://127.0.0.1/metadata.json")).rejects.toThrow(/private network/i);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }));
    await expect(resolver.resolve("https://agent.example/redirect")).rejects.toThrow(/private network|redirect/i);
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(resolver.resolve("https://agent.example/html")).rejects.toThrow(/MIME|JSON/i);
  });
});

describe("deterministic categorization and semantic documents", () => {
  it("classifies structured evidence across marketplace categories", () => {
    const cases = [
      ["rebalancing", "portfolio rebalance capability"],
      ["grid-trading", "grid trading capability"],
      ["yield-optimisation", "yield optimizer capability"],
      ["health-factor", "health factor liquidation capability"]
    ] as const;
    for (const [category, description] of cases) {
      const result = classifyAgent({ description, capabilities: { capabilities: [{ id: description, description }] } });
      expect(result.category).toBe(category);
      expect(result.reviewState).toBe("auto");
      expect(result.evidence).toHaveProperty("digest");
    }
    expect(classifyAgent({ description: "A generic assistant" }).category).toBe("uncategorized");
  });

  it("excludes prohibited semantic fields and is hash-stable", () => {
    const input = {
      identity,
      category: "yield-optimisation" as const,
      name: "Public yield helper",
      description: "Public capability description",
      riskSummary: { endpointStatus: "healthy", livePrice: "12", balance: "secret-like", prompt: "omit" },
      capabilityManifest: { capabilities: [{ id: "yield", description: "Optimize yield", inputSchema: {}, outputSchema: {}, allowedActions: ["quote"] }] }
    };
    const first = buildSemanticDocument(input);
    const second = buildSemanticDocument({ ...input, riskSummary: { prompt: "omit", balance: "secret-like", livePrice: "12", endpointStatus: "healthy" } });
    expect(first.digest).toBe(second.digest);
    expect(first.text).not.toMatch(/livePrice|balance|prompt|secret-like/iu);
    expect(first.document.identity.agentId).toBe(identity.agentId);
  });

  it("validates embedding dimensions and idempotently avoids provider work", async () => {
    const provider: EmbeddingProvider = {
      provider: "test-provider",
      model: "test-model",
      modelVersion: "test-v1",
      dimension: 3,
      embed: vi.fn(async () => [1, 0, 0])
    };
    const document = buildSemanticDocument({ identity, category: "uncategorized", name: "Agent" });
    await expect(embedSemanticDocument(document, { ...provider, embed: async () => [1, 2] })).rejects.toThrow(/dimension/i);
    const repository = new InMemorySemanticVectorRepository();
    const agentVersionId = "11111111-1111-4111-8111-111111111111";
    const first = await ensureSemanticVector({ agentVersionId, document, classifierVersion: null, provider }, repository);
    const second = await ensureSemanticVector({ agentVersionId, document, classifierVersion: null, provider }, repository);
    expect(first.generated).toBe(true);
    expect(second.generated).toBe(false);
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });

  it("persists versioned category evidence through the parameterized PostgreSQL sink", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({ rows: [], rowCount: 1 }));
    const sink = new PgCategoryPredictionSink({ query: query as never }, async () => "11111111-1111-4111-8111-111111111111", () => new Date("2026-09-02T00:00:00.000Z"));
    await sink.save({ identityKey: "eip155:97:0x1111111111111111111111111111111111111111:7", classification: classifyAgent({ protocols: ["yield"], capabilities: { capabilities: [{ id: "yield", description: "yield" }] } }) });
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toMatch(/INSERT INTO agent_category_predictions/iu);
    expect(query.mock.calls[0]?.[1]).toContain("yield-optimisation");
  });

  it("rejects a provider dimension that cannot fit the checked-in pgvector migration", async () => {
    const query = vi.fn();
    const repository = new PgVectorSemanticRepository({ query: query as never }, { storageDimension: 3 });
    await expect(repository.upsert({ agentVersionId: "11111111-1111-4111-8111-111111111111", embedding: [1, 0, 0, 0], provider: "test", model: "model", modelVersion: "v1", dimension: 4, sourceTextDigest: "a".repeat(64), semanticDocumentSchemaVersion: "schema-v1", classifierVersion: null, createdAt: new Date("2026-09-02T00:00:00.000Z") })).rejects.toThrow(/dimension/i);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("gated end-to-end pipeline", () => {
  it("composes the configured embedding provider without retaining a secret value", () => {
    const runtimeConfig = loadRuntimeConfig({
      NODE_ENV: "test",
      APP_URL: "https://preview.example.test",
      SIWE_DOMAIN: "preview.example.test",
      ERC8004_INGESTION_ENABLED: "true",
      ERC8004SCAN_DISCOVERY_ENABLED: "true",
      MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: "true",
      MARKETPLACE_SEMANTIC_CANARY_ENABLED: "true",
      ERC8004_EMBEDDING_PROVIDER: "openrouter",
      ERC8004_EMBEDDING_MODEL: "test/model",
      ERC8004_EMBEDDING_MODEL_VERSION: "test-v1",
      ERC8004_EMBEDDING_DIMENSION: "3",
      ERC8004_EMBEDDING_SECRET_REFERENCE: "ERC8004_EMBEDDING_API_KEY"
    });
    const provider: EmbeddingProvider = {
      provider: "openrouter",
      model: "test/model",
      modelVersion: "test-v1",
      dimension: 3,
      embed: async () => [1, 0, 0]
    };
    const pipeline = createErc8004PipelineFromRuntimeConfig({
      runtimeConfig,
      embeddingProvider: provider,
      standardsLock: {
        semanticEmbedding: {
          provider: "openrouter",
          model: "test/model",
          modelVersion: "test-v1",
          dimension: 3,
          endpoint: "https://openrouter.ai/api/v1/embeddings",
          semanticDocumentSchemaVersion: "semantic-document-v1",
          secretReference: "ERC8004_EMBEDDING_API_KEY",
          verificationStatus: "verified-live-read-only-canary",
          releaseEnabled: false
        }
      },
      repository: new InMemoryIngestionRepository()
    });
    expect(pipeline.featureGates()).toEqual({
      ERC8004_INGESTION_ENABLED: true,
      ERC8004SCAN_DISCOVERY_ENABLED: true,
      MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: true
    });
  });

  it("does not call discovery while either required gate is disabled", async () => {
    const adapter = { fetchPage: vi.fn() } as never;
    const pipeline = new Erc8004Pipeline({ repository: new InMemoryIngestionRepository(), adapter });
    const result = await pipeline.discover({ limit: 1 });
    expect(result.status).toBe("disabled");
    expect((adapter as { fetchPage: ReturnType<typeof vi.fn> }).fetchPage).not.toHaveBeenCalled();
  });

  it("runs discovery, exact-block verification, metadata enrichment, and category evidence when enabled", async () => {
    const metadata = encodeURIComponent(JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Yield helper",
      description: "A public yield optimizer",
      services: [{ type: "a2a", url: "https://agent.example/a2a", version: "1" }]
    }));
    const candidate = {
      identity,
      source: "8004scan" as const,
      sourceReference: "agent:97:0x1111111111111111111111111111111111111111:900719925474099312345",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "8004scan-test-v1",
      metadata: { name: "Yield helper" },
      capabilityManifest: { schemaVersion: "test-v1", capabilities: [{ id: "yield-optimizer", description: "Optimize yield", inputSchema: {}, outputSchema: {}, requiredProtocols: ["A2A"], allowedActions: ["quote"] }] }
    };
    const adapter = { fetchPage: vi.fn(async () => ({ candidates: [candidate], nextCursor: null, nextOffset: null, total: 1 })) } as never;
    const blockHash = `0x${"aa".repeat(32)}`;
    const registryReader = {
      getLatestBlock: vi.fn(async () => 100),
      getTrustedBlockHash: vi.fn(async () => blockHash),
      readIdentity: vi.fn(async () => ({ ownerAddress: "0x2222222222222222222222222222222222222222", agentWallet: null, agentUri: `data:application/json,${metadata}`, contentDigest: null, observedBlock: 100, observedBlockHash: blockHash, readConsistency: "provisional" as const, ownerObservedBlock: 100, agentWalletObservedBlock: 100, agentUriObservedBlock: 100, contentDigestObservedBlock: null }))
    } as never;
    const pipeline = new Erc8004Pipeline({
      repository: new InMemoryIngestionRepository(),
      adapter,
      registryReader,
      metadataResolver: new BoundedMetadataResolver(),
      gates: { ERC8004_INGESTION_ENABLED: true, ERC8004SCAN_DISCOVERY_ENABLED: true }
    });
    const result = await pipeline.discover({ limit: 1 });
    expect(result.status).toBe("completed");
    expect(result.candidates[0]?.registry).toBe("verified");
    expect(result.candidates[0]?.metadata).toBe("resolved");
    expect(result.candidates[0]?.category?.category).toBe("yield-optimisation");
  });
});
