import { describe, expect, it } from "vitest";
import { buildAgentProfileArtifact, buildRunBundleArtifact } from "../src/index.js";

const identity = {
  id: "11111111-1111-4111-8111-111111111111",
  namespace: "eip155",
  chain_id: 97,
  identity_registry: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  agent_id: "7"
} as const;

const agent = {
  id: "22222222-2222-4222-8222-222222222222",
  identity_id: identity.id,
  category: "rebalancing",
  execution_wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
} as const;

const version = {
  id: "33333333-3333-4333-8333-333333333333",
  agent_id: agent.id,
  version: 3,
  created_at: "2026-09-08T10:00:00Z",
  public_metadata: { name: "Persisted agent", description: "Frozen profile", supported_protocols: ["a2a"] },
  capability_manifest: { secretReference: "must-not-leak", capabilities: ["swap"] },
  pricing_manifest: { currency: "BNB", amount_atomic: "42" }
} as const;

describe("immutable Greenfield artifact builders", () => {
  it("builds a profile from persisted rows and excludes capability/secret fields", () => {
    const artifact = buildAgentProfileArtifact({
      environment: "hackathon",
      identityRow: identity,
      agentRow: agent,
      versionRow: version,
      serviceRows: [
        {
          kind: "a2a",
          url: "https://agent.example/a2a",
          protocol_version: "1",
          discovery_source: "8004scan",
          validation_status: "healthy",
          observed_at: "2026-09-08T10:00:00Z"
        }
      ],
      capabilityRow: { manifest_digest: "a".repeat(64), capability_manifest: { secretReference: "hidden" } },
      authorityRow: {
        execution_wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        session_public_address: null,
        expires_at: "2026-09-09T10:00:00Z",
        status: "active",
        secret_reference: "secret-manager://not-public",
        calls_allowlist: { swap: { target: "0xcccccccccccccccccccccccccccccccccccccccc" } },
        spend_limits: { day: "42" }
      }
    });

    expect(artifact.payload.name).toBe("Persisted agent");
    expect(artifact.payload.capabilityManifestHash).toBe("a".repeat(64));
    expect(artifact.payload.pricing).toEqual({ currency: "BNB", amountAtomic: "42" });
    expect(artifact).not.toHaveProperty("capability_manifest");
    expect(JSON.stringify(artifact)).not.toContain("secret-manager://");
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.payload)).toBe(true);
  });

  it("builds a run bundle using only whitelisted public projections", () => {
    const artifact = buildRunBundleArtifact({
      environment: "hackathon",
      run: {
        id: "44444444-4444-4444-8444-444444444444",
        agent_id: agent.id,
        job_id: "55555555-5555-4555-8555-555555555555",
        identity_namespace: "eip155",
        identity_chain_id: 97,
        identity_registry: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        identity_agent_id: "7",
        agent_version: "3",
        content_sha256: "e".repeat(64),
        content_keccak256: "f".repeat(64),
        started_at: "2026-09-08T10:00:00Z",
        finished_at: "2026-09-08T10:01:00Z",
        outcome: "completed",
        selected_action: { action_class: "rebalance", protocol: "a2a", summary: "public action", privateKey: "hidden" },
        decision_summary: {
          simulation_output: { status: "passed", summary: "simulated" },
          risk_validations: { status: "passed" },
          policy_validation: { status: "passed" }
        },
        before_state: { status: "before", state_digest: "b".repeat(64) },
        after_state: { status: "after", state_digest: "c".repeat(64) },
        transaction_hash: `0x${"d".repeat(64)}`
      },
      agentRow: agent,
      identityRow: identity,
      versionRow: version,
      settledResult: {
        state: "settled",
        commerce_job_id: "55555555-5555-4555-8555-555555555555",
        agent_version_id: version.id,
        agent_version: 3,
        namespace: "eip155",
        chain_id: 97,
        identity_registry: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        agent_id: "7",
        result_sha256: "e".repeat(64),
        result_keccak: "f".repeat(64),
        settlement_transaction_hash: `0x${"a".repeat(64)}`
      },
      dataSourceRows: [
        {
          provider: "8004scan",
          observation_type: "card",
          source_timestamp: "2026-09-08T10:00:00Z",
          payload_digest: "e".repeat(64),
          freshness: "fresh"
        }
      ],
      candidateActions: [{ action_class: "rebalance", protocol: "a2a" }]
    });

    expect(artifact.payload.finalStatus).toBe("confirmed");
    expect(artifact.payload.selectedAction).toEqual({ actionClass: "rebalance", protocol: "a2a", summary: "public action" });
    expect(artifact.payload.beforeState).toEqual({ status: "before", stateDigest: "b".repeat(64) });
    expect(JSON.stringify(artifact)).not.toContain("privateKey");
    expect(artifact.payload.dataSources[0]?.version).toBe("card");
  });

  it("rejects incomplete persisted profile rows instead of inventing public values", () => {
    expect(() =>
      buildAgentProfileArtifact({
        environment: "hackathon",
        identityRow: identity,
        versionRow: { version: 1, created_at: "2026-09-08T10:00:00Z", public_metadata: { name: "missing description" } }
      })
    ).toThrow();
  });
});
