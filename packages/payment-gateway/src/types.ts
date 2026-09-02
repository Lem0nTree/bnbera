import { z } from "zod";
import {
  canonicalSha256Hex,
  contentDigestSchema,
  evmAddressSchema,
  transactionHashSchema
} from "@bnbera/domain";

export const bscChainIdSchema = z.union([z.literal(56), z.literal(97)]);
export type BscChainId = z.infer<typeof bscChainIdSchema>;

export const nonZeroAddressSchema = evmAddressSchema.refine(
  (value) => !/^0x0{40}$/i.test(value),
  "The zero address is not valid for a payment boundary"
);

export const decimalUintSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "Expected a non-negative decimal integer");
export const positiveDecimalUintSchema = decimalUintSchema.refine(
  (value) => value !== "0",
  "Expected a positive decimal integer"
);

export const safeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Invalid public identifier");
export const idempotencyKeySchema = safeIdentifierSchema.min(8);
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.username === "" && parsed.password === "";
  }, "Expected an HTTP(S) URL without embedded credentials");

export const unixSecondsSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const paymentRailSchema = z.literal("x402_b402");
export type PaymentRail = z.infer<typeof paymentRailSchema>;

export const paymentMethods = ["eip3009", "permit2_exact"] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const b402CanaryStatuses = ["not_run", "passed", "failed", "blocked"] as const;
export const b402CanaryStatusSchema = z.enum(b402CanaryStatuses);
export type B402CanaryStatus = z.infer<typeof b402CanaryStatusSchema>;

export const payoutVerificationStates = ["pending", "verified", "rejected"] as const;
export const payoutVerificationStateSchema = z.enum(payoutVerificationStates);
export type PayoutVerificationState = z.infer<typeof payoutVerificationStateSchema>;

export const secretReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^(secret:\/\/|vault:\/\/|env:\/\/|arn:aws:secretsmanager:)/, "Only approved secret references are accepted");
export type SecretReference = z.infer<typeof secretReferenceSchema>;

/** Exact fields mapped to Studio's [payments.b402_seller] configuration. */
export const b402SellerConfigurationSchema = z.object({
  enabled: z.boolean(),
  merchantEnvironment: safeIdentifierSchema,
  merchantAccountReference: safeIdentifierSchema,
  merchantCredentialReference: secretReferenceSchema.nullable(),
  facilitatorEndpoint: httpUrlSchema,
  settlementNetwork: bscChainIdSchema,
  settlementAsset: nonZeroAddressSchema,
  settlementDecimals: z.number().int().min(0).max(255),
  payoutAddress: nonZeroAddressSchema,
  payoutVerificationState: payoutVerificationStateSchema,
  fixedEgressProfile: safeIdentifierSchema,
  publicX402Url: httpUrlSchema,
  agentCoreRelayAuthenticationReference: secretReferenceSchema.nullable(),
  priceUsd: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/, "Price must be a decimal USD string"),
  configurationVersion: z.number().int().positive(),
  canaryStatus: b402CanaryStatusSchema
}).strict();
export type B402SellerConfiguration = z.infer<typeof b402SellerConfigurationSchema>;

/**
 * Trusted terms assembled from BNBEra configuration and the selected route.
 * These values are intentionally independent of an incoming 402 challenge.
 */
export const b402PaymentPinSchema = z.object({
  /** This pin can only be issued from an enabled, verified B402 configuration. */
  enabled: z.literal(true),
  /** Correlates the trusted pin/config boundary with exactly one request. */
  requestId: safeIdentifierSchema,
  rail: paymentRailSchema,
  settlementNetwork: bscChainIdSchema,
  settlementAsset: nonZeroAddressSchema,
  settlementDecimals: z.number().int().min(0).max(255),
  amountAtomic: positiveDecimalUintSchema,
  recipient: nonZeroAddressSchema,
  method: paymentMethodSchema,
  destination: httpUrlSchema,
  facilitatorEndpoint: httpUrlSchema,
  /** Fixed egress and payout values are trusted configuration, never challenge input. */
  fixedEgressProfile: safeIdentifierSchema,
  payoutAddress: nonZeroAddressSchema,
  payoutVerificationState: z.literal("verified"),
  maxChallengeLifetimeSeconds: z.number().int().positive().max(15 * 60)
}).strict();
export type B402PaymentPin = z.infer<typeof b402PaymentPinSchema>;

export const paymentChallengeNonceSchema = z
  .string()
  .trim()
  .min(8)
  .max(240)
  .regex(/^[A-Za-z0-9._:/-]+$/);

