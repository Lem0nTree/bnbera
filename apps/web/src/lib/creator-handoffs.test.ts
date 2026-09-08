import { describe, expect, it } from "vitest";
import { createCreatorLifecycleHandoffs, type CreatorIdentityBinding } from "./creator-handoffs";
import { canonicalRuntimeConfigurationDigest, creatorPaidJobDescription } from "./creator-contract";

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

  it("reads the browser binding from the quoted deployment-event timestamp", async () => {
    let statement = "";
    const handoffs = createCreatorLifecycleHandoffs({ async query(sql) { statement = sql; return { rows: [] }; } });
    await expect(handoffs.registerAndVerify({ deploymentId: "deployment-created-at", endpoint: binding.endpoint })).resolves.toMatchObject({ status: "pending" });
    expect(statement).toContain('ORDER BY "createdAt" DESC');
    expect(statement).not.toContain("ORDER BY created_at");
  });

  it("confirms only a funded job bound to the selected runtime pair and digest", async () => {
    let statement = "";
    let values: readonly unknown[] = [];
    const pool = { async query<T = Record<string, unknown>>(sql: string, input?: readonly unknown[]): Promise<{ rows: readonly T[] }> {
      statement = sql;
      values = input ?? [];
      return { rows: [{ id: "commerce-job-busd" }] as unknown as readonly T[] };
    } };
    const configuration = { protocol: "pancakeswap-v2", tradingPair: "tbnb-busd", inputAmountWei: "500000000000000", slippageBps: 25, quoteMaxAgeSeconds: 30, deadlineSeconds: 60 } as const;
    const digest = canonicalRuntimeConfigurationDigest(configuration);
    const outcome = await createCreatorLifecycleHandoffs(pool, async () => binding).verifyFundedJob({
      deploymentId: "deployment-pair-bound",
      endpoint: binding.endpoint,
      configuration,
      configurationDigest: digest,
    });
    expect(outcome).toEqual({ status: "confirmed", operationId: "creator:g2-funded:commerce-job-busd" });
    expect(statement).toContain("j.provider_agent_id=a.id");
    expect(statement).toContain("j.quote->>'task'=$7");
    expect(statement).toContain("j.task_input_digest");
    expect(values.slice(-2)).toEqual([creatorPaidJobDescription(configuration, digest), expect.any(String)]);
  });

  it("does not query when the deployment digest does not match its selected configuration", async () => {
    let queried = false;
    const handoffs = createCreatorLifecycleHandoffs({ async query() { queried = true; return { rows: [] }; } }, async () => binding);
    const configuration = { protocol: "pancakeswap-v2", tradingPair: "tbnb-busd", inputAmountWei: "500000000000000", slippageBps: 25, quoteMaxAgeSeconds: 30, deadlineSeconds: 60 } as const;
    await expect(handoffs.verifyFundedJob({ deploymentId: "deployment-bad-digest", endpoint: binding.endpoint, configuration, configurationDigest: "0".repeat(64) })).resolves.toMatchObject({ status: "pending", operationId: expect.stringContaining("g2-config-digest-mismatch") });
    expect(queried).toBe(false);
  });
});
