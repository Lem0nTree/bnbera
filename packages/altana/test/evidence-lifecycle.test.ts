import assert from "node:assert/strict";
import test from "node:test";
import {
  AltanaBoundaryError,
  assertEvidenceSafe,
  attachExpectedAction,
  attachPolicyToEvidence,
  attachSessionDescriptor,
  createPhaseZeroEvidenceTemplate,
  createSimulationAttestor,
  executionGate,
  finalizePhaseZeroEvidence,
  recordActionObservation,
  recordCheckpoint,
  recordRevocationObservation,
} from "../src/index.ts";

const policy = {
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
};

const action = {
  target: "0xdddddddddddddddddddddddddddddddddddddddd" as const,
  selector: "0xabcdef01" as const,
  valueWei: 0n,
  spends: [],
};

const descriptor = {
  sessionId: "test-session",
  policy,
  policyDigest: null,
  grantTransactionHash: null,
  secretReference: null,
  grantedAtUnix: 1_700_000_001,
};

const changedDigest = `0x${"11".repeat(32)}` as `0x${string}`;
const unchangedDigest = `0x${"22".repeat(32)}` as `0x${string}`;

function completeEvidence() {
  let evidence = createPhaseZeroEvidenceTemplate(1_700_000_000);
  evidence = attachExpectedAction(evidence, action, 97);
  evidence = attachPolicyToEvidence(evidence, policy);
  evidence = attachSessionDescriptor(evidence, descriptor);
  evidence = {
    ...evidence,
    session: {
      ...evidence.session,
      secretHandoffAccepted: true,
      secretDestinationKind: "local-test-only" as const,
    },
  };
  for (const step of ["policy_reviewed", "session_granted", "session_handed_off"] as const) {
    evidence = recordCheckpoint(evidence, step, {
      state: "observed",
      observedAtUnix: 1_700_000_001,
    });
  }
  evidence = recordActionObservation(evidence, "permitted_action_confirmed", {
    outcome: "confirmed",
    observedAtUnix: 1_700_000_002,
    chainId: 97,
    observedBlockNumber: null,
    transactionHash: null,
    target: action.target,
    selector: action.selector,
    receiptStatus: "confirmed",
    resultingStateDigest: changedDigest,
    resultingStateStatus: "changed",
    reasonCode: null,
  });
  evidence = recordRevocationObservation(evidence, {
    outcome: "confirmed",
    observedAtUnix: 1_700_000_003,
    chainId: 97,
    observedBlockNumber: null,
    transactionHash: null,
    receiptStatus: "confirmed",
    sessionStatus: "revoked",
    revocationReasonCode: "USER_REVOKED",
    reasonCode: null,
  });
  return recordActionObservation(evidence, "post_revocation_action_rejected", {
    outcome: "rejected",
    observedAtUnix: 1_700_000_004,
    chainId: 97,
    observedBlockNumber: null,
    transactionHash: null,
    target: action.target,
    selector: action.selector,
    receiptStatus: "rejected",
    resultingStateDigest: unchangedDigest,
    resultingStateStatus: "unchanged",
    reasonCode: "AUTHORITY_REVOKED",
  });
}

test("template is explicitly not-run and records no invented transaction", () => {
  const evidence = createPhaseZeroEvidenceTemplate(1_700_000_000);
  assert.equal(evidence.status, "not_run");
  assert.equal(evidence.evidenceLevel, "design_only");
  assert.equal(evidence.checkpoints.permitted_action_confirmed.transactionHash, null);
  assert.equal(evidence.session.adminKeyEnteredPlatform, false);
  assert.equal(evidence.session.sessionMaterialPersistedInDatabase, false);
  assert.equal(evidence.session.secretHandoffAccepted, false);
});

test("incomplete evidence cannot be promoted by finalization", () => {
  const evidence = createPhaseZeroEvidenceTemplate(1_700_000_000);
  assert.throws(
    () => finalizePhaseZeroEvidence(evidence, createSimulationAttestor(1_700_000_001)),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("complete simulated evidence is finalized only by the simulation attestor", () => {
  const evidence = finalizePhaseZeroEvidence(
    completeEvidence(),
    createSimulationAttestor(1_700_000_005),
  );
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.evidenceLevel, "simulated");
  assert.equal(evidence.attestation?.attestor, "simulation");
  assert.equal(evidence.attestation?.level, "simulated");
});

test("live evidence cannot pass without action and revocation transaction/block observations", () => {
  const liveAttestor = {
    kind: "authorized-live-adapter" as const,
    attest: () => ({
      level: "testnet" as const,
      attestor: "authorized-live-adapter" as const,
      attestationId: "live-test",
      attestedAtUnix: 1_700_000_005,
    }),
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(completeEvidence(), liveAttestor),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("action evidence must match the expected chain, target, and selector", () => {
  let evidence = attachExpectedAction(
    attachPolicyToEvidence(createPhaseZeroEvidenceTemplate(1_700_000_000), policy),
    action,
    97,
  );
  assert.throws(
    () => recordActionObservation(evidence, "permitted_action_confirmed", {
      outcome: "confirmed",
      observedAtUnix: 1_700_000_001,
      chainId: 97,
      observedBlockNumber: null,
      transactionHash: null,
      target: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      selector: action.selector,
      receiptStatus: "confirmed",
      resultingStateDigest: changedDigest,
      resultingStateStatus: "changed",
      reasonCode: null,
    }),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("sensitive public evidence fields remain rejected", () => {
  assert.throws(
    () => assertEvidenceSafe({ secretDestinationReference: "arn:aws:secretsmanager:never" }),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SENSITIVE_EVIDENCE_FIELD",
  );
  assert.throws(
    () => assertEvidenceSafe({ policy: { privateKey: "never" } }),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "SENSITIVE_EVIDENCE_FIELD",
  );
});

test("execution gate fails closed for revoked authority and allows a valid bounded call", () => {
  const base = {
    descriptor,
    request: action,
    cumulativeSpend: [],
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

test("execution gate rejects unsupported spend permissions", () => {
  const result = executionGate({
    descriptor,
    request: {
      ...action,
      spends: [{
        token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        amountAtomic: 1n,
        period: "day",
      }],
    },
    cumulativeSpend: [],
    observation: {
      status: "active",
      observedAtUnix: 1_700_000_001,
      observedBlockNumber: 100n,
      source: "test",
      reasonCode: null,
    },
    nowUnix: 1_700_000_001,
  });
  assert.deepEqual(result, { allowed: false, reasonCode: "SPEND_NOT_ALLOWED" });
});
