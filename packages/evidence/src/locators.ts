import { z } from "zod";

export const locatorProviders = ["ipfs", "greenfield"] as const;
export type LocatorProvider = (typeof locatorProviders)[number];

const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

function uriForProvider(provider: LocatorProvider, value: string): boolean {
  if (provider === "ipfs") {
    return /^ipfs:\/\/[^\s]+$/.test(value);
  }
  return /^(?:greenfield|gnfd):\/\/[^\s]+$/.test(value);
}

export const evidenceLocatorSchema = z
  .object({
    provider: z.enum(locatorProviders),
    providerLabel: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    network: z.string().trim().min(1).max(128),
    uri: z.string().trim().min(1).max(2_000),
    bucket: z.string().trim().min(1).max(128).nullable(),
    objectName: z.string().trim().min(1).max(1_024).nullable(),
    providerReference: z.string().trim().min(1).max(512).nullable(),
    version: z.number().int().positive(),
    sha256Digest: digestSchema,
    keccak256Digest: digestSchema,
    sizeBytes: z.number().int().nonnegative(),
    immutable: z.literal(true),
    verifiedAt: timestampSchema.nullable()
  })
  .superRefine((value, context) => {
    if (!uriForProvider(value.provider, value.uri)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["uri"], message: "URI does not match provider" });
    }
    if (value.provider === "greenfield" && (value.bucket === null || value.objectName === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bucket"],
        message: "Greenfield locators require bucket and objectName"
      });
    }
    if (value.provider === "ipfs" && value.bucket !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["bucket"], message: "IPFS has no bucket" });
    }
  });

export type EvidenceLocator = z.infer<typeof evidenceLocatorSchema>;

export const verificationStatuses = ["not_verified", "verified", "failed"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const readbackStatuses = [
  "not_attempted",
  "matched",
  "missing",
  "corrupt",
  "timeout",
  "provider_failed"
] as const;
export type ReadbackStatus = (typeof readbackStatuses)[number];

export const verificationResultSchema = z
  .object({
    status: z.enum(verificationStatuses),
    checkedAt: timestampSchema,
    sealConfirmed: z.boolean().nullable(),
    readbackStatus: z.enum(readbackStatuses),
    expectedSha256Digest: digestSchema,
    observedSha256Digest: digestSchema.nullable(),
    expectedKeccak256Digest: digestSchema,
    observedKeccak256Digest: digestSchema.nullable(),
    expectedSizeBytes: z.number().int().nonnegative(),
    observedSizeBytes: z.number().int().nonnegative().nullable(),
    hashesMatch: z.boolean(),
    sizeMatches: z.boolean(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).nullable()
  })
  .strict();

export type VerificationResult = z.infer<typeof verificationResultSchema>;

export function createVerificationResult(input: {
  readonly checkedAt: Date;
  readonly sealConfirmed: boolean | null;
  readonly expectedSha256Digest: string;
  readonly observedSha256Digest: string | null;
  readonly expectedKeccak256Digest: string;
  readonly observedKeccak256Digest: string | null;
  readonly expectedSizeBytes: number;
  readonly observedSizeBytes: number | null;
  readonly readbackStatus: ReadbackStatus;
  readonly reasonCode?: string | null;
}): VerificationResult {
  const hashesMatch =
    input.observedSha256Digest === input.expectedSha256Digest &&
    input.observedKeccak256Digest === input.expectedKeccak256Digest;
  const sizeMatches = input.observedSizeBytes === input.expectedSizeBytes;
  const verified =
    input.readbackStatus === "matched" &&
    input.sealConfirmed !== false &&
    hashesMatch &&
    sizeMatches;
  return verificationResultSchema.parse({
    status: verified ? "verified" : "failed",
    checkedAt: input.checkedAt.toISOString(),
    sealConfirmed: input.sealConfirmed,
    readbackStatus: input.readbackStatus,
    expectedSha256Digest: input.expectedSha256Digest,
    observedSha256Digest: input.observedSha256Digest,
    expectedKeccak256Digest: input.expectedKeccak256Digest,
    observedKeccak256Digest: input.observedKeccak256Digest,
    expectedSizeBytes: input.expectedSizeBytes,
    observedSizeBytes: input.observedSizeBytes,
    hashesMatch,
    sizeMatches,
    reasonCode: input.reasonCode ?? null
  });
}

export function createEvidenceLocator(input: {
  readonly provider: LocatorProvider;
  readonly providerLabel: string;
  readonly network: string;
  readonly uri: string;
  readonly bucket?: string | null;
  readonly objectName?: string | null;
  readonly providerReference?: string | null;
  readonly version: number;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly verifiedAt?: Date | null;
}): EvidenceLocator {
  return evidenceLocatorSchema.parse({
    ...input,
    bucket: input.bucket ?? null,
    objectName: input.objectName ?? null,
    providerReference: input.providerReference ?? null,
    immutable: true,
    verifiedAt: input.verifiedAt?.toISOString() ?? null
  });
}
