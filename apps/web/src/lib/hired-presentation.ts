import { erc8004IdentityKey } from "@bnbera/domain";
import type { BuyerJobSummary } from "./commerce-job-list";
import type { CommerceOperationStatusResponse } from "./commerce-contract";
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
