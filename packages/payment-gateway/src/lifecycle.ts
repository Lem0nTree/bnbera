import { contentDigestSchema } from "@bnbera/domain";
import { PaymentError } from "./errors.js";
import { createPaymentEvent } from "./events.js";
import {
  paymentAttemptSchema,
  paymentReceiptSchema,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentEvent,
  type PaymentReceipt
} from "./types.js";
import { normalizeAddress, receiptDigest, validateReceipt } from "./validation.js";

const allowedTransitions: Readonly<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>> = {
  challenged: ["authorized", "rejected", "expired"],
  authorized: ["relay_pending", "rejected", "expired"],
  relay_pending: ["relayed", "unknown", "partial_failure"],
  relayed: ["settlement_pending", "unknown", "partial_failure"],
  settlement_pending: ["settled", "unknown", "partial_failure"],
  settled: ["delivered", "partial_failure"],
  delivered: [],
  rejected: [],
  expired: [],
  unknown: ["settlement_pending", "manual_review"],
  partial_failure: ["settlement_pending", "manual_review"],
  manual_review: []
};

export function canTransitionPayment(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

function eventTypeFor(nextStatus: PaymentAttemptStatus): "challenge_issued" | "payment_authorized" | "relay_started" | "relay_completed" | "settlement_observed" | "response_delivered" | "payment_rejected" | "payment_expired" | "payment_unknown" | "payment_partial_failure" | "reconciliation_requested" | "reconciliation_succeeded" | "reconciliation_failed" {
  if (nextStatus === "authorized") return "payment_authorized";
  if (nextStatus === "relay_pending") return "relay_started";
  if (nextStatus === "relayed") return "relay_completed";
  if (nextStatus === "settlement_pending") return "settlement_observed";
  if (nextStatus === "settled") return "settlement_observed";
  if (nextStatus === "delivered") return "response_delivered";
  if (nextStatus === "expired") return "payment_expired";
  if (nextStatus === "unknown") return "payment_unknown";
  if (nextStatus === "partial_failure") return "payment_partial_failure";
  if (nextStatus === "manual_review") return "reconciliation_failed";
  return "payment_rejected";
}

export interface PaymentTransitionMetadata {
  /** Digest of the already validated authorization; raw signatures never enter this object. */
  readonly authorizationDigest?: string | null;
  readonly payerAddress?: string | null;
  readonly relayRequestDigest?: string | null;
  readonly receipt?: PaymentReceipt;
  readonly failureCode?: string;
  readonly sanitizedFailure?: string;
  readonly paymentTransactionHash?: `0x${string}` | null;
  readonly settlementTransactionHash?: `0x${string}` | null;
  readonly reconciliationConfirmed?: boolean;
  readonly payload?: unknown;
}

export function assertPaymentTransition(input: {
  readonly attempt: PaymentAttempt;
  readonly nextStatus: PaymentAttemptStatus;
  readonly nowUnix: number;
  readonly metadata?: PaymentTransitionMetadata;
}): void {
  const { attempt, nextStatus, nowUnix, metadata = {} } = input;
  paymentAttemptSchema.parse(attempt);
  if (!canTransitionPayment(attempt.status, nextStatus) || attempt.status === nextStatus) {
    throw new PaymentError({ code: "ILLEGAL_TRANSITION", message: `Illegal payment transition: ${attempt.status} -> ${nextStatus}.` });
  }
  if ((attempt.status === "unknown" || attempt.status === "partial_failure") && nextStatus === "settlement_pending" && metadata.reconciliationConfirmed !== true) {
    throw new PaymentError({ code: "RECONCILIATION_REQUIRED", message: "An ambiguous payment outcome must be reconciled before settlement is retried.", nextAction: "reconcile_payment" });
  }
  if ((nextStatus === "settled" || nextStatus === "delivered") && metadata.receipt === undefined) {
    throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "A receipt is required before marking a payment settled or delivered." });
  }
  if (metadata.receipt !== undefined) {
    paymentReceiptSchema.parse(metadata.receipt);
    validateReceipt(metadata.receipt, attempt.pin, attempt.attemptId, attempt.challenge.challengeId);
  }
  if (metadata.authorizationDigest !== undefined && metadata.authorizationDigest !== null) {
    contentDigestSchema.parse(metadata.authorizationDigest);
  }
  if (metadata.payerAddress !== undefined && metadata.payerAddress !== null) {
    normalizeAddress(metadata.payerAddress, "payer address");
  }
  if (metadata.relayRequestDigest !== undefined && metadata.relayRequestDigest !== null) {
    contentDigestSchema.parse(metadata.relayRequestDigest);
  }
  if (nextStatus === "authorized" && (metadata.authorizationDigest === undefined || metadata.authorizationDigest === null || metadata.payerAddress === undefined || metadata.payerAddress === null)) {
    throw new PaymentError({ code: "INVALID_AUTHORIZATION", message: "Authorization digest and payer are required before a payment attempt can be authorized." });
  }
  if (nextStatus === "relay_pending" && (attempt.authorizationDigest === null || attempt.payerAddress === null)) {
    throw new PaymentError({ code: "INVALID_AUTHORIZATION", message: "A payment attempt must retain validated authorization before relay." });
  }
  if (nextStatus === "relayed" && attempt.relayRequestDigest === null && (metadata.relayRequestDigest === undefined || metadata.relayRequestDigest === null)) {
    throw new PaymentError({ code: "INVALID_AUTHORIZATION", message: "Relay completion must retain the authenticated relay request digest." });
  }
  if (nextStatus === "settled") {
    if (metadata.receipt?.status !== "settled") {
      throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "Only a settled receipt can move an attempt to settled." });
    }
  }
  if (metadata.receipt !== undefined && (metadata.receipt.attemptId !== attempt.attemptId || metadata.receipt.challengeId !== attempt.challenge.challengeId)) {
    throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "Receipt is bound to another payment attempt." });
  }
  if (nextStatus === "delivered" && (metadata.receipt?.status !== "settled" || metadata.receipt.responseStatus === null || metadata.receipt.responseStatus < 200 || metadata.receipt.responseStatus >= 300)) {
    throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "A delivered response must follow a settled payment and a successful response." });
  }
  if (nextStatus === "expired" && nowUnix < attempt.challenge.expiresAtUnix) {
    throw new PaymentError({ code: "CHALLENGE_EXPIRED", message: "A payment attempt cannot expire before its challenge." });
  }
  if (nextStatus === "unknown" && attempt.status === "challenged") {
    throw new PaymentError({ code: "ILLEGAL_TRANSITION", message: "A challenge must be authorized before a post-payment outcome can be unknown." });
  }
}

