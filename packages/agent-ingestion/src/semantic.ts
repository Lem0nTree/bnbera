import { AppError } from "@bnbera/config";
import { canonicalSha256Hex, canonicalizeJson, erc8004IdentityKey, normalizeErc8004Identity, agentCategorySchema, type AgentCategory, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertSafePublicValue } from "./normalize.js";

export const semanticDocumentSchemaVersion = "bnbera-agent-semantic-v1" as const;

export type SemanticDocumentInput = {
  readonly identity: Erc8004Identity;
  readonly category: AgentCategory;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly capabilityManifest?: unknown;
  readonly protocols?: readonly unknown[];
  readonly actions?: readonly unknown[];
  readonly services?: readonly unknown[];
  readonly riskSummary?: Readonly<Record<string, unknown>>;
  readonly authoritySummary?: Readonly<Record<string, unknown>>;
  readonly evidenceSummary?: Readonly<Record<string, unknown>>;
  readonly classifierVersion?: string;
};

export type SemanticDocument = {
  readonly schemaVersion: typeof semanticDocumentSchemaVersion;
  readonly identity: Erc8004Identity;
  readonly identityKey: string;
  readonly category: AgentCategory;
  readonly name: string | null;
  readonly description: string | null;
  readonly capabilities: readonly Readonly<Record<string, unknown>>[];
  readonly protocols: readonly string[];
  readonly actions: readonly string[];
  readonly services: readonly Readonly<Record<string, string>>[];
  readonly riskSummary: Readonly<Record<string, unknown>>;
  readonly authoritySummary: Readonly<Record<string, unknown>>;
  readonly evidenceSummary: Readonly<Record<string, unknown>>;
  readonly classifierVersion: string | null;
};

export type CanonicalSemanticDocument = {
  readonly document: SemanticDocument;
  readonly text: string;
  readonly digest: string;
  readonly schemaVersion: typeof semanticDocumentSchemaVersion;
};

export type EmbeddingProvider = {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  embed(input: string): Promise<readonly number[]>;
  /** Optional provider-native batching. Implementations preserve input order. */
  readonly embedMany?: (inputs: readonly string[]) => Promise<readonly (readonly number[])[]>;
};

export type ValidatedEmbedding = {
  readonly vector: readonly number[];
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
};

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.length > max) throw ingestionError("INGESTION_INPUT_INVALID", "Semantic document text exceeds the configured limit.", "reduce_semantic_text");
  if (/[\u0000-\u001f\u007f]/u.test(text)) return null;
  // Registration metadata is untrusted text. Do not send obvious credentials,
  // bearer material, or live numeric financial observations to a provider.
  if (containsProhibitedText(text)) return null;
  return text;
}

const prohibitedKey = /(price|yield|balance|liquidity|amount|cost|fee|volume|market|health[_ -]?factor|transaction|receipt|tx|log|review|runtime|prompt|private|secret|session|user|credential|authorization|auth|password|mnemonic|seed[ _-]?phrase|token|api[_ -]?key|access[_ -]?token|raw[_ -]?log)/iu;
const secretText = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api|access|secret|auth|bearer|token|password|mnemonic|seed[ -]?phrase|private[ -]?key)\s*[:=]\s*[^\s,}]+|\b(?:sk|pk|rk|sk-proj)-[A-Za-z0-9_-]{12,})/iu;
const liveFinancialText = /(?:\b\d+(?:\.\d+)?\s*%|[$€£]\s*\d|\b(?:usd|usdt|usdc|bnb|eth)\s*[:=]\s*\d|\b(?:price|yield|balance|liquidity|tvl|apr|apy|volume|market[_ -]?cap)\s*[:=]\s*\d)/iu;

function containsProhibitedText(value: string): boolean {
  return secretText.test(value) || liveFinancialText.test(value);
}

function stringList(value: unknown, maxItems = 128, maxLength = 160): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => boundedText(item, maxLength))
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, maxItems);
}

const schemaKeys = new Set([
  "type",
  "title",
  "description",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "enum",
  "const",
  "oneOf",
  "anyOf",
  "allOf",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems"
]);

