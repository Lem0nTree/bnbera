import { describe, expect, it } from "vitest";
import {
  AgentIngestionService,
  InMemoryIngestionRepository,
  type DirectIdentityState
} from "../../packages/agent-ingestion/src/index.js";
import { erc8004IdentityKey, type AdvertisedService, type Erc8004Identity } from "../../packages/domain/src/index.js";
import {
  InMemoryMarketplaceMetadataSource,
  InMemoryMarketplaceSource,
  IngestionMarketplaceSource
} from "../../packages/marketplace/src/source.js";
import {
  evaluateListing,
  marketplaceFeatureFlags,
  MarketplaceReadService
} from "../../packages/marketplace/src/index.js";
import {
  activationAvailabilitySchema,
  marketplaceCompareResponseSchema,
  parseMarketplaceSearchRequest,
  marketplaceListingMetadataSchema,
  marketplaceSearchRequestSchema,
  parseMarketplaceListing,
  type MarketplaceListingInput,
  type MarketplaceListingMetadata
} from "../../packages/marketplace/src/types.js";

const identity: Erc8004Identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
};
const identityKey = erc8004IdentityKey(identity);
const observedAt = "2026-09-03T00:00:00.000Z";
const blockHash = "0x" + "22".repeat(32);
const service: AdvertisedService = {
  kind: "mcp",
  url: "https://agent.example/mcp",
  protocolVersion: "1",
  discoverySource: "manual",
  validationStatus: "pending",
  observedAt,
  latencyMs: null,
  safeCapabilityProbe: null
};
const capabilities = {
  schemaVersion: "1",
  capabilities: [
    {
      id: "quote",
      description: "Returns a bounded quote.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredProtocols: ["mcp"],
      allowedActions: []
    }
  ]
} as const;

function directState(): DirectIdentityState {
  return {
    ownerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    agentWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    agentUri: "https://agent.example/profile.json",
    contentDigest: null,
    observedBlock: 123,
    observedBlockHash: blockHash,
    readConsistency: "finalized",
    ownerObservedBlock: 123,
    agentWalletObservedBlock: 123,
    agentUriObservedBlock: 123,
    contentDigestObservedBlock: 123
  };
}

function metadata(overrides: Partial<MarketplaceListingMetadata> = {}): MarketplaceListingMetadata {
  return marketplaceListingMetadataSchema.parse({
    identityKey,
    slug: "qa-agent",
    name: "QA Agent",
    description: "A bounded read-only QA candidate.",
    category: "rebalancing",
    supportedProtocols: ["mcp"],
    pricing: {
      model: "unavailable",
      network: 97,
      tokenAddress: null,
      tokenSymbol: null,
      decimals: 18,
      minAtomic: null,
      maxAtomic: null,
      observedAt: null
    },
    dataFreshness: {
      status: "unknown",
      observedAt: null,
      source: null,
      maxAgeSeconds: null
    },
    authority: {
      walletProvider: "unknown",
      executionWallet: null,
      expiresAt: null,
      spendLimitAtomic: null,
      spendAsset: null,
      allowlistedContracts: [],
      allowlistedSelectors: [],
      observedAt: null
    },
    executionEvidence: {
      status: "unknown",
      lastVerifiedAt: null,
      reference: null
    },
    activationOffer: {
      advertised: false,
      method: "none",
      label: "Activation unavailable"
    },
    fixture: null,
    ...overrides
  });
}

function listing(overrides: Partial<MarketplaceListingInput> = {}): MarketplaceListingInput {
  const selectedIdentity = overrides.identity ?? identity;
  const selectedIdentityKey = overrides.identityKey ?? erc8004IdentityKey(selectedIdentity);
  return parseMarketplaceListing({
    ...metadata({ identityKey: selectedIdentityKey }),
    identityKey: selectedIdentityKey,
    identity: selectedIdentity,
    ownerAddress: null,
    agentWallet: null,
    agentUri: null,
    contentDigest: null,
    state: {
      originType: "manual_import",
      claimStatus: "unclaimed",
      verificationStatus: "pending",
      runtimeStatus: "unavailable",
      authorityStatus: "none",
      listingStatus: "draft"
    },
    services: [service],
    capabilities,
    health: {
      endpointStatus: "unknown",
      observedAt: null,
      latencyMs: null,
      source: null
    },
    provenance: {
      sourceKind: "ingestion",
      fixture: null,
      sources: [],
      identityRead: {
        observedBlock: null,
        observedBlockHash: null,
        readConsistency: null,
        observedAt
      }
    },
    fixture: null,
    ...overrides
  });
}

