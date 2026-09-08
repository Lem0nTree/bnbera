import { describe, expect, it } from "vitest";
import { createCreatorLifecycleHandoffs, type CreatorIdentityBinding } from "./creator-handoffs";

const binding: CreatorIdentityBinding = { namespace: "eip155", chainId: 97, identityRegistry: "0xregistry", agentId: "41", agentVersionId: "version-41", endpoint: "https://agent.example", ownerAddress: "0xadmin", agentWallet: "0xsession" };
function poolWithRows<TRow extends Record<string, unknown>>(rows: readonly TRow[]) {
  return { async query<T = Record<string, unknown>>(_sql: string, _values?: readonly unknown[]): Promise<{ rows: readonly T[] }> { return { rows: rows as unknown as readonly T[] }; } };
}

describe("Creator G1/G2 reconciliation handoffs", () => {
  it("withholds registration until finalized owner and independent execution wallet both match", async () => {
    const handoffs = createCreatorLifecycleHandoffs(poolWithRows([{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xother", url: "https://agent.example" }]), async () => binding);
    const outcome = await handoffs.registerAndVerify({ deploymentId: "deployment-1", endpoint: "https://agent.example" });
    expect(outcome.status).toBe("pending");
    expect(outcome.operationId).toContain("browser-signature-required");
  });

  it("confirms only a finalized identity with intended owner and agent wallet", async () => {
    const handoffs = createCreatorLifecycleHandoffs(poolWithRows([{ owner_address: "0xadmin", admin_wallet: "0xadmin", agent_wallet: "0xsession", url: "https://agent.example" }]), async () => binding);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-2", endpoint: "https://agent.example" })).resolves.toMatchObject({ status: "confirmed" });
  });

  it("does not query a same-wallet newer identity when its exact tuple is absent", async () => {
    let queried = false;
    const handoffs = createCreatorLifecycleHandoffs({ async query() { queried = true; return { rows: [] }; } }, async () => null);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-3", endpoint: "https://agent.example" })).resolves.toMatchObject({ status: "pending" });
    expect(queried).toBe(false);
  });

  it("denies a provisional identity even when every requested tuple field matches", async () => {
    let statement = "";
    const handoffs = createCreatorLifecycleHandoffs({ async query(sql) { statement = sql; return { rows: [] }; } }, async () => binding);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-provisional", endpoint: binding.endpoint })).resolves.toMatchObject({ status: "pending" });
    expect(statement).toContain("i.read_consistency='finalized'");
  });

  it("denies an identity whose finalized agent wallet differs from the authority execution wallet", async () => {
    let statement = "";
    const handoffs = createCreatorLifecycleHandoffs({ async query(sql) { statement = sql; return { rows: [] }; } }, async () => binding);
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-wallet-mismatch", endpoint: binding.endpoint })).resolves.toMatchObject({ status: "pending" });
    expect(statement).toContain("lower(i.agent_wallet)=lower(au.execution_wallet)");
  });
});
