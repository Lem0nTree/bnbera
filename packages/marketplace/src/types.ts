import { z } from "zod";
import {
  advertisedServiceSchema,
  agentCategorySchema,
  agentStateAxesSchema,
  capabilityManifestSchema,
  chainIdSchema,
  discoverySources,
  erc8004IdentityKey,
  erc8004IdentitySchema,
  evmAddressSchema,
  marketplaceEligibilityResultSchema,
  scoreComponentsSchema,
  type AdvertisedService,
  type AgentCategory,
  type AgentStateAxes,
  type CapabilityManifest,
  type Erc8004Identity,
  type MarketplaceEligibilityResult
} from "@bnbera/domain";

const isoDateSchema = z.string().datetime({ offset: true });
const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/u, "Expected a 32-byte hexadecimal digest");
const atomicAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u, "Atomic amounts must be unsigned decimal strings");
const protocolNameSchema = z.string().trim().min(1).max(128);
const selectorSchema = z.string().regex(/^0x[0-9a-fA-F]{8}$/u, "Expected a 4-byte function selector");

export const marketplaceSourceStatuses = ["healthy", "degraded"] as const;
export type MarketplaceSourceStatus = (typeof marketplaceSourceStatuses)[number];

export const marketplaceResponseStatuses = ["healthy", "degraded", "empty"] as const;
export type MarketplaceResponseStatus = (typeof marketplaceResponseStatuses)[number];

/** How the read model assembled the returned candidate set. */
export const marketplaceRetrievalModes = ["deterministic", "hybrid", "fallback"] as const;
export type MarketplaceRetrievalMode = (typeof marketplaceRetrievalModes)[number];

export const marketplaceSourceKinds = ["ingestion", "fixture"] as const;
export type MarketplaceSourceKind = (typeof marketplaceSourceKinds)[number];

export const activationMethods = ["erc8183", "x402_b402", "manual", "none"] as const;
export type ActivationMethod = (typeof activationMethods)[number];

export const activationFeatureGate = "activation-commerce" as const;
export const activationDisabledReason = "OPTIONAL_RAIL_DISABLED" as const;

export const fixtureMetadataSchema = z.object({
  isFixture: z.literal(true),
  label: z.string().trim().min(1).max(240).regex(/fixture/i, "Fixture labels must say fixture")
});

export type FixtureMetadata = z.infer<typeof fixtureMetadataSchema>;

const identityReadProvenanceSchema = z
  .object({
    observedBlock: z.number().int().nonnegative().nullable(),
    observedBlockHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/u)
      .nullable(),
    readConsistency: z.enum(["finalized", "provisional"]).nullable(),
    observedAt: isoDateSchema
  })
  .superRefine((value, context) => {
    const present = [value.observedBlock, value.observedBlockHash, value.readConsistency].filter(
      (entry) => entry !== null
    ).length;
    if (present !== 0 && present !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity read provenance must contain all or none of block, hash, and consistency"
      });
    }
  });

export const marketplaceProvenanceSchema = z
  .object({
    sourceKind: z.enum(marketplaceSourceKinds),
    fixture: fixtureMetadataSchema.nullable(),
    sources: z.array(
      z.object({
        source: z.enum(discoverySources),
        sourceReference: z.string().trim().min(1).max(500),
        firstObservedAt: isoDateSchema,
        lastObservedAt: isoDateSchema,
        rawResponseDigest: digestSchema.nullable(),
        normalizedIngestionVersion: z.string().trim().min(1).max(64)
      })
    ).max(128),
    identityRead: identityReadProvenanceSchema
  })
  .superRefine((value, context) => {
    if (value.sourceKind === "fixture" && value.fixture === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixture"],
        message: "Fixture sources must include an unmistakable fixture label"
      });
    }
    if (value.sourceKind === "ingestion" && value.fixture !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixture"],
        message: "Ingestion sources cannot carry a fixture label"
      });
    }
  });

