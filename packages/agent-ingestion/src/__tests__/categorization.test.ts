import { describe, expect, it, vi } from "vitest";
import { classifyAgent, PgCategoryPredictionSink } from "../index.js";

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
    expect(firstParams).toBeDefined();
    expect(secondParams).toBeDefined();
    if (firstParams === undefined || secondParams === undefined) return;
    expect((firstParams[6] as { digest: string }).digest).toBe(firstParams[11]);
    expect(secondParams[11]).toBe(firstParams[11]);
  });
});
