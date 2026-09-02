import { keccak_256 } from "@noble/hashes/sha3.js";
import { z } from "zod";
import {
  agentCategories,
  canonicalizeJson,
  erc8004IdentitySchema,
  evmAddressSchema,
  sha256Hex,
  transactionHashSchema
} from "@bnbera/domain";
import { evidenceLocatorSchema, readbackStatuses } from "./locators.js";

export const ARTIFACT_SCHEMA_VERSION = "bnbera.evidence/v1" as const;

export const artifactTypes = [
  "agent_profile",
  "capabilities",
  "authority",
  "run_bundle",
  "deliverable",
  "benchmark_comparison",
  "submission_index"
] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export const evidenceEnvironments = [
  "development",
  "preview",
  "hackathon",
  "production"
] as const;
export type EvidenceEnvironment = (typeof evidenceEnvironments)[number];

export type PublicJsonValue =
  | null
  | string
  | boolean
  | number
  | PublicJsonValue[]
  | { readonly [key: string]: PublicJsonValue };

const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/, "Expected a 32-byte hexadecimal digest");
const safeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, "Identifier contains unsupported characters");
const nonNegativeDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "Expected a non-negative decimal string");
const timestampSchema = z.string().datetime({ offset: true });
const protocolSchema = z.enum(["a2a", "mcp", "x402", "mpp", "readiness", "adapter"]);
const publicStringArraySchema = z.array(z.string().trim().min(1).max(256)).max(128);

const forbiddenStringValuePattern = /-----BEGIN [^-]+-----|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/i;