export type MarketplaceProvenance = z.infer<typeof marketplaceProvenanceSchema>;

export const marketplaceHealthSchema = z.object({
  endpointStatus: z.enum(["healthy", "unhealthy", "unknown"]),
  observedAt: isoDateSchema.nullable(),
  latencyMs: z.number().int().nonnegative().max(300_000).nullable(),
  source: z.string().trim().min(1).max(160).nullable()
});

export type MarketplaceHealth = z.infer<typeof marketplaceHealthSchema>;

const marketplaceMetricStatusSchema = z.enum(["available", "unavailable", "unknown"]);

/**
 * Probe history is deliberately described as observed samples, not as a
 * synthetic SLA. A null window/coverage means that the source did not have
 * enough persisted observations to make even a bounded availability claim.
 */
export const marketplaceUptimeSchema = z.object({
  status: z.enum(["observed", "unknown"]),
  /** Actual span between the oldest and newest persisted samples. */
  windowSeconds: z.number().int().nonnegative().nullable(),
  /** Configured monitoring horizon used only to describe coverage. */
  monitoringWindowSeconds: z.number().int().positive().nullable(),
  coverageSeconds: z.number().int().nonnegative().nullable(),
  coverageRatio: z.number().min(0).max(1).nullable(),
  observedFrom: isoDateSchema.nullable(),
  observedTo: isoDateSchema.nullable(),
  attemptedChecks: z.number().int().nonnegative(),
  successfulChecks: z.number().int().nonnegative(),
  successRatio: z.number().min(0).max(1).nullable(),
  source: z.string().trim().min(1).max(160).nullable()
}).superRefine((value, context) => {
  if (value.status === "observed" && (value.windowSeconds === null || value.monitoringWindowSeconds === null || value.coverageSeconds === null || value.coverageRatio === null || value.observedFrom === null || value.observedTo === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["observedFrom"],
      message: "Observed uptime samples must include a bounded observation window"
    });
  }
  if (value.coverageSeconds !== null && value.windowSeconds !== null && value.coverageSeconds !== value.windowSeconds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["coverageSeconds"],
      message: "Coverage must equal the actually observed sample span"
    });
  }
  if (value.successfulChecks > value.attemptedChecks) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["successfulChecks"],
      message: "Successful checks cannot exceed attempted checks"
    });
  }
  if (value.attemptedChecks === 0 && value.successRatio !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["successRatio"],
      message: "An empty sample cannot have a success ratio"
    });
  }
});

export type MarketplaceUptime = z.infer<typeof marketplaceUptimeSchema>;

export const marketplaceReviewMetricsSchema = z.object({
  status: marketplaceMetricStatusSchema,
  count: z.number().int().nonnegative().nullable(),
  averageScore: z.number().min(0).max(100).nullable(),
  source: z.string().trim().min(1).max(160).nullable(),
  observedAt: isoDateSchema.nullable()
});

export type MarketplaceReviewMetrics = z.infer<typeof marketplaceReviewMetricsSchema>;

export const marketplaceJobMetricsSchema = z.object({
  status: marketplaceMetricStatusSchema,
  completedCount: z.number().int().nonnegative().nullable(),
  source: z.string().trim().min(1).max(160).nullable(),
  observedAt: isoDateSchema.nullable()
});

export type MarketplaceJobMetrics = z.infer<typeof marketplaceJobMetricsSchema>;

export const marketplaceLastResultSchema = z.object({
  status: marketplaceMetricStatusSchema,
  summary: z.string().trim().min(1).max(500).nullable(),
  reference: z.string().trim().min(1).max(500).nullable(),
  source: z.string().trim().min(1).max(160).nullable(),
  observedAt: isoDateSchema.nullable()
});

export type MarketplaceLastResult = z.infer<typeof marketplaceLastResultSchema>;

