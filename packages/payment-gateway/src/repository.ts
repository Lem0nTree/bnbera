import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { PaymentError } from "./errors.js";
import { transitionPaymentAttempt, type PaymentTransitionMetadata } from "./lifecycle.js";
import {
  challengeUnsignedDigest,
  idempotencyKeySchema,
  paymentAttemptSchema,
  paymentChallengeSchema,
  paymentEventSchema,
  paymentReceiptSchema,
  paymentReconciliationSchema,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentChallenge,
  type PaymentEvent,
  type PaymentReceipt,
  type PaymentReconciliation,
  type ReconciliationState
} from "./types.js";
import { parseEnabledSellerConfiguration, receiptDigest, validatePaymentPinAgainstSellerConfiguration, validateReceipt } from "./validation.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertChallengeDigest(challenge: PaymentChallenge): void {
  const { challengeDigest, ...unsignedChallenge } = challenge;
  if (challengeUnsignedDigest(unsignedChallenge) !== challengeDigest) {
    throw new PaymentError({ code: "CHALLENGE_TAMPERED", message: "The persisted payment challenge digest does not match its terms." });
  }
}

export interface PaymentReceiptRepository {
  getReceiptByAttempt(attemptId: string): Promise<PaymentReceipt | null>;
  saveReceipt(receipt: PaymentReceipt): Promise<{ readonly receipt: PaymentReceipt; readonly replayed: boolean }>;
}

export interface PaymentChallengeRepository {
  getChallenge(challengeId: string): Promise<PaymentChallenge | null>;
  saveChallenge(challenge: PaymentChallenge): Promise<{ readonly challenge: PaymentChallenge; readonly replayed: boolean }>;
}

/** Settlement observations use the same receipt shape, but have a
 * separate repository seam so an adapter cannot accidentally conflate an
 * HTTP response with chain/facilitator settlement truth. */
export interface PaymentSettlementRepository {
  getSettlementByAttempt(attemptId: string): Promise<PaymentReceipt | null>;
  recordSettlement(receipt: PaymentReceipt): Promise<{ readonly receipt: PaymentReceipt; readonly replayed: boolean }>;
}

export interface PaymentAttemptRepository extends PaymentChallengeRepository, PaymentReceiptRepository, PaymentSettlementRepository {
  /** State, event, challenge linkage, and idempotency commit atomically. */
  transaction<T>(work: (unit: PaymentAttemptUnitOfWork) => Promise<T>): Promise<T>;
  get(attemptId: string): Promise<PaymentAttempt | null>;
  create(input: { readonly attempt: PaymentAttempt }): Promise<{ readonly attempt: PaymentAttempt; readonly replayed: boolean }>;
  transition(input: {
    readonly attemptId: string;
    readonly expectedStatus: PaymentAttemptStatus;
    readonly nextStatus: PaymentAttemptStatus;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly nowUnix: number;
    readonly metadata?: PaymentTransitionMetadata;
  }): Promise<{ readonly attempt: PaymentAttempt; readonly event: PaymentEvent; readonly replayed: boolean }>;
  appendEvent(event: PaymentEvent): Promise<{ readonly event: PaymentEvent; readonly replayed: boolean }>;
}

export interface PaymentAttemptUnitOfWork {
  commit(input: {
    readonly actionKey: string;
    readonly actionDigest: string;
    readonly expectedAttempt: PaymentAttempt | null;
    readonly attempt: PaymentAttempt;
    readonly event: PaymentEvent;
    readonly challenge?: PaymentChallenge;
  }): Promise<void>;
}

export interface PaymentReconciliationRepository {
  enqueue(input: Omit<PaymentReconciliation, "reconciliationId" | "createdAtUnix" | "updatedAtUnix" | "attemptCount" | "state"> & { readonly nowUnix: number }): Promise<PaymentReconciliation>;
  listDue(nowUnix: number): Promise<readonly PaymentReconciliation[]>;
  update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly observedPaymentTransactionHash?: `0x${string}` | null; readonly observedSettlementTransactionHash?: `0x${string}` | null; readonly detailDigest?: string | null }): Promise<PaymentReconciliation>;
}

