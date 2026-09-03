import { randomUUID } from "node:crypto";
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

export type MarketplaceReadServiceOptions = {
  readonly requestId?: () => string;
  readonly now?: () => Date;
  readonly allowedChainIds?: readonly number[];
};

type EvaluatedListing = {
  readonly listing: MarketplaceListingInput;
  readonly evaluation: ReturnType<typeof evaluateListing>;
};

/**
 * Read-only application seam for marketplace routes and tRPC/HTTP adapters.
 * It owns no database connection and never starts a provider, wallet, payment,
 * or activation flow. A caller supplies the source used for the current read.
 */
export class MarketplaceReadService {
  private readonly policy: EligibilityPolicy;
  private readonly requestId: () => string;
  private readonly now: () => Date;

  public constructor(
    private readonly source: MarketplaceSource,
    options: MarketplaceReadServiceOptions = {}
  ) {
    this.policy = {
      allowedChainIds: options.allowedChainIds ?? defaultReadChainIds
    };
    this.requestId = options.requestId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
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
    const eligible = evaluated
      .filter((entry) => entry.evaluation.eligible)
      .sort(compareEvaluatedListings);
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
      meta: this.meta(snapshot, requestId, evaluatedAt)
    };
    return marketplaceSearchResponseSchema.parse(response);
  }

  public async getAgent(identifier: string): Promise<MarketplaceDetailResponse> {
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
    const listing = snapshot.records.find(
      (candidate) =>
        candidate.slug === normalizedIdentifier || candidate.identityKey === normalizedIdentifier
    );
    if (listing === undefined) {
      throw marketplaceError(
        "MARKETPLACE_AGENT_NOT_FOUND",
        "The requested marketplace agent was not found.",
        requestId,
        "choose another_agent"
      );
    }
    const request = parseMarketplaceSearchRequest({});
    const evaluatedAt = this.now();
    const evaluated: EvaluatedListing = {
      listing,
      evaluation: evaluateListing(listing, request, evaluatedAt, this.policy)
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
    return marketplaceDetailResponseSchema.parse({
      agent: detail,
      meta: this.meta(snapshot, requestId, evaluatedAt)
    });
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
    returnedAt: Date = this.now()
  ): MarketplaceResponseMeta {
    const sourceStatus = snapshot.records.length === 0 ? "empty" : snapshot.status;
    return {
      requestId,
      sourceStatus,
      sourceName: snapshot.sourceName,
      warning: snapshot.warning,
      returnedAt: returnedAt.toISOString(),
      fixtureCount: snapshot.records.filter((listing) => listing.fixture !== null).length
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
