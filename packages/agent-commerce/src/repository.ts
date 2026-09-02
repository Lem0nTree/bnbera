import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import { transitionErc8183Job } from "./lifecycle.js";
import {
  erc8183JobRecordSchema,
  erc8183JobEventSchema,
  erc8183ReconciliationSchema,
  idempotencyKeySchema,
  type Erc8183ActionMetadata,
  type Erc8183ActionType,
  type Erc8183JobEvent,
  type Erc8183JobKey,
  type Erc8183JobRecord,
  type Erc8183JobState,
  type Erc8183Reconciliation,
  type ReconciliationState
} from "./types.js";

function keyFor(jobKey: Erc8183JobKey): string {
  return `${jobKey.chainId}:${jobKey.commerceContract.toLowerCase()}:${jobKey.jobId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface Erc8183JobRepository {
  get(jobKey: Erc8183JobKey): Promise<Erc8183JobRecord | null>;
  create(input: { readonly job: Erc8183JobRecord; readonly idempotencyKey: string }): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }>;
  transition(input: {
    readonly jobKey: Erc8183JobKey;
    readonly expectedState: Erc8183JobState;
    readonly nextState: Erc8183JobState;
    readonly action: Erc8183ActionType;
    readonly actorAddress: string;
    readonly idempotencyKey: string;
    readonly nowUnix: number;
    readonly metadata?: Erc8183ActionMetadata;
    readonly correlationId: string;
  }): Promise<{ readonly job: Erc8183JobRecord; readonly event: Erc8183JobEvent; readonly replayed: boolean }>;
  appendEvent(event: Erc8183JobEvent): Promise<{ readonly event: Erc8183JobEvent; readonly replayed: boolean }>;
}

export interface Erc8183ReconciliationRepository {
  enqueue(input: Omit<Erc8183Reconciliation, "reconciliationId" | "createdAtUnix" | "updatedAtUnix" | "attemptCount" | "state"> & { readonly nowUnix: number }): Promise<Erc8183Reconciliation>;
  listDue(nowUnix: number): Promise<readonly Erc8183Reconciliation[]>;
  update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly lastObservedTransactionHash?: `0x${string}` | null; readonly lastObservedBlock?: string | null; readonly detailDigest?: string | null }): Promise<Erc8183Reconciliation>;
}

interface ActionRecord {
  readonly digest: string;
  readonly jobKey: string;
  readonly result: { readonly job: Erc8183JobRecord; readonly event: Erc8183JobEvent };
}

const allowedReconciliationTransitions: Readonly<Record<ReconciliationState, readonly ReconciliationState[]>> = {
  pending: ["in_progress", "reconciled", "failed", "manual_review"],
  in_progress: ["reconciled", "failed", "manual_review"],
  reconciled: [],
  failed: ["in_progress", "manual_review"],
  manual_review: []
};

/**
 * Deterministic repository used by unit/integration tests and as a contract
 * for the production Drizzle adapter. Maps are process-local by design; a
 * production implementation must provide the same uniqueness atomically in
 * PostgreSQL.
 */
export class InMemoryErc8183Repository implements Erc8183JobRepository, Erc8183ReconciliationRepository {
  private readonly jobs = new Map<string, Erc8183JobRecord>();
  private readonly events = new Map<string, Erc8183JobEvent>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly reconciliations = new Map<string, Erc8183Reconciliation>();

  async get(jobKey: Erc8183JobKey): Promise<Erc8183JobRecord | null> {
    const job = this.jobs.get(keyFor(jobKey));
    return job === undefined ? null : clone(job);
  }

  async create(input: { readonly job: Erc8183JobRecord; readonly idempotencyKey: string }): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const job = erc8183JobRecordSchema.parse(input.job);
    if (job.state !== "open") {
      throw new CommerceError({ code: "INVALID_JOB", message: "A new ERC-8183 job must begin in the open state." });
    }
    const jobKey = keyFor(job.jobKey);
    const digest = canonicalSha256Hex({ operation: "create", job });
    const previous = this.actions.get(key);
    if (previous !== undefined) {
      if (previous.digest !== digest || previous.jobKey !== jobKey) {
        throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for another commerce operation." });
      }
      return { job: clone(previous.result.job), replayed: true };
    }
    const existing = this.jobs.get(jobKey);
    if (existing !== undefined) {
      throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "An ERC-8183 job already exists for this chain, contract, and job ID." });
    }
    const event = erc8183JobEventSchema.parse({
      eventId: randomUUID(),
      eventKey: `action:${key}`,
      jobKey: job.jobKey,
      eventType: "job_created",
      previousState: null,
      nextState: "open",
      actorAddress: job.terms.clientAddress,
      transactionHash: null,
      blockNumber: null,
      blockHash: null,
      logIndex: null,
      confirmationState: "canonical",
      payloadDigest: canonicalSha256Hex({}),
      payload: {},
      correlationId: key,
      observedAtUnix: job.createdAtUnix
    });
    this.jobs.set(jobKey, clone(job));
    this.events.set(event.eventKey, clone(event));
    this.actions.set(key, { digest, jobKey, result: { job: clone(job), event: clone(event) } });
    return { job: clone(job), replayed: false };
  }

  async transition(input: {
    readonly jobKey: Erc8183JobKey;
    readonly expectedState: Erc8183JobState;
    readonly nextState: Erc8183JobState;
    readonly action: Erc8183ActionType;
    readonly actorAddress: string;
    readonly idempotencyKey: string;
    readonly nowUnix: number;
    readonly metadata?: Erc8183ActionMetadata;
    readonly correlationId: string;
  }): Promise<{ readonly job: Erc8183JobRecord; readonly event: Erc8183JobEvent; readonly replayed: boolean }> {
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const jobKey = keyFor(input.jobKey);
    const digest = canonicalSha256Hex({
      operation: "transition",
      jobKey,
      expectedState: input.expectedState,
      nextState: input.nextState,
      action: input.action,
      actorAddress: input.actorAddress,
      metadata: input.metadata ?? {}
    });
    const previous = this.actions.get(key);
    if (previous !== undefined) {
      if (previous.digest !== digest || previous.jobKey !== jobKey) {
        throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for another commerce operation." });
      }
      return { ...clone(previous.result), replayed: true };
    }
    const existing = this.jobs.get(jobKey);
    if (existing === undefined) {
      throw new CommerceError({ code: "UNKNOWN_JOB", message: "The ERC-8183 job was not found." });
    }
    if (existing.state !== input.expectedState) {
      throw new CommerceError({ code: "STALE_JOB", message: `Expected job state ${input.expectedState}, observed ${existing.state}.`, retriable: true, nextAction: "reconcile_job" });
    }
    const result = transitionErc8183Job({ ...input, job: existing });
    this.jobs.set(jobKey, clone(result.job));
    const appended = await this.appendEvent(result.event);
    const saved = { job: clone(result.job), event: clone(appended.event) };
    this.actions.set(key, { digest, jobKey, result: saved });
    return { ...saved, replayed: false };
  }

  async appendEvent(event: Erc8183JobEvent): Promise<{ readonly event: Erc8183JobEvent; readonly replayed: boolean }> {
    const parsed = erc8183JobEventSchema.parse(event);
    const previous = this.events.get(parsed.eventKey);
    if (previous !== undefined) {
      if (
        previous.jobKey.chainId !== parsed.jobKey.chainId ||
        previous.jobKey.commerceContract !== parsed.jobKey.commerceContract ||
        previous.jobKey.jobId !== parsed.jobKey.jobId ||
        previous.eventType !== parsed.eventType ||
        previous.previousState !== parsed.previousState ||
        previous.payloadDigest !== parsed.payloadDigest ||
        previous.nextState !== parsed.nextState ||
        previous.transactionHash !== parsed.transactionHash
      ) {
        throw new CommerceError({ code: "EVENT_CONFLICT", message: "An event key was reused with different event contents." });
      }
      return { event: clone(previous), replayed: true };
    }
    this.events.set(parsed.eventKey, clone(parsed));
    return { event: clone(parsed), replayed: false };
  }

  async enqueue(input: Omit<Erc8183Reconciliation, "reconciliationId" | "createdAtUnix" | "updatedAtUnix" | "attemptCount" | "state"> & { readonly nowUnix: number }): Promise<Erc8183Reconciliation> {
    const identity = `${keyFor(input.jobKey)}:${input.reasonCode}`;
    const existing = this.reconciliations.get(identity);
    if (existing !== undefined) return clone(existing);
    const record: Erc8183Reconciliation = {
      reconciliationId: randomUUID(),
      jobKey: input.jobKey,
      state: "pending",
      reasonCode: input.reasonCode,
      attemptCount: 0,
      nextAttemptAtUnix: input.nextAttemptAtUnix,
      lastObservedTransactionHash: input.lastObservedTransactionHash,
      lastObservedBlock: input.lastObservedBlock,
      detailDigest: input.detailDigest,
      createdAtUnix: input.nowUnix,
      updatedAtUnix: input.nowUnix
    };
    const parsed = erc8183ReconciliationSchema.parse(record);
    this.reconciliations.set(identity, clone(parsed));
    return clone(parsed);
  }

  async listDue(nowUnix: number): Promise<readonly Erc8183Reconciliation[]> {
    return [...this.reconciliations.values()]
      .filter((entry) => (entry.state === "pending" || entry.state === "failed") && (entry.nextAttemptAtUnix === null || entry.nextAttemptAtUnix <= nowUnix))
      .map(clone);
  }

  async update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly lastObservedTransactionHash?: `0x${string}` | null; readonly lastObservedBlock?: string | null; readonly detailDigest?: string | null }): Promise<Erc8183Reconciliation> {
    const entry = [...this.reconciliations.values()].find((candidate) => candidate.reconciliationId === input.reconciliationId);
    if (entry === undefined) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The reconciliation record was not found." });
    if (entry.state !== input.state && !allowedReconciliationTransitions[entry.state].includes(input.state)) {
      throw new CommerceError({ code: "ILLEGAL_TRANSITION", message: `Illegal reconciliation transition: ${entry.state} -> ${input.state}.` });
    }
    const next: Erc8183Reconciliation = {
      ...entry,
      state: input.state,
      attemptCount: entry.attemptCount + 1,
      nextAttemptAtUnix: input.nextAttemptAtUnix,
      lastObservedTransactionHash: input.lastObservedTransactionHash === undefined ? entry.lastObservedTransactionHash : input.lastObservedTransactionHash,
      lastObservedBlock: input.lastObservedBlock === undefined ? entry.lastObservedBlock : input.lastObservedBlock,
      detailDigest: input.detailDigest === undefined ? entry.detailDigest : input.detailDigest,
      updatedAtUnix: input.nowUnix
    };
    const parsed = erc8183ReconciliationSchema.parse(next);
    const identity = `${keyFor(entry.jobKey)}:${entry.reasonCode}`;
    this.reconciliations.set(identity, clone(parsed));
    return clone(parsed);
  }
}
