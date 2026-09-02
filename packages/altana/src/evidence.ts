import { AltanaBoundaryError } from "./errors.ts";
import {
  normalizeAddress,
  normalizeSelector,
  toPublicPolicySummary,
} from "./policy.ts";
import type {
  ActionObservation,
  ActionRequest,
  ChainId,
  RevocationObservation,
  RuntimeSessionDescriptor,
  SessionStateObservation,
  ScopedPolicy,
  SecretReference,
  SpendCharge,
} from "./types.ts";

export type EvidenceLevel = "design_only" | "local_test" | "simulated" | "testnet";
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
export type ActionEvidenceStep =
  | "permitted_action_confirmed"
  | "post_revocation_action_rejected";

export interface EvidenceCheckpoint {
  readonly state: "not_observed" | "observed" | "rejected" | "failed";
  readonly observedAtUnix: number | null;
  readonly chainId: ChainId | null;
  readonly observedBlockNumber: string | null;
  readonly target: `0x${string}` | null;
  readonly selector: `0x${string}` | null;
  readonly transactionHash: `0x${string}` | null;
  readonly receiptStatus: "confirmed" | "rejected" | "unknown" | null;
  readonly resultingStateDigest: `0x${string}` | null;
  readonly resultingStateStatus: "changed" | "unchanged" | "unknown" | null;
  readonly valueWei: string | null;
  readonly spends: readonly PublicSpendEvidence[] | null;
  readonly reasonCode: string | null;
  readonly revocationReasonCode: string | null;
}

export interface PublicSpendEvidence {
  readonly token: `0x${string}` | "native";
  readonly amountAtomic: string;
  readonly period: "call" | "hour" | "day" | "week" | "lifetime";
}

export interface ExpectedActionEvidence {
  readonly chainId: ChainId;
  readonly target: `0x${string}`;
  readonly selector: `0x${string}`;
  readonly valueWei: string;
  readonly spends: readonly PublicSpendEvidence[];
}

export interface SessionAuthorityEvidence {
  readonly sessionId: string;
  readonly policyDigest: `0x${string}` | null;
  readonly status: SessionStateObservation["status"];
  readonly observedAtUnix: number;
  readonly observedBlockNumber: string | null;
  readonly source: SessionStateObservation["source"];
  readonly reasonCode: string | null;
}

export interface EvidenceAttestation {
  readonly level: Exclude<EvidenceLevel, "design_only">;
  readonly attestor:
    | "simulation"
    | "local-verifier"
    | "authorized-live-adapter";
  /** Public correlation value issued by the attestor; never a secret. */
  readonly attestationId: string;
  readonly attestedAtUnix: number;
}

export interface EvidenceAttestor {
  /**
   * The implementation is an explicit evidence boundary. It must inspect
   * the complete report and issue an attestation only at its claimed level.
   * The runner never accepts a free-form evidence-level string. A live
   * attestor also needs the module-private reviewed capability checked during
   * finalization; a plain object with `kind: "authorized-live-adapter"` is
   * deliberately not sufficient.
   */
  readonly kind: EvidenceAttestation["attestor"];
  readonly attest: (evidence: PhaseZeroEvidence) => EvidenceAttestation;
}

export interface PhaseZeroEvidence {
  readonly schemaVersion: "bnbera.altana.phase-zero/v1";
  readonly status: EvidenceStatus;
  readonly evidenceLevel: EvidenceLevel;
  readonly runId: string | null;
  readonly selectedAlternative: "A" | "B" | null;
  readonly generatedAtUnix: number;
  readonly versions: {
    readonly studioCli: string | null;
    readonly studioRuntime: string | null;
    readonly altanaSdk: string | null;
  };
  readonly environment: {
    readonly network: "bsc-testnet" | "bsc-mainnet" | null;
    readonly chainId: ChainId | null;
    readonly awsRegion: string | null;
    readonly runtimeName: string | null;
  };
  readonly policy: ReturnType<typeof toPublicPolicySummary> | null;
  readonly expectedAction: ExpectedActionEvidence | null;
  readonly session: {
    readonly sessionId: string | null;
    readonly policyDigest: `0x${string}` | null;
    readonly authorityObservation: SessionAuthorityEvidence | null;
    /** Boolean and logical kind only; never an ARN/name/value. */
    readonly secretHandoffAccepted: boolean;
    readonly secretDestinationKind: SecretReference["provider"] | null;
    readonly adminKeyEnteredPlatform: false;
    readonly sessionMaterialPersistedInDatabase: false;
  };
  readonly checkpoints: Readonly<Record<PhaseZeroStep, EvidenceCheckpoint>>;
  readonly attestation: {
    readonly level: Exclude<EvidenceLevel, "design_only">;
    readonly attestor: EvidenceAttestation["attestor"];
    readonly attestationId: string;
    readonly attestedAtUnix: number;
  } | null;
  readonly requiredAccess: readonly string[];
  readonly limitations: readonly string[];
}

