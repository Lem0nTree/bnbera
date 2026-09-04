import { describe, expect, it, vi } from "vitest";
import {
  InMemoryMarketplaceSource,
  MarketplaceReadService,
  developmentFixtureListings,
  type MarketplaceSemanticHit,
  type MarketplaceSemanticRetriever
} from "../index.js";

const now = new Date("2026-09-02T12:00:30.000Z");

function readModel(semanticRetriever: MarketplaceSemanticRetriever | undefined, enabled: boolean): MarketplaceReadService {
  return new MarketplaceReadService(new InMemoryMarketplaceSource(developmentFixtureListings), {
    now: () => now,
    requestId: () => "req-marketplace-hybrid-test",
    semanticRetrievalEnabled: enabled,
    ...(semanticRetriever === undefined ? {} : { semanticRetriever })
  });
}

function hit(identityKey: string, similarity: number, modelVersion = "test-v1"): MarketplaceSemanticHit {
  return { identityKey, similarity, modelVersion };
}

describe("hard-filtered marketplace semantic retrieval", () => {
  it("passes only hard-eligible candidates to the semantic ranker", async () => {
    const seen: string[][] = [];
    const semanticRetriever: MarketplaceSemanticRetriever = {
      search: vi.fn(async (input) => {
        seen.push([...input.candidateIdentityKeys]);
        return [...input.candidateIdentityKeys].reverse().map((key, index) => hit(key, index === 0 ? 0.99 : 0.01));
      })
    };

    const response = await readModel(semanticRetriever, true).search({ query: "Venus" });
    const eligibleKeys = response.results.map((agent) => agent.identityKey);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(2);
    expect(seen[0]?.every((key) => eligibleKeys.includes(key))).toBe(true);
    expect(response.excluded.length).toBeGreaterThan(0);
    expect(response.meta.retrievalMode).toBe("hybrid");
    expect(response.meta.semanticModelVersion).toBe("test-v1");
    expect(response.results[0]?.slug).toBe("fixture-yield-router");
  });

  it("uses deterministic ordering and a warning when no compatible embeddings exist", async () => {
    const baseline = await readModel(undefined, false).search({ query: "Venus" });
    const response = await readModel({ search: vi.fn(async () => []) }, true).search({ query: "Venus" });

    expect(response.results.map((agent) => agent.identityKey)).toEqual(baseline.results.map((agent) => agent.identityKey));
    expect(response.meta.retrievalMode).toBe("fallback");
    expect(response.meta.semanticModelVersion).toBeNull();
    expect(response.meta.warning).toMatch(/no compatible embeddings/iu);
  });

  it("ignores unknown, malformed, and duplicate hits while preserving stable ties", async () => {
    const eligible = developmentFixtureListings.slice(2).map((listing) => listing.identityKey);
    const response = await readModel({
      search: vi.fn(async () => [
        hit("unknown:tenant:key", 1, "test-v1"),
        hit(eligible[1]!, 0.5, "test-v1"),
        hit(eligible[0]!, 0.5, "test-v1"),
        hit(eligible[0]!, 0.1, "test-v1"),
        hit(eligible[1]!, Number.NaN, "test-v1")
      ])
    }, true).search({ query: "Venus" });

    expect(response.meta.retrievalMode).toBe("hybrid");
    expect(response.results.map((agent) => agent.slug)).toEqual([
      "fixture-health-guard",
      "fixture-yield-router"
    ]);
  });

  it("falls back on mixed model versions and never calls a disabled ranker", async () => {
    const mixed = await readModel({
      search: vi.fn(async (input: Parameters<MarketplaceSemanticRetriever["search"]>[0]) => input.candidateIdentityKeys.map((key, index) => hit(key, 0.8 - index * 0.1, index === 0 ? "test-v1" : "test-v2")))
    }, true).search({ query: "Venus" });
    expect(mixed.meta.retrievalMode).toBe("fallback");
    expect(mixed.meta.semanticModelVersion).toBeNull();
    expect(mixed.meta.warning).toMatch(/mixed model versions/iu);

    const disabledSearch = vi.fn(async () => [hit(developmentFixtureListings[0]!.identityKey, 1)]);
    const disabled = await readModel({ search: disabledSearch }, false).search({ query: "Venus" });
    expect(disabledSearch).not.toHaveBeenCalled();
    expect(disabled.meta.retrievalMode).toBe("deterministic");
    expect(disabled.meta.semanticModelVersion).toBeNull();
    expect(disabled.meta.warning).toBeNull();
  });
});
