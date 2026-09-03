import {
  activationAvailabilitySchema,
  activationDisabledReason,
  activationFeatureGate,
  type ActivationAvailability,
  type MarketplaceEligibilityEvaluation,
  type MarketplaceListingInput,
  type MarketplaceSearchRequest,
  type MarketplaceScoreExplanation,
  type ScoreComponents
} from "./types.js";
import type { EligibilityReasonCode } from "@bnbera/domain";

export const defaultReadChainIds = [56, 97] as const;

/** Optional write-capable rails stay fail-closed for the W0/W1 package. */
export const marketplaceFeatureFlags = Object.freeze({
  coreMarketplace: true,
  activationCommerce: false,
  creatorAltana: false,
  evidencePublication: false
} as const);

export const activationUnavailableMessage =
  "Activation is unavailable: the Activation + Commerce gate is disabled while ERC-8183 and B402 standards-lock entries remain unresolved.";

export type EligibilityPolicy = {
  readonly allowedChainIds: readonly number[];
};

export function createActivationAvailability(
  offer: MarketplaceListingInput["activationOffer"]
): ActivationAvailability {
  return activationAvailabilitySchema.parse({
    available: false,
    featureGate: activationFeatureGate,
    method: offer.advertised ? offer.method : "none",
    reasonCode: activationDisabledReason,
    message: offer.advertised
      ? `${offer.label} is advertised but unavailable in W0/W1; the optional activation rail is disabled.`
      : activationUnavailableMessage
  });
}

