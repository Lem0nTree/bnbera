/**
 * Server-only marketplace read wiring.
 *
 * This module is imported by route handlers and server components only. Keep
 * it out of the shared web contract: pg and the ingestion repository must
 * never be reachable from a client component or browser bundle.
 */
import { AppError, loadRuntimeConfig, validateSemanticEmbeddingLock } from "@bnbera/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  IngestionMarketplaceSource,
  MarketplaceReadService,
  VectorMarketplaceSemanticRetriever,
  type MarketplaceSearchResponse as CoreMarketplaceSearchResponse
} from "@bnbera/marketplace";
import {
  PgVectorSemanticRepository,
  PostgresIngestionRepository,
  createEmbeddingProviderFromRuntimeConfig,
  semanticDocumentSchemaVersion,
  type IngestionRepository
} from "@bnbera/agent-ingestion";
import {
  agentCategorySchema,
  erc8004IdentityKey,
  erc8004IdentitySchema,
  evmAddressSchema,
  type AgentCategory,
  type Erc8004Identity
} from "@bnbera/domain";
import {
  marketplaceActivationOfferSchema,
  marketplaceAuthoritySchema,
  marketplaceExecutionEvidenceSchema,
  marketplaceFreshnessSchema,
  marketplacePricingSchema,
  marketplaceSearchRequestSchema,
  marketplaceListingMetadataSchema,
  marketplaceMetricsSchema,
  type MarketplaceListingMetadata,
  type MarketplaceSearchRequest
} from "@bnbera/marketplace";
import {
  configuredMarketplaceDataMode,
  mapMarketplaceDetailResponse,
  mapMarketplaceSearchResponse,
  marketplaceDetailErrorResponse,
  marketplaceSearchErrorResponse,
  marketplaceReadContractVersion,
  isSelfReferentialMarketplaceApiUrl,
  marketplaceSearchInputSchema,
  readMarketplace as readRemoteMarketplace,
  readMarketplaceAgent as readRemoteMarketplaceAgent,
  readMarketplaceAgentApi as readLocalMarketplaceAgentApi,
  readMarketplaceApi as readLocalMarketplaceApi,
  type MarketplaceAgentReadResponse,
  type MarketplaceSearchInput
} from "./marketplace-contract";
import { z } from "zod";

type DatabasePool = pg.Pool;

type PoolCache = {
  readonly key: string;
  readonly pool: DatabasePool;
};

function shouldReadMarketplaceLocally(): boolean {
  const configuredUrl = process.env.MARKETPLACE_API_URL?.trim();
  if (!configuredUrl) return true;
  // The documented `/api` value is a same-process browser-facing base. A
  // server component should use the local database reader instead of trying
  // to resolve a relative URL through fetch.
  if (/^\/api(?:\/|$)/u.test(configuredUrl)) return true;
  return isSelfReferentialMarketplaceApiUrl(configuredUrl);
}

type MarketplaceGlobal = typeof globalThis & {
  __bnberaMarketplacePool?: PoolCache;
};

const marketplaceGlobal = globalThis as MarketplaceGlobal;

type MarketplaceMetadataRow = {
  readonly namespace: string;
  readonly chain_id: number;
  readonly identity_registry: string;
  readonly agent_id: string;
  readonly agent_category: string;
  readonly execution_wallet: string | null;
  readonly wallet_provider: string;
  readonly version_id: string | null;
  readonly public_metadata: unknown;
  readonly pricing_manifest: unknown;
  readonly category_prediction: string | null;
  readonly category_evidence: unknown | null;
  readonly authority_wallet_provider: string | null;
  readonly authority_execution_wallet: string | null;
  readonly authority_expires_at: Date | null;
  readonly authority_spend_limits: unknown;
  readonly authority_calls_allowlist: unknown;
  readonly enrichment_observations: unknown;
};

/**
 * The marketplace metadata projection is versioned separately from the
 * identity/service ingestion ports. The projection query deliberately reads
 * only public metadata and the latest category/authority observations; it
 * never returns secret references, raw payloads, or credentials.
 */
export class PostgresMarketplaceMetadataSource {
  public constructor(private readonly pool: DatabasePool) {}

