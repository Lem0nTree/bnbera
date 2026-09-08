import type { CanonicalArtifact, ArtifactDigest } from "@bnbera/evidence";
import { evidenceEnvironments, evidenceLocatorSchema, verificationResultSchema } from "@bnbera/evidence";
import { canonicalizeJson, publicationAttemptStates, publicationProviders, sha256Hex } from "@bnbera/domain";
import { z } from "zod";

export { publicationAttemptStates, publicationProviders };
export type PublicationProvider = (typeof publicationProviders)[number];

/**
 * `submitted` is deliberately separate from `verified`: a provider accepting
 * a request is never evidence that bytes were uploaded, sealed, or read back.
 */
export type PublicationAttemptState = (typeof publicationAttemptStates)[number];
export const publicationAttemptStateSchema = z.enum(publicationAttemptStates);

export const publicationFailureCodes = [
  "INVALID_ARTIFACT",
  "FORBIDDEN_PUBLIC_FIELD",
  "ARTIFACT_TOO_LARGE",
  "OBJECT_TOO_LARGE",
  "CREATE_FAILED",
  "CREATE_UNKNOWN",
  "UPLOAD_FAILED",
  "PROVIDER_FAILED",
  "MALFORMED_TRANSACTION",
  "TIMEOUT",
  "MISSING_OBJECT",
  "HASH_MISMATCH",
  "SIZE_MISMATCH",
  "DUPLICATE_IDEMPOTENCY_KEY",
  "UNSUPPORTED_PROVIDER",
  "CONFIGURATION_CHANGED",
  "DURABLE_GRAPH_INVALID",
  "SEAL_TRANSACTION_MISSING",
  "CONCURRENT_UPDATE",
  "LEASE_LOST"
] as const;
export type PublicationFailureCode = (typeof publicationFailureCodes)[number];

const boundedNonNegativeInteger = z.number().int().nonnegative();
const safeLabel = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeBucket = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** Trusted runtime boundary. Provider/network/object-name choices are loaded
 * from standards-locked configuration, never from a publication request. */
export const publicationConfigurationSchema = z
  .object({
    environment: z.enum(evidenceEnvironments),
    enabledProviders: z.array(z.enum(publicationProviders)).min(1).max(publicationProviders.length),
    ipfs: z.object({ network: safeLabel, providerLabel: safeLabel }).strict(),
    greenfield: z
      .object({ network: safeLabel, providerLabel: safeLabel, bucket: safeBucket })
      .strict(),
    maxArtifactBytes: boundedNonNegativeInteger.refine((value) => value > 0),
    maxObjectBytes: boundedNonNegativeInteger.refine((value) => value > 0),
    maxSealPolls: z.number().int().positive().max(1_000),
    sealBackoffMs: z.array(z.number().int().nonnegative().max(60_000)).max(32),
    leaseDurationMs: z.number().int().positive().max(86_400_000)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.enabledProviders).size !== value.enabledProviders.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["enabledProviders"], message: "Providers must be unique" });
    }
  });

export type PublicationConfiguration = z.infer<typeof publicationConfigurationSchema>;

/** Deterministic local configuration for adapter contract tests. Production
 * callers should construct this from the standards-locked runtime config. */
export const defaultPublicationConfiguration: PublicationConfiguration = publicationConfigurationSchema.parse({
  environment: "hackathon",
  enabledProviders: ["ipfs", "greenfield"],
  ipfs: { network: "ipfs-test", providerLabel: "deterministic-ipfs" },
  greenfield: {
    network: "greenfield_5600-1",
    providerLabel: "deterministic-greenfield",
    bucket: "greenfield-test"
  },
  maxArtifactBytes: 10_000_000,
  maxObjectBytes: 10_000_000,
  maxSealPolls: 5,
  sealBackoffMs: [],
  leaseDurationMs: 60_000
});

/** Digest of the trusted publication boundary. It is stored on every attempt
 * so a worker can never silently reuse an attempt under changed routing,
 * bucket, provider-label, or size/seal settings. */
export function publicationConfigurationDigest(input: PublicationConfiguration): string {
  return sha256Hex(canonicalizeJson(publicationConfigurationSchema.parse(input)));
}