export function evaluateListing(
  listing: MarketplaceListingInput,
  request: MarketplaceSearchRequest,
  now: Date,
  policy: EligibilityPolicy = { allowedChainIds: defaultReadChainIds }
): MarketplaceEligibilityEvaluation {
  const reasons: Array<{ code: EligibilityReasonCode; message: string }> = [];
  const addReason = (code: EligibilityReasonCode, message: string): void => {
    if (!reasons.some((reason) => reason.code === code)) {
      reasons.push({ code, message });
    }
  };

  if (!policy.allowedChainIds.includes(listing.identity.chainId)) {
    addReason(
      "WRONG_CHAIN",
      `Chain ${listing.identity.chainId} is outside the configured read-only BSC marketplace networks.`
    );
  }
  if (request.chainId !== undefined && listing.identity.chainId !== request.chainId) {
    addReason("WRONG_CHAIN", `The listing is on chain ${listing.identity.chainId}, not the requested chain.`);
  }
  if (listing.pricing.network !== listing.identity.chainId) {
    addReason(
      "WRONG_CHAIN",
      `The observed pricing network ${listing.pricing.network} does not match the identity chain ${listing.identity.chainId}.`
    );
  }
  if (request.category !== undefined && listing.category !== request.category) {
    addReason("WRONG_CATEGORY", `The listing category is ${listing.category}, not ${request.category}.`);
  }

  const supportedProtocols = collectProtocolNames(listing);
  const unsupportedProtocol = request.requiredProtocols.find(
    (protocol) => ![...supportedProtocols].some((candidate) => protocolMatches(protocol, candidate))
  );
  if (unsupportedProtocol !== undefined) {
    addReason("PROTOCOL_UNSUPPORTED", `The listing does not advertise required protocol ${unsupportedProtocol}.`);
  }

  if (listing.health.endpointStatus !== "healthy" || listing.state.runtimeStatus !== "live") {
    addReason(
      "ENDPOINT_UNHEALTHY",
      listing.health.endpointStatus === "unknown"
        ? "No healthy endpoint probe is available for this listing."
        : "The advertised endpoint or runtime is not currently healthy and live."
    );
  }

  const identityRead = listing.provenance.identityRead;
  if (
    identityRead.observedBlock === null ||
    identityRead.observedBlockHash === null ||
    identityRead.readConsistency === null
  ) {
    addReason("IDENTITY_UNRESOLVED", "The complete ERC-8004 identity has no exact block-read provenance yet.");
  }

  const authorityRequired =
    request.requireAuthority ||
    request.requestedAmountAtomic !== undefined ||
    request.requiredContract !== undefined ||
    request.requiredSelector !== undefined;
  if (authorityRequired) {
    const authorityState = listing.state.authorityStatus;
    const expiresAt = listing.authority.expiresAt === null ? null : Date.parse(listing.authority.expiresAt);
    const expiredByTime = expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= now.getTime();
    if (authorityState === "expired" || expiredByTime) {
      addReason("AUTHORITY_EXPIRED", "The execution authority has expired.");
    } else if (authorityState === "revoked") {
      addReason("AUTHORITY_REVOKED", "The execution authority was revoked.");
    } else if (authorityState === "none" || listing.authority.executionWallet === null || listing.authority.walletProvider === "unknown") {
      addReason("AUTHORITY_MISSING", "No verifiable execution authority is available for the requested action.");
    }

    if (request.requestedAmountAtomic !== undefined && listing.authority.spendLimitAtomic !== null) {
      if (BigInt(request.requestedAmountAtomic) > BigInt(listing.authority.spendLimitAtomic)) {
        addReason("AMOUNT_EXCEEDS_POLICY", "The requested amount exceeds the advertised authority spend limit.");
      }
    } else if (request.requestedAmountAtomic !== undefined) {
      addReason("AMOUNT_EXCEEDS_POLICY", "The listing does not expose a verified spend limit for this request.");
    }

    if (request.requiredContract !== undefined) {
      const target = request.requiredContract.toLowerCase();
      if (!listing.authority.allowlistedContracts.some((contract) => contract.toLowerCase() === target)) {
        addReason("SELECTOR_NOT_ALLOWLISTED", "The requested contract is outside the advertised authority allowlist.");
      }
    }
    if (request.requiredSelector !== undefined) {
      const selector = request.requiredSelector.toLowerCase();
      if (!listing.authority.allowlistedSelectors.some((candidate) => candidate.toLowerCase() === selector)) {
        addReason("SELECTOR_NOT_ALLOWLISTED", "The requested selector is outside the advertised authority allowlist.");
      }
    }
  }

  if (request.maxPriceAtomic !== undefined) {
    if (
      listing.pricing.model !== "free" &&
      (listing.pricing.maxAtomic === null || BigInt(listing.pricing.maxAtomic) > BigInt(request.maxPriceAtomic))
    ) {
      addReason("PRICE_EXCEEDS_MAXIMUM", "The listing has no verified price within the requested maximum.");
    }
  }

  if (request.requireFreshData && !hasFreshData(listing, now)) {
    addReason("DATA_STALE", "The listing's required data is stale or has no freshness observation.");
  }

  const queryTerms = uniqueTokens(request.query);
  const searchableTokens = new Set(uniqueTokens(searchableText(listing)));
  const missingQueryTerm = queryTerms.find((term) => !searchableTokens.has(term));
  if (missingQueryTerm !== undefined) {
    addReason("CAPABILITY_INCOMPATIBLE", `The listing does not match search term ${missingQueryTerm}.`);
  }

  if (listing.state.listingStatus !== "published") {
    addReason("LISTING_NOT_PUBLISHED", `The listing state is ${listing.state.listingStatus}.`);
  }
  if (listing.state.verificationStatus === "pending") {
    addReason("VERIFICATION_PENDING", "The listing verification is still pending.");
  } else if (listing.state.verificationStatus === "rejected") {
    addReason("VERIFICATION_REJECTED", "The listing verification was rejected.");
  }

  if (reasons.length > 0) {
    const explanation: MarketplaceScoreExplanation = {
      score: null,
      components: null,
      factors: reasons.map((reason) => reason.message)
    };
    return {
      eligible: false,
      score: null,
      components: null,
      reasons,
      explanation
    };
  }

  const components = scoreComponents(listing, request, now, supportedProtocols);
  const score = components.capability + components.health + components.dataQuality + components.authority + components.execution + components.price;
  const explanation: MarketplaceScoreExplanation = {
    score,
    components,
    factors: scoreFactors(listing, request, components, queryTerms, searchableTokens)
  };
  return {
    eligible: true,
    score,
    components,
    reasons: [],
    explanation
  };
}

function scoreComponents(
  listing: MarketplaceListingInput,
  request: MarketplaceSearchRequest,
  now: Date,
  supportedProtocols: ReadonlySet<string>
): ScoreComponents {
  const queryTerms = uniqueTokens(request.query);
  const searchableTokens = new Set(uniqueTokens(searchableText(listing)));
  const textCoverage = queryTerms.length === 0
    ? 1
    : queryTerms.filter((term) => searchableTokens.has(term)).length / queryTerms.length;
  const protocolCoverage = request.requiredProtocols.length === 0
    ? 1
    : request.requiredProtocols.filter((protocol) =>
        [...supportedProtocols].some((candidate) => protocolMatches(protocol, candidate))
      ).length / request.requiredProtocols.length;
  const exactPoints = Math.round(20 * protocolCoverage);
  const textPoints = Math.round(15 * textCoverage);
  const health = listing.health.endpointStatus === "healthy" ? 20 : 0;
  const dataQuality = listing.dataFreshness.status === "fresh" ? 15 : listing.dataFreshness.status === "stale" ? 6 : 0;
  const authority = listing.state.authorityStatus === "active"
    ? 15
    : listing.state.authorityStatus === "none"
      ? 8
      : listing.state.authorityStatus === "expired"
        ? 4
        : 0;
  const execution = executionPoints(listing, now);
  const price = listing.pricing.maxAtomic === null && listing.pricing.minAtomic === null ? 0 : 5;
  return {
    capability: Math.min(35, exactPoints + textPoints),
    health,
    dataQuality,
    authority,
    execution,
    price
  };
}

