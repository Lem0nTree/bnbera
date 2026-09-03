import { AppError, type ErrorEnvelope, type Result } from "@bnbera/config";

export type MarketplaceErrorCode =
  | "MARKETPLACE_REQUEST_INVALID"
  | "MARKETPLACE_COMPARE_LIMIT"
  | "MARKETPLACE_AGENT_NOT_FOUND"
  | "MARKETPLACE_SOURCE_INVALID"
  | "MARKETPLACE_SOURCE_UNAVAILABLE";

export function marketplaceError(
  code: MarketplaceErrorCode,
  safeMessage: string,
  requestId: string,
  nextAction: string,
  retriable = false,
  cause?: unknown
): AppError {
  return new AppError({
    code,
    safeMessage,
    requestId,
    nextAction,
    retriable,
    cause
  });
}

export type MarketplaceApiResult<T> = Result<T, ErrorEnvelope>;

export function errorResult<T>(error: unknown, fallback: AppError): MarketplaceApiResult<T> {
  if (error instanceof AppError) {
    return { ok: false, error: error.toEnvelope() };
  }
  return { ok: false, error: fallback.toEnvelope() };
}