export const marketplaceCurrentDataSchema = z.object({
  status: z.enum(["available", "stale", "unavailable"]),
  summary: z.string().trim().min(1).max(500),
  observedAt: isoDateSchema.nullable(),
  source: z.string().trim().min(1).max(160).nullable(),
  items: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(240),
    source: z.string().trim().min(1).max(160)
  })).max(12)
});

export type MarketplaceCurrentData = z.infer<typeof marketplaceCurrentDataSchema>;

export const marketplaceMetricsSchema = z.object({
  uptime: marketplaceUptimeSchema,
  reviews: marketplaceReviewMetricsSchema,
  completedJobs: marketplaceJobMetricsSchema,
  lastResult: marketplaceLastResultSchema,
  currentData: marketplaceCurrentDataSchema
});

export type MarketplaceMetrics = z.infer<typeof marketplaceMetricsSchema>;

const marketplaceSkillEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  /** Public A2A labels; these are advertised and not invocation evidence. */
  tags: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
  /** Public card extensions normalized alongside standard tags. */
  keywords: z.array(z.string().trim().min(1).max(128)).max(32).optional()
});

export const marketplaceServiceEvidenceSchema = z.object({
  kind: advertisedServiceSchema.shape.kind,
  advertisedUrl: z.string().url(),
  /** A2A Agent Card URL, distinct from the endpoint used to invoke it. */
  cardUrl: z.string().url().nullable(),
  invocationUrls: z.array(z.string().url()).max(32),
  advertisedSkills: z.array(marketplaceSkillEvidenceSchema).max(32),
  testedSkills: z.array(marketplaceSkillEvidenceSchema).max(32),
  testStatus: z.enum(["not_tested", "transport_only", "verified"]),
  testedAt: isoDateSchema.nullable()
});

export type MarketplaceServiceEvidence = z.infer<typeof marketplaceServiceEvidenceSchema>;

function unknownMarketplaceMetrics(): MarketplaceMetrics {
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

export const marketplaceFreshnessSchema = z.object({
  status: z.enum(["fresh", "stale", "unknown"]),
  observedAt: isoDateSchema.nullable(),
  source: z.string().trim().min(1).max(160).nullable(),
  maxAgeSeconds: z.number().int().positive().nullable()
}).superRefine((value, context) => {
  if (value.status === "fresh" && value.observedAt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["observedAt"],
      message: "Fresh data must include an observation timestamp"
    });
  }
});

export type MarketplaceFreshness = z.infer<typeof marketplaceFreshnessSchema>;

export const marketplacePricingSchema = z
  .object({
    model: z.enum(["free", "fixed", "range", "quote", "unavailable"]),
    network: chainIdSchema,
    tokenAddress: evmAddressSchema.nullable(),
    tokenSymbol: z.string().trim().min(1).max(32).nullable(),
    decimals: z.number().int().min(0).max(255),
    minAtomic: atomicAmountSchema.nullable(),
    maxAtomic: atomicAmountSchema.nullable(),
    observedAt: isoDateSchema.nullable()
  })
  .superRefine((value, context) => {
    if (value.minAtomic !== null && value.maxAtomic !== null) {
      try {
        if (BigInt(value.maxAtomic) < BigInt(value.minAtomic)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["maxAtomic"],
            message: "Maximum price cannot be below minimum price"
          });
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maxAtomic"],
          message: "Pricing amounts must be valid atomic integers"
        });
      }
    }

    if (value.model === "free" || value.model === "unavailable") {
      if (value.minAtomic !== null || value.maxAtomic !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["minAtomic"],
          message: `${value.model} pricing cannot include an atomic amount`
        });
      }
    }

    if ((value.model === "fixed" || value.model === "range") &&
      (value.minAtomic === null || value.maxAtomic === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minAtomic"],
        message: `${value.model} pricing must include both minimum and maximum atomic amounts`
      });
    }
  });

export type MarketplacePricing = z.infer<typeof marketplacePricingSchema>;

