import { describe, expect, it, vi } from "vitest";
import {
  EightHundredFourScanHttpClient,
  createEightHundredFourScanAdapter,
  ingestionError,
  mapOfficialEightHundredFourScanCandidate,
  officialEightHundredFourScanContract,
  verifyEightHundredFourScanOpenApi
} from "../index.js";

const address = "0x2222222222222222222222222222222222222222";

function page(item: unknown, total = 1): Response {
  return new Response(JSON.stringify({ items: [item], total, limit: 1, offset: 0 }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

const summary = {
  id: "summary-1",
  agent_id: `97:${address}:900719925474099312345`,
  token_id: "900719925474099312345",
  chain_id: 97,
  chain_type: "evm",
  contract_address: address.toUpperCase(),
  owner_address: "0x3333333333333333333333333333333333333333",
  name: "Public yield helper",
  description: "Optimizes yield through a reviewed capability.",
  supported_protocols: ["A2A"],
  services: { a2a: { url: "https://agent.example/a2a", version: "1" } },
  x402_supported: false,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z"
} as const;

describe("reviewed 8004scan contract boundary", () => {
  it("bridges a legacy offset checkpoint and follows opaque cursors without offset", async () => {
    const urls: URL[] = [];
    const client = new EightHundredFourScanHttpClient({ minRequestIntervalMs: 0, maxRetries: 0,
      fetch: async input => {
        const url = new URL(String(input)); urls.push(url);
        return Response.json({ items: [summary], total: 311820, limit: 100, offset: 0,
          has_more: urls.length === 1, next_cursor: urls.length === 1 ? "opaque-page-cursor" : null });
      } });
    const result = await client.listCandidates({ chainId: 56, isActive: "any", sortBy: "created_at", sortOrder: "asc", offset: 10100, limit: 100 });
    expect(urls[0]!.searchParams.get("offset")).toBe("10000");
    expect(urls[1]!.searchParams.has("offset")).toBe(false);
    expect(urls[1]!.searchParams.get("cursor")).toBe("opaque-page-cursor");
    expect(urls[1]!.searchParams.get("is_active")).toBe("any");
    expect(result).toMatchObject({ nextCursor: null, nextOffset: null });
    await expect(client.listCandidates({ offset: 0, cursor: "opaque" })).rejects.toMatchObject({ code: "SCAN_CONFIG_INVALID" });
    await expect(client.listCandidates({ offset: 50000 })).rejects.toMatchObject({ code: "SCAN_CONFIG_INVALID" });
  });

  it("accepts a full 100-profile page while preserving each profile's safety budget", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...summary, id: `summary-${index}`, extraPublicFacts: Array.from({ length: 30 }, (_, fact) => `fact-${fact}`) }));
    const client = new EightHundredFourScanHttpClient({ minRequestIntervalMs: 0, maxRetries: 0,
      fetch: async () => Response.json({ items, total: 310000, limit: 100, offset: 0 }) });
    await expect(client.listCandidates({ limit: 100 })).resolves.toMatchObject({ total: 310000, nextOffset: 100 });
    const unsafe = new EightHundredFourScanHttpClient({ minRequestIntervalMs: 0, maxRetries: 0,
      fetch: async () => Response.json({ items: [...items.slice(0, 99), { ...summary, access_token: "not-public" }], total: 100, limit: 100, offset: 0 }) });
    await expect(unsafe.listCandidates({ limit: 100 })).rejects.toMatchObject({ code: "SCAN_CONTRACT_INVALID" });
  });

  it("preserves network and bounded sorted-page selection", async () => {
    const fetcher=vi.fn<typeof fetch>(async input=>{
      const url=new URL(String(input));
      expect(Object.fromEntries(url.searchParams)).toMatchObject({chain_id:"56",is_testnet:"false",limit:"20",offset:"40",sort_by:"total_score",sort_order:"desc"});
      return new Response(JSON.stringify({items:[],total:310000,limit:20,offset:40}),{status:200,headers:{"content-type":"application/json"}});
    });
    const client=new EightHundredFourScanHttpClient({baseUrl:"https://scan.example/api/v1",fetch:fetcher,minRequestIntervalMs:0});
    await client.listCandidates({chainId:56,isTestnet:false,limit:20,offset:40,sortBy:"total_score",sortOrder:"desc"});
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps the complete provider identity tuple and keeps owner non-authoritative", () => {
    const mapped = mapOfficialEightHundredFourScanCandidate(summary);
    expect(mapped.identity).toEqual({ namespace: "eip155", chainId: 97, identityRegistry: address, agentId: "900719925474099312345" });
    expect(mapped.sourceReference).toBe(`agent:97:${address}:900719925474099312345`);
    expect(mapped.metadata).not.toHaveProperty("owner_address");
    expect(mapped.services).toEqual([{ kind: "a2a", url: "https://agent.example/a2a", protocolVersion: "1" }]);
  });

  it("allows explicit inactive-inclusive discovery without changing the default", async () => {
    const urls: URL[] = [];
    const client = new EightHundredFourScanHttpClient({ minRequestIntervalMs: 0, maxRetries: 0,
      fetch: async input => { urls.push(new URL(String(input))); return page(summary); } });
    await client.listCandidates({ chainId: 56, isActive: "any" });
    await client.listCandidates({ chainId: 56 });
    expect(urls[0]!.searchParams.get("is_active")).toBe("any");
    expect(urls[1]!.searchParams.has("is_active")).toBe(false);
    await expect(client.listCandidates({ isActive: "all" as "any" })).rejects.toMatchObject({ code: "SCAN_CONFIG_INVALID" });
    expect(urls).toHaveLength(2);
  });

  it("does not invent service versions or capability schemas from incomplete summaries", () => {
    const mapped = mapOfficialEightHundredFourScanCandidate({
      ...summary,
      services: { a2a: { url: "https://agent.example/a2a" } },
      capabilities: [{ id: "yield", description: "Optimize yield" }]
    });
    expect(mapped.services).toBeUndefined();
    expect(mapped.capabilityManifest).toBeUndefined();
  });

  it("uses offset pagination, server-only credential header, bounded pages, and retries 429", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls += 1;
      expect(String(input)).toContain("/api/v1/agents?limit=1&offset=0&chain_id=97");
      expect((init?.headers as Record<string, string>)[officialEightHundredFourScanContract.authenticationHeader]).toBe("server-runtime-reference");
      if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "1" } });
      return page(summary);
    });
    const client = new EightHundredFourScanHttpClient({
      baseUrl: "https://scan.example/api/v1",
      apiKey: "server-runtime-reference",
      fetch: fetcher,
      minRequestIntervalMs: 0,
      maxRetries: 1,
      maxBackoffMs: 100,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); }
    });
    const response = await client.listCandidates({ chainId: 97, limit: 1 });
    expect(response.items).toHaveLength(1);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([100]);
  });

  it("uses the reviewed latest route with the same root page envelope", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toContain("/api/v1/agents/latest?limit=1&offset=0&is_registered=true&chain_id=97&is_testnet=true");
      expect((init?.headers as Record<string, string>)[officialEightHundredFourScanContract.authenticationHeader]).toBe("server-runtime-reference");
      return page(summary);
    });
    const client = new EightHundredFourScanHttpClient({
      baseUrl: "https://scan.example/api/v1",
      apiKey: "server-runtime-reference",
      fetch: fetcher,
      minRequestIntervalMs: 0
    });
    const response = await client.listLatestCandidates({ chainId: 97, isTestnet: true, limit: 1 });
    expect(response.route).toBe("agents/latest");
    expect(response.items).toHaveLength(1);
  });

  it("falls back from a retriable primary list failure and reuses the strict mapper", async () => {
    const client = {
      listCandidates: vi.fn(async () => {
        throw ingestionError("SCAN_UNAVAILABLE", "The 8004scan service could not be reached.", "retry_scan", undefined, true);
      }),
      listLatestCandidates: vi.fn(async () => ({ items: [summary], nextCursor: null, nextOffset: null, total: 1 }))
    };
    const adapter = createEightHundredFourScanAdapter(client);
    const response = await adapter.fetchPage({ chainId: 97, limit: 1 });
    expect(client.listCandidates).toHaveBeenCalledTimes(1);
    expect(client.listLatestCandidates).toHaveBeenCalledTimes(1);
    expect(response.candidates[0]?.identity).toEqual({
      namespace: "eip155",
      chainId: 97,
      identityRegistry: address,
      agentId: "900719925474099312345"
    });
    expect(response.candidates[0]?.sourceReference).toContain("route=agents/latest");
  });

  it("keeps route circuits independent so a failing list route cannot block latest", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/agents/latest")) return page(summary);
      return new Response("upstream unavailable", { status: 503 });
    });
    const client = new EightHundredFourScanHttpClient({
      baseUrl: "https://scan.example/api/v1",
      fetch: fetcher,
      minRequestIntervalMs: 0,
      maxRetries: 0,
      circuitFailureThreshold: 1
    });
    await expect(client.listCandidates({ chainId: 97, limit: 1 })).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE" });
    await expect(client.listLatestCandidates({ chainId: 97, limit: 1 })).resolves.toMatchObject({ route: "agents/latest" });
  });

  it("retries a bounded 5xx response and stops on contract drift", async () => {
    let serverFailures = 0;
    const retryingFetcher = vi.fn<typeof fetch>(async () => {
      if (serverFailures === 0) {
        serverFailures += 1;
        return new Response("upstream unavailable", { status: 503 });
      }
      return page(summary);
    });
    const client = new EightHundredFourScanHttpClient({
      baseUrl: "https://scan.example/api/v1",
      fetch: retryingFetcher,
      minRequestIntervalMs: 0,
      maxRetries: 1,
      sleep: async () => undefined
    });
    await expect(client.listCandidates({ chainId: 97, limit: 1 })).resolves.toMatchObject({ total: 1 });
    expect(retryingFetcher).toHaveBeenCalledTimes(2);

    const driftFetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const driftClient = new EightHundredFourScanHttpClient({
      baseUrl: "https://scan.example/api/v1",
      fetch: driftFetcher,
      minRequestIntervalMs: 0,
      maxRetries: 3,
      sleep: async () => undefined
    });
    await expect(driftClient.listCandidates({ chainId: 97, limit: 1 })).rejects.toMatchObject({ code: "SCAN_CONTRACT_INVALID" });
    expect(driftFetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed identity and OpenAPI drift", () => {
    expect(() => mapOfficialEightHundredFourScanCandidate({ ...summary, agent_id: "not-a-tuple" })).toThrow(/tuple/i);
    expect(() => verifyEightHundredFourScanOpenApi({ openapi: "3.1.0", info: { version: "old" } })).toThrow(/pin|contract/i);
  });
});
