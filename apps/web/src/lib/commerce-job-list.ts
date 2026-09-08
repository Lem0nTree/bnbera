import { commerceJobStatuses, erc8004IdentitySchema } from "@bnbera/domain";
import {
  erc8183JobStateSchema,
  erc8183ProviderBindingSchema,
  type Erc8183OperationQueryPool
} from "@bnbera/agent-commerce";
import { AppError } from "@bnbera/config";
import { z } from "zod";
import { commerceApiContractVersion } from "./commerce-contract";

export const commerceJobsDefaultLimit = 20;
export const commerceJobsMaximumLimit = 50;

const commerceJobStatusSchema = z.enum(commerceJobStatuses);
const operationStatusSchema = z.enum([
  "awaiting_signature", "submitted", "confirmed", "reverted", "unknown", "reconciled", "manual_review"
]);
const operationKindSchema = z.enum([
  "create", "register", "set_budget", "approve", "fund", "submit", "settle",
  "claim_refund", "mark_expired", "cancel", "reject", "dispute", "vote"
]);
const decimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const addressSchema = z.string().regex(/^0x[0-9a-f]{40}$/iu);
const transactionSchema = z.string().regex(/^0x[0-9a-f]{64}$/iu);

const cursorPayloadSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid()
}).strict();

export const commerceJobsQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().positive().max(commerceJobsMaximumLimit).default(commerceJobsDefaultLimit)
}).strict();
export type CommerceJobsQuery = z.infer<typeof commerceJobsQuerySchema>;

const nextActionSchema = z.enum([
  "review_quote", "request_fresh_quote", "resume_funding", "resume_wallet_step",
  "wait_for_confirmation", "reconcile_transaction", "inspect_failed_transaction",
  "wait_for_agent", "review_result", "claim_refund", "view_refund", "leave_review",
  "view_receipt", "view_job"
]);

export const buyerJobSummarySchema = z.object({
  commerceJobId: z.string().uuid(),
  protocolJobId: decimalSchema.nullable(),
  agent: z.object({
    identity: erc8004IdentitySchema,
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    name: z.string().min(1).max(200).nullable(),
    slug: z.string().min(1).max(200).nullable()
  }).strict(),
  lifecycle: z.object({
    status: commerceJobStatusSchema,
    canonicalState: erc8183JobStateSchema.nullable()
  }).strict(),
  price: z.object({
    amountAtomic: decimalSchema,
    tokenAddress: addressSchema.nullable(),
    tokenSymbol: z.string().min(1).max(32).nullable(),
    decimals: z.number().int().min(0).max(255).nullable(),
    chainId: z.union([z.literal(56), z.literal(97)]).nullable()
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  resultAvailable: z.boolean(),
  settlementAvailable: z.boolean(),
  reviewAvailable: z.boolean(),
  hasReview: z.boolean(),
  latestOperation: z.object({
    operationId: z.string().uuid(),
    status: operationStatusSchema,
    step: operationKindSchema,
    transactionHash: transactionSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true })
  }).strict().nullable(),
  nextAction: nextActionSchema
}).strict();
export type BuyerJobSummary = z.infer<typeof buyerJobSummarySchema>;

export const commerceJobsResponseSchema = z.object({
  contractVersion: z.literal(commerceApiContractVersion),
  status: z.literal("ready"),
  jobs: z.array(buyerJobSummarySchema).max(commerceJobsMaximumLimit),
  nextCursor: z.string().nullable(),
  error: z.null()
}).strict();
export type CommerceJobsResponse = z.infer<typeof commerceJobsResponseSchema>;

type JobRow = {
  readonly commerce_job_id: string;
  readonly parent_protocol_job_id: string;
  readonly quote: unknown;
  readonly price_atomic: string;
  readonly parent_status: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly canonical_protocol_job_id: string | null;
  readonly canonical_state: string | null;
  readonly canonical_chain_id: number | null;
  readonly payment_token: string | null;
  readonly payment_decimals: number | null;
  readonly expires_at: Date | string | null;
  readonly provider_binding: unknown | null;
  readonly refund_transaction_hash: string | null;
  readonly result_state: string | null;
  readonly review_id: string | null;
  readonly agent_name: string | null;
  readonly agent_slug: string | null;
  readonly operation_id: string | null;
  readonly operation_status: string | null;
  readonly operation_kind: string | null;
  readonly operation_transaction_hash: string | null;
  readonly operation_updated_at_unix: number | string | null;
};

function invalidRequest(message: string, cause?: unknown): AppError {
  return new AppError({ code: "COMMERCE_REQUEST_INVALID", safeMessage: message, requestId: "req_web_commerce_jobs", nextAction: "check_request", cause });
}

