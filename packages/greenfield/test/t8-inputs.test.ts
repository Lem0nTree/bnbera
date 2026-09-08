import { describe, expect, it } from "vitest";
import {
  T8GreenfieldInputError,
  buildT8FrozenArtifacts,
  buildT8FrozenInputs,
  projectT8SettledCommerceJob,
  type T8QueryExecutor,
  type T8SettledCommerceFacts
} from "../src/index.js";

const ids = {
  identity: "11111111-1111-4111-8111-111111111111",
  agent: "22222222-2222-4222-8222-222222222222",
  version: "33333333-3333-4333-8333-333333333333",
  commerceJob: "44444444-4444-4444-8444-444444444444",
  protocolJobRecord: "55555555-5555-4555-8555-555555555555",
  result: "66666666-6666-4666-8666-666666666666"
} as const;

const tx = (letter: string): string => `0x${letter.repeat(64)}`;
const digest = (letter: string): string => letter.repeat(64);
const registry = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const buyer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const provider = "0xcccccccccccccccccccccccccccccccccccccccc";
const binding = {
  identity: { namespace: "eip155", chainId: 97, identityRegistry: registry, agentId: "7" },
  agentVersionId: ids.version,
  agentVersion: 3
} as const;

function facts(overrides: Record<string, unknown> = {}): T8SettledCommerceFacts {
  return {
    row: {
      commerce_job_id: ids.commerceJob,
      commerce_parent_protocol_job_id: "19",
      provider_agent_id: ids.agent,
      buyer_user_id: null,
      quote: { amount: "42", currency: "U", network: 97, secretReference: "do-not-export" },
      price_atomic: "42",
      task_input_digest: digest("a"),
      commerce_status: "settled",
      parent_funding_transaction_hash: tx("1"),
      parent_fulfillment_transaction_hash: tx("2"),
      parent_settlement_transaction_hash: tx("4"),
      commerce_created_at: "2026-09-08T10:00:00Z",
      erc8183_job_record_id: ids.protocolJobRecord,
      chain_id: 97,
      commerce_contract: "0xdddddddddddddddddddddddddddddddddddddddd",
      protocol_job_id: "19",
      spec_revision: "erc8183-test",
      payment_token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      payment_decimals: 18,
      client_address: buyer,
      provider_address: provider,
      evaluator_address: "0xffffffffffffffffffffffffffffffffffffffff",
      budget_atomic: "42",
      description_digest: digest("b"),
      expires_at: "2026-09-09T10:00:00Z",
      protocol_state: "completed",
      deliverable_digest: digest("e"),
      protocol_provider_binding: binding,
      protocol_funding_transaction_hash: tx("1"),
      protocol_submission_transaction_hash: tx("2"),
      protocol_completion_transaction_hash: tx("4"),
      protocol_last_observed_block: 123,
      protocol_last_observed_at: "2026-09-08T10:02:00Z",
      agent_id: ids.agent,
      identity_id: ids.identity,
      agent_category: "rebalancing",
      agent_version_id: ids.version,
      agent_version: 3,
      agent_version_created_at: "2026-09-08T09:00:00Z",
      public_metadata: { name: "Persisted agent", description: "A public result agent" },
      capability_manifest: { secretReference: "do-not-export", capabilities: ["rebalance"] },
      pricing_manifest: { currency: "U", amount_atomic: "42", network: 97 },
      identity_namespace: "eip155",
      identity_chain_id: 97,
      identity_registry: registry,
      identity_agent_id: "7",
      result_id: ids.result,
      result_buyer_user_id: null,
      result_buyer_address: buyer,
      result_identity_namespace: "eip155",
      result_identity_chain_id: 97,
      result_identity_registry: registry,
      result_identity_agent_id: "7",
      result_agent_version_id: ids.version,
      result_agent_version: 3,
      result_provider_address: provider,
      result_provider_binding: binding,
      result_sha256: digest("e"),
      result_keccak: tx("f"),
      result_payload: { status: "passed", summary: "rebalance completed", privateKey: "do-not-export" },
      result_submission_transaction_hash: tx("2"),
      result_submission_block_number: "100",
      result_submission_block_hash: tx("a"),
      result_submission_log_index: 1,
      result_submitted_at: "2026-09-08T10:01:00Z",
      result_state: "settled",
      result_settlement_transaction_hash: tx("4"),
      result_settlement_block_number: "101",
      result_settlement_block_hash: tx("b"),
      result_settlement_log_index: 2,
      result_settled_at: "2026-09-08T10:02:00Z",
      ...overrides
    },
    services: [{
      id: "77777777-7777-4777-8777-777777777777",
      kind: "a2a",
      url: "https://agent.example/a2a",
      protocol_version: "1",
      discovery_source: "8004scan",
      validation_status: "healthy",
      observed_at: "2026-09-08T10:02:00Z"
    }]
  } as T8SettledCommerceFacts;
}

describe("T8 persisted canary input/projection", () => {
  it("builds frozen profile/run rows from the exact settled binding and omits secrets/URLs", () => {
    const result = buildT8FrozenArtifacts(facts());
    expect(result.profileArtifact.payload.pricing).toMatchObject({ network: "97" });
    expect(result.runArtifact.payload.finalStatus).toBe("confirmed");
    expect(JSON.stringify(result)).not.toContain("do-not-export");
    expect(JSON.stringify(result)).not.toContain("result_url");
    expect(result.runRows.settledResult).toMatchObject({ commerce_job_id: ids.commerceJob, agent_version_id: ids.version });
    expect(result.runRows.run).toMatchObject({ id: result.runId, agent_id: ids.agent, job_id: ids.commerceJob });
  });

  it.each([
    ["parent", { commerce_status: "funded" }],
    ["protocol", { protocol_state: "submitted" }],
    ["result", { result_state: "submitted" }],
    ["receipt", { result_settlement_transaction_hash: null }],
    ["version", { result_agent_version: 4 }]
  ])("refuses an unsettled/incomplete/mismatched %s fact", (_name, override) => {
    expect(() => buildT8FrozenInputs(facts(override))).toThrow(T8GreenfieldInputError);
  });

  it("inserts one deterministic agent run and returns the same row on replay", async () => {
    const inputs = buildT8FrozenInputs(facts());
    type Stored = Record<string, unknown>;
    let stored: Stored | null = null;
    const query: T8QueryExecutor = {
      query: async <T extends Record<string, unknown> = Record<string, unknown>>(text: string, values: readonly unknown[] = []) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] as readonly T[] };
        if (text.includes("SELECT id, agent_id, job_id") && text.includes("FOR UPDATE")) {
          return { rows: (stored === null ? [] : [stored]) as readonly T[] };
        }
        if (text.includes("INSERT INTO agent_runs")) {
          if (stored === null) {
            stored = {
              id: values[0], agent_id: values[1], job_id: values[2], template_id: null, template_version: null,
              input_snapshot: JSON.parse(String(values[3])), decision_summary: JSON.parse(String(values[4])), selected_action: null,
              before_state: null, after_state: null, transaction_hash: values[5], outcome: values[6], started_at: values[7], finished_at: values[8]
            };
          }
          return { rows: [] as readonly T[] };
        }
        throw new Error(`unexpected query: ${text}`);
      }
    };
    const first = await projectT8SettledCommerceJob(query, inputs);
    const second = await projectT8SettledCommerceJob(query, inputs);
    expect(first).toMatchObject({ created: true, runId: inputs.runId, commerceJobId: ids.commerceJob, agentId: ids.agent });
    expect(second).toMatchObject({ created: false, runId: inputs.runId });
  });
});
