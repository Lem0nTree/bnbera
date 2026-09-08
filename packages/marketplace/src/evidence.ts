import { z } from "zod";

/**
 * The marketplace only projects the two public artifacts that make the
 * Greenfield read path judgeable.  The evidence writer owns the graph; this
 * module is deliberately a small, read-only normalizer over that graph.
 */
export const marketplaceEvidenceArtifactTypes = ["agent_profile", "run_bundle"] as const;
export type MarketplaceEvidenceArtifactType = (typeof marketplaceEvidenceArtifactTypes)[number];

export const marketplaceEvidenceStatuses = ["verified", "pending", "failed", "unavailable"] as const;
export type MarketplaceEvidenceStatus = (typeof marketplaceEvidenceStatuses)[number];

const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/u);
const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
const zeroTransactionHashPattern = /^0x0{64}$/u;
const timestampSchema = z.string().datetime({ offset: true });

function safeHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeOrigin(value: string): string | null {
  const url = safeHttpsUrl(value);
  if (url === null) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Only a configured HTTPS origin can become a public read link.  A provider
 * reference is not trusted merely because it looks like a URL: it must be
 * HTTPS, credential-free, and belong to the explicit allowlist.
 */
export function allowlistedGreenfieldReadUrl(
  value: unknown,
  allowedOrigins: readonly string[]
): string | null {
  if (typeof value !== "string") return null;
  const candidate = safeHttpsUrl(value.trim());
  if (candidate === null) return null;
  const origin = new URL(candidate).origin;
  const allowlist = new Set(allowedOrigins.flatMap((entry) => {
    const parsed = safeOrigin(entry.trim());
    return parsed === null ? [] : [parsed];
  }));
  return allowlist.has(origin) ? candidate : null;
}

function safeGreenfieldLocator(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("greenfield://") || candidate.length <= "greenfield://".length) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "greenfield:" || parsed.username !== "" || parsed.password !== "" || parsed.hostname === "" || parsed.search !== "" || parsed.hash !== "") return null;
    // The locator is an internal bucket/object reference.  Keep it inert and
    // reject traversal/control characters before it can reach a UI link.
    if (/[\u0000-\u001f\u007f\\]/u.test(candidate) || parsed.pathname.split("/").some((segment) => segment === "." || segment === "..")) return null;
    return candidate;
  } catch {
    return null;
  }
}

function digest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^0x/iu, "");
  return digestSchema.safeParse(normalized).success ? normalized.toLowerCase() : null;
}

function normalizedOptionalTxHash(value: unknown): { readonly value: string | null; readonly valid: boolean } {
  if (value === null || value === undefined) return { value: null, valid: true };
  if (typeof value !== "string") return { value: null, valid: false };
  const candidate = value.trim();
  if (candidate.length === 0 || zeroTransactionHashPattern.test(candidate)) return { value: null, valid: true };
  return transactionHashSchema.safeParse(candidate).success
    ? { value: candidate.toLowerCase(), valid: true }
    : { value: null, valid: false };
}

