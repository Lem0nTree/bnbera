import type { Erc8004MarketplaceCompositionCandidateResult } from "./composition.js";

export type MarketplaceRetryWriter = {
  recordRetry(identityKey: string, attempt: {
    readonly stage: Erc8004MarketplaceCompositionCandidateResult["status"];
    readonly errorCode: string | null;
    readonly attemptedAt: Date;
  }): Promise<unknown>;
};

export type MarketplaceRetryRecordSummary = {
  readonly recorded: number;
  readonly failures: number;
  readonly failureCodes: readonly string[];
};

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return "MARKETPLACE_RETRY_RECORD_FAILED";
}

/** Persist every candidate's retry outcome without aborting its batch peers. */
export async function recordMarketplaceRetries(
  writer: MarketplaceRetryWriter,
  candidates: readonly Erc8004MarketplaceCompositionCandidateResult[],
  attemptedAt: Date
): Promise<MarketplaceRetryRecordSummary> {
  let recorded = 0;
  let failures = 0;
  const failureCodes = new Set<string>();
  for (const candidate of candidates) {
    try {
      await writer.recordRetry(candidate.identityKey, {
        stage: candidate.status,
        errorCode: candidate.diagnostics[0] ?? null,
        attemptedAt
      });
      recorded += 1;
    } catch (error) {
      failures += 1;
      failureCodes.add(safeErrorCode(error));
    }
  }
  return { recorded, failures, failureCodes: [...failureCodes].sort() };
}
