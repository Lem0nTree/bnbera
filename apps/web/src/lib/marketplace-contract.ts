import { AppError, errorEnvelopeSchema, type ErrorEnvelope } from "@bnbera/config";
import {
  InMemoryMarketplaceSource,
  MarketplaceReadService,
  marketplaceRetrievalModes,
  marketplaceSourceKinds,
  marketplaceScoreExplanationSchema,
  type MarketplaceAgentCard as CoreMarketplaceAgentCard,
  type MarketplaceAgentDetail as CoreMarketplaceAgentDetail,
  type MarketplaceSearchResponse as CoreMarketplaceSearchResponse
} from "@bnbera/marketplace";
import {
  agentCategorySchema,
  agentStateAxesSchema,
  advertisedServiceSchema,
  capabilityManifestSchema,
  discoverySources,
  erc8004IdentitySchema,
  evmAddressSchema,
  marketplaceEligibilityResultSchema,
  type AgentCategory,
  type AgentStateAxes,
  type AdvertisedService,
  type CapabilityManifest,
  type Erc8004Identity,
  type MarketplaceEligibilityResult,
  type OriginType,
  type RuntimeStatus,
  type VerificationStatus
} from "@bnbera/domain";
import { z } from "zod";

/**
 * Web-only presentation adapter over the shared read model.
 *
 * The UI deliberately owns no listing records, fixture rows, or database
 * queries. Local preview records are loaded from @bnbera/marketplace only in
 * a non-production, explicitly bounded mode; production fails closed to an
 * empty model unless MARKETPLACE_API_URL points at a validated API response.
 */
export const marketplaceReadContractVersion = "bnbera.marketplace-read/v0.1";

export const marketplaceDataModes = ["fixture", "live", "degraded", "empty", "error"] as const;
export type MarketplaceDataMode = (typeof marketplaceDataModes)[number];

export const marketplaceReadStatuses = ["ready", "loading", "empty", "degraded", "error"] as const;
export type MarketplaceReadStatus = (typeof marketplaceReadStatuses)[number];

export const marketplacePreviewStates = ["loading", "empty", "error", "degraded"] as const;
export type MarketplacePreviewState = (typeof marketplacePreviewStates)[number];

const dataFreshnessSchema = z.object({
  status: z.enum(["fresh", "stale", "unknown"]),
  label: z.string().trim().min(1).max(160),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  blockNumber: z.number().int().nonnegative().nullable(),
  source: z.string().trim().min(1).max(160)
});

const pricingSchema = z.object({
  availability: z.enum(["available", "unavailable", "unknown"]),
  activationMethod: z.enum(["erc8183", "x402_b402", "external", "none"]),
  label: z.string().trim().min(1).max(160),
  currency: z.string().trim().min(1).max(32).nullable(),
  amountAtomic: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
  explanation: z.string().trim().min(1).max(500)
});

const evidenceSummarySchema = z.object({
  status: z.enum(["verified", "pending", "unavailable"]),
  summary: z.string().trim().min(1).max(500),
  ipfsUri: z.string().url().nullable(),
  greenfieldUri: z.string().url().nullable(),
  lastVerifiedAt: z.string().datetime({ offset: true }).nullable()
});

const currentDataSchema = z.object({
  status: z.enum(["available", "stale", "unavailable"]),
  summary: z.string().trim().min(1).max(500),
  items: z.array(
    z.object({
      label: z.string().trim().min(1).max(120),
      value: z.string().trim().min(1).max(240),
      source: z.string().trim().min(1).max(160)
    })
  ).max(12)
});

const uptimeSchema = z.object({
  status: z.enum(["observed", "unknown"]),
  windowSeconds: z.number().int().positive().nullable(),
  observedFrom: z.string().datetime({ offset: true }).nullable(),
  observedTo: z.string().datetime({ offset: true }).nullable(),
  attemptedChecks: z.number().int().nonnegative(),
  successfulChecks: z.number().int().nonnegative(),
  successRatio: z.number().min(0).max(1).nullable(),
  source: z.string().trim().min(1).max(160).nullable()
});

const marketplaceMetricsSchema = z.object({
  uptime: uptimeSchema,
  reviews: z.object({
    status: z.enum(["available", "unavailable", "unknown"]),
    count: z.number().int().nonnegative().nullable(),
    averageScore: z.number().min(0).max(100).nullable(),
    source: z.string().trim().min(1).max(160).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable()
  }),
  completedJobs: z.object({
    status: z.enum(["available", "unavailable", "unknown"]),
    completedCount: z.number().int().nonnegative().nullable(),
    source: z.string().trim().min(1).max(160).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable()
  }),
  lastResult: z.object({
    status: z.enum(["available", "unavailable", "unknown"]),
    summary: z.string().trim().min(1).max(500).nullable(),
    reference: z.string().trim().min(1).max(500).nullable(),
    source: z.string().trim().min(1).max(160).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable()
  }),
  currentData: currentDataSchema
});

const skillEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000)
});

const serviceEvidenceSchema = z.object({
  kind: advertisedServiceSchema.shape.kind,
  advertisedUrl: z.string().url(),
  cardUrl: z.string().url().nullable(),
  invocationUrls: z.array(z.string().url()).max(32),
  advertisedSkills: z.array(skillEvidenceSchema).max(32),
  testedSkills: z.array(skillEvidenceSchema).max(32),
  testStatus: z.enum(["not_tested", "transport_only", "verified"]),
  testedAt: z.string().datetime({ offset: true }).nullable()
});

export type MarketplaceMetricsReadModel = z.infer<typeof marketplaceMetricsSchema>;
export type MarketplaceServiceEvidence = z.infer<typeof serviceEvidenceSchema>;

/**
 * Endpoint probes are observations about an advertised service, not a
 * guarantee that the connected database or the agent will remain available.
 * Keeping this separate from freshness makes that distinction explicit in
 * both API responses and the rendered marketplace cards.
 */
export const marketplaceEndpointHealthSchema = z.object({
  endpointStatus: z.enum(["healthy", "unhealthy", "unknown"]),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  latencyMs: z.number().int().nonnegative().max(300_000).nullable(),
  source: z.string().trim().min(1).max(160).nullable()
});

