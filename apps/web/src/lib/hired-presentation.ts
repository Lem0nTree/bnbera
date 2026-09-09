import { erc8004IdentityKey } from "@bnbera/domain";
import type { BuyerJobSummary } from "./commerce-job-list";
import type { CommerceOperationStatusResponse } from "./commerce-contract";
export function buyerSessionKey(session: { authenticated?: boolean; walletAddress?: string; chainId?: number; expiresAt?: string }, walletAddress: string | undefined, chainId: number | undefined, now = Date.now()): string | null {
  if (!session.authenticated || !walletAddress || !session.walletAddress || session.walletAddress.toLowerCase() !== walletAddress.toLowerCase() || session.chainId !== chainId || !session.expiresAt || Date.parse(session.expiresAt) <= now || !Number.isFinite(Date.parse(session.expiresAt))) return null;
  return `${session.walletAddress.toLowerCase()}:${session.chainId}:${session.expiresAt}`;
}
export function buyerHistoryResponseCurrent(requestGeneration: number, currentGeneration: number, beforeSession: string | null, afterSession: string | null): boolean {
  return requestGeneration === currentGeneration && beforeSession !== null && beforeSession === afterSession;
}
const attention = new Set(["review_quote", "request_fresh_quote", "resume_funding", "resume_wallet_step", "reconcile_transaction", "inspect_failed_transaction", "review_result", "claim_refund", "leave_review"]);
export function hiredJobMatches(job: BuyerJobSummary, filter: string): boolean {
  if (filter === "Needs attention") return attention.has(job.nextAction);
  if (filter === "Completed") return job.lifecycle.canonicalState === "completed";
  if (filter === "In progress") return ["open", "funded", "submitted"].includes(job.lifecycle.canonicalState ?? "");
  return true;
}
export function resumedOperationMatches(body: CommerceOperationStatusResponse, operationId: string, protocolJobId: string | null, identityKey: string): boolean {
  if (body.operation.operationId !== operationId) return false;
  if (protocolJobId !== null && body.job?.job.jobKey.jobId !== protocolJobId) return false;
  const binding = body.job?.job.providerBinding;
  if (body.job !== null && (!binding || erc8004IdentityKey(binding.identity) !== identityKey)) return false;
  return true;
}