const FORBIDDEN_FIELD = /^(?:private_?key|seed(?:_?phrase)?|password|passkey(?:_?export)?|serialized_?session|raw_?session|secret(?:_?(?:value|material|credential|session|destination_?(?:reference|arn))|_?reference)|session_?(?:material|serialization|credential)|(?:api|auth|access|refresh)_?token|cookie|credential_?value|admin_?signer|(?:secret_?)?arn)$/i;
const HASH_32 = /^0x[a-fA-F0-9]{64}$/;
const SAFE_REASON = /^[A-Z][A-Z0-9_]{1,63}$/;
const SAFE_ATTESTATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ATOMIC = /^\d+$/;
const SAFE_BLOCK = /^\d+$/;
const VALID_PERIODS = new Set(["call", "hour", "day", "week", "lifetime"]);
const MAX_AUTHORITY_OBSERVATION_AGE_SECONDS = 60;
/**
 * Unexported brand for the reviewed live-attestation adapter. Keeping this
 * capability private prevents callers from promoting a fabricated object by
 * merely setting `kind` and returning `level: "testnet"`.
 */
const TRUSTED_LIVE_ATTESTOR = Symbol("bnbera.altana.trusted-live-attestor");
const VALID_SESSION_SOURCES = new Set<SessionStateObservation["source"]>([
  "altana-sdk",
  "keystore-read",
  "chain-read",
  "test",
]);
const VALID_SECRET_DESTINATIONS = new Set<SecretReference["provider"]>([
  "studio-delegated-secret-channel",
  "aws-secrets-manager",
  "local-test-only",
]);

function emptyCheckpoint(): EvidenceCheckpoint {
  return {
    state: "not_observed",
    observedAtUnix: null,
    chainId: null,
    observedBlockNumber: null,
    target: null,
    selector: null,
    transactionHash: null,
    receiptStatus: null,
    resultingStateDigest: null,
    resultingStateStatus: null,
    valueWei: null,
    spends: null,
    reasonCode: null,
    revocationReasonCode: null,
  };
}

export function createPhaseZeroEvidenceTemplate(nowUnix = Math.floor(Date.now() / 1000)): PhaseZeroEvidence {
  return {
    schemaVersion: "bnbera.altana.phase-zero/v1",
    status: "not_run",
    evidenceLevel: "design_only",
    runId: null,
    selectedAlternative: null,
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
    expectedAction: null,
    session: {
      sessionId: null,
      policyDigest: null,
      authorityObservation: null,
      secretHandoffAccepted: false,
      secretDestinationKind: null,
      adminKeyEnteredPlatform: false,
      sessionMaterialPersistedInDatabase: false,
    },
    checkpoints: Object.fromEntries(
      PHASE_ZERO_STEPS.map((step) => [step, emptyCheckpoint()]),
    ) as Record<PhaseZeroStep, EvidenceCheckpoint>,
    attestation: null,
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

export function attachExpectedAction(
  evidence: PhaseZeroEvidence,
  request: ActionRequest,
  chainId: ChainId,
): PhaseZeroEvidence {
  if (typeof request.valueWei !== "bigint" || request.valueWei < 0n) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Expected action native value must be a non-negative bigint.",
    );
  }
  if (!Array.isArray(request.spends)) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Expected action spend charges must be provided explicitly.",
    );
  }
  const spends: ExpectedActionEvidence["spends"] = request.spends.map((charge) => {
    if (
      charge === null ||
      typeof charge !== "object" ||
      typeof charge.amountAtomic !== "bigint" ||
      charge.amountAtomic < 0n ||
      typeof charge.period !== "string" ||
      !VALID_PERIODS.has(charge.period)
    ) {
      throw new AltanaBoundaryError(
        "INVALID_EVIDENCE_VALUE",
        "Expected action spend charges must use non-negative bigint amounts and bounded periods.",
      );
    }
    return {
      token: charge.token === "native" ? "native" : normalizeAddress(charge.token),
      amountAtomic: charge.amountAtomic.toString(10),
      period: charge.period as ExpectedActionEvidence["spends"][number]["period"],
    };
  });
  const nativeCharge = spends
    .filter((charge) => charge.token === "native")
    .reduce((total, charge) => total + BigInt(charge.amountAtomic), 0n);
  if (nativeCharge !== request.valueWei) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Expected action native value must match its explicit native spend charges.",
    );
  }
  return {
    ...evidence,
    status: "in_progress",
    expectedAction: {
      chainId,
      target: normalizeAddress(request.target),
      selector: normalizeSelector(request.selector),
      valueWei: request.valueWei.toString(10),
      spends,
    },
  };
}

