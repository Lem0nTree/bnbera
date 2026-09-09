import { describe, expect, it } from "vitest";
import { sortAgents, type MarketplaceAgentReadModel } from "./marketplace-contract";
describe("actionable marketplace discovery", () => {
  const available = { id: "available", name: "Reviewed seller", activation: { enabled: true }, directory: { scores: { overall: 1 } }, eligibility: { score: null } } as MarketplaceAgentReadModel;
  const directoryOnly = { id: "directory", name: "Directory profile", activation: { enabled: false }, directory: { scores: { overall: 99 } }, eligibility: { score: null } } as MarketplaceAgentReadModel;
  it("surfaces currently actionable sellers in relevance without falsifying vendor score sorting", () => {
    expect(sortAgents([directoryOnly, available], { sort: "relevance" } as never).map(row => row.id)).toEqual(["available", "directory"]);
    expect(sortAgents([directoryOnly, available], { sort: "score" } as never).map(row => row.id)).toEqual(["directory", "available"]);
  });
});
