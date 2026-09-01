import assert from "node:assert/strict";
import test from "node:test";
import {
  AltanaBoundaryError,
  assertEvidenceSafe,
  createPhaseZeroEvidenceTemplate,
  executionGate,
  finalizePhaseZeroEvidence,
  recordCheckpoint,
} from "../src/index.ts";

const descriptor = {
  sessionId: "test-session",
  policy: {
    chainId: 97 as const,
    adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
    walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
    sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc" as const,
    calls: [
      {
        target: "0xdddddddddddddddddddddddddddddddddddddddd" as const,
        selectors: ["0xabcdef01" as const],
        maxNativeValueWei: 0n,
      },
    ],
    spend: [],
    expiresAtUnix: 1_800_000_000,
  },
  policyDigest: null,
  grantTransactionHash: null,
  secretReference: null,
  grantedAtUnix: 1_700_000_000,
};

test("template is explicitly not-run and records no invented transaction", () => {
  const evidence = createPhaseZeroEvidenceTemplate(1_700_000_000);
  assert.equal(evidence.status, "not_run");
  assert.equal(evidence.evidenceLevel, "design_only");
  assert.equal(evidence.checkpoints.permitted_action_confirmed.transactionHash, null);
  assert.equal(evidence.session.adminKeyEnteredPlatform, false);
  assert.equal(evidence.session.sessionMaterialPersistedInDatabase, false);
});

test("evidence checkpoints can be recorded and finalized only by the caller", () => {
  let evidence = createPhaseZeroEvidenceTemplate(1_700_000_000);
  evidence = recordCheckpoint(evidence, "policy_reviewed", {
    state: "observed",
    observedAtUnix: 1_700_000_001,
  });
  assert.equal(evidence.checkpoints.policy_reviewed.state, "observed");
  evidence = finalizePhaseZeroEvidence(evidence, "passed", "simulated");
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.evidenceLevel, "simulated");
});

test("sensitive fields are rejected from public evidence", () => {
  assert.throws(
    () => assertEvidenceSafe({ policy: { privateKey: "never" } }),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SENSITIVE_EVIDENCE_FIELD",
  );
});

test("execution gate fails closed for revoked authority and allows a valid bounded call", () => {
  const base = {
    descriptor,
    request: {
      target: "0xdddddddddddddddddddddddddddddddddddddddd" as const,
      selector: "0xabcdef01" as const,
      valueWei: 0n,
    },
    nowUnix: 1_700_000_001,
  };
  assert.deepEqual(
    executionGate({
      ...base,
      observation: {
        status: "active",
        observedAtUnix: 1_700_000_001,
        observedBlockNumber: 100n,
        source: "test",
        reasonCode: null,
      },
    }),
    { allowed: true, reasonCode: null },
  );
  assert.deepEqual(
    executionGate({
      ...base,
      observation: {
        status: "revoked",
        observedAtUnix: 1_700_000_002,
        observedBlockNumber: 101n,
        source: "test",
        reasonCode: "AUTHORITY_REVOKED",
      },
    }),
    { allowed: false, reasonCode: "AUTHORITY_REVOKED" },
  );
});

