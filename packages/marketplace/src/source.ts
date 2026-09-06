import {
  advertisedServiceSchema,
  capabilityManifestSchema,
  erc8004IdentityKey,
  normalizeEvmAddress,
  type CapabilityManifest
} from "@bnbera/domain";
import type {
  CapabilityObservation,
  IngestionRepository,
  ReputationFeedback,
  ServiceProbeRecord
} from "@bnbera/agent-ingestion";
import {
  marketplaceHealthSchema,
  marketplaceMetricsSchema,
  marketplaceReputationFeedbackSchema,
  marketplaceReputationSchema,
  marketplaceReputationViewSchema,
  marketplaceServiceEvidenceSchema,
  parseMarketplaceListing,
  parseMarketplaceMetadata,
  parseMarketplaceSourceSnapshot,
  type MarketplaceHealth,
  type MarketplaceMetrics,
  type MarketplaceListingInput,
  type MarketplaceListingMetadata,
  type MarketplaceReputation,
  type MarketplaceReputationView,
  type MarketplaceServiceEvidence,
  type MarketplaceSourceSnapshot
} from "./types.js";

export interface MarketplaceSource {
  read(): Promise<MarketplaceSourceSnapshot>;
}

export interface MarketplaceMetadataSource {
  listMetadata(): Promise<readonly MarketplaceListingMetadata[]>;
}

export class InMemoryMarketplaceSource implements MarketplaceSource {
  private readonly snapshot: MarketplaceSourceSnapshot;

  public constructor(
    records: readonly MarketplaceListingInput[] = [],
    options: {
      readonly status?: MarketplaceSourceSnapshot["status"];
      readonly sourceName?: string;
      readonly warning?: string | null;
      readonly refreshedAt?: string | null;
    } = {}
  ) {
    const parsed = records.map(parseMarketplaceListing);
    const defaultSourceName = parsed.length > 0 && parsed.every((record) => record.fixture !== null)
      ? "development-fixtures"
      : "in-memory-marketplace-source";
    this.snapshot = parseMarketplaceSourceSnapshot({
      records: parsed,
      ...(options.status === undefined ? {} : { status: options.status }),
      sourceName: options.sourceName ?? defaultSourceName,
      ...(options.warning === undefined ? {} : { warning: options.warning }),
      ...(options.refreshedAt === undefined ? {} : { refreshedAt: options.refreshedAt })
    });
  }

  public async read(): Promise<MarketplaceSourceSnapshot> {
    return this.snapshot;
  }
}

export class InMemoryMarketplaceMetadataSource implements MarketplaceMetadataSource {
  private readonly metadata: readonly MarketplaceListingMetadata[];

  public constructor(metadata: readonly MarketplaceListingMetadata[] = []) {
    const seen = new Set<string>();
    this.metadata = [...metadata]
      .map(parseMarketplaceMetadata)
      .map((record) => {
        if (seen.has(record.identityKey)) {
          throw new Error(`Duplicate marketplace metadata for ${record.identityKey}`);
        }
        seen.add(record.identityKey);
        return record;
      })
      .sort((a, b) => compareStrings(a.identityKey, b.identityKey));
  }

  public async listMetadata(): Promise<readonly MarketplaceListingMetadata[]> {
    return this.metadata;
  }
}

export type IngestionMarketplaceSourceOptions = {
  readonly sourceName?: string;
  readonly now?: () => Date;
  /** A disabled or lagging synchronization gate can keep reads available
   * while explicitly marking the projection degraded. */
  readonly status?: Extract<MarketplaceSourceSnapshot["status"], "healthy" | "degraded">;
  readonly warning?: string | null;
  /** Publicly reviewed reviewer/validator identities. Empty means fail closed. */
  readonly recognizedReviewerAddresses?: readonly string[];
};

/**
 * Narrow adapter from the established identity/service/capability ingestion
 * ports to the marketplace read projection. Listing presentation metadata is
 * supplied separately because the ingestion package intentionally does not
 * own marketplace publication or ranking state.
 */
