import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("reference provider Agent Card", () => {
  it("is both an ERC-8004 registration document and a valid A2A card", async () => {
    const response = await GET(new Request("https://provider.example/api/reference-provider/agent-card"));
    expect(response.status).toBe(200);
    const card = await response.json() as Record<string, unknown>;
    expect(card).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      protocolVersion: "0.3",
      supportedProtocols: ["A2A/0.3"],
      services: [{ kind: "a2a", endpoint: "https://provider.example/api/reference-provider/agent-card", version: "0.3.0" }],
      capabilityManifest: { schemaVersion: "bnbera.reference.health-factor.capability/v1" }
    });
    expect(card.skills).toEqual([expect.objectContaining({ id: "health_factor_monitor" })]);
    expect(card.supportedInterfaces).toEqual([expect.objectContaining({ url: "https://provider.example/api/reference-provider/health-factor" })]);
  });
});
