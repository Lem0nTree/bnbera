import { z } from "zod";

const optionalUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:" || new URL(value).protocol === "http:");

const environmentVariableNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{0,127}$/u, "Secret references must be environment variable names");

const embeddingLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Embedding labels cannot contain control characters");

const embeddingModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u, "Embedding model identifiers must be provider/model labels")
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Embedding model identifiers cannot contain control characters");

const bscChainIdSchema = z.union([z.literal(56), z.literal(97)]);
type BscChainId = z.infer<typeof bscChainIdSchema>;

/**
 * Public embedding configuration. This deliberately contains a reference to
 * the secret location, never the secret itself. The adapter resolves the
 * reference at request time on the server boundary.
 */
export const runtimeEmbeddingConfigSchema = z.object({
  provider: z.literal("openrouter"),
  model: embeddingModelSchema,
  modelVersion: embeddingLabelSchema,
  dimension: z.number().int().min(1).max(16_384),
  secretReference: environmentVariableNameSchema.default("ERC8004_EMBEDDING_API_KEY")
});

export type RuntimeEmbeddingConfig = z.infer<typeof runtimeEmbeddingConfigSchema>;

export const runtimeEnvironmentSchema = z.enum([
  "development",
  "preview",
  "hackathon",
  "production"
]);

export const runtimeConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]),
  environment: runtimeEnvironmentSchema,
  appUrl: optionalUrlSchema,
  siweDomain: z.string().trim().min(1).max(253),
  databaseUrl: z.string().min(1).optional(),
  databaseSsl: z.boolean().default(false),
  bscChainId: bscChainIdSchema.default(97),
  // Read-only ERC-8004 synchronization and semantic retrieval are explicit
  // release gates. Missing flags remain false in every environment.
  erc8004IngestionEnabled: z.boolean().default(false),
  erc8004ScanDiscoveryEnabled: z.boolean().default(false),
  marketplaceSemanticRetrievalEnabled: z.boolean().default(false),
  /** Separate, explicitly labelled non-production escape hatch for a
   * read-only semantic canary while the checked-in release gate is false. */
  marketplaceSemanticCanaryEnabled: z.boolean().default(false),
  embedding: runtimeEmbeddingConfigSchema.nullable().default(null)
}).superRefine((value, context) => {
  if (value.marketplaceSemanticRetrievalEnabled && value.embedding === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["embedding"],
      message: "Semantic retrieval requires a complete embedding configuration"
    });
  }
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export type SemanticEmbeddingEnablement = "release" | "development-canary";

export type SemanticEmbeddingLockValidation = {
  readonly mode: SemanticEmbeddingEnablement;
  readonly releaseEnabled: boolean;
  readonly verificationStatus: string;
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

/**
 * Validate the checked-in semantic provider lock before a runtime can turn on
 * vector generation/querying. The lock's `releaseEnabled=false` cannot be
 * bypassed in preview/production; only an explicit development/test canary
 * flag can select the separately labelled canary mode.
 */
export function validateSemanticEmbeddingLock(
  lock: unknown,
  runtime: RuntimeConfig
): SemanticEmbeddingLockValidation {
  const root = record(lock);
  const embedding = record(root?.semanticEmbedding);
  if (embedding === null || runtime.embedding === null) {
    throw new Error("EMBEDDING_LOCK_UNRESOLVED");
  }
  const expected = {
    provider: runtime.embedding.provider,
    model: runtime.embedding.model,
    modelVersion: runtime.embedding.modelVersion,
    dimension: runtime.embedding.dimension
  } as const;
  for (const [field, value] of Object.entries(expected)) {
    if (embedding[field] !== value) throw new Error("EMBEDDING_LOCK_MISMATCH");
  }
  if (typeof embedding.endpoint !== "string" || embedding.endpoint.trim().length === 0 ||
    typeof embedding.semanticDocumentSchemaVersion !== "string" || embedding.semanticDocumentSchemaVersion.trim().length === 0 ||
    typeof embedding.secretReference !== "string" || embedding.secretReference !== runtime.embedding.secretReference ||
    typeof embedding.verificationStatus !== "string") {
    throw new Error("EMBEDDING_LOCK_INCOMPLETE");
  }
  if (embedding.verificationStatus !== "verified-live-read-only-canary") {
    throw new Error("EMBEDDING_LOCK_UNVERIFIED");
  }
  const releaseEnabled = embedding.releaseEnabled === true;
  if (releaseEnabled) return { mode: "release", releaseEnabled, verificationStatus: embedding.verificationStatus };
  const canaryAllowed = runtime.marketplaceSemanticCanaryEnabled === true &&
    (runtime.nodeEnv === "test" || runtime.environment === "development");
  if (!canaryAllowed) throw new Error("EMBEDDING_RELEASE_DISABLED");
  return { mode: "development-canary", releaseEnabled, verificationStatus: embedding.verificationStatus };
}

type StringEnvironment = Record<string, string | undefined>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("DATABASE_SSL must be true or false");
}

