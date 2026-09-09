import { describe, expect, it } from "vitest";
import { mainnetSellerProfiles, mainnetSellerProfile, mainnetSellerTask } from "./mainnet-seller-catalog";
describe("reviewed mainnet task contracts", () => {
  it("has ten independent wallets, eight useful-history tiers and full identity matching", () => {
    expect(mainnetSellerProfiles).toHaveLength(10);
    expect(new Set(mainnetSellerProfiles.map(row => row.wallet.toLowerCase())).size).toBe(10);
    expect(mainnetSellerProfiles.filter(row => row.historicalJobId)).toHaveLength(8);
    expect(mainnetSellerProfiles.find(row => row.agentId === "269228")?.historicalJobId).toBe("56734");
    expect(mainnetSellerProfile({ namespace: "eip155", chainId: 97, identityRegistry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: "269228" })).toBeUndefined();
  });
  it("accepts the published examples and refuses missing calculator inputs", () => {
    for (const profile of mainnetSellerProfiles) {
      expect(mainnetSellerTask(profile, profile.exampleTask).task).toBe(profile.exampleTask);
      if (profile.inputKind !== "text") expect(() => mainnetSellerTask(profile, profile.exampleTask.startsWith("GRID") ? "GRID_PLAN_V1:{}" : profile.exampleTask.startsWith("LOAN") ? "LOAN_HEALTH_V1:{}" : "{}")).toThrow();
    }
  });
  it("does not require optional grid knobs and rejects malformed nested health inputs", () => {
    const grid = mainnetSellerProfiles.find(row => row.agentId === "269224")!;
    expect(() => mainnetSellerTask(grid, '{"price":750,"budgetUsd":1000}')).not.toThrow();
    expect(() => mainnetSellerTask(grid, '{"price":750,"budgetUsd":1000,"levels":2.5}')).toThrow();
    const health = mainnetSellerProfiles.find(row => row.agentId === "269228")!;
    expect(() => mainnetSellerTask(health, '{"collateral":{"BNB":10},"debt":{"USDT":100},"prices":{"BNB":600,"USDT":1}}')).toThrow();
  });
});
