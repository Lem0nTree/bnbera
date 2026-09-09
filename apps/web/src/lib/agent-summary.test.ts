import { afterEach, describe, expect, it, vi } from "vitest";
import { agentExplorerUrl, heartbeatLabel, verifiedRating } from "./agent-summary";
import { readMarketplace } from "./marketplace-contract";

afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  vi.stubEnv("MARKETPLACE_DATA_MODE", "fixture");
  return (await readMarketplace()).agents[0]!;
}
describe("agent decision summaries", () => {
  it("does not convert permissionless feedback or generic scores into stars", async () => {
    const agent = await fixture();
    expect(verifiedRating(agent).average).toBeNull();
    expect(verifiedRating({ ...agent, metrics: { ...agent.metrics, reviews: { ...agent.metrics.reviews, averageScore: 100, count: 100 } } }).average).toBeNull();
  });
  it("does not claim live heartbeat or chain evidence for fixtures", async () => {
    const agent = await fixture();
    expect(heartbeatLabel(agent)).toBe("Preview");
    expect(agentExplorerUrl(agent)).toBeNull();
  });
  it("expires healthy heartbeat and uses only supported explorer origins", async () => {
    const original = await fixture();
    const agent = { ...original, dataProvenance: { ...original.dataProvenance, mode: "live" as const }, health: { ...original.health, endpointStatus: "healthy" as const, observedAt: "2026-09-09T00:00:00Z" } };
    expect(heartbeatLabel(agent, Date.parse("2026-09-09T00:01:00Z"))).toBe("Online");
    expect(heartbeatLabel(agent, Date.parse("2026-09-09T00:03:00Z"))).toBe("Not recently checked");
    expect(agentExplorerUrl(agent)).toBe(`https://testnet.bscscan.com/address/${agent.identity.identityRegistry}`);
    expect(agentExplorerUrl({ ...agent, identity: { ...agent.identity, chainId: 1 } })).toBeNull();
    expect(heartbeatLabel({ ...agent, dataProvenance: { ...agent.dataProvenance, mode: "degraded" } })).toBe("Degraded");
  });
});