function safeSchema(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return boundedText(value, 512);
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => safeSchema(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!schemaKeys.has(key) || prohibitedKey.test(key)) continue;
    const safe = safeSchema(item, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function safeSummary(value: Readonly<Record<string, unknown>> | undefined, field: string): Readonly<Record<string, unknown>> {
  const summary = value ?? {};
  const entries = Object.entries(summary)
    .filter(([key]) => key.trim().length > 0 && key.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(key) && !prohibitedKey.test(key))
    .slice(0, 64)
    .map(([key, item]) => [key.slice(0, 128), safePublicValue(item)] as const)
    .filter((entry): entry is readonly [string, PublicSemanticValue] => entry[1] !== undefined);
  const accepted = Object.fromEntries(entries);
  assertSafePublicValue(accepted, field);
  return accepted;
}

type PublicSemanticValue = null | boolean | number | string | readonly PublicSemanticValue[] | Readonly<{ [key: string]: PublicSemanticValue }>;

function safePublicValue(value: unknown, depth = 0): PublicSemanticValue | undefined {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return boundedText(value, 1_000) ?? undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 64)
      .map((item) => safePublicValue(item, depth + 1))
      .filter((item): item is PublicSemanticValue => item !== undefined);
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const result: Record<string, PublicSemanticValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.trim().length === 0 || key.length > 128 || /[\u0000-\u001f\u007f]/u.test(key) || prohibitedKey.test(key)) continue;
    const safe = safePublicValue(item, depth + 1);
    if (safe !== undefined) result[key.trim()] = safe;
  }
  return result;
}

function capabilities(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const entries = Array.isArray(record.capabilities) ? record.capabilities : [];
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    // Pick the public, stable capability contract. Runtime logs, prompts,
    // pricing and private configuration are intentionally not copied.
    const result: Record<string, unknown> = {
      id: boundedText(item.id ?? item.name, 160) ?? "unknown",
      description: boundedText(item.description, 2_000) ?? "",
      inputSchema: safeSchema(item.inputSchema) ?? { type: "object" },
      outputSchema: safeSchema(item.outputSchema) ?? { type: "object" },
      requiredProtocols: stringList(item.requiredProtocols, 32, 128),
      allowedActions: stringList(item.allowedActions, 64, 160)
    };
    assertSafePublicValue(result, "semantic.capability");
    return [result];
  }).slice(0, 128);
}

function serviceList(value: unknown): readonly Readonly<Record<string, string>>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const kind = boundedText(item.kind ?? item.type, 32);
    const url = boundedText(item.url ?? item.endpoint, 2_048);
    const protocolVersion = boundedText(item.protocolVersion ?? item.version, 128);
    if (kind === null || url === null || protocolVersion === null) return [];
    let parsed: URL;
    try { parsed = new URL(url); } catch { return []; }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username !== "" || parsed.password !== "" || containsProhibitedText(parsed.pathname)) return [];
    // Query strings frequently carry bearer-like material in third-party
    // descriptors. They are not needed for semantic discovery.
    parsed.search = "";
    parsed.hash = "";
    return [{ kind, url: parsed.toString(), protocolVersion }];
  }).slice(0, 128);
}

/**
 * Build the only text that may be sent to an embedding provider. The input is
 * an allow-list rather than a clone of a provider response.
 */
export function buildSemanticDocument(input: SemanticDocumentInput): CanonicalSemanticDocument {
  const identity = normalizeErc8004Identity(input.identity);
  const category = agentCategorySchema.parse(input.category);
  const document: SemanticDocument = {
    schemaVersion: semanticDocumentSchemaVersion,
    identity,
    identityKey: erc8004IdentityKey(identity),
    category,
    name: boundedText(input.name, 160),
    description: boundedText(input.description, 2_000),
    capabilities: capabilities(input.capabilityManifest),
    protocols: stringList(input.protocols, 64, 128),
    actions: stringList(input.actions, 128, 160),
    services: serviceList(input.services),
    riskSummary: safeSummary(input.riskSummary, "semantic.riskSummary"),
    authoritySummary: safeSummary(input.authoritySummary, "semantic.authoritySummary"),
    evidenceSummary: safeSummary(input.evidenceSummary, "semantic.evidenceSummary"),
    classifierVersion: boundedText(input.classifierVersion, 64)
  };
  assertSafePublicValue(document, "semantic.document");
  const text = canonicalizeJson(document);
  return { document, text, digest: canonicalSha256Hex(document), schemaVersion: semanticDocumentSchemaVersion };
}