function normalizedSchemaTxHash(value: unknown): unknown {
  const normalized = normalizedOptionalTxHash(value);
  return normalized.valid ? normalized.value : value;
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  if (typeof value !== "string") return null;
  const parsed = timestampSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const candidate = typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
      ? value
      : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function positiveInteger(value: unknown): number | null {
  const candidate = nonNegativeInteger(value);
  return candidate !== null && candidate > 0 ? candidate : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null;
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return z.string().uuid().safeParse(normalized).success ? normalized : null;
}

const evidenceSummarySchema = z.string().trim().min(1).max(500);

/** A sanitized, public-facing link for one versioned evidence artifact. */
export const marketplaceEvidenceArtifactSchema = z.object({
  artifactType: z.enum(marketplaceEvidenceArtifactTypes),
  artifactId: z.string().trim().min(1).max(160).nullable(),
  /** A run_bundle is only linkable from the exact commerce job that produced it. */
  jobId: z.string().uuid().nullable().optional().default(null),
  version: z.number().int().positive().nullable(),
  status: z.enum(marketplaceEvidenceStatuses),
  summary: evidenceSummarySchema,
  provider: z.literal("greenfield").nullable(),
  readUrl: z.string().url().nullable(),
  locator: z.string().nullable(),
  sha256Digest: digestSchema.nullable(),
  keccak256Digest: digestSchema.nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sealTransactionHash: z.preprocess(normalizedSchemaTxHash, transactionHashSchema.nullable()),
  verifiedAt: timestampSchema.nullable(),
  reason: z.string().trim().min(1).max(500).nullable()
}).superRefine((value, context) => {
  if (value.readUrl !== null) {
    const url = safeHttpsUrl(value.readUrl);
    if (url === null || url !== value.readUrl) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["readUrl"], message: "Evidence read URLs must be canonical HTTPS URLs without credentials" });
    }
  }
  if (value.locator !== null && safeGreenfieldLocator(value.locator) !== value.locator) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["locator"], message: "Evidence locators must be internal greenfield:// references" });
  }
  if (value.status === "verified") {
    if (value.provider !== "greenfield" || value.readUrl === null || value.locator === null || value.sha256Digest === null || value.keccak256Digest === null || value.sizeBytes === null || value.verifiedAt === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Verified Greenfield evidence must include a safe read URL, locator, matching digests/size, seal confirmation, and verification time" });
    }
    if (value.reason !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Verified evidence cannot carry a failure reason" });
  } else {
    if (value.readUrl !== null || value.locator !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["readUrl"], message: "Unverified evidence cannot expose a Greenfield locator or link" });
    }
    if (value.reason === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Unverified evidence must explain why the link is unavailable" });
  }
});

export type MarketplaceEvidenceArtifact = z.infer<typeof marketplaceEvidenceArtifactSchema>;

export const marketplaceEvidenceProjectionSchema = z.object({
  currentVersion: z.number().int().positive().nullable().default(null),
  profile: marketplaceEvidenceArtifactSchema,
  runBundle: marketplaceEvidenceArtifactSchema
}).strict();

export type MarketplaceEvidenceProjection = z.infer<typeof marketplaceEvidenceProjectionSchema>;

export type MarketplaceEvidenceLocatorInput = {
  readonly provider?: unknown;
  readonly uri?: unknown;
  readonly bucket?: unknown;
  readonly objectName?: unknown;
  readonly providerReference?: unknown;
  readonly version?: unknown;
  readonly sha256Digest?: unknown;
  readonly keccak256Digest?: unknown;
  readonly sizeBytes?: unknown;
  readonly immutable?: unknown;
  readonly verifiedAt?: unknown;
  /** Publication attempt that produced this locator. */
  readonly publicationAttemptId?: unknown;
};

export type MarketplaceEvidenceVerificationInput = {
  readonly status?: unknown;
  readonly sealConfirmed?: unknown;
  readonly readbackStatus?: unknown;
  readonly expectedSha256Digest?: unknown;
  readonly observedSha256Digest?: unknown;
  readonly expectedKeccak256Digest?: unknown;
  readonly observedKeccak256Digest?: unknown;
  readonly expectedSizeBytes?: unknown;
  readonly observedSizeBytes?: unknown;
  readonly hashesMatch?: unknown;
  readonly sizeMatches?: unknown;
  readonly reasonCode?: unknown;
  readonly checkedAt?: unknown;
  /** Publication attempt whose read-back this verification covers. */
  readonly publicationAttemptId?: unknown;
};

/**
 * A deliberately structural input keeps @bnbera/marketplace independent of
 * the persistence package.  The web projection maps database rows to this
 * shape and can therefore degrade just evidence if the optional tables are
 * unavailable.
 */
export type MarketplaceEvidenceGraphInput = {
  readonly artifactType: unknown;
  readonly artifactId?: unknown;
  readonly version?: unknown;
  readonly objectState?: unknown;
  readonly objectSha256Digest?: unknown;
  readonly objectKeccak256Digest?: unknown;
  readonly objectSizeBytes?: unknown;
  readonly objectSealTransactionHash?: unknown;
  readonly objectReadbackVerifiedAt?: unknown;
  readonly locator?: MarketplaceEvidenceLocatorInput | null;
  readonly verification?: MarketplaceEvidenceVerificationInput | null;
  /** Optional provider-supplied HTTPS read URL. */
  readonly readUrl?: unknown;
  /** Commerce job binding for a run_bundle; null for an agent_profile. */
  readonly jobId?: unknown;
};

