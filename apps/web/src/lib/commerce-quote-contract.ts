import { erc8004IdentitySchema, evmAddressSchema } from "@bnbera/domain";
import { z } from "zod";

/**
 * Browser/server shared quote contract. Keep this module free of PostgreSQL,
 * Node crypto and commerce SDK imports so a client can validate a persisted
 * quote without importing the reservation writer.
 */
export const commerceQuoteRequestSchema = z.object({
  agentIdentifier: z.string().trim().min(1).max(400),
  task: z.string().trim().min(1).max(4_096)
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(value.task).byteLength > 4_096) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["task"], message: "The task must contain at most 4096 UTF-8 bytes." });
  }
});
export type CommerceQuoteRequest = z.infer<typeof commerceQuoteRequestSchema>;

const positiveDecimalSchema = z.string().regex(/^[1-9][0-9]*$/u);
const timestampSchema = z.string().datetime({ offset: true });

export const commerceQuoteSnapshotSchema = z.object({
  schemaVersion: z.literal("bnbera.erc8183-quote/v1"),
  quoteId: z.string().uuid(),
  agentIdentifier: z.string().trim().min(1).max(400),
  identity: erc8004IdentitySchema,
  agentVersionId: z.string().uuid(),
  agentVersion: z.number().int().positive(),
  providerAddress: evmAddressSchema,
  providerAddressSource: z.enum(["erc8004_agent_wallet", "persisted_execution_wallet"]),
  service: z.object({
    kind: z.enum(["a2a", "adapter"]),
    url: z.string().url(),
    protocolVersion: z.string().trim().min(1).max(128),
    observedAt: timestampSchema,
    probeObservedAt: timestampSchema
  }).strict(),
  chainId: z.union([z.literal(56), z.literal(97)]),
  commerceContract: evmAddressSchema,
  paymentToken: evmAddressSchema,
  paymentDecimals: z.number().int().min(0).max(255),
  tokenSymbol: z.string().trim().min(1).max(32).nullable(),
  priceAtomic: positiveDecimalSchema,
  task: z.string().trim().min(1).max(4_096),
  taskDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  externalSeller: z.object({
    protocol: z.literal("apex-erc8183-v1"),
    requestedTask: z.string().min(1).max(1600),
    /** Opaque immutable signed envelope; fully validated by the server adapter. */
    signedOffer: z.string().min(1).max(16000),
    executionStatus: z.enum(["unverified", "protocol_ready", "historical_result_verified"]),
    historicalJobId: z.string().regex(/^[1-9][0-9]*$/u).optional(),
    disputeWindowSeconds: z.literal(604800)
  }).strict().optional(),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  status: z.literal("draft")
}).strict();
export type CommerceQuoteSnapshot = z.infer<typeof commerceQuoteSnapshotSchema>;

export const commerceQuoteResponseSchema = z.object({
  contractVersion: z.literal("bnbera.erc8183-commerce/v1"),
  status: z.literal("ready"),
  quote: commerceQuoteSnapshotSchema,
  error: z.null()
}).strict();
export type CommerceQuoteResponse = z.infer<typeof commerceQuoteResponseSchema>;

export function commerceQuoteResponse(quote: CommerceQuoteSnapshot): CommerceQuoteResponse {
  return commerceQuoteResponseSchema.parse({
    contractVersion: "bnbera.erc8183-commerce/v1",
    status: "ready",
    quote,
    error: null
  });
}