  public async listMetadata(): Promise<readonly MarketplaceListingMetadata[]> {
    const result = await this.pool.query<MarketplaceMetadataRow>(`
      SELECT
        i.namespace,
        i.chain_id,
        i.identity_registry,
        i.agent_id,
        a.category AS agent_category,
        a.execution_wallet,
        a.wallet_provider,
        v.id AS version_id,
        v.public_metadata,
        v.pricing_manifest,
        cp.predicted_category AS category_prediction,
        cp.evidence AS category_evidence,
        au.wallet_provider AS authority_wallet_provider,
        au.execution_wallet AS authority_execution_wallet,
        au.expires_at AS authority_expires_at,
        au.spend_limits AS authority_spend_limits,
        au.calls_allowlist AS authority_calls_allowlist,
        COALESCE(enrichment.observations, '[]'::json) AS enrichment_observations
      FROM agents a
      JOIN erc8004_identities i ON i.id = a.identity_id
      LEFT JOIN LATERAL (
        SELECT av.id, av.public_metadata, av.pricing_manifest
        FROM agent_versions av
        WHERE av.agent_id = a.id
          AND (a.current_version_id IS NULL OR av.id = a.current_version_id)
        ORDER BY av.version DESC, av."createdAt" DESC, av.id DESC
        LIMIT 1
      ) v ON TRUE
      LEFT JOIN LATERAL (
        SELECT predicted_category, evidence
        FROM agent_category_predictions
        WHERE agent_version_id = v.id
          AND review_state = 'auto'
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 1
      ) cp ON TRUE
      LEFT JOIN LATERAL (
        SELECT wallet_provider, execution_wallet, expires_at, spend_limits, calls_allowlist
        FROM agent_authorities
        WHERE agent_id = a.id
        ORDER BY "updatedAt" DESC, id DESC
        LIMIT 1
      ) au ON TRUE
      LEFT JOIN LATERAL (
        SELECT json_agg(observation ORDER BY observation.source_timestamp DESC NULLS LAST, observation.created_at DESC) AS observations
        FROM (
          SELECT
            eo.provider,
            eo.observation_type,
            eo.normalized_payload,
            eo.source_timestamp,
            eo.source_block,
            eo.freshness,
            eo.validation_state,
            eo."createdAt" AS created_at
          FROM agent_enrichment_observations eo
          WHERE eo.agent_version_id = v.id
          ORDER BY eo.source_timestamp DESC NULLS LAST, eo."createdAt" DESC
          LIMIT 32
        ) observation
      ) enrichment ON TRUE
      ORDER BY i.namespace, i.chain_id, i.identity_registry, i.agent_id
    `);

    const metadata: MarketplaceListingMetadata[] = [];
    const slugs = new Set<string>();
    for (const row of result.rows) {
      // A malformed version is withheld by the ingestion source and surfaced
      // as a degraded read, rather than taking down unrelated records.
      const mapped = metadataFromRow(row);
      if (mapped === null) continue;
      const uniqueSlug = slugs.has(mapped.slug)
        ? collisionSafeSlug(mapped.slug, mapped.identityKey)
        : mapped.slug;
      const uniqueMetadata = uniqueSlug === mapped.slug
        ? mapped
        : marketplaceListingMetadataSchema.parse({ ...mapped, slug: uniqueSlug });
      slugs.add(uniqueMetadata.slug);
      metadata.push(uniqueMetadata);
    }
    return metadata;
  }
}

function metadataFromRow(row: MarketplaceMetadataRow): MarketplaceListingMetadata | null {
  if (row.version_id === null) return null;
  const identity = erc8004IdentitySchema.safeParse({
    namespace: row.namespace,
    chainId: row.chain_id,
    identityRegistry: row.identity_registry,
    agentId: row.agent_id
  });
  if (!identity.success) return null;

  const publicMetadata = asRecord(row.public_metadata);
  const name = boundedString(publicMetadata?.name, 160);
  const description = boundedString(publicMetadata?.description, 2_000);
  if (name === null || description === null) return null;

  const normalizedIdentity = identity.data;
  const identityKey = erc8004IdentityKey(normalizedIdentity);
  const explicitSlug = boundedString(publicMetadata?.slug, 160);
  const slug = normalizeSlug(explicitSlug ?? name, identityKey);
  const category = resolveCategory(row, publicMetadata);
  const applicableCategories = resolveApplicableCategories(row.category_evidence, category);
  const supportedProtocols = resolveProtocols(publicMetadata);
  const pricing = resolvePricing(
    publicMetadata?.pricing ?? row.pricing_manifest,
    normalizedIdentity.chainId
  );
  const dataFreshness = resolveFreshness(publicMetadata);
  const authority = resolveAuthority(row, publicMetadata);
  const executionEvidence = resolveExecutionEvidence(publicMetadata);
  const activationOffer = resolveActivationOffer(publicMetadata);
  const metrics = normalizePersistedMarketplaceMetrics(row.enrichment_observations);

  try {
    return marketplaceListingMetadataSchema.parse({
      identityKey,
      slug,
      name,
      description,
      category,
      ...(applicableCategories.length === 0 ? {} : { applicableCategories }),
      supportedProtocols,
      pricing,
      dataFreshness,
      authority,
      executionEvidence,
      activationOffer,
      metrics,
      fixture: null
    });
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function normalizeSlug(value: string, identityKey: string): string {
  const candidate = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160)
    .replace(/-+$/u, "");
  if (candidate.length > 0) return candidate;
  const fallback = identityKey.replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/gu, "");
  return (fallback || "agent").slice(0, 160).replace(/-+$/u, "") || "agent";
}

