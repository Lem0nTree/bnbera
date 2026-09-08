import { describe, expect, it } from "vitest";
import { createCreatorLifecycleHandoffs, type CreatorIdentityBinding } from "./creator-handoffs";

const binding: CreatorIdentityBinding = { namespace: "eip155", chainId: 97, identityRegistry: "0xregistry", agentId: "41", agentVersionId: "version-41", endpoint: "https://agent.example", ownerAddress: "0xadmin", agentWallet: "0xsession" };

describe("Creator G1/G2 reconciliation handoffs", () => {
  it("withholds registration until finalized owner and independent execution wallet both match", async () => {
    const handoffs = createCreatorLifecycleHandoffs({ async query() { return { rows: [{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xother", url: "https://agent.example" }] }; } }, async () => binding);
    const outcome = await handoffs.registerAndVerify({ deploymentId: "deployment-1", endpoint: "https://agent.example" });
    expect(outcome.status).toBe("pending");
    expect(outcome.operationId).toContain("browser-signature-required");
  });

  it("confirms only a finalized identity with intended owner and agent wallet", async () => {
    const handoffs = createCreatorLifecycleHandoffs({ async query() { return { rows: [{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xsession", url: "https://agent.example" }] }; } }, async () => binding);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-2", endpoint: "https://agent.example" })).resolves.toMatchObject({ status: "confirmed" });
  });

  it("does not query a same-wallet newer identity when its exact tuple is absent", async () => {
    let queried = false;
    const handoffs = createCreatorLifecycleHandoffs({ async query() { queried = true; return { rows: [] }; } }, async () => null);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-3", endpoint: "https://agent.example" })).resolves.toMatchObject({ status: "pending" });
    expect(queried).toBe(false);
  });
});