function unavailable(cause?: unknown): AppError {
  return new AppError({ code: "COMMERCE_API_UNAVAILABLE", safeMessage: "The hired jobs history could not be loaded.", requestId: "req_web_commerce_jobs", nextAction: "retry_request", retriable: true, cause });
}

function iso(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw unavailable(new Error(`Invalid persisted ${label}`));
  return date.toISOString();
}

function decodeCursor(value: string | undefined): z.infer<typeof cursorPayloadSchema> | null {
  if (value === undefined) return null;
  try {
    return cursorPayloadSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch (cause) {
    throw invalidRequest("The commerce jobs cursor is invalid.", cause);
  }
}

function encodeCursor(row: JobRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: iso(row.updated_at, "job update time"), id: row.commerce_job_id }), "utf8").toString("base64url");
}

export function parseCommerceJobsQuery(url: string): CommerceJobsQuery {
  const params = new URL(url).searchParams;
  const input: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key !== "cursor" && key !== "limit") throw invalidRequest("The commerce jobs query contains an unsupported parameter.");
    if (key in input) throw invalidRequest("The commerce jobs query contains a duplicate parameter.");
    input[key] = value;
  }
  const parsed = commerceJobsQuerySchema.safeParse(input);
  if (!parsed.success) throw invalidRequest("The commerce jobs query is invalid.", parsed.error);
  return parsed.data;
}

function quoteRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw unavailable(new Error("Invalid persisted quote"));
  return value as Record<string, unknown>;
}

function binding(row: JobRow): z.infer<typeof erc8183ProviderBindingSchema> {
  const quote = quoteRecord(row.quote);
  const candidate = row.provider_binding ?? {
    identity: quote.identity,
    agentVersionId: quote.agentVersionId,
    agentVersion: quote.agentVersion
  };
  const parsed = erc8183ProviderBindingSchema.safeParse(candidate);
  if (!parsed.success) throw unavailable(parsed.error);
  return parsed.data;
}

function nullableString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value : null;
}

function nextAction(summary: Omit<BuyerJobSummary, "nextAction">, quoteExpired: boolean, refunded: boolean): BuyerJobSummary["nextAction"] {
  const operation = summary.latestOperation;
  if (operation?.status === "unknown" || operation?.status === "manual_review") return "reconcile_transaction";
  if (operation?.status === "awaiting_signature") return "resume_wallet_step";
  if (operation?.status === "submitted") return "wait_for_confirmation";
  if (operation?.status === "reverted") return "inspect_failed_transaction";
  if (summary.lifecycle.canonicalState === "expired") return refunded ? "view_refund" : "claim_refund";
  if (summary.lifecycle.canonicalState === "submitted" || summary.lifecycle.status === "submitted" || summary.lifecycle.status === "accepted") return "review_result";
  if (summary.lifecycle.canonicalState === "completed" || summary.lifecycle.status === "completed" || summary.lifecycle.status === "settled") {
    return summary.reviewAvailable && !summary.hasReview ? "leave_review" : "view_receipt";
  }
  if (summary.lifecycle.canonicalState === "funded" || summary.lifecycle.status === "funded") return "wait_for_agent";
  if (summary.lifecycle.status === "draft") return quoteExpired ? "request_fresh_quote" : "review_quote";
  if (summary.lifecycle.status === "negotiating") return "resume_funding";
  return "view_job";
}

function toSummary(row: JobRow, now: Date): BuyerJobSummary {
  const quote = quoteRecord(row.quote);
  const provider = binding(row);
  const canonicalState = row.canonical_state === null ? null : erc8183JobStateSchema.parse(row.canonical_state);
  const lifecycleStatus = commerceJobStatusSchema.parse(row.parent_status);
  const operation = row.operation_id === null ? null : {
    operationId: row.operation_id,
    status: operationStatusSchema.parse(row.operation_status),
    step: operationKindSchema.parse(row.operation_kind),
    transactionHash: row.operation_transaction_hash,
    updatedAt: new Date(Number(row.operation_updated_at_unix) * 1_000).toISOString()
  };
  const expiresAt = row.expires_at === null ? nullableString(quote.expiresAt, 64) : iso(row.expires_at, "job expiry");
  const resultAvailable = row.result_state === "submitted" || row.result_state === "settled";
  const settlementAvailable = row.result_state === "settled" || lifecycleStatus === "settled" || canonicalState === "completed";
  const draft: Omit<BuyerJobSummary, "nextAction"> = {
    commerceJobId: row.commerce_job_id,
    protocolJobId: row.canonical_protocol_job_id ?? (decimalSchema.safeParse(row.parent_protocol_job_id).success ? row.parent_protocol_job_id : null),
    agent: {
      identity: erc8004IdentitySchema.parse(provider.identity),
      versionId: provider.agentVersionId,
      version: provider.agentVersion,
      name: nullableString(row.agent_name, 200),
      slug: nullableString(row.agent_slug, 200)
    },
    lifecycle: { status: lifecycleStatus, canonicalState },
    price: {
      amountAtomic: decimalSchema.parse(row.price_atomic),
      tokenAddress: row.payment_token === null ? (addressSchema.safeParse(quote.paymentToken).success ? String(quote.paymentToken).toLowerCase() : null) : addressSchema.parse(row.payment_token).toLowerCase(),
      tokenSymbol: nullableString(quote.tokenSymbol, 32),
      decimals: row.payment_decimals ?? (Number.isInteger(quote.paymentDecimals) ? Number(quote.paymentDecimals) : null),
      chainId: row.canonical_chain_id === 56 || row.canonical_chain_id === 97 ? row.canonical_chain_id : quote.chainId === 56 || quote.chainId === 97 ? quote.chainId : null
    },
    createdAt: iso(row.created_at, "job creation time"),
    updatedAt: iso(row.updated_at, "job update time"),
    expiresAt,
    resultAvailable,
    settlementAvailable,
    reviewAvailable: row.result_state === "settled",
    hasReview: row.review_id !== null,
    latestOperation: operation
  };
  const quoteExpired = expiresAt !== null && Date.parse(expiresAt) <= now.getTime();
  return buyerJobSummarySchema.parse({ ...draft, nextAction: nextAction(draft, quoteExpired, row.refund_transaction_hash !== null) });
}

