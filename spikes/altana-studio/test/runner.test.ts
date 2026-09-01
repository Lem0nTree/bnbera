import assert from "node:assert/strict";
import test from "node:test";
import {
  EphemeralSessionMaterial,
  type RuntimeSessionDescriptor,
  type ScopedPolicy,
} from "../../../packages/altana/src/index.ts";
import { runPhaseZeroSpike, type PhaseZeroDriver } from "../src/runner.ts";

const policy: ScopedPolicy = {
  chainId: 97,
  adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
  calls: [
    {
      target: "0xdddddddddddddddddddddddddddddddddddddddd",
      selectors: ["0xabcdef01"],
      maxNativeValueWei: 0n,
    },
  ],
  spend: [],
  expiresAtUnix: 1_800_000_000,
};

const action = {
  target: "0xdddddddddddddddddddddddddddddddddddddddd" as const,
  selector: "0xabcdef01" as const,
  valueWei: 0n,
};

function descriptorFor(inputPolicy: ScopedPolicy = policy): RuntimeSessionDescriptor {
  return {
    sessionId: "sim-session-1",
    policy: inputPolicy,
    policyDigest: null,
    grantTransactionHash: null,
    secretReference: null,
    grantedAtUnix: 1_700_000_001,
  };
}

function fakeDriver(options: { rejectAfterRevoke?: boolean } = {}): PhaseZeroDriver {
  return {
    async reviewPolicy() {},
    async grantSession(inputPolicy) {
      return {
        descriptor: descriptorFor(inputPolicy),
        material: new EphemeralSessionMaterial(new TextEncoder().encode("simulated-only")),
      };
    },
    secretDestination: {
      provider: "local-test-only",
      reference: "simulated/altana-session",
    },
    secretSink: {
      async putRuntimeSession() {
        return {
          handoffId: "sim-handoff-1",
          destination: {
            provider: "local-test-only",
            reference: "simulated/altana-session",
          },
          acceptedAtUnix: 1_700_000_002,
          consumed: true,
        };
      },
    },
    async executePermittedAction() {
      return {
        outcome: "confirmed",
        observedAtUnix: 1_700_000_003,
        chainId: 97,
        transactionHash: null,
        target: action.target,
        selector: action.selector,
        reasonCode: null,
      };
    },
    async revokeSession() {
      return {
        outcome: "confirmed",
        observedAtUnix: 1_700_000_004,
        transactionHash: null,
        sessionStatus: "revoked",
        reasonCode: null,
      };
    },
    async executeAfterRevocation() {
      return {
        outcome: options.rejectAfterRevoke === false ? "confirmed" : "rejected",
        observedAtUnix: 1_700_000_005,
        chainId: 97,
        transactionHash: null,
        target: action.target,
        selector: action.selector,
        reasonCode: options.rejectAfterRevoke === false ? null : "AUTHORITY_REVOKED",
      };
    },
  };
}

test("runs every checkpoint with simulated evidence and no secret material", async () => {
  const result = await runPhaseZeroSpike({
    policy,
    action,
    driver: fakeDriver(),
    runId: "sim-run-1",
    evidenceLevel: "simulated",
    nowUnix: 1_700_000_000,
  });

  assert.equal(result.outcome, "passed");
  assert.equal(result.evidence.status, "passed");
  assert.equal(result.evidence.evidenceLevel, "simulated");
  assert.equal(result.evidence.checkpoints.permitted_action_confirmed.state, "observed");
  assert.equal(result.evidence.checkpoints.post_revocation_action_rejected.state, "rejected");
  assert.equal(result.evidence.session.secretDestinationReference, "simulated/altana-session");
  assert.equal("material" in result.evidence, false);
});

test("blocks when the post-revocation action is not rejected", async () => {
  const result = await runPhaseZeroSpike({
    policy,
    action,
    driver: fakeDriver({ rejectAfterRevoke: false }),
    runId: "sim-run-2",
    evidenceLevel: "simulated",
    nowUnix: 1_700_000_000,
  });

  assert.equal(result.outcome, "blocked");
  assert.equal(result.evidence.status, "blocked");
  assert.equal(result.evidence.checkpoints.post_revocation_action_rejected.state, "failed");
  assert.equal(result.evidence.limitations.some((entry) => entry.includes("The state-changing action")), false);
});