function collisionSafeSlug(slug: string, identityKey: string): string {
  const suffix = createHash("sha256").update(identityKey).digest("hex").slice(0, 10);
  const prefix = slug.slice(0, 160 - suffix.length - 1).replace(/-+$/u, "");
  return `${prefix || "agent"}-${suffix}`;
}

function resolveCategory(row: MarketplaceMetadataRow, metadata: Record<string, unknown> | null) {
  const candidates = [row.category_prediction, row.agent_category];
  if (row.agent_category === "uncategorized") candidates.push(asString(metadata?.category));
  for (const candidate of candidates) {
    const parsed = agentCategorySchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return "uncategorized" as const;
}

function resolveApplicableCategories(value: unknown, primary: AgentCategory): AgentCategory[] {
  const evidence = asRecord(value);
  const raw = evidence?.applicableCategories;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<AgentCategory>();
  const categories: AgentCategory[] = [];
  for (const candidate of raw) {
    const parsed = agentCategorySchema.safeParse(candidate);
    if (!parsed.success || parsed.data === "uncategorized" || parsed.data === primary || seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    categories.push(parsed.data);
    if (categories.length >= 4) break;
  }
  return categories;
}

function resolveProtocols(metadata: Record<string, unknown> | null): string[] {
  const values = [
    ...(asStringArray(metadata?.supportedProtocols) ?? []),
    ...(asStringArray(metadata?.protocols) ?? [])
  ];
  const services = Array.isArray(metadata?.services) ? metadata.services : [];
  for (const service of services) {
    const record = asRecord(service);
    const protocol = asString(record?.protocol ?? record?.kind ?? record?.name);
    if (protocol !== null) values.push(protocol);
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].slice(0, 64);
}

function resolvePricing(value: unknown, chainId: number) {
  const pricing = asRecord(value);
  const model = asString(pricing?.model);
  const allowedModel = model === "free" || model === "fixed" || model === "range" || model === "quote" || model === "unavailable"
    ? model
    : "unavailable";
  const tokenAddress = evmAddressSchema.safeParse(pricing?.tokenAddress).success
    ? String(pricing?.tokenAddress)
    : null;
  const decimals = boundedNumber(pricing?.decimals, 0, 255) ?? 18;
  const observedAt = isoDateOrNull(pricing?.observedAt);
  const minAtomic = allowedModel === "free" || allowedModel === "unavailable"
    ? null
    : atomicOrNull(pricing?.minAtomic ?? pricing?.amountAtomic);
  const maxAtomic = allowedModel === "free" || allowedModel === "unavailable"
    ? null
    : atomicOrNull(pricing?.maxAtomic ?? pricing?.amountAtomic);
  return marketplacePricingSchema.parse({
    model: allowedModel,
    network: chainId,
    tokenAddress,
    tokenSymbol: boundedString(pricing?.tokenSymbol, 32),
    decimals,
    minAtomic,
    maxAtomic,
    observedAt
  });
}

function resolveFreshness(metadata: Record<string, unknown> | null) {
  const freshness = asRecord(metadata?.dataFreshness ?? metadata?.freshness);
  const observedAt = isoDateOrNull(freshness?.observedAt);
  const status = freshness?.status === "fresh" || freshness?.status === "stale" || freshness?.status === "unknown"
    ? freshness.status
    : "unknown";
  return marketplaceFreshnessSchema.parse({
    status: status === "fresh" && observedAt === null ? "unknown" : status,
    observedAt,
    source: boundedString(freshness?.source, 160),
    maxAgeSeconds: boundedNumber(freshness?.maxAgeSeconds, 1, 31_536_000)
  });
}

function resolveAuthority(row: MarketplaceMetadataRow, metadata: Record<string, unknown> | null) {
  const fromMetadata = asRecord(metadata?.authority);
  const providerCandidate = asString(fromMetadata?.walletProvider) ?? row.authority_wallet_provider ?? row.wallet_provider;
  const walletProvider = providerCandidate === "altana" || providerCandidate === "external" || providerCandidate === "unknown"
    ? providerCandidate
    : "unknown";
  const executionWallet = firstAddress(
    fromMetadata?.executionWallet,
    row.authority_execution_wallet,
    row.execution_wallet
  );
  const expiresAt = isoDateOrNull(fromMetadata?.expiresAt) ?? dateToIso(row.authority_expires_at);
  const limits = asRecord(fromMetadata?.spendLimits) ?? asRecord(row.authority_spend_limits);
  const spendLimitAtomic = atomicOrNull(fromMetadata?.spendLimitAtomic ?? limits?.native ?? limits?.amountAtomic);
  const spendAsset = firstAddress(fromMetadata?.spendAsset, limits?.asset);
  const allowlist = asRecord(fromMetadata?.allowlist) ?? asRecord(row.authority_calls_allowlist);
  const allowlistedContracts = addressArray(fromMetadata?.allowlistedContracts ?? allowlist?.contracts);
  const allowlistedSelectors = selectorArray(fromMetadata?.allowlistedSelectors ?? allowlist?.selectors);
  return marketplaceAuthoritySchema.parse({
    walletProvider,
    executionWallet,
    expiresAt,
    spendLimitAtomic,
    spendAsset,
    allowlistedContracts,
    allowlistedSelectors,
    observedAt: isoDateOrNull(fromMetadata?.observedAt)
  });
}

function resolveExecutionEvidence(metadata: Record<string, unknown> | null) {
  const evidence = asRecord(metadata?.executionEvidence ?? metadata?.evidence);
  const status = evidence?.status === "verified" || evidence?.status === "unavailable" || evidence?.status === "unknown"
    ? evidence.status
    : "unknown";
  const lastVerifiedAt = isoDateOrNull(evidence?.lastVerifiedAt);
  return marketplaceExecutionEvidenceSchema.parse({
    status: status === "verified" && lastVerifiedAt === null ? "unknown" : status,
    lastVerifiedAt,
    reference: boundedString(evidence?.reference, 500)
  });
}

function resolveActivationOffer(metadata: Record<string, unknown> | null) {
  const activation = asRecord(metadata?.activationOffer ?? metadata?.activation);
  const advertised = activation?.advertised === true;
  const rawMethod = asString(activation?.method);
  const method = rawMethod === "erc8183" || rawMethod === "x402_b402" || rawMethod === "manual" || rawMethod === "none"
    ? rawMethod
    : "none";
  return marketplaceActivationOfferSchema.parse({
    advertised: advertised && method !== "none",
    method: advertised && method !== "none" ? method : "none",
    label: boundedString(activation?.label, 200) ?? "Activation unavailable"
  });
}

type EnrichmentObservation = {
  readonly provider: string;
  readonly observation_type: string;
  readonly normalized_payload: unknown;
  readonly source_timestamp: unknown;
  readonly freshness: string;
  readonly validation_state: string;
};

function unknownMetrics() {
  return marketplaceMetricsSchema.parse({
    uptime: {
      status: "unknown",
      windowSeconds: null,
      monitoringWindowSeconds: null,
      coverageSeconds: null,
      coverageRatio: null,
      observedFrom: null,
      observedTo: null,
      attemptedChecks: 0,
      successfulChecks: 0,
      successRatio: null,
      source: null
    },
    reviews: { status: "unavailable", count: null, averageScore: null, source: null, observedAt: null },
    completedJobs: { status: "unavailable", completedCount: null, source: null, observedAt: null },
    lastResult: { status: "unavailable", summary: null, reference: null, source: null, observedAt: null },
    currentData: {
      status: "unavailable",
      summary: "No current data observation is available.",
      observedAt: null,
      source: null,
      items: []
    }
  });
}

function enrichmentRows(value: unknown): EnrichmentObservation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = asRecord(entry);
    const provider = boundedString(row?.provider, 128);
    const observationType = boundedString(row?.observation_type ?? row?.observationType, 128);
    const freshness = boundedString(row?.freshness, 64);
    const validationState = boundedString(row?.validation_state ?? row?.validationState, 64);
    if (provider === null || observationType === null || freshness === null || validationState === null) return [];
    return [{
      provider,
      observation_type: observationType,
      normalized_payload: row?.normalized_payload ?? row?.normalizedPayload,
      source_timestamp: row?.source_timestamp ?? row?.sourceTimestamp,
      freshness,
      validation_state: validationState
    }];
  });
}

