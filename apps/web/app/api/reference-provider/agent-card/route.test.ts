import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

describe("reference provider Agent Card", () => {
  it("is both an ERC-8004 registration document and a valid A2A card", async () => {
    const response = await GET(new Request("https://provider.example/api/reference-provider/agent-card"));
    expect(response.status).toBe(200);
    const card = await response.json() as Record<string, unknown>;
    expect(card).toMatchObject({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      protocolVersion: "0.3.0",
      supportedProtocols: ["A2A/0.3"],
      services: [{ kind: "a2a", endpoint: "https://provider.example/api/reference-provider/agent-card", version: "0.3.0" }],
      capabilityManifest: { schemaVersion: "bnbera.reference.health-factor.capability/v1" }
    });
    expect(card.skills).toEqual([expect.objectContaining({ id: "health_factor_monitor" })]);
    expect(card).toMatchObject({url:"https://provider.example/api/reference-provider/agent-card",preferredTransport:"JSONRPC",defaultInputModes:["application/json"],defaultOutputModes:["application/json"]});
  });
  it("implements a real bounded A2A message/send and rejects unsupported methods",async()=>{
    const data={schemaVersion:"bnbera.reference.health-factor.request/v1",jobKey:{chainId:97,commerceContract:"0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",jobId:"7"},
      providerBinding:{identity:{namespace:"eip155",chainId:97,identityRegistry:"0x1111111111111111111111111111111111111111",agentId:"42"},agentVersionId:"00000000-0000-4000-8000-000000000042",agentVersion:1},
      account:"0x3333333333333333333333333333333333333333",protocol:"caller-attested lending snapshot",requestedAtUnix:2000001,
      lendingSnapshot:{collateralValueUsd:"2000",debtValueUsd:"1000",liquidationThresholdBps:8000,sourceKind:"caller_attested",sourceReference:"test-input",observedAtUnix:2000000}};
    const envelope={jsonrpc:"2.0",id:"read-only-calculation",method:"message/send",params:{message:{role:"user",messageId:"test",parts:[{kind:"data",data}]}}};
    const response=await POST(new Request("https://provider.example/api/reference-provider/agent-card",{method:"POST",body:JSON.stringify(envelope)}));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({jsonrpc:"2.0",id:envelope.id,result:{kind:"message",role:"agent",parts:[{kind:"data",data:{fixture:false,healthFactorExact:"1.6"}}]}});
    const invalid=await POST(new Request("https://provider.example/api/reference-provider/agent-card",{method:"POST",body:JSON.stringify({...envelope,method:"tasks/cancel"})}));
    expect(invalid.status).toBe(400);
  });
});
