import { randomUUID } from "node:crypto";
import { contentDigestSchema, erc8004IdentityKey, erc8004IdentitySchema, normalizeErc8004Identity, normalizeEvmAddress, type Erc8004Identity } from "@bnbera/domain";
import { z } from "zod";
import { erc8183SubmissionPayloadSchema } from "./api.js";
import { CommerceError } from "./errors.js";
import type { Erc8183OperationQueryClient, Erc8183OperationQueryPool } from "./operations.js";
import {
  decimalUintSchema,
  erc8183JobKeySchema,
  erc8183ProviderBindingSchema,
  idempotencyKeySchema,
  nonZeroAddressSchema,
  type Erc8183JobEvent,
  type Erc8183JobRecord,
  type Erc8183ProviderBinding
} from "./types.js";

const uuidSchema = z.string().uuid();
const reviewScoreSchema = z.number().int().min(1).max(5);
const reviewCommentSchema = z.string().trim().max(2_000);
const blockHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/iu);

export const erc8183ReceiptReferenceSchema = z.object({
  transactionHash: blockHashSchema,
  blockNumber: decimalUintSchema,
  blockHash: blockHashSchema,
  logIndex: z.number().int().nonnegative().nullable()
}).strict();
export type Erc8183ReceiptReference = z.infer<typeof erc8183ReceiptReferenceSchema>;

export const erc8183CompletedResultSchema = z.object({
  localSha256: contentDigestSchema,
  chainKeccak: blockHashSchema,
  deliverableUrl: z.string().url().nullable(),
  payload: z.unknown().nullable(),
  submissionReceipt: erc8183ReceiptReferenceSchema,
  settlementReceipt: erc8183ReceiptReferenceSchema,
  submittedAtUnix: z.number().int().positive(),
  settledAtUnix: z.number().int().positive()
}).strict();
export type Erc8183CompletedResult = z.infer<typeof erc8183CompletedResultSchema>;

export const erc8183VerifiedReviewStateSchema = z.enum(["active", "superseded", "revoked"]);
export type Erc8183VerifiedReviewState = z.infer<typeof erc8183VerifiedReviewStateSchema>;

export const erc8183VerifiedReviewSchema = z.object({
  reviewId: uuidSchema,
  commerceJobResultId: uuidSchema,
  commerceJobId: uuidSchema,
  buyerUserId: uuidSchema,
  buyerAddress: nonZeroAddressSchema,
  providerBinding: erc8183ProviderBindingSchema,
  resultSha256: contentDigestSchema,
  resultKeccak: blockHashSchema,
  settlementTransactionHash: blockHashSchema,
  score: reviewScoreSchema,
  comment: reviewCommentSchema,
  state: erc8183VerifiedReviewStateSchema,
  revision: z.number().int().positive(),
  supersedesReviewId: uuidSchema.nullable(),
  createdAtUnix: z.number().int().positive(),
  updatedAtUnix: z.number().int().positive(),
  revokedAtUnix: z.number().int().positive().nullable(),
  revocationReason: z.string().trim().max(240).nullable()
}).strict().superRefine((value, context) => {
  if (value.state === "active" && value.revokedAtUnix !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["revokedAtUnix"], message: "An active review cannot have a revocation timestamp." });
  }
  if (value.state === "revoked" && value.revokedAtUnix === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["revokedAtUnix"], message: "A revoked review must retain its revocation timestamp." });
  }
});
export type Erc8183VerifiedReview = z.infer<typeof erc8183VerifiedReviewSchema>;

export const erc8183CompletedJobSchema = z.object({
  resultId: uuidSchema,
  commerceJobId: uuidSchema,
  jobKey: erc8183JobKeySchema,
  buyerUserId: uuidSchema.nullable(),
  buyerAddress: nonZeroAddressSchema,
  providerBinding: erc8183ProviderBindingSchema,
  result: erc8183CompletedResultSchema,
  settledAtUnix: z.number().int().positive(),
  review: erc8183VerifiedReviewSchema.nullable()
}).strict();
export type Erc8183CompletedJob = z.infer<typeof erc8183CompletedJobSchema>;

export const erc8183MarketplaceIdentityQuerySchema = z.object({
  identity: erc8004IdentitySchema,
  agentVersionId: uuidSchema.optional(),
  agentVersion: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).default(20)
}).strict().superRefine((value, context) => {
  if (value.agentVersion !== undefined && value.agentVersionId === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["agentVersionId"], message: "An agent version number requires its version ID." });
  }
});
export type Erc8183MarketplaceIdentityQuery = z.input<typeof erc8183MarketplaceIdentityQuerySchema>;

export const erc8183MarketplaceReadSchema = z.object({
  completedJobs: z.array(erc8183CompletedJobSchema).max(100),
  verifiedReviews: z.array(erc8183VerifiedReviewSchema).max(100),
  observedAtUnix: z.number().int().positive().nullable()
}).strict();
export type Erc8183MarketplaceRead = z.infer<typeof erc8183MarketplaceReadSchema>;

export const erc8183CreateReviewInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  commerceJobId: uuidSchema,
  buyerUserId: uuidSchema,
  buyerAddress: nonZeroAddressSchema,
  score: reviewScoreSchema,
  comment: reviewCommentSchema.default("")
}).strict();
export type Erc8183CreateReviewInput = z.input<typeof erc8183CreateReviewInputSchema>;

export const erc8183UpdateReviewInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  reviewId: uuidSchema,
  commerceJobId: uuidSchema,
  buyerUserId: uuidSchema,
  buyerAddress: nonZeroAddressSchema,
  score: reviewScoreSchema,
  comment: reviewCommentSchema.default("")
}).strict();
export type Erc8183UpdateReviewInput = z.input<typeof erc8183UpdateReviewInputSchema>;