function usableEnrichment(row: EnrichmentObservation): boolean {
  const validationState = row.validation_state.toLowerCase();
  const freshness = row.freshness.toLowerCase();
  const provider = row.provider.toLowerCase();
  const observedAt = isoDateOrNull(row.source_timestamp);
  const validStates = new Set(["valid", "verified", "accepted", "resolved", "complete"]);
  const freshStates = new Set(["fresh", "current"]);
  return provider !== "unknown" && provider !== "self" && provider !== "self-reported" &&
    validStates.has(validationState) && freshStates.has(freshness) && observedAt !== null;
}

function metricPayload(row: EnrichmentObservation): Record<string, unknown> | null {
  return asRecord(row.normalized_payload);
}

function metricNumber(value: unknown, minimum: number, maximum: number): number | null {
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum ? candidate : null;
}

function metricCount(value: unknown): number | null {
  const candidate = metricNumber(value, 0, Number.MAX_SAFE_INTEGER);
  return candidate !== null && Number.isSafeInteger(candidate) ? candidate : null;
}

function metricObservedAt(row: EnrichmentObservation): string | null {
  return isoDateOrNull(row.source_timestamp);
}

function metricSource(row: EnrichmentObservation): string {
  return row.provider;
}

/**
 * Only persisted enrichment with a recognized validation/freshness state and
 * source timestamp can become a public metric. Registration metadata is
 * intentionally excluded: an agent cannot make its own review claim real by
 * placing a count in its card or public JSON.
 */
