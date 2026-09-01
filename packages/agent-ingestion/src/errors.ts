import { AppError } from "@bnbera/config";

export type IngestionErrorCode =
  | "INGESTION_INPUT_INVALID"
  | "INGESTION_SOURCE_UNSUPPORTED"
  | "IDENTITY_CONFLICT"
  | "DUPLICATE_CHAIN_LOG_CONFLICT"
  | "CHECKPOINT_CONFLICT"
  | "REORG_RECONCILIATION_REQUIRED"
  | "CLAIM_OWNER_MISMATCH"
  | "CLAIM_PROOF_INVALID"
  | "CLAIM_NOT_ACTIVE"
  | "SERVICE_INVALID"
  | "SERVICE_PROBE_FAILED"
  | "REPOSITORY_FAILURE";

export function ingestionError(
  code: IngestionErrorCode,
  safeMessage: string,
  nextAction: string,
  cause?: unknown,
  retriable = false
): AppError {
  return new AppError({
    code,
    safeMessage,
    requestId: "agent-ingestion",
    nextAction,
    retriable,
    cause
  });
}
