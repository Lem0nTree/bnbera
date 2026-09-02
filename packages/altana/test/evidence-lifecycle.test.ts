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
  recordAuthorityObservation,
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
  policyDigest: `0x${"aa".repeat(32)}` as `0x${string}`,
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
  evidence = recordAuthorityObservation(evidence, {
    sessionId: descriptor.sessionId,
    policyDigest: descriptor.policyDigest,
    status: "active",
    observedAtUnix: 1_700_000_001,
    observedBlockNumber: 100n,
    source: "test",
    reasonCode: null,
  });
  evidence = recordActionObservation(evidence, "permitted_action_confirmed", {
    outcome: "confirmed",
    observedAtUnix: 1_700_000_002,
    chainId: 97,
    observedBlockNumber: null,
    transactionHash: null,
    target: action.target,
    selector: action.selector,
    valueWei: action.valueWei,
    spends: action.spends,
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
    sessionId: descriptor.sessionId,
    policyDigest: descriptor.policyDigest,
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
    valueWei: action.valueWei,
    spends: action.spends,
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

test("finalization rejects an authority observation that is stale for the action", () => {
  const complete = completeEvidence();
  const stale = {
    ...complete,
    checkpoints: {
      ...complete.checkpoints,
      permitted_action_confirmed: {
        ...complete.checkpoints.permitted_action_confirmed,
        observedAtUnix: 1_700_000_100,
      },
    },
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(stale, createSimulationAttestor(1_700_000_101)),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("finalization rejects action, revocation, and rejection chronology violations", () => {
  const complete = completeEvidence();
  const actionAfterRevocation = {
    ...complete,
    checkpoints: {
      ...complete.checkpoints,
      permitted_action_confirmed: {
        ...complete.checkpoints.permitted_action_confirmed,
        observedAtUnix: 1_700_000_004,
      },
    },
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(actionAfterRevocation, createSimulationAttestor(1_700_000_005)),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );

  const rejectionBeforeRevocation = {
    ...complete,
    checkpoints: {
      ...complete.checkpoints,
      post_revocation_action_rejected: {
        ...complete.checkpoints.post_revocation_action_rejected,
        observedAtUnix: 1_700_000_002,
      },
    },
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(rejectionBeforeRevocation, createSimulationAttestor(1_700_000_005)),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("finalization rejects decreasing observed blocks when block evidence exists", () => {
  const complete = completeEvidence();
  const blocksOutOfOrder = {
    ...complete,
    checkpoints: {
      ...complete.checkpoints,
      permitted_action_confirmed: {
        ...complete.checkpoints.permitted_action_confirmed,
        observedBlockNumber: "105",
      },
      revocation_confirmed: {
        ...complete.checkpoints.revocation_confirmed,
        observedBlockNumber: "104",
      },
      post_revocation_action_rejected: {
        ...complete.checkpoints.post_revocation_action_rejected,
        observedBlockNumber: "106",
      },
    },
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(blocksOutOfOrder, createSimulationAttestor(1_700_000_005)),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("live evidence cannot pass without action and revocation transaction/block observations", () => {
  let attestorInvoked = false;
  const liveAttestor = {
    kind: "authorized-live-adapter" as const,
    attest: () => {
      attestorInvoked = true;
      return {
        level: "testnet" as const,
        attestor: "authorized-live-adapter" as const,
        attestationId: "live-test",
        attestedAtUnix: 1_700_000_005,
      };
    },
  };
  assert.throws(
    () => finalizePhaseZeroEvidence(completeEvidence(), liveAttestor),
    (error: unknown) =>
      error instanceof AltanaBoundaryError &&
      error.code === "INVALID_EVIDENCE_VALUE" &&
      error.message.includes("module-private reviewed attestor capability"),
  );
  assert.equal(attestorInvoked, false);
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
      valueWei: action.valueWei,
      spends: action.spends,
      receiptStatus: "confirmed",
      resultingStateDigest: changedDigest,
      resultingStateStatus: "changed",
      reasonCode: null,
    }),
    (error: unknown) => error instanceof AltanaBoundaryError && error.code === "INVALID_EVIDENCE_VALUE",
  );
});

test("action evidence must match the actual native value and spend charges", () => {
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
      target: action.target,
      selector: action.selector,
      valueWei: 1n,
      spends: [{ token: "native", amountAtomic: 1n, period: "day" }],
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
        sessionId: descriptor.sessionId,
        policyDigest: descriptor.policyDigest,
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
        sessionId: descriptor.sessionId,
        policyDigest: descriptor.policyDigest,
        status: "revoked",
        observedAtUnix: 1_700_000_002,
        observedBlockNumber: 101n,
        source: "test",
        reasonCode: "AUTHORITY_REVOKED",
      },
      nowUnix: 1_700_000_003,
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
      sessionId: descriptor.sessionId,
      policyDigest: descriptor.policyDigest,
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

test("execution gate rejects unbound or stale active authority observations", () => {
  const base = {
    descriptor,
    request: action,
    cumulativeSpend: [],
    nowUnix: 1_700_000_100,
  };
  const active = {
    status: "active" as const,
    observedAtUnix: 1_700_000_099,
    observedBlockNumber: 100n,
    source: "test" as const,
    reasonCode: null,
  };
  assert.deepEqual(
    executionGate({
      ...base,
      observation: { ...active, sessionId: "other-session", policyDigest: descriptor.policyDigest },
    }),
    { allowed: false, reasonCode: "SESSION_ID_MISMATCH" },
  );
  assert.deepEqual(
    executionGate({
      ...base,
      observation: { ...active, sessionId: descriptor.sessionId, policyDigest: `0x${"bb".repeat(32)}` },
    }),
    { allowed: false, reasonCode: "POLICY_DIGEST_MISMATCH" },
  );
  assert.deepEqual(
    executionGate({
      ...base,
      observation: {
        ...active,
        sessionId: descriptor.sessionId,
        policyDigest: descriptor.policyDigest,
        observedAtUnix: 1_700_000_000,
      },
    }),
    { allowed: false, reasonCode: "AUTHORITY_STALE" },
  );
});