function eligibleListing(overrides: Partial<MarketplaceListingInput> = {}): MarketplaceListingInput {
  return listing({
    state: {
      originType: "discovered",
      claimStatus: "claimed",
      verificationStatus: "verified",
      runtimeStatus: "live",
      authorityStatus: "active",
      listingStatus: "published"
    },
    services: [{ ...service, validationStatus: "healthy" }],
    ownerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    agentWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    agentUri: "https://agent.example/profile.json",
    health: {
      endpointStatus: "healthy",
      observedAt,
      latencyMs: 42,
      source: "qa-probe"
    },
    dataFreshness: {
      status: "fresh",
      observedAt,
      source: "qa-read-model",
      maxAgeSeconds: 300
    },
    authority: {
      walletProvider: "external",
      executionWallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      expiresAt: "2026-09-04T00:00:00.000Z",
      spendLimitAtomic: "1000",
      spendAsset: "0x3333333333333333333333333333333333333333",
      allowlistedContracts: ["0x3333333333333333333333333333333333333333"],
      allowlistedSelectors: ["0x12345678"],
      observedAt
    },
    executionEvidence: {
      status: "verified",
      lastVerifiedAt: observedAt,
      reference: "qa:execution-evidence"
    },
    pricing: {
      model: "fixed",
      network: 97,
      tokenAddress: "0x3333333333333333333333333333333333333333",
      tokenSymbol: "USDT",
      decimals: 18,
      minAtomic: "100",
      maxAtomic: "100",
      observedAt
    },
    provenance: {
      sourceKind: "ingestion",
      fixture: null,
      sources: [{
        source: "manual",
        sourceReference: "qa-eligible-listing",
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        rawResponseDigest: null,
        normalizedIngestionVersion: "qa-v1"
      }],
      identityRead: {
        observedBlock: 123,
        observedBlockHash: blockHash,
        readConsistency: "finalized",
        observedAt
      }
    },
    ...overrides
  });
}

async function seededRepository(): Promise<InMemoryIngestionRepository> {
  const repository = new InMemoryIngestionRepository();
  const ingestion = new AgentIngestionService(repository);
  await ingestion.ingestCandidate({
    identity,
    source: "manual",
    sourceReference: "qa-read-model-1",
    observedAt: new Date(observedAt),
    normalizedIngestionVersion: "manual-v1",
    services: [service],
    capabilityManifest: capabilities
  });
  await ingestion.reconcileIdentity({ async readIdentity() { return directState(); } }, identity);
  return repository;
}

