import { AltanaBoundaryError } from "./errors.ts";
import { assertCallAllowed, assertPolicyValidAt } from "./policy.ts";
import type { ActionRequest, RuntimeSessionDescriptor, SessionStateObservation } from "./types.ts";

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
  readonly nowUnix: number;
}): ExecutionGate {
  try {
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
    assertCallAllowed(input.descriptor.policy, input.request, input.nowUnix);
    return { allowed: true, reasonCode: null };
  } catch (error) {
    return {
      allowed: false,
      reasonCode: error instanceof AltanaBoundaryError ? error.code : "AUTHORITY_CHECK_FAILED",
    };
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