export async function listBuyerJobs(
  pool: Erc8183OperationQueryPool,
  buyerUserId: string,
  query: CommerceJobsQuery,
  now = new Date()
): Promise<CommerceJobsResponse> {
  if (!z.string().uuid().safeParse(buyerUserId).success) throw unavailable(new Error("Invalid authenticated user identity"));
  const cursor = decodeCursor(query.cursor);
  let result: { readonly rows: readonly JobRow[] };
  try {
    result = await pool.query<JobRow>(`
      SELECT c.id AS commerce_job_id, c.erc8183_job_id AS parent_protocol_job_id,
        c.quote, c.price::text AS price_atomic, c.status AS parent_status,
        c."createdAt" AS created_at,
        date_trunc('milliseconds', c."updatedAt") AS updated_at,
        j.erc8183_job_id AS canonical_protocol_job_id, j.state AS canonical_state,
        j.chain_id AS canonical_chain_id, j.payment_token, j.payment_decimals,
        j.expires_at, j.provider_binding, j.refund_transaction_hash,
        result.state AS result_state, review.id AS review_id,
        CASE WHEN jsonb_typeof(version.public_metadata->'name') = 'string' THEN version.public_metadata->>'name' END AS agent_name,
        CASE WHEN jsonb_typeof(version.public_metadata->'slug') = 'string' THEN version.public_metadata->>'slug' END AS agent_slug,
        operation.id AS operation_id, operation.status AS operation_status,
        operation.operation_kind, operation.transaction_hash AS operation_transaction_hash,
        operation.updated_at_unix AS operation_updated_at_unix
      FROM commerce_jobs c
      LEFT JOIN erc8183_jobs j ON j.commerce_job_id = c.id
      LEFT JOIN agent_versions version ON version.id::text = COALESCE(j.provider_binding->>'agentVersionId', c.quote->>'agentVersionId')
      LEFT JOIN commerce_job_results result ON result.commerce_job_id = c.id
      LEFT JOIN LATERAL (
        SELECT r.id FROM commerce_job_reviews r
        WHERE r.commerce_job_id = c.id AND r.buyer_user_id = c.buyer_user_id AND r.review_state = 'active'
        ORDER BY r.revision DESC, r.id DESC LIMIT 1
      ) review ON TRUE
      LEFT JOIN LATERAL (
        SELECT o.id, o.status, o.operation_kind, o.transaction_hash, o.updated_at_unix
        FROM erc8183_operations o
        WHERE o.operation_context #>> '{parameters,commerceJobId}' = c.id::text
        ORDER BY o.updated_at_unix DESC, o.id DESC LIMIT 1
      ) operation ON TRUE
      WHERE c.buyer_user_id = $1
        AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', c."updatedAt"), c.id) < ($2::timestamptz, $3::uuid))
      ORDER BY date_trunc('milliseconds', c."updatedAt") DESC, c.id DESC
      LIMIT $4
    `, [buyerUserId, cursor?.updatedAt ?? null, cursor?.id ?? null, query.limit + 1]);
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw unavailable(cause);
  }
  const page = result.rows.slice(0, query.limit);
  const jobs = page.map((row) => toSummary(row, now));
  return commerceJobsResponseSchema.parse({
    contractVersion: commerceApiContractVersion,
    status: "ready",
    jobs,
    nextCursor: result.rows.length > query.limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
    error: null
  });
}