export class IngestionMarketplaceSource implements MarketplaceSource {
  public constructor(
    private readonly repository: IngestionRepository,
    private readonly metadataSource: MarketplaceMetadataSource,
    private readonly options: IngestionMarketplaceSourceOptions = {}
  ) {}

  private recognizedReviewerAddresses(): ReadonlySet<string> {
    const values = this.options.recognizedReviewerAddresses ?? [];
    const normalized = new Set<string>();
    for (const value of values) {
      try {
        normalized.add(normalizeEvmAddress(value));
      } catch {
        // An invalid allowlist entry must never make an unrecognized client
        // appear trusted; ignore it and leave the recognized view unavailable.
      }
    }
    return normalized;
  }

  public async read(): Promise<MarketplaceSourceSnapshot> {
    const [identities, metadata] = await Promise.all([
      this.repository.listIdentities(),
      this.metadataSource.listMetadata()
    ]);
    const parsedMetadata = metadata.map(parseMarketplaceMetadata);
    const metadataByKey = new Map<string, MarketplaceListingMetadata>();
    for (const record of parsedMetadata) {
      if (metadataByKey.has(record.identityKey)) {
        throw new Error(`Duplicate marketplace metadata for ${record.identityKey}`);
      }
      metadataByKey.set(record.identityKey, record);
    }
    const records: MarketplaceListingInput[] = [];
    let skipped = 0;
    const now = this.options.now?.() ?? new Date();

    for (const identityRecord of identities) {
      const identityKey = erc8004IdentityKey(identityRecord.identity);
      const presentation = metadataByKey.get(identityKey);
      if (presentation === undefined) {
        skipped += 1;
        continue;
      }
      if (identityRecord.state.originType !== identityRecord.originType) {
        skipped += 1;
        continue;
      }

      const [sources, services, capabilities, probes, feedback] = await Promise.all([
        this.repository.listSources(identityKey),
        this.repository.listServices(identityKey),
        this.repository.listCapabilities(identityKey),
        this.repository.listProbeResults(identityKey),
        typeof this.repository.listReputationFeedback === "function"
          ? this.repository.listReputationFeedback(identityRecord.identity, { includeRevoked: true })
          : Promise.resolve([])
      ]);
      const capability = latestCapability(capabilities);
      if (capability === null) {
        skipped += 1;
        continue;
      }

      const parsedCapabilities = capabilityManifest(capability);
      if (parsedCapabilities === null) {
        skipped += 1;
        continue;
      }

      try {
        const parsedServices = services.map((service) => advertisedServiceSchema.parse(service));
        const probeProjection = projectionFromProbes(probes, now);
        const metrics = marketplaceMetricsSchema.parse({
          ...(presentation.metrics ?? unknownMetrics()),
          uptime: probeProjection.uptime,
          reputation: reputationProjection(feedback, this.recognizedReviewerAddresses())
        });
        const listing = parseMarketplaceListing({
          ...presentation,
          identityKey,
          identity: identityRecord.identity,
          ownerAddress: identityRecord.ownerAddress,
          agentWallet: identityRecord.agentWallet,
          agentUri: identityRecord.agentUri,
          contentDigest: identityRecord.contentDigest,
          state: identityRecord.state,
          services: parsedServices,
          capabilities: parsedCapabilities,
          health: probeProjection.health,
          metrics,
          serviceEvidence: serviceEvidenceFrom(parsedServices, probes),
          provenance: {
            sourceKind: presentation.fixture === null ? "ingestion" : "fixture",
            fixture: presentation.fixture,
            sources: sources.map((source) => ({
              source: source.source,
              sourceReference: source.sourceReference,
              firstObservedAt: source.firstObservedAt.toISOString(),
              lastObservedAt: source.lastObservedAt.toISOString(),
              rawResponseDigest: source.rawResponseDigest,
              normalizedIngestionVersion: source.normalizedIngestionVersion
            })),
            identityRead: {
              observedBlock: identityRecord.observedBlock,
              observedBlockHash: identityRecord.observedBlockHash,
              readConsistency: identityRecord.readConsistency,
              observedAt: identityRecord.updatedAt.toISOString()
            }
          },
          fixture: presentation.fixture
        });
        records.push(listing);
      } catch {
        // A malformed projection must not make an otherwise readable source
        // appear live. Withhold just this record and expose the degraded
        // source warning below; the next ingestion refresh can repair it.
        skipped += 1;
      }
    }

    const projectionWarning = skipped > 0
      ? `${skipped} indexed identity record${skipped === 1 ? "" : "s"} lacked complete marketplace metadata and was withheld.`
      : null;
    const warning = [this.options.warning, projectionWarning]
      .filter((value): value is string => value !== null && value !== undefined && value.length > 0)
      .join(" ")
      .slice(0, 500) || null;
    return parseMarketplaceSourceSnapshot({
      records,
      status: this.options.status === "degraded" || skipped > 0 ? "degraded" : "healthy",
      sourceName: this.options.sourceName ?? "ingestion-read-model",
      warning,
      refreshedAt: now.toISOString()
    });
  }
}

