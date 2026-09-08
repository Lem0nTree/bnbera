import { describe, expect, it } from "vitest";
import { createCreatorLifecycleHandoffs } from "./creator-handoffs";

describe("Creator G1/G2 reconciliation handoffs", () => {
  it("withholds registration until finalized owner and independent execution wallet both match", async () => {
    const handoffs = createCreatorLifecycleHandoffs({ async query() { return { rows: [{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xother", execution_wallet: "0xsession", read_consistency: "finalized" }] }; } });
    const outcome = await handoffs.registerAndVerify({ deploymentId: "deployment-1", endpoint: "https://agent.example" });
    expect(outcome.status).toBe("pending");
    expect(outcome.operationId).toContain("browser-signature-required");
  });

  it("confirms only a finalized identity with intended owner and agent wallet", async () => {
    const handoffs = createCreatorLifecycleHandoffs({ async query() { return { rows: [{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xsession", execution_wallet: "0xsession", read_consistency: "finalized" }] }; } });
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-2", endpoint: "https://agent.example" })).resolves.toMatchObject({ status: "confirmed" });
  });
});