export const marketplaceAuthoritySchema = z.object({
  walletProvider: z.enum(["altana", "external", "unknown"]),
  executionWallet: evmAddressSchema.nullable(),
  expiresAt: isoDateSchema.nullable(),
  spendLimitAtomic: atomicAmountSchema.nullable(),
  spendAsset: evmAddressSchema.nullable(),
  allowlistedContracts: z.array(evmAddressSchema).max(128),
  allowlistedSelectors: z.array(selectorSchema).max(256),
  observedAt: isoDateSchema.nullable()
});

export type MarketplaceAuthority = z.infer<typeof marketplaceAuthoritySchema>;

export const marketplaceExecutionEvidenceSchema = z.object({
  status: z.enum(["verified", "unavailable", "unknown"]),
  lastVerifiedAt: isoDateSchema.nullable(),
  reference: z.string().trim().min(1).max(500).nullable()
}).superRefine((value, context) => {
  if (value.status === "verified" && (value.lastVerifiedAt === null || value.reference === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastVerifiedAt"],
      message: "Verified execution evidence must include a timestamp and reference"
    });
  }
});

export type MarketplaceExecutionEvidence = z.infer<typeof marketplaceExecutionEvidenceSchema>;

export const marketplaceActivationOfferSchema = z.object({
  advertised: z.boolean(),
  method: z.enum(activationMethods),
  label: z.string().trim().min(1).max(200)
}).superRefine((value, context) => {
  if (value.advertised && value.method === "none") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["method"],
      message: "An advertised activation offer must name its method"
    });
  }
  if (!value.advertised && value.method !== "none") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["method"],
      message: "A non-advertised activation offer must use method none"
    });
  }
});

export type MarketplaceActivationOffer = z.infer<typeof marketplaceActivationOfferSchema>;

/**
 * Metadata supplied by the marketplace projection. Identity and all six
 * state axes are deliberately absent: those come from the ingestion/domain
 * boundary in IngestionMarketplaceSource.
 */
export const marketplaceListingMetadataSchema = z.object({
  identityKey: z.string().trim().min(1).max(400),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  category: agentCategorySchema,
  /** Additional reviewed category matches; the scalar category remains primary. */
  applicableCategories: z.array(agentCategorySchema).max(4).optional(),
  supportedProtocols: z.array(protocolNameSchema).max(64),
  pricing: marketplacePricingSchema,
  dataFreshness: marketplaceFreshnessSchema,
  authority: marketplaceAuthoritySchema,
  executionEvidence: marketplaceExecutionEvidenceSchema,
  activationOffer: marketplaceActivationOfferSchema,
  /** Optional at input boundaries; parseMarketplaceMetadata fills an explicit
   * unavailable projection when no enrichment observation exists. */
  metrics: marketplaceMetricsSchema.optional(),
  fixture: fixtureMetadataSchema.nullable()
});

export type MarketplaceListingMetadata = z.infer<typeof marketplaceListingMetadataSchema>;

/**
 * Source contract consumed by the read model. The identity and state types
 * are the canonical domain values; this package does not redefine them.
 */
export const marketplaceListingInputSchema = z.object({
  identityKey: z.string().trim().min(1).max(400),
  identity: erc8004IdentitySchema,
  ownerAddress: evmAddressSchema.nullable(),
  agentWallet: evmAddressSchema.nullable(),
  agentUri: z.string().url().nullable(),
  contentDigest: digestSchema.nullable(),
  state: agentStateAxesSchema,
  slug: marketplaceListingMetadataSchema.shape.slug,
  name: marketplaceListingMetadataSchema.shape.name,
  description: marketplaceListingMetadataSchema.shape.description,
  category: agentCategorySchema,
  applicableCategories: marketplaceListingMetadataSchema.shape.applicableCategories,
  services: z.array(advertisedServiceSchema).max(128),
  capabilities: capabilityManifestSchema,
  supportedProtocols: z.array(protocolNameSchema).max(64),
  pricing: marketplacePricingSchema,
  health: marketplaceHealthSchema,
  dataFreshness: marketplaceFreshnessSchema,
  authority: marketplaceAuthoritySchema,
  executionEvidence: marketplaceExecutionEvidenceSchema,
  activationOffer: marketplaceActivationOfferSchema,
  /** Service probes and enrichment are separate from the advertised contract. */
  metrics: marketplaceMetricsSchema.optional(),
  serviceEvidence: z.array(marketplaceServiceEvidenceSchema).max(128).optional(),
  provenance: marketplaceProvenanceSchema,
  fixture: fixtureMetadataSchema.nullable()
});

