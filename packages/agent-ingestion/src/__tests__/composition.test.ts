import { describe, expect, it, vi } from "vitest";
import {
  BoundedMetadataResolver,
  BoundedServiceProbe,
  Erc8004MarketplaceCompositionRunner,
  Erc8004Pipeline,
  InMemoryIngestionRepository,
  InMemorySemanticVectorRepository,
  type MarketplaceCompositionPublicationInput,
  type MarketplaceCompositionPublicationResult,
  type ServiceProbeTransport,
  type EmbeddingProvider
} from "../index.js";

const identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "7"
} as const;

const blockHash = `0x${"ab".repeat(32)}`;
const capabilityManifest = {
  schemaVersion: "reference-v1",
  capabilities: [{
    id: "yield-optimizer",
    description: "Optimize lending yield",
    inputSchema: {},
    outputSchema: {},
    requiredProtocols: ["readiness"],
    allowedActions: ["quote"]
  }]
} as const;

function metadataUri(): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Reference yield agent",
    description: "A public yield optimizer",
    supportedProtocols: ["readiness"],
    capabilityManifest,
    services: [{ type: "readiness", url: "https://agent.example/ready", version: "1" }]
  }))}`;
}

function candidate() {
  return {
    identity,
    source: "manual" as const,
    sourceReference: "manual:reference-agent",
    observedAt: new Date("2026-09-05T00:00:00.000Z"),
    normalizedIngestionVersion: "manual-v1"
  };
}

function registryReader() {
  return {
    getLatestBlock: vi.fn(async () => 100),
    getTrustedBlockHash: vi.fn(async () => blockHash),
    readIdentity: vi.fn(async () => ({
      ownerAddress: "0x2222222222222222222222222222222222222222",
      agentWallet: null,
      agentUri: metadataUri(),
      contentDigest: null,
      observedBlock: 100,
      observedBlockHash: blockHash,
      readConsistency: "finalized" as const,
      ownerObservedBlock: 100,
      agentWalletObservedBlock: 100,
      agentUriObservedBlock: 100,
      contentDigestObservedBlock: null
    }))
  } as never;
}

function readinessProbe(): BoundedServiceProbe {
  const transport: ServiceProbeTransport = {
    probe: async (_input) => ({
      statusCode: 200,
      latencyMs: 3,
      contractStatus: "healthy",
      safeCapabilityProbe: { protocol: "readiness", ready: true }
    })
  };
  return new BoundedServiceProbe(transport, {
    now: () => new Date("2026-09-05T00:00:01.000Z")
  });
}

function publisher(events: string[]) {
  return {
    publish: vi.fn(async (_input: MarketplaceCompositionPublicationInput): Promise<MarketplaceCompositionPublicationResult> => {
      events.push("publish");
      return {
        status: "published",
        versionId: "11111111-1111-4111-8111-111111111111",
        diagnostics: []
      };
    })
  };
}

describe("ERC-8004 marketplace composition", () => {
  it("persists direct-read metadata, explicit capabilities, services, and probes before publication", async () => {
    const repository = new InMemoryIngestionRepository();
    const events: string[] = [];
    const publication = publisher(events);
    const pipeline = new Erc8004Pipeline({
      repository,
      registryReader: registryReader(),
      metadataResolver: new BoundedMetadataResolver(),
      serviceProbe: readinessProbe(),
      serviceProbeOptions: { maxConcurrency: 1, minIntervalMs: 0, maxServices: 4 },
      gates: {
        ERC8004_INGESTION_ENABLED: true,
        ERC8004SCAN_DISCOVERY_ENABLED: false,
        MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: false
      }
    });
    const category = {
      save: vi.fn(async () => {
        events.push("category");
      })
    };
    const runner = new Erc8004MarketplaceCompositionRunner({
      repository,
      pipeline,
      publisher: publication,
      categorySink: category,
      maxCandidates: 20
    });

    const result = await runner.run({ candidates: [candidate()] });
    expect(result.status).toBe("completed");
    expect(result.stageCounts).toMatchObject({
      discovered: 1,
      chainRead: 1,
      metadataResolved: 1,
      capabilityComplete: 1,
      servicesObserved: 1,
      serviceHealthy: 1,
      versioned: 1,
      published: 1,
      withheld: 0,
      categoriesPersisted: 1,
      failed: 0
    });
    expect(events).toEqual(["publish", "category"]);
    expect(publication.publish).toHaveBeenCalledWith(expect.objectContaining({ capabilityManifest }));
    expect(await repository.listCapabilities("eip155:97:0x1111111111111111111111111111111111111111:7")).toHaveLength(1);
    expect(await repository.listServices("eip155:97:0x1111111111111111111111111111111111111111:7")).toHaveLength(1);
    expect(await repository.listProbeResults("eip155:97:0x1111111111111111111111111111111111111111:7")).toHaveLength(1);
  });

  it("generates a vector only after the published version and category projection exist", async () => {
    const repository = new InMemoryIngestionRepository();
    const events: string[] = [];
    const vectors = new InMemorySemanticVectorRepository();
    const embed = vi.fn(async (_text: string) => {
      events.push("embed");
      return [1, 0, 0];
    });
    const embeddingProvider: EmbeddingProvider = {
      provider: "test-provider",
      model: "test-model",
      modelVersion: "test-v1",
      dimension: 3,
      embed
    };
    const pipeline = new Erc8004Pipeline({
      repository,
      registryReader: registryReader(),
      metadataResolver: new BoundedMetadataResolver(),
      serviceProbe: readinessProbe(),
      serviceProbeOptions: { maxConcurrency: 1, minIntervalMs: 0, maxServices: 4 },
      gates: { ERC8004_INGESTION_ENABLED: true }
    });
    const category = {
      save: vi.fn(async () => {
        events.push("category");
      })
    };
    const publication = publisher(events);
    const runner = new Erc8004MarketplaceCompositionRunner({
      repository,
      pipeline,
      publisher: publication,
      categorySink: category,
      semanticEmbeddingEnabled: true,
      embeddingProvider,
      vectorRepository: vectors
    });

    const result = await runner.run({ candidates: [candidate()] });

    expect(result.status).toBe("completed");
    expect(result.reasons).toMatchObject({ SEMANTIC_EMBEDDING_GENERATED: 1 });
    expect(result.candidates[0]?.diagnostics).toContain("SEMANTIC_EMBEDDING_GENERATED");
    expect(events).toEqual(["publish", "category", "embed"]);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(await vectors.find("11111111-1111-4111-8111-111111111111", "test-v1")).not.toBeNull();
  });

  it("does not index withheld versions even when semantic indexing is enabled", async () => {
    const repository = new InMemoryIngestionRepository();
    const embed = vi.fn(async () => [1, 0, 0]);
    const embeddingProvider: EmbeddingProvider = {
      provider: "test-provider",
      model: "test-model",
      modelVersion: "test-v1",
      dimension: 3,
      embed
    };
    const pipeline = new Erc8004Pipeline({
      repository,
      registryReader: registryReader(),
      metadataResolver: new BoundedMetadataResolver(),
      gates: { ERC8004_INGESTION_ENABLED: true }
    });
    const publication = {
      publish: vi.fn(async (_input: MarketplaceCompositionPublicationInput): Promise<MarketplaceCompositionPublicationResult> => ({
        status: "withheld",
        versionId: "11111111-1111-4111-8111-111111111111",
        diagnostics: [{ code: "IDENTITY_READ_NOT_FINALIZED" }]
      }))
    };
    const runner = new Erc8004MarketplaceCompositionRunner({
      repository,
      pipeline,
      publisher: publication,
      semanticEmbeddingEnabled: true,
      embeddingProvider,
      vectorRepository: new InMemorySemanticVectorRepository()
    });

    const result = await runner.run({ candidates: [candidate()] });

    expect(result.status).toBe("degraded");
    expect(result.candidates[0]?.status).toBe("withheld");
    expect(embed).not.toHaveBeenCalled();
    expect(result.reasons).toMatchObject({ IDENTITY_READ_NOT_FINALIZED: 1 });
  });

  it("deduplicates a replay batch and never invokes publication before category sequencing", async () => {
    const repository = new InMemoryIngestionRepository();
    const publication = {
      publish: vi.fn(async (_input: MarketplaceCompositionPublicationInput): Promise<MarketplaceCompositionPublicationResult> => ({
        status: "withheld",
        versionId: "11111111-1111-4111-8111-111111111111",
        diagnostics: [{ code: "SERVICE_HEALTH_UNVERIFIED" }]
      }))
    };
    const pipeline = new Erc8004Pipeline({
      repository,
      registryReader: registryReader(),
      metadataResolver: new BoundedMetadataResolver(),
      gates: { ERC8004_INGESTION_ENABLED: true }
    });
    const runner = new Erc8004MarketplaceCompositionRunner({ repository, pipeline, publisher: publication, maxCandidates: 20 });
    const result = await runner.run({ candidates: [candidate(), candidate()] });
    expect(result.candidateCount).toBe(1);
    expect(publication.publish).toHaveBeenCalledTimes(1);
    expect(result.reasons).toEqual(expect.objectContaining({ SERVICE_HEALTH_UNVERIFIED: 2 }));
    expect(result.status).toBe("degraded");
  });

  it("is fail-closed when ingestion is disabled and does not call the publisher", async () => {
    const repository = new InMemoryIngestionRepository();
    const publication = publisher([]);
    const pipeline = new Erc8004Pipeline({ repository });
    const runner = new Erc8004MarketplaceCompositionRunner({ repository, pipeline, publisher: publication });
    const result = await runner.run({ candidates: [candidate()] });
    expect(result).toEqual(expect.objectContaining({ status: "disabled", candidateCount: 0 }));
    expect(publication.publish).not.toHaveBeenCalled();
    expect(await repository.listIdentities()).toHaveLength(0);
  });
});
