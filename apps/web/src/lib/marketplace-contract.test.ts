import { afterEach, describe, expect, it } from "vitest";
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