export type MarketplaceListingInput = z.infer<typeof marketplaceListingInputSchema>;

export const activationAvailabilitySchema = z.object({
  available: z.literal(false),
  featureGate: z.literal(activationFeatureGate),
  method: z.enum(activationMethods),
  reasonCode: z.literal(activationDisabledReason),
  message: z.string().trim().min(1).max(500)
});

export type ActivationAvailability = z.infer<typeof activationAvailabilitySchema>;

export const marketplaceScoreExplanationSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  components: scoreComponentsSchema.nullable(),
  factors: z.array(z.string().trim().min(1).max(500)).max(32)
});

export type MarketplaceScoreExplanation = z.infer<typeof marketplaceScoreExplanationSchema>;

export const marketplaceAgentCardSchema = marketplaceListingInputSchema.extend({
  activation: activationAvailabilitySchema,
  eligibility: marketplaceEligibilityResultSchema,
  scoreExplanation: marketplaceScoreExplanationSchema
});

export type MarketplaceAgentCard = z.infer<typeof marketplaceAgentCardSchema>;

export const marketplaceAgentDetailSchema = marketplaceAgentCardSchema.extend({
  detail: z.object({
    inputSchemas: z.array(z.record(z.string(), z.unknown())),
    outputSchemas: z.array(z.record(z.string(), z.unknown())),
    contractAllowlist: z.object({
      contracts: z.array(evmAddressSchema),
      selectors: z.array(selectorSchema)
    }),
    latestExecution: marketplaceExecutionEvidenceSchema
  })
});

export type MarketplaceAgentDetail = z.infer<typeof marketplaceAgentDetailSchema>;

export const marketplaceSearchRequestSchema = z.object({
  query: z.string().trim().max(200).default(""),
  category: agentCategorySchema.optional(),
  chainId: chainIdSchema.optional(),
  requiredProtocols: z.array(protocolNameSchema).max(32).default([]),
  maxPriceAtomic: atomicAmountSchema.optional(),
  requireAuthority: z.boolean().default(false),
  requestedAmountAtomic: atomicAmountSchema.optional(),
  requiredContract: evmAddressSchema.optional(),
  requiredSelector: selectorSchema.optional(),
  requireFreshData: z.boolean().default(false)
});

export type MarketplaceSearchRequest = z.infer<typeof marketplaceSearchRequestSchema>;

export const marketplaceResponseMetaSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  sourceStatus: z.enum(marketplaceResponseStatuses),
  sourceName: z.string().trim().min(1).max(160),
  /** Null means the source had no records (or contained mixed source kinds). */
  sourceKind: z.enum(marketplaceSourceKinds).nullable().default(null),
  warning: z.string().trim().min(1).max(500).nullable(),
  returnedAt: isoDateSchema,
  refreshedAt: isoDateSchema.nullable().default(null),
  fixtureCount: z.number().int().nonnegative(),
  retrievalMode: z.enum(marketplaceRetrievalModes).default("deterministic"),
  semanticModelVersion: z.string().trim().min(1).max(128).nullable().default(null)
});

export type MarketplaceResponseMeta = z.infer<typeof marketplaceResponseMetaSchema>;

export const marketplaceExclusionSchema = z.object({
  identityKey: z.string().trim().min(1).max(400),
  slug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  category: agentCategorySchema,
  reasons: marketplaceEligibilityResultSchema.shape.reasons
});

export type MarketplaceExclusion = z.infer<typeof marketplaceExclusionSchema>;

