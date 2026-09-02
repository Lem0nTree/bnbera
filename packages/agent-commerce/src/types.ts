import { z } from "zod";
import {
  contentDigestSchema,
  evmAddressSchema,
  transactionHashSchema
} from "@bnbera/domain";

export const bscChainIds = [56, 97] as const;
export const bscChainIdSchema = z.union([z.literal(56), z.literal(97)]);
export type BscChainId = z.infer<typeof bscChainIdSchema>;

export const decimalUintSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Expected a non-negative decimal integer");
export type DecimalUint = z.infer<typeof decimalUintSchema>;

export const positiveDecimalUintSchema = decimalUintSchema.refine(
  (value) => value !== "0",
  "Expected a positive decimal integer"
);

export const nonZeroAddressSchema = evmAddressSchema.refine(
  (value) => !/^0x0{40}$/i.test(value),
  "The zero address is not valid for this role"
);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid idempotency key");
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const unixSecondsSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const erc8183JobStates = [
  "open",
  "funded",
  "submitted",
  "completed",
  "rejected",
  "expired"
] as const;
export const erc8183JobStateSchema = z.enum(erc8183JobStates);
export type Erc8183JobState = z.infer<typeof erc8183JobStateSchema>;

export const erc8183ActionTypes = [
  "create",
  "set_provider",
  "set_budget",
  "fund",
  "submit",
  "complete",
  "reject",
  "claim_refund",
  "reconcile"
] as const;
export const erc8183ActionTypeSchema = z.enum(erc8183ActionTypes);
export type Erc8183ActionType = z.infer<typeof erc8183ActionTypeSchema>;

export const erc8183ActorRoles = ["client", "provider", "evaluator", "any"] as const;
export const erc8183ActorRoleSchema = z.enum(erc8183ActorRoles);
export type Erc8183ActorRole = z.infer<typeof erc8183ActorRoleSchema>;

export const erc8183JobKeySchema = z.object({
  chainId: bscChainIdSchema,
  commerceContract: nonZeroAddressSchema,
  jobId: decimalUintSchema
}).strict();
export type Erc8183JobKey = z.infer<typeof erc8183JobKeySchema>;

const enabledErc8183DeploymentPinSchema = z.object({
  enabled: z.literal(true),
  chainId: bscChainIdSchema,
  specRevision: z.string().trim().min(1).max(160),
  commerceContract: nonZeroAddressSchema,
  paymentToken: nonZeroAddressSchema,
  paymentDecimals: z.number().int().min(0).max(255),
  abiHash: contentDigestSchema,
  evaluatorProfile: z.string().trim().min(1).max(160),
  confirmationThreshold: z.number().int().positive().max(1_000_000),
  minExpiryLeadSeconds: z.number().int().positive().max(7 * 24 * 60 * 60),
  maxExpiryHorizonSeconds: z.number().int().positive().max(365 * 24 * 60 * 60),
  minBudgetAtomic: decimalUintSchema,
  maxBudgetAtomic: positiveDecimalUintSchema
}).strict();

export const erc8183DeploymentPinSchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(false),
    chainId: bscChainIdSchema,
    disabledReason: z.string().trim().min(1).max(500)
  }).strict(),
  enabledErc8183DeploymentPinSchema
]).superRefine((value, ctx) => {
  if (!value.enabled) return;
  try {
    if (BigInt(value.minBudgetAtomic) > BigInt(value.maxBudgetAtomic)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxBudgetAtomic"], message: "Maximum budget must be at least the minimum" });
    }
    if (value.minExpiryLeadSeconds > value.maxExpiryHorizonSeconds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxExpiryHorizonSeconds"], message: "Expiry horizon must be at least the lead time" });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minBudgetAtomic"], message: "Budget values must be valid uint256 decimals" });
  }
});
export type Erc8183DeploymentPin = z.infer<typeof erc8183DeploymentPinSchema>;
export type EnabledErc8183DeploymentPin = Extract<Erc8183DeploymentPin, { enabled: true }>;

export const erc8183JobTermsSchema = z.object({
  chainId: bscChainIdSchema,
  commerceContract: nonZeroAddressSchema,
  paymentToken: nonZeroAddressSchema,
  paymentDecimals: z.number().int().min(0).max(255),
  clientAddress: nonZeroAddressSchema,
  providerAddress: nonZeroAddressSchema.nullable(),
  evaluatorAddress: nonZeroAddressSchema,
  hookAddress: nonZeroAddressSchema.nullable(),
  budgetAtomic: decimalUintSchema,
  descriptionDigest: contentDigestSchema,
  expiresAtUnix: unixSecondsSchema
}).strict();
export type Erc8183JobTerms = z.infer<typeof erc8183JobTermsSchema>;