function assertSafePublicValue(value: unknown, path = "artifact"): asserts value is PublicJsonValue {
  if (typeof value === "string") {
    if (forbiddenStringValuePattern.test(value)) {
      throw new ArtifactSecurityError(`Secret-like public evidence value at ${path}`);
    }
    return;
  }
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ArtifactSecurityError(`Non-finite public evidence number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafePublicValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ArtifactSecurityError(`Non-plain public evidence object at ${path}`);
    }
    for (const [key, child] of Object.entries(value)) {
      assertSafePublicValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new ArtifactSecurityError(`Unsupported public evidence value at ${path}`);
}

/** Raised before canonical bytes are generated for a non-publishable object. */
export class ArtifactSecurityError extends Error {
  readonly code = "FORBIDDEN_PUBLIC_FIELD" as const;

  constructor(message: string) {
    super(message);
    this.name = "ArtifactSecurityError";
  }
}

const publicScalarSchema = z.union([
  z.null(),
  z.string().trim().max(200_000),
  z.boolean(),
  z.number().finite()
]);

const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);

/**
 * Public evidence is intentionally modelled as a small set of strict records.
 * This keeps the artifact contract extensible through named fields while
 * preventing a caller from smuggling arbitrary credential-shaped keys into a
 * supposedly public object.
 */
const publicSummarySchema = z
  .object({
    status: z.string().trim().min(1).max(64).optional(),
    summary: z.string().trim().max(10_000).optional(),
    reasonCode: safeCodeSchema.optional(),
    value: publicScalarSchema.optional(),
    unit: z.string().trim().max(64).optional(),
    amount: nonNegativeDecimalSchema.optional(),
    amountAtomic: nonNegativeDecimalSchema.optional(),
    currency: z.string().trim().max(32).optional(),
    asset: z.string().trim().max(128).optional(),
    network: z.string().trim().max(128).optional(),
    quoteType: z.string().trim().max(64).optional(),
    expiresAt: timestampSchema.optional(),
    stateDigest: digestSchema.optional(),
    changed: z.boolean().optional(),
    valid: z.boolean().optional(),
    gasEstimateAtomic: nonNegativeDecimalSchema.optional(),
    slippageBps: nonNegativeDecimalSchema.optional(),
    checks: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
    warnings: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
    violations: z.array(z.string().trim().min(1).max(256)).max(128).optional(),
    metricName: safeIdSchema.optional()
  })
  .strict();

const publicPricingSchema = z
  .object({
    currency: z.string().trim().min(1).max(32).optional(),
    amount: nonNegativeDecimalSchema.optional(),
    amountAtomic: nonNegativeDecimalSchema.optional(),
    unit: z.string().trim().max(64).optional(),
    asset: z.string().trim().max(128).optional(),
    network: z.string().trim().max(128).optional(),
    quoteType: z.string().trim().max(64).optional(),
    expiresAt: timestampSchema.optional()
  })
  .strict();

const publicAuthoritySummarySchema = z
  .object({
    walletAddress: evmAddressSchema.optional(),
    sessionPublicAddress: evmAddressSchema.nullable().optional(),
    expiresAt: timestampSchema.optional(),
    status: z.enum(["none", "active", "expired", "revoked"]).optional(),
    spendLimitSummary: z.string().trim().max(2_000).optional(),
    callsAllowlistSummary: z.string().trim().max(2_000).optional(),
    grantTransactionHash: transactionHashSchema.nullable().optional()
  })
  .strict();

const publicBoundsSchema = z
  .object({
    maxAmountAtomic: nonNegativeDecimalSchema.optional(),
    maxDurationSeconds: nonNegativeDecimalSchema.optional(),
    maxItems: z.number().int().nonnegative().optional(),
    maxNotionalAtomic: nonNegativeDecimalSchema.optional(),
    maxSlippageBps: nonNegativeDecimalSchema.optional()
  })
  .strict();

const publicActionSchema = z
  .object({
    actionClass: safeIdSchema.optional(),
    target: evmAddressSchema.optional(),
    selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/).optional(),
    valueWei: nonNegativeDecimalSchema.optional(),
    amountAtomic: nonNegativeDecimalSchema.optional(),
    asset: z.string().trim().max(128).optional(),
    protocol: protocolSchema.optional(),
    reasonCode: safeCodeSchema.optional(),
    summary: z.string().trim().max(2_000).optional()
  })
  .strict();

const publicSnapshotSchema = z
  .object({
    stateDigest: digestSchema.optional(),
    blockNumber: nonNegativeDecimalSchema.optional(),
    status: z.string().trim().max(64).optional(),
    value: publicScalarSchema.optional(),
    changed: z.boolean().optional(),
    summary: z.string().trim().max(2_000).optional()
  })
  .strict();

const publicResultSchema = z.union([publicSummarySchema, publicScalarSchema]);

/** Compatibility export for adapters; artifact payloads use named strict
 * schemas below rather than an open recursive record. */
export const publicJsonValueSchema: z.ZodType<PublicJsonValue> = z.union([
  publicResultSchema,
  z.array(z.union([publicSummarySchema, publicScalarSchema, publicActionSchema])).max(10_000)
]) as z.ZodType<PublicJsonValue>;

const publicServiceSchema = z
  .object({
    kind: protocolSchema,
    url: z
      .string()
      .url()
      .refine((value) => {
        const parsed = new URL(value);
        return ["http:", "https:"].includes(parsed.protocol) && parsed.username.length === 0 && parsed.password.length === 0;
      }, "Service URLs must use HTTP(S) without embedded credentials"),
    protocolVersion: z.string().trim().min(1).max(128),
    discoverySource: z.enum(["8004scan", "registry_event", "manual", "creator"]),
    validationStatus: z.enum(["pending", "healthy", "unhealthy", "rejected"]),
    observedAt: timestampSchema
  })
  .strict();

export const evidenceReferenceSchema = z
  .object({
    artifactId: safeIdSchema,
    version: z.number().int().positive(),
    sha256Digest: digestSchema,
    keccak256Digest: digestSchema
  })
  .strict();
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

const submissionReferenceKinds = ["bsc", "altana", "erc8183", "x402"] as const;
const submissionReferenceSchema = z
  .object({
    kind: z.enum(submissionReferenceKinds),
    network: z.string().trim().min(1).max(128),
    reference: z.string().trim().min(1).max(2_000),
    transactionHash: transactionHashSchema.nullable(),
    state: z.enum(["observed", "confirmed", "pending", "reverted"])
  })
  .strict();

const submissionStorageEvidenceBaseSchema = z
  .object({
    provider: z.enum(["ipfs", "greenfield"]),
    network: z.string().trim().min(1).max(128),
    locator: evidenceLocatorSchema,
    storageState: z.enum(["not_attempted", "submitted", "uploaded", "sealed", "failed"]),
    creationTransactionHash: transactionHashSchema.nullable(),
    sealTransactionHash: transactionHashSchema.nullable(),
    readbackState: z.enum(readbackStatuses),
    providerReference: z.string().trim().min(1).max(512).nullable()
  })
  .strict();

function submissionStorageEdgeSchema(provider: "ipfs" | "greenfield") {
  return submissionStorageEvidenceBaseSchema
    .extend({ provider: z.literal(provider) })
    .superRefine((value, context) => {
      if (value.locator.provider !== value.provider) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locator", "provider"],
          message: "Storage locator provider must match its graph edge"
        });
      }
      if (value.locator.network !== value.network) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["locator", "network"],
          message: "Storage locator network must match its graph edge"
        });
      }
    });
}

const submissionStorageGraphSchema = z
  .object({
    ipfs: submissionStorageEdgeSchema("ipfs").nullable(),
    greenfield: submissionStorageEdgeSchema("greenfield").nullable()
  })
  .strict()
  .refine((value) => value.ipfs !== null || value.greenfield !== null, {
    message: "A submission claim must have at least one storage edge"
  });

const submissionCorrelationSchema = z
  .object({
    runId: safeIdSchema.nullable(),
    jobId: safeIdSchema.nullable(),
    deploymentId: safeIdSchema.nullable(),
    requestId: safeIdSchema.nullable()
  })
  .strict();

export const submissionIndexEntrySchema = z
  .object({
    claimId: safeIdSchema,
    claim: z.string().trim().min(1).max(2_000),
    proofType: z.enum(["code", "test", "transaction", "object", "benchmark"]),
    evidence: evidenceReferenceSchema,
    status: z.enum(["verified", "partial", "blocked"]),
    correlation: submissionCorrelationSchema,
    storage: submissionStorageGraphSchema,
    references: z
      .object({
        bsc: z.array(submissionReferenceSchema.extend({ kind: z.literal("bsc") })).max(128),
        altana: z.array(submissionReferenceSchema.extend({ kind: z.literal("altana") })).max(128),
        erc8183: z.array(submissionReferenceSchema.extend({ kind: z.literal("erc8183") })).max(128),
        x402: z.array(submissionReferenceSchema.extend({ kind: z.literal("x402") })).max(128)
      })
      .strict()
  })
  .strict();
export type SubmissionIndexEntry = z.infer<typeof submissionIndexEntrySchema>;

const baseArtifactFields = {
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: safeIdSchema,
  version: z.number().int().positive(),
  environment: z.enum(evidenceEnvironments),
  createdAt: timestampSchema
};

const profilePayloadSchema = z
  .object({
    identity: erc8004IdentitySchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10_000),
    category: z.enum(agentCategories),
    services: z.array(publicServiceSchema).max(128),
    supportedProtocols: publicStringArraySchema,
    capabilityManifestHash: digestSchema.nullable(),
    template: z
      .object({
        slug: safeIdSchema,
        version: z.string().trim().min(1).max(64),
        digest: digestSchema
      })
      .strict()
      .nullable(),
    pricing: publicPricingSchema,
    authoritySummary: publicAuthoritySummarySchema.nullable(),
    evidenceReferences: z.array(evidenceReferenceSchema).max(256)
  })
  .strict();

const capabilityPayloadSchema = z
  .object({
    identity: erc8004IdentitySchema,
    manifestSchemaVersion: z.string().trim().min(1).max(64),
    capabilities: z
      .array(
        z
          .object({
            id: safeIdSchema,
            description: z.string().trim().min(1).max(2_000),
            inputSchemaHash: digestSchema,
            outputSchemaHash: digestSchema,
            requiredProtocols: publicStringArraySchema,
            allowedActionClasses: publicStringArraySchema,
            maxTaskBounds: publicBoundsSchema,
            evidenceProduced: publicStringArraySchema
          })
          .strict()
      )
      .min(1)
      .max(128)
  })
  .strict();

const callPermissionSchema = z
  .object({
    target: evmAddressSchema,
    selectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)).max(128),
    maxNativeValueWei: nonNegativeDecimalSchema
  })
  .strict();

const spendPermissionSchema = z
  .object({
    token: z.union([evmAddressSchema, z.literal("native")]),
    limitAtomic: nonNegativeDecimalSchema,
    period: z.enum(["call", "hour", "day", "week", "lifetime"])
  })
  .strict();

const authorityPayloadSchema = z
  .object({
    identity: erc8004IdentitySchema,
    walletAddress: evmAddressSchema,
    sessionPublicAddress: evmAddressSchema.nullable(),
    callsAllowlist: z.array(callPermissionSchema),
    spendLimits: z.array(spendPermissionSchema),
    expiresAt: timestampSchema,
    grantTransactionHash: transactionHashSchema.nullable(),
    lastVerifiedBlock: nonNegativeDecimalSchema.nullable(),
    status: z.enum(["none", "active", "expired", "revoked"])
  })
  .strict();

const publicDataSourceSchema = z
  .object({
    provider: safeIdSchema,
    version: z.string().trim().min(1).max(128),
    observedAt: timestampSchema,
    observedBlock: nonNegativeDecimalSchema.nullable(),
    payloadDigest: digestSchema,
    freshness: z.enum(["fresh", "stale", "unknown"])
  })
  .strict();

const runBundlePayloadSchema = z
  .object({
    runId: safeIdSchema,
    identity: erc8004IdentitySchema,
    agentVersion: z.string().trim().min(1).max(128),
    observedAt: timestampSchema,
    observedBlock: nonNegativeDecimalSchema.nullable(),
    dataSources: z.array(publicDataSourceSchema).max(128),
    candidateActions: z.array(publicActionSchema).max(512),
    rejectedActions: z.array(publicActionSchema).max(512),
    selectedAction: publicActionSchema.nullable(),
    simulationOutput: publicResultSchema,
    riskValidations: publicResultSchema,
    policyValidation: publicResultSchema,
    quote: publicResultSchema,
    transactionHash: transactionHashSchema.nullable(),
    receiptSummary: publicResultSchema,
    beforeState: publicSnapshotSchema,
    afterState: publicSnapshotSchema,
    ipfsDeliverable: evidenceReferenceSchema.nullable(),
    contentSha256: digestSchema.nullable(),
    contentKeccak256: digestSchema.nullable(),
    finalStatus: z.enum(["simulated", "submitted", "confirmed", "rejected", "failed"])
  })
  .strict();

const deliverablePayloadSchema = z
  .object({
    runId: safeIdSchema,
    identity: erc8004IdentitySchema,
    mimeType: z.literal("application/json"),
    sizeBytes: z.number().int().nonnegative(),
    contentSha256: digestSchema,
    contentKeccak256: digestSchema,
    ipfsUri: z.string().regex(/^ipfs:\/\/[^\s]+$/),
    outputSummary: publicResultSchema
  })
  .strict();

const benchmarkPayloadSchema = z
  .object({
    taskId: safeIdSchema,
    measurementWindow: z
      .object({
        startedAt: timestampSchema,
        endedAt: timestampSchema,
        sampleSize: z.number().int().positive()
      })
      .strict(),
    manualOutput: publicResultSchema,
    agentOutput: publicResultSchema,
    manualTimeSeconds: z.number().nonnegative(),
    agentTimeSeconds: z.number().nonnegative(),
    directCostAtomic: nonNegativeDecimalSchema,
    gasAtomic: nonNegativeDecimalSchema,
    marketplacePaymentAtomic: nonNegativeDecimalSchema,
    winsLosses: publicResultSchema,
    realizedBenefit: publicResultSchema,
    capitalAtRisk: publicResultSchema,
    maximumDrawdown: publicResultSchema,
    failureCount: z.number().int().nonnegative(),
    retryTreatment: z.string().trim().min(1).max(2_000),
    qualityRubric: z.array(publicSummarySchema).max(256),
    riskViolations: z.array(publicSummarySchema).max(256),
    methodology: z.string().trim().min(1).max(10_000),
    transactionReferences: z.array(transactionHashSchema).max(256),
    evidenceReferences: z.array(evidenceReferenceSchema).max(256),
    conclusion: z.string().trim().min(1).max(10_000)
  })
  .strict();

const submissionIndexPayloadSchema = z
  .object({
    generatedAt: timestampSchema,
    entries: z.array(submissionIndexEntrySchema).min(1).max(512)
  })
  .strict();

export const agentProfileArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("agent_profile"),
    payload: profilePayloadSchema
  })
  .strict();

export const capabilityArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("capabilities"),
    payload: capabilityPayloadSchema
  })
  .strict();

export const authorityArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("authority"),
    payload: authorityPayloadSchema
  })
  .strict();

export const runBundleArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("run_bundle"),
    payload: runBundlePayloadSchema
  })
  .strict();

export const deliverableArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("deliverable"),
    payload: deliverablePayloadSchema
  })
  .strict();

export const benchmarkComparisonArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("benchmark_comparison"),
    payload: benchmarkPayloadSchema
  })
  .strict();

export const submissionIndexArtifactSchema = z
  .object({
    ...baseArtifactFields,
    artifactType: z.literal("submission_index"),
    payload: submissionIndexPayloadSchema
  })
  .strict();

export const canonicalArtifactSchema = z.discriminatedUnion("artifactType", [
  agentProfileArtifactSchema,
  capabilityArtifactSchema,
  authorityArtifactSchema,
  runBundleArtifactSchema,
  deliverableArtifactSchema,
  benchmarkComparisonArtifactSchema,
  submissionIndexArtifactSchema
]);

export type CanonicalArtifact = z.infer<typeof canonicalArtifactSchema>;

const addressKeys = new Set([
  "target",
  "walletAddress",
  "sessionPublicAddress",
  "identityRegistry",
  "adminAddress",
  "ownerAddress",
  "agentWallet"
]);
const digestKeys = new Set([
  "sha256Digest",
  "keccak256Digest",
  "contentSha256",
  "contentKeccak256",
  "capabilityManifestHash",
  "inputSchemaHash",
  "outputSchemaHash",
  "payloadDigest",
  "digest"
]);
const timestampKeys = new Set([
  "createdAt",
  "observedAt",
  "startedAt",
  "endedAt",
  "expiresAt",
  "generatedAt",
  "readbackVerifiedAt"
]);

function normalizeValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, normalizeValue(child, childKey)])
    );
  }
  if (typeof value !== "string") {
    return value;
  }
  if (addressKeys.has(key ?? "") && /^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  if (digestKeys.has(key ?? "") && /^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase().replace(/^0x/, "");
  }
  if (timestampKeys.has(key ?? "")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return value;
}

export function assertPublishableArtifact(input: unknown): asserts input is CanonicalArtifact {
  const parsed = canonicalArtifactSchema.parse(input);
  assertSafePublicValue(parsed);
}

export function normalizeArtifact(input: unknown): CanonicalArtifact {
  const parsed = canonicalArtifactSchema.parse(input);
  const normalized = normalizeValue(parsed);
  const normalizedParsed = canonicalArtifactSchema.parse(normalized);
  assertSafePublicValue(normalizedParsed);
  return normalizedParsed;
}

export interface ArtifactDigest {
  readonly artifact: CanonicalArtifact;
  readonly canonicalJson: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function keccak256Hex(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(keccak_256(bytes));
}

export function digestArtifact(input: unknown): ArtifactDigest {
  const artifact = normalizeArtifact(input);
  const canonicalJson = canonicalizeJson(artifact);
  const canonicalBytes = new TextEncoder().encode(canonicalJson);
  return {
    artifact,
    canonicalJson,
    canonicalBytes,
    sha256Digest: sha256Hex(canonicalBytes),
    keccak256Digest: keccak256Hex(canonicalBytes),
    sizeBytes: canonicalBytes.byteLength
  };
}

function pathSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded === "" || encoded === "." || encoded === ".." || encoded.includes("/")) {
    throw new Error("Invalid immutable evidence path segment");
  }
  return encoded;
}

export function deterministicObjectName(input: CanonicalArtifact): string {
  const artifact = normalizeArtifact(input);
  return [
    "evidence",
    pathSegment(artifact.environment),
    artifact.artifactType,
    pathSegment(artifact.artifactId),
    "versions",
    String(artifact.version),
    `${artifact.artifactType}.json`
  ].join("/");
}