export type MarketplaceEndpointHealth = z.infer<typeof marketplaceEndpointHealthSchema>;

const authoritySummarySchema = z.object({
  status: z.enum(["none", "active", "expired", "revoked"]),
  summary: z.string().trim().min(1).max(500),
  executionWallet: evmAddressSchema.nullable(),
  provider: z.enum(["altana", "external", "unknown"]),
  expiry: z.string().datetime({ offset: true }).nullable(),
  spendCap: z.string().trim().min(1).max(160).nullable()
});

const activationSummarySchema = z.object({
  enabled: z.boolean(),
  availability: z.enum(["available", "unavailable", "degraded"]),
  method: z.enum(["erc8183", "x402_b402", "creator", "external", "none"]),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
  nextAction: z.string().trim().min(1).max(160)
});

const provenanceSourceSchema = z.object({
  source: z.enum(discoverySources),
  sourceReference: z.string().trim().min(1).max(500),
  firstObservedAt: z.string().datetime({ offset: true }),
  lastObservedAt: z.string().datetime({ offset: true }),
  rawResponseDigest: z.string().regex(/^[0-9a-fA-F]{64}$/u).nullable(),
  normalizedIngestionVersion: z.string().trim().min(1).max(64)
});

const identityReadProvenanceSchema = z
  .object({
    observedBlock: z.number().int().nonnegative().nullable(),
    observedBlockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u).nullable(),
    readConsistency: z.enum(["finalized", "provisional"]).nullable(),
    observedAt: z.string().datetime({ offset: true })
  })
  .superRefine((value, context) => {
    const present = [value.observedBlock, value.observedBlockHash, value.readConsistency]
      .filter((entry) => entry !== null).length;
    if (present !== 0 && present !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity read provenance must contain all or none of block, hash, and consistency"
      });
    }
  });

/**
 * Public provenance is deliberately copied from the core listing instead of
 * being inferred from the response mode. This keeps the complete source
 * references and exact-block identity read visible to API consumers.
 */
export const marketplaceDataProvenanceSchema = z.object({
  mode: z.enum(["fixture", "live", "degraded"]),
  label: z.string().trim().min(1).max(160),
  details: z.string().trim().min(1).max(500),
  sourceKind: z.enum(marketplaceSourceKinds),
  sources: z.array(provenanceSourceSchema).max(128),
  identityRead: identityReadProvenanceSchema,
  refreshedAt: z.string().datetime({ offset: true }).nullable()
});

export type MarketplaceDataProvenance = z.infer<typeof marketplaceDataProvenanceSchema>;

export const marketplaceReadSourceMetaSchema = z.object({
  sourceStatus: z.enum(["healthy", "degraded", "empty"]),
  sourceName: z.string().trim().min(1).max(160),
  sourceKind: z.enum(marketplaceSourceKinds).nullable(),
  warning: z.string().trim().min(1).max(500).nullable(),
  refreshedAt: z.string().datetime({ offset: true }).nullable(),
  fixtureCount: z.number().int().nonnegative(),
  retrievalMode: z.enum(marketplaceRetrievalModes),
  semanticModelVersion: z.string().trim().min(1).max(128).nullable()
});

export type MarketplaceReadSourceMeta = z.infer<typeof marketplaceReadSourceMetaSchema>;

export const marketplaceAgentReadModelSchema = z.object({
  id: z.string().trim().min(1).max(400),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(160),
  tagline: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(2_000),
  category: agentCategorySchema,
  protocols: z.array(z.string().trim().min(1).max(128)).max(64),
  stateAxes: agentStateAxesSchema,
  identity: erc8004IdentitySchema,
  ownerAddress: evmAddressSchema.nullable(),
  agentWallet: evmAddressSchema.nullable(),
  services: z.array(advertisedServiceSchema).max(128),
  capabilityManifest: capabilityManifestSchema,
  eligibility: marketplaceEligibilityResultSchema,
  freshness: dataFreshnessSchema,
  pricing: pricingSchema,
  authority: authoritySummarySchema,
  currentData: currentDataSchema,
  health: marketplaceEndpointHealthSchema,
  metrics: marketplaceMetricsSchema,
  serviceEvidence: z.array(serviceEvidenceSchema).max(128),
  evidence: evidenceSummarySchema,
  activation: activationSummarySchema,
  scoreExplanation: marketplaceScoreExplanationSchema,
  dataProvenance: marketplaceDataProvenanceSchema
});

export type MarketplaceAgentReadModel = z.infer<typeof marketplaceAgentReadModelSchema>;

/**
 * A hard-filtered record is still useful to a reader: it explains why a
 * candidate did not reach ranking. The core package intentionally returns a
 * compact exclusion shape, so the web contract keeps that explanation
 * explicit without pretending it is an eligible listing card.
 */
export const marketplaceExcludedReadModelSchema = z.object({
  id: z.string().trim().min(1).max(400),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(160),
  category: agentCategorySchema,
  reasons: marketplaceEligibilityResultSchema.shape.reasons
});

export type MarketplaceExcludedReadModel = z.infer<typeof marketplaceExcludedReadModelSchema>;