export const erc8183JobRecordSchema = z.object({
  jobKey: erc8183JobKeySchema,
  terms: erc8183JobTermsSchema,
  state: erc8183JobStateSchema,
  createdAtUnix: unixSecondsSchema,
  updatedAtUnix: unixSecondsSchema,
  deliverableDigest: contentDigestSchema.nullable(),
  fundingTransactionHash: transactionHashSchema.nullable(),
  submissionTransactionHash: transactionHashSchema.nullable(),
  completionTransactionHash: transactionHashSchema.nullable(),
  rejectionTransactionHash: transactionHashSchema.nullable(),
  refundTransactionHash: transactionHashSchema.nullable(),
  lastObservedBlock: decimalUintSchema.nullable(),
  lastObservedBlockHash: transactionHashSchema.nullable(),
  lastObservedAtUnix: unixSecondsSchema.nullable()
}).strict().superRefine((value, ctx) => {
  if (value.jobKey.chainId !== value.terms.chainId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jobKey", "chainId"], message: "Job key chain must match the job terms." });
  }
  if (value.jobKey.commerceContract.toLowerCase() !== value.terms.commerceContract.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["jobKey", "commerceContract"], message: "Job key commerce contract must match the job terms." });
  }
});
export type Erc8183JobRecord = z.infer<typeof erc8183JobRecordSchema>;

export const erc8183QuoteSchema = z.object({
  quoteId: z.string().trim().min(1).max(160),
  jobKey: erc8183JobKeySchema,
  chainId: bscChainIdSchema,
  commerceContract: nonZeroAddressSchema,
  paymentToken: nonZeroAddressSchema,
  paymentDecimals: z.number().int().min(0).max(255),
  providerAddress: nonZeroAddressSchema,
  descriptionDigest: contentDigestSchema,
  minPriceAtomic: decimalUintSchema,
  maxPriceAtomic: positiveDecimalUintSchema,
  priceAtomic: decimalUintSchema,
  issuedAtUnix: unixSecondsSchema,
  expiresAtUnix: unixSecondsSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().superRefine((value, ctx) => {
  try {
    const min = BigInt(value.minPriceAtomic);
    const max = BigInt(value.maxPriceAtomic);
    const price = BigInt(value.priceAtomic);
    if (min > max) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPriceAtomic"], message: "Maximum price must be at least the minimum" });
    if (price < min || price > max) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceAtomic"], message: "Price must be within the quoted range" });
    if (value.expiresAtUnix <= value.issuedAtUnix) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAtUnix"], message: "Quote expiry must follow issuance" });
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["priceAtomic"], message: "Price values must be valid uint256 decimals" });
  }
});
export type Erc8183Quote = z.infer<typeof erc8183QuoteSchema>;

export const erc8183EventTypes = [
  "job_created",
  "provider_set",
  "budget_set",
  "job_funded",
  "job_submitted",
  "job_completed",
  "job_rejected",
  "job_expired",
  "reconciliation_requested",
  "reconciliation_succeeded",
  "reconciliation_failed"
] as const;
export const erc8183EventTypeSchema = z.enum(erc8183EventTypes);
export type Erc8183EventType = z.infer<typeof erc8183EventTypeSchema>;

export const confirmationStates = ["provisional", "canonical", "orphaned"] as const;
export const confirmationStateSchema = z.enum(confirmationStates);
export type ConfirmationState = z.infer<typeof confirmationStateSchema>;

export const erc8183JobEventSchema = z.object({
  eventId: z.string().uuid(),
  eventKey: z.string().trim().min(1).max(240),
  jobKey: erc8183JobKeySchema,
  eventType: erc8183EventTypeSchema,
  previousState: erc8183JobStateSchema.nullable(),
  nextState: erc8183JobStateSchema.nullable(),
  actorAddress: nonZeroAddressSchema.nullable(),
  transactionHash: transactionHashSchema.nullable(),
  blockNumber: decimalUintSchema.nullable(),
  blockHash: transactionHashSchema.nullable(),
  logIndex: z.number().int().nonnegative().nullable(),
  confirmationState: confirmationStateSchema,
  payloadDigest: contentDigestSchema,
  payload: z.unknown(),
  correlationId: z.string().trim().min(1).max(160),
  observedAtUnix: unixSecondsSchema
}).strict();
export type Erc8183JobEvent = z.infer<typeof erc8183JobEventSchema>;

export const reconciliationStates = [
  "pending",
  "in_progress",
  "reconciled",
  "failed",
  "manual_review"
] as const;
export const reconciliationStateSchema = z.enum(reconciliationStates);
export type ReconciliationState = z.infer<typeof reconciliationStateSchema>;

export const erc8183ReconciliationSchema = z.object({
  reconciliationId: z.string().uuid(),
  jobKey: erc8183JobKeySchema,
  state: reconciliationStateSchema,
  reasonCode: z.string().trim().min(1).max(80),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAtUnix: unixSecondsSchema.nullable(),
  lastObservedTransactionHash: transactionHashSchema.nullable(),
  lastObservedBlock: decimalUintSchema.nullable(),
  detailDigest: contentDigestSchema.nullable(),
  createdAtUnix: unixSecondsSchema,
  updatedAtUnix: unixSecondsSchema
}).strict();
export type Erc8183Reconciliation = z.infer<typeof erc8183ReconciliationSchema>;

export interface Erc8183ActionMetadata {
  readonly deliverableDigest?: string;
  readonly providerAddress?: string | null;
  readonly budgetAtomic?: string;
  readonly transactionHash?: string;
  readonly blockNumber?: string;
  readonly blockHash?: string;
  readonly logIndex?: number;
  readonly payload?: unknown;
}