export function attachSessionDescriptor(
  evidence: PhaseZeroEvidence,
  descriptor: RuntimeSessionDescriptor,
): PhaseZeroEvidence {
  const policyDigest = descriptor.policyDigest === null
    ? null
    : normalizePolicyDigest(descriptor.policyDigest, "Session policy digest");
  return {
    ...evidence,
    session: {
      ...evidence.session,
      sessionId: descriptor.sessionId,
      policyDigest,
    },
  };
}

/**
 * Attach the fresh active authority read used immediately before the first
 * state-changing action. The read is bound to the exact session and policy
 * digest; an unbound active flag is not sufficient evidence.
 */
export function recordAuthorityObservation(
  evidence: PhaseZeroEvidence,
  observation: SessionStateObservation,
): PhaseZeroEvidence {
  if (evidence.session.sessionId === null) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "A session descriptor must be attached before an authority observation.",
    );
  }
  if (observation.sessionId !== evidence.session.sessionId) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Authority observation session does not match the granted session.",
    );
  }
  if (observation.status !== "active") {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "The pre-action authority observation must be active.",
    );
  }
  if (
    evidence.session.policyDigest === null ||
    observation.policyDigest === null ||
    normalizePolicyDigest(observation.policyDigest, "Authority policy digest") !==
      normalizePolicyDigest(evidence.session.policyDigest, "Session policy digest")
  ) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Authority observation policy digest does not match the granted session.",
    );
  }
  if (!VALID_SESSION_SOURCES.has(observation.source)) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Authority observation source is not recognized.",
    );
  }
  validateObservedTime(observation.observedAtUnix);
  return {
    ...evidence,
    status: "in_progress",
    session: {
      ...evidence.session,
      authorityObservation: {
        sessionId: observation.sessionId,
        policyDigest: normalizePolicyDigest(observation.policyDigest, "Authority policy digest"),
        status: observation.status,
        observedAtUnix: observation.observedAtUnix,
        observedBlockNumber: stringifyBlock(observation.observedBlockNumber),
        source: observation.source,
        reasonCode: validateReasonCode(observation.reasonCode),
      },
    },
  };
}

export function recordCheckpoint(
  evidence: PhaseZeroEvidence,
  step: PhaseZeroStep,
  observation: {
    readonly state: EvidenceCheckpoint["state"];
    readonly observedAtUnix?: number;
    readonly reasonCode?: string | null;
    readonly revocationReasonCode?: string | null;
  },
): PhaseZeroEvidence {
  const observedAtUnix = observation.observedAtUnix ?? Math.floor(Date.now() / 1000);
  validateObservedTime(observedAtUnix);
  const reasonCode = validateReasonCode(observation.reasonCode ?? null);
  const revocationReasonCode = validateReasonCode(observation.revocationReasonCode ?? null);

  return {
    ...evidence,
    status: "in_progress",
    checkpoints: {
      ...evidence.checkpoints,
      [step]: {
        ...emptyCheckpoint(),
        state: observation.state,
        observedAtUnix,
        reasonCode,
        revocationReasonCode,
      },
    },
  };
}

