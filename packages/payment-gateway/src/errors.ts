import { z } from "zod";

export const paymentErrorCodes = [
  "PAYMENT_DISABLED",
  "B402_NOT_READY",
  "INVALID_PAYMENT_CONFIG",
  "INVALID_CHALLENGE",
  "CHALLENGE_TAMPERED",
  "CHALLENGE_EXPIRED",
  "NETWORK_MISMATCH",
  "ASSET_MISMATCH",
  "DECIMALS_MISMATCH",
  "AMOUNT_MISMATCH",
  "RECIPIENT_MISMATCH",
  "METHOD_MISMATCH",
  "DESTINATION_MISMATCH",
  "FACILITATOR_MISMATCH",
  "EGRESS_PROFILE_MISMATCH",
  "REQUEST_MISMATCH",
  "INVALID_ADDRESS",
  "INVALID_AMOUNT",
  "INVALID_EXPIRY",
  "INVALID_SECRET_REFERENCE",
  "UNSUPPORTED_PAYMENT_METHOD",
  "INVALID_AUTHORIZATION",
  "REPLAY_DETECTED",
  "IDEMPOTENCY_CONFLICT",
  "EVENT_CONFLICT",
  "UNKNOWN_ATTEMPT",
  "STALE_ATTEMPT",
  "ILLEGAL_TRANSITION",
  "RELAY_TIMEOUT",
  "SETTLEMENT_UNVERIFIED",
  "PAYOUT_MISMATCH",
  "UNKNOWN_POST_PAYMENT_OUTCOME",
  "RECONCILIATION_REQUIRED"
] as const;

export const paymentErrorCodeSchema = z.enum(paymentErrorCodes);
export type PaymentErrorCode = z.infer<typeof paymentErrorCodeSchema>;

export interface PaymentErrorOptions {
  readonly code: PaymentErrorCode;
  readonly message: string;
  readonly retriable?: boolean;
  readonly nextAction?: string;
  readonly cause?: unknown;
}

/**
 * Safe error crossing the payment boundary. A raw credential, response body,
 * facilitator payload, or private cause is never serialized by this class.
 */
export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly retriable: boolean;
  readonly nextAction: string;
  readonly causeValue: unknown;

  constructor(options: PaymentErrorOptions) {
    super(options.message);
    this.name = "PaymentError";
    this.code = paymentErrorCodeSchema.parse(options.code);
    this.retriable = options.retriable ?? false;
    this.nextAction = options.nextAction ?? "none";
    // Keep adapter diagnostics available to an in-process caller without
    // allowing JSON/log serializers to emit a rejected credential-shaped
    // input or a facilitator response body.
    Object.defineProperty(this, "causeValue", {
      configurable: false,
      enumerable: false,
      value: options.cause,
      writable: false
    });
  }

  toEnvelope(requestId: string): {
    readonly error: {
      readonly code: PaymentErrorCode;
      readonly message: string;
      readonly requestId: string;
      readonly retriable: boolean;
      readonly nextAction: string;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        retriable: this.retriable,
        nextAction: this.nextAction
      }
    };
  }
}