const timestampSchema = z.string().datetime({ offset: true });
const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const publicationAttemptRecordSchema = z
  .object({
    attemptId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(256),
    provider: z.enum(publicationProviders),
    providerLabel: safeLabel,
    configurationDigest: digestSchema,
    configuredNetwork: safeLabel,
    configuredBucket: safeBucket.nullable(),
    artifactId: z.string().trim().min(1).max(160),
    artifactType: z.string().trim().min(1).max(64),
    artifactVersion: z.number().int().positive(),
    objectName: z.string().trim().min(1).max(1_024),
    sha256Digest: digestSchema,
    keccak256Digest: digestSchema,
    sizeBytes: z.number().int().nonnegative(),
    state: publicationAttemptStateSchema,
    revision: z.number().int().nonnegative().default(0),
    leaseOwner: z.string().uuid().nullable(),
    leaseExpiresAt: timestampSchema.nullable(),
    providerReference: z.string().trim().min(1).max(512).nullable(),
    creationTransactionHash: transactionHashSchema.nullable(),
    sealTransactionHash: transactionHashSchema.nullable(),
    locator: evidenceLocatorSchema.nullable(),
    verification: verificationResultSchema.nullable(),
    retryCount: z.number().int().nonnegative(),
    lastErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).nullable(),
    lastErrorMessage: z.string().max(500).nullable(),
    retryable: z.boolean(),
    submittedAt: timestampSchema.nullable(),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .strict();

export type PublicationAttemptRecord = z.infer<typeof publicationAttemptRecordSchema>;

export interface PublicationUploadInput {
  readonly bytes: Uint8Array;
  readonly objectName: string;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly mimeType: "application/json";
}

export interface IpfsUploadReceipt {
  readonly uri: string;
  readonly network: string;
  readonly providerReference: string | null;
}

export interface IpfsPublisher {
  readonly upload: (input: PublicationUploadInput) => Promise<IpfsUploadReceipt>;
  readonly read: (input: { readonly uri: string }) => Promise<Uint8Array>;
}

export interface GreenfieldCreateReceipt {
  /** Object reference is provider-defined and never treated as a public URI. */
  readonly objectReference: string | null;
  readonly creationTransactionHash: string | null;
  readonly status: "submitted" | "confirmed";
}

export interface GreenfieldUploadReceipt {
  readonly uri: string;
  readonly network: string;
  readonly bucket: string;
  readonly providerReference: string;
}

export interface GreenfieldSealReceipt {
  readonly status: "sealed" | "pending" | "missing";
  readonly sealTransactionHash: string | null;
}

export interface GreenfieldPublisher {
  readonly createObject: (input: {
    readonly objectName: string;
    readonly sizeBytes: number;
    readonly mimeType: "application/json";
    /**
     * Canonical payload material needed by Greenfield's create transaction.
     * Greenfield stores Reed-Solomon checksums in that transaction, so this
     * seam deliberately carries the already canonical bytes/checksums without
     * making the provider-neutral publication record retain them.
     */
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }) => Promise<GreenfieldCreateReceipt>;
  readonly uploadObject: (input: PublicationUploadInput & {
    readonly objectReference: string;
    readonly creationTransactionHash?: string | null;
  }) => Promise<GreenfieldUploadReceipt>;
  readonly waitForSeal: (input: {
    readonly objectReference: string;
    readonly attempt: number;
  }) => Promise<GreenfieldSealReceipt>;
  readonly readObject: (input: { readonly objectReference: string }) => Promise<Uint8Array>;
  /**
   * Inspect deterministic object identity before a retry after an unknown
   * create outcome. Implementations must not submit another create while an
   * existing object can be found. It is optional to preserve the provider
   * contract for existing fakes/adapters.
   */
  readonly inspectObject?: (input: {
    readonly objectName: string;
    readonly sizeBytes?: number;
    /** Canonical bytes let the provider recompute/compare its RS checksums
     * before a recovered object is uploaded or reused. */
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }) => Promise<GreenfieldInspectReceipt>;
  /** Reconcile an unknown create broadcast against chain state and object
   * metadata. A missing SP object alone is never sufficient evidence. */
  readonly reconcileCreate?: (input: {
    readonly objectName: string;
    readonly sizeBytes: number;
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }) => Promise<GreenfieldCreateReconciliation>;
}

export interface GreenfieldInspectReceipt {
  readonly status: "missing" | "created" | "sealed";
  readonly objectReference: string | null;
  readonly creationTransactionHash: string | null;
  readonly sealTransactionHash: string | null;
}

export interface GreenfieldCreateReconciliation {
  readonly status: "missing" | "present" | "unknown";
  readonly objectReference: string | null;
  readonly creationTransactionHash: string | null;
  readonly sealTransactionHash: string | null;
}

export interface PublicationAuditEvent {
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly action: "validation_failed";
  readonly reasonCode: PublicationFailureCode;
  readonly message: string;
  readonly createdAt: string;
}

export interface PublicationStore {
  readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<PublicationAttemptRecord | null>;
  readonly findByAttemptId: (attemptId: string) => Promise<PublicationAttemptRecord | null>;
  /** Must be backed by INSERT ... ON CONFLICT DO NOTHING (or equivalent). */
  readonly createOrGet: (
    record: PublicationAttemptRecord
  ) => Promise<{ readonly record: PublicationAttemptRecord; readonly created: boolean }>;
  /** Compare-and-set every durable state write. Implementations must reject
   * stale revisions and writes from a worker that does not own the lease. */
  readonly save: (
    record: PublicationAttemptRecord,
    expectedRevision: number,
    leaseToken: string,
    now?: string
  ) => Promise<void>;
  /** Compare-and-set lease used to ensure one worker resumes an attempt. */
  readonly acquireLease: (
    attemptId: string,
    leaseToken: string,
    now: string,
    durationMs: number
  ) => Promise<{
    readonly acquired: boolean;
    readonly record: PublicationAttemptRecord | null;
  }>;
  readonly releaseLease: (
    attemptId: string,
    leaseToken: string,
    now?: string
  ) => Promise<PublicationAttemptRecord | null>;
  readonly appendAudit: (event: PublicationAuditEvent) => Promise<void>;
}

export interface PublishEvidenceInput {
  readonly artifact: unknown;
  readonly idempotencyKey: string;
}

export interface PublicationResult {
  readonly digest: ArtifactDigest;
  readonly attempts: readonly PublicationAttemptRecord[];
}

export class PublicationProviderError extends Error {
  readonly code: PublicationFailureCode;
  readonly retryable: boolean;

  constructor(code: PublicationFailureCode, message: string, retryable = true) {
    super(message);
    this.name = "PublicationProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

const validTransactionHash = /^0x[0-9a-fA-F]{64}$/;

/** Validate the graph that is hydrated from durable object/attempt/locator/
 * verification rows before callers are allowed to treat it as verified. */
export function assertDurablePublicationAttempt(record: PublicationAttemptRecord): void {
  if (record.state !== "verified") {
    return;
  }
  const locator = record.locator;
  const verification = record.verification;
  const matchingLocator =
    locator !== null &&
    locator.immutable === true &&
    locator.provider === record.provider &&
    locator.providerLabel === record.providerLabel &&
    locator.network === record.configuredNetwork &&
    locator.bucket === record.configuredBucket &&
    locator.version === record.artifactVersion &&
    locator.sha256Digest.toLowerCase() === record.sha256Digest.toLowerCase() &&
    locator.keccak256Digest.toLowerCase() === record.keccak256Digest.toLowerCase() &&
    locator.sizeBytes === record.sizeBytes &&
    locator.verifiedAt !== null;
  const matchingVerification =
    verification !== null &&
    verification.status === "verified" &&
    verification.readbackStatus === "matched" &&
    verification.hashesMatch === true &&
    verification.sizeMatches === true &&
    verification.expectedSha256Digest.toLowerCase() === record.sha256Digest.toLowerCase() &&
    verification.observedSha256Digest?.toLowerCase() === record.sha256Digest.toLowerCase() &&
    verification.expectedKeccak256Digest.toLowerCase() === record.keccak256Digest.toLowerCase() &&
    verification.observedKeccak256Digest?.toLowerCase() === record.keccak256Digest.toLowerCase() &&
    verification.expectedSizeBytes === record.sizeBytes &&
    verification.observedSizeBytes === record.sizeBytes;
  if (!matchingLocator || !matchingVerification) {
    throw new PublicationProviderError(
      "DURABLE_GRAPH_INVALID",
      "Verified publication is missing matching locator or readback evidence",
      false
    );
  }
  if (record.provider === "greenfield") {
    if (
      record.sealTransactionHash === null ||
      !validTransactionHash.test(record.sealTransactionHash) ||
      verification?.sealConfirmed !== true
    ) {
      throw new PublicationProviderError(
        "DURABLE_GRAPH_INVALID",
        "Verified Greenfield publication is missing canonical seal confirmation",
        false
      );
    }
  }
}

export function isPublicationProviderError(error: unknown): error is PublicationProviderError {
  return error instanceof PublicationProviderError;
}

export function assertPublicationAttemptState(value: unknown): PublicationAttemptState {
  return publicationAttemptStateSchema.parse(value);
}

export type { CanonicalArtifact };