export function recordActionObservation(
  evidence: PhaseZeroEvidence,
  step: ActionEvidenceStep,
  observation: ActionObservation,
): PhaseZeroEvidence {
  const expected = evidence.expectedAction;
  if (expected === null) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "An expected action must be attached before action evidence.",
    );
  }
  validateObservedTime(observation.observedAtUnix);
  if (observation.chainId !== expected.chainId) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Action evidence chain does not match the expected chain.");
  }
  const expectedSpend = validateExpectedActionEvidence(expected);
  const observedSpend = normalizeObservedSpends(observation.valueWei, observation.spends);
  if (
    observedSpend.valueWei !== expectedSpend.valueWei ||
    !sameSpendTotals(observedSpend.totals, expectedSpend.totals)
  ) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Action value or token/native spend evidence does not match the expected action.",
    );
  }
  if (normalizeAddress(observation.target) !== expected.target) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Action evidence target does not match the expected target.");
  }
  if (normalizeSelector(observation.selector) !== expected.selector) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Action evidence selector does not match the expected selector.");
  }
  if (observation.receiptStatus !== observation.outcome) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Action outcome and receipt status must agree.");
  }
  if (observation.resultingStateDigest !== null) validateHash(observation.resultingStateDigest, "resulting state");
  if (observation.outcome === "confirmed" && observation.resultingStateStatus !== "changed") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "A confirmed action must report a changed resulting state.");
  }
  if (observation.outcome === "rejected" && observation.resultingStateStatus !== "unchanged") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "A rejected action must report an unchanged resulting state.");
  }
  const state = step === "post_revocation_action_rejected"
    ? observation.outcome === "rejected" ? "rejected" : "failed"
    : observation.outcome === "confirmed" ? "observed" : "failed";

  return {
    ...evidence,
    status: "in_progress",
    checkpoints: {
      ...evidence.checkpoints,
      [step]: {
        ...emptyCheckpoint(),
        state,
        observedAtUnix: observation.observedAtUnix,
        chainId: observation.chainId,
        observedBlockNumber: stringifyBlock(observation.observedBlockNumber),
        target: normalizeAddress(observation.target),
        selector: normalizeSelector(observation.selector),
        transactionHash: observation.transactionHash === null
          ? null
          : validateHash(observation.transactionHash, "transaction"),
        receiptStatus: observation.receiptStatus,
        resultingStateDigest: observation.resultingStateDigest === null
          ? null
          : validateHash(observation.resultingStateDigest, "resulting state"),
        resultingStateStatus: observation.resultingStateStatus,
        valueWei: observedSpend.valueWei.toString(10),
        spends: observedSpend.spends,
        reasonCode: validateReasonCode(observation.reasonCode),
        revocationReasonCode: null,
      },
    },
  };
}

export function recordRevocationObservation(
  evidence: PhaseZeroEvidence,
  observation: RevocationObservation,
): PhaseZeroEvidence {
  const expected = evidence.expectedAction;
  if (expected === null) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "An expected action must be attached before revocation evidence.",
    );
  }
  validateObservedTime(observation.observedAtUnix);
  if (observation.sessionId !== evidence.session.sessionId) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence session does not match the granted session.");
  }
  if (
    observation.policyDigest === null ||
    evidence.session.policyDigest === null ||
    normalizePolicyDigest(observation.policyDigest, "Revocation policy digest") !==
      normalizePolicyDigest(evidence.session.policyDigest, "Session policy digest")
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence policy digest does not match the granted session.");
  }
  if (observation.chainId !== expected.chainId) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence chain does not match the expected chain.");
  }
  if (observation.outcome !== "confirmed" || observation.sessionStatus !== "revoked") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence must confirm a revoked session.");
  }
  if (observation.receiptStatus !== "confirmed") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation receipt must be confirmed.");
  }
  const revocationReasonCode = validateReasonCode(observation.revocationReasonCode);
  if (revocationReasonCode === null) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence requires a reason code.");
  }
  return {
    ...evidence,
    status: "in_progress",
    checkpoints: {
      ...evidence.checkpoints,
      revocation_confirmed: {
        ...emptyCheckpoint(),
        state: "observed",
        observedAtUnix: observation.observedAtUnix,
        chainId: observation.chainId,
        observedBlockNumber: stringifyBlock(observation.observedBlockNumber),
        transactionHash: observation.transactionHash === null
          ? null
          : validateHash(observation.transactionHash, "revocation transaction"),
        receiptStatus: observation.receiptStatus,
        valueWei: null,
        spends: null,
        reasonCode: validateReasonCode(observation.reasonCode),
        revocationReasonCode,
      },
    },
  };
}

/**
 * Finalization performs the complete-observation check and asks an explicit
 * attestor to issue the evidence level. There is no caller-supplied status or
 * level argument, so an empty report cannot be promoted to passed/testnet.
 */