export const paymentChallengeSchema = z.object({
  challengeId: safeIdentifierSchema,
  rail: paymentRailSchema,
  version: safeIdentifierSchema,
  settlementNetwork: bscChainIdSchema,
  settlementAsset: nonZeroAddressSchema,
  settlementDecimals: z.number().int().min(0).max(255),
  amountAtomic: positiveDecimalUintSchema,
  recipient: nonZeroAddressSchema,
  method: paymentMethodSchema,
  destination: httpUrlSchema,
  facilitatorEndpoint: httpUrlSchema,
  nonce: paymentChallengeNonceSchema,
  issuedAtUnix: unixSecondsSchema,
  expiresAtUnix: unixSecondsSchema,
  challengeDigest: contentDigestSchema
}).strict().superRefine((value, ctx) => {
  if (value.expiresAtUnix <= value.issuedAtUnix) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAtUnix"], message: "Challenge expiry must follow issuance" });
  }
});
export type PaymentChallenge = z.infer<typeof paymentChallengeSchema>;

export const paymentAuthorizationSchema = z.object({
  attemptId: z.string().uuid(),
  challengeId: safeIdentifierSchema,
  challengeDigest: contentDigestSchema,
  payerAddress: nonZeroAddressSchema,
  credentialDigest: contentDigestSchema,
  authorizedAtUnix: unixSecondsSchema
}).strict();
export type PaymentAuthorization = z.infer<typeof paymentAuthorizationSchema>;

export const relayRequestSchema = z.object({
  attemptId: z.string().uuid(),
  requestId: safeIdentifierSchema,
  idempotencyKey: idempotencyKeySchema,
  destination: httpUrlSchema,
  method: paymentMethodSchema,
  authorizationDigest: contentDigestSchema,
  requestDigest: contentDigestSchema,
  fixedEgressProfile: safeIdentifierSchema,
  timeoutMs: z.number().int().min(1_000).max(120_000)
}).strict();
export type RelayRequest = z.infer<typeof relayRequestSchema>;

export const paymentReceiptStatuses = ["settled", "rejected", "unknown", "partial_failure"] as const;
export const paymentReceiptStatusSchema = z.enum(paymentReceiptStatuses);
export type PaymentReceiptStatus = z.infer<typeof paymentReceiptStatusSchema>;

export const paymentReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  attemptId: z.string().uuid(),
  challengeId: safeIdentifierSchema,
  rail: paymentRailSchema,
  status: paymentReceiptStatusSchema,
  settlementNetwork: bscChainIdSchema,
  settlementAsset: nonZeroAddressSchema,
  settlementDecimals: z.number().int().min(0).max(255),
  amountAtomic: positiveDecimalUintSchema,
  expectedRecipient: nonZeroAddressSchema,
  actualRecipient: nonZeroAddressSchema.nullable(),
  method: paymentMethodSchema,
  destination: httpUrlSchema,
  paymentTransactionHash: transactionHashSchema.nullable(),
  settlementTransactionHash: transactionHashSchema.nullable(),
  payoutAddress: nonZeroAddressSchema.nullable(),
  payoutVerified: z.boolean(),
  facilitatorRequestReference: safeIdentifierSchema.nullable(),
  responseStatus: z.number().int().min(100).max(599).nullable(),
  responseDigest: contentDigestSchema.nullable(),
  observedAtUnix: unixSecondsSchema,
  settledAtUnix: unixSecondsSchema.nullable()
}).strict();
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;

export const paymentAttemptStatuses = [
  "challenged",
  "authorized",
  "relay_pending",
  "relayed",
  "settlement_pending",
  "settled",
  "delivered",
  "rejected",
  "expired",
  "unknown",
  "partial_failure",
  "manual_review"
] as const;
export const paymentAttemptStatusSchema = z.enum(paymentAttemptStatuses);
export type PaymentAttemptStatus = z.infer<typeof paymentAttemptStatusSchema>;

