import {
  contentDigestSchema,
  evmAddressSchema,
  transactionHashSchema
} from "@bnbera/domain";
import {
  erc8183JobReadSchema,
  erc8183ProviderBindingSchema,
  erc8183ProviderResultSchema,
  erc8183ProviderTaskSchema,
  idempotencyKeySchema,
  decimalUintSchema,
  erc8183PublicOperationSchema,
  type Erc8183CommerceOperationStatus,
  type Erc8183JobRead,
  type Erc8183PublicOperation
} from "@bnbera/agent-commerce";
import { errorEnvelopeSchema, type ErrorEnvelope } from "@bnbera/config";
import { z } from "zod";

/** Versioned contract consumed by the future T5 browser flow. */
export const commerceApiContractVersion = "bnbera.erc8183-commerce/v1" as const;

const publicHexSchema = z.string().regex(/^0x(?:[0-9a-f]{2})*$/iu);

/** The pinned Altana SDK v0.9.0 manifest shape; request data is not an
 * arbitrary object because the SDK hashes these exact canonical fields. */
export const erc8183ManifestSchema = z.object({
  version: z.literal(1),
  job_id: z.number().int().nonnegative().safe(),
  chain_id: z.number().int().positive().safe(),
  contracts: z.object({
    commerce: evmAddressSchema,
    router: evmAddressSchema,
    policy: evmAddressSchema
  }).strict(),
  response: z.object({
    content: z.string().max(262_144),
    content_type: z.string().trim().min(1).max(160)
  }).strict(),
  metadata: z.record(z.unknown())
}).strict();

/**
 * Mutation bodies intentionally contain no actor, signer, session, authority,
 * standards-lock, or feature-gate fields. Those values come from the server
 * composition and authenticated-request boundary only.
 */
export const commerceHireRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  commerceJobId: z.string().uuid(),
  providerAddress: evmAddressSchema,
  task: z.string().trim().min(1).max(4_096),
  budgetAtomic: decimalUintSchema,
  deadlineSeconds: z.number().int().positive().max(365 * 24 * 60 * 60).optional(),
  providerBinding: erc8183ProviderBindingSchema
}).strict();
export type CommerceHireRequest = z.infer<typeof commerceHireRequestSchema>;

export const commerceSubmitRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  resultDigest: contentDigestSchema,
  chainDeliverable: transactionHashSchema.optional(),
  deliverableUrl: z.string().url().optional(),
  manifest: erc8183ManifestSchema.optional(),
  optParams: publicHexSchema.optional(),
  providerBinding: erc8183ProviderBindingSchema.optional(),
  task: erc8183ProviderTaskSchema.optional(),
  result: erc8183ProviderResultSchema.optional()
}).strict();
export type CommerceSubmitRequest = z.infer<typeof commerceSubmitRequestSchema>;

export const commerceApprovalOrDisputeRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  action: z.enum(["approve", "dispute"]),
  resultDigest: contentDigestSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.action === "approve" && value.resultDigest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultDigest"], message: "Approval must bind to the submitted local result digest." });
  }
  if (value.action === "dispute" && value.resultDigest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultDigest"], message: "A dispute does not accept a result digest." });
  }
});
export type CommerceApprovalOrDisputeRequest = z.infer<typeof commerceApprovalOrDisputeRequestSchema>;

export const commerceSettleRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema
}).strict();
export type CommerceSettleRequest = z.infer<typeof commerceSettleRequestSchema>;

export const commerceRefundRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema
}).strict();
export type CommerceRefundRequest = z.infer<typeof commerceRefundRequestSchema>;

export const commerceReconcileRequestSchema = z.object({}).strict();
export type CommerceReconcileRequest = z.infer<typeof commerceReconcileRequestSchema>;

export const commerceStatusResponseSchema = z.object({
  contractVersion: z.literal(commerceApiContractVersion),
  status: z.literal("ready"),
  job: erc8183JobReadSchema,
  error: z.null()
}).strict();
export type CommerceStatusResponse = z.infer<typeof commerceStatusResponseSchema>;

export const commerceActionResponseSchema = z.object({
  contractVersion: z.literal(commerceApiContractVersion),
  status: z.enum(["confirmed", "replayed", "approved", "reconciled"]),
  jobId: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
  operationId: z.string().uuid().nullable(),
  operation: erc8183PublicOperationSchema.nullable(),
  job: erc8183JobReadSchema.nullable(),
  error: z.null()
}).strict();
export type CommerceActionResponse = z.infer<typeof commerceActionResponseSchema>;

export const commerceErrorResponseSchema = z.object({
  contractVersion: z.literal(commerceApiContractVersion),
  status: z.literal("error"),
  error: errorEnvelopeSchema.shape.error,
  job: z.null(),
  operation: z.null()
}).strict();
export type CommerceErrorResponse = z.infer<typeof commerceErrorResponseSchema>;

export type CommerceOperationStatus = Erc8183CommerceOperationStatus;

export function commerceStatusResponse(job: Erc8183JobRead): CommerceStatusResponse {
  return commerceStatusResponseSchema.parse({
    contractVersion: commerceApiContractVersion,
    status: "ready",
    job,
    error: null
  });
}

export function commerceActionResponse(input: {
  readonly status: CommerceActionResponse["status"];
  readonly jobId: string | null;
  readonly operationId: string | null;
  readonly operation: Erc8183PublicOperation | null;
  readonly job: Erc8183JobRead | null;
}): CommerceActionResponse {
  return commerceActionResponseSchema.parse({
    contractVersion: commerceApiContractVersion,
    ...input,
    error: null
  });
}

export function commerceErrorResponse(error: ErrorEnvelope): CommerceErrorResponse {
  return commerceErrorResponseSchema.parse({
    contractVersion: commerceApiContractVersion,
    status: "error",
    error: errorEnvelopeSchema.shape.error.parse(error.error),
    job: null,
    operation: null
  });
}
