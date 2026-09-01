import {
  AltanaBoundaryError,
  assertActionWithinPolicy,
  attachExpectedAction,
  attachPolicyToEvidence,
  attachSessionDescriptor,
  assertEvidenceSafe,
  createPhaseZeroEvidenceTemplate,
  finalizePhaseZeroEvidence,
  handoffRuntimeSession,
  recordActionObservation,
  recordCheckpoint,
  recordRevocationObservation,
  safeErrorCode,
  serializePolicy,
  type ActionObservation,
  type ActionRequest,
  type CumulativeSpend,
  type EvidenceAttestor,
  type PhaseZeroEvidence,
  type RuntimeSessionDescriptor,
  type RuntimeSessionSecretSink,
  type RevocationObservation,
  type ScopedPolicy,
  type SecretReference,
  type SessionHandoffReceipt,
} from "../../../packages/altana/src/index.ts";
import type { EphemeralSessionMaterial } from "../../../packages/altana/src/index.ts";

export interface GrantedRuntimeSession {
  readonly descriptor: RuntimeSessionDescriptor;
  /** Opaque one-time material; never place this in evidence or a request body. */
  readonly material: EphemeralSessionMaterial;
}

export interface PhaseZeroDriver {
  /** Browser/passkey UI presents the exact policy before the user approves it. */
  reviewPolicy(policy: ScopedPolicy): Promise<void>;
  /** Calls the pinned Altana SDK/Studio adapter and returns public metadata plus opaque material. */
  grantSession(policy: ScopedPolicy): Promise<GrantedRuntimeSession>;
  readonly secretSink: RuntimeSessionSecretSink;
  readonly secretDestination: SecretReference;
  /** Invoke one fixed, policy-checked state-changing action through AgentCore. */
  executePermittedAction(input: {
    readonly descriptor: RuntimeSessionDescriptor;
    readonly request: ActionRequest;
  }): Promise<ActionObservation>;
  /** Revoke through the browser/passkey-controlled administrator path. */
  revokeSession(descriptor: RuntimeSessionDescriptor): Promise<RevocationObservation>;
  /** Attempt the same action after revocation; must be rejected by the live boundary. */
  executeAfterRevocation(input: {
    readonly descriptor: RuntimeSessionDescriptor;
    readonly request: ActionRequest;
  }): Promise<ActionObservation>;
}

export interface PhaseZeroRunInput {
  readonly policy: ScopedPolicy;
  readonly action: ActionRequest;
  readonly cumulativeSpend: readonly CumulativeSpend[];
  readonly driver: PhaseZeroDriver;
  readonly runId: string;
  /** Explicit attestation boundary; no caller-supplied evidence level is accepted. */
  readonly attestor: EvidenceAttestor;
  readonly nowUnix?: number;
}

export interface PhaseZeroRunResult {
  readonly outcome: "passed" | "blocked";
  readonly evidence: PhaseZeroEvidence;
  readonly handoff: SessionHandoffReceipt | null;
}

function withRunId(evidence: PhaseZeroEvidence, runId: string): PhaseZeroEvidence {
  return { ...evidence, runId };
}

function failEvidence(
  evidence: PhaseZeroEvidence,
  step: Parameters<typeof recordCheckpoint>[1],
  reasonCode: string,
): PhaseZeroEvidence {
  const safeReason = /^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode)
    ? reasonCode
    : "PHASE_ZERO_BLOCKED";
  const failed = recordCheckpoint(evidence, step, {
    state: "failed",
    reasonCode: safeReason,
  });
  return {
    ...failed,
    status: "blocked",
    limitations: [...failed.limitations, `Phase-zero execution stopped at ${step}.`],
  };
}

/**
 * Execute the phase-zero sequence against injected adapters. This runner does
 * not know how Altana, a browser, Studio, AWS, or AgentCore work; that is
 * intentional. Production adapters must be reviewed against the pinned
 * versions and must return only the public observations represented here.
 *
 * The runner is deliberately locked to BSC testnet. A simulation attestor can
 * exercise the control flow without claiming live chain or custody evidence;
 * only an authorized live adapter may issue the `testnet` level.
 */
