/**
 * Server-only marketplace read wiring.
 *
 * This module is imported by route handlers and server components only. Keep
 * it out of the shared web contract: pg and the ingestion repository must
 * never be reachable from a client component or browser bundle.
 */
import { AppError, loadRuntimeConfig, validateSemanticEmbeddingLock, mainnetBrowserCommerceEnabled } from "@bnbera/config";
import { mainnetSellerProfile } from "./mainnet-seller-catalog";
import { formatUnits } from "viem";
import { createHash } from "node:crypto";
import { readCheckedInStandardsLock } from "./checked-in-lock";
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
  classifyAgent,
  type IngestionRepository
} from "@bnbera/agent-ingestion";
import {
  agentCategorySchema,
  canonicalSha256Hex,
  erc8004IdentityKey,
  erc8004IdentitySchema,
  evmAddressSchema,
  type AgentCategory,
  type Erc8004Identity
} from "@bnbera/domain";
import { PostgresErc8183MarketplaceProjection, readReferenceCapacity } from "@bnbera/agent-commerce";
import {
  marketplaceActivationOfferSchema,
  marketplaceErc8183ActivationBindingSchema,
  marketplaceAuthoritySchema,
  marketplaceExecutionEvidenceSchema,
  marketplaceFreshnessSchema,
  marketplacePricingSchema,
  marketplaceSearchRequestSchema,
  marketplaceListingMetadataSchema,
  marketplaceMetricsSchema,
  projectEvidenceProjection,
  unavailableMarketplaceEvidence,
  type MarketplaceEvidenceGraphInput,
  type MarketplaceEvidenceProjection,
  type MarketplaceListingMetadata,
  type MarketplaceSearchRequest
} from "@bnbera/marketplace";
import { directoryObservationType, directorySnapshotSchema, directorySlug, publicHttpsUrl, serviceVerificationObservationType, serviceVerificationSchema, serviceVerificationState } from "@bnbera/agent-ingestion/directory";
import {
  configuredMarketplaceDataMode,
  mapMarketplaceDetailResponse,
  mapMarketplaceSearchResponse,
  marketplaceDetailErrorResponse,
  marketplaceSearchErrorResponse,
  marketplaceReadContractVersion,
  isSelfReferentialMarketplaceApiUrl,
  marketplaceSearchInputSchema,
  marketplaceAgentReadModelSchema,
  marketplaceSearchResponseSchema as webSearchResponseSchema,
  selectionMatches,
  sortAgents,
  querySelection,
  readMarketplace as readRemoteMarketplace,
  readMarketplaceAgent as readRemoteMarketplaceAgent,
  readMarketplaceAgentApi as readLocalMarketplaceAgentApi,
  readMarketplaceApi as readLocalMarketplaceApi,
  type MarketplaceAgentReadResponse,
  type MarketplaceAgentReadModel,
  type MarketplaceSearchInput
} from "./marketplace-contract";
import { z } from "zod";

type DatabasePool = pg.Pool;

const optionalEvidenceQueryTimeoutMs = 750;