interface ActionRecord {
  readonly digest: string;
  readonly attemptId: string;
  readonly result: { readonly attempt: PaymentAttempt; readonly event: PaymentEvent };
}

const allowedReconciliationTransitions: Readonly<Record<ReconciliationState, readonly ReconciliationState[]>> = {
  pending: ["in_progress", "reconciled", "failed", "manual_review"],
  in_progress: ["reconciled", "failed", "manual_review"],
  reconciled: [],
  failed: ["in_progress", "manual_review"],
  manual_review: []
};

/**
 * Process-local reference implementation. Production adapters must move the
 * uniqueness and state checks into one PostgreSQL transaction and preserve
 * these same append-only/idempotency semantics across workers.
 */
export class InMemoryPaymentRepository implements PaymentAttemptRepository, PaymentReconciliationRepository {
  private readonly sellerConfiguration: ReturnType<typeof parseEnabledSellerConfiguration>;
  private readonly attempts = new Map<string, PaymentAttempt>();
  private readonly challenges = new Map<string, PaymentChallenge>();
  private readonly challengeDigests = new Map<string, string>();
  private readonly events = new Map<string, PaymentEvent>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly receipts = new Map<string, PaymentReceipt>();
  private readonly receiptIds = new Map<string, string>();
  private readonly receiptDigests = new Map<string, string>();
  private readonly reconciliations = new Map<string, PaymentReconciliation>();

  constructor(sellerConfiguration: unknown) {
    this.sellerConfiguration = parseEnabledSellerConfiguration(sellerConfiguration);
  }