export const erc8183RevokeReviewInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  reviewId: uuidSchema,
  commerceJobId: uuidSchema,
  buyerUserId: uuidSchema,
  buyerAddress: nonZeroAddressSchema,
  reason: z.string().trim().max(240).default("")
}).strict();
export type Erc8183RevokeReviewInput = z.input<typeof erc8183RevokeReviewInputSchema>;

export interface Erc8183MarketplaceProjection {
  getCompletedJob(input: { readonly commerceJobId: string }): Promise<Erc8183CompletedJob | null>;
  readForIdentity(input: Erc8183MarketplaceIdentityQuery): Promise<Erc8183MarketplaceRead>;
  listReviewHistory(input: { readonly commerceJobId: string; readonly includeInactive?: boolean }): Promise<readonly Erc8183VerifiedReview[]>;
  createReview(input: Erc8183CreateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }>;
  updateReview(input: Erc8183UpdateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }>;
  revokeReview(input: Erc8183RevokeReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }>;
}

type QueryClient = Erc8183OperationQueryClient;

type ResultRow = {
  readonly result_id: string;
  readonly commerce_job_id: string;
  readonly erc8183_job_record_id: string;
  readonly chain_id: number;
  readonly commerce_contract: string;
  readonly protocol_job_id: string;
  readonly result_buyer_user_id: string | null;
  readonly parent_buyer_user_id: string | null;
  readonly buyer_address: string;
  readonly identity_namespace: string;
  readonly identity_chain_id: number;
  readonly identity_registry: string;
  readonly identity_agent_id: string;
  readonly agent_version_id: string;
  readonly agent_version: number;
  readonly provider_address: string;
  readonly provider_binding: unknown;
  readonly result_sha256: string;
  readonly result_keccak: string;
  readonly result_url: string | null;
  readonly result_payload: unknown | null;
  readonly submission_transaction_hash: string;
  readonly submission_block_number: string | number;
  readonly submission_block_hash: string;
  readonly submission_log_index: number | null;
  readonly submitted_at: Date | string;
  readonly state: "submitted" | "settled";
  readonly settlement_transaction_hash: string | null;
  readonly settlement_block_number: string | number | null;
  readonly settlement_block_hash: string | null;
  readonly settlement_log_index: number | null;
  readonly settled_at: Date | string | null;
  readonly parent_status: string;
  readonly canonical_state: string;
};

type ReviewRow = {
  readonly review_id: string;
  readonly commerce_job_result_id: string;
  readonly commerce_job_id: string;
  readonly buyer_user_id: string;
  readonly buyer_address: string;
  readonly identity_namespace: string;
  readonly identity_chain_id: number;
  readonly identity_registry: string;
  readonly identity_agent_id: string;
  readonly agent_version_id: string;
  readonly agent_version: number;
  readonly provider_binding: unknown;
  readonly result_sha256: string;
  readonly result_keccak: string;
  readonly settlement_transaction_hash: string;
  readonly score: number;
  readonly comment: string;
  readonly review_state: Erc8183VerifiedReviewState;
  readonly revision: number;
  readonly supersedes_review_id: string | null;
  readonly idempotency_key?: string;
  readonly revoked_at: Date | string | null;
  readonly revocation_reason: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

const reviewColumns = `
  id AS review_id, commerce_job_result_id, commerce_job_id, buyer_user_id,
  buyer_address, identity_namespace, identity_chain_id, identity_registry,
  identity_agent_id, agent_version_id, agent_version, provider_binding,
  result_sha256, result_keccak, settlement_transaction_hash, score, comment,
  review_state, revision, supersedes_review_id, idempotency_key, revoked_at,
  revocation_reason, "createdAt" AS created_at, "updatedAt" AS updated_at
`;
const reviewSelect = `SELECT ${reviewColumns}`;

const completedResultSelect = `
  SELECT
    r.id AS result_id,
    r.commerce_job_id,
    r.erc8183_job_record_id,
    r.chain_id,
    r.commerce_contract,
    r.protocol_job_id,
    r.buyer_user_id AS result_buyer_user_id,
    c.buyer_user_id AS parent_buyer_user_id,
    r.buyer_address,
    r.identity_namespace,
    r.identity_chain_id,
    r.identity_registry,
    r.identity_agent_id,
    r.agent_version_id,
    r.agent_version,
    r.provider_address,
    r.provider_binding,
    r.result_sha256,
    r.result_keccak,
    r.result_url,
    r.result_payload,
    r.submission_transaction_hash,
    r.submission_block_number,
    r.submission_block_hash,
    r.submission_log_index,
    r.submitted_at,
    r.state,
    r.settlement_transaction_hash,
    r.settlement_block_number,
    r.settlement_block_hash,
    r.settlement_log_index,
    r.settled_at,
    c.status AS parent_status,
    j.state AS canonical_state
  FROM commerce_job_results r
  JOIN commerce_jobs c ON c.id = r.commerce_job_id
  JOIN erc8183_jobs j ON j.id = r.erc8183_job_record_id
`;

function asUnix(value: Date | string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const unix = Math.floor(parsed.getTime() / 1_000);
  if (!Number.isSafeInteger(unix) || unix <= 0) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} timestamp is invalid.` });
  return unix;
}

function asBlock(value: string | number | null, label: string): string | null {
  if (value === null) return null;
  const normalized = String(value);
  if (!/^(0|[1-9][0-9]*)$/u.test(normalized)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} block is invalid.` });
  return normalized;
}