describe("marketplace source/read-model contracts", () => {
  it("returns an honest empty source without manufacturing listing records", async () => {
    const source = new InMemoryMarketplaceSource();
    const snapshot = await source.read();

    expect(snapshot.records).toEqual([]);
    expect(snapshot.status).toBe("healthy");
    expect(snapshot.warning).toBeNull();
    expect(snapshot.refreshedAt).toBeNull();
  });

  it("requires a visible fixture label whenever a source is fixture-backed", () => {
    const fixture = { isFixture: true as const, label: "Fixture: local QA corpus" };
    const fixtureListing = listing({
      fixture,
      provenance: {
        sourceKind: "fixture",
        fixture,
        sources: [],
        identityRead: { observedBlock: null, observedBlockHash: null, readConsistency: null, observedAt }
      }
    });

    expect(fixtureListing.fixture).toEqual(fixture);
    expect(fixtureListing.provenance.sourceKind).toBe("fixture");
    expect(() => listing({
      fixture: { isFixture: true, label: "Fixture: local QA corpus" },
      provenance: {
        sourceKind: "ingestion",
        fixture: { isFixture: true, label: "Fixture: local QA corpus" },
        sources: [],
        identityRead: { observedBlock: null, observedBlockHash: null, readConsistency: null, observedAt }
      }
    })).toThrow();
  });

  it("withholds incomplete ingestion rows and marks the source degraded", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "qa-incomplete-read-model",
      observedAt: new Date(observedAt),
      normalizedIngestionVersion: "manual-v1"
    });
    const source = new IngestionMarketplaceSource(
      repository,
      new InMemoryMarketplaceMetadataSource([metadata()]),
      { now: () => new Date(observedAt) }
    );

    const snapshot = await source.read();

    expect(snapshot.records).toEqual([]);
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.warning).toMatch(/lacked complete marketplace metadata and was withheld/i);
  });

  it("projects canonical identity, service, capability, and six-axis state without upgrading trust", async () => {
    const repository = await seededRepository();
    const source = new IngestionMarketplaceSource(
      repository,
      new InMemoryMarketplaceMetadataSource([metadata()]),
      { now: () => new Date(observedAt) }
    );

    const snapshot = await source.read();
    const record = snapshot.records[0];

    expect(snapshot.status).toBe("healthy");
    expect(record).toBeDefined();
    expect(record?.identityKey).toBe(identityKey);
    expect(record?.identity).toEqual(identity);
    expect(record?.services).toHaveLength(1);
    expect(record?.capabilities.capabilities[0]?.id).toBe("quote");
    expect(record?.state).toEqual({
      originType: "manual_import",
      claimStatus: "unclaimed",
      verificationStatus: "pending",
      runtimeStatus: "unavailable",
      authorityStatus: "none",
      listingStatus: "draft"
    });
    expect(record?.provenance.sourceKind).toBe("ingestion");
    expect(record?.provenance.fixture).toBeNull();
    expect(record?.provenance.identityRead).toMatchObject({
      observedBlock: 123,
      observedBlockHash: blockHash,
      readConsistency: "finalized"
    });
    expect(record?.health.endpointStatus).toBe("unknown");
    expect(record?.activationOffer.advertised).toBe(false);
  });

  it("rejects duplicate metadata identity keys before constructing a read model", () => {
    expect(() => new InMemoryMarketplaceMetadataSource([metadata(), metadata()])).toThrow(/duplicate/i);
  });

  it("exposes hard-filter inputs and enforces the three-agent compare limit", () => {
    const request = marketplaceSearchRequestSchema.parse({
      query: "LP range",
      category: "rebalancing",
      chainId: 97,
      requiredProtocols: ["mcp"],
      maxPriceAtomic: "1000",
      requireAuthority: true,
      requestedAmountAtomic: "10",
      requiredContract: "0x3333333333333333333333333333333333333333",
      requiredSelector: "0x12345678",
      requireFreshData: true
    });
    expect(request).toMatchObject({
      category: "rebalancing",
      chainId: 97,
      requiredProtocols: ["mcp"],
      requireAuthority: true,
      requiredSelector: "0x12345678",
      requireFreshData: true
    });

    const meta = {
      requestId: "qa-compare",
      sourceStatus: "empty" as const,
      sourceName: "qa-read-model",
      warning: null,
      returnedAt: observedAt,
      fixtureCount: 0
    };
    expect(() => marketplaceCompareResponseSchema.parse({
      requested: ["a", "b", "c", "d"],
      agents: [],
      missing: [],
      meta
    })).toThrow();
  });

  it("represents unavailable activation explicitly and cannot parse an available rail", () => {
    const unavailable = activationAvailabilitySchema.parse({
      available: false,
      featureGate: "activation-commerce",
      method: "erc8183",
      reasonCode: "OPTIONAL_RAIL_DISABLED",
      message: "Activation is unavailable until the commerce gate passes."
    });

    expect(unavailable.available).toBe(false);
    expect(() => activationAvailabilitySchema.parse({
      ...unavailable,
      available: true
    })).toThrow();
  });
});

