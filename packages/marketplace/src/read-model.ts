import { AppError, type ErrorEnvelope } from "@bnbera/config";
import type { AgentCategory } from "@bnbera/domain";
import {
  createActivationAvailability,
  defaultReadChainIds,
  evaluateListing,
  type EligibilityPolicy
} from "./eligibility.js";
import { marketplaceError, type MarketplaceApiResult } from "./errors.js";
import {
  marketplaceAgentCardSchema,
  marketplaceAgentDetailSchema,
  marketplaceCompareResponseSchema,
  marketplaceDetailResponseSchema,
  marketplaceSearchResponseSchema,
  parseMarketplaceSearchRequest,
  parseMarketplaceSourceSnapshot,
  type MarketplaceAgentCard,
  type MarketplaceAgentDetail,
  type MarketplaceCompareResponse,
  type MarketplaceDetailResponse,
  type MarketplaceListingInput,
  type MarketplaceResponseMeta,
  type MarketplaceSearchRequest,
  type MarketplaceSearchResponse,
  type MarketplaceSourceSnapshot
} from "./types.js";
import type { MarketplaceSource } from "./source.js";
import type { MarketplaceSemanticHit, MarketplaceSemanticRetriever } from "./hybrid.js";

export type MarketplaceAgentRead = {
  readonly agent: MarketplaceDetailResponse | null;
  /**
   * Preserve source metadata even when the requested identifier is absent.
   * This lets an API distinguish a genuinely empty source from an all-
   * withheld/degraded projection instead of returning an apparently healthy
   * 404 for both cases.
   */
  readonly meta: MarketplaceResponseMeta;
};

export type MarketplaceReadServiceOptions = {
  readonly requestId?: () => string;
  readonly now?: () => Date;
  readonly allowedChainIds?: readonly number[];
  /** Optional, explicitly enabled semantic ranker after hard eligibility. */
  readonly semanticRetriever?: MarketplaceSemanticRetriever;
  readonly semanticRetrievalEnabled?: boolean;
};

type EvaluatedListing = {
  readonly listing: MarketplaceListingInput;
  readonly evaluation: ReturnType<typeof evaluateListing>;
};

let requestSequence = 0;