function parsedBinding(value: unknown, row: { readonly identity_namespace: string; readonly identity_chain_id: number; readonly identity_registry: string; readonly identity_agent_id: string; readonly agent_version_id: string; readonly agent_version: number }): Erc8183ProviderBinding {
  const binding = erc8183ProviderBindingSchema.parse(value);
  const identity = normalizeErc8004Identity(binding.identity);
  if (
    identity.namespace !== row.identity_namespace ||
    identity.chainId !== row.identity_chain_id ||
    identity.identityRegistry !== normalizeEvmAddress(row.identity_registry) ||
    identity.agentId !== row.identity_agent_id ||
    binding.agentVersionId.toLowerCase() !== row.agent_version_id.toLowerCase() ||
    binding.agentVersion !== row.agent_version
  ) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted marketplace result identity/version binding is inconsistent." });
  return { ...binding, identity };
}

function receiptFromResultRow(row: ResultRow, kind: "submission" | "settlement"): Erc8183ReceiptReference {
  const transactionHash = kind === "submission" ? row.submission_transaction_hash : row.settlement_transaction_hash;
  const blockNumber = kind === "submission" ? asBlock(row.submission_block_number, "submission") : asBlock(row.settlement_block_number, "settlement");
  const blockHash = kind === "submission" ? row.submission_block_hash : row.settlement_block_hash;
  const logIndex = kind === "submission" ? row.submission_log_index : row.settlement_log_index;
  if (transactionHash === null || blockNumber === null || blockHash === null) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: `The settled result is missing its ${kind} receipt.`, nextAction: "reconcile_transaction" });
  return erc8183ReceiptReferenceSchema.parse({ transactionHash, blockNumber, blockHash, logIndex });
}

function reviewFromRow(row: ReviewRow): Erc8183VerifiedReview {
  const binding = parsedBinding(row.provider_binding, row);
  return erc8183VerifiedReviewSchema.parse({
    reviewId: row.review_id,
    commerceJobResultId: row.commerce_job_result_id,
    commerceJobId: row.commerce_job_id,
    buyerUserId: row.buyer_user_id,
    buyerAddress: normalizeEvmAddress(row.buyer_address),
    providerBinding: binding,
    resultSha256: row.result_sha256,
    resultKeccak: row.result_keccak,
    settlementTransactionHash: row.settlement_transaction_hash,
    score: row.score,
    comment: row.comment,
    state: row.review_state,
    revision: row.revision,
    supersedesReviewId: row.supersedes_review_id,
    createdAtUnix: asUnix(row.created_at, "review created") ?? 0,
    updatedAtUnix: asUnix(row.updated_at, "review updated") ?? 0,
    revokedAtUnix: asUnix(row.revoked_at, "review revocation"),
    revocationReason: row.revocation_reason
  });
}

function completedJobFromRow(row: ResultRow, review: ReviewRow | null): Erc8183CompletedJob {
  if (row.state !== "settled" || row.parent_status !== "settled" || row.canonical_state !== "completed" || row.settled_at === null) {
    throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The marketplace result is not backed by a confirmed settled BNBEra job.", nextAction: "reconcile_job" });
  }
  const providerBinding = parsedBinding(row.provider_binding, row);
  const submittedAtUnix = asUnix(row.submitted_at, "submission") ?? 0;
  const settledAtUnix = asUnix(row.settled_at, "settlement") ?? 0;
  return erc8183CompletedJobSchema.parse({
    resultId: row.result_id,
    commerceJobId: row.commerce_job_id,
    jobKey: { chainId: row.chain_id, commerceContract: row.commerce_contract, jobId: row.protocol_job_id },
    buyerUserId: row.result_buyer_user_id ?? row.parent_buyer_user_id,
    buyerAddress: normalizeEvmAddress(row.buyer_address),
    providerBinding,
    result: {
      localSha256: row.result_sha256,
      chainKeccak: row.result_keccak,
      deliverableUrl: row.result_url,
      payload: row.result_payload,
      submissionReceipt: receiptFromResultRow(row, "submission"),
      settlementReceipt: receiptFromResultRow(row, "settlement"),
      submittedAtUnix,
      settledAtUnix
    },
    settledAtUnix,
    review: review === null ? null : reviewFromRow(review)
  });
}

function normalizeIdentityForQuery(input: Erc8183MarketplaceIdentityQuery): { readonly identity: Erc8004Identity; readonly agentVersionId?: string; readonly agentVersion?: number; readonly limit: number } {
  const parsed = erc8183MarketplaceIdentityQuerySchema.parse(input);
  const identity = normalizeErc8004Identity(parsed.identity);
  return { identity, ...(parsed.agentVersionId === undefined ? {} : { agentVersionId: parsed.agentVersionId }), ...(parsed.agentVersion === undefined ? {} : { agentVersion: parsed.agentVersion }), limit: parsed.limit };
}

function assertAuthenticatedBuyer(input: { readonly buyerUserId: string; readonly buyerAddress: string }, completed: Erc8183CompletedJob): void {
  if (completed.buyerUserId === null || completed.buyerUserId !== input.buyerUserId || completed.buyerAddress.toLowerCase() !== normalizeAddress(input.buyerAddress, "buyer address")) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "Only the authenticated buyer for the settled job may write its verified review.", nextAction: "authenticate_actor" });
  }
}

function normalizeAddress(value: string, label: string): string {
  try { return normalizeEvmAddress(value); } catch (cause) { throw new CommerceError({ code: "INVALID_ADDRESS", message: `The ${label} is invalid.`, cause }); }
}

function isUniqueViolation(value: unknown): boolean {
  return typeof value === "object" && value !== null && "code" in value && (value as { readonly code?: unknown }).code === "23505";
}

