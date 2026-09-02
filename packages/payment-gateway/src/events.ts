import { randomUUID } from "node:crypto";
import { canonicalSha256Hex } from "@bnbera/domain";
import { paymentEventSchema, type PaymentAttemptStatus, type PaymentEvent, type PaymentEventType } from "./types.js";
import { assertPublicPayloadSafe } from "./validation.js";

export function createPaymentEvent(input: {
  readonly eventKey: string;
  readonly attemptId: string;
  readonly eventType: PaymentEventType;
  readonly previousStatus: PaymentAttemptStatus | null;
  readonly nextStatus: PaymentAttemptStatus | null;
  readonly paymentTransactionHash?: string | null;
  readonly settlementTransactionHash?: string | null;
  readonly payload?: unknown;
  readonly correlationId: string;
  readonly observedAtUnix: number;
}): PaymentEvent {
  const payload = input.payload ?? {};
  assertPublicPayloadSafe(payload);
  return paymentEventSchema.parse({
    eventId: randomUUID(),
    eventKey: input.eventKey,
    attemptId: input.attemptId,
    eventType: input.eventType,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    paymentTransactionHash: input.paymentTransactionHash ?? null,
    settlementTransactionHash: input.settlementTransactionHash ?? null,
    payloadDigest: canonicalSha256Hex(payload),
    payload,
    correlationId: input.correlationId,
    observedAtUnix: input.observedAtUnix
  });
}