function safeVersion(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128 || /[\u0000-\u001f\u007f]/u.test(normalized)) throw ingestionError("EMBEDDING_CONFIG_INVALID", `The embedding ${field} is invalid.`, "fix_embedding_configuration");
  return normalized;
}

export function validateEmbeddingProvider(provider: EmbeddingProvider): EmbeddingProvider {
  const providerName = safeVersion(provider.provider, "provider");
  const model = safeVersion(provider.model, "model");
  const modelVersion = safeVersion(provider.modelVersion, "model version");
  if (!Number.isSafeInteger(provider.dimension) || provider.dimension < 1 || provider.dimension > 16_384) throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding dimension is outside the safe bound.", "fix_embedding_configuration");
  if (typeof provider.embed !== "function") throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding provider has no embed function.", "fix_embedding_configuration");
  if (provider.embedMany !== undefined && typeof provider.embedMany !== "function") throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding provider batch function is invalid.", "fix_embedding_configuration");
  // Class-based adapters expose methods on their prototype, so a plain object
  // spread would silently drop the callable methods. Bind them to preserve
  // adapter `this` semantics after normalization.
  return {
    ...provider,
    provider: providerName,
    model,
    modelVersion,
    embed: provider.embed.bind(provider),
    ...(provider.embedMany === undefined ? {} : { embedMany: provider.embedMany.bind(provider) })
  };
}

export async function embedSemanticDocument(document: CanonicalSemanticDocument, provider: EmbeddingProvider): Promise<ValidatedEmbedding> {
  const validatedProvider = validateEmbeddingProvider(provider);
  const vectors = await embedSemanticDocuments([document], validatedProvider);
  const vector = vectors[0];
  if (vector === undefined) {
    throw ingestionError("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned no vector.", "retry_embedding");
  }
  return {
    vector,
    provider: validatedProvider.provider,
    model: validatedProvider.model,
    modelVersion: validatedProvider.modelVersion,
    dimension: validatedProvider.dimension
  };
}

/**
 * Generate embeddings for canonical documents with provider-native batching
 * when available. The fallback remains sequential and bounded, which keeps a
 * provider outage from creating an unbounded promise fan-out.
 */
export async function embedSemanticDocuments(
  documents: readonly CanonicalSemanticDocument[],
  provider: EmbeddingProvider
): Promise<readonly (readonly number[])[]> {
  const validatedProvider = validateEmbeddingProvider(provider);
  if (!Array.isArray(documents) || documents.length === 0 || documents.length > 1_024) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The semantic document batch is outside the supported bound.", "reduce_embedding_batch");
  }
  let vectors: readonly (readonly number[])[];
  try {
    vectors = validatedProvider.embedMany === undefined
      ? await sequentialEmbeddings(documents, validatedProvider)
      : await validatedProvider.embedMany(documents.map((document) => document.text));
  } catch (cause) {
    // The provider adapter owns detailed retry/status classification. This
    // boundary preserves its already-safe application envelope while hiding
    // arbitrary transport diagnostics from callers that use another adapter.
    if (cause instanceof AppError) throw cause;
    throw ingestionError("EMBEDDING_PROVIDER_FAILED", "The semantic embedding provider failed.", "retry_embedding", cause, true);
  }
  if (!Array.isArray(vectors) || vectors.length !== documents.length) {
    throw ingestionError("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an unexpected number of vectors.", "retry_embedding");
  }
  return vectors.map((vector) => {
    if (!Array.isArray(vector) || vector.length !== validatedProvider.dimension || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw ingestionError("EMBEDDING_DIMENSION_MISMATCH", "The embedding provider returned an invalid dimension or value.", "fix_embedding_provider");
    }
    const normSquared = vector.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(normSquared) || normSquared === 0) {
      // pgvector excludes zero vectors from cosine indexes. Rejecting them
      // before persistence keeps a provider failure from becoming a silently
      // incomplete semantic index.
      throw ingestionError("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned a zero vector.", "fix_embedding_provider");
    }
    return vector.map((value) => Object.is(value, -0) ? 0 : value);
  });
}

async function sequentialEmbeddings(
  documents: readonly CanonicalSemanticDocument[],
  provider: EmbeddingProvider
): Promise<readonly (readonly number[])[]> {
  const vectors: Array<readonly number[]> = [];
  for (const document of documents) {
    vectors.push(await provider.embed(document.text));
  }
  return vectors;
}