/**
 * Persist the public result projection in the same transaction as the
 * canonical ERC-8183 submission event. This function intentionally accepts a
 * query client so a caller cannot accidentally commit a result separately
 * from the receipt-backed lifecycle transition.
 */
export async function persistMarketplaceSubmissionProjection(client: QueryClient, input: {
  readonly jobRecordId: string;
  readonly commerceJobId: string;
  readonly job: Erc8183JobRecord;
  readonly event: Erc8183JobEvent;
}): Promise<void> {
  if (input.event.eventType !== "job_submitted" || input.event.confirmationState !== "canonical" || input.event.transactionHash === null || input.event.blockNumber === null || input.event.blockHash === null) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Only a canonical receipt-backed submission can enter the marketplace result projection.", nextAction: "reconcile_transaction" });
  }
  if (input.job.providerBinding === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A marketplace result requires a full ERC-8004 provider identity/version binding.", nextAction: "manual_review" });
  if (input.job.terms.providerAddress === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A marketplace result requires the canonical provider address.", nextAction: "manual_review" });
  const payload = erc8183SubmissionPayloadSchema.parse(input.event.payload);
  if (input.job.deliverableDigest === null || input.job.deliverableDigest.toLowerCase() !== payload.resultDigest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The marketplace result SHA-256 does not match the canonical job projection.", nextAction: "manual_review" });
  const binding = erc8183ProviderBindingSchema.parse(input.job.providerBinding);
  const identity = normalizeErc8004Identity(binding.identity);
  if (identity.chainId !== input.job.jobKey.chainId) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The provider identity chain does not match the settled commerce job chain.", nextAction: "manual_review" });
  const resultPayload = payload.result === null || payload.result === undefined ? null : payload.result;
  await client.query(`
    INSERT INTO commerce_job_results (
      commerce_job_id, erc8183_job_record_id, chain_id, commerce_contract,
      protocol_job_id, buyer_user_id, buyer_address, identity_namespace,
      identity_chain_id, identity_registry, identity_agent_id, agent_version_id,
      agent_version, provider_address, provider_binding, result_sha256,
      result_keccak, result_url, result_payload, submission_transaction_hash,
      submission_block_number, submission_block_hash, submission_log_index,
      submitted_at, state, "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5,
      (SELECT buyer_user_id FROM commerce_jobs WHERE id = $1), $6, $7,
      $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18::jsonb,
      $19, $20, $21, $22, $23, 'submitted', $23, $23
    )
    ON CONFLICT (erc8183_job_record_id) DO NOTHING
  `, [
    input.commerceJobId,
    input.jobRecordId,
    input.job.jobKey.chainId,
    input.job.jobKey.commerceContract,
    input.job.jobKey.jobId,
    input.job.terms.clientAddress,
    identity.namespace,
    identity.chainId,
    identity.identityRegistry,
    identity.agentId,
    binding.agentVersionId,
    binding.agentVersion,
    input.job.terms.providerAddress,
    JSON.stringify(binding),
    payload.resultDigest.toLowerCase(),
    payload.chainDeliverable.toLowerCase(),
    payload.deliverableUrl ?? null,
    resultPayload === null ? null : JSON.stringify(resultPayload),
    input.event.transactionHash,
    input.event.blockNumber,
    input.event.blockHash,
    input.event.logIndex,
    new Date(input.event.observedAtUnix * 1_000)
  ]);
  await client.query(`
    UPDATE commerce_jobs
       SET erc8183_job_id = $2,
           status = CASE WHEN status IN ('draft', 'negotiating', 'funded', 'accepted') THEN 'submitted' ELSE status END,
           fulfillment_transaction_hash = COALESCE(fulfillment_transaction_hash, $3),
           "updatedAt" = now()
     WHERE id = $1
  `, [input.commerceJobId, input.job.jobKey.jobId, input.event.transactionHash]);
}

/** Complete the result projection only after the canonical settlement receipt. */
export async function persistMarketplaceSettlementProjection(client: QueryClient, input: {
  readonly jobRecordId: string;
  readonly commerceJobId: string;
  readonly job: Erc8183JobRecord;
  readonly event: Erc8183JobEvent;
}): Promise<void> {
  if (input.event.eventType !== "job_completed" || input.event.nextState !== "completed" || input.event.confirmationState !== "canonical" || input.event.transactionHash === null || input.event.blockNumber === null || input.event.blockHash === null) {
    throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Only a canonical receipt-backed settlement can complete the marketplace result projection.", nextAction: "reconcile_transaction" });
  }
  const updated = await client.query<{ readonly id: string }>(`
    UPDATE commerce_job_results
       SET state = 'settled', settlement_transaction_hash = $2,
           settlement_block_number = $3, settlement_block_hash = $4,
           settlement_log_index = $5, settled_at = $6, "updatedAt" = $6
     WHERE erc8183_job_record_id = $1 AND state = 'submitted'
     RETURNING id
  `, [input.jobRecordId, input.event.transactionHash, input.event.blockNumber, input.event.blockHash, input.event.logIndex, new Date(input.event.observedAtUnix * 1_000)]);
  if (updated.rows[0] === undefined) {
    const existing = await client.query<{ readonly state: string; readonly settlement_transaction_hash: string | null }>(`SELECT state, settlement_transaction_hash FROM commerce_job_results WHERE erc8183_job_record_id = $1`, [input.jobRecordId]);
    const row = existing.rows[0];
    if (row?.state !== "settled" || row.settlement_transaction_hash?.toLowerCase() !== input.event.transactionHash.toLowerCase()) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The canonical settlement has no matching submitted marketplace result projection.", nextAction: "reconcile_job" });
  }
  await client.query(`
    UPDATE commerce_jobs
       SET erc8183_job_id = $2, status = 'settled',
           settlement_transaction_hash = COALESCE(settlement_transaction_hash, $3),
           "updatedAt" = now()
     WHERE id = $1
  `, [input.commerceJobId, input.job.jobKey.jobId, input.event.transactionHash]);
}

/**
 * Project a confirmed protocol refund onto the buyer-facing commerce job.
 *
 * The ERC-8183 row/event pair is the source of truth for a refund.  Keep this
 * projection deliberately narrow: a parent may only become cancelled from an
 * active funded/submitted lifecycle, and a replay is accepted only when the
 * parent is already cancelled for this same protocol job.  This function is
 * called by the canonical-job repository while its transition transaction is
 * still open, so a missing or mismatched refund proof rolls back both the
 * protocol transition and the parent projection.
 */
export async function persistMarketplaceRefundProjection(client: QueryClient, input: {
  readonly jobRecordId: string;
  readonly commerceJobId: string;
  readonly job: Erc8183JobRecord;
  readonly event: Erc8183JobEvent;
}): Promise<void> {
  const event = input.event;
  const job = input.job;
  const refundTransactionHash = job.refundTransactionHash;
  if (
    event.eventType !== "job_expired" ||
    (event.previousState !== "funded" && event.previousState !== "submitted") ||
    event.nextState !== "expired" ||
    event.confirmationState !== "canonical" ||
    event.transactionHash === null ||
    event.blockNumber === null ||
    event.blockHash === null
  ) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "Only a canonical receipt-backed refund can cancel the marketplace job.",
      nextAction: "manual_review",
      ...(event.transactionHash === null ? {} : { transactionHash: event.transactionHash as `0x${string}` })
    });
  }
  const eventTransactionHash = event.transactionHash as `0x${string}`;
  if (job.state !== "expired" || refundTransactionHash === null) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The canonical expired job is missing its confirmed refund evidence.",
      nextAction: "manual_review",
      transactionHash: eventTransactionHash
    });
  }
  if (refundTransactionHash.toLowerCase() !== eventTransactionHash.toLowerCase()) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The canonical refund hash does not match its receipt-backed expiry event.",
      nextAction: "manual_review",
      transactionHash: eventTransactionHash
    });
  }
  if (event.actorAddress === null || event.actorAddress.toLowerCase() !== job.terms.clientAddress.toLowerCase()) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The canonical refund event actor does not match the ERC-8183 client.",
      nextAction: "manual_review",
      transactionHash: eventTransactionHash
    });
  }
  if (
    event.jobKey.chainId !== job.jobKey.chainId ||
    event.jobKey.commerceContract.toLowerCase() !== job.jobKey.commerceContract.toLowerCase() ||
    event.jobKey.jobId !== job.jobKey.jobId
  ) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The canonical refund event is bound to a different ERC-8183 job.",
      nextAction: "manual_review",
      transactionHash: eventTransactionHash
    });
  }

  const updated = await client.query<{ readonly id: string }>(`
    UPDATE commerce_jobs
       SET erc8183_job_id = $2,
           status = 'cancelled',
           "updatedAt" = now()
     WHERE id = $1
       AND (erc8183_job_id = $2 OR erc8183_job_id LIKE 'draft:%' OR erc8183_job_id LIKE 'intent:%')
       AND (
         status IN ('funded', 'accepted', 'submitted', 'disputed')
         OR (status = 'cancelled' AND erc8183_job_id = $2)
       )
     RETURNING id
  `, [input.commerceJobId, job.jobKey.jobId]);
  if (updated.rows[0] === undefined) {
    throw new CommerceError({
      code: "ONCHAIN_MISMATCH",
      message: "The confirmed refund could not be bound to an eligible parent commerce job.",
      nextAction: "manual_review",
      transactionHash: eventTransactionHash
    });
  }
}