export function transitionPaymentAttempt(input: {
  readonly attempt: PaymentAttempt;
  readonly nextStatus: PaymentAttemptStatus;
  readonly nowUnix: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly metadata?: PaymentTransitionMetadata;
}): { readonly attempt: PaymentAttempt; readonly event: PaymentEvent } {
  assertPaymentTransition(input);
  const metadata = input.metadata ?? {};
  const receiptId = metadata.receipt?.receiptId ?? input.attempt.receiptId;
  const next: PaymentAttempt = {
    ...input.attempt,
    status: input.nextStatus,
    receiptId,
    authorizationDigest: metadata.authorizationDigest === undefined ? input.attempt.authorizationDigest : metadata.authorizationDigest,
    payerAddress: metadata.payerAddress === undefined
      ? input.attempt.payerAddress
      : metadata.payerAddress === null
        ? null
        : normalizeAddress(metadata.payerAddress, "payer address"),
    relayRequestDigest: metadata.relayRequestDigest === undefined ? input.attempt.relayRequestDigest : metadata.relayRequestDigest,
    failureCode: metadata.failureCode ?? input.attempt.failureCode,
    sanitizedFailure: metadata.sanitizedFailure ?? input.attempt.sanitizedFailure,
    updatedAtUnix: input.nowUnix
  };
  const receiptPayload = metadata.receipt === undefined ? {} : { receiptDigest: receiptDigest(metadata.receipt) };
  const event = createPaymentEvent({
    eventKey: `action:${input.idempotencyKey}`,
    attemptId: input.attempt.attemptId,
    eventType: eventTypeFor(input.nextStatus),
    previousStatus: input.attempt.status,
    nextStatus: input.nextStatus,
    paymentTransactionHash: metadata.paymentTransactionHash ?? metadata.receipt?.paymentTransactionHash ?? null,
    settlementTransactionHash: metadata.settlementTransactionHash ?? metadata.receipt?.settlementTransactionHash ?? null,
    payload: { ...receiptPayload, ...(metadata.payload === undefined ? {} : { details: metadata.payload }) },
    correlationId: input.correlationId,
    observedAtUnix: input.nowUnix
  });
  return { attempt: paymentAttemptSchema.parse(next), event };
}

/**
 * A relay timeout is never a safe signal to retry a payment. Callers use this
 * classification to persist an ambiguous result and reconcile it against the
 * facilitator/chain before any further settlement action.
 */
export function classifyRelayTimeout(input: {
  readonly paymentMayHaveSettled: boolean;
}): {
  readonly nextStatus: "unknown" | "partial_failure";
  readonly errorCode: "UNKNOWN_POST_PAYMENT_OUTCOME" | "RELAY_TIMEOUT";
  readonly requiresReconciliation: true;
} {
  if (input.paymentMayHaveSettled) {
    return {
      nextStatus: "unknown",
      errorCode: "UNKNOWN_POST_PAYMENT_OUTCOME",
      requiresReconciliation: true
    };
  }
  return {
    nextStatus: "partial_failure",
    errorCode: "RELAY_TIMEOUT",
    requiresReconciliation: true
  };
}