export type MarketplaceEvidenceProjectionOptions = {
  /** Current marketplace version, used only to label older exact evidence. */
  readonly currentVersion?: number | null;
  /** Explicitly allowlisted HTTPS origins for provider read URLs. */
  readonly allowedReadUrlOrigins?: readonly string[];
  /** Optional configured base used only when the adapter has no URL field. */
  readonly readUrlBase?: string;
};

function defaultArtifact(type: MarketplaceEvidenceArtifactType, reason: string): MarketplaceEvidenceArtifact {
  return {
    artifactType: type,
    artifactId: null,
    jobId: null,
    version: null,
    status: "unavailable",
    summary: "No verified Greenfield publication is available.",
    provider: null,
    readUrl: null,
    locator: null,
    sha256Digest: null,
    keccak256Digest: null,
    sizeBytes: null,
    sealTransactionHash: null,
    verifiedAt: null,
    reason
  };
}

function artifactType(value: unknown): MarketplaceEvidenceArtifactType | null {
  return marketplaceEvidenceArtifactTypes.includes(value as MarketplaceEvidenceArtifactType)
    ? value as MarketplaceEvidenceArtifactType
    : null;
}

function failureState(value: unknown): boolean {
  return typeof value === "string" && [
    "validation_failed",
    "create_failed",
    "upload_failed",
    "seal_timeout",
    "readback_failed",
    "hash_mismatch",
    "failed",
    "rejected"
  ].includes(value.trim().toLowerCase());
}

function pendingState(value: unknown): boolean {
  return typeof value === "string" && [
    "pending",
    "validating",
    "creating_object",
    "uploading",
    "awaiting_seal",
    "reading_back",
    "submitted",
    "uploaded",
    "sealed"
  ].includes(value.trim().toLowerCase());
}

function locatorValue(input: MarketplaceEvidenceGraphInput): string | null {
  const locator = input.locator;
  if (locator === null || locator === undefined) return null;
  const direct = safeGreenfieldLocator(locator.uri);
  if (direct !== null) return direct;
  const bucket = text(locator.bucket, 128);
  const objectName = text(locator.objectName, 2_000);
  if (bucket === null || objectName === null || /[\u0000-\u001f\u007f\\]/u.test(`${bucket}/${objectName}`) || objectName.split("/").includes("..")) return null;
  return safeGreenfieldLocator(`greenfield://${bucket}/${objectName}`);
}