export const marketplaceSearchResponseSchema = z.object({
  request: marketplaceSearchRequestSchema,
  results: z.array(marketplaceAgentCardSchema),
  excluded: z.array(marketplaceExclusionSchema),
  meta: marketplaceResponseMetaSchema
});

export type MarketplaceSearchResponse = z.infer<typeof marketplaceSearchResponseSchema>;

export const marketplaceDetailResponseSchema = z.object({
  agent: marketplaceAgentDetailSchema,
  meta: marketplaceResponseMetaSchema
});

export type MarketplaceDetailResponse = z.infer<typeof marketplaceDetailResponseSchema>;

export const marketplaceCompareResponseSchema = z.object({
  requested: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
  agents: z.array(marketplaceAgentCardSchema).max(3),
  missing: z.array(z.string().trim().min(1).max(400)).max(3),
  meta: marketplaceResponseMetaSchema
});

export type MarketplaceCompareResponse = z.infer<typeof marketplaceCompareResponseSchema>;

export type MarketplaceEligibilityEvaluation = MarketplaceEligibilityResult & {
  readonly explanation: MarketplaceScoreExplanation;
};

export type ScoreComponents = z.infer<typeof scoreComponentsSchema>;

export function parseMarketplaceListing(input: unknown): MarketplaceListingInput {
  const listing = marketplaceListingInputSchema.parse(input);
  const expectedKey = erc8004IdentityKey(listing.identity);
  if (listing.identityKey !== expectedKey) {
    throw new Error("Marketplace listing identityKey does not match the complete ERC-8004 identity");
  }
  if (listing.pricing.network !== listing.identity.chainId) {
    throw new Error("Marketplace listing pricing network must match the ERC-8004 identity chain");
  }

  const provenanceFixture = listing.provenance.fixture;
  const listingFixture = listing.fixture;
  if (listing.provenance.sourceKind === "fixture") {
    if (provenanceFixture === null || listingFixture === null) {
      throw new Error("Fixture marketplace listings must carry the fixture marker at every boundary");
    }
    if (provenanceFixture.label !== listingFixture.label) {
      throw new Error("Marketplace fixture labels must match across listing and provenance");
    }
  } else if (provenanceFixture !== null || listingFixture !== null) {
    throw new Error("Ingestion marketplace listings cannot carry fixture markers");
  }
  return {
    ...listing,
    metrics: listing.metrics ?? unknownMarketplaceMetrics(),
    serviceEvidence: listing.serviceEvidence ?? []
  };
}

export function parseMarketplaceMetadata(input: unknown): MarketplaceListingMetadata {
  const metadata = marketplaceListingMetadataSchema.parse(input);
  return {
    ...metadata,
    metrics: metadata.metrics ?? unknownMarketplaceMetrics()
  };
}

export function parseMarketplaceSearchRequest(input: unknown = {}): MarketplaceSearchRequest {
  return marketplaceSearchRequestSchema.parse(input);
}

export function parseMarketplaceSourceSnapshot(input: unknown): MarketplaceSourceSnapshot {
  const snapshot = marketplaceSourceSnapshotSchema.parse(input);
  return {
    ...snapshot,
    records: snapshot.records.map(parseMarketplaceListing)
  };
}

export const marketplaceSourceSnapshotSchema = z.object({
  records: z.array(marketplaceListingInputSchema),
  status: z.enum(marketplaceSourceStatuses).default("healthy"),
  sourceName: z.string().trim().min(1).max(160).default("marketplace-source"),
  warning: z.string().trim().min(1).max(500).nullable().default(null),
  refreshedAt: isoDateSchema.nullable().default(null)
});

export type MarketplaceSourceSnapshot = z.infer<typeof marketplaceSourceSnapshotSchema>;

export type {
  AdvertisedService,
  AgentCategory,
  AgentStateAxes,
  CapabilityManifest,
  Erc8004Identity,
  MarketplaceEligibilityResult
};
