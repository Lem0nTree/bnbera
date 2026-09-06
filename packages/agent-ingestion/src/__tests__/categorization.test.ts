import { describe, expect, it, vi } from "vitest";
import { categoryClassifierVersion, classifyAgent, PgCategoryPredictionSink } from "../index.js";

describe("deterministic category assignment", () => {
  it("uses A2A card and MCP capability evidence without relying on prose alone", () => {
    expect(classifyAgent({
      agentCard: {
        skills: [{ id: "portfolio-rebalancing", description: "Rebalance portfolio allocations" }]
      }
    }).category).toBe("rebalancing");

    expect(classifyAgent({
      mcpCapabilities: {
        tools: [{ name: "liquidation-monitor", description: "Monitor collateral liquidation risk" }]
      }
    }).category).toBe("health-factor");
  });

  it("uses normalized advertised A2A skill tags and keywords for category evidence", () => {
    const cases = [
      {
        category: "grid-trading",
        advertisedSkills: [{ id: "range-strategy", name: "Range strategy", description: "Automated strategy", tags: ["grid-trading"] }]
      },
      {
        category: "yield-optimisation",
        advertisedSkills: [{ id: "vault", name: "Vault", description: "Automated strategy", keywords: ["yield"] }]
      },
      {
        category: "rebalancing",
        advertisedSkills: [{ id: "portfolio", name: "Portfolio", description: "Automated strategy", keywords: ["portfolio rebalance"] }]
      }
    ] as const;

    for (const input of cases) {
      const result = classifyAgent({ advertisedSkills: input.advertisedSkills });
      expect(result.category).toBe(input.category);
      expect(result.evidence).toMatchObject({
        structuredMatches: expect.arrayContaining([expect.stringContaining("advertisedSkill:")])
      });
    }
  });

  it("retains secondary category matches as evidence alongside the primary label", () => {
    const result = classifyAgent({
      advertisedSkills: [{ id: "grid-yield", name: "Grid yield", description: "Public strategy labels", tags: ["grid-trading", "yield"] }]
    });
    expect(result.category).toBe("grid-trading");
    expect(result.evidence.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "grid-trading", structuredScore: expect.any(Number) }),
      expect.objectContaining({ category: "yield-optimisation", structuredScore: expect.any(Number) })
    ]));
  });

  it("keeps ambiguous labels uncategorized and rejects unsafe advertised metadata", () => {
    expect(classifyAgent({
      advertisedSkills: [{ id: "generic", name: "Generic", description: "A general agent", tags: ["trading", "strategy"] }]
    }).category).toBe("uncategorized");

    expect(classifyAgent({
      advertisedSkills: [{ id: "maker", name: "Maker", description: "A general agent", tags: ["maker"] }]
    }).category).toBe("uncategorized");
    expect(classifyAgent({
      advertisedSkills: [{ id: "vault", name: "Vault", description: "A general agent", keywords: ["vault"] }]
    }).category).toBe("uncategorized");
    expect(classifyAgent({
      advertisedSkills: [{ id: "maker", name: "Maker", description: "Places market making range orders", tags: ["maker"] }]
    }).category).toBe("grid-trading");

    expect(() => classifyAgent({
      advertisedSkills: [{ id: "untrusted", name: "Untrusted", description: "A general agent", tags: [{ apiKey: "must-not-be-consumed" }] }]
    })).toThrow(/credential|metadata|public/i);
  });

  it("rejects credential-bearing capability metadata before classification", () => {
    expect(() => classifyAgent({
      mcpCapabilities: { apiKey: "must-not-be-consumed", tools: [{ name: "yield", description: "yield" }] }
    })).toThrow(/credential|metadata|public/i);
  });

  it("derives a stable evidence digest for PostgreSQL replay idempotency", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({ rows: [], rowCount: 1 }));
    const sink = new PgCategoryPredictionSink(
      { query: query as never },
      async () => "11111111-1111-4111-8111-111111111111",
      () => new Date("2026-09-04T00:00:00.000Z")
    );
    const classification = classifyAgent({ protocols: ["yield"], capabilities: { capabilities: [{ id: "yield", description: "yield" }] } });
    await sink.save({ identityKey: "eip155:97:0x1111111111111111111111111111111111111111:1", classification });
    await sink.save({ identityKey: "eip155:97:0x1111111111111111111111111111111111111111:1", classification });
    const firstParams = query.mock.calls[0]?.[1] as unknown[] | undefined;
    const secondParams = query.mock.calls[1]?.[1] as unknown[] | undefined;
    expect(classification.classifierVersion).toBe(categoryClassifierVersion);
    expect(categoryClassifierVersion).toBe("deterministic-rules-v2");
    expect(String(query.mock.calls[0]?.[0])).toMatch(/existing\.classifier_version = \$9/iu);
    expect(firstParams).toBeDefined();
    expect(secondParams).toBeDefined();
    if (firstParams === undefined || secondParams === undefined) return;
    expect((firstParams[6] as { digest: string }).digest).toBe(firstParams[11]);
    expect(secondParams[11]).toBe(firstParams[11]);
    expect(firstParams[8]).toBe("deterministic-rules-v2");
    expect(secondParams[8]).toBe(firstParams[8]);
  });
});
