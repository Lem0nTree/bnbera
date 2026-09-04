import { describe, expect, it, vi } from "vitest";
import {
  EightHundredFourScanHttpClient,
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
  it("maps the complete provider identity tuple and keeps owner non-authoritative", () => {
    const mapped = mapOfficialEightHundredFourScanCandidate(summary);
    expect(mapped.identity).toEqual({ namespace: "eip155", chainId: 97, identityRegistry: address, agentId: "900719925474099312345" });
    expect(mapped.sourceReference).toBe(`agent:97:${address}:900719925474099312345`);
    expect(mapped.metadata).not.toHaveProperty("owner_address");
    expect(mapped.services).toEqual([{ kind: "a2a", url: "https://agent.example/a2a", protocolVersion: "1" }]);
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