export function finalizePhaseZeroEvidence(
  evidence: PhaseZeroEvidence,
  attestor: EvidenceAttestor,
): PhaseZeroEvidence {
  if (
    attestor === null ||
    typeof attestor !== "object" ||
    typeof attestor.attest !== "function" ||
    !["simulation", "local-verifier", "authorized-live-adapter"].includes(attestor.kind)
  ) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Evidence must be finalized by a recognized attestor boundary.",
    );
  }
  if (attestor.kind === "authorized-live-adapter" && !isTrustedLiveAttestor(attestor)) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Live evidence requires the module-private reviewed attestor capability.",
    );
  }
  validateCompleteEvidence(evidence, attestor.kind);
  const attestation = attestor.attest(evidence);
  if (attestation === null || typeof attestation !== "object") {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "The attestor did not issue a public attestation.",
    );
  }
  validateAttestation(attestation, attestor.kind, evidence.generatedAtUnix);
  const finalized: PhaseZeroEvidence = {
    ...evidence,
    status: "passed",
    evidenceLevel: attestation.level,
    attestation: {
      level: attestation.level,
      attestor: attestation.attestor,
      attestationId: attestation.attestationId,
      attestedAtUnix: attestation.attestedAtUnix,
    },
  };
  assertEvidenceSafe(finalized);
  return finalized;
}

function isTrustedLiveAttestor(attestor: EvidenceAttestor): boolean {
  return (
    attestor.kind === "authorized-live-adapter" &&
    (attestor as EvidenceAttestor & { readonly [TRUSTED_LIVE_ATTESTOR]?: true })[
      TRUSTED_LIVE_ATTESTOR
    ] === true
  );
}

export function createSimulationAttestor(nowUnix = Math.floor(Date.now() / 1000)): EvidenceAttestor {
  return {
    kind: "simulation",
    attest: () => ({
      level: "simulated",
      attestor: "simulation",
      attestationId: "local-simulation",
      attestedAtUnix: nowUnix,
    }),
  };
}