function latestCapability(
  capabilities: readonly CapabilityObservation[]
): CapabilityObservation | null {
  return [...capabilities]
    .sort((a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() || compareStrings(a.manifestDigest, b.manifestDigest)
    )
    .at(-1) ?? null;
}

function capabilityManifest(observation: CapabilityObservation): CapabilityManifest | null {
  const candidate = observation.capabilityManifest;
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }
  try {
    return capabilityManifestSchema.parse(candidate);
  } catch {
    return null;
  }
}

function latestProbeForService(
  left: ServiceProbeRecord,
  right: ServiceProbeRecord
): ServiceProbeRecord {
  return left.observedAt.getTime() > right.observedAt.getTime() ||
    (left.observedAt.getTime() === right.observedAt.getTime() &&
      (compareStrings(left.kind, right.kind) > 0 ||
        (left.kind === right.kind && compareStrings(left.url, right.url) > 0)))
    ? left
    : right;
}

/**
 * A listing may advertise several independent transports. Collapse history
 * per kind+URL first, then let one currently healthy transport keep the
 * listing healthy; an unrelated newer failure must not mask it. If every
 * current transport is degraded, expose the newest degraded observation.
 */
// Minute-based health cron observations remain browse-usable for two ticks.
// Execution paths must still perform their own immediate check.
const endpointHealthMaxAgeMs = 120_000;
const uptimeWindowMs = 30 * 60_000;

function latestProbesByService(probes: readonly ServiceProbeRecord[]): readonly ServiceProbeRecord[] {
  const latestByService = new Map<string, ServiceProbeRecord>();
  for (const probe of probes) {
    const key = `${probe.kind}\u0000${probe.url}`;
    const previous = latestByService.get(key);
    latestByService.set(key, previous === undefined ? probe : latestProbeForService(previous, probe));
  }
  return [...latestByService.values()];
}