async function boundedEvidenceQuery<T extends pg.QueryResultRow>(pool: DatabasePool, text: string, values: readonly unknown[]): Promise<pg.QueryResult<T>> {
  // pg's installed type definitions predate query_timeout even though the
  // client accepts it. Keep the runtime timeout explicit and bound the await
  // as well, so an optional evidence outage cannot hold the listing read.
  const queryConfig = {
    text,
    values: [...values],
    query_timeout: optionalEvidenceQueryTimeoutMs
  } as unknown as pg.QueryConfig;
  const query = pool.query<T>(queryConfig);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Optional evidence query timed out")), optionalEvidenceQueryTimeoutMs);
  });
  try {
    return await Promise.race([query, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

type MarketplaceEvidenceRow = {
  readonly artifact_type: string;
  readonly artifact_id: string | null;
  readonly commerce_job_id: string | null;
  readonly version: number | string | null;
  readonly object_state: string | null;
  readonly object_sha256_digest: string | null;
  readonly object_keccak256_digest: string | null;
  readonly object_size_bytes: number | string | null;
  readonly object_seal_transaction_hash: string | null;
  readonly object_readback_verified_at: Date | string | null;
  readonly locator_provider: string | null;
  readonly locator_uri: string | null;
  readonly locator_bucket: string | null;
  readonly locator_object_name: string | null;
  readonly locator_provider_reference: string | null;
  readonly locator_version: number | string | null;
  readonly locator_sha256_digest: string | null;
  readonly locator_keccak256_digest: string | null;
  readonly locator_size_bytes: number | string | null;
  readonly locator_immutable: boolean | null;
  readonly locator_verified_at: Date | string | null;
  readonly locator_publication_attempt_id: string | null;
  readonly verification_status: string | null;
  readonly seal_confirmed: boolean | null;
  readonly readback_status: string | null;
  readonly expected_sha256_digest: string | null;
  readonly observed_sha256_digest: string | null;
  readonly expected_keccak256_digest: string | null;
  readonly observed_keccak256_digest: string | null;
  readonly expected_size_bytes: number | string | null;
  readonly observed_size_bytes: number | string | null;
  readonly hashes_match: boolean | null;
  readonly size_matches: boolean | null;
  readonly reason_code: string | null;
  readonly checked_at: Date | string | null;
  readonly verification_publication_attempt_id: string | null;
};

/**
 * The marketplace metadata projection is versioned separately from the
 * identity/service ingestion ports. The projection query deliberately reads
 * only public metadata and the latest category/authority observations; it
 * never returns secret references, raw payloads, or credentials.
 */
export class PostgresMarketplaceMetadataSource {
  public constructor(private readonly pool: DatabasePool) {}

  private greenfieldReadUrlOrigins(): readonly string[] {
    return (process.env.GREENFIELD_READ_URL_ALLOWLIST ?? process.env.GREENFIELD_PUBLIC_READ_URL_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private async evidenceForVersion(agentId: string, currentVersion: number | null): Promise<MarketplaceEvidenceProjection> {
    const result = await boundedEvidenceQuery<MarketplaceEvidenceRow>(this.pool, `
      SELECT
        eo.object_type AS artifact_type,
        eo.artifact_id,
        result.commerce_job_id,
        eo.version,
        eo.state AS object_state,
        eo.sha256_digest AS object_sha256_digest,
        eo.keccak256_digest AS object_keccak256_digest,
        eo.size_bytes AS object_size_bytes,
        eo.seal_transaction_hash AS object_seal_transaction_hash,
        eo.readback_verified_at AS object_readback_verified_at,
        locator.provider AS locator_provider,
        locator.uri AS locator_uri,
        locator.bucket AS locator_bucket,
        locator.object_name AS locator_object_name,
        locator.provider_reference AS locator_provider_reference,
        locator.version AS locator_version,
        locator.sha256_digest AS locator_sha256_digest,
        locator.keccak256_digest AS locator_keccak256_digest,
        locator.size_bytes AS locator_size_bytes,
        locator.immutable AS locator_immutable,
        locator.verified_at AS locator_verified_at,
        locator.publication_attempt_id AS locator_publication_attempt_id,
        verification.status AS verification_status,
        verification.seal_confirmed,
        verification.readback_status,
        verification.expected_sha256_digest,
        verification.observed_sha256_digest,
        verification.expected_keccak256_digest,
        verification.observed_keccak256_digest,
        verification.expected_size_bytes,
        verification.observed_size_bytes,
        verification.hashes_match,
        verification.size_matches,
        verification.reason_code,
        verification.checked_at,
        verification.publication_attempt_id AS verification_publication_attempt_id
      FROM evidence_objects eo
      LEFT JOIN LATERAL (
        SELECT l.provider, l.uri, l.bucket, l.object_name, l.provider_reference,
          l.version, l.sha256_digest, l.keccak256_digest, l.size_bytes,
          l.immutable, l.verified_at, l.publication_attempt_id
        FROM evidence_locators l
        WHERE l.evidence_object_id = eo.id
        ORDER BY l.verified_at DESC NULLS LAST, l."createdAt" DESC, l.id DESC
        LIMIT 1
      ) locator ON TRUE
      LEFT JOIN LATERAL (
        SELECT v.status, v.seal_confirmed, v.readback_status,
          v.expected_sha256_digest, v.observed_sha256_digest,
          v.expected_keccak256_digest, v.observed_keccak256_digest,
          v.expected_size_bytes, v.observed_size_bytes, v.hashes_match,
          v.size_matches, v.reason_code, v.checked_at, v.publication_attempt_id
        FROM evidence_verification_results v
        WHERE v.evidence_object_id = eo.id
        ORDER BY v.checked_at DESC, v."createdAt" DESC, v.id DESC
        LIMIT 1
      ) verification ON TRUE
      LEFT JOIN agent_runs run
        ON run.id = eo.run_id
       AND run.agent_id = eo.agent_id
      LEFT JOIN commerce_job_results result
        ON result.commerce_job_id = run.job_id
       AND result.state = 'settled'
      LEFT JOIN agent_versions result_version
        ON result_version.id = result.agent_version_id
       AND result_version.agent_id = run.agent_id
       AND result_version.version = result.agent_version
      WHERE eo.agent_id = $1
        AND (
          (
            eo.object_type = 'agent_profile'
            AND eo.run_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM agent_versions profile_version
              WHERE profile_version.id::text = eo.resource_id
                AND profile_version.agent_id = eo.agent_id
                AND profile_version.version = eo.version
            )
          )
          OR (
            eo.object_type = 'run_bundle'
            AND run.agent_id = $1
            AND run.job_id IS NOT NULL
            AND eo.resource_id = run.job_id::text
            AND result.id IS NOT NULL
            AND result.commerce_job_id = run.job_id
            AND result.agent_version_id = result_version.id
            AND result_version.agent_id = eo.agent_id
            AND result_version.version = eo.version
            AND result.agent_version = eo.version
          )
        )
      ORDER BY eo.object_type, eo.version DESC, eo."updatedAt" DESC, eo.id DESC
    `, [agentId]);
    const graphInputs: MarketplaceEvidenceGraphInput[] = result.rows.map((row) => ({
      artifactType: row.artifact_type,
      artifactId: row.artifact_id,
      jobId: row.commerce_job_id,
      version: row.version,
      objectState: row.object_state,
      objectSha256Digest: row.object_sha256_digest,
      objectKeccak256Digest: row.object_keccak256_digest,
      objectSizeBytes: row.object_size_bytes,
      objectSealTransactionHash: row.object_seal_transaction_hash,
      objectReadbackVerifiedAt: row.object_readback_verified_at,
      locator: row.locator_provider === null && row.locator_uri === null
        ? null
        : {
            provider: row.locator_provider,
            uri: row.locator_uri,
            bucket: row.locator_bucket,
            objectName: row.locator_object_name,
            providerReference: row.locator_provider_reference,
            version: row.locator_version,
            sha256Digest: row.locator_sha256_digest,
            keccak256Digest: row.locator_keccak256_digest,
            sizeBytes: row.locator_size_bytes,
            immutable: row.locator_immutable,
            verifiedAt: row.locator_verified_at,
            publicationAttemptId: row.locator_publication_attempt_id
          },
      verification: row.verification_status === null
        ? null
        : {
            status: row.verification_status,
            sealConfirmed: row.seal_confirmed,
            readbackStatus: row.readback_status,
            expectedSha256Digest: row.expected_sha256_digest,
            observedSha256Digest: row.observed_sha256_digest,
            expectedKeccak256Digest: row.expected_keccak256_digest,
            observedKeccak256Digest: row.observed_keccak256_digest,
            expectedSizeBytes: row.expected_size_bytes,
            observedSizeBytes: row.observed_size_bytes,
            hashesMatch: row.hashes_match,
            sizeMatches: row.size_matches,
            reasonCode: row.reason_code,
            checkedAt: row.checked_at,
            publicationAttemptId: row.verification_publication_attempt_id
          }
    }));
    const readUrlBase = process.env.GREENFIELD_READ_URL_BASE ?? process.env.GREENFIELD_PUBLIC_READ_URL_BASE;
    return projectEvidenceProjection(graphInputs, {
      allowedReadUrlOrigins: this.greenfieldReadUrlOrigins(),
      ...(readUrlBase === undefined ? {} : { readUrlBase }),
      currentVersion
    });
  }

  /**
   * Evidence is read only for an opened detail record. Keep the complete
   * ERC-8004 identity tuple in this lookup so a reused slug or agent id cannot
   * attach a publication from another namespace/registry/chain.
   */
  public async readEvidenceForIdentity(identity: Erc8004Identity): Promise<MarketplaceEvidenceProjection> {
    const current = await boundedEvidenceQuery<{
      readonly internal_agent_id: string;
      readonly version_id: string | null;
      readonly version_number: number | null;
    }>(this.pool, `
      SELECT
        a.id AS internal_agent_id,
        current_version.id AS version_id,
        current_version.version AS version_number
      FROM agents a
      JOIN erc8004_identities i ON i.id = a.identity_id
      LEFT JOIN LATERAL (
        SELECT av.id, av.version
        FROM agent_versions av
        WHERE av.agent_id = a.id
          AND (a.current_version_id IS NULL OR av.id = a.current_version_id)
        ORDER BY av.version DESC, av."createdAt" DESC, av.id DESC
        LIMIT 1
      ) current_version ON TRUE
      WHERE i.namespace = $1
        AND i.chain_id = $2
        AND i.identity_registry = $3
        AND i.agent_id = $4
      LIMIT 1
    `, [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]);
    const row = current.rows[0];
    if (row === undefined || row.version_id === null) return unavailableMarketplaceEvidence();
    return this.evidenceForVersion(row.internal_agent_id, row.version_number);
  }

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
      let uniqueMetadata = uniqueSlug === mapped.slug
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
  const binding = marketplaceErc8183ActivationBindingSchema.safeParse(activation?.erc8183);
  const parsed = marketplaceActivationOfferSchema.safeParse({
    advertised: advertised && method !== "none",
    method: advertised && method !== "none" ? method : "none",
    label: boundedString(activation?.label, 200) ?? "Activation unavailable",
    ...(binding.success ? { erc8183: binding.data } : {})
  });
  if (parsed.success) return parsed.data;
  // A malformed persisted offer must not take down the listing, and must not
  // be projected as an executable rail. Keep the ordinary unavailable shape.
  return marketplaceActivationOfferSchema.parse({
    advertised: false,
    method: "none",
    label: "Activation unavailable"
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
    reputation: {
      rawPermissionless: { status: "unknown", count: null, feedback: [], source: null, observedAt: null, reason: "No canonical ERC-8004 feedback has been observed." },
      recognizedReviewers: { status: "unavailable", count: null, feedback: [], source: null, observedAt: null, reason: "No recognized reviewer or validator allowlist is configured." },
      verifiedPurchases: { status: "unavailable", count: null, feedback: [], source: null, observedAt: null, reason: "BNBEra verified-purchase reviews are enabled by G2." }
    },
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
  const reputation = defaults.reputation;
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
    reputation,
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
  return readCheckedInStandardsLock();
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

type LiveReadContext = {
  readonly service: MarketplaceReadService;
  readonly metadataSource: PostgresMarketplaceMetadataSource;
};

let directoryCache: {key:string; expiresAt:number; promise:ReturnType<typeof loadRegisteredDirectory>} | undefined;

async function withReferenceCapacity(agent: MarketplaceAgentReadModel): Promise<MarketplaceAgentReadModel> {
  if(agent.identity.chainId!==97||agent.identity.agentId!=="2293"||agent.identity.identityRegistry.toLowerCase()!=="0x8004a818bfb912233c491871b3d84c89a494bd9e")return agent;
  const runtime=loadRuntimeConfig(process.env);
  const capacity=runtime.databaseUrl?await readReferenceCapacity(getPool(runtime.databaseUrl,runtime.databaseSsl)).catch(()=>null):null;
  const enabled=agent.activation.enabled&&capacity?.ready===true&&process.env.T5_REFERENCE_PROVIDER_ADMISSION_ENABLED==="true";
  const reason=!agent.activation.enabled?"PUBLISHED_OFFER_UNAVAILABLE":capacity?.reason??"WORKER_UNAVAILABLE";
  return {...agent,activation:{...agent.activation,enabled,availability:enabled?"available":"unavailable",
    title:enabled?`Hire on testnet · ${capacity.remaining} task slots left`:"Testnet reference · admission paused",
    reason:enabled?`Bounded provider online. ${capacity.remaining} of 3 lifetime task reservations remain at exactly 0.001 test U each. Reservations are not recycled. The worker computes your supplied snapshot; you explicitly approve settlement after the protocol review window.`:
      `New tasks cannot be admitted (${reason}). Existing jobs and results remain in My hires. Mainnet payments are disabled.`,
    ...(capacity?{boundedCapacity:{remaining:capacity.remaining,admitted:capacity.admitted,submitted:capacity.submitted,completed:capacity.completed,checkedAt:capacity.checkedAt,reason:capacity.reason}}:{})}};
}

async function freshReferenceCapacity(directory: Awaited<ReturnType<typeof loadRegisteredDirectory>>) {
  return {...directory,agents:await Promise.all(directory.agents.map(withReferenceCapacity))};
}

/** Coalesce concurrent page/API reads; do not run 100 commerce projections per visitor. */
async function readRegisteredDirectory() {
  const runtime=loadRuntimeConfig(process.env);
  const key=connectionKey(runtime.databaseUrl??"",runtime.databaseSsl);
  if(directoryCache?.key===key&&directoryCache.expiresAt>Date.now())return freshReferenceCapacity(await directoryCache.promise);
  const promise=loadRegisteredDirectory();
  directoryCache={key,expiresAt:Number.POSITIVE_INFINITY,promise};
  try {
    const result=await promise;
    if(directoryCache?.promise===promise)directoryCache.expiresAt=Date.now()+15_000;
    return freshReferenceCapacity(result);
  }catch(error){if(directoryCache?.promise===promise)directoryCache=undefined;throw error;}
}

/** Registered supply is a directory, independently of the execution/publication gate. */
async function loadRegisteredDirectory() {
  const runtime = loadRuntimeConfig(process.env);
  if (!runtime.databaseUrl) throw configurationError(new Error("Database not configured"));
  const pool = getPool(runtime.databaseUrl, runtime.databaseSsl);
  const releaseLock = readCheckedInStandardsLock() as { networks?: Record<string, { erc8183?: { releaseEnabled?: boolean } }> };
  const mainnetRelease = mainnetBrowserCommerceEnabled() && releaseLock.networks?.["56"]?.erc8183?.releaseEnabled === true;
  const rows = await pool.query(`SELECT * FROM (
    SELECT DISTINCT ON (i.id) i.namespace, i.chain_id, i.identity_registry, i.agent_id, i.owner_address, i.agent_wallet,
      i.observed_block, i.observed_block_hash, i.read_consistency, i."updatedAt" AS identity_observed_at,
      a.origin_type, a.claim_status, a.verification_status, a.runtime_status, a.authority_status, a.listing_status,
      (SELECT av.pricing_manifest FROM agent_versions av WHERE av.id=a.current_version_id) AS seller_pricing,
      (SELECT av.public_metadata->>'mainnetSellerReviewDigest' FROM agent_versions av WHERE av.id=a.current_version_id) AS seller_review,
      (SELECT jsonb_build_object('observedAt',p.observed_at,'status',p.validation_status,'url',p.url) FROM agent_service_probe_results p WHERE p.identity_id=i.id AND p.kind='a2a' ORDER BY p.observed_at DESC LIMIT 1) AS seller_probe,
      eo.normalized_payload, eo.payload_digest, eo.source_timestamp,eo.provider AS snapshot_provider
    FROM agent_enrichment_observations eo JOIN agent_versions v ON v.id=eo.agent_version_id
    JOIN agents a ON a.id=v.agent_id JOIN erc8004_identities i ON i.id=a.identity_id
    WHERE eo.observation_type=$1 AND eo.provider IN ('8004scan','bnbera-registry-review') AND eo.validation_state='valid'
      AND EXISTS (SELECT 1 FROM agent_discovery_sources membership WHERE membership.identity_id=i.id
        AND membership.normalized_ingestion_version='bnbera-directory-v1')
      AND i.chain_id IN (56,97) AND i.read_consistency='finalized'
      AND a.listing_status NOT IN ('delisted','suspended') AND a.verification_status <> 'rejected'
    ORDER BY i.id, eo.source_timestamp DESC, eo."createdAt" DESC
  ) directory ORDER BY chain_id, agent_id::numeric LIMIT 100`, [directoryObservationType]);
  const checks = (await pool.query(`select distinct on(i.id) i.namespace,i.chain_id,i.identity_registry,i.agent_id,eo.normalized_payload
    from agent_enrichment_observations eo join agent_versions v on v.id=eo.agent_version_id join agents a on a.id=v.agent_id join erc8004_identities i on i.id=a.identity_id
    where eo.observation_type=$1 and eo.provider='bnbera-protocol-verifier' and eo.validation_state='valid'
    order by i.id,eo.source_timestamp desc,eo."createdAt" desc`,[serviceVerificationObservationType])).rows;
  const checkMap = new Map(checks.map(row=>[`${row.namespace}:${row.chain_id}:${row.identity_registry}:${row.agent_id}`,row.normalized_payload]));
  const commerce = new PostgresErc8183MarketplaceProjection(pool);
  const agents: z.infer<typeof marketplaceAgentReadModelSchema>[] = [];
  for (let start=0;start<rows.rows.length;start+=8) {
    await Promise.all(rows.rows.slice(start,start+8).map(async row=>{
    const parsed = directorySnapshotSchema.safeParse(row.normalized_payload);
    if (!parsed.success) return;
    const snapshot = parsed.data;
    const registryOnly = row.snapshot_provider === "bnbera-registry-review";
    const profileSource = registryOnly ? "Finalized ERC-8004 registry" : "8004scan";
    const identityKey = erc8004IdentityKey(snapshot.identity);
    if (identityKey !== `${row.namespace}:${row.chain_id}:${row.identity_registry}:${row.agent_id}`) return;
    const observation=checkMap.get(identityKey);
    snapshot.serviceVerifications=Array.isArray(observation?.services) ? observation.services.flatMap((raw:unknown)=>{
      const check=serviceVerificationSchema.safeParse(raw);
      return check.success && snapshot.services.some(s=>s.url===check.data.url&&s.name===check.data.name) ? [check.data] : [];
    }) : [];
    const metrics = unknownMetrics();
    try {
      const read = await commerce.readForIdentity({identity:snapshot.identity, limit:100});
      const verified = read.verifiedReviews.filter(review=>review.state === "active" && erc8004IdentityKey(review.providerBinding.identity)===identityKey);
      metrics.completedJobs = {status:"available",completedCount:read.completedJobs.length,source:"bnbera-erc8183-settled",observedAt:read.observedAtUnix?new Date(read.observedAtUnix*1000).toISOString():null};
      metrics.reputation.verifiedPurchases = {status:"available",count:verified.length,feedback:[],source:"bnbera-erc8183-verified-purchase",observedAt:verified[0]?new Date(verified[0].updatedAtUnix*1000).toISOString():null,reason:null};
      metrics.reputation.verifiedReviews = verified.map(review=>({reviewId:review.reviewId,commerceJobId:review.commerceJobId,reviewerAddress:review.buyerAddress,identity:review.providerBinding.identity,agentVersionId:review.providerBinding.agentVersionId,agentVersion:review.providerBinding.agentVersion,resultSha256:review.resultSha256,resultKeccak:review.resultKeccak,settlementTransactionHash:review.settlementTransactionHash,score:review.score,comment:review.comment,observedAt:new Date(review.updatedAtUnix*1000).toISOString()}));
    } catch { /* Keep the explicit unavailable state if commerce reads fail. */ }
    const age = Date.now()-Date.parse(snapshot.fetchedAt);
    const freshness = age < 24*60*60*1000 ? "fresh" : "stale";
    const profile = mainnetSellerProfile(snapshot.identity);
    const sellerAmount = typeof row.seller_pricing?.amountAtomic === "string" && /^[1-9][0-9]*$/u.test(row.seller_pricing.amountAtomic) ? row.seller_pricing.amountAtomic as string : null;
    const sellerBound = !!profile && row.seller_review === canonicalSha256Hex(profile) && row.agent_wallet?.toLowerCase() === profile.wallet.toLowerCase() &&
      snapshot.services.some(service => service.url === profile.card && service.name.toLowerCase() === "a2a") && row.listing_status === "published" && row.verification_status === "verified" && row.runtime_status === "live" &&
      row.seller_pricing?.tokenAddress?.toLowerCase() === "0xce24439f2d9c6a2289f741120fe202248b666666" && row.seller_pricing?.decimals === 18 && sellerAmount !== null;
    const sellerFresh = sellerBound && row.seller_probe?.url === profile?.card && row.seller_probe?.status === "healthy" &&
      Date.now() - Date.parse(row.seller_probe.observedAt) >= 0 && Date.now() - Date.parse(row.seller_probe.observedAt) <= 120000;
    const sellerReady = mainnetRelease && sellerFresh;
    const reason = sellerBound ? `${profile?.historicalJobId ? "Useful historical result verified; new delivery is not guaranteed." : "Protocol-ready seller; useful delivery history is unverified."} Fresh signed terms and explicit buyer risk acceptance are required. Seven-day permissionless settlement; no trading authority is granted.` : "Registered agent. Hiring requires a separately verified callable service and supported payment offer.";
    const uri=snapshot.registration.uri;
    const publicUri=uri?.startsWith("data:") ? "Inline on-chain registration (data URI); content digest recorded" : uri?.startsWith("ipfs:") && !/[?#@]/u.test(uri) ? uri : publicHttpsUrl(uri);
    const snapshotForBrowser = {...snapshot, renderedAt:new Date().toISOString(), registration:{...snapshot.registration,uri:publicUri}};
    const category = classifyAgent({name:snapshot.name,description:snapshot.description,supportedProtocols:snapshot.protocols,advertisedSkills:snapshot.skills}).category;
    agents.push(marketplaceAgentReadModelSchema.parse({
      id:identityKey,slug:directorySlug(snapshot),name:snapshot.name,description:snapshot.description,tagline:snapshot.description.slice(0,237),category,protocols:snapshot.protocols,
      identity:snapshot.identity, ownerAddress:row.owner_address,agentWallet:row.agent_wallet,
      stateAxes:{originType:row.origin_type,claimStatus:row.claim_status,verificationStatus:row.verification_status,runtimeStatus:row.runtime_status,authorityStatus:row.authority_status,listingStatus:row.listing_status},
      services:[],capabilityManifest:{schemaVersion:"bnbera-directory-v1",capabilities:[]},
      eligibility:{eligible:sellerReady,score:null,components:null,reasons:sellerReady?[]:[{code:sellerBound?"ENDPOINT_STALE":"ENDPOINT_UNVERIFIED",message:reason}]},
      freshness:{status:freshness,label:`Metadata ${freshness}`,observedAt:snapshot.fetchedAt,blockNumber:Number(row.observed_block),source:registryOnly?profileSource:"8004scan + finalized ERC-8004 registry"},
      pricing:sellerBound ? {availability:"available",activationMethod:"erc8183",label:`Last quoted ${formatUnits(BigInt(sellerAmount!),18)} U`,currency:"U",amountAtomic:sellerAmount,explanation:"Observed provider-signed price, not a binding offer. Request a fresh quote for your exact task; the amount can change."} : {availability:"unknown",activationMethod:"none",label:"Contact agent",currency:null,amountAtomic:null,explanation:"No executable price quote has been verified by BNBEra."},
      authority:{status:row.authority_status,summary:"Registration does not grant BNBEra execution authority.",executionWallet:null,provider:"unknown",expiry:null,spendCap:null},
      currentData:metrics.currentData,health:{endpointStatus:sellerFresh?"healthy":"unknown",observedAt:sellerBound?row.seller_probe?.observedAt??null:null,latencyMs:null,source:sellerBound?"Reviewed A2A card probe; delivery not guaranteed":null},metrics,serviceEvidence:[],
      evidence:{status:"unavailable",summary:"Registry identity was checked at a finalized block. No new Greenfield publication is claimed.",ipfsUri:null,greenfieldUri:null,lastVerifiedAt:null},
      activation:{chainId:snapshot.identity.chainId,enabled:sellerReady,availability:sellerReady?"available":"unavailable",method:sellerBound?"erc8183":"none",title:sellerReady?"Request a signed mainnet offer":sellerBound?"Mainnet offer temporarily unavailable":"Explore registered services",reason,nextAction:sellerReady?"review_signed_offer":sellerBound?"refresh_service_status":"inspect_services"},
      scoreExplanation:{score:null,components:null,factors:[registryOnly?"No vendor score is available from this primary-source registration.":"The displayed score is attributed to 8004scan; it is separate from BNBEra hire eligibility."]},
      dataProvenance:{mode:"live",label:"Registered directory",details:`${profileSource}, resolved registration metadata and independently finalized registry identity. Current delivery is not guaranteed.`,sourceKind:"ingestion",sources:[{source:registryOnly?"manual":"8004scan",sourceReference:snapshot.sourceUrl,firstObservedAt:snapshot.fetchedAt,lastObservedAt:snapshot.fetchedAt,rawResponseDigest:row.payload_digest,normalizedIngestionVersion:"bnbera-directory-v1"}],identityRead:{observedBlock:Number(row.observed_block),observedBlockHash:row.observed_block_hash,readConsistency:"finalized",observedAt:new Date(row.identity_observed_at).toISOString()},refreshedAt:snapshot.fetchedAt},
      directory:snapshotForBrowser
    }));
    }));
  }
  // The directory snapshot digest is not a raw vendor-response digest.
  for (const agent of agents) for (const source of agent.dataProvenance.sources) source.rawResponseDigest = null;
  // A reference provider is read through the existing publication, capability,
  // pricing and health gate. It never receives a synthetic vendor observation.
  const referenceId=process.env.T5_REFERENCE_PROVIDER_AGENT_ID;
  if(referenceId && /^[1-9][0-9]*$/u.test(referenceId)) {
    try {
    const identity = erc8004IdentitySchema.parse({namespace:"eip155",chainId:97,identityRegistry:process.env.T5_REFERENCE_PROVIDER_IDENTITY_REGISTRY,agentId:referenceId});
    const {service}=await createLiveReadService(identity);
    const identifier=erc8004IdentityKey(identity);
    const read=await service.readAgent(identifier);
    if(read.agent) {
      const mapped=mapMarketplaceDetailResponse(read.agent.agent,"live",new Date().toISOString());
      const prior=agents.findIndex(agent=>agent.id===mapped.id);
      if(prior>=0)agents.splice(prior,1);
      // Display cap remains 100; retained external observations are not removed.
      agents.unshift(mapped);
      if(agents.length>100)agents.pop();
    }
    } catch { /* Optional reference-provider projection must not erase the public directory. */ }
  }
  const refreshedAt = agents.flatMap(agent=>agent.directory?.fetchedAt??[]).sort().at(-1) ?? null;
  const meta = {sourceStatus:agents.length?"healthy" as const:"empty" as const,sourceName:"postgres-registered-directory",sourceKind:"ingestion" as const,warning:null,refreshedAt,fixtureCount:0,retrievalMode:"deterministic" as const,semanticModelVersion:null};
  return {agents,meta};
}

async function readRegisteredDirectorySearch(input: MarketplaceSearchInput) {
  const {agents,meta}=await readRegisteredDirectory();
  const sorted=sortAgents(agents.filter(agent=>selectionMatches(agent,input)),input);
  return webSearchResponseSchema.parse({contractVersion:marketplaceReadContractVersion,status:sorted.length?"ready":"empty",mode:"live",dataLabel:"Registered agents",notice:"A capped directory of real mainnet and testnet registrations. Service availability and hiring are evaluated separately.",agents:sorted.slice(0,input.limit),excluded:[],total:sorted.length,selection:querySelection(input),meta,error:null,
    directoryStats:{registered:agents.length,mainnet:agents.filter(a=>a.identity.chainId===56).length,testnet:agents.filter(a=>a.identity.chainId===97).length,hireEligible:agents.filter(a=>a.activation.enabled).length,recentlyChecked:agents.filter(a=>a.directory?.serviceVerifications.some(s=>serviceVerificationState(s)==="verified")).length,cap:100}});
}

async function createLiveReadService(identity?: Erc8004Identity): Promise<LiveReadContext> {
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
  const commerceProjection = new PostgresErc8183MarketplaceProjection(pool);
  const recognizedReviewerAddresses = (process.env.ERC8004_RECOGNIZED_REVIEWER_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const source = new IngestionMarketplaceSource(repository, metadataSource, {
    ...(identity === undefined ? {} : { identity }),
    sourceName: "postgres-ingestion-read-model",
    recognizedReviewerAddresses,
    commerceProjection,
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
  return { service, metadataSource };
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
    if (process.env.MARKETPLACE_DIRECTORY_ENABLED === "true") return await readRegisteredDirectorySearch(parsedInput);
    const { service } = await createLiveReadService();
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
    if (process.env.MARKETPLACE_DIRECTORY_ENABLED === "true") {
      const directory = await readRegisteredDirectory();
      const agent = directory.agents.find(item=>item.slug === normalizedSlug);
      if (agent) {
        let detailAgent=agent;
        try {
          const runtime=loadRuntimeConfig(process.env);
          if(runtime.databaseUrl) {
            const source=await new PostgresMarketplaceMetadataSource(getPool(runtime.databaseUrl,runtime.databaseSsl)).readEvidenceForIdentity(agent.identity);
            const profile=marketplaceAgentReadModelSchema.shape.evidence.shape.profile.parse(source.profile);
            const runBundle=marketplaceAgentReadModelSchema.shape.evidence.shape.runBundle.parse(source.runBundle);
            const primary=profile.status!=="unavailable"?profile:runBundle;
            detailAgent={...agent,evidence:marketplaceAgentReadModelSchema.shape.evidence.parse({...agent.evidence,status:primary.status,summary:primary.summary,currentVersion:source.currentVersion,profile,runBundle,greenfieldUri:profile.readUrl,greenfieldLocator:profile.locator,lastVerifiedAt:primary.verifiedAt})};
          }
        }catch{ /* Optional publication evidence never removes a registered profile. */ }
        return {contractVersion:marketplaceReadContractVersion,status:"ready",mode:"live",dataLabel:"Registered agent",notice:"Real ERC-8004 registration with attributed public evidence.",meta:directory.meta,agent:detailAgent,error:null};
      }
    }
    const { service, metadataSource } = await createLiveReadService();
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
    let evidence = unavailableMarketplaceEvidence();
    try {
      evidence = await metadataSource.readEvidenceForIdentity(result.agent.agent.identity);
    } catch {
      // Evidence is optional. A missing migration/provider timeout must not
      // hide the canonical listing or prevent browsing/hiring.
      evidence = unavailableMarketplaceEvidence();
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
      agent: await withReferenceCapacity(mapMarketplaceDetailResponse(
        { ...result.agent.agent, evidence },
        effectiveMode === "empty" ? "live" : effectiveMode,
        result.meta.refreshedAt
      )),
      error: null
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : metadataQueryError(error);
    return marketplaceDetailErrorResponse(appError.toEnvelope(), "The PostgreSQL marketplace detail could not be read safely.");
  }
}