function validateCompleteEvidence(
  evidence: PhaseZeroEvidence,
  attestorKind: EvidenceAttestation["attestor"],
): void {
  if (
    evidence.status !== "in_progress" ||
    evidence.expectedAction === null ||
    evidence.policy === null
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Phase-zero evidence is incomplete.");
  }
  if (
    evidence.session.sessionId === null ||
    !evidence.session.secretHandoffAccepted ||
    evidence.session.secretDestinationKind === null ||
    !VALID_SECRET_DESTINATIONS.has(evidence.session.secretDestinationKind)
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Phase-zero session handoff evidence is incomplete.");
  }
  const authority = evidence.session.authorityObservation;
  if (authority === null) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Phase-zero evidence is missing a fresh authority observation.");
  }
  validateAuthorityEvidence(authority);
  if (
    authority.status !== "active" ||
    authority.sessionId !== evidence.session.sessionId ||
    authority.policyDigest === null ||
    evidence.session.policyDigest === null ||
    normalizePolicyDigest(authority.policyDigest, "Authority policy digest") !==
      normalizePolicyDigest(evidence.session.policyDigest, "Session policy digest")
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Fresh authority evidence is not bound to the granted session policy.");
  }
  if (evidence.policy.chainId !== evidence.expectedAction.chainId) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Policy and expected action chains do not match.");
  }
  const expected = evidence.expectedAction;
  const expectedSpend = validateExpectedActionEvidence(expected);
  const matchingCall = evidence.policy.calls.find(
    (call) => sameAddress(call.target, expected.target) &&
      call.selectors.some((selector) => sameSelector(selector, expected.selector)),
  );
  if (
    matchingCall === undefined ||
    parseAtomic(matchingCall.maxNativeValueWei, "native-value policy limit") < expectedSpend.valueWei
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Expected action is not covered by the public call policy.");
  }
  validateExpectedSpendCoverage(evidence.policy.spend, expectedSpend.totals);

  const checkpoints = evidence.checkpoints;
  for (const step of PHASE_ZERO_STEPS) {
    validateCheckpoint(checkpoints[step]);
  }
  if (PHASE_ZERO_STEPS.some((step) => checkpoints[step].state === "not_observed" || checkpoints[step].state === "failed")) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Every phase-zero checkpoint must be observed before finalization.");
  }

  for (const step of ["policy_reviewed", "session_granted", "session_handed_off"] as const) {
    if (checkpoints[step].state !== "observed") {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${step} does not contain a completed observation.`);
    }
  }

  const action = checkpoints.permitted_action_confirmed;
  const post = checkpoints.post_revocation_action_rejected;
  const revoke = checkpoints.revocation_confirmed;
  assertChronologicalEvidence(action, revoke, post);
  if (
    action.state !== "observed" ||
    action.chainId !== evidence.expectedAction.chainId ||
    !sameAddress(action.target, evidence.expectedAction.target) ||
    !sameSelector(action.selector, evidence.expectedAction.selector) ||
    action.receiptStatus !== "confirmed" ||
    action.resultingStateStatus !== "changed" ||
    action.resultingStateDigest === null ||
    action.observedAtUnix === null ||
    authority.observedAtUnix > action.observedAtUnix ||
    action.observedAtUnix - authority.observedAtUnix > MAX_AUTHORITY_OBSERVATION_AGE_SECONDS ||
    !checkpointSpendMatches(action, expectedSpend)
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Permitted-action evidence is incomplete or mismatched.");
  }
  if (
    post.state !== "rejected" ||
    post.chainId !== evidence.expectedAction.chainId ||
    !sameAddress(post.target, evidence.expectedAction.target) ||
    !sameSelector(post.selector, evidence.expectedAction.selector) ||
    post.receiptStatus !== "rejected" ||
    post.reasonCode === null ||
    post.resultingStateStatus !== "unchanged" ||
    post.resultingStateDigest === null ||
    post.transactionHash !== null ||
    !checkpointSpendMatches(post, expectedSpend)
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Post-revocation rejection evidence is incomplete or mismatched.");
  }
  if (
    revoke.state !== "observed" ||
    revoke.chainId !== evidence.expectedAction.chainId ||
    revoke.receiptStatus !== "confirmed" ||
    revoke.revocationReasonCode === null
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Revocation evidence is incomplete.");
  }

  if (attestorKind === "authorized-live-adapter") {
    if (
      authority.source === "test" ||
      evidence.session.secretDestinationKind === "local-test-only"
    ) {
      throw new AltanaBoundaryError(
        "INVALID_EVIDENCE_VALUE",
        "Live phase-zero evidence cannot use test authority or a local-only secret destination.",
      );
    }
    if (evidence.environment.network !== "bsc-testnet" || evidence.environment.chainId !== evidence.expectedAction.chainId) {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Live phase-zero evidence must target the locked BSC testnet.");
    }
    if (action.transactionHash === null || revoke.transactionHash === null) {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Live phase-zero evidence requires action and revocation transaction hashes.");
    }
    if (action.observedBlockNumber === null || revoke.observedBlockNumber === null) {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Live phase-zero evidence requires confirmed action and revocation block observations.");
    }
  }
}

function assertChronologicalEvidence(
  action: EvidenceCheckpoint,
  revoke: EvidenceCheckpoint,
  post: EvidenceCheckpoint,
): void {
  if (
    action.observedAtUnix === null ||
    revoke.observedAtUnix === null ||
    post.observedAtUnix === null ||
    action.observedAtUnix > revoke.observedAtUnix ||
    revoke.observedAtUnix > post.observedAtUnix
  ) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Permitted action, revocation, and post-revocation rejection must be chronological.",
    );
  }

  let previousBlock: bigint | null = null;
  for (const block of [action.observedBlockNumber, revoke.observedBlockNumber, post.observedBlockNumber]) {
    if (block === null) continue;
    const currentBlock = BigInt(block);
    if (previousBlock !== null && currentBlock < previousBlock) {
      throw new AltanaBoundaryError(
        "INVALID_EVIDENCE_VALUE",
        "Observed action, revocation, and rejection blocks must be chronological.",
      );
    }
    previousBlock = currentBlock;
  }
}

interface ExpectedSpendTotals {
  readonly valueWei: bigint;
  readonly totals: readonly SpendTotal[];
}

function validateExpectedActionEvidence(expected: ExpectedActionEvidence): ExpectedSpendTotals {
  return normalizePublicSpends(expected.valueWei, expected.spends, "expected action");
}

interface SpendTotal {
  readonly token: `0x${string}` | "native";
  readonly period: "call" | "hour" | "day" | "week" | "lifetime";
  readonly amountAtomic: bigint;
}

interface ObservedSpendTotals extends ExpectedSpendTotals {
  readonly spends: readonly PublicSpendEvidence[];
}

function normalizePublicSpends(
  valueWeiRaw: string,
  spends: readonly PublicSpendEvidence[],
  label: string,
): ExpectedSpendTotals {
  const valueWei = parseAtomic(valueWeiRaw, `${label} native value`);
  if (!Array.isArray(spends)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} spends are missing.`);
  }
  const totals = new Map<string, SpendTotal>();
  let nativeTotal = 0n;
  for (const spend of spends) {
    if (spend === null || typeof spend !== "object" || typeof spend.period !== "string" || !VALID_PERIODS.has(spend.period)) {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} spend period is invalid.`);
    }
    const token = spend.token === "native" ? "native" : normalizeAddress(spend.token);
    const amountAtomic = parseAtomic(spend.amountAtomic, `${label} spend amount`);
    if (token === "native") nativeTotal += amountAtomic;
    const key = `${token}:${spend.period}`;
    const previous = totals.get(key);
    totals.set(key, {
      token,
      period: spend.period,
      amountAtomic: (previous?.amountAtomic ?? 0n) + amountAtomic,
    });
  }
  if (nativeTotal !== valueWei) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} native value does not match its spend evidence.`);
  }
  return { valueWei, totals: [...totals.values()] };
}