  async transaction<T>(work: (unit: PaymentAttemptUnitOfWork) => Promise<T>): Promise<T> {
    const attempts = new Map([...this.attempts.entries()].map(([key, value]) => [key, clone(value)] as const));
    const challenges = new Map([...this.challenges.entries()].map(([key, value]) => [key, clone(value)] as const));
    const challengeDigests = new Map(this.challengeDigests);
    const events = new Map([...this.events.entries()].map(([key, value]) => [key, clone(value)] as const));
    const actions = new Map([...this.actions.entries()].map(([key, value]) => [key, clone(value)] as const));
    const receipts = new Map([...this.receipts.entries()].map(([key, value]) => [key, clone(value)] as const));
    const receiptIds = new Map(this.receiptIds);
    const receiptDigests = new Map(this.receiptDigests);
    const reconciliations = new Map([...this.reconciliations.entries()].map(([key, value]) => [key, clone(value)] as const));
    const unit: PaymentAttemptUnitOfWork = {
      commit: async (input) => {
        const action = idempotencyKeySchema.parse(input.actionKey);
        paymentAttemptSchema.parse(input.attempt);
        paymentEventSchema.parse(input.event);
        if (input.event.attemptId !== input.attempt.attemptId || input.event.eventKey !== `action:${action}`) {
          throw new PaymentError({ code: "EVENT_CONFLICT", message: "The atomic payment event is not bound to the committed attempt action." });
        }
        if (input.challenge !== undefined && input.challenge.challengeId !== input.attempt.challenge.challengeId) {
          throw new PaymentError({ code: "EVENT_CONFLICT", message: "The atomic payment challenge is not bound to the committed attempt." });
        }
        const current = this.attempts.get(input.attempt.attemptId);
        if (input.expectedAttempt === null) {
          if (current !== undefined) {
            throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A payment attempt already exists with this identifier." });
          }
        } else if (current === undefined || canonicalSha256Hex(current) !== canonicalSha256Hex(input.expectedAttempt)) {
          throw new PaymentError({ code: "STALE_ATTEMPT", message: "The payment attempt changed before the atomic transition committed.", retriable: true, nextAction: "reconcile_payment" });
        }
        const previous = this.events.get(input.event.eventKey);
        if (previous !== undefined && !sameEvent(previous, input.event)) {
          throw new PaymentError({ code: "EVENT_CONFLICT", message: "A payment event key was reused with different contents." });
        }
        const priorAction = this.actions.get(action);
        if (priorAction !== undefined && (priorAction.digest !== input.actionDigest || priorAction.attemptId !== input.attempt.attemptId)) {
          throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "The payment idempotency key was reused with different terms." });
        }
        if (previous !== undefined || priorAction !== undefined) {
          throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "The atomic payment action was concurrently committed." });
        }
        if (input.challenge !== undefined) {
          const challenge = this.challenges.get(input.challenge.challengeId);
          if (challenge !== undefined && challenge.challengeDigest !== input.challenge.challengeDigest) {
            throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A challenge identifier was reused with different terms." });
          }
          const digestOwner = this.challengeDigests.get(input.challenge.challengeDigest);
          if (digestOwner !== undefined && digestOwner !== input.challenge.challengeId) {
            throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A challenge digest was already recorded under another identifier." });
          }
          this.challenges.set(input.challenge.challengeId, clone(input.challenge));
          this.challengeDigests.set(input.challenge.challengeDigest, input.challenge.challengeId);
        }
        this.attempts.set(input.attempt.attemptId, clone(input.attempt));
        this.events.set(input.event.eventKey, clone(input.event));
        this.actions.set(action, { digest: input.actionDigest, attemptId: input.attempt.attemptId, result: { attempt: clone(input.attempt), event: clone(input.event) } });
      }
    };
    try {
      return await work(unit);
    } catch (cause) {
      this.attempts.clear();
      for (const [key, value] of attempts) this.attempts.set(key, value);
      this.challenges.clear();
      for (const [key, value] of challenges) this.challenges.set(key, value);
      this.challengeDigests.clear();
      for (const [key, value] of challengeDigests) this.challengeDigests.set(key, value);
      this.events.clear();
      for (const [key, value] of events) this.events.set(key, value);
      this.actions.clear();
      for (const [key, value] of actions) this.actions.set(key, value);
      this.receipts.clear();
      for (const [key, value] of receipts) this.receipts.set(key, value);
      this.receiptIds.clear();
      for (const [key, value] of receiptIds) this.receiptIds.set(key, value);
      this.receiptDigests.clear();
      for (const [key, value] of receiptDigests) this.receiptDigests.set(key, value);
      this.reconciliations.clear();
      for (const [key, value] of reconciliations) this.reconciliations.set(key, value);
      throw cause;
    }
  }

  async get(attemptId: string): Promise<PaymentAttempt | null> {
    const attempt = this.attempts.get(attemptId);
    return attempt === undefined ? null : clone(attempt);
  }

  async create(input: { readonly attempt: PaymentAttempt }): Promise<{ readonly attempt: PaymentAttempt; readonly replayed: boolean }> {
    const parsedAttempt = paymentAttemptSchema.parse(input.attempt);
    const attempt = paymentAttemptSchema.parse({
      ...parsedAttempt,
      pin: validatePaymentPinAgainstSellerConfiguration(parsedAttempt.pin, this.sellerConfiguration).pin
    });
    assertChallengeDigest(attempt.challenge);
    const idempotencyKey = idempotencyKeySchema.parse(attempt.idempotencyKey);
    const digest = canonicalSha256Hex({ operation: "create", attempt });
    const prior = this.actions.get(idempotencyKey);
    if (prior !== undefined) {
      if (prior.digest !== digest || prior.attemptId !== attempt.attemptId) {
        throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "The payment idempotency key was reused with different terms." });
      }
      return { attempt: clone(prior.result.attempt), replayed: true };
    }
    if (this.attempts.has(attempt.attemptId)) {
      throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A payment attempt already exists with this identifier." });
    }
    for (const existing of this.attempts.values()) {
      if (existing.challenge.challengeId === attempt.challenge.challengeId) {
        throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A payment challenge is already associated with another attempt." });
      }
    }
    const challenge = this.challenges.get(attempt.challenge.challengeId);
    if (challenge !== undefined && challenge.challengeDigest !== attempt.challenge.challengeDigest) {
      throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A challenge identifier was reused with different terms." });
    }
    const challengeAttemptId = this.challengeDigests.get(attempt.challenge.challengeDigest);
    if (challengeAttemptId !== undefined && challengeAttemptId !== attempt.challenge.challengeId) {
      throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "A challenge digest was already recorded under another identifier." });
    }
    const event = {
      eventId: randomUUID(),
      eventKey: `action:${idempotencyKey}`,
      attemptId: attempt.attemptId,
      eventType: "challenge_issued" as const,
      previousStatus: null,
      nextStatus: "challenged" as const,
      paymentTransactionHash: null,
      settlementTransactionHash: null,
      payloadDigest: canonicalSha256Hex({ challengeDigest: attempt.challengeDigest }),
      payload: { challengeDigest: attempt.challengeDigest },
      correlationId: attempt.requestId,
      observedAtUnix: attempt.createdAtUnix
    } satisfies PaymentEvent;
    const parsedEvent = paymentEventSchema.parse(event);
    await this.transaction(async (unit) => unit.commit({
      actionKey: idempotencyKey,
      actionDigest: digest,
      expectedAttempt: null,
      attempt,
      event: parsedEvent,
      challenge: attempt.challenge
    }));
    return { attempt: clone(attempt), replayed: false };
  }

  async transition(input: {
    readonly attemptId: string;
    readonly expectedStatus: PaymentAttemptStatus;
    readonly nextStatus: PaymentAttemptStatus;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly nowUnix: number;
    readonly metadata?: PaymentTransitionMetadata;
  }): Promise<{ readonly attempt: PaymentAttempt; readonly event: PaymentEvent; readonly replayed: boolean }> {
    const idempotencyKey = idempotencyKeySchema.parse(input.idempotencyKey);
    const attempt = this.attempts.get(input.attemptId);
    if (attempt === undefined) throw new PaymentError({ code: "UNKNOWN_ATTEMPT", message: "The payment attempt was not found." });
    const digest = canonicalSha256Hex({
      operation: "transition",
      attemptId: input.attemptId,
      expectedStatus: input.expectedStatus,
      nextStatus: input.nextStatus,
      correlationId: input.correlationId,
      metadata: input.metadata ?? {}
    });
    const prior = this.actions.get(idempotencyKey);
    if (prior !== undefined) {
      if (prior.digest !== digest || prior.attemptId !== input.attemptId) {
        throw new PaymentError({ code: "IDEMPOTENCY_CONFLICT", message: "The payment idempotency key was reused with different terms." });
      }
      return { ...clone(prior.result), replayed: true };
    }
    if (attempt.status !== input.expectedStatus) {
      throw new PaymentError({ code: "STALE_ATTEMPT", message: `Expected payment status ${input.expectedStatus}, observed ${attempt.status}.`, retriable: true, nextAction: "reconcile_payment" });
    }
    const result = transitionPaymentAttempt({ ...input, attempt, sellerConfiguration: this.sellerConfiguration });
    await this.transaction(async (unit) => unit.commit({
      actionKey: idempotencyKey,
      actionDigest: digest,
      expectedAttempt: attempt,
      attempt: result.attempt,
      event: result.event
    }));
    const saved = { attempt: clone(result.attempt), event: clone(result.event) };
    return { ...saved, replayed: false };
  }

  async appendEvent(event: PaymentEvent): Promise<{ readonly event: PaymentEvent; readonly replayed: boolean }> {
    const parsed = paymentEventSchema.parse(event);
    const prior = this.events.get(parsed.eventKey);
    if (prior !== undefined) {
      if (!sameEvent(prior, parsed)) {
        throw new PaymentError({ code: "EVENT_CONFLICT", message: "A payment event key was reused with different contents." });
      }
      return { event: clone(prior), replayed: true };
    }
    this.events.set(parsed.eventKey, clone(parsed));
    return { event: clone(parsed), replayed: false };
  }

  async getChallenge(challengeId: string): Promise<PaymentChallenge | null> {
    const challenge = this.challenges.get(challengeId);
    return challenge === undefined ? null : clone(challenge);
  }

  async saveChallenge(challenge: PaymentChallenge): Promise<{ readonly challenge: PaymentChallenge; readonly replayed: boolean }> {
    const parsed = paymentChallengeSchema.parse(challenge);
    assertChallengeDigest(parsed);
    const prior = this.challenges.get(parsed.challengeId);
    if (prior !== undefined) {
      if (prior.challengeDigest !== parsed.challengeDigest) {
        throw new PaymentError({ code: "EVENT_CONFLICT", message: "A challenge identifier was reused with different terms." });
      }
      return { challenge: clone(prior), replayed: true };
    }
    const priorChallengeId = this.challengeDigests.get(parsed.challengeDigest);
    if (priorChallengeId !== undefined && priorChallengeId !== parsed.challengeId) {
      throw new PaymentError({ code: "EVENT_CONFLICT", message: "A challenge digest was already recorded under another identifier." });
    }
    this.challenges.set(parsed.challengeId, clone(parsed));
    this.challengeDigests.set(parsed.challengeDigest, parsed.challengeId);
    return { challenge: clone(parsed), replayed: false };
  }

  async getReceiptByAttempt(attemptId: string): Promise<PaymentReceipt | null> {
    const receipt = this.receipts.get(attemptId);
    return receipt === undefined ? null : clone(receipt);
  }

  async getSettlementByAttempt(attemptId: string): Promise<PaymentReceipt | null> {
    return this.getReceiptByAttempt(attemptId);
  }

  async saveReceipt(receipt: PaymentReceipt): Promise<{ readonly receipt: PaymentReceipt; readonly replayed: boolean }> {
    const parsed = paymentReceiptSchema.parse(receipt);
    const attempt = this.attempts.get(parsed.attemptId);
    if (attempt === undefined) {
      throw new PaymentError({ code: "UNKNOWN_ATTEMPT", message: "The payment receipt references an unknown attempt." });
    }
    if (attempt.challenge.challengeId !== parsed.challengeId) {
      throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "The payment receipt references a different challenge." });
    }
    const trusted = validateReceipt(parsed, attempt.pin, attempt.attemptId, attempt.challenge.challengeId);
    const digest = receiptDigest(trusted);
    const prior = this.receipts.get(trusted.attemptId);
    if (prior !== undefined) {
      if (receiptDigest(prior) !== digest) {
        if ((prior.status === "unknown" || prior.status === "partial_failure") && trusted.status === "settled") {
          this.receipts.set(trusted.attemptId, clone(trusted));
          this.receiptIds.set(trusted.receiptId, trusted.attemptId);
          this.receiptDigests.set(digest, trusted.attemptId);
          return { receipt: clone(trusted), replayed: false };
        }
        throw new PaymentError({ code: "EVENT_CONFLICT", message: "A payment attempt was associated with a different receipt." });
      }
      return { receipt: clone(prior), replayed: true };
    }
    const priorAttemptIdForId = this.receiptIds.get(trusted.receiptId);
    if (priorAttemptIdForId !== undefined && priorAttemptIdForId !== trusted.attemptId) {
      throw new PaymentError({ code: "EVENT_CONFLICT", message: "A receipt identifier was reused by another payment attempt." });
    }
    const priorAttemptIdForDigest = this.receiptDigests.get(digest);
    if (priorAttemptIdForDigest !== undefined && priorAttemptIdForDigest !== trusted.attemptId) {
      throw new PaymentError({ code: "EVENT_CONFLICT", message: "A receipt digest was already recorded for another payment attempt." });
    }
    this.receipts.set(trusted.attemptId, clone(trusted));
    this.receiptIds.set(trusted.receiptId, trusted.attemptId);
    this.receiptDigests.set(digest, trusted.attemptId);
    return { receipt: clone(trusted), replayed: false };
  }

  async recordSettlement(receipt: PaymentReceipt): Promise<{ readonly receipt: PaymentReceipt; readonly replayed: boolean }> {
    return this.saveReceipt(receipt);
  }

  async enqueue(input: Omit<PaymentReconciliation, "reconciliationId" | "createdAtUnix" | "updatedAtUnix" | "attemptCount" | "state"> & { readonly nowUnix: number }): Promise<PaymentReconciliation> {
    const identity = `${input.attemptId}:${input.reasonCode}`;
    const prior = this.reconciliations.get(identity);
    if (prior !== undefined) return clone(prior);
    const next: PaymentReconciliation = paymentReconciliationSchema.parse({
      reconciliationId: randomUUID(),
      attemptId: input.attemptId,
      state: "pending",
      reasonCode: input.reasonCode,
      attemptCount: 0,
      nextAttemptAtUnix: input.nextAttemptAtUnix,
      observedPaymentTransactionHash: input.observedPaymentTransactionHash,
      observedSettlementTransactionHash: input.observedSettlementTransactionHash,
      detailDigest: input.detailDigest,
      createdAtUnix: input.nowUnix,
      updatedAtUnix: input.nowUnix
    });
    this.reconciliations.set(identity, clone(next));
    return clone(next);
  }

  async listDue(nowUnix: number): Promise<readonly PaymentReconciliation[]> {
    return [...this.reconciliations.values()]
      .filter((entry) => (entry.state === "pending" || entry.state === "failed") && (entry.nextAttemptAtUnix === null || entry.nextAttemptAtUnix <= nowUnix))
      .map(clone);
  }

  async update(input: { readonly reconciliationId: string; readonly state: ReconciliationState; readonly nowUnix: number; readonly nextAttemptAtUnix: number | null; readonly observedPaymentTransactionHash?: `0x${string}` | null; readonly observedSettlementTransactionHash?: `0x${string}` | null; readonly detailDigest?: string | null }): Promise<PaymentReconciliation> {
    const prior = [...this.reconciliations.values()].find((entry) => entry.reconciliationId === input.reconciliationId);
    if (prior === undefined) throw new PaymentError({ code: "RECONCILIATION_REQUIRED", message: "The payment reconciliation record was not found." });
    if (prior.state !== input.state && !allowedReconciliationTransitions[prior.state].includes(input.state)) {
      throw new PaymentError({ code: "ILLEGAL_TRANSITION", message: `Illegal reconciliation transition: ${prior.state} -> ${input.state}.` });
    }
    const next = paymentReconciliationSchema.parse({
      ...prior,
      state: input.state,
      attemptCount: prior.attemptCount + 1,
      nextAttemptAtUnix: input.nextAttemptAtUnix,
      observedPaymentTransactionHash: input.observedPaymentTransactionHash === undefined ? prior.observedPaymentTransactionHash : input.observedPaymentTransactionHash,
      observedSettlementTransactionHash: input.observedSettlementTransactionHash === undefined ? prior.observedSettlementTransactionHash : input.observedSettlementTransactionHash,
      detailDigest: input.detailDigest === undefined ? prior.detailDigest : input.detailDigest,
      updatedAtUnix: input.nowUnix
    });
    this.reconciliations.set(`${prior.attemptId}:${prior.reasonCode}`, clone(next));
    return clone(next);
  }
}

function sameEvent(left: PaymentEvent, right: PaymentEvent): boolean {
  return left.attemptId === right.attemptId &&
    left.eventType === right.eventType &&
    left.previousStatus === right.previousStatus &&
    left.payloadDigest === right.payloadDigest &&
    left.nextStatus === right.nextStatus &&
    left.paymentTransactionHash === right.paymentTransactionHash &&
    left.settlementTransactionHash === right.settlementTransactionHash;
}
