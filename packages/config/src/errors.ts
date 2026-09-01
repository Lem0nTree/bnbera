import { z } from "zod";

export const appErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,63}$/, "Error codes must be stable uppercase identifiers");

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: appErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().min(1).max(160),
    retriable: z.boolean(),
    nextAction: z.string().min(1).max(160)
  })
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export type AppErrorOptions = {
  code: string;
  safeMessage: string;
  requestId: string;
  retriable?: boolean;
  nextAction?: string;
  cause?: unknown;
};

/**
 * Error type for crossing a public/API boundary. The original cause is kept
 * only in memory for server-side diagnostics and is never serialized.
 */
export class AppError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly retriable: boolean;
  readonly nextAction: string;
  readonly causeValue: unknown;

  constructor(options: AppErrorOptions) {
    super(options.safeMessage);
    this.name = "AppError";
    this.code = appErrorCodeSchema.parse(options.code);
    this.requestId = options.requestId;
    this.retriable = options.retriable ?? false;
    this.nextAction = options.nextAction ?? "none";
    this.causeValue = options.cause;
  }

  toEnvelope(): ErrorEnvelope {
    return errorEnvelopeSchema.parse({
      error: {
        code: this.code,
        message: this.message,
        requestId: this.requestId,
        retriable: this.retriable,
        nextAction: this.nextAction
      }
    });
  }
}

export function toAppError(
  error: unknown,
  options: Omit<AppErrorOptions, "cause"> & { cause?: unknown }
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError({ ...options, cause: error });
}

export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