function normalizeObservedSpends(
  valueWei: bigint,
  spends: readonly SpendCharge[],
): ObservedSpendTotals {
  if (typeof valueWei !== "bigint" || valueWei < 0n || !Array.isArray(spends)) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Observed action value and spend charges must be explicit non-negative values.",
    );
  }
  const publicSpends: PublicSpendEvidence[] = [];
  let nativeTotal = 0n;
  const totals = new Map<string, SpendTotal>();
  for (const spend of spends) {
    if (
      spend === null ||
      typeof spend !== "object" ||
      typeof spend.amountAtomic !== "bigint" ||
      spend.amountAtomic < 0n ||
      typeof spend.period !== "string" ||
      !VALID_PERIODS.has(spend.period)
    ) {
      throw new AltanaBoundaryError(
        "INVALID_EVIDENCE_VALUE",
        "Observed action spend charges must use non-negative bigint amounts and bounded periods.",
      );
    }
    const token = spend.token === "native" ? "native" : normalizeAddress(spend.token);
    if (token === "native") nativeTotal += spend.amountAtomic;
    publicSpends.push({
      token,
      amountAtomic: spend.amountAtomic.toString(10),
      period: spend.period,
    });
    const key = `${token}:${spend.period}`;
    const previous = totals.get(key);
    totals.set(key, {
      token,
      period: spend.period,
      amountAtomic: (previous?.amountAtomic ?? 0n) + spend.amountAtomic,
    });
  }
  if (nativeTotal !== valueWei) {
    throw new AltanaBoundaryError(
      "INVALID_EVIDENCE_VALUE",
      "Observed action native value does not match its spend charges.",
    );
  }
  return { valueWei, spends: publicSpends, totals: [...totals.values()] };
}

function sameSpendTotals(left: readonly SpendTotal[], right: readonly SpendTotal[]): boolean {
  if (left.length !== right.length) return false;
  const rightByKey = new Map(right.map((entry) => [`${entry.token}:${entry.period}`, entry.amountAtomic]));
  return left.every((entry) => rightByKey.get(`${entry.token}:${entry.period}`) === entry.amountAtomic);
}

function checkpointSpendMatches(
  checkpoint: EvidenceCheckpoint,
  expected: ExpectedSpendTotals,
): boolean {
  if (checkpoint.valueWei === null || checkpoint.spends === null) return false;
  try {
    const actual = normalizePublicSpends(
      checkpoint.valueWei,
      checkpoint.spends,
      "observed action",
    );
    return actual.valueWei === expected.valueWei && sameSpendTotals(actual.totals, expected.totals);
  } catch {
    return false;
  }
}

function validateExpectedSpendCoverage(
  permissions: readonly { token: `0x${string}` | "native"; limitAtomic: string; period: ExpectedActionEvidence["spends"][number]["period"] }[],
  totals: readonly SpendTotal[],
): void {
  for (const total of totals) {
    const permission = permissions.find((candidate) =>
      sameSpendBucket(candidate, total),
    );
    if (permission === undefined || total.amountAtomic > parseAtomic(permission.limitAtomic, "spend policy limit")) {
      throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Expected action spend is not covered by the public spend policy.");
    }
  }
}

function sameSpendBucket(
  left: { readonly token: `0x${string}` | "native"; readonly period: string },
  right: { readonly token: `0x${string}` | "native"; readonly period: string },
): boolean {
  const leftToken = left.token === "native" ? "native" : normalizeAddress(left.token);
  const rightToken = right.token === "native" ? "native" : normalizeAddress(right.token);
  return leftToken === rightToken && left.period === right.period;
}