export function normalizePersistedMarketplaceMetrics(enrichmentValue: unknown) {
  const defaults = unknownMetrics();
  const rows = enrichmentRows(enrichmentValue).filter(usableEnrichment);
  let reviews = defaults.reviews;
  let completedJobs = defaults.completedJobs;
  let lastResult = defaults.lastResult;
  let currentData = defaults.currentData;

  for (const row of rows) {
    const type = row.observation_type.toLowerCase();
    const payload = metricPayload(row);
    if (payload === null) continue;
    if (reviews.status === "unavailable" && (type.includes("review") || type.includes("reputation") || type.includes("feedback"))) {
      const reviewList = Array.isArray(payload.reviews) ? payload.reviews : null;
      const count = metricCount(payload.reviewCount ?? payload.totalReviews ?? payload.count) ?? (reviewList === null ? null : reviewList.length);
      const averageScore = metricNumber(payload.averageScore ?? payload.averageRating ?? payload.rating, 0, 100);
      if (count !== null || averageScore !== null) {
        reviews = marketplaceMetricsSchema.shape.reviews.parse({
          status: "available",
          count,
          averageScore,
          source: metricSource(row),
          observedAt: metricObservedAt(row)
        });
      }
    }
    if (completedJobs.status === "unavailable" && (type.includes("job") || type.includes("task") || type.includes("execution"))) {
      const completedCount = metricCount(payload.completedJobs ?? payload.completedJobCount ?? payload.completedTasks);
      if (completedCount !== null) {
        completedJobs = marketplaceMetricsSchema.shape.completedJobs.parse({
          status: "available",
          completedCount,
          source: metricSource(row),
          observedAt: metricObservedAt(row)
        });
      }
    }
    if (lastResult.status === "unavailable" && (type.includes("result") || type.includes("job") || type.includes("execution"))) {
      const result = asRecord(payload.lastResult ?? payload.result);
      const summary = boundedString(result?.summary ?? result?.description, 500);
      const reference = boundedString(result?.reference ?? result?.id ?? result?.url, 500);
      if (summary !== null || reference !== null) {
        lastResult = marketplaceMetricsSchema.shape.lastResult.parse({
          status: "available",
          summary,
          reference,
          source: metricSource(row),
          observedAt: metricObservedAt(row)
        });
      }
    }
    if (currentData.status === "unavailable" && (type.includes("market") || type.includes("data") || type.includes("state"))) {
      const data = asRecord(payload.currentData ?? payload.data);
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const items = rawItems.flatMap((item) => {
        const value = asRecord(item);
        const label = boundedString(value?.label, 120);
        const display = boundedString(value?.value, 240);
        const source = boundedString(value?.source, 160) ?? metricSource(row);
        return label !== null && display !== null ? [{ label, value: display, source }] : [];
      }).slice(0, 12);
      if (items.length > 0) {
        const rawStatus = asString(data?.status);
        currentData = marketplaceMetricsSchema.shape.currentData.parse({
          status: rawStatus === "stale" ? "stale" : "available",
          summary: boundedString(data?.summary, 500) ?? "Current data observed from an enrichment source.",
          observedAt: metricObservedAt(row),
          source: metricSource(row),
          items
        });
      }
    }
  }
  return marketplaceMetricsSchema.parse({
    ...defaults,
    reviews,
    completedJobs,
    lastResult,
    currentData
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function atomicOrNull(value: unknown): string | null {
  const candidate = typeof value === "bigint" ? value.toString(10) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value.toString(10) : asString(value);
  return candidate !== null && /^(0|[1-9][0-9]*)$/u.test(candidate) ? candidate : null;
}

function firstAddress(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = evmAddressSchema.safeParse(value);
    if (parsed.success) return parsed.data.toLowerCase();
  }
  return null;
}

function addressArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => firstAddress(item)).filter((item): item is string => item !== null))].slice(0, 128);
}

function selectorArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && /^0x[0-9a-fA-F]{8}$/u.test(item)))].slice(0, 256);
}

function isoDateOrNull(value: unknown): string | null {
  if (value instanceof Date) return dateToIso(value);
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function dateToIso(value: Date | null): string | null {
  return value instanceof Date && Number.isFinite(value.valueOf()) ? value.toISOString() : null;
}

function coreSearchInput(input: MarketplaceSearchInput): MarketplaceSearchRequest {
  return marketplaceSearchRequestSchema.parse({
    query: input.query ?? "",
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    ...(input.protocol === undefined ? {} : { requiredProtocols: [input.protocol] }),
    ...(input.freshness === "fresh" ? { requireFreshData: true } : {})
  });
}

function errorFromUnknown(error: unknown, code: string, message: string, nextAction: string, retriable = true): AppError {
  return error instanceof AppError
    ? error
    : new AppError({ code, safeMessage: message, requestId: "req_web_marketplace_server", nextAction, retriable, cause: error });
}

function metadataQueryError(error: unknown): AppError {
  return errorFromUnknown(
    error,
    "MARKETPLACE_SOURCE_UNAVAILABLE",
    "The PostgreSQL marketplace read model is temporarily unavailable.",
    "retry_read"
  );
}

function configurationError(error: unknown): AppError {
  return errorFromUnknown(
    error,
    "MARKETPLACE_CONFIGURATION_INVALID",
    "The live marketplace read model requires a configured PostgreSQL database.",
    "check_configuration",
    false
  );
}

function connectionKey(connectionString: string, ssl: boolean): string {
  // Do not retain the credential-bearing URL as a cache key or emit it in
  // diagnostics. The pool itself still receives the URL through pg.
  const digest = createHash("sha256").update(connectionString).digest("hex");
  return `${ssl ? "ssl" : "plain"}:${digest}`;
}

function getPool(connectionString: string, ssl: boolean): DatabasePool {
  const key = connectionKey(connectionString, ssl);
  const existing = marketplaceGlobal.__bnberaMarketplacePool;
  if (existing?.key === key) return existing.pool;
  if (existing !== undefined) void existing.pool.end();
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: true } : undefined
  });
  marketplaceGlobal.__bnberaMarketplacePool = { key, pool };
  return pool;
}

async function readSemanticEmbeddingStandardsLock(): Promise<unknown> {
  const content = await readFile(new URL("../../../../config/standards.lock.json", import.meta.url), "utf8");
  return JSON.parse(content) as unknown;
}

/** Test/process shutdown hook; production route handlers keep the pool cached. */
export async function closeMarketplaceDatabaseForTests(): Promise<void> {
  const current = marketplaceGlobal.__bnberaMarketplacePool;
  delete marketplaceGlobal.__bnberaMarketplacePool;
  if (current !== undefined) await current.pool.end();
}