function verifiedGraph(input: MarketplaceEvidenceGraphInput): {
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly version: number;
  readonly verifiedAt: string;
  readonly locator: string;
  readonly readUrl: string;
  readonly sealTransactionHash: string | null;
} | null {
  const locator = input.locator;
  const verification = input.verification;
  if (locator === null || locator === undefined || verification === null || verification === undefined) return null;
  if (locator.provider !== "greenfield" || locator.immutable !== true || verification.status !== "verified" || verification.readbackStatus !== "matched" || verification.sealConfirmed !== true || verification.hashesMatch !== true || verification.sizeMatches !== true) return null;
  const locatorPublicationAttemptId = uuid(locator.publicationAttemptId);
  const verificationPublicationAttemptId = uuid(verification.publicationAttemptId);
  if (locatorPublicationAttemptId === null || verificationPublicationAttemptId === null || locatorPublicationAttemptId !== verificationPublicationAttemptId) return null;
  const version = positiveInteger(input.version);
  const locatorVersion = positiveInteger(locator.version);
  const objectSha256Digest = digest(input.objectSha256Digest);
  const objectKeccak256Digest = digest(input.objectKeccak256Digest);
  const objectSizeBytes = nonNegativeInteger(input.objectSizeBytes);
  const locatorSha256Digest = digest(locator.sha256Digest);
  const locatorKeccak256Digest = digest(locator.keccak256Digest);
  const locatorSizeBytes = nonNegativeInteger(locator.sizeBytes);
  const expectedSha256Digest = digest(verification.expectedSha256Digest);
  const observedSha256Digest = digest(verification.observedSha256Digest);
  const expectedKeccak256Digest = digest(verification.expectedKeccak256Digest);
  const observedKeccak256Digest = digest(verification.observedKeccak256Digest);
  const expectedSizeBytes = nonNegativeInteger(verification.expectedSizeBytes);
  const observedSizeBytes = nonNegativeInteger(verification.observedSizeBytes);
  const sealTransaction = normalizedOptionalTxHash(input.objectSealTransactionHash);
  const sealTransactionHash = sealTransaction.value;
  const verifiedAt = timestamp(locator.verifiedAt) ?? timestamp(input.objectReadbackVerifiedAt) ?? timestamp(verification.checkedAt);
  const locatorValueResult = locatorValue(input);
  if (version === null || locatorVersion !== version || objectSha256Digest === null || objectKeccak256Digest === null || objectSizeBytes === null || locatorSha256Digest === null || locatorKeccak256Digest === null || locatorSizeBytes === null || expectedSha256Digest === null || observedSha256Digest === null || expectedKeccak256Digest === null || observedKeccak256Digest === null || expectedSizeBytes === null || observedSizeBytes === null || !sealTransaction.valid || verifiedAt === null || locatorValueResult === null) return null;
  if (objectSha256Digest !== locatorSha256Digest || objectKeccak256Digest !== locatorKeccak256Digest || objectSizeBytes !== locatorSizeBytes || objectSha256Digest !== expectedSha256Digest || expectedSha256Digest !== observedSha256Digest || objectKeccak256Digest !== expectedKeccak256Digest || expectedKeccak256Digest !== observedKeccak256Digest || objectSizeBytes !== expectedSizeBytes || expectedSizeBytes !== observedSizeBytes) return null;
  return {
    sha256Digest: objectSha256Digest,
    keccak256Digest: objectKeccak256Digest,
    sizeBytes: objectSizeBytes,
    version,
    sealTransactionHash,
    verifiedAt,
    locator: locatorValueResult,
    readUrl: ""
  };
}