export const marketplaceSearchInputSchema = z.object({
  query: z.string().trim().max(120).optional(),
  category: agentCategorySchema.optional(),
  chainId: z.coerce.number().int().positive().optional(),
  origin: z.enum(["discovered", "manual_import", "created"]).optional(),
  verification: z.enum(["pending", "verified", "degraded", "rejected"]).optional(),
  runtime: z.enum(["live", "unavailable", "paused"]).optional(),
  protocol: z.string().trim().max(128).optional(),
  freshness: z.enum(["fresh", "stale", "unknown"]).optional(),
  sort: z.enum(["relevance", "freshness", "score"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  preview: z.enum(marketplacePreviewStates).optional()
});

export type MarketplaceSearchInput = z.infer<typeof marketplaceSearchInputSchema>;

const searchSelectionSchema = z.object({
  query: z.string(),
  category: z.string().nullable(),
  chainId: z.number().int().positive().nullable(),
  origin: z.string().nullable(),
  verification: z.string().nullable(),
  runtime: z.string().nullable(),
  protocol: z.string().nullable(),
  freshness: z.string().nullable(),
  sort: z.string()
});

export const marketplaceSearchResponseSchema = z.object({
  contractVersion: z.literal(marketplaceReadContractVersion),
  status: z.enum(marketplaceReadStatuses),
  mode: z.enum(marketplaceDataModes),
  dataLabel: z.string().trim().min(1).max(160),
  notice: z.string().trim().min(1).max(500),
  agents: z.array(marketplaceAgentReadModelSchema),
  excluded: z.array(marketplaceExcludedReadModelSchema),
  total: z.number().int().nonnegative(),
  selection: searchSelectionSchema,
  /** Source and retrieval status are available even when no cards qualify. */
  meta: marketplaceReadSourceMetaSchema.nullable(),
  error: errorEnvelopeSchema.nullable()
});

export type MarketplaceSearchResponse = z.infer<typeof marketplaceSearchResponseSchema>;

export const marketplaceAgentReadResponseSchema = z.object({
  contractVersion: z.literal(marketplaceReadContractVersion),
  status: z.enum(marketplaceReadStatuses),
  mode: z.enum(marketplaceDataModes),
  dataLabel: z.string().trim().min(1).max(160),
  notice: z.string().trim().min(1).max(500),
  /** Source metadata remains available for empty/degraded detail responses. */
  meta: marketplaceReadSourceMetaSchema.nullable(),
  agent: marketplaceAgentReadModelSchema.nullable(),
  error: errorEnvelopeSchema.nullable()
});

export type MarketplaceAgentReadResponse = z.infer<typeof marketplaceAgentReadResponseSchema>;

export interface MarketplaceReadClient {
  search(input?: MarketplaceSearchInput): Promise<MarketplaceSearchResponse>;
  getAgent(slug: string, input?: Partial<Pick<MarketplaceSearchInput, "preview">>): Promise<MarketplaceAgentReadResponse>;
}

function querySelection(input: MarketplaceSearchInput): MarketplaceSearchResponse["selection"] {
  return {
    query: input.query ?? "",
    category: input.category ?? null,
    chainId: input.chainId ?? null,
    origin: input.origin ?? null,
    verification: input.verification ?? null,
    runtime: input.runtime ?? null,
    protocol: input.protocol ?? null,
    freshness: input.freshness ?? null,
    sort: input.sort ?? "relevance"
  };
}

function dataLabel(mode: MarketplaceDataMode): string {
  switch (mode) {
    case "live":
      return "Connected read model";
    case "fixture":
      return "Development fixture";
    case "degraded":
      return "Degraded preview";
    case "empty":
      return "Read model empty";
    case "error":
      return "Read model unavailable";
  }
}

function configuredRemoteMarketplaceApiUrl(): string {
  const value = process.env.MARKETPLACE_API_URL?.trim();
  if (!value) {
    throw new AppError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      safeMessage: "Live marketplace page forwarding requires an explicit API URL; refusing a self-referential default.",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_configuration"
    });
  }
  return value;
}

/**
 * The API route is the local database boundary. A page must not call its own
 * loopback origin through the forwarding adapter: use the server-only local
 * reader instead. Remote HTTPS read APIs remain valid forwarding targets.
 */
export function isSelfReferentialMarketplaceApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) return false;
    const configuredPort = process.env.PORT?.trim() || "3000";
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    return (url.port || defaultPort) === configuredPort;
  } catch {
    return false;
  }
}

function createStateError(options: {
  readonly code: string;
  readonly message: string;
  readonly nextAction: string;
  readonly retriable?: boolean;
}): ErrorEnvelope {
  return new AppError({
    code: options.code,
    safeMessage: options.message,
    requestId: "req_web_marketplace_read",
    retriable: options.retriable ?? false,
    nextAction: options.nextAction
  }).toEnvelope();
}