export const paymentAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  rail: paymentRailSchema,
  requestId: safeIdentifierSchema,
  idempotencyKey: idempotencyKeySchema,
  challenge: paymentChallengeSchema,
  challengeDigest: contentDigestSchema,
  authorizationDigest: contentDigestSchema.nullable(),
  payerAddress: nonZeroAddressSchema.nullable(),
  pin: b402PaymentPinSchema,
  status: paymentAttemptStatusSchema,
  relayRequestDigest: contentDigestSchema.nullable(),
  receiptId: z.string().uuid().nullable(),
  failureCode: safeIdentifierSchema.nullable(),
  sanitizedFailure: z.string().trim().max(500).nullable(),
  createdAtUnix: unixSecondsSchema,
  updatedAtUnix: unixSecondsSchema
}).strict().superRefine((value, ctx) => {
  if (value.rail !== value.challenge.rail) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "rail"], message: "Attempt and challenge rails must match." });
  }
  if (value.challengeDigest !== value.challenge.challengeDigest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challengeDigest"], message: "Attempt challenge digest must match the challenge." });
  }
  if (value.pin.settlementNetwork !== value.challenge.settlementNetwork) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "settlementNetwork"], message: "Attempt and challenge networks must match." });
  }
  if (value.pin.settlementAsset.toLowerCase() !== value.challenge.settlementAsset.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "settlementAsset"], message: "Attempt and challenge assets must match." });
  }
  if (value.pin.settlementDecimals !== value.challenge.settlementDecimals) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "settlementDecimals"], message: "Attempt and challenge decimals must match." });
  }
  if (value.pin.amountAtomic !== value.challenge.amountAtomic) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "amountAtomic"], message: "Attempt and challenge amounts must match." });
  }
  if (value.pin.recipient.toLowerCase() !== value.challenge.recipient.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "recipient"], message: "Attempt and challenge recipients must match." });
  }
  if (value.pin.method !== value.challenge.method) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "method"], message: "Attempt and challenge methods must match." });
  }
  if (value.pin.destination !== value.challenge.destination) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "destination"], message: "Attempt and challenge destinations must match." });
  }
  if (value.pin.facilitatorEndpoint !== value.challenge.facilitatorEndpoint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["challenge", "facilitatorEndpoint"], message: "Attempt and challenge facilitators must match." });
  }
  if (value.requestId !== value.pin.requestId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestId"], message: "Attempt request correlation must match the trusted payment pin." });
  }
});
export type PaymentAttempt = z.infer<typeof paymentAttemptSchema>;

export const paymentEventTypes = [
  "challenge_issued",
  "payment_authorized",
  "relay_started",
  "relay_completed",
  "settlement_observed",
  "response_delivered",
  "payment_rejected",
  "payment_expired",
  "payment_unknown",
  "payment_partial_failure",
  "reconciliation_requested",
  "reconciliation_succeeded",
  "reconciliation_failed"
] as const;
export const paymentEventTypeSchema = z.enum(paymentEventTypes);
export type PaymentEventType = z.infer<typeof paymentEventTypeSchema>;

export const paymentEventSchema = z.object({
  eventId: z.string().uuid(),
  eventKey: safeIdentifierSchema,
  attemptId: z.string().uuid(),
  eventType: paymentEventTypeSchema,
  previousStatus: paymentAttemptStatusSchema.nullable(),
  nextStatus: paymentAttemptStatusSchema.nullable(),
  paymentTransactionHash: transactionHashSchema.nullable(),
  settlementTransactionHash: transactionHashSchema.nullable(),
  payloadDigest: contentDigestSchema,
  payload: z.unknown(),
  correlationId: safeIdentifierSchema,
  observedAtUnix: unixSecondsSchema
}).strict();
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export const reconciliationStates = ["pending", "in_progress", "reconciled", "failed", "manual_review"] as const;
export const reconciliationStateSchema = z.enum(reconciliationStates);
export type ReconciliationState = z.infer<typeof reconciliationStateSchema>;

export const paymentReconciliationSchema = z.object({
  reconciliationId: z.string().uuid(),
  attemptId: z.string().uuid(),
  state: reconciliationStateSchema,
  reasonCode: safeIdentifierSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAtUnix: unixSecondsSchema.nullable(),
  observedPaymentTransactionHash: transactionHashSchema.nullable(),
  observedSettlementTransactionHash: transactionHashSchema.nullable(),
  detailDigest: contentDigestSchema.nullable(),
  createdAtUnix: unixSecondsSchema,
  updatedAtUnix: unixSecondsSchema
}).strict();
export type PaymentReconciliation = z.infer<typeof paymentReconciliationSchema>;

export function paymentAuthorizationDigest(authorization: PaymentAuthorization): string {
  return canonicalSha256Hex(authorization);
}

export function challengeUnsignedDigest(challenge: Omit<PaymentChallenge, "challengeDigest">): string {
  return canonicalSha256Hex(challenge);
}
