import { afterEach, describe, expect, it, vi } from "vitest";
import {
  marketplaceAgentReadResponseSchema,
  marketplaceSearchResponseSchema,
  readMarketplace,
  readMarketplaceAgent
} from "../../apps/web/src/lib/marketplace-contract";
import { GET as getMarketplace } from "../../apps/web/app/api/marketplace/route";
import { GET as getMarketplaceAgent } from "../../apps/web/app/api/marketplace/[slug]/route";

const environmentKeys = ["NODE_ENV", "MARKETPLACE_DATA_MODE", "MARKETPLACE_API_URL"] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of environmentKeys) {
    const original = originalEnvironment[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

function configureEnvironment(values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>): void {
  for (const key of environmentKeys) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key as (typeof environmentKeys)[number]] = value;
    }
  }
}

describe("web marketplace read contract", () => {
  it("exposes four labelled fixture categories with activation disabled", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const response = await readMarketplace({ limit: 50 });

    expect(marketplaceSearchResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("ready");
    expect(response.mode).toBe("fixture");
    expect(response.agents).toHaveLength(4);
    expect(new Set(response.agents.map((agent) => agent.category))).toEqual(new Set([
      "rebalancing",
      "grid-trading",
      "yield-optimisation",
      "health-factor"
    ]));
    expect(response.agents.every((agent) => agent.dataProvenance.mode === "fixture")).toBe(true);
    expect(response.agents.every((agent) => agent.activation.enabled === false)).toBe(true);
    expect(response.agents.every((agent) => agent.activation.availability === "unavailable")).toBe(true);
    expect(response.notice).toMatch(/not .*proof|not .*live/i);
  });

  it("applies category and query filters without changing the source mode", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const category = await readMarketplace({ category: "health-factor" });
    const query = await readMarketplace({ query: "pancakeswap", limit: 50 });

    expect(category.agents.map((agent) => agent.category)).toEqual(["health-factor"]);
    expect(query.agents.map((agent) => agent.category)).toEqual([
      "grid-trading",
      "rebalancing"
    ]);
    expect(category.mode).toBe("fixture");
    expect(query.mode).toBe("fixture");
  });

  it("fails closed to an empty model in production even when fixture mode is requested", async () => {
    configureEnvironment({ NODE_ENV: "production", MARKETPLACE_DATA_MODE: "fixture" });

    const response = await readMarketplace({ preview: "loading" });

    expect(response.status).toBe("empty");
    expect(response.mode).toBe("empty");
    expect(response.agents).toEqual([]);
    expect(response.notice).toMatch(/fixture data is disabled/i);
  });

  it("returns a structured error for an invalid data-mode configuration", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "made-up-mode" });

    const response = await readMarketplace();

    expect(response.status).toBe("error");
    expect(response.mode).toBe("error");
    expect(response.agents).toEqual([]);
    expect(response.error?.error).toMatchObject({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      nextAction: "check_configuration"
    });
  });

  it("keeps all non-live preview states explicit and activation-free", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const loading = await readMarketplace({ preview: "loading" });
    const empty = await readMarketplace({ preview: "empty" });
    const degraded = await readMarketplace({ preview: "degraded" });
    const error = await readMarketplace({ preview: "error" });

    expect(loading).toMatchObject({ status: "loading", mode: "fixture", agents: [], error: null });
    expect(empty).toMatchObject({ status: "empty", mode: "empty", agents: [], error: null });
    expect(degraded).toMatchObject({ status: "degraded", mode: "degraded", error: null });
    expect(degraded.agents.length).toBeGreaterThan(0);
    expect(degraded.agents.every((agent) => agent.activation.enabled === false)).toBe(true);
    expect(degraded.notice).toMatch(/degraded|not .*proof/i);
    expect(error).toMatchObject({ status: "error", mode: "error", agents: [] });
    expect(error.error?.error).toMatchObject({ code: "MARKETPLACE_READ_UNAVAILABLE" });
  });

  it("keeps fixture detail identity, evidence, and activation boundaries visible", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const response = await readMarketplaceAgent("fixture-lp-rebalancer");

    expect(marketplaceAgentReadResponseSchema.parse(response)).toEqual(response);
    expect(response.status).toBe("ready");
    expect(response.mode).toBe("fixture");
    expect(response.agent?.identity).toMatchObject({
      namespace: "erc8004",
      chainId: 97,
      identityRegistry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
      agentId: "1"
    });
    expect(response.agent?.dataProvenance.mode).toBe("fixture");
    expect(response.agent?.evidence).toMatchObject({
      status: "unavailable",
      ipfsUri: null,
      greenfieldUri: null
    });
    expect(response.agent?.activation.enabled).toBe(false);
  });

  it("returns an honest missing-detail state and rejects path-like identifiers", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const missing = await readMarketplaceAgent("not-in-the-read-model");

    expect(missing).toMatchObject({ status: "empty", agent: null, error: null });
    await expect(readMarketplaceAgent("../private-key")).rejects.toThrow();
  });

  it("turns a non-JSON upstream response into a safe structured error", async () => {
    configureEnvironment({
      NODE_ENV: "production",
      MARKETPLACE_DATA_MODE: "live",
      MARKETPLACE_API_URL: "https://read.example/api"
    });
    const fetchMock = vi.fn(async () => new Response("<html>upstream failure</html>", {
      status: 502,
      headers: { "content-type": "text/html" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await readMarketplace();

    expect(response.status).toBe("error");
    expect(response.error?.error.code).toBe("MARKETPLACE_RESPONSE_INVALID");
    expect(JSON.stringify(response)).not.toMatch(/upstream failure|<html>/i);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/api/marketplace" }),
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("rejects a valid JSON payload that does not match the web contract", async () => {
    configureEnvironment({
      NODE_ENV: "production",
      MARKETPLACE_DATA_MODE: "live",
      MARKETPLACE_API_URL: "https://read.example/api/"
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })));

    const response = await readMarketplace();

    expect(response.status).toBe("error");
    expect(response.error?.error.code).toBe("MARKETPLACE_RESPONSE_INVALID");
    expect(response.notice).toMatch(/validated|boundary/i);
  });

  it("preserves a validated remote read response and query path", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });
    const fixture = await readMarketplace({ category: "rebalancing" });
    configureEnvironment({
      NODE_ENV: "production",
      MARKETPLACE_DATA_MODE: "live",
      MARKETPLACE_API_URL: "https://read.example/base/"
    });
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      expect(input).toBeInstanceOf(URL);
      const url = input as URL;
      expect(url.pathname).toBe("/base/marketplace");
      expect(url.searchParams.get("category")).toBe("rebalancing");
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await readMarketplace({ category: "rebalancing" });

    expect(response).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the browse route as JSON and keeps invalid query errors structured", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const success = await getMarketplace(new Request("https://bnbera.example/api/marketplace"));
    const successBody = await success.json() as unknown;
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(marketplaceSearchResponseSchema.parse(successBody).mode).toBe("fixture");

    const invalid = await getMarketplace(new Request("https://bnbera.example/api/marketplace?limit=0"));
    const invalidBody = await invalid.json() as unknown;
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("content-type")).toMatch(/application\/json/i);
    expect(invalidBody).toMatchObject({
      error: {
        code: "MARKETPLACE_QUERY_INVALID",
        retriable: false
      }
    });
    expect(JSON.stringify(invalidBody)).not.toMatch(/stack|cause|password|token/i);
  });

  it("serves detail as JSON and reports a missing slug without HTML", async () => {
    configureEnvironment({ NODE_ENV: "development", MARKETPLACE_DATA_MODE: "fixture" });

    const detail = await getMarketplaceAgent(
      new Request("https://bnbera.example/api/marketplace/fixture-lp-rebalancer"),
      { params: Promise.resolve({ slug: "fixture-lp-rebalancer" }) }
    );
    const detailBody = await detail.json() as unknown;
    expect(detail.status).toBe(200);
    expect(marketplaceAgentReadResponseSchema.parse(detailBody).agent?.slug).toBe("fixture-lp-rebalancer");

    const missing = await getMarketplaceAgent(
      new Request("https://bnbera.example/api/marketplace/not-in-the-read-model"),
      { params: Promise.resolve({ slug: "not-in-the-read-model" }) }
    );
    const missingBody = await missing.json() as unknown;
    expect(missing.status).toBe(404);
    expect(marketplaceAgentReadResponseSchema.parse(missingBody)).toMatchObject({
      status: "empty",
      agent: null,
      error: null
    });
  });
});
