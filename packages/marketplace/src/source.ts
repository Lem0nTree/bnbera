import {
  advertisedServiceSchema,
  capabilityManifestSchema,
  erc8004IdentityKey,
  type CapabilityManifest
} from "@bnbera/domain";
import type {
  CapabilityObservation,
  IngestionRepository,
  ServiceProbeRecord
} from "@bnbera/agent-ingestion";
import {
  marketplaceHealthSchema,
  parseMarketplaceListing,
  parseMarketplaceMetadata,
  parseMarketplaceSourceSnapshot,
  type MarketplaceHealth,
  type MarketplaceListingInput,
  type MarketplaceListingMetadata,
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

      const [sources, services, capabilities, probes] = await Promise.all([
        this.repository.listSources(identityKey),
        this.repository.listServices(identityKey),
        this.repository.listCapabilities(identityKey),
        this.repository.listProbeResults(identityKey)
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
        const health = healthFromProbes(probes, now);
        const parsedServices = services.map((service) => advertisedServiceSchema.parse(service));
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
          health,
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

function healthFromProbes(probes: readonly ServiceProbeRecord[], now: Date): MarketplaceHealth {
  const latestByService = new Map<string, ServiceProbeRecord>();
  for (const probe of probes) {
    const key = `${probe.kind}\u0000${probe.url}`;
    const previous = latestByService.get(key);
    latestByService.set(key, previous === undefined ? probe : latestProbeForService(previous, probe));
  }
  const current = [...latestByService.values()];
  if (current.length === 0) {
    return marketplaceHealthSchema.parse({
      endpointStatus: "unknown",
      observedAt: null,
      latencyMs: null,
      source: null
    });
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
  return marketplaceHealthSchema.parse({
    endpointStatus: healthy.length > 0 ? "healthy" : fresh.length > 0 ? "unhealthy" : "unknown",
    observedAt: probe.observedAt.toISOString(),
    latencyMs: probe.latencyMs,
    source: "agent-ingestion-probe"
  });
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