function sourceMode(mode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded" | "empty">):
  Extract<MarketplaceDataMode, "fixture" | "live" | "degraded"> {
  return mode === "empty" ? "live" : mode;
}

function modeFromSourceMeta(
  meta: CoreMarketplaceSearchResponse["meta"],
  configuredMode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded" | "empty">
): Extract<MarketplaceDataMode, "fixture" | "live" | "degraded" | "empty"> {
  if (meta.sourceStatus === "degraded" || (meta.sourceStatus === "empty" && meta.warning !== null)) {
    return "degraded";
  }
  if (meta.sourceStatus === "empty") {
    return "empty";
  }
  return configuredMode;
}

function mapSourceMeta(meta: CoreMarketplaceSearchResponse["meta"]): MarketplaceReadSourceMeta {
  return marketplaceReadSourceMetaSchema.parse({
    sourceStatus: meta.sourceStatus,
    sourceName: meta.sourceName,
    sourceKind: meta.sourceKind,
    warning: meta.warning,
    refreshedAt: meta.refreshedAt,
    fixtureCount: meta.fixtureCount,
    retrievalMode: meta.retrievalMode,
    semanticModelVersion: meta.semanticModelVersion
  });
}

function coreTagline(description: string): string {
  const firstSentence = description.split(/[.!?](?:\s|$)/u)[0]?.trim() ?? description;
  return firstSentence.length <= 240 ? firstSentence : `${firstSentence.slice(0, 237).trimEnd()}…`;
}

function freshnessLabel(card: CoreMarketplaceAgentCard): string {
  if (card.dataFreshness.status === "fresh") {
    return "Fresh read observed";
  }
  if (card.dataFreshness.status === "stale") {
    return "Stale read";
  }
  return "Freshness unknown";
}

function formatAtomicAmount(amount: string | null, decimals: number, symbol: string | null): string {
  if (amount === null) {
    return "Not observed";
  }
  const suffix = symbol ?? "atomic units";
  if (decimals === 0) {
    return `${amount} ${suffix}`;
  }
  const padded = amount.padStart(decimals + 1, "0");
  const splitAt = padded.length - decimals;
  const whole = padded.slice(0, splitAt);
  const fraction = padded.slice(splitAt).replace(/0+$/u, "");
  return `${fraction.length > 0 ? `${whole}.${fraction}` : whole} ${suffix}`;
}

function mapPricing(card: CoreMarketplaceAgentCard): MarketplaceAgentReadModel["pricing"] {
  const { pricing } = card;
  const amountAtomic = pricing.minAtomic ?? pricing.maxAtomic;
  const amountLabel = pricing.model === "free"
    ? "Free"
    : formatAtomicAmount(amountAtomic, pricing.decimals, pricing.tokenSymbol);
  const rangeLabel = pricing.minAtomic !== null && pricing.maxAtomic !== null && pricing.minAtomic !== pricing.maxAtomic
    ? `${formatAtomicAmount(pricing.minAtomic, pricing.decimals, pricing.tokenSymbol)} – ${formatAtomicAmount(pricing.maxAtomic, pricing.decimals, pricing.tokenSymbol)}`
    : amountLabel;
  const activationMethod = card.activation.method === "manual" ? "external" : card.activation.method;
  return {
    availability: pricing.model === "unavailable"
      ? "unavailable"
      : pricing.model === "quote" || (pricing.model !== "free" && amountAtomic === null)
        ? "unknown"
        : "available",
    activationMethod,
    label: `${pricing.model.replaceAll("_", " ")} · ${rangeLabel}`,
    currency: pricing.tokenSymbol,
    amountAtomic,
    explanation: card.fixture !== null
      ? "This price is a labelled development fixture. It is not a quote and cannot be used to trigger payment."
      : "This is an observed marketplace price field. Activation and payment remain separately disabled."
  };
}

function mapAuthority(card: CoreMarketplaceAgentCard): MarketplaceAgentReadModel["authority"] {
  const { authority } = card;
  const status = card.state.authorityStatus;
  return {
    status,
    summary: card.fixture !== null
      ? "Authority fields are fixture-shaped and do not grant BNBEra custody or execution rights."
      : status === "active"
        ? "An authority observation is present; this read-only surface does not create or use it."
        : "No active execution authority is available to this read-only surface.",
    executionWallet: authority.executionWallet,
    provider: authority.walletProvider,
    expiry: authority.expiresAt,
    spendCap: authority.spendLimitAtomic === null
      ? null
      : `${authority.spendLimitAtomic} atomic units${authority.spendAsset ? ` · ${authority.spendAsset}` : ""}`
  };
}

function mapEvidence(card: CoreMarketplaceAgentCard): MarketplaceAgentReadModel["evidence"] {
  if (card.fixture !== null) {
    return {
      status: "unavailable",
      summary: "Execution evidence is labelled fixture data; no live execution or publication proof is claimed.",
      ipfsUri: null,
      greenfieldUri: null,
      lastVerifiedAt: null
    };
  }
  const status = card.executionEvidence.status === "verified"
    ? "verified"
    : card.executionEvidence.status === "unavailable"
      ? "unavailable"
      : "pending";
  return {
    status,
    summary: status === "verified"
      ? "The read model includes an execution-evidence observation. Publication integrity remains a separate gate."
      : status === "unavailable"
        ? "No execution-evidence record is available in this read model."
        : "Execution evidence is pending verification in this read model.",
    ipfsUri: null,
    greenfieldUri: null,
    lastVerifiedAt: card.executionEvidence.lastVerifiedAt
  };
}

function mapActivation(card: CoreMarketplaceAgentCard): MarketplaceAgentReadModel["activation"] {
  const method = card.activation.method === "manual" ? "external" : card.activation.method;
  return {
    enabled: card.activation.available,
    availability: card.activation.available ? "available" : "unavailable",
    method,
    title: card.activation.available ? "Activation available" : "Activation unavailable",
    reason: card.activation.message,
    nextAction: card.activation.available ? "review_activation_terms" : "inspect_read_only_detail"
  };
}

function mapProvenance(
  card: CoreMarketplaceAgentCard,
  mode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded">,
  refreshedAt: string | null = null
): MarketplaceAgentReadModel["dataProvenance"] {
  const observedProvenance = {
    sourceKind: card.provenance.sourceKind,
    sources: card.provenance.sources,
    identityRead: card.provenance.identityRead,
    refreshedAt
  };
  if (card.fixture !== null || card.provenance.fixture !== null) {
    return {
      mode: "fixture",
      label: card.fixture?.label ?? card.provenance.fixture?.label ?? "Development fixture",
      details: "Synthetic records are present for interface verification only; registry, endpoint, health, execution, payment, and evidence proof are not claimed.",
      ...observedProvenance
    };
  }
  if (mode === "degraded") {
    return {
      mode,
      label: "Degraded upstream read",
      details: "The upstream read model is degraded. Fields are shown for inspection and must not be treated as live proof; endpoint health remains a separate observation.",
      ...observedProvenance
    };
  }
  return {
    mode: "live",
    label: "Connected read model",
    details: "This record came through the configured database/read-model source. Connected read-model mode does not assert that the external agent endpoint is healthy; inspect the endpoint probe, timestamps, and independent state fields before acting.",
    ...observedProvenance
  };
}

function mapCard(
  card: CoreMarketplaceAgentCard,
  mode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded">,
  refreshedAt: string | null = null
): MarketplaceAgentReadModel {
  const freshnessStatus = card.dataFreshness.status;
  const metrics = card.metrics ?? {
    uptime: {
      status: "unknown" as const,
      windowSeconds: null,
      observedFrom: null,
      observedTo: null,
      attemptedChecks: 0,
      successfulChecks: 0,
      successRatio: null,
      source: null
    },
    reviews: { status: "unavailable" as const, count: null, averageScore: null, source: null, observedAt: null },
    completedJobs: { status: "unavailable" as const, completedCount: null, source: null, observedAt: null },
    lastResult: { status: "unavailable" as const, summary: null, reference: null, source: null, observedAt: null },
    currentData: {
      status: "unavailable" as const,
      summary: "No current data observation is available.",
      observedAt: null,
      source: null,
      items: []
    }
  };
  return marketplaceAgentReadModelSchema.parse({
    id: card.identityKey,
    slug: card.slug,
    name: card.name,
    tagline: coreTagline(card.description),
    description: card.description,
    category: card.category,
    protocols: card.supportedProtocols,
    stateAxes: card.state,
    identity: card.identity,
    ownerAddress: card.ownerAddress,
    agentWallet: card.agentWallet,
    services: card.services,
    capabilityManifest: card.capabilities,
    eligibility: card.eligibility,
    scoreExplanation: card.scoreExplanation,
    freshness: {
      status: freshnessStatus,
      label: freshnessLabel(card),
      observedAt: card.dataFreshness.observedAt,
      blockNumber: card.provenance.identityRead.observedBlock,
      source: card.dataFreshness.source ?? card.health.source ?? "marketplace read model"
    },
    health: card.health,
    metrics,
    serviceEvidence: card.serviceEvidence ?? [],
    pricing: mapPricing(card),
    authority: mapAuthority(card),
    currentData: metrics.currentData,
    evidence: mapEvidence(card),
    activation: mapActivation(card),
    dataProvenance: mapProvenance(card, mode, refreshedAt)
  });
}

export function mapMarketplaceDetailResponse(
  detail: CoreMarketplaceAgentDetail,
  mode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded">,
  refreshedAt: string | null = null
): MarketplaceAgentReadModel {
  return mapCard(detail, mode, refreshedAt);
}

function selectionMatches(agent: MarketplaceAgentReadModel, input: MarketplaceSearchInput): boolean {
  if (input.category && agent.category !== input.category) {
    return false;
  }
  if (input.chainId && agent.identity.chainId !== input.chainId) {
    return false;
  }
  if (input.origin && agent.stateAxes.originType !== input.origin) {
    return false;
  }
  if (input.verification && agent.stateAxes.verificationStatus !== input.verification) {
    return false;
  }
  if (input.runtime && agent.stateAxes.runtimeStatus !== input.runtime) {
    return false;
  }
  if (input.freshness && agent.freshness.status !== input.freshness) {
    return false;
  }
  if (input.protocol && !agent.protocols.some((protocol) => protocol.toLowerCase() === input.protocol?.toLowerCase())) {
    return false;
  }
  if (input.query) {
    const searchableText = [
      agent.name,
      agent.tagline,
      agent.description,
      agent.category,
      ...agent.protocols,
      ...agent.capabilityManifest.capabilities.flatMap((capability) => [capability.id, capability.description])
    ].join(" ").toLowerCase();
    if (!searchableText.includes(input.query.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function sortAgents(agents: MarketplaceAgentReadModel[], input: MarketplaceSearchInput): MarketplaceAgentReadModel[] {
  const sorted = [...agents];
  sorted.sort((left, right) => {
    if (input.sort === "freshness") {
      const freshnessRank = { fresh: 3, stale: 2, unknown: 1 } as const;
      const difference = freshnessRank[right.freshness.status] - freshnessRank[left.freshness.status];
      if (difference !== 0) {
        return difference;
      }
    }
    if (input.sort === "score" || input.sort === "relevance") {
      const scoreDifference = (right.eligibility.score ?? -1) - (left.eligibility.score ?? -1);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
    }
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
  return sorted;
}

function localNotice(mode: MarketplaceDataMode, total: number, excluded = 0, warning: string | null = null): string {
  const appendWarning = (notice: string): string => warning === null ? notice : `${notice} ${warning}`.slice(0, 500);
  if (mode === "fixture") {
    return appendWarning("Bounded development records are shown for interface verification. They are not registry, endpoint, health, execution, payment, or evidence proof.");
  }
  if (mode === "degraded") {
    return appendWarning("The upstream read model is degraded. Records remain visible with a degraded label; no live claim is made.");
  }
  if (mode === "empty" && total === 0) {
    return appendWarning(excluded > 0
      ? "No eligible records match this view. Candidates excluded by hard eligibility are shown below with their reasons."
      : "No marketplace records are available yet. Fixture data is disabled unless explicitly selected in a non-production environment.");
  }
  if (total === 0 && excluded > 0) {
    return appendWarning("No eligible records match the current filters. Candidates excluded before ranking are shown below with their reasons.");
  }
  return appendWarning(total === 0 ? "No records match the current filters." : "The connected marketplace read model returned these records.");
}

export function marketplaceSearchErrorResponse(
  input: MarketplaceSearchInput,
  error: ErrorEnvelope,
  notice = "The marketplace read model returned a structured error."
): MarketplaceSearchResponse {
  return marketplaceSearchResponseSchema.parse({
    contractVersion: marketplaceReadContractVersion,
    status: "error",
    mode: "error",
    dataLabel: dataLabel("error"),
    notice,
    agents: [],
    excluded: [],
    total: 0,
    selection: querySelection(input),
    meta: null,
    error
  });
}

export function marketplaceDetailErrorResponse(
  error: ErrorEnvelope,
  notice = "The agent detail read returned a structured error."
): MarketplaceAgentReadResponse {
  return marketplaceAgentReadResponseSchema.parse({
    contractVersion: marketplaceReadContractVersion,
    status: "error",
    mode: "error",
    dataLabel: dataLabel("error"),
    notice,
    meta: null,
    agent: null,
    error
  });
}

async function localService(mode: Extract<MarketplaceDataMode, "fixture" | "degraded" | "empty">): Promise<MarketplaceReadService> {
  if (mode === "empty") {
    return new MarketplaceReadService(new InMemoryMarketplaceSource([], {
      sourceName: "empty-marketplace-source"
    }));
  }
  // Keep synthetic supply behind a runtime non-production branch. This makes
  // the production path fail closed even when the preview bundle is present.
  const { developmentFixtureListings, developmentFixtureLabel } = await import("@bnbera/marketplace");
  return new MarketplaceReadService(new InMemoryMarketplaceSource(developmentFixtureListings, {
    status: mode === "degraded" ? "degraded" : "healthy",
    sourceName: mode === "degraded" ? "degraded-development-fixtures" : "development-fixtures",
    warning: mode === "degraded"
      ? `Upstream read degraded; ${developmentFixtureLabel} records are shown for preview only.`
      : null
  }));
}

async function localSearch(
  input: MarketplaceSearchInput,
  mode: Extract<MarketplaceDataMode, "fixture" | "degraded" | "empty">
): Promise<MarketplaceSearchResponse> {
  try {
    const service = await localService(mode);
    const result = await service.safeSearch({
      query: input.query ?? "",
      ...(input.category ? { category: input.category } : {}),
      ...(input.chainId ? { chainId: input.chainId } : {}),
      ...(input.protocol ? { requiredProtocols: [input.protocol] } : {}),
      ...(input.freshness === "fresh" ? { requireFreshData: true } : {})
    });
    if (!result.ok) {
      return marketplaceSearchErrorResponse(input, result.error, "The marketplace source could not be read safely.");
    }
    return mapMarketplaceSearchResponse(input, result.value, mode);
  } catch (_error) {
    return marketplaceSearchErrorResponse(input, createStateError({
      code: "MARKETPLACE_SOURCE_UNAVAILABLE",
      message: "The marketplace source could not be read safely.",
      retriable: true,
      nextAction: "retry_read"
    }), "The marketplace source could not be read safely.");
  }
}

export function mapMarketplaceSearchResponse(
  input: MarketplaceSearchInput,
  coreResponse: CoreMarketplaceSearchResponse,
  configuredMode: Extract<MarketplaceDataMode, "fixture" | "live" | "degraded" | "empty">
): MarketplaceSearchResponse {
  // The core service reports an all-withheld projection as `empty` because it
  // has no records to return. Preserve the source warning so the web contract
  // does not turn malformed ingestion rows into an apparently healthy empty
  // database.
  const effectiveMode = modeFromSourceMeta(coreResponse.meta, configuredMode);
  const mapped = coreResponse.results
    .map((card) => mapCard(card, sourceMode(effectiveMode), coreResponse.meta.refreshedAt))
    .filter((agent) => selectionMatches(agent, input));
  // Origin/verification/runtime/freshness are web-side presentation filters;
  // the core exclusion shape does not include those axes, so do not surface
  // exclusions that could be misleading after one of those filters is set.
  const canShowCoreExclusions = !input.origin && !input.verification && !input.runtime && !input.freshness;
  const excluded = canShowCoreExclusions
    ? coreResponse.excluded.map((entry) => marketplaceExcludedReadModelSchema.parse({
        id: entry.identityKey,
        slug: entry.slug,
        name: entry.name,
        category: entry.category,
        reasons: entry.reasons
      }))
    : [];
  const sorted = sortAgents(mapped, input);
  const agents = sorted.slice(0, input.limit ?? 12);
  const status: MarketplaceReadStatus = effectiveMode === "degraded"
    ? "degraded"
    : agents.length > 0 || excluded.length > 0
      ? "ready"
      : "empty";
  const mode = effectiveMode;
  return marketplaceSearchResponseSchema.parse({
    contractVersion: marketplaceReadContractVersion,
    status,
    mode,
    dataLabel: dataLabel(mode),
    notice: localNotice(mode, agents.length, excluded.length, coreResponse.meta.warning),
    agents,
    excluded,
    total: sorted.length,
    selection: querySelection(input),
    meta: mapSourceMeta(coreResponse.meta),
    error: null
  });
}

function previewResponse(input: MarketplaceSearchInput, preview: MarketplacePreviewState): Promise<MarketplaceSearchResponse> {
  if (preview === "loading") {
    return Promise.resolve(marketplaceSearchResponseSchema.parse({
      contractVersion: marketplaceReadContractVersion,
      status: "loading",
      mode: "fixture",
      dataLabel: "Loading state preview",
      notice: "The interface is waiting for the marketplace read model. This is a deterministic state preview.",
      agents: [],
      excluded: [],
      total: 0,
      selection: querySelection(input),
      meta: null,
      error: null
    }));
  }
  if (preview === "empty") {
    return localSearch(input, "empty");
  }
  if (preview === "degraded") {
    return localSearch(input, "degraded");
  }
  return Promise.resolve(marketplaceSearchErrorResponse(input, createStateError({
    code: "MARKETPLACE_READ_UNAVAILABLE",
    message: "The marketplace read model is unavailable in this state preview.",
    retriable: true,
    nextAction: "retry_read"
  }), "The marketplace read model returned a structured error. No HTML error page is parsed as data."));
}

export function configuredMarketplaceDataMode(): MarketplaceDataMode {
  const configured = process.env.MARKETPLACE_DATA_MODE?.trim().toLowerCase();
  if (configured && (marketplaceDataModes as readonly string[]).includes(configured)) {
    if (process.env.NODE_ENV === "production" && (configured === "fixture" || configured === "degraded")) {
      return "empty";
    }
    return configured as MarketplaceDataMode;
  }
  if (configured) {
    return "error";
  }
  if (process.env.MARKETPLACE_API_URL?.trim()) {
    return "live";
  }
  return process.env.NODE_ENV === "production" ? "empty" : "fixture";
}

function invalidConfigurationResponse(input: MarketplaceSearchInput): MarketplaceSearchResponse {
  return marketplaceSearchErrorResponse(input, createStateError({
    code: "MARKETPLACE_CONFIGURATION_INVALID",
    message: "Marketplace read mode is invalid; configure a supported read-model mode.",
    nextAction: "check_configuration"
  }), "The marketplace data mode is invalid. The web surface fails closed until the read model is configured.");
}

function marketplaceEndpoint(baseUrl: string, suffix = ""): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new AppError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      safeMessage: "The live marketplace API URL must be an absolute HTTP(S) URL.",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_configuration",
      cause
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      safeMessage: "The live marketplace API URL must use HTTP(S).",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_configuration"
    });
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new AppError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      safeMessage: "The live marketplace API URL cannot include credentials, a query, or a fragment.",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_configuration"
    });
  }
  if (isSelfReferentialMarketplaceApiUrl(baseUrl)) {
    throw new AppError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      safeMessage: "The live marketplace API URL points at this application; use the local server reader instead of forwarding.",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_configuration"
    });
  }
  const normalizedPath = url.pathname.replace(/\/+$/u, "");
  if (!normalizedPath.endsWith("/marketplace")) {
    url.pathname = `${normalizedPath}/marketplace`;
  } else {
    url.pathname = normalizedPath;
  }
  if (suffix) {
    url.pathname = `${url.pathname}/${encodeURIComponent(suffix)}`;
  }
  return url;
}

