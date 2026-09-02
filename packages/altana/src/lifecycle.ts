import { AltanaBoundaryError } from "./errors.ts";
import { assertActionWithinPolicy, assertPolicyValidAt } from "./policy.ts";
import type {
  ActionRequest,
  CumulativeSpend,
  RuntimeSessionDescriptor,
  SessionStateObservation,
} from "./types.ts";

export const MAX_AUTHORITY_OBSERVATION_AGE_SECONDS = 60;
const HASH_32 = /^0x[a-fA-F0-9]{64}$/;
const SESSION_SOURCES = new Set<SessionStateObservation["source"]>([
  "altana-sdk",
  "keystore-read",
  "chain-read",
  "test",
]);

export interface ExecutionGate {
  readonly allowed: boolean;
  readonly reasonCode: string | null;
}

/**
 * Local fail-closed gate used immediately before a state-changing call. The
 * caller must refresh the observation from the Altana KeyStore/chain before
 * using this function in production; a cached `active` state is not enough.
 */
export function executionGate(input: {
  readonly descriptor: RuntimeSessionDescriptor;
  readonly observation: SessionStateObservation;
  readonly request: ActionRequest;
  readonly cumulativeSpend: readonly CumulativeSpend[];
  readonly nowUnix: number;
}): ExecutionGate {
  try {
    assertFreshActiveAuthority(input);
    if (input.observation.status !== "active") {
      return {
        allowed: false,
        reasonCode:
          input.observation.status === "revoked"
            ? "AUTHORITY_REVOKED"
            : input.observation.status === "expired"
              ? "AUTHORITY_EXPIRED"
              : "AUTHORITY_UNVERIFIED",
      };
    }
    assertPolicyValidAt(input.descriptor.policy, input.nowUnix);
    assertActionWithinPolicy(
      input.descriptor.policy,
      input.request,
      input.nowUnix,
      input.cumulativeSpend,
    );
    return { allowed: true, reasonCode: null };
  } catch (error) {
    return {
      allowed: false,
      reasonCode: error instanceof AltanaBoundaryError ? error.code : "AUTHORITY_CHECK_FAILED",
    };
  }
}

function assertFreshActiveAuthority(input: Parameters<typeof executionGate>[0]): void {
  const { descriptor, observation, nowUnix } = input;
  if (
    observation === null ||
    typeof observation !== "object" ||
    typeof observation.sessionId !== "string" ||
    !SESSION_SOURCES.has(observation.source)
  ) {
    throw new AltanaBoundaryError(
      "AUTHORITY_READ_REQUIRED",
      "A fresh typed authority read is required before execution.",
    );
  }
  if (observation.sessionId !== descriptor.sessionId) {
    throw new AltanaBoundaryError(
      "SESSION_ID_MISMATCH",
      "The authority observation belongs to a different runtime session.",
    );
  }
  if (
    descriptor.policyDigest === null ||
    observation.policyDigest === null ||
    !HASH_32.test(descriptor.policyDigest) ||
    !HASH_32.test(observation.policyDigest) ||
    descriptor.policyDigest.toLowerCase() !== observation.policyDigest.toLowerCase()
  ) {
    throw new AltanaBoundaryError(
      "POLICY_DIGEST_MISMATCH",
      "The authority observation policy digest does not match the runtime session.",
    );
  }
  if (
    !Number.isSafeInteger(nowUnix) ||
    nowUnix <= 0 ||
    !Number.isSafeInteger(observation.observedAtUnix) ||
    observation.observedAtUnix <= 0 ||
    observation.observedAtUnix > nowUnix ||
    nowUnix - observation.observedAtUnix > MAX_AUTHORITY_OBSERVATION_AGE_SECONDS
  ) {
    throw new AltanaBoundaryError(
      "AUTHORITY_STALE",
      "The authority observation is missing or older than the execution freshness window.",
    );
  }
  if (
    observation.observedBlockNumber !== null &&
    (typeof observation.observedBlockNumber !== "bigint" || observation.observedBlockNumber < 0n)
  ) {
    throw new AltanaBoundaryError(
      "AUTHORITY_READ_REQUIRED",
      "The authority observation block reference is invalid.",
    );
  }
}

export function assertExecutionAllowed(input: Parameters<typeof executionGate>[0]): void {
  const result = executionGate(input);
  if (!result.allowed) {
    throw new AltanaBoundaryError(
      result.reasonCode === "AUTHORITY_EXPIRED" ? "SESSION_NOT_ACTIVE" : "CALL_NOT_ALLOWED",
      "State-changing execution is not allowed by the current scoped authority.",
    );
  }
}