function versionIdForIdentityKey(pool: DatabasePool) {
  return async (identityKey: string): Promise<string | null> => {
    const parts = identityKey.split(":");
    if (parts.length !== 4) return null;
    const identity = erc8004IdentitySchema.safeParse({
      namespace: parts[0],
      chainId: Number(parts[1]),
      identityRegistry: parts[2],
      agentId: parts[3]
    });
    if (!identity.success) return null;
    const result = await pool.query<{ id: string }>(`
      SELECT current_version.id
      FROM agents a
      JOIN erc8004_identities i ON i.id = a.identity_id
      LEFT JOIN LATERAL (
        SELECT av.id
        FROM agent_versions av
        WHERE av.agent_id = a.id
          AND (a.current_version_id IS NULL OR av.id = a.current_version_id)
        ORDER BY av.version DESC, av."createdAt" DESC, av.id DESC
        LIMIT 1
      ) current_version ON TRUE
      WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4
      LIMIT 1
    `, [identity.data.namespace, identity.data.chainId, identity.data.identityRegistry, identity.data.agentId]);
    return result.rows[0]?.id ?? null;
  };
}

function identityKeyForVersionId(pool: DatabasePool) {
  return async (agentVersionId: string): Promise<string | null> => {
    const result = await pool.query<{
      namespace: string;
      chain_id: number;
      identity_registry: string;
      agent_id: string;
    }>(`
      SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id
      FROM agent_versions av
      JOIN agents a ON a.id = av.agent_id
      JOIN erc8004_identities i ON i.id = a.identity_id
      WHERE av.id = $1
      LIMIT 1
    `, [agentVersionId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    const identity: Erc8004Identity = {
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    };
    return erc8004IdentityKey(identity);
  };
}

async function createLiveReadService(): Promise<MarketplaceReadService> {
  let runtime;
  try {
    runtime = loadRuntimeConfig(process.env);
  } catch (error) {
    throw configurationError(error);
  }
  if (runtime.databaseUrl === undefined || runtime.databaseUrl.trim() === "") {
    throw configurationError(new Error("DATABASE_URL is not configured"));
  }
  const pool = getPool(runtime.databaseUrl, runtime.databaseSsl);
  const repository: IngestionRepository = new PostgresIngestionRepository(pool, { ssl: runtime.databaseSsl });
  const metadataSource = new PostgresMarketplaceMetadataSource(pool);
  const source = new IngestionMarketplaceSource(repository, metadataSource, {
    sourceName: "postgres-ingestion-read-model",
    ...(runtime.erc8004IngestionEnabled
      ? {}
      : {
          status: "degraded" as const,
          warning: "ERC-8004 ingestion is disabled; indexed records may be stale."
        })
  });
  let semanticRetriever: VectorMarketplaceSemanticRetriever | undefined;
  if (runtime.marketplaceSemanticRetrievalEnabled && runtime.embedding !== null) {
    try {
      validateSemanticEmbeddingLock(await readSemanticEmbeddingStandardsLock(), runtime);
    } catch (error) {
      throw configurationError(error);
    }
    const provider = createEmbeddingProviderFromRuntimeConfig(
      runtime,
      (reference) => process.env[reference]
    );
    semanticRetriever = new VectorMarketplaceSemanticRetriever(
      provider,
      new PgVectorSemanticRepository(pool, { storageDimension: runtime.embedding.dimension }),
      {
        versionIdForIdentityKey: versionIdForIdentityKey(pool),
        identityKeyForVersionId: identityKeyForVersionId(pool),
        modelVersion: runtime.embedding.modelVersion,
        semanticDocumentSchemaVersion,
        limit: 20
      }
    );
  }
  const service = new MarketplaceReadService(source, {
    semanticRetrievalEnabled: runtime.marketplaceSemanticRetrievalEnabled,
    ...(semanticRetriever === undefined ? {} : { semanticRetriever })
  });
  // The process-wide pool is intentionally retained for reuse. Tests can use
  // closeMarketplaceDatabaseForTests when they own the process lifecycle.
  return service;
}

function emptyDetailResponse(
  mode: "live" | "degraded" | "empty",
  notice: string,
  meta: MarketplaceAgentReadResponse["meta"] = null
): MarketplaceAgentReadResponse {
  return {
    contractVersion: marketplaceReadContractVersion,
    status: mode === "degraded" ? "degraded" : "empty",
    mode,
    dataLabel: mode === "empty" ? "Read model empty" : mode === "degraded" ? "Degraded preview" : "Connected read model",
    notice,
    meta,
    agent: null,
    error: null
  };
}

/**
 * Server-component read seam. In a same-process preview, pages read the
 * PostgreSQL projection directly. A separately hosted read API can still be
 * selected with an explicit non-loopback `MARKETPLACE_API_URL`.
 */
export async function readMarketplaceForPage(input: Partial<MarketplaceSearchInput> = {}) {
  if (configuredMarketplaceDataMode() === "live" && shouldReadMarketplaceLocally()) {
    return readMarketplaceApi(input);
  }
  return readRemoteMarketplace(input);
}

export async function readMarketplaceAgentForPage(
  slug: string,
  input: Partial<Pick<MarketplaceSearchInput, "preview">> = {}
) {
  if (configuredMarketplaceDataMode() === "live" && shouldReadMarketplaceLocally()) {
    return readMarketplaceAgentApi(slug, input);
  }
  return readRemoteMarketplaceAgent(slug, input);
}

export async function readMarketplaceApi(input: Partial<MarketplaceSearchInput> = {}) {
  const parsedInput = marketplaceSearchInputSchema.parse(input);
  const mode = configuredMarketplaceDataMode();
  if (mode !== "live") return readLocalMarketplaceApi(parsedInput);
  try {
    const service = await createLiveReadService();
    const result = await service.safeSearch(coreSearchInput(parsedInput));
    if (!result.ok) {
      return marketplaceSearchErrorResponse(parsedInput, result.error, "The PostgreSQL marketplace source could not be read safely.");
    }
    return mapMarketplaceSearchResponse(parsedInput, result.value as CoreMarketplaceSearchResponse, "live");
  } catch (error) {
    const appError = errorFromUnknown(
      error,
      "MARKETPLACE_SOURCE_UNAVAILABLE",
      "The PostgreSQL marketplace read model is temporarily unavailable.",
      "retry_read"
    );
    return marketplaceSearchErrorResponse(parsedInput, appError.toEnvelope(), "The PostgreSQL marketplace source could not be read safely.");
  }
}

export async function readMarketplaceAgentApi(
  slug: string,
  input: Partial<Pick<MarketplaceSearchInput, "preview">> = {}
): Promise<MarketplaceAgentReadResponse> {
  const normalizedSlug = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).parse(slug);
  const mode = configuredMarketplaceDataMode();
  if (mode !== "live") return readLocalMarketplaceAgentApi(slug, input);
  try {
    const service = await createLiveReadService();
    const result = await service.readAgent(normalizedSlug);
    const effectiveMode = result.meta.sourceStatus === "degraded"
      || (result.meta.sourceStatus === "empty" && result.meta.warning !== null)
      ? "degraded"
      : result.meta.sourceStatus === "empty"
        ? "empty"
        : "live";
    const mappedMeta = {
      sourceStatus: result.meta.sourceStatus,
      sourceName: result.meta.sourceName,
      sourceKind: result.meta.sourceKind,
      warning: result.meta.warning,
      refreshedAt: result.meta.refreshedAt,
      fixtureCount: result.meta.fixtureCount,
      retrievalMode: result.meta.retrievalMode,
      semanticModelVersion: result.meta.semanticModelVersion
    };
    if (result.agent === null) {
      return emptyDetailResponse(
        effectiveMode,
        effectiveMode === "degraded"
          ? result.meta.warning ?? "The PostgreSQL marketplace read model is degraded."
          : "This agent is not present in the PostgreSQL marketplace read model.",
        mappedMeta
      );
    }
    return {
      contractVersion: marketplaceReadContractVersion,
      status: effectiveMode === "degraded" ? "degraded" : "ready",
      mode: effectiveMode,
      dataLabel: effectiveMode === "degraded" ? "Degraded preview" : "Connected read model",
      notice: effectiveMode === "degraded"
        ? result.meta.warning ?? "The PostgreSQL marketplace read model is degraded."
        : "The connected PostgreSQL marketplace read model returned this agent.",
      meta: mappedMeta,
      agent: mapMarketplaceDetailResponse(
        result.agent.agent,
        effectiveMode === "empty" ? "live" : effectiveMode,
        result.meta.refreshedAt
      ),
      error: null
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : metadataQueryError(error);
    return marketplaceDetailErrorResponse(appError.toEnvelope(), "The PostgreSQL marketplace detail could not be read safely.");
  }
}