function appendSearch(url: URL, input: MarketplaceSearchInput): void {
  const entries: Array<[string, string | undefined]> = [
    ["q", input.query],
    ["category", input.category],
    ["chainId", input.chainId?.toString()],
    ["origin", input.origin],
    ["verification", input.verification],
    ["runtime", input.runtime],
    ["protocol", input.protocol],
    ["freshness", input.freshness],
    ["sort", input.sort],
    ["limit", input.limit?.toString()]
  ];
  for (const [key, value] of entries) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
}

async function remoteJson(url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" }
    });
  } catch (cause) {
    throw new AppError({
      code: "MARKETPLACE_READ_UNAVAILABLE",
      safeMessage: "The connected marketplace read model could not be reached.",
      requestId: "req_web_marketplace_read",
      retriable: true,
      nextAction: "retry_read",
      cause
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AppError({
      code: "MARKETPLACE_RESPONSE_INVALID",
      safeMessage: "The connected marketplace returned a non-JSON response.",
      requestId: "req_web_marketplace_read",
      retriable: false,
      nextAction: "check_read_model",
      cause
    });
  }
  if (!response.ok) {
    throw new AppError({
      code: "MARKETPLACE_READ_FAILED",
      safeMessage: "The connected marketplace read model returned an error.",
      requestId: "req_web_marketplace_read",
      retriable: response.status >= 500,
      nextAction: response.status >= 500 ? "retry_read" : "check_read_model",
      cause: payload
    });
  }
  return payload;
}

async function remoteSearch(input: MarketplaceSearchInput): Promise<MarketplaceSearchResponse> {
  try {
    const url = marketplaceEndpoint(configuredRemoteMarketplaceApiUrl());
    appendSearch(url, input);
    return marketplaceSearchResponseSchema.parse(await remoteJson(url));
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: "MARKETPLACE_RESPONSE_INVALID",
          safeMessage: "The connected marketplace response did not match the read contract.",
          requestId: "req_web_marketplace_read",
          nextAction: "check_read_model",
          cause: error
        });
    return marketplaceSearchErrorResponse(input, appError.toEnvelope(), "The read model response could not be validated against the web adapter boundary.");
  }
}

