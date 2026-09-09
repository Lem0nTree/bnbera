import { describe, expect, it } from "vitest";
import { InMemoryIngestionRepository } from "@bnbera/agent-ingestion";
import { canonicalSha256Hex } from "@bnbera/domain";
import {
  InMemoryMarketplaceMetadataSource,
  InMemoryMarketplaceSource,
  IngestionMarketplaceSource,
  MarketplaceReadService,
  developmentFixtureListings,
  evaluateListing,
  metadataFromFixture,
  marketplaceActivationOfferSchema,
  marketplaceExecutionEvidenceSchema,
  marketplaceFreshnessSchema,
  marketplacePricingSchema,
  type MarketplaceListingInput,
  type MarketplaceSource
} from "../index.js";

const now = new Date("2026-09-02T12:00:30.000Z");

function service(source: MarketplaceSource): MarketplaceReadService {
  return new MarketplaceReadService(source, {
    now: () => now,
    requestId: () => "req-marketplace-test"
  });
}

describe("MarketplaceReadService", () => {
  it.each([
    ["unknown", null, "ENDPOINT_UNVERIFIED"],
    ["unhealthy", "2026-09-02T12:00:00.000Z", "ENDPOINT_UNHEALTHY"],
    ["unhealthy", "2026-09-02T11:00:00.000Z", "ENDPOINT_STALE"],
    ["healthy", "2026-09-02T11:00:00.000Z", "ENDPOINT_STALE"]
  ] as const)("keeps %s health with observation %s distinct", async (endpointStatus, observedAt, expected) => {
    const original = developmentFixtureListings[0]!;
    const response = await service(new InMemoryMarketplaceSource([{
      ...original,
      health: {...original.health, endpointStatus, observedAt}
    }])).search();
    expect(response.results).toHaveLength(0);
    expect(response.excluded[0]?.reasons.map(reason=>reason.code)).toContain(expected);
  });

  it("returns an explicit empty state for an empty source", async () => {
    const response = await service(new InMemoryMarketplaceSource()).browse();

    expect(response.meta.sourceStatus).toBe("empty");
    expect(response.meta.sourceKind).toBeNull();
    expect(response.meta.refreshedAt).toBeNull();
    expect(response.meta.fixtureCount).toBe(0);
    expect(response.results).toEqual([]);
    expect(response.excluded).toEqual([]);
  });

  it("retains degraded source metadata when a requested detail is absent", async () => {
    const read = await service(new InMemoryMarketplaceSource([], {
      status: "degraded",
      sourceName: "postgres-ingestion-read-model",
      warning: "The indexed projection is stale."
    })).readAgent("missing-agent");

    expect(read.agent).toBeNull();
    expect(read.meta).toMatchObject({
      sourceStatus: "degraded",
      sourceName: "postgres-ingestion-read-model",
      warning: "The indexed projection is stale.",
      sourceKind: null,
      retrievalMode: "deterministic"
    });
  });

  it("supports category, text, protocol, and atomic-price filters", async () => {
    const readModel = service(new InMemoryMarketplaceSource(developmentFixtureListings));

    const category = await readModel.category("yield-optimisation");
    expect(category.results.map((agent) => agent.slug)).toEqual(["fixture-yield-router"]);

    const text = await readModel.search({ query: "Venus" });
    expect(text.results.map((agent) => agent.slug)).toEqual([
      "fixture-health-guard",
      "fixture-yield-router"
    ]);

    const protocol = await readModel.search({ requiredProtocols: ["pancakeswap-v3"] });
    expect(protocol.results.map((agent) => agent.slug)).toEqual(["fixture-lp-rebalancer"]);

    const price = await readModel.search({ maxPriceAtomic: "9000000000000000" });
    expect(price.results.map((agent) => agent.slug)).toEqual([
      "fixture-health-guard",
      "fixture-yield-router"
    ]);
    expect(price.excluded).toHaveLength(2);
    expect(price.excluded[0]?.reasons[0]?.code).toBe("PRICE_EXCEEDS_MAXIMUM");
  });

  it("searches normalized advertised A2A skill labels without treating them as tested skills", async () => {
    const original = developmentFixtureListings[0]!;
    const a2a = original.services.find((candidate) => candidate.kind === "a2a") ?? original.services[0]!;
    const listing: MarketplaceListingInput = {
      ...original,
      slug: "fixture-advertised-grid-label",
      serviceEvidence: [{
        kind: "a2a",
        advertisedUrl: a2a.url,
        cardUrl: a2a.url,
        invocationUrls: [a2a.url],
        advertisedSkills: [{
          id: "strategy",
          name: "Strategy",
          description: "Public strategy descriptor",
          tags: ["grid-trading"],
          keywords: ["range"]
        }],
        testedSkills: [],
        testStatus: "transport_only",
        testedAt: null
      }]
    };
    const response = await service(new InMemoryMarketplaceSource([listing])).search({ query: "grid-trading" });
    expect(response.results.map((agent) => agent.slug)).toEqual(["fixture-advertised-grid-label"]);
    expect(response.results[0]?.serviceEvidence?.[0]?.advertisedSkills[0]).toMatchObject({
      tags: ["grid-trading"],
      keywords: ["range"]
    });
    expect(response.results[0]?.serviceEvidence?.[0]?.testedSkills).toEqual([]);
  });

  it("routes an evidence-backed secondary category without making it tested capability", async () => {
    const original = developmentFixtureListings[0]!;
    const a2a = original.services.find((candidate) => candidate.kind === "a2a") ?? original.services[0]!;
    const listing: MarketplaceListingInput = {
      ...original,
      slug: "fixture-grid-yield",
      category: "grid-trading",
      applicableCategories: ["yield-optimisation"],
      serviceEvidence: [{
        kind: "a2a",
        advertisedUrl: a2a.url,
        cardUrl: a2a.url,
        invocationUrls: [a2a.url],
        advertisedSkills: [{
          id: "grid-yield",
          name: "Grid yield",
          description: "Public strategy descriptor",
          tags: ["grid-trading"],
          keywords: ["yield"]
        }],
        testedSkills: [],
        testStatus: "transport_only",
        testedAt: null
      }]
    };
    const readModel = service(new InMemoryMarketplaceSource([listing]));

    const primary = await readModel.search({ category: "grid-trading" });
    const secondary = await readModel.search({ category: "yield-optimisation" });
    const text = await readModel.search({ query: "yield" });

    expect(primary.results.map((agent) => agent.slug)).toEqual(["fixture-grid-yield"]);
    expect(secondary.results.map((agent) => agent.slug)).toEqual(["fixture-grid-yield"]);
    expect(text.results.map((agent) => agent.slug)).toEqual(["fixture-grid-yield"]);
    expect(secondary.results[0]).toMatchObject({
      category: "grid-trading",
      applicableCategories: ["yield-optimisation"],
      serviceEvidence: [{ testedSkills: [] }]
    });
  });

  it("uses stable score tie-breaking after equal score components", async () => {
    const tieB = { ...developmentFixtureListings[0]!, name: "Same Agent", slug: "tie-b" };
    const tieA = { ...developmentFixtureListings[1]!, name: "Same Agent", slug: "tie-a" };
    const response = await service(new InMemoryMarketplaceSource([tieB, tieA])).search();

    expect(response.results.map((agent) => agent.slug)).toEqual(["tie-a", "tie-b"]);
    expect(response.results[0]?.eligibility.score).toBe(response.results[1]?.eligibility.score);
  });

  it("returns hard-filter exclusions instead of allowing incompatible records to rank", async () => {
    const original = developmentFixtureListings[0]!;
    const excluded: MarketplaceListingInput = {
      ...original,
      slug: "fixture-excluded",
      state: {
        ...original.state,
        verificationStatus: "pending",
        runtimeStatus: "paused",
        authorityStatus: "revoked",
        listingStatus: "draft"
      },
      health: {
        endpointStatus: "unhealthy",
        observedAt: original.health.observedAt,
        latencyMs: null,
        source: "fixture-degraded-probe"
      },
      dataFreshness: {
        ...original.dataFreshness,
        status: "stale"
      },
      provenance: {
        ...original.provenance,
        identityRead: {
          observedBlock: null,
          observedBlockHash: null,
          readConsistency: null,
          observedAt: original.provenance.identityRead.observedAt
        }
      }
    };
    const response = await service(new InMemoryMarketplaceSource([excluded])).search({
      requireAuthority: true,
      requireFreshData: true,
      requestedAmountAtomic: "2",
      requiredContract: "0x00000000000000000000000000000000000000ff"
    });

    expect(response.results).toEqual([]);
    expect(response.excluded).toHaveLength(1);
    expect(response.excluded[0]?.reasons.map((reason) => reason.code)).toEqual([
      "ENDPOINT_UNHEALTHY",
      "IDENTITY_UNRESOLVED",
      "AUTHORITY_REVOKED",
      "SELECTOR_NOT_ALLOWLISTED",
      "DATA_STALE",
      "LISTING_NOT_PUBLISHED",
      "VERIFICATION_PENDING"
    ]);
  });

  it("supports comparison of up to three records and a complete detail response", async () => {
    const readModel = service(new InMemoryMarketplaceSource(developmentFixtureListings));
    const compared = await readModel.compare([
      "fixture-lp-rebalancer",
      developmentFixtureListings[1]!.identityKey,
      "missing-agent"
    ]);

    expect(compared.requested).toHaveLength(3);
    expect(compared.agents).toHaveLength(2);
    expect(compared.missing).toEqual(["missing-agent"]);
    expect(compared.agents.every((agent) => agent.activation.available === false)).toBe(true);

    const detail = await readModel.getAgent("fixture-lp-rebalancer");
    expect(detail.agent.detail.inputSchemas).toHaveLength(1);
    expect(detail.agent.detail.outputSchemas).toHaveLength(1);
    expect(detail.agent.identity.namespace).toBe("erc8004");
    expect(detail.agent.state).toEqual({
      originType: "manual_import",
      claimStatus: "unclaimed",
      verificationStatus: "verified",
      runtimeStatus: "live",
      authorityStatus: "active",
      listingStatus: "published"
    });
  });

  it("does not count two aliases for one identity as two compared agents", async () => {
    const listing = developmentFixtureListings[0]!;
    const compared = await service(new InMemoryMarketplaceSource([listing])).compare([
      listing.slug,
      listing.identityKey
    ]);

    expect(compared.requested).toEqual([listing.slug, listing.identityKey]);
    expect(compared.agents).toHaveLength(1);
    expect(compared.missing).toEqual([]);
  });

  it("rejects a comparison request with more than three identifiers", async () => {
    await expect(
      service(new InMemoryMarketplaceSource(developmentFixtureListings)).compare([
        "a",
        "b",
        "c",
        "d"
      ])
    ).rejects.toMatchObject({ code: "MARKETPLACE_COMPARE_LIMIT" });
  });

  it("preserves a degraded source warning without presenting it as live", async () => {
    const response = await service(
      new InMemoryMarketplaceSource(developmentFixtureListings, {
        status: "degraded",
        sourceName: "DEVELOPMENT FIXTURES",
        warning: "One optional enrichment source is unavailable."
      })
    ).search();

    expect(response.meta.sourceStatus).toBe("degraded");
    expect(response.meta.sourceKind).toBe("fixture");
    expect(response.meta.retrievalMode).toBe("deterministic");
    expect(response.meta.warning).toBe("One optional enrichment source is unavailable.");
    expect(response.meta.fixtureCount).toBe(4);
    expect(response.results.every((agent) => agent.fixture?.label.includes("NOT LIVE") === true)).toBe(true);
  });

  it("keeps optional activation explicitly unavailable", async () => {
    const response = await service(new InMemoryMarketplaceSource(developmentFixtureListings)).search();

    for (const agent of response.results) {
      expect(agent.activation).toMatchObject({
        available: false,
        featureGate: "activation-commerce",
        reasonCode: "OPTIONAL_RAIL_DISABLED"
      });
    }
  });

  it("allows a free listing to satisfy an atomic maximum-price filter", async () => {
    const freeListing = {
      ...developmentFixtureListings[0]!,
      pricing: {
        ...developmentFixtureListings[0]!.pricing,
        model: "free" as const,
        tokenAddress: null,
        tokenSymbol: null,
        minAtomic: null,
        maxAtomic: null
      }
    };
    const response = await service(new InMemoryMarketplaceSource([freeListing])).search({
      maxPriceAtomic: "1"
    });

    expect(response.results.map((agent) => agent.slug)).toEqual([freeListing.slug]);
    expect(response.excluded).toEqual([]);
  });

  it("enforces freshness age for requests that require current data", async () => {
    const staleDespiteLabel = {
      ...developmentFixtureListings[0]!,
      dataFreshness: {
        ...developmentFixtureListings[0]!.dataFreshness,
        status: "fresh" as const,
        observedAt: "2026-09-02T11:00:00.000Z",
        maxAgeSeconds: 300
      }
    };
    const evaluation = evaluateListing(
      staleDespiteLabel,
      { query: "", requiredProtocols: [], requireAuthority: false, requireFreshData: true },
      now
    );

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasons.map((reason) => reason.code)).toContain("DATA_STALE");
  });

  it("uses one clock sample per read operation for deterministic evaluations", async () => {
    let calls = 0;
    const readModel = new MarketplaceReadService(new InMemoryMarketplaceSource(developmentFixtureListings), {
      now: () => {
        calls += 1;
        return now;
      },
      requestId: () => "req-deterministic-clock"
    });

    await readModel.search();

    expect(calls).toBe(1);
  });

  it("rejects inconsistent public state and pricing/evidence metadata", () => {
    const fixture = developmentFixtureListings[0]!;
    expect(() => marketplacePricingSchema.parse({
      ...fixture.pricing,
      model: "fixed",
      minAtomic: null,
      maxAtomic: null
    })).toThrow();
    expect(() => marketplaceFreshnessSchema.parse({
      ...fixture.dataFreshness,
      status: "fresh",
      observedAt: null
    })).toThrow();
    expect(() => marketplaceExecutionEvidenceSchema.parse({
      status: "verified",
      lastVerifiedAt: null,
      reference: null
    })).toThrow();
    expect(() => marketplaceActivationOfferSchema.parse({
      advertised: false,
      method: "erc8183",
      label: "not actually available"
    })).toThrow();
    expect(() => new InMemoryMarketplaceSource([{
      ...fixture,
      pricing: { ...fixture.pricing, network: 56 }
    }])).toThrow(/pricing network/i);
    expect(() => new InMemoryMarketplaceSource([{
      ...fixture,
      fixture: null,
      provenance: {
        ...fixture.provenance,
        fixture: { ...fixture.fixture! }
      }
    }])).toThrow(/fixture/i);
  });

  it("returns the shared structured error envelope when a source fails", async () => {
    const failingSource: MarketplaceSource = {
      async read(): Promise<never> {
        throw new Error("provider unavailable");
      }
    };

    const result = await service(failingSource).safeSearch();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toEqual({
        code: "MARKETPLACE_SOURCE_UNAVAILABLE",
        message: "Marketplace data is temporarily unavailable.",
        requestId: "req-marketplace-test",
        retriable: true,
        nextAction: "retry_marketplace"
      });
    }
  });

  it("adapts InMemoryIngestionRepository identity, service, capability, and probe ports", async () => {
    const fixture = developmentFixtureListings[0]!;
    const repository = new InMemoryIngestionRepository();
    const observedAt = new Date(developmentFixtureTimestamp());
    await repository.upsertIdentity({
      identity: fixture.identity,
      originType: "manual_import",
      canonicalState: {
        ownerAddress: "0x000000000000000000000000000000000000000b",
        agentWallet: fixture.authority.executionWallet,
        agentUri: "https://fixture.invalid/profile.json",
        contentDigest: null,
        observedBlock: fixture.provenance.identityRead.observedBlock!,
        observedBlockHash: fixture.provenance.identityRead.observedBlockHash!,
        readConsistency: "finalized",
        ownerObservedBlock: fixture.provenance.identityRead.observedBlock,
        agentWalletObservedBlock: fixture.provenance.identityRead.observedBlock,
        agentUriObservedBlock: fixture.provenance.identityRead.observedBlock,
        contentDigestObservedBlock: null
      }
    });
    await repository.recordSource({
      identityKey: fixture.identityKey,
      source: "manual",
      sourceReference: "import-1",
      observedAt,
      rawResponseDigest: null,
      normalizedIngestionVersion: "manual-v1"
    });
    await repository.upsertCapabilities({
      identityKey: fixture.identityKey,
      source: "manual",
      schemaVersion: fixture.capabilities.schemaVersion,
      capabilityManifest: fixture.capabilities,
      manifestDigest: canonicalSha256Hex(fixture.capabilities),
      observedAt
    });
    const advertised = fixture.services[0]!;
    await repository.upsertService({
      ...advertised,
      identityKey: fixture.identityKey,
      capabilityManifestDigest: canonicalSha256Hex(fixture.capabilities)
    });
    await repository.appendProbeResult({
      identityKey: fixture.identityKey,
      kind: advertised.kind,
      url: advertised.url,
      validationStatus: "healthy",
      statusCode: 200,
      latencyMs: 42,
      safeCapabilityProbe: {
        protocol: "a2a",
        contract: "agent-card",
        valid: true,
        invocationUrls: [advertised.url],
        skills: [{
          id: "strategy",
          name: "Strategy",
          description: "Public strategy descriptor",
          tags: ["grid-trading"],
          keywords: ["range"]
        }]
      },
      errorCode: null,
      observedAt
    });
    const alternateService = {
      ...advertised,
      kind: "mcp" as const,
      url: "https://fixture.invalid/alternate/mcp",
      protocolVersion: "fixture-mcp-v1"
    };
    await repository.upsertService({
      ...alternateService,
      identityKey: fixture.identityKey,
      capabilityManifestDigest: canonicalSha256Hex(fixture.capabilities)
    });
    await repository.appendProbeResult({
      identityKey: fixture.identityKey,
      kind: advertised.kind,
      url: advertised.url,
      validationStatus: "unhealthy",
      statusCode: 503,
      latencyMs: 80,
      safeCapabilityProbe: null,
      errorCode: "SERVICE_UPSTREAM_UNAVAILABLE",
      observedAt: new Date(observedAt.getTime() + 30_000)
    });
    await repository.appendProbeResult({
      identityKey: fixture.identityKey,
      kind: alternateService.kind,
      url: alternateService.url,
      validationStatus: "healthy",
      statusCode: 405,
      latencyMs: 25,
      safeCapabilityProbe: { protocol: "mcp" },
      errorCode: null,
      observedAt: new Date(observedAt.getTime() + 5_000)
    });

    const reputationRegistry = "0x2222222222222222222222222222222222222222";
    const recognizedReviewer = "0x00000000000000000000000000000000000000aa";
    const unrecognizedReviewer = "0x00000000000000000000000000000000000000bb";
    const feedbackHash = `0x${"f".repeat(64)}`;
    await repository.appendReputationEvent({
      identity: fixture.identity,
      reputationRegistry,
      eventType: "NewFeedback",
      clientAddress: recognizedReviewer,
      feedbackIndex: "7",
      value: "8750",
      valueDecimals: 2,
      indexedTag1: "quality",
      tag1: "accurate",
      tag2: "defi",
      endpoint: advertised.url,
      feedbackUri: "ipfs://bafy-feedback-7",
      feedbackHash,
      transactionHash: `0x${"1".repeat(64)}`,
      logIndex: 0,
      blockNumber: 125,
      blockHash: `0x${"2".repeat(64)}`,
      confirmationState: "canonical",
      observedAt: new Date(observedAt.getTime() + 40_000),
      canonicalizedAt: new Date(observedAt.getTime() + 40_000),
      orphanedAt: null,
      payloadDigest: "a".repeat(64)
    });
    await repository.appendReputationEvent({
      identity: fixture.identity,
      reputationRegistry,
      eventType: "FeedbackRevoked",
      clientAddress: recognizedReviewer,
      feedbackIndex: "7",
      value: null,
      valueDecimals: null,
      indexedTag1: null,
      tag1: null,
      tag2: null,
      endpoint: null,
      feedbackUri: null,
      feedbackHash: null,
      transactionHash: `0x${"3".repeat(64)}`,
      logIndex: 1,
      blockNumber: 126,
      blockHash: `0x${"4".repeat(64)}`,
      confirmationState: "canonical",
      observedAt: new Date(observedAt.getTime() + 41_000),
      canonicalizedAt: new Date(observedAt.getTime() + 41_000),
      orphanedAt: null,
      payloadDigest: "b".repeat(64)
    });
    await repository.appendReputationEvent({
      identity: fixture.identity,
      reputationRegistry,
      eventType: "NewFeedback",
      clientAddress: unrecognizedReviewer,
      feedbackIndex: "8",
      value: "91",
      valueDecimals: 0,
      indexedTag1: null,
      tag1: "fast",
      tag2: "",
      endpoint: advertised.url,
      feedbackUri: "https://example.invalid/feedback/8",
      feedbackHash: null,
      transactionHash: `0x${"5".repeat(64)}`,
      logIndex: 0,
      blockNumber: 127,
      blockHash: `0x${"6".repeat(64)}`,
      confirmationState: "canonical",
      observedAt: new Date(observedAt.getTime() + 42_000),
      canonicalizedAt: new Date(observedAt.getTime() + 42_000),
      orphanedAt: null,
      payloadDigest: "c".repeat(64)
    });

    const metadata = {
      ...metadataFromFixture(fixture),
      fixture: null
    };
    let sourceNow = now;
    const source = new IngestionMarketplaceSource(
      repository,
      new InMemoryMarketplaceMetadataSource([metadata]),
      { now: () => sourceNow, recognizedReviewerAddresses: [`0x${recognizedReviewer.slice(2).toUpperCase()}`] }
    );
    const snapshot = await source.read();
    expect(snapshot.records[0]?.identityKey).toBe(fixture.identityKey);
    expect(snapshot.records[0]?.provenance.sourceKind).toBe("ingestion");
    expect(snapshot.records[0]?.fixture).toBeNull();
    expect(snapshot.records[0]?.health).toMatchObject({
      endpointStatus: "healthy",
      latencyMs: 25,
      source: "agent-ingestion-probe"
    });
    expect(snapshot.records[0]?.metrics?.uptime).toMatchObject({
      status: "observed",
      windowSeconds: 30,
      monitoringWindowSeconds: 1_800,
      coverageSeconds: 30,
      coverageRatio: 30 / 1_800,
      attemptedChecks: 3,
      successfulChecks: 2,
      successRatio: 2 / 3,
      source: "agent-ingestion-probe"
    });
    expect(snapshot.records[0]?.metrics?.reviews).toMatchObject({
      status: "unavailable",
      count: null,
      averageScore: null
    });
    expect(snapshot.records[0]?.metrics?.reputation.rawPermissionless).toMatchObject({
      status: "available",
      count: 1,
      source: "erc8004-reputation-registry"
    });
    expect(snapshot.records[0]?.metrics?.reputation.recognizedReviewers).toMatchObject({
      status: "available",
      count: 0,
      source: "erc8004-reputation-registry"
    });
    expect(snapshot.records[0]?.metrics?.reputation.rawPermissionless.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({
        feedbackIndex: "7",
        reviewerAddress: recognizedReviewer,
        value: "8750",
        valueDecimals: 2,
        indexedTag1: "quality",
        tag1: "accurate",
        tag2: "defi",
        endpoint: advertised.url,
        feedbackUri: "ipfs://bafy-feedback-7",
        feedbackHash,
        feedbackTransactionHash: `0x${"1".repeat(64)}`,
        feedbackLogIndex: 0,
        feedbackBlockNumber: 125,
        feedbackBlockHash: `0x${"2".repeat(64)}`,
        revoked: true,
        revocationTransactionHash: `0x${"3".repeat(64)}`,
        revocationLogIndex: 1,
        revocationBlockNumber: 126,
        revocationBlockHash: `0x${"4".repeat(64)}`
      }),
      expect.objectContaining({ feedbackIndex: "8", revoked: false, reviewerAddress: unrecognizedReviewer })
    ]));
    expect(snapshot.records[0]?.metrics?.reputation.verifiedPurchases).toMatchObject({
      status: "unavailable",
      count: null,
      reason: "BNBEra verified-purchase reviews are enabled by G2."
    });
    expect(snapshot.records[0]?.serviceEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mcp", advertisedUrl: alternateService.url, invocationUrls: [], testedSkills: [] })
    ]));
    expect(snapshot.records[0]?.serviceEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "a2a",
        advertisedSkills: [{
          id: "strategy",
          name: "Strategy",
          description: "Public strategy descriptor",
          tags: ["grid-trading"],
          keywords: ["range"]
        }],
        testedSkills: []
      })
    ]));

    const response = await service(source).search();

    expect(response.meta.sourceStatus).toBe("healthy");
    expect(response.excluded[0]?.identityKey).toBe(fixture.identityKey);
    expect(response.excluded[0]?.reasons.map((reason) => reason.code)).toEqual([
      "ENDPOINT_UNVERIFIED",
      "LISTING_NOT_PUBLISHED",
      "VERIFICATION_PENDING"
    ]);

    // A probe arriving during a long read is not future-dated at projection
    // time. The old pre-read clock incorrectly made this healthy MCP unknown.
    const originalListProbes = repository.listProbeResults.bind(repository);
    sourceNow = observedAt;
    repository.listProbeResults = async (identityKey) => {
      sourceNow = now;
      return originalListProbes(identityKey);
    };
    expect((await source.read()).records[0]?.health.endpointStatus).toBe("healthy");
    repository.listProbeResults = originalListProbes;
    sourceNow = observedAt;
    expect((await source.read()).records[0]?.health.endpointStatus).toBe("unknown");

    sourceNow = new Date("2026-09-02T12:02:36.000Z");
    const staleSnapshot = await source.read();
    expect(staleSnapshot.records[0]?.health).toMatchObject({
      endpointStatus: "unknown",
      source: "agent-ingestion-probe"
    });

    repository.listReputationFeedback = async () => {
      throw new Error("reputation table temporarily unavailable");
    };
    const reputationDegradedSnapshot = await source.read();
    expect(reputationDegradedSnapshot.status).toBe("degraded");
    expect(reputationDegradedSnapshot.warning).toContain("ERC-8004 reputation was unavailable");
    expect(reputationDegradedSnapshot.records[0]?.metrics?.reputation).toMatchObject({
      rawPermissionless: { status: "unavailable", count: null },
      recognizedReviewers: { status: "unavailable", count: null },
      verifiedPurchases: { status: "unavailable", count: null }
    });

    repository.listReputationFeedback = async () => [];
    const commerceDegradedSource = new IngestionMarketplaceSource(
      repository,
      new InMemoryMarketplaceMetadataSource([metadata]),
      {
        now: () => sourceNow,
        commerceProjection: {
          readForIdentity: async () => {
            throw new Error("commerce projection temporarily unavailable");
          }
        }
      }
    );
    const commerceDegradedSnapshot = await commerceDegradedSource.read();
    expect(commerceDegradedSnapshot.status).toBe("degraded");
    expect(commerceDegradedSnapshot.warning).toContain("BNBEra completed-job/review projection was unavailable");

    const settlementTransactionHash = `0x${"1".repeat(64)}`;
    const longDeliverableUrl = `data:text/plain;base64,${"a".repeat(700)}`;
    const commerceSource = new IngestionMarketplaceSource(
      repository,
      new InMemoryMarketplaceMetadataSource([metadata]),
      {
        now: () => sourceNow,
        commerceProjection: {
          readForIdentity: async () => ({
            completedJobs: [{
              settledAtUnix: Math.floor(observedAt.getTime() / 1_000),
              result: {
                localSha256: "a".repeat(64),
                chainKeccak: `0x${"2".repeat(64)}`,
                deliverableUrl: longDeliverableUrl,
                settlementReceipt: { transactionHash: settlementTransactionHash }
              }
            }],
            verifiedReviews: [],
            observedAtUnix: Math.floor(observedAt.getTime() / 1_000)
          })
        }
      }
    );
    const commerceSnapshot = await commerceSource.read();
    expect(commerceSnapshot.records).toHaveLength(1);
    expect(commerceSnapshot.records[0]?.metrics?.completedJobs).toMatchObject({
      status: "available",
      completedCount: 1
    });
    expect(commerceSnapshot.records[0]?.metrics?.lastResult).toMatchObject({
      status: "available",
      reference: settlementTransactionHash
    });
  });

  it("fills an explicit reputation absence for legacy listings", async () => {
    const fixture = developmentFixtureListings[0]!;
    const { reputation: _reputation, ...legacyMetrics } = fixture.metrics!;
    const listing = { ...fixture, metrics: legacyMetrics } as unknown as MarketplaceListingInput;
    const source = new InMemoryMarketplaceSource([listing]);
    const snapshot = await source.read();
    expect(snapshot.records[0]?.metrics?.reputation).toMatchObject({
      rawPermissionless: { status: "unknown", count: null },
      recognizedReviewers: { status: "unavailable", count: null },
      verifiedPurchases: { status: "unavailable", count: null }
    });
  });
});

function developmentFixtureTimestamp(): string {
  return "2026-09-02T12:00:00.000Z";
}
