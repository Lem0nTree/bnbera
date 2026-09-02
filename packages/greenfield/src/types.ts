import type { CanonicalArtifact, ArtifactDigest } from "@bnbera/evidence";
import { evidenceLocatorSchema, verificationResultSchema } from "@bnbera/evidence";
import { publicationAttemptStates, publicationProviders } from "@bnbera/domain";
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
  "CREATE_FAILED",
  "UPLOAD_FAILED",
  "PROVIDER_FAILED",
  "TIMEOUT",
  "MISSING_OBJECT",
  "HASH_MISMATCH",
  "SIZE_MISMATCH",
  "DUPLICATE_IDEMPOTENCY_KEY",
  "UNSUPPORTED_PROVIDER"
] as const;
export type PublicationFailureCode = (typeof publicationFailureCodes)[number];

const timestampSchema = z.string().datetime({ offset: true });
const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const publicationAttemptRecordSchema = z
  .object({
    attemptId: z.string().trim().min(1).max(160),
    idempotencyKey: z.string().trim().min(1).max(256),
    provider: z.enum(publicationProviders),
    artifactId: z.string().trim().min(1).max(160),
    artifactType: z.string().trim().min(1).max(64),
    artifactVersion: z.number().int().positive(),
    objectName: z.string().trim().min(1).max(1_024),
    sha256Digest: digestSchema,
    keccak256Digest: digestSchema,
    sizeBytes: z.number().int().nonnegative(),
    state: publicationAttemptStateSchema,
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
  }) => Promise<GreenfieldCreateReceipt>;
  readonly uploadObject: (input: PublicationUploadInput & { readonly objectReference: string }) => Promise<GreenfieldUploadReceipt>;
  readonly waitForSeal: (input: {
    readonly objectReference: string;
    readonly attempt: number;
  }) => Promise<GreenfieldSealReceipt>;
  readonly readObject: (input: { readonly objectReference: string }) => Promise<Uint8Array>;
}

export interface PublicationStore {
  readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<PublicationAttemptRecord | null>;
  readonly findByAttemptId: (attemptId: string) => Promise<PublicationAttemptRecord | null>;
  readonly save: (record: PublicationAttemptRecord) => Promise<void>;
}

export interface PublishEvidenceInput {
  readonly artifact: unknown;
  readonly idempotencyKey: string;
  readonly providers: readonly PublicationProvider[];
  readonly objectName?: string;
  readonly ipfsNetwork?: string;
  readonly greenfieldNetwork?: string;
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

export function isPublicationProviderError(error: unknown): error is PublicationProviderError {
  return error instanceof PublicationProviderError;
}

export function assertPublicationAttemptState(value: unknown): PublicationAttemptState {
  return publicationAttemptStateSchema.parse(value);
}

export type { CanonicalArtifact };