async function remoteAgent(slug: string): Promise<MarketplaceAgentReadResponse> {
  try {
    const url = marketplaceEndpoint(configuredRemoteMarketplaceApiUrl(), slug);
    return marketplaceAgentReadResponseSchema.parse(await remoteJson(url));
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: "MARKETPLACE_RESPONSE_INVALID",
          safeMessage: "The connected marketplace detail response did not match the read contract.",
          requestId: "req_web_marketplace_detail",
          nextAction: "check_read_model",
          cause: error
        });
    return marketplaceDetailErrorResponse(appError.toEnvelope(), "The agent detail response could not be validated against the web adapter boundary.");
  }
}

export async function readMarketplace(input: Partial<MarketplaceSearchInput> = {}): Promise<MarketplaceSearchResponse> {
  const parsedInput = marketplaceSearchInputSchema.parse(input);
  if (parsedInput.preview && process.env.NODE_ENV !== "production") {
    return previewResponse(parsedInput, parsedInput.preview);
  }

  const mode = configuredMarketplaceDataMode();
  if (mode === "live") {
    return remoteSearch(parsedInput);
  }
  if (mode === "error") {
    return invalidConfigurationResponse(parsedInput);
  }
  if (mode === "empty") {
    return localSearch(parsedInput, "empty");
  }
  return localSearch(parsedInput, mode);
}

