import { CommerceError } from "./errors.js";
import { createErc8183JobEvent } from "./events.js";
import {
  erc8183JobRecordSchema,
  type Erc8183ActionMetadata,
  type Erc8183ActionType,
  type Erc8183ActorRole,
  type Erc8183JobRecord,
  type Erc8183JobState
} from "./types.js";
import { normalizeAddress, parseAtomic } from "./validation.js";

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
  readonly nextState: Erc8183JobState;
  readonly action: Erc8183ActionType;
  readonly actorAddress: string;
  readonly nowUnix: number;
}): void {
  const { job, nextState, action, actorAddress, nowUnix } = input;
  erc8183JobRecordSchema.parse(job);
  if (action === "reconcile") {
    if (nextState !== job.state) {
      throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: "Reconciliation cannot change the protocol state." });
    }
    return;
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
  readonly nextState: Erc8183JobState;
  readonly action: Erc8183ActionType;
  readonly actorAddress: string;
  readonly idempotencyKey: string;
  readonly nowUnix: number;
  readonly metadata?: Erc8183ActionMetadata;
  readonly correlationId: string;
}): { readonly job: Erc8183JobRecord; readonly event: ReturnType<typeof createErc8183JobEvent> } {
  assertErc8183Transition(input);
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