function readUrlFromBase(input: MarketplaceEvidenceGraphInput, base: string | undefined): string | null {
  if (base === undefined || input.locator === null || input.locator === undefined) return null;
  const bucket = text(input.locator.bucket, 128);
  const objectName = text(input.locator.objectName, 2_000);
  if (bucket === null || objectName === null || objectName.split("/").some((segment) => segment === "." || segment === "..") || /[\u0000-\u001f\u007f\\?#]/u.test(`${bucket}/${objectName}`)) return null;
  const parsedBase = safeHttpsUrl(base.trim());
  if (parsedBase === null) return null;
  try {
    const baseUrl = new URL(parsedBase);
    const prefix = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
    const encodedPath = `${bucket}/${objectName.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
    return new URL(`${prefix}${encodedPath}`, baseUrl.origin).toString();
  } catch {
    return null;
  }
}

/** Project one evidence graph; any incomplete proof becomes a non-link. */
export function projectGreenfieldEvidence(
  input: MarketplaceEvidenceGraphInput,
  options: MarketplaceEvidenceProjectionOptions = {}
): MarketplaceEvidenceArtifact {
  const type = artifactType(input.artifactType);
  if (type === null) return defaultArtifact("agent_profile", "EVIDENCE_ARTIFACT_TYPE_UNAVAILABLE");
  const artifactId = text(input.artifactId, 160);
  const jobId = uuid(input.jobId);
  const version = positiveInteger(input.version);
  const graph = type === "run_bundle" && jobId === null ? null : verifiedGraph(input);
  const providerReference = typeof input.locator?.providerReference === "string" && input.locator.providerReference.trim().startsWith("https:")
    ? input.locator.providerReference
    : null;
  const readUrlCandidate = input.readUrl ?? providerReference ?? readUrlFromBase(input, options.readUrlBase);
  const allowedOrigins = options.allowedReadUrlOrigins !== undefined && options.allowedReadUrlOrigins.length > 0
    ? options.allowedReadUrlOrigins
    : options.readUrlBase === undefined
      ? []
      : [options.readUrlBase];
  const readUrl = allowlistedGreenfieldReadUrl(readUrlCandidate, allowedOrigins);
  if (graph !== null && readUrl !== null) {
    return marketplaceEvidenceArtifactSchema.parse({
      artifactType: type,
      artifactId,
      jobId,
      version: graph.version,
      status: "verified",
      summary: "Verified Greenfield publication with matching read-back hash, size, and seal.",
      provider: "greenfield",
      readUrl,
      locator: graph.locator,
      sha256Digest: graph.sha256Digest,
      keccak256Digest: graph.keccak256Digest,
      sizeBytes: graph.sizeBytes,
      sealTransactionHash: graph.sealTransactionHash,
      verifiedAt: graph.verifiedAt,
      reason: null
    });
  }
  const locatorProvider = input.locator?.provider;
  const verificationStatus = input.verification?.status;
  const failed = failureState(input.objectState) || verificationStatus === "failed";
  const pending = pendingState(input.objectState) || verificationStatus === "not_verified" || verificationStatus === undefined || verificationStatus === null;
  const reason = failed
    ? "GREENFIELD_PUBLICATION_FAILED"
    : graph !== null && readUrl === null
      ? "GREENFIELD_READ_URL_UNAVAILABLE"
      : locatorProvider !== undefined && locatorProvider !== null && locatorProvider !== "greenfield"
        ? "GREENFIELD_PROVIDER_UNAVAILABLE"
        : pending
          ? "GREENFIELD_VERIFICATION_PENDING"
          : "GREENFIELD_PUBLICATION_UNAVAILABLE";
  const status: MarketplaceEvidenceStatus = failed ? "failed" : pending ? "pending" : "unavailable";
  return marketplaceEvidenceArtifactSchema.parse({
    artifactType: type,
    artifactId,
    jobId,
    version,
    status,
    summary: status === "pending"
      ? "Greenfield publication is pending seal/read-back verification; no link is exposed yet."
      : status === "failed"
        ? "Greenfield publication failed verification; no link is exposed."
        : "No verified Greenfield publication is available; browsing and hiring remain available.",
    provider: null,
    readUrl: null,
    locator: null,
    sha256Digest: null,
    keccak256Digest: null,
    sizeBytes: null,
    sealTransactionHash: null,
    verifiedAt: null,
    reason
  });
}

export function projectEvidenceProjection(
  inputs: readonly MarketplaceEvidenceGraphInput[],
  options: MarketplaceEvidenceProjectionOptions = {}
): MarketplaceEvidenceProjection {
  const output: { currentVersion: number | null; profile: MarketplaceEvidenceArtifact; runBundle: MarketplaceEvidenceArtifact } = {
    currentVersion: options.currentVersion ?? null,
    profile: defaultArtifact("agent_profile", "AGENT_PROFILE_UNAVAILABLE"),
    runBundle: defaultArtifact("run_bundle", "RUN_BUNDLE_UNAVAILABLE")
  };
  for (const input of inputs) {
    const type = artifactType(input.artifactType);
    if (type === null) continue;
    const projected = projectGreenfieldEvidence(input, options);
    const key = type === "agent_profile" ? "profile" : "runBundle";
    const current = output[key];
    // Prefer a verified artifact, then the newest version.  A stale historical
    // job (for example an old version of an identity) must not overwrite the
    // current profile projection.
    const currentVersion = current.version ?? 0;
    const nextVersion = projected.version ?? 0;
    if ((projected.status === "verified" && current.status !== "verified") || (projected.status === current.status && nextVersion > currentVersion) || (current.status !== "verified" && projected.status === "pending" && nextVersion > currentVersion)) {
      output[key] = projected;
    }
  }
  return marketplaceEvidenceProjectionSchema.parse(output);
}

export function unavailableMarketplaceEvidence(): MarketplaceEvidenceProjection {
  return marketplaceEvidenceProjectionSchema.parse({
    currentVersion: null,
    profile: defaultArtifact("agent_profile", "AGENT_PROFILE_UNAVAILABLE"),
    runBundle: defaultArtifact("run_bundle", "RUN_BUNDLE_UNAVAILABLE")
  });
}