/** API routes use the local source directly so an API URL cannot recurse into itself. */
export async function readMarketplaceApi(input: Partial<MarketplaceSearchInput> = {}): Promise<MarketplaceSearchResponse> {
  const parsedInput = marketplaceSearchInputSchema.parse(input);
  if (parsedInput.preview && process.env.NODE_ENV !== "production") {
    return previewResponse(parsedInput, parsedInput.preview);
  }
  const mode = configuredMarketplaceDataMode();
  if (mode === "error") {
    return invalidConfigurationResponse(parsedInput);
  }
  if (mode === "live") {
    return marketplaceSearchErrorResponse(parsedInput, createStateError({
      code: "MARKETPLACE_LIVE_SOURCE_UNAVAILABLE",
      message: "The configured live marketplace source is not available to this adapter; no fixture fallback is permitted.",
      retriable: true,
      nextAction: "check_read_model"
    }), "The configured live marketplace source could not be read. No development fixtures were substituted.");
  }
  if (mode === "empty") {
    return localSearch(parsedInput, "empty");
  }
  return localSearch(parsedInput, mode);
}

async function localAgent(
  slug: string,
  mode: Extract<MarketplaceDataMode, "fixture" | "degraded" | "empty">
): Promise<MarketplaceAgentReadResponse> {
  try {
    const service = await localService(mode);
    const result = await service.readAgent(slug);
    const effectiveMode = modeFromSourceMeta(result.meta, mode);
    const mappedMeta = mapSourceMeta(result.meta);
    if (result.agent === null) {
      return marketplaceAgentReadResponseSchema.parse({
        contractVersion: marketplaceReadContractVersion,
        status: effectiveMode === "degraded" ? "degraded" : "empty",
        mode: effectiveMode,
        dataLabel: dataLabel(effectiveMode),
        notice: effectiveMode === "degraded"
          ? localNotice("degraded", 0, 0, result.meta.warning)
          : "This agent is not present in the current marketplace read model.",
        meta: mappedMeta,
        agent: null,
        error: null
      });
    }
    const agent = mapMarketplaceDetailResponse(
      result.agent.agent,
      sourceMode(effectiveMode),
      result.meta.refreshedAt
    );
    return marketplaceAgentReadResponseSchema.parse({
      contractVersion: marketplaceReadContractVersion,
      status: effectiveMode === "degraded" ? "degraded" : "ready",
      mode: effectiveMode,
      dataLabel: dataLabel(effectiveMode),
      notice: localNotice(effectiveMode, 1, 0, result.meta.warning),
      meta: mappedMeta,
      agent,
      error: null
    });
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError({
          code: "MARKETPLACE_SOURCE_UNAVAILABLE",
          safeMessage: "The marketplace agent detail could not be read safely.",
          requestId: "req_web_marketplace_detail",
          retriable: true,
          nextAction: "retry_read",
          cause: error
        });
    return marketplaceDetailErrorResponse(appError.toEnvelope(), "The marketplace agent detail could not be read safely.");
  }
}

