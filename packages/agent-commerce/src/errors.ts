import { z } from "zod";

export const commerceErrorCodes = [
  "COMMERCE_DISABLED",
  "INVALID_CHAIN",
  "INVALID_CONTRACT",
  "INVALID_TOKEN",
  "INVALID_ADDRESS",
  "INVALID_AMOUNT",
  "INVALID_EXPIRY",
  "INVALID_QUOTE",
  "INVALID_JOB",
  "CHAIN_PROVIDER_INVALID",
  "TRANSACTION_REVERTED",
  "TRANSACTION_UNKNOWN",
  "ILLEGAL_TRANSITION",
  "UNAUTHORIZED_ACTOR",
  "STALE_JOB",
  "UNKNOWN_JOB",
  "IDEMPOTENCY_CONFLICT",
  "EVENT_CONFLICT",
  "RECONCILIATION_REQUIRED",
  "ONCHAIN_MISMATCH"
] as const;

export const commerceErrorCodeSchema = z.enum(commerceErrorCodes);
export type CommerceErrorCode = z.infer<typeof commerceErrorCodeSchema>;

export interface CommerceErrorOptions {
  readonly code: CommerceErrorCode;
  readonly message: string;
  readonly retriable?: boolean;
  readonly nextAction?: string;
  readonly transactionHash?: `0x${string}`;
  readonly relayCallsId?: `0x${string}`;
  readonly cause?: unknown;
}

/**
 * Error crossing the commerce boundary. Only the safe message and stable
 * code are serializable; the original cause is retained in memory only.
 */
export class CommerceError extends Error {
  readonly code: CommerceErrorCode;
  readonly retriable: boolean;
  readonly nextAction: string;
  readonly transactionHash: `0x${string}` | undefined;
  readonly relayCallsId: `0x${string}` | undefined;
  readonly causeValue: unknown;

  constructor(options: CommerceErrorOptions) {
    super(options.message);
    this.name = "CommerceError";
    this.code = commerceErrorCodeSchema.parse(options.code);
    this.retriable = options.retriable ?? false;
    this.nextAction = options.nextAction ?? "none";
    this.transactionHash = options.transactionHash;
    this.relayCallsId = options.relayCallsId;
    Object.defineProperty(this, "causeValue", {
      configurable: false,
      enumerable: false,
      value: options.cause,
      writable: false
    });
  }

  toEnvelope(requestId: string): {
    readonly error: {
      readonly code: CommerceErrorCode;
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