describe("marketplace read service acceptance boundary", () => {
  const now = new Date(observedAt);

  it("applies hard chain and protocol filters before producing a score", () => {
    const listingRecord = eligibleListing();
    const wrongChain = evaluateListing(
      listingRecord,
      parseMarketplaceSearchRequest({ chainId: 56 }),
      now
    );
    const wrongProtocol = evaluateListing(
      listingRecord,
      parseMarketplaceSearchRequest({ requiredProtocols: ["unlisted-protocol"] }),
      now
    );

    expect(wrongChain.eligible).toBe(false);
    expect(wrongChain.score).toBeNull();
    expect(wrongChain.components).toBeNull();
    expect(wrongChain.reasons.map((reason) => reason.code)).toContain("WRONG_CHAIN");
    expect(wrongProtocol.eligible).toBe(false);
    expect(wrongProtocol.score).toBeNull();
    expect(wrongProtocol.components).toBeNull();
    expect(wrongProtocol.reasons.map((reason) => reason.code)).toContain("PROTOCOL_UNSUPPORTED");
  });

  it("returns eligible records ranked separately from honest exclusions", async () => {
    const accepted = eligibleListing({ slug: "eligible-agent", name: "Eligible Agent" });
    const pending = listing({
      identity: { ...identity, agentId: "43" },
      slug: "pending-agent",
      name: "Pending Agent"
    });
    const service = new MarketplaceReadService(
      new InMemoryMarketplaceSource([pending, accepted], {
        sourceName: "qa-marketplace",
        refreshedAt: observedAt
      }),
      { now: () => now, requestId: () => "qa-read-service" }
    );

    const response = await service.search({});

    expect(response.results.map((record) => record.slug)).toEqual(["eligible-agent"]);
    expect(response.results[0]?.eligibility.score).not.toBeNull();
    expect(response.results[0]?.activation).toMatchObject({
      available: false,
      featureGate: "activation-commerce",
      reasonCode: "OPTIONAL_RAIL_DISABLED"
    });
    expect(response.excluded).toHaveLength(1);
    expect(response.excluded[0]?.slug).toBe("pending-agent");
    expect(response.excluded[0]?.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "ENDPOINT_UNVERIFIED",
      "IDENTITY_UNRESOLVED",
      "LISTING_NOT_PUBLISHED",
      "VERIFICATION_PENDING"
    ]));
    expect(response.meta).toMatchObject({
      sourceStatus: "healthy",
      sourceName: "qa-marketplace",
      fixtureCount: 0
    });
  });

  it("preserves empty and degraded source honesty in response metadata", async () => {
    const emptyService = new MarketplaceReadService(
      new InMemoryMarketplaceSource(),
      { now: () => now, requestId: () => "qa-empty" }
    );
    const degradedService = new MarketplaceReadService(
      new InMemoryMarketplaceSource([eligibleListing()], {
        status: "degraded",
        warning: "One source was withheld during projection.",
        refreshedAt: observedAt
      }),
      { now: () => now, requestId: () => "qa-degraded" }
    );

    const empty = await emptyService.search({});
    const degraded = await degradedService.search({});

    expect(empty.results).toEqual([]);
    expect(empty.meta.sourceStatus).toBe("empty");
    expect(degraded.meta).toMatchObject({
      sourceStatus: "degraded",
      warning: "One source was withheld during projection."
    });
  });

  it("returns the full detail identity tuple and keeps compare bounded", async () => {
    const listingRecord = eligibleListing({ slug: "detail-agent" });
    const service = new MarketplaceReadService(
      new InMemoryMarketplaceSource([listingRecord]),
      { now: () => now, requestId: () => "qa-detail" }
    );

    const detail = await service.getAgent("detail-agent");

    expect(detail.agent.identity).toEqual(identity);
    expect(detail.agent.state).toEqual(listingRecord.state);
    expect(detail.agent.detail.contractAllowlist.selectors).toEqual(["0x12345678"]);
    await expect(service.compare(["a", "b", "c", "d"])).rejects.toMatchObject({
      code: "MARKETPLACE_COMPARE_LIMIT"
    });
  });

  it("fails through a safe envelope when the source throws", async () => {
    const source = {
      async read(): Promise<never> {
        throw new Error("database password must not cross the API boundary");
      }
    };
    const service = new MarketplaceReadService(source, {
      now: () => now,
      requestId: () => "qa-source-error"
    });

    const result = await service.safeSearch({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error.code).toBe("MARKETPLACE_SOURCE_UNAVAILABLE");
      expect(result.error).not.toHaveProperty("cause");
      expect(JSON.stringify(result.error)).not.toMatch(/password|database/i);
    }
  });

  it("keeps optional write rails disabled while the core marketplace remains enabled", () => {
    expect(marketplaceFeatureFlags).toEqual({
      coreMarketplace: true,
      activationCommerce: false,
      creatorAltana: false,
      evidencePublication: false
    });
  });
});