function executionPoints(listing: MarketplaceListingInput, now: Date): number {
  if (listing.executionEvidence.status !== "verified" || listing.executionEvidence.lastVerifiedAt === null) {
    return 0;
  }
  const observedAt = Date.parse(listing.executionEvidence.lastVerifiedAt);
  if (!Number.isFinite(observedAt)) {
    return 0;
  }
  const ageSeconds = Math.max(0, (now.getTime() - observedAt) / 1_000);
  if (ageSeconds <= 86_400) {
    return 10;
  }
  if (ageSeconds <= 7 * 86_400) {
    return 7;
  }
  if (ageSeconds <= 30 * 86_400) {
    return 4;
  }
  return 2;
}

function hasFreshData(listing: MarketplaceListingInput, now: Date): boolean {
  const freshness = listing.dataFreshness;
  if (freshness.status !== "fresh" || freshness.observedAt === null) {
    return false;
  }
  const observedAt = Date.parse(freshness.observedAt);
  if (!Number.isFinite(observedAt)) {
    return false;
  }
  if (freshness.maxAgeSeconds === null) {
    return true;
  }
  return now.getTime() - observedAt <= freshness.maxAgeSeconds * 1_000;
}

function scoreFactors(
  listing: MarketplaceListingInput,
  request: MarketplaceSearchRequest,
  components: ScoreComponents,
  queryTerms: readonly string[],
  searchableTokens: ReadonlySet<string>
): string[] {
  const matched = queryTerms.filter((term) => searchableTokens.has(term));
  return [
    `Capability fit: ${components.capability}/35 (${components.capability - Math.round(15 * (queryTerms.length === 0 ? 1 : matched.length / queryTerms.length))}/20 structured, deterministic text match included).`,
    `Endpoint health: ${components.health}/20; observed ${listing.health.observedAt ?? "unknown"}.`,
    `Data freshness: ${components.dataQuality}/15; status ${listing.dataFreshness.status}.`,
    `Authority compatibility: ${components.authority}/15; state ${listing.state.authorityStatus}${request.requireAuthority ? " for a required execution request" : " for read-only discovery"}.`,
    `Verified execution evidence: ${components.execution}/10; last observed ${listing.executionEvidence.lastVerifiedAt ?? "none"}.`,
    `Price fit: ${components.price}/5; model ${listing.pricing.model}.`
  ];
}

function collectProtocolNames(listing: MarketplaceListingInput): ReadonlySet<string> {
  const values = new Set<string>();
  for (const protocol of listing.supportedProtocols) {
    values.add(protocol.toLowerCase());
  }
  for (const capability of listing.capabilities.capabilities) {
    for (const protocol of capability.requiredProtocols) {
      values.add(protocol.toLowerCase());
    }
  }
  for (const service of listing.services) {
    values.add(service.kind.toLowerCase());
    values.add(service.protocolVersion.toLowerCase());
  }
  return values;
}

function protocolMatches(required: string, candidate: string): boolean {
  const expected = required.trim().toLowerCase();
  const actual = candidate.trim().toLowerCase();
  // A generic requirement such as `pancakeswap` accepts a versioned
  // advertisement, but a versioned requirement must not be satisfied by a
  // less-specific generic label.
  return expected === actual || actual.startsWith(`${expected}-`);
}

function searchableText(listing: MarketplaceListingInput): string {
  return [
    listing.name,
    listing.slug,
    listing.description,
    listing.category,
    ...listing.supportedProtocols,
    ...listing.services.flatMap((service) => [service.kind, service.protocolVersion]),
    ...listing.capabilities.capabilities.flatMap((capability) => [
      capability.id,
      capability.description,
      ...capability.requiredProtocols,
      ...capability.allowedActions
    ])
  ].join(" ");
}

function uniqueTokens(value: string): readonly string[] {
  return [...new Set((value.toLowerCase().match(/[a-z0-9]+/gu) ?? []))];
}