function projectionFromProbes(
  probes: readonly ServiceProbeRecord[],
  now: Date
): { readonly health: MarketplaceHealth; readonly uptime: MarketplaceMetrics["uptime"] } {
  const current = latestProbesByService(probes);
  if (current.length === 0) {
    return {
      health: marketplaceHealthSchema.parse({
        endpointStatus: "unknown",
        observedAt: null,
        latencyMs: null,
        source: null
      }),
      uptime: unknownMetrics().uptime
    };
  }
  const observedNow = now.getTime();
  const fresh = current.filter((probe) => {
    const observedAt = probe.observedAt.getTime();
    const ageMs = observedNow - observedAt;
    return Number.isFinite(observedAt) && Number.isFinite(observedNow) && ageMs >= 0 && ageMs <= endpointHealthMaxAgeMs;
  });
  const healthy = fresh.filter((probe) => probe.validationStatus === "healthy");
  const candidates = healthy.length > 0 ? healthy : fresh.length > 0 ? fresh : current;
  const probe = candidates.reduce((latest, candidate) => latestProbeForService(latest, candidate));
  const windowStartMs = observedNow - uptimeWindowMs;
  const boundedHistory = probes
    .filter((candidate) => {
      const observedAt = candidate.observedAt.getTime();
      return Number.isFinite(observedAt) && observedAt >= windowStartMs && observedAt <= observedNow;
    })
    .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime());
  const observedFrom = boundedHistory[0]?.observedAt.toISOString() ?? null;
  const observedTo = boundedHistory.at(-1)?.observedAt.toISOString() ?? null;
  const attemptedChecks = boundedHistory.length;
  const successfulChecks = boundedHistory.filter((candidate) => candidate.validationStatus === "healthy").length;
  const observedSpanSeconds = boundedHistory.length > 0
    ? Math.max(0, Math.floor((boundedHistory.at(-1)!.observedAt.getTime() - boundedHistory[0]!.observedAt.getTime()) / 1_000))
    : null;
  return {
    health: marketplaceHealthSchema.parse({
      endpointStatus: healthy.length > 0 ? "healthy" : fresh.length > 0 ? "unhealthy" : "unknown",
      observedAt: probe.observedAt.toISOString(),
      latencyMs: probe.latencyMs,
      source: "agent-ingestion-probe"
    }),
    uptime: {
      status: attemptedChecks > 0 ? "observed" : "unknown",
      windowSeconds: observedSpanSeconds,
      monitoringWindowSeconds: attemptedChecks > 0 ? uptimeWindowMs / 1_000 : null,
      coverageSeconds: observedSpanSeconds,
      coverageRatio: observedSpanSeconds === null ? null : Math.min(1, observedSpanSeconds / (uptimeWindowMs / 1_000)),
      observedFrom,
      observedTo,
      attemptedChecks,
      successfulChecks,
      successRatio: attemptedChecks > 0 ? successfulChecks / attemptedChecks : null,
      source: attemptedChecks > 0 ? "agent-ingestion-probe" : null
    }
  };
}

function unknownMetrics(): MarketplaceMetrics {
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

function publicReputationFeedback(value: ReputationFeedback): ReturnType<typeof marketplaceReputationFeedbackSchema.parse> {
  return marketplaceReputationFeedbackSchema.parse({
    reputationRegistry: value.reputationRegistry,
    reviewerAddress: value.clientAddress,
    feedbackIndex: value.feedbackIndex,
    value: value.value,
    valueDecimals: value.valueDecimals,
    indexedTag1: value.indexedTag1,
    tag1: value.tag1,
    tag2: value.tag2,
    endpoint: value.endpoint,
    feedbackUri: value.feedbackUri,
    feedbackHash: value.feedbackHash.length === 0 ? null : value.feedbackHash,
    feedbackTransactionHash: value.feedbackTransactionHash,
    feedbackLogIndex: value.feedbackLogIndex,
    feedbackBlockNumber: value.feedbackBlockNumber,
    feedbackBlockHash: value.feedbackBlockHash,
    feedbackObservedAt: value.feedbackObservedAt.toISOString(),
    revoked: value.revoked,
    revocationTransactionHash: value.revocationTransactionHash,
    revocationLogIndex: value.revocationLogIndex,
    revocationBlockNumber: value.revocationBlockNumber,
    revocationBlockHash: value.revocationBlockHash,
    revocationObservedAt: value.revocationObservedAt?.toISOString() ?? null
  });
}

function reputationObservedAt(feedback: readonly ReputationFeedback[]): string | null {
  const dates = feedback.flatMap((item) => [item.feedbackObservedAt, item.revocationObservedAt].filter((date): date is Date => date !== null));
  const latest = dates.sort((left, right) => right.getTime() - left.getTime())[0];
  return latest?.toISOString() ?? null;
}

function reputationView(
  feedback: readonly ReputationFeedback[],
  reasonWhenEmpty: string
): MarketplaceReputationView {
  const active = feedback.filter((item) => !item.revoked);
  const hasEvidence = feedback.length > 0;
  return marketplaceReputationViewSchema.parse({
    status: hasEvidence ? "available" : "unknown",
    count: hasEvidence ? active.length : null,
    feedback: feedback.slice(-64).map(publicReputationFeedback),
    source: hasEvidence ? "erc8004-reputation-registry" : null,
    observedAt: reputationObservedAt(feedback),
    reason: hasEvidence ? null : reasonWhenEmpty
  });
}

function reputationProjection(
  feedback: readonly ReputationFeedback[],
  recognizedReviewers: ReadonlySet<string>
): MarketplaceReputation {
  const raw = reputationView(feedback, "No canonical ERC-8004 feedback has been observed.");
  const recognized = recognizedReviewers.size === 0
    ? marketplaceReputationViewSchema.parse({ status: "unavailable", count: null, feedback: [], source: null, observedAt: null, reason: "No recognized reviewer or validator allowlist is configured." })
    : reputationView(feedback.filter((item) => recognizedReviewers.has(item.clientAddress)), "No canonical feedback from a recognized reviewer or validator has been observed.");
  return marketplaceReputationSchema.parse({
    rawPermissionless: raw,
    recognizedReviewers: recognized,
    verifiedPurchases: {
      status: "unavailable",
      count: null,
      feedback: [],
      source: null,
      observedAt: null,
      reason: "BNBEra verified-purchase reviews are enabled by G2."
    }
  });
}

function publicSkillTerms(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(item)))]
    .slice(0, 32);
}