function parseAtomic(value: string, label: string): bigint {
  if (typeof value !== "string" || !SAFE_ATOMIC.test(value)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} must be a non-negative decimal string.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} is not a valid atomic value.`);
  }
}

function sameAddress(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false;
  try {
    return normalizeAddress(left) === normalizeAddress(right);
  } catch {
    return false;
  }
}

function sameSelector(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false;
  try {
    return normalizeSelector(left) === normalizeSelector(right);
  } catch {
    return false;
  }
}

function validateCheckpoint(checkpoint: EvidenceCheckpoint): void {
  if (checkpoint.state === "not_observed") return;
  if (checkpoint.observedAtUnix === null) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "An observed checkpoint requires an observation time.");
  }
  validateObservedTime(checkpoint.observedAtUnix);
  if (checkpoint.observedBlockNumber !== null && !SAFE_BLOCK.test(checkpoint.observedBlockNumber)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Observed block must be a non-negative decimal string.");
  }
  if (checkpoint.target !== null) normalizeAddress(checkpoint.target);
  if (checkpoint.selector !== null) normalizeSelector(checkpoint.selector);
  if (checkpoint.transactionHash !== null) validateHash(checkpoint.transactionHash, "transaction");
  if (checkpoint.resultingStateDigest !== null) validateHash(checkpoint.resultingStateDigest, "resulting state");
  if ((checkpoint.valueWei === null) !== (checkpoint.spends === null)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Observed action value and spends must be supplied together.");
  }
  if (checkpoint.valueWei !== null && checkpoint.spends !== null) {
    normalizePublicSpends(checkpoint.valueWei, checkpoint.spends, "observed action");
  }
  if (checkpoint.reasonCode !== null) validateReasonCode(checkpoint.reasonCode);
  if (checkpoint.revocationReasonCode !== null) validateReasonCode(checkpoint.revocationReasonCode);
}

function validateAuthorityEvidence(authority: SessionAuthorityEvidence): void {
  if (
    authority === null ||
    typeof authority !== "object" ||
    typeof authority.sessionId !== "string" ||
    !SAFE_ATTESTATION_ID.test(authority.sessionId) ||
    authority.status !== "active" ||
    authority.policyDigest === null ||
    !VALID_SESSION_SOURCES.has(authority.source)
  ) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Fresh active authority evidence is malformed.");
  }
  normalizePolicyDigest(authority.policyDigest, "Authority policy digest");
  validateObservedTime(authority.observedAtUnix);
  if (authority.observedBlockNumber !== null && !SAFE_BLOCK.test(authority.observedBlockNumber)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Authority observation block is invalid.");
  }
  validateReasonCode(authority.reasonCode);
}

function validateAttestation(
  attestation: EvidenceAttestation,
  attestorKind: EvidenceAttestation["attestor"],
  generatedAtUnix: number,
): void {
  if (attestation.attestor !== attestorKind) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Evidence attestor identity does not match its boundary.");
  }
  if (attestorKind === "simulation" && attestation.level !== "simulated") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Simulation attestor cannot issue live evidence.");
  }
  if (attestorKind === "local-verifier" && attestation.level !== "local_test") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Local verifier cannot issue testnet evidence.");
  }
  if (attestorKind === "authorized-live-adapter" && attestation.level !== "testnet") {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Live adapter must issue testnet evidence.");
  }
  if (!SAFE_ATTESTATION_ID.test(attestation.attestationId)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Attestation ID is not a safe public identifier.");
  }
  validateObservedTime(attestation.attestedAtUnix);
  if (attestation.attestedAtUnix < generatedAtUnix) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Attestation cannot predate the evidence report.");
  }
}

function validateObservedTime(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Evidence time must be a positive Unix-second integer.");
  }
}

function validateReasonCode(value: string | null): string | null {
  if (value !== null && !SAFE_REASON.test(value)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Evidence reason codes must be short uppercase identifiers.");
  }
  return value;
}

function validateHash(value: string, label: string): `0x${string}` {
  if (!HASH_32.test(value)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} references must be 32-byte hexadecimal hashes.`);
  }
  return `0x${value.slice(2).toLowerCase()}` as `0x${string}`;
}

function normalizePolicyDigest(value: string, label: string): `0x${string}` {
  if (!HASH_32.test(value)) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", `${label} must be a 32-byte hexadecimal digest.`);
  }
  return `0x${value.slice(2).toLowerCase()}` as `0x${string}`;
}

function stringifyBlock(value: bigint | null): string | null {
  if (value === null) return null;
  if (typeof value !== "bigint" || value < 0n) {
    throw new AltanaBoundaryError("INVALID_EVIDENCE_VALUE", "Observed block must be a non-negative bigint.");
  }
  return value.toString(10);
}

/**
 * Fail closed if JSON assembled by an adapter contains a credential-shaped
 * field. The typed evidence model is the primary allowlist; this is a second
 * boundary before evidence leaves the process.
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
