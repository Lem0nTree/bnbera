import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryMarketplaceSource,
  MarketplaceReadService,
  developmentFixtureListings,
  type MarketplaceListingInput
} from "@bnbera/marketplace";
import { normalizePersistedMarketplaceMetrics } from "./marketplace-server";
import {
  mapMarketplaceSearchResponse,
  marketplaceSearchResponseSchema,
  parseMarketplaceSearchParams,
  readMarketplace,
  readMarketplaceAgent
} from "./marketplace-contract";

const originalDataMode = process.env.MARKETPLACE_DATA_MODE;

afterEach(() => {
  if (originalDataMode === undefined) {
    delete process.env.MARKETPLACE_DATA_MODE;
  } else {
    process.env.MARKETPLACE_DATA_MODE = originalDataMode;
  }
});

describe("marketplace web adapter", () => {
  it("only exposes fresh, validated persisted feedback metrics", () => {
    const stale = normalizePersistedMarketplaceMetrics([{
      provider: "erc8004-reputation",
      observation_type: "feedback",
      normalized_payload: { reviewCount: 99, averageScore: 98 },
      source_timestamp: "2026-09-05T00:00:00.000Z",
      freshness: "stale",
      validation_state: "verified"
    }]);
    const pending = normalizePersistedMarketplaceMetrics([{
      provider: "erc8004-reputation",
      observation_type: "feedback",
      normalized_payload: { reviewCount: 99, averageScore: 98 },
      source_timestamp: "2026-09-05T00:00:00.000Z",
      freshness: "fresh",
      validation_state: "pending"
    }]);
    expect(stale.reviews).toMatchObject({ status: "unavailable", count: null, averageScore: null });
    expect(pending.reviews).toMatchObject({ status: "unavailable", count: null, averageScore: null });

    const fresh = normalizePersistedMarketplaceMetrics([{
      provider: "erc8004-reputation",
      observation_type: "feedback",
      normalized_payload: { reviewCount: 2, averageScore: 87 },
      source_timestamp: "2026-09-05T00:00:00.000Z",
      freshness: "fresh",
      validation_state: "verified"
    }]);
    expect(fresh.reviews).toMatchObject({
      status: "available",
      count: 2,
      averageScore: 87,
      source: "erc8004-reputation",
      observedAt: "2026-09-05T00:00:00.000Z"
    });
  });

  it("parses discovery filters into the shared read input", () => {
    const input = parseMarketplaceSearchParams(new URLSearchParams(
      "q=yield&chainId=97&protocol=venus&freshness=fresh&sort=freshness&limit=3"
    ));

    expect(input).toMatchObject({
      query: "yield",
      chainId: 97,
      protocol: "venus",
      freshness: "fresh",
      sort: "freshness",
      limit: 3
    });
  });

  it("keeps fixture mode labelled while applying network and protocol filters", async () => {
    process.env.MARKETPLACE_DATA_MODE = "fixture";
    const response = await readMarketplace({ chainId: 97, protocol: "venus" });

    expect(response.mode).toBe("fixture");
    expect(response.status).toBe("ready");
    expect(response.agents.length).toBeGreaterThan(0);
    expect(response.agents.every((agent) => agent.identity.chainId === 97)).toBe(true);
    expect(response.agents.every((agent) => agent.protocols.includes("venus"))).toBe(true);
    expect(response.agents.every((agent) => agent.dataProvenance.mode === "fixture")).toBe(true);
    expect(response.agents.every((agent) => agent.activation.enabled === false)).toBe(true);
  });

  it("projects advertised labels and routes one listing through primary and secondary categories", async () => {
    const original = developmentFixtureListings[0]!;
    const a2a = original.services.find((candidate) => candidate.kind === "a2a") ?? original.services[0]!;
    const listing: MarketplaceListingInput = {
      ...original,
      slug: "fixture-web-grid-yield",
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
    const readModel = new MarketplaceReadService(new InMemoryMarketplaceSource([listing]));
    const searchInput = parseMarketplaceSearchParams(new URLSearchParams("q=grid-trading&limit=12"));
    const core = await readModel.search({ query: searchInput.query, limit: searchInput.limit });
    const projected = mapMarketplaceSearchResponse(searchInput, core, "fixture");
    const secondaryInput = parseMarketplaceSearchParams(new URLSearchParams("category=yield-optimisation&limit=12"));
    const secondaryCore = await readModel.search({ category: secondaryInput.category, limit: secondaryInput.limit });
    const secondary = mapMarketplaceSearchResponse(secondaryInput, secondaryCore, "fixture");

    expect(projected.agents).toHaveLength(1);
    expect(projected.agents[0]).toMatchObject({
      slug: "fixture-web-grid-yield",
      category: "grid-trading",
      applicableCategories: ["yield-optimisation"],
      serviceEvidence: [{
        advertisedSkills: [{ tags: ["grid-trading"], keywords: ["yield"] }],
        testedSkills: []
      }]
    });
    expect(secondary.agents.map((agent) => agent.slug)).toEqual(["fixture-web-grid-yield"]);
  });

  it("accepts legacy API records without reputation and marks the views explicitly", async () => {
    process.env.MARKETPLACE_DATA_MODE = "fixture";
    const current = await readMarketplace({ limit: 1 });
    const agent = current.agents[0]!;
    const { reputation: _reputation, ...legacyMetrics } = agent.metrics;
    const legacy = marketplaceSearchResponseSchema.parse({
      ...current,
      agents: [{ ...agent, metrics: legacyMetrics }]
    });

    expect(legacy.agents[0]?.metrics.reputation).toMatchObject({
      rawPermissionless: { status: "unknown", count: null },
      recognizedReviewers: { status: "unavailable", count: null },
      verifiedPurchases: { status: "unavailable", count: null }
    });
  });

  it("exposes deterministic loading and empty state previews", async () => {
    const loading = await readMarketplace({ preview: "loading" });
    const empty = await readMarketplace({ preview: "empty" });

    expect(loading).toMatchObject({ status: "loading", mode: "fixture", agents: [], excluded: [] });
    expect(empty).toMatchObject({ status: "empty", mode: "empty", agents: [], excluded: [] });
  });

  it("returns a labelled empty detail response for a missing fixture slug", async () => {
    process.env.MARKETPLACE_DATA_MODE = "fixture";
    const response = await readMarketplaceAgent("missing-fixture-agent");

    expect(response).toMatchObject({ status: "empty", mode: "fixture", agent: null, error: null });
  });
});
