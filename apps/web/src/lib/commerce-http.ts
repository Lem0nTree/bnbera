import { randomUUID } from "node:crypto";
import { AppError, errorEnvelopeSchema } from "@bnbera/config";
import { CommerceError } from "@bnbera/agent-commerce";
import {
  commerceApiContractVersion,
  commerceErrorResponse as makeCommerceErrorResponse
} from "./commerce-contract";
import { z } from "zod";

const jobIdSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const operationIdSchema = z.string().uuid();
const parentJobIdSchema = z.string().uuid();

export async function parseCommerceJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    throw new AppError({
      code: "COMMERCE_REQUEST_INVALID",
      safeMessage: "The commerce request body must be valid JSON.",
      requestId: "req_web_commerce_body",
      nextAction: "check_request",
      cause
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({
      code: "COMMERCE_REQUEST_INVALID",
      safeMessage: "The commerce request body is invalid or contains unsupported authority fields.",
      requestId: "req_web_commerce_body",
      nextAction: "check_request",
      cause: parsed.error
    });
  }
  return parsed.data;
}

export function parseCommerceJobId(value: string): string {
  const parsed = jobIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: "COMMERCE_JOB_INVALID",
      safeMessage: "The ERC-8183 job identifier is invalid.",
      requestId: "req_web_commerce_job",
      nextAction: "check_job_identifier",
      cause: parsed.error
    });
  }
  return parsed.data;
}

export function parseCommerceOperationId(value: string): string {
  const parsed = operationIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: "COMMERCE_OPERATION_INVALID",
      safeMessage: "The commerce operation identifier is invalid.",
      requestId: "req_web_commerce_operation",
      nextAction: "check_operation_identifier",
      cause: parsed.error
    });
  }
  return parsed.data;
}

export function parseCommerceParentJobId(value: string): string {
  const parsed = parentJobIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: "COMMERCE_JOB_INVALID",
      safeMessage: "The parent commerce job identifier is invalid.",
      requestId: "req_web_commerce_parent_job",
      nextAction: "check_job_identifier",
      cause: parsed.error
    });
  }
  return parsed.data;
}

function statusForCommerceError(error: CommerceError | AppError): number {
  if (error instanceof AppError) {
    if (error.code === "COMMERCE_JOB_INVALID" || error.code === "COMMERCE_OPERATION_INVALID" || error.code === "COMMERCE_REQUEST_INVALID") return 400;
    return 503;
  }
  switch (error.code) {
    case "UNKNOWN_JOB": return 404;
    case "UNAUTHORIZED_ACTOR": return 403;
    case "TRANSACTION_UNKNOWN": return 409;
    case "TRANSACTION_REVERTED": return 409;
    case "IDEMPOTENCY_CONFLICT": return 409;
    case "STALE_JOB": return 409;
    case "RECONCILIATION_REQUIRED": return 409;
    case "ONCHAIN_MISMATCH": return 409;
    case "ILLEGAL_TRANSITION": return 409;
    case "EVENT_CONFLICT": return 409;
    case "COMMERCE_DISABLED": return 503;
    case "CHAIN_PROVIDER_INVALID": return 503;
    default: return 400;
  }
}

export function commerceHttpError(error: unknown, requestId = randomUUID()): Response {
  const safeError = error instanceof CommerceError
    ? error
    : error instanceof AppError
      ? error
      : new AppError({
          code: "COMMERCE_API_UNAVAILABLE",
          safeMessage: "The commerce request could not be completed.",
          requestId,
          retriable: true,
          nextAction: "retry_request",
          cause: error
        });
  const envelope = safeError instanceof CommerceError
    ? safeError.toEnvelope(requestId)
    : safeError.toEnvelope();
  const parsedEnvelope = errorEnvelopeSchema.parse(envelope);
  const body = makeCommerceErrorResponse(parsedEnvelope);
  return Response.json(body, {
    status: statusForCommerceError(safeError),
    headers: { "Cache-Control": "no-store", Vary: "Accept" }
  });
}

export function commerceHttpJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Vary: "Accept", "X-BNBEra-Commerce-Contract": commerceApiContractVersion }
  });
}
