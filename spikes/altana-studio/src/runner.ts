import {
  AltanaBoundaryError,
  attachPolicyToEvidence,
  attachSessionDescriptor,
  assertEvidenceSafe,
  assertCallAllowed,
  createPhaseZeroEvidenceTemplate,
  finalizePhaseZeroEvidence,
  handoffRuntimeSession,
  recordCheckpoint,
  safeErrorCode,
  serializePolicy,
  type ActionObservation,
  type ActionRequest,
  type EvidenceLevel,
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
  readonly driver: PhaseZeroDriver;
  readonly runId: string;
  /** Must be supplied explicitly; tests use `simulated`, live runs use testnet only after proof. */
  readonly evidenceLevel: Exclude<EvidenceLevel, "design_only" | "mainnet">;
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
  return recordCheckpoint(evidence, step, {
    state: "failed",
    reasonCode: safeReason,
  });
}

/**
 * Execute the phase-zero sequence against injected adapters. This runner does
 * not know how Altana, a browser, Studio, AWS, or AgentCore work; that is
 * intentional. Production adapters must be reviewed against the pinned
 * versions and must return only the public observations represented here.
 */
export async function runPhaseZeroSpike(input: PhaseZeroRunInput): Promise<PhaseZeroRunResult> {
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  let evidence = withRunId(createPhaseZeroEvidenceTemplate(nowUnix), input.runId);
  let handoff: SessionHandoffReceipt | null = null;
  let currentStep: Parameters<typeof recordCheckpoint>[1] = "policy_reviewed";

  try {
    assertCallAllowed(input.policy, input.action, nowUnix);
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
      transactionHash: granted.descriptor.grantTransactionHash,
    });

    currentStep = "session_handed_off";
    handoff = await handoffRuntimeSession({
      material: granted.material,
      descriptor: granted.descriptor,
      destination: input.driver.secretDestination,
      sink: input.driver.secretSink,
      nowUnix,
    });
    evidence = {
      ...evidence,
      session: {
        ...evidence.session,
        secretDestinationReference: handoff.destination.reference,
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
    if (action.outcome !== "confirmed") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The permitted test action was not confirmed.",
        { retriable: true },
      );
    }
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "observed",
      observedAtUnix: action.observedAtUnix,
      transactionHash: action.transactionHash,
      reasonCode: action.reasonCode,
    });

    currentStep = "revocation_confirmed";
    const revocation = await input.driver.revokeSession(granted.descriptor);
    if (revocation.outcome !== "confirmed" || revocation.sessionStatus !== "revoked") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "Revocation was not confirmed by the injected adapter.",
        { retriable: true },
      );
    }
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "observed",
      observedAtUnix: revocation.observedAtUnix,
      transactionHash: revocation.transactionHash,
      reasonCode: revocation.reasonCode,
    });

    currentStep = "post_revocation_action_rejected";
    const afterRevocation = await input.driver.executeAfterRevocation({
      descriptor: granted.descriptor,
      request: input.action,
    });
    if (afterRevocation.outcome !== "rejected") {
      throw new AltanaBoundaryError(
        "SESSION_HANDOFF_FAILED",
        "The state-changing action was not rejected after revocation.",
      );
    }
    evidence = recordCheckpoint(evidence, currentStep, {
      state: "rejected",
      observedAtUnix: afterRevocation.observedAtUnix,
      reasonCode: afterRevocation.reasonCode ?? "AUTHORITY_REVOKED",
    });

    const finalEvidence = finalizePhaseZeroEvidence(evidence, "passed", input.evidenceLevel);
    assertEvidenceSafe(finalEvidence);
    return {
      outcome: "passed",
      evidence: finalEvidence,
      handoff,
    };
  } catch (error) {
    const code = safeErrorCode(error);
    try {
      evidence = failEvidence(evidence, currentStep, code);
    } catch {
      // Do not let malformed adapter output replace the safe generic report.
      evidence = {
        ...evidence,
        status: "blocked",
        limitations: [...evidence.limitations, "Adapter output could not be represented safely."],
      };
    }
    const finalEvidence = finalizePhaseZeroEvidence(evidence, "blocked", input.evidenceLevel);
    assertEvidenceSafe(finalEvidence);
    return {
      outcome: "blocked",
      evidence: finalEvidence,
      handoff,
    };
  }
}
