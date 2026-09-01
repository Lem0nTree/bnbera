import { AltanaBoundaryError } from "./errors.ts";
import { toPublicPolicySummary } from "./policy.ts";
import type { RuntimeSessionDescriptor, ScopedPolicy } from "./types.ts";

export type EvidenceLevel = "design_only" | "local_test" | "simulated" | "testnet" | "mainnet";
export type EvidenceStatus = "not_run" | "in_progress" | "passed" | "failed" | "blocked";

export const PHASE_ZERO_STEPS = [
  "policy_reviewed",
  "session_granted",
  "session_handed_off",
  "permitted_action_confirmed",
  "revocation_confirmed",
  "post_revocation_action_rejected",
] as const;

export type PhaseZeroStep = (typeof PHASE_ZERO_STEPS)[number];

export interface EvidenceCheckpoint {
  readonly state: "not_observed" | "observed" | "rejected" | "failed";
  readonly observedAtUnix: number | null;
  readonly transactionHash: `0x${string}` | null;
  readonly reasonCode: string | null;
}

export interface PhaseZeroEvidence {
  readonly schemaVersion: "bnbera.altana.phase-zero/v1";
  readonly status: EvidenceStatus;
  readonly evidenceLevel: EvidenceLevel;
  readonly runId: string | null;
  readonly generatedAtUnix: number;
  readonly versions: {
    readonly studioCli: string | null;
    readonly studioRuntime: string | null;
    readonly altanaSdk: string | null;
  };
  readonly environment: {
    readonly network: "bsc-testnet" | "bsc-mainnet" | null;
    readonly chainId: 56 | 97 | null;
    readonly awsRegion: string | null;
    readonly runtimeName: string | null;
  };
  readonly policy: ReturnType<typeof toPublicPolicySummary> | null;
  readonly session: {
    readonly sessionId: string | null;
    readonly secretDestinationReference: string | null;
    readonly adminKeyEnteredPlatform: false;
    readonly sessionMaterialPersistedInDatabase: false;
  };
  readonly checkpoints: Readonly<Record<PhaseZeroStep, EvidenceCheckpoint>>;
  readonly requiredAccess: readonly string[];
  readonly limitations: readonly string[];
}

const FORBIDDEN_FIELD = /^(?:private_?key|seed(?:_?phrase)?|password|passkey(?:_?export)?|serialized_?session|raw_?session|secret(?:_?(?:value|material|credential|session))|session_?(?:material|serialization|credential)|(?:api|auth|access|refresh)_?token|cookie|credential_?value|admin_?signer)$/i;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,63}$/;

function emptyCheckpoint(): EvidenceCheckpoint {
  return {
    state: "not_observed",
    observedAtUnix: null,
    transactionHash: null,
    reasonCode: null,
  };
}

export function createPhaseZeroEvidenceTemplate(nowUnix = Math.floor(Date.now() / 1000)): PhaseZeroEvidence {
  return {
    schemaVersion: "bnbera.altana.phase-zero/v1",
    status: "not_run",
    evidenceLevel: "design_only",
    runId: null,
    generatedAtUnix: nowUnix,
    versions: {
      studioCli: "0.0.13",
      studioRuntime: null,
      altanaSdk: null,
    },
    environment: {
      network: "bsc-testnet",
      chainId: 97,
      awsRegion: null,
      runtimeName: null,
    },
    policy: null,
    session: {
      sessionId: null,
      secretDestinationReference: null,
      adminKeyEnteredPlatform: false,
      sessionMaterialPersistedInDatabase: false,
    },
    checkpoints: Object.fromEntries(
      PHASE_ZERO_STEPS.map((step) => [step, emptyCheckpoint()]),
    ) as Record<PhaseZeroStep, EvidenceCheckpoint>,
    requiredAccess: [
      "Altana browser/passkey test account",
      "BNB testnet wallet with bounded funds",
      "Agent Studio CLI 0.0.13 and runtime",
      "isolated AWS development account or sandbox secret store",
    ],
    limitations: [
      "Template only: no browser, wallet, SDK, AWS, or chain observation has been performed.",
      "A local or simulated run cannot establish live Altana custody or Agent Studio deployment support.",
    ],
  };
}

export function attachPolicyToEvidence(
  evidence: PhaseZeroEvidence,
  policy: ScopedPolicy,
): PhaseZeroEvidence {
  return {
    ...evidence,
    status: "in_progress",
    policy: toPublicPolicySummary(policy),
  };
}

export function attachSessionDescriptor(
  evidence: PhaseZeroEvidence,
  descriptor: RuntimeSessionDescriptor,
): PhaseZeroEvidence {
  return {
    ...evidence,
    session: {
      ...evidence.session,
      sessionId: descriptor.sessionId,
      secretDestinationReference: descriptor.secretReference,
    },
  };
}

export function recordCheckpoint(
  evidence: PhaseZeroEvidence,
  step: PhaseZeroStep,
  observation: {
    readonly state: EvidenceCheckpoint["state"];
    readonly observedAtUnix?: number;
    readonly transactionHash?: string | null;
    readonly reasonCode?: string | null;
  },
): PhaseZeroEvidence {
  const observedAtUnix = observation.observedAtUnix ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(observedAtUnix) || observedAtUnix <= 0) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Evidence time must be a Unix-second integer.");
  }

  let transactionHash: `0x${string}` | null = null;
  if (observation.transactionHash !== undefined && observation.transactionHash !== null) {
    if (!TX_HASH.test(observation.transactionHash)) {
      throw new AltanaBoundaryError(
        "INVALID_EVIDENCE_VALUE",
        "Evidence transaction references must be 32-byte hexadecimal hashes.",
      );
    }
    transactionHash = `0x${observation.transactionHash.slice(2).toLowerCase()}` as `0x${string}`;
  }

  const reasonCode = observation.reasonCode ?? null;
  if (reasonCode !== null && !SAFE_REASON.test(reasonCode)) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Evidence reason codes must be short uppercase identifiers.",
    );
  }

  return {
    ...evidence,
    status: "in_progress",
    checkpoints: {
      ...evidence.checkpoints,
      [step]: {
        state: observation.state,
        observedAtUnix,
        transactionHash,
        reasonCode,
      },
    },
  };
}

export function finalizePhaseZeroEvidence(
  evidence: PhaseZeroEvidence,
  status: Exclude<EvidenceStatus, "not_run" | "in_progress">,
  evidenceLevel: EvidenceLevel,
): PhaseZeroEvidence {
  return {
    ...evidence,
    status,
    evidenceLevel,
  };
}

/**
 * Fail closed if an adapter tries to put a credential-shaped field into a
 * public evidence object.  The typed template remains the primary allowlist;
 * this guard is a second boundary for JSON assembled by integration code.
 */
export function assertEvidenceSafe(value: unknown, path = "evidence"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertEvidenceSafe(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new AltanaBoundaryError(
        "SENSITIVE_EVIDENCE_FIELD",
        `Sensitive evidence field rejected at ${path}.${key}.`,
      );
    }
    assertEvidenceSafe(child, `${path}.${key}`);
  }
}

export function sanitizeEvidence(evidence: PhaseZeroEvidence): PhaseZeroEvidence {
  assertEvidenceSafe(evidence);
  return JSON.parse(JSON.stringify(evidence)) as PhaseZeroEvidence;
}