async function readReviewForResult(client: QueryClient, resultId: string, includeInactive = false): Promise<ReviewRow | null> {
  const stateClause = includeInactive ? "" : " AND review_state = 'active'";
  const result = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE commerce_job_result_id = $1${stateClause} ORDER BY revision DESC, id DESC LIMIT 1`, [resultId]);
  return result.rows[0] ?? null;
}

export class PostgresErc8183MarketplaceProjection implements Erc8183MarketplaceProjection {
  public constructor(private readonly pool: Erc8183OperationQueryPool) {}

  public async getCompletedJob(input: { readonly commerceJobId: string }): Promise<Erc8183CompletedJob | null> {
    uuidSchema.parse(input.commerceJobId);
    const result = await this.pool.query<ResultRow>(`${completedResultSelect} WHERE r.commerce_job_id = $1 AND r.state = 'settled' AND r.settled_at IS NOT NULL AND c.status = 'settled' AND j.state = 'completed' LIMIT 1`, [input.commerceJobId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    const review = await readReviewForResult(this.pool, row.result_id);
    return completedJobFromRow(row, review);
  }

  public async readForIdentity(input: Erc8183MarketplaceIdentityQuery): Promise<Erc8183MarketplaceRead> {
    const query = normalizeIdentityForQuery(input);
    const values: unknown[] = [query.identity.namespace, query.identity.chainId, query.identity.identityRegistry, query.identity.agentId];
    const filters = [
      "r.identity_namespace = $1",
      "r.identity_chain_id = $2",
      "r.identity_registry = $3",
      "r.identity_agent_id = $4",
      "r.state = 'settled'",
      "r.settled_at IS NOT NULL",
      "c.status = 'settled'",
      "j.state = 'completed'"
    ];
    if (query.agentVersionId !== undefined) { values.push(query.agentVersionId); filters.push(`r.agent_version_id = $${values.length}`); }
    if (query.agentVersion !== undefined) { values.push(query.agentVersion); filters.push(`r.agent_version = $${values.length}`); }
    values.push(query.limit);
    const rows = await this.pool.query<ResultRow>(`${completedResultSelect} WHERE ${filters.join(" AND ")} ORDER BY r.settled_at DESC, r.id DESC LIMIT $${values.length}`, values);
    const completedJobs: Erc8183CompletedJob[] = [];
    const verifiedReviews: Erc8183VerifiedReview[] = [];
    for (const row of rows.rows) {
      const review = await readReviewForResult(this.pool, row.result_id);
      const job = completedJobFromRow(row, review);
      completedJobs.push(job);
      if (job.review !== null) verifiedReviews.push(job.review);
    }
    const observedAtUnix = completedJobs[0]?.settledAtUnix ?? null;
    return erc8183MarketplaceReadSchema.parse({ completedJobs, verifiedReviews, observedAtUnix });
  }

  public async listReviewHistory(input: { readonly commerceJobId: string; readonly includeInactive?: boolean }): Promise<readonly Erc8183VerifiedReview[]> {
    const completed = await this.getCompletedJob({ commerceJobId: input.commerceJobId });
    if (completed === null) return [];
    const stateClause = input.includeInactive === true ? "" : " AND review_state = 'active'";
    const rows = await this.pool.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE commerce_job_id = $1${stateClause} ORDER BY revision ASC, id ASC LIMIT 100`, [input.commerceJobId]);
    return rows.rows.map(reviewFromRow);
  }

  public async createReview(input: Erc8183CreateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183CreateReviewInputSchema.parse(input);
    const completed = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (completed === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "A verified review requires a confirmed settled BNBEra job.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, completed);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE buyer_user_id = $1 AND idempotency_key = $2 LIMIT 1`, [parsed.buyerUserId, parsed.idempotencyKey]);
      if (prior.rows[0] !== undefined) {
        await client.query("COMMIT");
        return { review: reviewFromRow(prior.rows[0]), replayed: true };
      }
      const active = await client.query<{ readonly id: string }>(`SELECT id FROM commerce_job_reviews WHERE commerce_job_result_id = $1 AND review_state = 'active' FOR UPDATE`, [completed.resultId]);
      if (active.rows[0] !== undefined) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "This completed job already has an active verified-purchase review.", nextAction: "update_review" });
      const revisionResult = await client.query<{ readonly revision: number | null }>(`SELECT MAX(revision) AS revision FROM commerce_job_reviews WHERE commerce_job_id = $1`, [completed.commerceJobId]);
      const revision = (revisionResult.rows[0]?.revision ?? 0) + 1;
      const inserted = await client.query<{ readonly id: string }>(`
        INSERT INTO commerce_job_reviews (
          commerce_job_result_id, commerce_job_id, buyer_user_id, buyer_address,
          identity_namespace, identity_chain_id, identity_registry, identity_agent_id,
          agent_version_id, agent_version, provider_binding, result_sha256,
          result_keccak, settlement_transaction_hash, score, comment, review_state,
          revision, active_review_key, supersedes_review_id, idempotency_key,
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                  $12, $13, $14, $15, $16, 'active', $17, $1, NULL, $18, $19, $19)
        RETURNING id
      `, [
        completed.resultId,
        completed.commerceJobId,
        parsed.buyerUserId,
        normalizeAddress(parsed.buyerAddress, "buyer address"),
        completed.providerBinding.identity.namespace,
        completed.providerBinding.identity.chainId,
        completed.providerBinding.identity.identityRegistry,
        completed.providerBinding.identity.agentId,
        completed.providerBinding.agentVersionId,
        completed.providerBinding.agentVersion,
        JSON.stringify(completed.providerBinding),
        completed.result.localSha256,
        completed.result.chainKeccak,
        completed.result.settlementReceipt.transactionHash,
        parsed.score,
        parsed.comment,
        revision,
        parsed.idempotencyKey,
        new Date()
      ]);
      const insertedId = inserted.rows[0]?.id;
      if (insertedId === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The verified review insert returned no row." });
      const row = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE id = $1`, [insertedId]);
      await client.query("COMMIT");
      if (row.rows[0] === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The verified review disappeared during persistence." });
      return { review: reviewFromRow(row.rows[0]), replayed: false };
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* retain original error */ }
      if (cause instanceof CommerceError) throw cause;
      if (isUniqueViolation(cause)) {
        const prior = await this.pool.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE buyer_user_id = $1 AND idempotency_key = $2 LIMIT 1`, [parsed.buyerUserId, parsed.idempotencyKey]);
        if (prior.rows[0] !== undefined) return { review: reviewFromRow(prior.rows[0]), replayed: true };
      }
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The verified review could not be persisted.", cause });
    } finally { client.release(); }
  }

  public async updateReview(input: Erc8183UpdateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183UpdateReviewInputSchema.parse(input);
    const completed = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (completed === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "A verified review requires a confirmed settled BNBEra job.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, completed);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE buyer_user_id = $1 AND idempotency_key = $2 LIMIT 1`, [parsed.buyerUserId, parsed.idempotencyKey]);
      if (prior.rows[0] !== undefined) {
        await client.query("COMMIT");
        return { review: reviewFromRow(prior.rows[0]), replayed: true };
      }
      const currentResult = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE id = $1 AND commerce_job_id = $2 AND buyer_user_id = $3 AND review_state = 'active' FOR UPDATE`, [parsed.reviewId, parsed.commerceJobId, parsed.buyerUserId]);
      const current = currentResult.rows[0];
      if (current === undefined) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The active verified review was not found.", nextAction: "reload_review" });
      await client.query(`UPDATE commerce_job_reviews SET review_state = 'superseded', active_review_key = NULL, "updatedAt" = now() WHERE id = $1`, [current.review_id]);
      const inserted = await client.query<{ readonly id: string }>(`
        INSERT INTO commerce_job_reviews (
          commerce_job_result_id, commerce_job_id, buyer_user_id, buyer_address,
          identity_namespace, identity_chain_id, identity_registry, identity_agent_id,
          agent_version_id, agent_version, provider_binding, result_sha256,
          result_keccak, settlement_transaction_hash, score, comment, review_state,
          revision, active_review_key, supersedes_review_id, idempotency_key,
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                  $12, $13, $14, $15, $16, 'active', $17, $1, $18, $19, $20, $20)
        RETURNING id
      `, [
        completed.resultId,
        completed.commerceJobId,
        parsed.buyerUserId,
        normalizeAddress(parsed.buyerAddress, "buyer address"),
        completed.providerBinding.identity.namespace,
        completed.providerBinding.identity.chainId,
        completed.providerBinding.identity.identityRegistry,
        completed.providerBinding.identity.agentId,
        completed.providerBinding.agentVersionId,
        completed.providerBinding.agentVersion,
        JSON.stringify(completed.providerBinding),
        completed.result.localSha256,
        completed.result.chainKeccak,
        completed.result.settlementReceipt.transactionHash,
        parsed.score,
        parsed.comment,
        current.revision + 1,
        current.review_id,
        parsed.idempotencyKey,
        new Date()
      ]);
      const insertedId = inserted.rows[0]?.id;
      if (insertedId === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The verified review update returned no row." });
      const row = await client.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE id = $1`, [insertedId]);
      await client.query("COMMIT");
      if (row.rows[0] === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The updated verified review disappeared during persistence." });
      return { review: reviewFromRow(row.rows[0]), replayed: false };
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* retain original error */ }
      if (cause instanceof CommerceError) throw cause;
      if (isUniqueViolation(cause)) {
        const prior = await this.pool.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE buyer_user_id = $1 AND idempotency_key = $2 LIMIT 1`, [parsed.buyerUserId, parsed.idempotencyKey]);
        if (prior.rows[0] !== undefined) return { review: reviewFromRow(prior.rows[0]), replayed: true };
      }
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The verified review update could not be persisted.", cause });
    } finally { client.release(); }
  }

  public async revokeReview(input: Erc8183RevokeReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183RevokeReviewInputSchema.parse(input);
    const completed = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (completed === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The reviewed job is not a confirmed settlement.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, completed);
    const result = await this.pool.query<ReviewRow>(`
      UPDATE commerce_job_reviews
         SET review_state = 'revoked', active_review_key = NULL,
             revoked_at = COALESCE(revoked_at, now()), revocation_reason = $4,
             idempotency_key = $5, "updatedAt" = now()
       WHERE id = $1 AND commerce_job_id = $2 AND buyer_user_id = $3 AND review_state = 'active'
       RETURNING ${reviewColumns}
    `, [parsed.reviewId, parsed.commerceJobId, parsed.buyerUserId, parsed.reason, parsed.idempotencyKey]);
    if (result.rows[0] !== undefined) return { review: reviewFromRow(result.rows[0]), replayed: false };
    const existing = await this.pool.query<ReviewRow>(`${reviewSelect} FROM commerce_job_reviews WHERE id = $1 AND buyer_user_id = $2`, [parsed.reviewId, parsed.buyerUserId]);
    if (existing.rows[0]?.review_state === "revoked") return { review: reviewFromRow(existing.rows[0]), replayed: true };
    throw new CommerceError({ code: "UNKNOWN_JOB", message: "The active verified review was not found.", nextAction: "reload_review" });
  }
}

/** Small process-local contract used by focused tests and preview composition. */
export class InMemoryErc8183MarketplaceProjection implements Erc8183MarketplaceProjection {
  private readonly jobs = new Map<string, Erc8183CompletedJob>();
  private readonly reviews = new Map<string, Erc8183VerifiedReview[]>();
  private readonly idempotency = new Map<string, Erc8183VerifiedReview>();

  public constructor(completedJobs: readonly Erc8183CompletedJob[] = []) {
    for (const job of completedJobs) {
      const parsed = erc8183CompletedJobSchema.parse(job);
      this.jobs.set(parsed.commerceJobId, structuredClone(parsed));
      if (parsed.review !== null) this.reviews.set(parsed.commerceJobId, [structuredClone(parsed.review)]);
    }
  }

  public async getCompletedJob(input: { readonly commerceJobId: string }): Promise<Erc8183CompletedJob | null> {
    const job = this.jobs.get(input.commerceJobId);
    if (job === undefined) return null;
    const active = this.activeReview(input.commerceJobId);
    return structuredClone({ ...job, review: active });
  }

  public async readForIdentity(input: Erc8183MarketplaceIdentityQuery): Promise<Erc8183MarketplaceRead> {
    const query = normalizeIdentityForQuery(input);
    const jobs = [...this.jobs.values()]
      .filter((job) => erc8004IdentityKey(job.providerBinding.identity) === erc8004IdentityKey(query.identity))
      .filter((job) => query.agentVersionId === undefined || job.providerBinding.agentVersionId === query.agentVersionId)
      .filter((job) => query.agentVersion === undefined || job.providerBinding.agentVersion === query.agentVersion)
      .sort((a, b) => b.settledAtUnix - a.settledAtUnix)
      .slice(0, query.limit)
      .map((job) => ({ ...job, review: this.activeReview(job.commerceJobId) }));
    return erc8183MarketplaceReadSchema.parse({
      completedJobs: jobs,
      verifiedReviews: jobs.flatMap((job) => job.review === null ? [] : [job.review]),
      observedAtUnix: jobs[0]?.settledAtUnix ?? null
    });
  }

  public async listReviewHistory(input: { readonly commerceJobId: string; readonly includeInactive?: boolean }): Promise<readonly Erc8183VerifiedReview[]> {
    const values = this.reviews.get(input.commerceJobId) ?? [];
    return structuredClone(input.includeInactive === true ? values : values.filter((review) => review.state === "active"));
  }

  public async createReview(input: Erc8183CreateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183CreateReviewInputSchema.parse(input);
    const job = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (job === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "A verified review requires a confirmed settled BNBEra job.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, job);
    const key = `${parsed.buyerUserId}:${parsed.idempotencyKey}`;
    const prior = this.idempotency.get(key);
    if (prior !== undefined) return { review: structuredClone(prior), replayed: true };
    if (this.activeReview(parsed.commerceJobId) !== null) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "This completed job already has an active verified-purchase review.", nextAction: "update_review" });
    const revision = (this.reviews.get(parsed.commerceJobId)?.reduce((max, review) => Math.max(max, review.revision), 0) ?? 0) + 1;
    const review = erc8183VerifiedReviewSchema.parse({
      reviewId: randomUUID(),
      commerceJobResultId: job.resultId,
      commerceJobId: job.commerceJobId,
      buyerUserId: parsed.buyerUserId,
      buyerAddress: normalizeAddress(parsed.buyerAddress, "buyer address"),
      providerBinding: job.providerBinding,
      resultSha256: job.result.localSha256,
      resultKeccak: job.result.chainKeccak,
      settlementTransactionHash: job.result.settlementReceipt.transactionHash,
      score: parsed.score,
      comment: parsed.comment,
      state: "active",
      revision,
      supersedesReviewId: null,
      createdAtUnix: Math.floor(Date.now() / 1_000),
      updatedAtUnix: Math.floor(Date.now() / 1_000),
      revokedAtUnix: null,
      revocationReason: null
    });
    const values = this.reviews.get(parsed.commerceJobId) ?? [];
    values.push(review);
    this.reviews.set(parsed.commerceJobId, values);
    this.idempotency.set(key, review);
    return { review: structuredClone(review), replayed: false };
  }

  public async updateReview(input: Erc8183UpdateReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183UpdateReviewInputSchema.parse(input);
    const job = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (job === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "A verified review requires a confirmed settled BNBEra job.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, job);
    const key = `${parsed.buyerUserId}:${parsed.idempotencyKey}`;
    const prior = this.idempotency.get(key);
    if (prior !== undefined) return { review: structuredClone(prior), replayed: true };
    const current = this.activeReview(parsed.commerceJobId);
    if (current === null || current.reviewId !== parsed.reviewId) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The active verified review was not found.", nextAction: "reload_review" });
    const rows = this.reviews.get(parsed.commerceJobId) ?? [];
    const index = rows.findIndex((review) => review.reviewId === current.reviewId);
    rows[index] = { ...current, state: "superseded", updatedAtUnix: Math.floor(Date.now() / 1_000), revokedAtUnix: null };
    const now = Math.floor(Date.now() / 1_000);
    const next = erc8183VerifiedReviewSchema.parse({ ...current, reviewId: randomUUID(), score: parsed.score, comment: parsed.comment, state: "active", revision: current.revision + 1, supersedesReviewId: current.reviewId, createdAtUnix: now, updatedAtUnix: now, revokedAtUnix: null, revocationReason: null });
    rows.push(next);
    this.reviews.set(parsed.commerceJobId, rows);
    this.idempotency.set(key, next);
    return { review: structuredClone(next), replayed: false };
  }

  public async revokeReview(input: Erc8183RevokeReviewInput): Promise<{ readonly review: Erc8183VerifiedReview; readonly replayed: boolean }> {
    const parsed = erc8183RevokeReviewInputSchema.parse(input);
    const job = await this.getCompletedJob({ commerceJobId: parsed.commerceJobId });
    if (job === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The reviewed job is not a confirmed settlement.", nextAction: "wait_for_settlement" });
    assertAuthenticatedBuyer({ buyerUserId: parsed.buyerUserId, buyerAddress: parsed.buyerAddress }, job);
    const current = this.activeReview(parsed.commerceJobId);
    if (current === null || current.reviewId !== parsed.reviewId) {
      const history = this.reviews.get(parsed.commerceJobId) ?? [];
      const existing = history.find((review) => review.reviewId === parsed.reviewId && review.state === "revoked");
      if (existing !== undefined) return { review: structuredClone(existing), replayed: true };
      throw new CommerceError({ code: "UNKNOWN_JOB", message: "The active verified review was not found.", nextAction: "reload_review" });
    }
    const rows = this.reviews.get(parsed.commerceJobId) ?? [];
    const index = rows.findIndex((review) => review.reviewId === current.reviewId);
    const now = Math.floor(Date.now() / 1_000);
    const next = erc8183VerifiedReviewSchema.parse({ ...current, state: "revoked", updatedAtUnix: now, revokedAtUnix: now, revocationReason: parsed.reason });
    rows[index] = next;
    this.reviews.set(parsed.commerceJobId, rows);
    return { review: structuredClone(next), replayed: false };
  }

  private activeReview(commerceJobId: string): Erc8183VerifiedReview | null {
    return (this.reviews.get(commerceJobId) ?? []).find((review) => review.state === "active") ?? null;
  }
}
