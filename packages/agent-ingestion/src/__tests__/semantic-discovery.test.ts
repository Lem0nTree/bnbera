import { describe, expect, it, vi } from "vitest";
import {
  Erc8004SemanticCandidateCollector,
  erc8004SemanticDiscoveryCategories,
  type EightHundredFourScanAdapter,
  type IdentityCandidate
} from "../index.js";

function candidate(agentId: string, reference = `agent:${agentId}`): IdentityCandidate {
  return {
    identity: {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0x2222222222222222222222222222222222222222",
      agentId
    },
    source: "8004scan",
    sourceReference: reference,
    observedAt: new Date("2026-09-05T00:00:00.000Z"),
    normalizedIngestionVersion: "semantic-test-v1"
  };
}

describe("four-category 8004scan semantic discovery", () => {
  it("queries all four terms and deduplicates by the complete identity tuple", async () => {
    const fetchSemanticPage = vi.fn(async ({ query }: { readonly query: string }) => ({
      candidates: [candidate(query === "liquidity" ? "1" : query === "yield" ? "2" : "1")],
      nextCursor: null,
      nextOffset: null,
      total: 1
    }));
    const collector = new Erc8004SemanticCandidateCollector({
      adapter: { fetchSemanticPage } as unknown as EightHundredFourScanAdapter,
      maxCandidatesPerCategory: 2,
      maxCandidates: 20,
      now: () => new Date("2026-09-05T00:00:00.000Z")
    });
    const result = await collector.collect({ chainId: 97, isTestnet: true });
    expect(fetchSemanticPage).toHaveBeenCalledTimes(4);
    expect(fetchSemanticPage.mock.calls.map(([query]) => query.query)).toEqual([...erc8004SemanticDiscoveryCategories]);
    expect(result.status).toBe("completed");
    expect(result.candidates.map((item) => item.identity.agentId)).toEqual(["1", "2"]);
    expect(result.candidates[0]?.sourceReference).toContain("category=trading");
    expect(result.categories.every((item) => item.status === "completed")).toBe(true);
  });

  it("isolates provider failures and emits only stable diagnostics", async () => {
    const fetchSemanticPage = vi.fn(async ({ query }: { readonly query: string }) => {
      if (query === "liquidity") throw new Error("provider secret=must-not-escape");
      const ids: Record<string, string> = { trading: "1", yield: "3", "health-factor": "4" };
      return { candidates: [candidate(ids[query] ?? "9")], nextCursor: null, nextOffset: null, total: 1 };
    });
    const collector = new Erc8004SemanticCandidateCollector({
      adapter: { fetchSemanticPage } as unknown as EightHundredFourScanAdapter,
      maxCandidatesPerCategory: 1,
      maxCandidates: 20
    });
    const result = await collector.collect({ chainId: 97 });
    expect(result.status).toBe("degraded");
    expect(result.diagnostics).toEqual(["SEMANTIC_DISCOVERY_FAILED"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.categories.find((item) => item.category === "liquidity")).toMatchObject({ status: "failed", diagnostic: "SEMANTIC_DISCOVERY_FAILED" });
    expect(result.candidates).toHaveLength(3);
  });

  it("enforces the global candidate bound while still recording each category attempt", async () => {
    const fetchSemanticPage = vi.fn(async ({ query }: { readonly query: string }) => ({
      candidates: [candidate(({ trading: "1", liquidity: "2", yield: "3", "health-factor": "4" })[query] ?? "9")],
      nextCursor: null,
      nextOffset: null,
      total: 1
    }));
    const collector = new Erc8004SemanticCandidateCollector({
      adapter: { fetchSemanticPage } as unknown as EightHundredFourScanAdapter,
      maxCandidatesPerCategory: 2,
      maxCandidates: 2
    });
    const result = await collector.collect();
    expect(result.candidates).toHaveLength(2);
    expect(result.categories).toHaveLength(4);
    expect(fetchSemanticPage).toHaveBeenCalledTimes(4);
  });
});