function skillEvidenceFrom(value: unknown): Array<{
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly keywords?: readonly string[];
}> {
  if (!Array.isArray(value)) return [];
  return value
    .map((skill) => {
      if (typeof skill !== "object" || skill === null || Array.isArray(skill)) return null;
      const record = skill as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const description = typeof record.description === "string" ? record.description.trim() : "";
      const tags = publicSkillTerms(record.tags);
      const keywords = publicSkillTerms(record.keywords);
      return id && name && description
        ? {
            id,
            name,
            description,
            ...(tags.length === 0 ? {} : { tags }),
            ...(keywords.length === 0 ? {} : { keywords })
          }
        : null;
    })
    .filter((skill): skill is NonNullable<typeof skill> => skill !== null)
    .slice(0, 32);
}

function serviceEvidenceFrom(
  services: readonly ReturnType<typeof advertisedServiceSchema.parse>[],
  probes: readonly ServiceProbeRecord[]
): readonly MarketplaceServiceEvidence[] {
  const latest = new Map<string, ServiceProbeRecord>();
  const latestCard = new Map<string, ServiceProbeRecord>();
  for (const probe of probes) {
    const key = `${probe.kind}\u0000${probe.url}`;
    const previous = latest.get(key);
    latest.set(key, previous === undefined ? probe : latestProbeForService(previous, probe));
    const summary = probe.safeCapabilityProbe;
    const isCard = probe.kind === "a2a" &&
      summary?.protocol === "a2a" &&
      summary.contract === "agent-card" &&
      summary.valid === true;
    if (isCard) {
      const previousCard = latestCard.get(key);
      latestCard.set(key, previousCard === undefined ? probe : latestProbeForService(previousCard, probe));
    }
  }
  return services.map((service) => {
    const key = `${service.kind}\u0000${service.url}`;
    const probe = latest.get(key);
    // A later failed health check has no card body, but it must not erase the
    // last bounded advertised-skill observation from the browse projection.
    const summary = latestCard.get(key)?.safeCapabilityProbe ?? probe?.safeCapabilityProbe ?? null;
    const isCard = service.kind === "a2a" && summary?.protocol === "a2a" && summary.contract === "agent-card" && summary.valid === true;
    const invocationUrls = isCard && Array.isArray(summary.invocationUrls)
      ? summary.invocationUrls.filter((value): value is string => typeof value === "string").slice(0, 32)
      : [];
    return marketplaceServiceEvidenceSchema.parse({
      kind: service.kind,
      advertisedUrl: service.url,
      cardUrl: isCard ? service.url : null,
      invocationUrls,
      advertisedSkills: isCard ? skillEvidenceFrom(summary.skills) : [],
      // A bounded GET proves card/transport reachability only. No task was
      // invoked, so testedSkills must remain empty and explicit.
      testedSkills: [],
      testStatus: probe?.validationStatus === "healthy" ? "transport_only" : "not_tested",
      testedAt: null
    });
  });
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