function parseFeatureGate(value: string | undefined): boolean {
  return value === "true";
}

function parseChainId(value: string | undefined): BscChainId {
  if (value === undefined) {
    return 97;
  }
  const normalized = value.trim();
  if (normalized !== "56" && normalized !== "97") {
    throw new Error("BSC_CHAIN_ID must be 56 (mainnet) or 97 (testnet)");
  }
  return normalized === "56" ? 56 : 97;
}

function parseEmbeddingDimension(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 1536;
  }
  const dimension = Number(value);
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384) {
    throw new Error("ERC8004_EMBEDDING_DIMENSION must be an integer between 1 and 16384");
  }
  return dimension;
}

function embeddingConfigFromEnvironment(env: StringEnvironment): RuntimeEmbeddingConfig | null {
  const configured = [
    env.ERC8004_EMBEDDING_PROVIDER,
    env.ERC8004_EMBEDDING_MODEL,
    env.ERC8004_EMBEDDING_MODEL_VERSION,
    env.ERC8004_EMBEDDING_DIMENSION,
    env.ERC8004_EMBEDDING_SECRET_REFERENCE
  ].some((value) => value !== undefined && value.trim() !== "");
  if (!configured) {
    return null;
  }

  return runtimeEmbeddingConfigSchema.parse({
    provider: env.ERC8004_EMBEDDING_PROVIDER,
    model: env.ERC8004_EMBEDDING_MODEL,
    modelVersion: env.ERC8004_EMBEDDING_MODEL_VERSION,
    dimension: parseEmbeddingDimension(env.ERC8004_EMBEDDING_DIMENSION),
    secretReference: env.ERC8004_EMBEDDING_SECRET_REFERENCE
  });
}

/**
 * Parse configuration without logging or copying secret values. Callers may
 * pass a restricted environment object in tests instead of process.env.
 */
export function loadRuntimeConfig(env: StringEnvironment = process.env): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const environment = env.BNBERA_ENV ?? (nodeEnv === "production" ? "production" : "development");
  const appUrl = env.APP_URL ?? "http://localhost:3000";
  const siweDomain = env.SIWE_DOMAIN ?? new URL(appUrl).host;

  return runtimeConfigSchema.parse({
    nodeEnv,
    environment,
    appUrl,
    siweDomain,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: parseBoolean(env.DATABASE_SSL, false),
    bscChainId: parseChainId(env.BSC_CHAIN_ID),
    erc8004IngestionEnabled: parseFeatureGate(env.ERC8004_INGESTION_ENABLED),
    erc8004ScanDiscoveryEnabled: parseFeatureGate(env.ERC8004SCAN_DISCOVERY_ENABLED),
    marketplaceSemanticRetrievalEnabled: parseFeatureGate(env.MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED),
    marketplaceSemanticCanaryEnabled: parseFeatureGate(env.MARKETPLACE_SEMANTIC_CANARY_ENABLED),
    embedding: embeddingConfigFromEnvironment(env)
  });
}
