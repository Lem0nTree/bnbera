import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import { transitionErc8183Job } from "./lifecycle.js";
import {
  erc8183DeploymentPinDigest,
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
import { assertBudgetMatchesPin, assertDeploymentPinSnapshot, assertPinMatchesJob, normalizeAddress, normalizeJobKey, normalizeJobTerms, parseEnabledDeploymentPin, validateJobTerms } from "./validation.js";

function keyFor(jobKey: Erc8183JobKey): string {
  return `${jobKey.chainId}:${jobKey.commerceContract.toLowerCase()}:${jobKey.jobId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeReconcilerAddress(value: string): string {
  return normalizeAddress(value, "reconciler address");
}

function creationRequestDigest(job: Erc8183JobRecord): string {
  const { createdAtUnix: _createdAtUnix, updatedAtUnix: _updatedAtUnix, ...request } = job;
  return canonicalSha256Hex({ operation: "create", job: request });
}

export interface Erc8183JobRepository {
  /**
   * State, append-only event, and idempotency record must commit as one unit.
   * A production implementation maps this seam to one database transaction.
   */
  transaction<T>(work: (unit: Erc8183JobUnitOfWork) => Promise<T>): Promise<T>;
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

export interface Erc8183JobUnitOfWork {
  commit(input: {
    readonly actionKey: string;
    readonly actionDigest: string;
    readonly jobKey: string;
    readonly expectedJob: Erc8183JobRecord | null;
    readonly job: Erc8183JobRecord;
    readonly event: Erc8183JobEvent;
    readonly requestDigest?: string;
  }): Promise<void>;
}

export interface Erc8183ReconciliationRepository {
  enqueue(input: Omit<Erc8183Reconciliation, "reconciliationId" | "createdAtUnix" | "updatedAtUnix" | "attemptCount" | "state"> & { readonly nowUnix: number }): Promise<Erc8183Reconciliation>;
  listDue(nowUnix: number): Promise<readonly Erc8183Reconciliation[]>;
  update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly reconcilerAddress: string; readonly lastObservedTransactionHash?: `0x${string}` | null; readonly lastObservedBlock?: string | null; readonly detailDigest?: string | null }): Promise<Erc8183Reconciliation>;
}

interface ActionRecord {
  readonly digest: string;
  readonly requestDigest?: string;
  readonly jobKey: string;
  readonly result: { readonly job: Erc8183JobRecord; readonly event: Erc8183JobEvent };
}

export interface Erc8183RepositoryOptions {
  /** Trusted server/chain clock. Callers cannot provide creation timestamps. */
  readonly nowUnix?: () => number;
  /** Authenticated system/reconciler addresses trusted by the repository. */
  readonly reconcilerAddresses?: readonly string[];
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
  private readonly deploymentPin: ReturnType<typeof parseEnabledDeploymentPin>;
  private readonly nowUnix: () => number;
  private readonly reconcilerAddresses: readonly string[];
  private readonly jobs = new Map<string, Erc8183JobRecord>();
  private readonly events = new Map<string, Erc8183JobEvent>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly reconciliations = new Map<string, Erc8183Reconciliation>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(deploymentPin: unknown, options: Erc8183RepositoryOptions = {}) {
    this.deploymentPin = parseEnabledDeploymentPin(deploymentPin);
    this.nowUnix = options.nowUnix ?? (() => Math.floor(Date.now() / 1_000));
    this.reconcilerAddresses = Object.freeze((options.reconcilerAddresses ?? []).map((address) => normalizeReconcilerAddress(address)));
  }

  private trustedNowUnix(): number {
    const nowUnix = this.nowUnix();
    if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0) {
      throw new CommerceError({ code: "INVALID_EXPIRY", message: "The repository trusted clock returned an invalid Unix timestamp." });
    }
    return nowUnix;
  }

  async transaction<T>(work: (unit: Erc8183JobUnitOfWork) => Promise<T>): Promise<T> {
    let release!: () => void;
    const predecessor = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    try {
      const jobs = new Map([...this.jobs.entries()].map(([key, value]) => [key, clone(value)] as const));
      const events = new Map([...this.events.entries()].map(([key, value]) => [key, clone(value)] as const));
      const actions = new Map([...this.actions.entries()].map(([key, value]) => [key, clone(value)] as const));
      const reconciliations = new Map([...this.reconciliations.entries()].map(([key, value]) => [key, clone(value)] as const));
      const unit: Erc8183JobUnitOfWork = {
        commit: async (input) => {
          const action = idempotencyKeySchema.parse(input.actionKey);
          const persistedJob = erc8183JobRecordSchema.parse(input.job);
          assertDeploymentPinSnapshot(persistedJob.deploymentPin, persistedJob.deploymentPinDigest, this.deploymentPin);
          assertPinMatchesJob(persistedJob.terms, this.deploymentPin);
          assertBudgetMatchesPin(persistedJob.terms.budgetAtomic, this.deploymentPin);
          validateJobTerms(persistedJob.terms, this.deploymentPin, this.trustedNowUnix());
          erc8183JobEventSchema.parse(input.event);
          if (keyFor(input.job.jobKey) !== input.jobKey || keyFor(input.event.jobKey) !== input.jobKey || input.event.eventKey !== `action:${action}`) {
            throw new CommerceError({ code: "EVENT_CONFLICT", message: "The atomic job event is not bound to the committed job action." });
          }
          const expectedKey = input.expectedJob === null ? null : keyFor(input.expectedJob.jobKey);
          if (expectedKey !== null && expectedKey !== input.jobKey) {
            throw new CommerceError({ code: "STALE_JOB", message: "The atomic job transition expected a different job identity.", retriable: true, nextAction: "reconcile_job" });
          }
          const current = this.jobs.get(input.jobKey);
          if (input.expectedJob === null) {
            if (current !== undefined) {
              throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "An ERC-8183 job already exists for this chain, contract, and job ID." });
            }
          } else if (current === undefined || canonicalSha256Hex(current) !== canonicalSha256Hex(input.expectedJob)) {
            throw new CommerceError({ code: "STALE_JOB", message: "The ERC-8183 job changed before the atomic transition committed.", retriable: true, nextAction: "reconcile_job" });
          }
          const previous = this.events.get(input.event.eventKey);
          if (previous !== undefined && !sameEvent(previous, input.event)) {
            throw new CommerceError({ code: "EVENT_CONFLICT", message: "An event key was reused with different event contents." });
          }
          const priorAction = this.actions.get(action);
          if (priorAction !== undefined && (priorAction.digest !== input.actionDigest || priorAction.jobKey !== input.jobKey || (input.requestDigest !== undefined && priorAction.requestDigest !== input.requestDigest))) {
            throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for another commerce operation." });
          }
          if (previous !== undefined || priorAction !== undefined) {
            throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The atomic commerce action was concurrently committed." });
          }
          this.jobs.set(input.jobKey, clone(input.job));
          this.events.set(input.event.eventKey, clone(input.event));
          this.actions.set(action, {
            digest: input.actionDigest,
            ...(input.requestDigest === undefined ? {} : { requestDigest: input.requestDigest }),
            jobKey: input.jobKey,
            result: { job: clone(input.job), event: clone(input.event) }
          });
        }
      };
      try {
        return await work(unit);
      } catch (cause) {
        this.jobs.clear();
        for (const [key, value] of jobs) this.jobs.set(key, value);
        this.events.clear();
        for (const [key, value] of events) this.events.set(key, value);
        this.actions.clear();
        for (const [key, value] of actions) this.actions.set(key, value);
        this.reconciliations.clear();
        for (const [key, value] of reconciliations) this.reconciliations.set(key, value);
        throw cause;
      }
    } finally {
      release();
    }
  }

  async get(jobKey: Erc8183JobKey): Promise<Erc8183JobRecord | null> {
    const job = this.jobs.get(keyFor(jobKey));
    return job === undefined ? null : clone(job);
  }

  async create(input: { readonly job: Erc8183JobRecord; readonly idempotencyKey: string }): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const parsedJob = erc8183JobRecordSchema.parse(input.job);
    assertDeploymentPinSnapshot(parsedJob.deploymentPin, parsedJob.deploymentPinDigest, this.deploymentPin);
    const normalizedInput = erc8183JobRecordSchema.parse({
      ...parsedJob,
      jobKey: normalizeJobKey(parsedJob.jobKey),
      terms: normalizeJobTerms(parsedJob.terms, this.deploymentPin),
      deploymentPin: this.deploymentPin,
      deploymentPinDigest: erc8183DeploymentPinDigest(this.deploymentPin)
    });
    if (normalizedInput.state !== "open") {
      throw new CommerceError({ code: "INVALID_JOB", message: "A new ERC-8183 job must begin in the open state." });
    }
    const jobKey = keyFor(normalizedInput.jobKey);
    const requestDigest = creationRequestDigest(normalizedInput);
    const previous = this.actions.get(key);
    if (previous !== undefined) {
      if ((previous.requestDigest ?? previous.digest) !== requestDigest || previous.jobKey !== jobKey) {
        throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for another commerce operation." });
      }
      return { job: clone(previous.result.job), replayed: true };
    }
    const createdAtUnix = this.trustedNowUnix();
    const job = erc8183JobRecordSchema.parse({
      ...normalizedInput,
      terms: validateJobTerms(normalizedInput.terms, this.deploymentPin, createdAtUnix),
      createdAtUnix,
      updatedAtUnix: createdAtUnix
    });
    // Server-generated timestamps are not part of the idempotency identity.
    const digest = requestDigest;
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
    await this.transaction(async (unit) => unit.commit({
      actionKey: key,
      actionDigest: digest,
      requestDigest,
      jobKey,
      expectedJob: null,
      job,
      event
    }));
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
    const normalizedJobKey = normalizeJobKey(input.jobKey);
    const jobKey = keyFor(normalizedJobKey);
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
    const trustedNowUnix = this.trustedNowUnix();
    const result = transitionErc8183Job({ ...input, job: existing, deploymentPin: this.deploymentPin, nowUnix: trustedNowUnix, reconcilerAddresses: this.reconcilerAddresses });
    await this.transaction(async (unit) => unit.commit({
      actionKey: key,
      actionDigest: digest,
      jobKey,
      expectedJob: existing,
      job: result.job,
      event: result.event
    }));
    const saved = { job: clone(result.job), event: clone(result.event) };
    return { ...saved, replayed: false };
  }

  async appendEvent(event: Erc8183JobEvent): Promise<{ readonly event: Erc8183JobEvent; readonly replayed: boolean }> {
    const parsed = erc8183JobEventSchema.parse(event);
    if (!this.jobs.has(keyFor(parsed.jobKey))) {
      throw new CommerceError({ code: "UNKNOWN_JOB", message: "The ERC-8183 event references an unknown job." });
    }
    if (!parsed.eventKey.startsWith("action:")) {
      throw new CommerceError({ code: "EVENT_CONFLICT", message: "Event key entries can only be appended through a validated atomic action." });
    }
    const actionResult = idempotencyKeySchema.safeParse(parsed.eventKey.slice("action:".length));
    if (!actionResult.success) {
      throw new CommerceError({ code: "EVENT_CONFLICT", message: "The event key action is invalid or was not validated by this repository." });
    }
    const priorAction = this.actions.get(actionResult.data);
    const jobKey = keyFor(parsed.jobKey);
    if (priorAction === undefined || priorAction.jobKey !== jobKey || !sameEvent(priorAction.result.event, parsed)) {
      throw new CommerceError({ code: "EVENT_CONFLICT", message: "An event key can only be replayed after its validated state, actor, chain, and action transaction committed." });
    }
    const previous = this.events.get(parsed.eventKey);
    if (previous === undefined || !sameEvent(previous, parsed)) {
      throw new CommerceError({ code: "EVENT_CONFLICT", message: "The validated action event is missing or has conflicting contents." });
    }
    return { event: clone(previous), replayed: true };
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

  async update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly reconcilerAddress: string; readonly lastObservedTransactionHash?: `0x${string}` | null; readonly lastObservedBlock?: string | null; readonly detailDigest?: string | null }): Promise<Erc8183Reconciliation> {
    this.assertReconciler(input.reconcilerAddress);
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

  private assertReconciler(address: string): void {
    const normalized = normalizeReconcilerAddress(address);
    if (!this.reconcilerAddresses.includes(normalized)) {
      throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only an authenticated configured reconciler may update ERC-8183 reconciliation state." });
    }
  }
}

function sameEvent(left: Erc8183JobEvent, right: Erc8183JobEvent): boolean {
  return left.eventId === right.eventId &&
    left.eventKey === right.eventKey &&
    left.jobKey.chainId === right.jobKey.chainId &&
    left.jobKey.commerceContract.toLowerCase() === right.jobKey.commerceContract.toLowerCase() &&
    left.jobKey.jobId === right.jobKey.jobId &&
    left.eventType === right.eventType &&
    left.previousState === right.previousState &&
    left.payloadDigest === right.payloadDigest &&
    left.nextState === right.nextState &&
    left.actorAddress?.toLowerCase() === right.actorAddress?.toLowerCase() &&
    left.transactionHash === right.transactionHash &&
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.logIndex === right.logIndex &&
    left.confirmationState === right.confirmationState &&
    left.correlationId === right.correlationId &&
    left.observedAtUnix === right.observedAtUnix &&
    canonicalSha256Hex(left.payload) === canonicalSha256Hex(right.payload);
}
