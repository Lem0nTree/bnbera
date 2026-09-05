import { afterEach, describe, expect, it } from "vitest";
import { normalizePersistedMarketplaceMetrics } from "./marketplace-server";
import {
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