function createRequestId(): string {
  requestSequence = requestSequence >= 1_000_000_000 ? 1 : requestSequence + 1;
  return `req-marketplace-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

/**
 * Read-only application seam for marketplace routes and tRPC/HTTP adapters.
 * It owns no database connection and never starts a provider, wallet, payment,
 * or activation flow. A caller supplies the source used for the current read.
 */
export class MarketplaceReadService {
  private readonly policy: EligibilityPolicy;
  private readonly requestId: () => string;
  private readonly now: () => Date;
  private readonly semanticRetriever: MarketplaceSemanticRetriever | undefined;
  private readonly semanticRetrievalEnabled: boolean;

  public constructor(
    private readonly source: MarketplaceSource,
    options: MarketplaceReadServiceOptions = {}
  ) {
    this.policy = {
      allowedChainIds: options.allowedChainIds ?? defaultReadChainIds
    };
    this.requestId = options.requestId ?? createRequestId;
    this.now = options.now ?? (() => new Date());
    this.semanticRetriever = options.semanticRetriever;
    this.semanticRetrievalEnabled = options.semanticRetrievalEnabled === true;
  }

  public async browse(input: unknown = {}): Promise<MarketplaceSearchResponse> {
    return this.search(input);
  }

  public async category(
    category: AgentCategory,
    input: unknown = {}
  ): Promise<MarketplaceSearchResponse> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw marketplaceError(
        "MARKETPLACE_REQUEST_INVALID",
        "Marketplace category filters must be an object.",
        this.requestId(),
        "fix_search",
        false
      );
    }
    return this.search({ ...(input as Record<string, unknown>), category });
  }

  public async search(input: unknown = {}): Promise<MarketplaceSearchResponse> {
    const requestId = this.requestId();
    const request = this.parseRequest(input, requestId);
    const snapshot = await this.readSnapshot(requestId);
    const evaluatedAt = this.now();
    const evaluated = snapshot.records.map((listing) => ({
      listing,
      evaluation: evaluateListing(listing, request, evaluatedAt, this.policy)
    }));
    let eligible = evaluated
      .filter((entry) => entry.evaluation.eligible)
      .sort(compareEvaluatedListings);
    let semanticWarning: string | null = null;
    let retrievalMode: MarketplaceResponseMeta["retrievalMode"] = "deterministic";
    let semanticModelVersion: string | null = null;
    if (this.semanticRetrievalEnabled && this.semanticRetriever !== undefined && request.query.trim().length > 0 && eligible.length > 0) {
      try {
        const rawHits = await this.semanticRetriever.search({
          request,
          candidateIdentityKeys: eligible.map((entry) => entry.listing.identityKey)
        });
        if (!Array.isArray(rawHits)) throw new Error("semantic retrieval returned an invalid hit set");
        const hits = normalizeSemanticHits(rawHits, new Set(eligible.map((entry) => entry.listing.identityKey)));
        const modelVersions = [...new Set(hits.map((hit) => hit.modelVersion))];
        if (hits.length === 0) {
          // A missing or incompatible vector index is not a semantic result.
          // Preserve the hard-filtered deterministic order and label the
          // response degraded instead of claiming a hybrid ranking.
          semanticWarning = "Semantic retrieval returned no compatible embeddings; deterministic hard-filter and full-text ranking is active.";
          retrievalMode = "fallback";
        } else if (modelVersions.length > 1) {
          // A mixed model result cannot be honestly represented as one hybrid
          // index. Keep the deterministic ordering and identify the fallback.
          semanticWarning = "Semantic retrieval returned mixed model versions; deterministic ranking is active.";
          retrievalMode = "fallback";
        } else {
          retrievalMode = "hybrid";
          semanticModelVersion = modelVersions[0] ?? null;
          if (hits.length < eligible.length) {
            semanticWarning = "Semantic retrieval is incomplete; deterministic ranking is retained for listings without compatible embeddings.";
          }
        }
        const byIdentity = new Map(hits.map((hit) => [hit.identityKey, hit]));
        if (retrievalMode === "hybrid") {
          eligible = eligible
            .map((entry, index) => ({ entry, index, hit: byIdentity.get(entry.listing.identityKey) }))
            .sort((a, b) => {
              if (a.hit !== undefined && b.hit !== undefined && a.hit.similarity !== b.hit.similarity) return b.hit.similarity - a.hit.similarity;
              if (a.hit !== undefined && b.hit === undefined) return -1;
              if (a.hit === undefined && b.hit !== undefined) return 1;
              return compareEvaluatedListings(a.entry, b.entry) || a.index - b.index;
            })
            .map((item) => item.entry);
        }
      } catch {
        semanticWarning = "Semantic retrieval degraded; deterministic hard-filter and full-text ranking is active.";
        retrievalMode = "fallback";
      }
    } else if (this.semanticRetrievalEnabled && this.semanticRetriever === undefined && request.query.trim().length > 0 && eligible.length > 0) {
      semanticWarning = "Semantic retrieval is enabled but no compatible index is configured; deterministic ranking is active.";
      retrievalMode = "fallback";
    }
    const excluded = evaluated
      .filter((entry) => !entry.evaluation.eligible)
      .sort(compareExcludedListings)
      .map((entry) => ({
        identityKey: entry.listing.identityKey,
        slug: entry.listing.slug,
        name: entry.listing.name,
        category: entry.listing.category,
        reasons: entry.evaluation.reasons
      }));
    const response = {
      request,
      results: eligible.map((entry) => this.toCard(entry)),
      excluded,
      meta: this.meta(snapshot, requestId, evaluatedAt, semanticWarning, retrievalMode, semanticModelVersion)
    };
    return marketplaceSearchResponseSchema.parse(response);
  }

  /**
   * Read one listing while retaining the source metadata for a missing
   * identifier. `getAgent` below keeps its historical throwing contract for
   * callers that need an AppError, while HTTP adapters can use this method to
   * render truthful empty/degraded detail states.
   */
  public async readAgent(identifier: string): Promise<MarketplaceAgentRead> {
    const requestId = this.requestId();
    if (typeof identifier !== "string" || identifier.trim().length === 0) {
      throw marketplaceError(
        "MARKETPLACE_REQUEST_INVALID",
        "An agent slug or complete ERC-8004 identity key is required.",
        requestId,
        "fix_agent_identifier"
      );
    }
    const snapshot = await this.readSnapshot(requestId);
    const normalizedIdentifier = identifier.trim();
    const evaluatedAt = this.now();
    const meta = this.meta(snapshot, requestId, evaluatedAt);
    const listing = snapshot.records.find(
      (candidate) =>
        candidate.slug === normalizedIdentifier || candidate.identityKey === normalizedIdentifier
    );
    if (listing === undefined) {
      return { agent: null, meta };
    }
    const evaluated: EvaluatedListing = {
      listing,
      evaluation: evaluateListing(listing, parseMarketplaceSearchRequest({}), evaluatedAt, this.policy)
    };
    const card = this.toCard(evaluated);
    const detail: MarketplaceAgentDetail = marketplaceAgentDetailSchema.parse({
      ...card,
      detail: {
        inputSchemas: listing.capabilities.capabilities.map((capability) => capability.inputSchema),
        outputSchemas: listing.capabilities.capabilities.map((capability) => capability.outputSchema),
        contractAllowlist: {
          contracts: listing.authority.allowlistedContracts,
          selectors: listing.authority.allowlistedSelectors
        },
        latestExecution: listing.executionEvidence
      }
    });
    return {
      agent: marketplaceDetailResponseSchema.parse({ agent: detail, meta }),
      meta
    };
  }

  public async getAgent(identifier: string): Promise<MarketplaceDetailResponse> {
    const result = await this.readAgent(identifier);
    if (result.agent !== null) return result.agent;
    // `readAgent` deliberately returns null for a missing slug so the API can
    // preserve source status. Keep the direct method's existing error shape.
    throw marketplaceError(
      "MARKETPLACE_AGENT_NOT_FOUND",
      "The requested marketplace agent was not found.",
      result.meta.requestId,
      "choose another_agent"
    );
  }

  public async compare(
    identifiers: readonly string[],
    input: unknown = {}
  ): Promise<MarketplaceCompareResponse> {
    const requestId = this.requestId();
    const requested = this.parseCompareIdentifiers(identifiers, requestId);
    const request = this.parseRequest(input, requestId);
    const snapshot = await this.readSnapshot(requestId);
    const evaluatedAt = this.now();
    const byIdentifier = new Map<string, MarketplaceListingInput>();
    for (const listing of snapshot.records) {
      byIdentifier.set(listing.slug, listing);
      byIdentifier.set(listing.identityKey, listing);
    }
    const agents: MarketplaceAgentCard[] = [];
    const missing: string[] = [];
    const includedIdentityKeys = new Set<string>();
    for (const identifier of requested) {
      const listing = byIdentifier.get(identifier);
      if (listing === undefined) {
        missing.push(identifier);
        continue;
      }
      if (includedIdentityKeys.has(listing.identityKey)) {
        continue;
      }
      includedIdentityKeys.add(listing.identityKey);
      agents.push(
        this.toCard({
          listing,
          evaluation: evaluateListing(listing, request, evaluatedAt, this.policy)
        })
      );
    }
    return marketplaceCompareResponseSchema.parse({
      requested,
      agents,
      missing,
      meta: this.meta(snapshot, requestId, evaluatedAt)
    });
  }

  public async safeSearch(input: unknown = {}): Promise<MarketplaceApiResult<MarketplaceSearchResponse>> {
    try {
      return { ok: true, value: await this.search(input) };
    } catch (error) {
      return { ok: false, error: this.errorEnvelope(error, "MARKETPLACE_SOURCE_UNAVAILABLE") };
    }
  }

  private parseRequest(input: unknown, requestId: string): MarketplaceSearchRequest {
    try {
      return parseMarketplaceSearchRequest(input);
    } catch (cause) {
      throw marketplaceError(
        "MARKETPLACE_REQUEST_INVALID",
        "Marketplace search filters are invalid.",
        requestId,
        "fix_search",
        false,
        cause
      );
    }
  }

  private parseCompareIdentifiers(
    identifiers: readonly string[],
    requestId: string
  ): readonly string[] {
    if (!Array.isArray(identifiers) || identifiers.length === 0 || identifiers.length > 3) {
      throw marketplaceError(
        "MARKETPLACE_COMPARE_LIMIT",
        "Comparison supports between one and three agents.",
        requestId,
        "select_up_to_three_agents"
      );
    }
    const normalized = identifiers.map((identifier) =>
      typeof identifier === "string" ? identifier.trim() : ""
    );
    if (normalized.some((identifier) => identifier.length === 0) || new Set(normalized).size !== normalized.length) {
      throw marketplaceError(
        "MARKETPLACE_REQUEST_INVALID",
        "Comparison identifiers must be unique, non-empty strings.",
        requestId,
        "fix_comparison"
      );
    }
    return normalized;
  }

  private async readSnapshot(requestId: string): Promise<MarketplaceSourceSnapshot> {
    let raw: unknown;
    try {
      raw = await this.source.read();
    } catch (cause) {
      throw marketplaceError(
        "MARKETPLACE_SOURCE_UNAVAILABLE",
        "Marketplace data is temporarily unavailable.",
        requestId,
        "retry_marketplace",
        true,
        cause
      );
    }
    let snapshot: MarketplaceSourceSnapshot;
    try {
      snapshot = parseMarketplaceSourceSnapshot(raw);
    } catch (cause) {
      throw marketplaceError(
        "MARKETPLACE_SOURCE_INVALID",
        "Marketplace data could not be validated.",
        requestId,
        "review_marketplace_source",
        false,
        cause
      );
    }
    const identityKeys = new Set<string>();
    const slugs = new Set<string>();
    for (const listing of snapshot.records) {
      if (identityKeys.has(listing.identityKey) || slugs.has(listing.slug)) {
        throw marketplaceError(
          "MARKETPLACE_SOURCE_INVALID",
          "Marketplace data contains duplicate identity or slug records.",
          requestId,
          "repair_marketplace_source"
        );
      }
      identityKeys.add(listing.identityKey);
      slugs.add(listing.slug);
    }
    return snapshot;
  }

  private toCard(entry: EvaluatedListing): MarketplaceAgentCard {
    return marketplaceAgentCardSchema.parse({
      ...entry.listing,
      activation: createActivationAvailability(entry.listing.activationOffer),
      eligibility: {
        eligible: entry.evaluation.eligible,
        score: entry.evaluation.score,
        components: entry.evaluation.components,
        reasons: entry.evaluation.reasons
      },
      scoreExplanation: entry.evaluation.explanation
    });
  }

  private meta(
    snapshot: MarketplaceSourceSnapshot,
    requestId: string,
    returnedAt: Date = this.now(),
    warningOverride: string | null = null,
    retrievalMode: MarketplaceResponseMeta["retrievalMode"] = "deterministic",
    semanticModelVersion: string | null = null
  ): MarketplaceResponseMeta {
    const warning = [snapshot.warning, warningOverride]
      .filter((warning): warning is string => warning !== null && warning !== undefined && warning.length > 0)
      .join(" ")
      .slice(0, 500) || null;
    const sourceStatus = snapshot.status === "degraded" || warning !== null
      ? "degraded"
      : snapshot.records.length === 0
        ? "empty"
        : "healthy";
    const fixtureCount = snapshot.records.filter((listing) => listing.fixture !== null).length;
    const sourceKind = snapshot.records.length === 0
      ? null
      : fixtureCount === snapshot.records.length
        ? "fixture"
        : fixtureCount === 0
          ? "ingestion"
          : null;
    return {
      requestId,
      sourceStatus,
      sourceName: snapshot.sourceName,
      sourceKind,
      warning,
      returnedAt: returnedAt.toISOString(),
      refreshedAt: snapshot.refreshedAt,
      fixtureCount,
      retrievalMode,
      semanticModelVersion
    };
  }

  private errorEnvelope(error: unknown, fallbackCode: "MARKETPLACE_SOURCE_UNAVAILABLE"): ErrorEnvelope {
    if (error instanceof AppError) {
      return error.toEnvelope();
    }
    return marketplaceError(
      fallbackCode,
      "Marketplace data is temporarily unavailable.",
      this.requestId(),
      "retry_marketplace",
      true,
      error
    ).toEnvelope();
  }
}

function normalizeSemanticHits(
  hits: readonly MarketplaceSemanticHit[],
  candidateKeys: ReadonlySet<string>
): readonly MarketplaceSemanticHit[] {
  const byIdentity = new Map<string, MarketplaceSemanticHit>();
  for (const hit of hits) {
    if (
      typeof hit !== "object" ||
      hit === null ||
      typeof hit.identityKey !== "string" ||
      typeof hit.modelVersion !== "string" ||
      typeof hit.similarity !== "number" ||
      !Number.isFinite(hit.similarity)
    ) continue;
    const identityKey = hit.identityKey.trim();
    const modelVersion = hit.modelVersion.trim();
    if (identityKey.length === 0 || modelVersion.length === 0 || !candidateKeys.has(identityKey)) continue;
    const normalized: MarketplaceSemanticHit = {
      identityKey,
      modelVersion,
      similarity: Math.max(-1, Math.min(1, hit.similarity))
    };
    const previous = byIdentity.get(identityKey);
    if (previous === undefined || normalized.similarity > previous.similarity) byIdentity.set(identityKey, normalized);
  }
  return [...byIdentity.values()].sort((a, b) => b.similarity - a.similarity || compareStrings(a.identityKey, b.identityKey));
}

function compareEvaluatedListings(a: EvaluatedListing, b: EvaluatedListing): number {
  const scoreA = a.evaluation.score ?? -1;
  const scoreB = b.evaluation.score ?? -1;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  return compareListingIdentity(a.listing, b.listing);
}

function compareExcludedListings(a: EvaluatedListing, b: EvaluatedListing): number {
  return compareListingIdentity(a.listing, b.listing);
}

function compareListingIdentity(a: MarketplaceListingInput, b: MarketplaceListingInput): number {
  const name = compareStrings(a.name.toLowerCase(), b.name.toLowerCase());
  if (name !== 0) {
    return name;
  }
  const slug = compareStrings(a.slug, b.slug);
  return slug === 0 ? compareStrings(a.identityKey, b.identityKey) : slug;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