export async function runPhaseZeroSpike(input: PhaseZeroRunInput): Promise<PhaseZeroRunResult> {
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  let evidence = withRunId(createPhaseZeroEvidenceTemplate(nowUnix), input.runId);
  let handoff: SessionHandoffReceipt | null = null;
  let currentStep: Parameters<typeof recordCheckpoint>[1] = "policy_reviewed";

  try {
    if (input.policy.chainId !== 97) {
      throw new AltanaBoundaryError(
        "INVALID_CHAIN",
        "The phase-zero Studio spike is locked to BSC testnet (chain 97).",
      );
    }

    evidence = attachExpectedAction(evidence, input.action, input.policy.chainId);
    assertActionWithinPolicy(input.policy, input.action, nowUnix, input.cumulativeSpend);
    evidence = attachPolicyToEvidence(evidence, input.policy);

    currentStep = "policy_reviewed";
    await input.driver.reviewPolicy(input.policy);
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "observed",
      observedAtUnix: nowUnix,
    });

    currentStep = "session_granted";
    const granted = await input.driver.grantSession(input.policy);
    if (serializePolicy(granted.descriptor.policy) !== serializePolicy(input.policy)) {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The granted session policy differs from the reviewed policy.",
      );
    }
    evidence = attachSessionDescriptor(evidence, granted.descriptor);
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "observed",
      observedAtUnix: granted.descriptor.grantedAtUnix,
    });

    currentStep = "session_handed_off";
    handoff = await handoffRuntimeSession({
      material: granted.material,
      descriptor: granted.descriptor,
      destination: input.driver.secretDestination,
      sink: input.driver.secretSink,
      nowUnix,
    });
    // A public report may carry only a logical provider kind and acceptance
    // boolean. The actual secret destination/reference stays inside the sink.
    evidence = {
      ...evidence,
      session: {
        ...evidence.session,
        secretHandoffAccepted: true,
        secretDestinationKind: handoff.destination.provider,
      },
    };
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "observed",
      observedAtUnix: handoff.acceptedAtUnix,
    });

    currentStep = "permitted_action_confirmed";
    const action = await input.driver.executePermittedAction({
      descriptor: granted.descriptor,
      request: input.action,
    });
    evidence = recordActionObservation(evidence, currentStep, action);
    if (action.outcome !== "confirmed") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The permitted test action was not confirmed.",
        { retriable: true },
      );
    }

    currentStep = "revocation_confirmed";
    const revocation = await input.driver.revokeSession(granted.descriptor);
    evidence = recordRevocationObservation(evidence, revocation);
    if (revocation.outcome !== "confirmed" || revocation.sessionStatus !== "revoked") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "Revocation was not confirmed by the injected adapter.",
        { retriable: true },
      );
    }

    currentStep = "post_revocation_action_rejected";
    const afterRevocation = await input.driver.executeAfterRevocation({
      descriptor: granted.descriptor,
      request: input.action,
    });
    evidence = recordActionObservation(evidence, currentStep, afterRevocation);
    if (afterRevocation.outcome !== "rejected") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The state-changing action was not rejected after revocation.",
      );
    }

    const finalEvidence = finalizePhaseZeroEvidence(evidence, input.attestor);
    assertEvidenceSafe(finalEvidence);
    return {
      outcome: "passed",
      evidence: finalEvidence,
      handoff,
    };
  } catch (error) {
    try {
      evidence = failEvidence(evidence, currentStep, safeErrorCode(error));
    } catch {
      // Do not let malformed adapter output replace the safe generic report.
      evidence = {
        ...evidence,
        status: "blocked",
        limitations: [...evidence.limitations, "Adapter output could not be represented safely."],
      };
    }
    assertEvidenceSafe(evidence);
    return {
      outcome: "blocked",
      evidence,
      handoff,
    };
  }
}