export async function readMarketplaceAgent(
  slug: string,
  input: Partial<Pick<MarketplaceSearchInput, "preview">> = {}
): Promise<MarketplaceAgentReadResponse> {
  const normalizedSlug = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(slug);
  const preview = input.preview;
  if (preview && process.env.NODE_ENV !== "production") {
    if (preview === "loading") {
      return marketplaceAgentReadResponseSchema.parse({
        contractVersion: marketplaceReadContractVersion,
        status: "loading",
        mode: "fixture",
        dataLabel: "Loading state preview",
        notice: "The detail panel is waiting for the marketplace read model.",
        meta: null,
        agent: null,
        error: null
      });
    }
    if (preview === "error") {
      return marketplaceDetailErrorResponse(createStateError({
        code: "MARKETPLACE_DETAIL_UNAVAILABLE",
        message: "This detail state is unavailable in the preview.",
        retriable: true,
        nextAction: "retry_read"
      }), "The detail read returned a structured error. No HTML error page is parsed as data.");
    }
    if (preview === "empty") {
      return marketplaceAgentReadResponseSchema.parse({
        contractVersion: marketplaceReadContractVersion,
        status: "empty",
        mode: "empty",
        dataLabel: "Empty state preview",
        notice: "No agent detail is available in this state preview.",
        meta: null,
        agent: null,
        error: null
      });
    }
    return localAgent(normalizedSlug, "degraded");
  }

  const mode = configuredMarketplaceDataMode();
  if (mode === "live") {
    return remoteAgent(normalizedSlug);
  }
  if (mode === "error") {
    return marketplaceDetailErrorResponse(createStateError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      message: "Marketplace read mode is invalid; configure a supported read-model mode.",
      nextAction: "check_configuration"
    }), "The marketplace data mode is invalid. The detail surface fails closed.");
  }
  if (mode === "empty") {
    return localAgent(normalizedSlug, "empty");
  }
  return localAgent(normalizedSlug, mode);
}

export async function readMarketplaceAgentApi(
  slug: string,
  input: Partial<Pick<MarketplaceSearchInput, "preview">> = {}
): Promise<MarketplaceAgentReadResponse> {
  const normalizedSlug = z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(slug);
  if (input.preview && process.env.NODE_ENV !== "production") {
    return readMarketplaceAgent(normalizedSlug, input);
  }
  const mode = configuredMarketplaceDataMode();
  if (mode === "live") {
    return marketplaceDetailErrorResponse(createStateError({
      code: "MARKETPLACE_LIVE_SOURCE_UNAVAILABLE",
      message: "The configured live marketplace source is not available to this adapter; no fixture fallback is permitted.",
      retriable: true,
      nextAction: "check_read_model"
    }), "The configured live marketplace source could not be read. No development fixtures were substituted.");
  }
  if (mode === "error") {
    return marketplaceDetailErrorResponse(createStateError({
      code: "MARKETPLACE_CONFIGURATION_INVALID",
      message: "Marketplace read mode is invalid; configure a supported read-model mode.",
      nextAction: "check_configuration"
    }), "The marketplace data mode is invalid. The detail surface fails closed.");
  }
  const localMode: Extract<MarketplaceDataMode, "fixture" | "degraded" | "empty"> =
    mode === "empty" || process.env.NODE_ENV === "production"
      ? "empty"
      : mode;
  return localAgent(normalizedSlug, localMode);
}

export function parseMarketplaceSearchParams(params: URLSearchParams): MarketplaceSearchInput {
  const values: Record<string, string> = {};
  const keys = ["q", "category", "chainId", "origin", "verification", "runtime", "protocol", "freshness", "sort", "limit", "preview"];
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value.length > 0) {
      values[key] = value;
    }
  }
  return marketplaceSearchInputSchema.parse({
    query: values.q,
    category: values.category,
    chainId: values.chainId,
    origin: values.origin,
    verification: values.verification,
    runtime: values.runtime,
    protocol: values.protocol,
    freshness: values.freshness,
    sort: values.sort,
    limit: values.limit,
    preview: values.preview
  });
}

export function parseMarketplacePageParams(
  params: Readonly<Record<string, string | string[] | undefined>>
): MarketplaceSearchInput {
  const search = new URLSearchParams();
  const pageKeys = ["q", "category", "chainId", "origin", "verification", "runtime", "protocol", "freshness", "sort", "limit", "preview"];
  for (const key of pageKeys) {
    const value = params[key];
    if (typeof value === "string") {
      search.set(key, value);
    } else if (Array.isArray(value) && value[0]) {
      search.set(key, value[0]);
    }
  }
  return parseMarketplaceSearchParams(search);
}

export function categoryFromSegment(segment: string): AgentCategory | null {
  const result = agentCategorySchema.safeParse(segment);
  return result.success && result.data !== "uncategorized" ? result.data : null;
}

export function statusAxisLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/gu, (letter) => letter.toUpperCase());
}

// Keep the historical contract import path available to server callers while
// keeping presentation helpers in a client-safe module. Client components
// must not traverse this module because it also owns the server read adapter.
export { categoryDescription, categoryLabel } from "./presentation";

export type MarketplaceStateFilters = {
  readonly verification?: VerificationStatus;
  readonly runtime?: RuntimeStatus;
  readonly origin?: OriginType;
};

export type MarketplaceReadContractTypes = {
  readonly identity: Erc8004Identity;
  readonly stateAxes: AgentStateAxes;
  readonly service: AdvertisedService;
  readonly capabilityManifest: CapabilityManifest;
  readonly eligibility: MarketplaceEligibilityResult;
};
