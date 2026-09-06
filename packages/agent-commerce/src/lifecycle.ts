import { CommerceError } from "./errors.js";
import { createErc8183JobEvent } from "./events.js";
import {
  erc8183JobRecordSchema,
  type Erc8183ActionMetadata,
  type Erc8183ActionType,
  type Erc8183ActorRole,
  type Erc8183BuyerApproval,
  type Erc8183JobRecord,
  type Erc8183JobState
} from "./types.js";
import { assertBudgetMatchesPin, assertDeploymentPinSnapshot, assertPinMatchesJob, normalizeAddress, parseAtomic, parseEnabledDeploymentPin } from "./validation.js";

const allowedTransitions: Readonly<Record<Erc8183JobState, readonly Erc8183JobState[]>> = {
  open: ["funded", "rejected"],
  funded: ["submitted", "rejected", "expired"],
  submitted: ["completed", "rejected", "expired"],
  completed: [],
  rejected: [],
  expired: []
};

export function canTransition(from: Erc8183JobState, to: Erc8183JobState): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

function actorMatches(job: Erc8183JobRecord, role: Erc8183ActorRole, actorAddress: string): boolean {
  if (role === "any") return true;
  const actor = normalizeAddress(actorAddress, "actor address");
  if (role === "client") return actor === normalizeAddress(job.terms.clientAddress, "client address");
  if (role === "provider") return job.terms.providerAddress !== null && actor === normalizeAddress(job.terms.providerAddress, "provider address");
  return actor === normalizeAddress(job.terms.evaluatorAddress, "evaluator address");
}

function assertActorForAction(job: Erc8183JobRecord, action: Erc8183ActionType, actorAddress: string, nowUnix: number): void {
  const role: Erc8183ActorRole = action === "fund" || action === "set_provider" || action === "create"
    ? "client"
    : action === "set_budget"
      ? "any"
      : action === "submit"
        ? "provider"
        : action === "complete"
          ? "evaluator"
          : action === "reject"
            ? job.state === "open" ? "client" : "evaluator"
            : action === "claim_refund"
              ? "client"
            : "any";
  if (!actorMatches(job, role, actorAddress)) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: `Actor is not authorized for ERC-8183 action ${action}.` });
  }
  if (action === "set_budget") {
    const actor = normalizeAddress(actorAddress, "actor address");
    const isClient = actor === normalizeAddress(job.terms.clientAddress, "client address");
    const isProvider = job.terms.providerAddress !== null && actor === normalizeAddress(job.terms.providerAddress, "provider address");
    if (!isClient && !isProvider) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only the client or assigned provider may set the job budget." });
    }
  }
  if (action === "claim_refund" && nowUnix < job.terms.expiresAtUnix) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "A refund can be claimed only after the job expiry." });
  }
}

export function assertErc8183Transition(input: {
  readonly job: Erc8183JobRecord;
  readonly deploymentPin: unknown;
  readonly nextState: Erc8183JobState;
  readonly action: Erc8183ActionType;
  readonly actorAddress: string;
  readonly nowUnix: number;
  /** Trusted server-side allow-list of authenticated reconciliation actors. */
  readonly reconcilerAddresses?: readonly string[];
}): void {
  const { job, deploymentPin, nextState, action, actorAddress, nowUnix } = input;
  erc8183JobRecordSchema.parse(job);
  const enabledPin = parseEnabledDeploymentPin(deploymentPin);
  assertDeploymentPinSnapshot(job.deploymentPin, job.deploymentPinDigest, enabledPin);
  assertPinMatchesJob(job.terms, enabledPin);
  assertBudgetMatchesPin(job.terms.budgetAtomic, enabledPin);
  if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "A trusted Unix timestamp is required for an ERC-8183 transition." });
  }
  if (action === "reconcile") {
    if (nextState !== job.state) {
      throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Reconciliation cannot change the protocol state." });
    }
    const actor = normalizeAddress(actorAddress, "reconciler address");
    const trustedReconcilers = input.reconcilerAddresses ?? [];
    if (!trustedReconcilers.some((candidate) => normalizeAddress(candidate, "reconciler address") === actor)) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only an authenticated system or configured reconciler may reconcile an ERC-8183 job." });
    }
    return;
  }
  if ((action === "fund" || action === "submit" || action === "complete" || action === "reject" || action === "set_provider" || action === "set_budget") && nowUnix >= job.terms.expiresAtUnix) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: `ERC-8183 action ${action} is not valid after the active job expiry.` });
  }
  const isOpenMutation = (action === "set_provider" || action === "set_budget") && job.state === "open" && nextState === "open";
  if ((!canTransition(job.state, nextState) || job.state === nextState) && !isOpenMutation) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: `Illegal ERC-8183 transition: ${job.state} -> ${nextState}.` });
  }
  if (action === "fund" && !(job.state === "open" && nextState === "funded")) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Funding is only valid for an open job." });
  }
  if (action === "set_provider" && !isOpenMutation) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "A provider can only be assigned while the job is open." });
  }
  if (action === "set_budget" && !isOpenMutation) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "A budget can only be set while the job is open." });
  }
  if (action === "submit" && !(job.state === "funded" && nextState === "submitted")) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Only a funded job can be submitted." });
  }
  if (action === "complete" && !(job.state === "submitted" && nextState === "completed")) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Only a submitted job can be completed by its evaluator." });
  }
  if (action === "complete") {
    if (job.buyerApproval === null || job.deliverableDigest === null || job.buyerApproval.resultDigest.toLowerCase() !== job.deliverableDigest.toLowerCase()) {
      throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "An authorized buyer approval bound to the submitted result is required before settlement.", nextAction: "approve_result" });
    }
  }
  if (action === "reject" && !((job.state === "open" && nextState === "rejected") || ((job.state === "funded" || job.state === "submitted") && nextState === "rejected"))) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Rejection is not valid from this state." });
  }
  if (action === "claim_refund" && (!(job.state === "funded" || job.state === "submitted") || nextState !== "expired")) {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Refund is only valid for an expired funded or submitted job." });
  }
  assertActorForAction(job, action, actorAddress, nowUnix);
  if (nextState === "expired" && nowUnix < job.terms.expiresAtUnix) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "The job has not reached its expiry." });
  }
  if (nextState === "submitted" && job.terms.providerAddress === null) {
    throw new CommerceError({ code: "INVALID_JOB", message: "A provider must be assigned before submission." });
  }
}

/** Persist explicit buyer approval for exactly the submitted deliverable. */
export function approveErc8183Result(input: {
  readonly job: Erc8183JobRecord;
  readonly actorAddress: string;
  readonly resultDigest: string;
  readonly nowUnix: number;
}): Erc8183JobRecord {
  const job = erc8183JobRecordSchema.parse(input.job);
  const actor = normalizeAddress(input.actorAddress, "buyer address");
  if (job.state !== "submitted") {
    throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Only a submitted job result can be approved." });
  }
  if (actor.toLowerCase() !== normalizeAddress(job.terms.clientAddress, "client address").toLowerCase()) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only the job client may approve the result." });
  }
  if (!/^[0-9a-f]{64}$/iu.test(input.resultDigest)) {
    throw new CommerceError({ code: "INVALID_JOB", message: "The buyer approval must reference a 32-byte result digest." });
  }
  if (job.deliverableDigest === null || job.deliverableDigest.toLowerCase() !== input.resultDigest.toLowerCase()) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Buyer approval must match the submitted deliverable digest." });
  }
  if (!Number.isSafeInteger(input.nowUnix) || input.nowUnix <= 0) {
    throw new CommerceError({ code: "INVALID_EXPIRY", message: "A trusted Unix timestamp is required for buyer approval." });
  }
  const approval: Erc8183BuyerApproval = {
    buyerAddress: actor,
    resultDigest: input.resultDigest.toLowerCase(),
    approvedAtUnix: input.nowUnix
  };
  if (job.buyerApproval !== null) {
    if (job.buyerApproval.buyerAddress.toLowerCase() !== approval.buyerAddress.toLowerCase() || job.buyerApproval.resultDigest.toLowerCase() !== approval.resultDigest) {
      throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "A different buyer approval is already persisted for this result." });
    }
    return job;
  }
  return erc8183JobRecordSchema.parse({ ...job, buyerApproval: approval, updatedAtUnix: input.nowUnix });
}

function eventTypeFor(action: Erc8183ActionType, nextState: Erc8183JobState): "job_created" | "provider_set" | "budget_set" | "job_funded" | "job_submitted" | "job_completed" | "job_rejected" | "job_expired" | "reconciliation_requested" | "reconciliation_succeeded" | "reconciliation_failed" {
  if (action === "set_provider") return "provider_set";
  if (action === "set_budget") return "budget_set";
  if (action === "reconcile") return "reconciliation_requested";
  if (nextState === "funded") return "job_funded";
  if (nextState === "submitted") return "job_submitted";
  if (nextState === "completed") return "job_completed";
  if (nextState === "expired") return "job_expired";
  return "job_rejected";
}

export function transitionErc8183Job(input: {
  readonly job: Erc8183JobRecord;
  readonly deploymentPin: unknown;
  readonly nextState: Erc8183JobState;
  readonly action: Erc8183ActionType;
  readonly actorAddress: string;
  readonly idempotencyKey: string;
  readonly nowUnix: number;
  readonly metadata?: Erc8183ActionMetadata;
  readonly correlationId: string;
  readonly reconcilerAddresses?: readonly string[];
}): { readonly job: Erc8183JobRecord; readonly event: ReturnType<typeof createErc8183JobEvent> } {
  assertErc8183Transition(input);
  const enabledPin = parseEnabledDeploymentPin(input.deploymentPin);
  const metadata = input.metadata ?? {};
  if (metadata.deliverableDigest !== undefined) {
    if (input.nextState !== "submitted") {
      throw new CommerceError({ code: "INVALID_JOB", message: "Deliverable digest is only valid when submitting work." });
    }
  }
  if (metadata.transactionHash !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(metadata.transactionHash)) {
      throw new CommerceError({ code: "INVALID_JOB", message: "Transaction references must be 32-byte hashes." });
    }
  }
  parseAtomic(input.job.terms.budgetAtomic, "Job budget");
  let terms = input.job.terms;
  if (input.action === "set_provider") {
    if (metadata.providerAddress === undefined || metadata.providerAddress === null) {
      throw new CommerceError({ code: "INVALID_JOB", message: "Provider assignment requires a non-zero provider address." });
    }
    terms = { ...terms, providerAddress: normalizeAddress(metadata.providerAddress, "provider address") };
  }
  if (input.action === "set_budget") {
    if (metadata.budgetAtomic === undefined) {
      throw new CommerceError({ code: "INVALID_AMOUNT", message: "Budget update requires an atomic amount." });
    }
    parseAtomic(metadata.budgetAtomic, "Job budget");
    terms = { ...terms, budgetAtomic: metadata.budgetAtomic };
    assertBudgetMatchesPin(terms.budgetAtomic, enabledPin);
  }
  const nextJob: Erc8183JobRecord = {
    ...input.job,
    terms,
    state: input.nextState,
    updatedAtUnix: input.nowUnix,
    deliverableDigest: metadata.deliverableDigest ?? input.job.deliverableDigest,
    fundingTransactionHash: input.nextState === "funded" ? (metadata.transactionHash as `0x${string}` | undefined) ?? input.job.fundingTransactionHash : input.job.fundingTransactionHash,
    submissionTransactionHash: input.nextState === "submitted" ? (metadata.transactionHash as `0x${string}` | undefined) ?? input.job.submissionTransactionHash : input.job.submissionTransactionHash,
    completionTransactionHash: input.nextState === "completed" ? (metadata.transactionHash as `0x${string}` | undefined) ?? input.job.completionTransactionHash : input.job.completionTransactionHash,
    rejectionTransactionHash: input.nextState === "rejected" ? (metadata.transactionHash as `0x${string}` | undefined) ?? input.job.rejectionTransactionHash : input.job.rejectionTransactionHash,
    refundTransactionHash: input.nextState === "expired" ? (metadata.transactionHash as `0x${string}` | undefined) ?? input.job.refundTransactionHash : input.job.refundTransactionHash,
    lastObservedBlock: metadata.blockNumber ?? input.job.lastObservedBlock,
    lastObservedBlockHash: (metadata.blockHash as `0x${string}` | undefined) ?? input.job.lastObservedBlockHash,
    lastObservedAtUnix: input.nowUnix
  };
  const event = createErc8183JobEvent({
    eventKey: `action:${input.idempotencyKey}`,
    jobKey: input.job.jobKey,
    eventType: eventTypeFor(input.action, input.nextState),
    previousState: input.job.state,
    nextState: input.nextState,
    actorAddress: input.actorAddress,
    transactionHash: (metadata.transactionHash as `0x${string}` | undefined) ?? null,
    blockNumber: metadata.blockNumber ?? null,
    blockHash: (metadata.blockHash as `0x${string}` | undefined) ?? null,
    logIndex: metadata.logIndex ?? null,
    payload: metadata.payload ?? {},
    correlationId: input.correlationId,
    observedAtUnix: input.nowUnix
  });
  return { job: erc8183JobRecordSchema.parse(nextJob), event };
}
