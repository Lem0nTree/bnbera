import type { RuntimeConfig } from "@bnbera/config";
import { erc8004IdentityKey, type CapabilityManifest, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { AgentIngestionService, type CandidateIngestionResult } from "./ingestion.js";
import { BoundedMetadataResolver, parseAgentRegistrationMetadata } from "./metadata.js";
import { normalizeCapabilityManifest, normalizeServices } from "./normalize.js";
import { type CategoryClassification, type CategoryClassificationInput, DeterministicCategoryClassifier } from "./categorization.js";
import { buildSemanticDocument, validateEmbeddingProvider, type EmbeddingProvider, type SemanticDocumentInput } from "./semantic.js";
import type { EightHundredFourScanAdapter, EightHundredFourScanQuery } from "./adapters/8004scan.js";
import type { RegistryChainReader } from "./adapters/registry.js";
import type { IdentityCandidate, IdentityRecord, IngestionRepository, ServiceObservation } from "./types.js";
import { ensureSemanticVector, type SemanticVectorRepository, type SemanticVectorRecord } from "./vector.js";
import { BoundedServiceProbe, type ServiceProbeBatchOptions, type ServiceProbeResult } from "./probe.js";
import {
  createEmbeddingProviderFromRuntimeConfig,
  type EmbeddingSecretResolver,
  type OpenRouterEmbeddingProviderOptions
} from "./adapters/openrouter-embeddings.js";

export const erc8004PipelineFeatureGates = [
  "ERC8004_INGESTION_ENABLED",
  "ERC8004SCAN_DISCOVERY_ENABLED",
  "MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED"
] as const;
export type Erc8004PipelineFeatureGate = (typeof erc8004PipelineFeatureGates)[number];

export type Erc8004PipelineGates = Readonly<Record<Erc8004PipelineFeatureGate, boolean>>;

/** Parse explicit feature flags. Missing and malformed values are disabled. */
export function readErc8004PipelineGates(
  env: Readonly<Record<string, string | undefined>> = process.env
): Erc8004PipelineGates {
  return Object.fromEntries(erc8004PipelineFeatureGates.map((name) => [name, env[name] === "true"])) as Erc8004PipelineGates;
}

export const disabledErc8004PipelineGates: Erc8004PipelineGates = Object.freeze({
  ERC8004_INGESTION_ENABLED: false,
  ERC8004SCAN_DISCOVERY_ENABLED: false,
  MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: false
});

export type PipelineStageStatus = "disabled" | "completed" | "degraded";

export type PipelineCategorySink = {
  save(input: { readonly identityKey: string; readonly classification: CategoryClassification }): Promise<void>;
};

export type PipelineVersionIdResolver = (identity: Erc8004Identity) => string | null | Promise<string | null>;

export type Erc8004PipelineOptions = {
  readonly repository: IngestionRepository;
  readonly adapter?: EightHundredFourScanAdapter;
  readonly ingestion?: AgentIngestionService;
  readonly registryReader?: RegistryChainReader;
  readonly metadataResolver?: BoundedMetadataResolver;
  /** Optional bounded transport for read-only service contract probes. */
  readonly serviceProbe?: BoundedServiceProbe;
  readonly serviceProbeOptions?: ServiceProbeBatchOptions;
  readonly categoryClassifier?: DeterministicCategoryClassifier;
  readonly categorySink?: PipelineCategorySink;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly vectorRepository?: SemanticVectorRepository;
  readonly versionIdForIdentity?: PipelineVersionIdResolver;
  readonly gates?: Partial<Erc8004PipelineGates>;
  readonly now?: () => Date;
};

export type RuntimeConfiguredPipelineOptions = Omit<Erc8004PipelineOptions, "embeddingProvider" | "gates"> & {
  readonly runtimeConfig: RuntimeConfig;
  /** Explicit deterministic provider seam for tests; production selects the configured adapter below. */
  readonly embeddingProvider?: EmbeddingProvider;
  /** Server-side secret manager callback; never persist the resolved value. */
  readonly resolveEmbeddingSecret?: EmbeddingSecretResolver;
  readonly embeddingProviderOptions?: Omit<OpenRouterEmbeddingProviderOptions, "config" | "resolveSecret">;
};

export type PipelineCandidateResult = {
  readonly identityKey: string;
  readonly ingestion: "completed" | "failed";
  readonly registry: "verified" | "skipped" | "failed";
  readonly metadata: "resolved" | "skipped" | "failed";
  /** Resolved registration document, retained only as safe public metadata. */
  readonly publicMetadata: Readonly<Record<string, unknown>> | null;
  /** A validated manifest observed from the candidate or resolved document. */
  readonly capabilityManifest: CapabilityManifest | null;
  readonly services: readonly ServiceObservation[];
  readonly probes: readonly ServiceProbeResult[];
  readonly category: CategoryClassification | null;
  readonly vector: { readonly record: SemanticVectorRecord; readonly generated: boolean } | null;
  readonly warnings: readonly string[];
};

export type PipelineRunResult = {
  readonly status: PipelineStageStatus;
  readonly discoveryStatus: PipelineStageStatus;
  readonly candidateCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly nextOffset: number | null;
  readonly total: number | null;
  readonly candidates: readonly PipelineCandidateResult[];
  readonly warnings: readonly string[];
};

function mergeGates(input: Partial<Erc8004PipelineGates> | undefined): Erc8004PipelineGates {
  return {
    ...disabledErc8004PipelineGates,
    ...(input ?? {})
  };
}

function asWarning(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "pipeline stage failed";
}

function emptyCandidateResult(identityKey: string, warning: string): PipelineCandidateResult {
  return {
    identityKey,
    ingestion: "failed",
    registry: "skipped",
    metadata: "skipped",
    publicMetadata: null,
    capabilityManifest: null,
    services: [],
    probes: [],
    category: null,
    vector: null,
    warnings: [warning]
  };
}

function publicRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

/**
 * Registration documents use the ERC-8004 field names (`type` and `version`)
 * while the ingestion schema deliberately uses normalized names. This is a
 * field mapping only: missing protocol versions remain invalid instead of
 * being filled with a guessed value.
 */
function registrationServiceInput(value: unknown): unknown {
  const record = publicRecord(value);
  if (record === null) return value;
  return {
    ...record,
    ...(record.kind === undefined && record.type !== undefined ? { kind: record.type } : {}),
    ...(record.protocolVersion === undefined && record.protocol_version !== undefined
      ? { protocolVersion: record.protocol_version }
      : record.protocolVersion === undefined && record.version !== undefined
        ? { protocolVersion: record.version }
        : {})
  };
}

function explicitCapabilityManifest(value: unknown): unknown | undefined {
  const record = publicRecord(value);
  if (record === null) return undefined;
  if (record.capabilityManifest !== undefined) return record.capabilityManifest;
  if (record.capability_manifest !== undefined) return record.capability_manifest;
  // Some registry documents use `capabilities` for a complete manifest. Only
  // accept it when it already has the reviewed manifest shape; an array of
  // descriptive strings is not promoted into fabricated JSON schemas.
  const capabilities = record.capabilities;
  if (publicRecord(capabilities)?.schemaVersion !== undefined && Array.isArray(publicRecord(capabilities)?.capabilities)) {
    return capabilities;
  }
  return undefined;
}

function identityKey(identity: Erc8004Identity): string {
  return erc8004IdentityKey(identity);
}

/**
 * Read-only A-H coordinator. It owns the sequencing and gate policy but not
 * publication, listing state, payments, or chain writes.
 */
export class Erc8004Pipeline {
  private readonly repository: IngestionRepository;
  private readonly adapter: EightHundredFourScanAdapter | undefined;
  private readonly ingestion: AgentIngestionService;
  private readonly registryReader: RegistryChainReader | undefined;
  private readonly metadataResolver: BoundedMetadataResolver | undefined;
  private readonly serviceProbe: BoundedServiceProbe | undefined;
  private readonly serviceProbeOptions: ServiceProbeBatchOptions;
  private readonly classifier: DeterministicCategoryClassifier;
  private readonly categorySink: PipelineCategorySink | undefined;
  private readonly embeddingProvider: EmbeddingProvider | undefined;
  private readonly vectorRepository: SemanticVectorRepository | undefined;
  private readonly versionIdForIdentity: PipelineVersionIdResolver | undefined;
  private readonly gates: Erc8004PipelineGates;
  private readonly now: () => Date;

  public constructor(options: Erc8004PipelineOptions) {
    this.repository = options.repository;
    this.adapter = options.adapter;
    this.ingestion = options.ingestion ?? new AgentIngestionService(options.repository);
    this.registryReader = options.registryReader;
    this.metadataResolver = options.metadataResolver;
    this.serviceProbe = options.serviceProbe;
    this.serviceProbeOptions = options.serviceProbeOptions ?? {};
    this.classifier = options.categoryClassifier ?? new DeterministicCategoryClassifier();
    this.categorySink = options.categorySink;
    this.embeddingProvider = options.embeddingProvider;
    this.vectorRepository = options.vectorRepository;
    this.versionIdForIdentity = options.versionIdForIdentity;
    this.gates = mergeGates(options.gates);
    this.now = options.now ?? (() => new Date());
  }

  public featureGates(): Erc8004PipelineGates {
    return this.gates;
  }

  public async discover(query: EightHundredFourScanQuery = {}): Promise<PipelineRunResult> {
    if (!this.gates.ERC8004_INGESTION_ENABLED || !this.gates.ERC8004SCAN_DISCOVERY_ENABLED) {
      return {
        status: "disabled",
        discoveryStatus: "disabled",
        candidateCount: 0,
        completedCount: 0,
        failedCount: 0,
        nextOffset: null,
        total: null,
        candidates: [],
        warnings: ["ERC-8004 discovery is disabled by feature gate."]
      };
    }
    if (this.adapter === undefined) throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan discovery adapter is not configured.", "configure_scan_adapter");
    const page = await this.adapter.fetchPage(query);
    const candidates: PipelineCandidateResult[] = [];
    for (const candidate of page.candidates) {
      candidates.push(await this.processCandidate(candidate));
    }
    // A run is only complete when every enabled/required authority stage has
    // produced evidence. Skipped stages are intentionally degraded rather
    // than being reported as successful discovery.
    const failedCount = candidates.filter((candidate) => {
      const authorityIncomplete = candidate.registry !== "verified";
      const enrichmentIncomplete = candidate.metadata !== "resolved";
      const semanticIncomplete = this.gates.MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED && candidate.vector === null;
      return candidate.ingestion === "failed" || authorityIncomplete || enrichmentIncomplete || semanticIncomplete;
    }).length;
    return {
      status: failedCount > 0 ? "degraded" : "completed",
      discoveryStatus: "completed",
      candidateCount: candidates.length,
      completedCount: candidates.length - failedCount,
      failedCount,
      nextOffset: page.nextOffset,
      total: page.total,
      candidates,
      warnings: failedCount > 0 ? ["One or more ERC-8004 pipeline candidates were withheld after a stage failure."] : []
    };
  }

  public async processCandidate(candidate: IdentityCandidate): Promise<PipelineCandidateResult> {
    const key = identityKey(candidate.identity);
    const warnings: string[] = [];
    let identityRecord: IdentityRecord | null = null;
    let ingestionResult: CandidateIngestionResult;
    try {
      ingestionResult = await this.ingestion.ingestCandidate(candidate);
      identityRecord = ingestionResult.identity;
    } catch (error) {
      return emptyCandidateResult(key, "INGESTION_FAILED");
    }
    if (ingestionResult.rejectedServices.length > 0) warnings.push("SERVICE_OBSERVATIONS_REJECTED");
    if (ingestionResult.capabilityError !== null) warnings.push("CAPABILITY_OBSERVATION_REJECTED");

    let registry: PipelineCandidateResult["registry"] = "skipped";
    if (this.registryReader !== undefined) {
      try {
        const blockNumber = await this.registryReader.getLatestBlock();
        const blockHash = await this.registryReader.getTrustedBlockHash(blockNumber);
        if (blockHash === null) throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The registry block hash was unavailable.", "retry_chain_read", undefined, true);
        const state = await this.registryReader.readIdentity(candidate.identity, { blockNumber, blockHash });
        identityRecord = await this.repository.withTransaction(async (repository) => repository.applyCanonicalState({ identity: candidate.identity, ...state }));
        registry = "verified";
      } catch (error) {
        registry = "failed";
        warnings.push(asWarning(error));
      }
    } else {
      warnings.push("DIRECT_REGISTRY_READER_NOT_CONFIGURED");
    }

    let metadata: PipelineCandidateResult["metadata"] = "skipped";
    let publicMetadata: Readonly<Record<string, unknown>> | null = null;
    let capabilityManifest: CapabilityManifest | null = null;
    let capabilityDigest: string | null = null;
    let services: readonly ServiceObservation[] = ingestionResult.services;
    let probes: readonly ServiceProbeResult[] = [];
    let category: CategoryClassification | null = null;
    let vector: PipelineCandidateResult["vector"] = null;
    const agentUri = identityRecord.agentUri;
    let registration: ReturnType<typeof parseAgentRegistrationMetadata> | null = null;

    // Candidate manifests have already passed the ingestion transaction when
    // present. Normalize once more here so the composition result can pass
    // the exact persisted shape to publication; invalid observations remain
    // withheld and are never repaired by guessing fields.
    if (candidate.capabilityManifest !== undefined) {
      try {
        const observation = normalizeCapabilityManifest(key, candidate.source, candidate.capabilityManifest, candidate.observedAt);
        capabilityManifest = observation.capabilityManifest as CapabilityManifest;
        capabilityDigest = observation.manifestDigest;
      } catch {
        warnings.push("CAPABILITY_OBSERVATION_REJECTED");
      }
    }
    if (this.metadataResolver !== undefined && agentUri !== null) {
      try {
        const resolution = await this.metadataResolver.resolve(agentUri, identityRecord.contentDigest);
        if (resolution.digestMatches === false) {
          throw ingestionError("METADATA_PARSE_FAILED", "The resolved metadata does not match the registry content digest.", "repair_metadata_digest");
        }
        registration = this.metadataResolver.parseRegistration(resolution);
        metadata = "resolved";
        publicMetadata = publicRecord(resolution.document);
        warnings.push(...registration.warnings);
        const metadataCapabilityManifest = explicitCapabilityManifest(resolution.document);
        if (metadataCapabilityManifest !== undefined) {
          try {
            const observation = normalizeCapabilityManifest(key, candidate.source, metadataCapabilityManifest, this.now());
            await this.repository.upsertCapabilities(observation);
            // A manifest in the registry document is the authoritative
            // enrichment for this read. A vendor candidate manifest remains
            // separately persisted, but is not substituted for it.
            capabilityManifest = observation.capabilityManifest as CapabilityManifest;
            capabilityDigest = observation.manifestDigest;
          } catch {
            warnings.push("CAPABILITY_OBSERVATION_REJECTED");
          }
        }
        const normalizedServices = normalizeServices(
          key,
          candidate.source,
          registration.services.map(registrationServiceInput),
          capabilityDigest,
          this.now()
        );
        const mergedServices = new Map<string, ServiceObservation>(
          services.map((service) => [`${service.kind}:${service.url}`, service])
        );
        for (const service of normalizedServices.accepted) mergedServices.set(`${service.kind}:${service.url}`, service);
        services = [...mergedServices.values()].sort((left, right) => `${left.kind}:${left.url}`.localeCompare(`${right.kind}:${right.url}`));
        for (const service of normalizedServices.accepted) await this.repository.upsertService(service);
        for (const rejected of normalizedServices.rejected) warnings.push(`SERVICE_REJECTED:${rejected.reason.slice(0, 160)}`);
      } catch (error) {
        metadata = "failed";
        warnings.push(asWarning(error));
      }
    } else if (agentUri === null) {
      warnings.push("AGENT_URI_NOT_AVAILABLE_AT_VERIFIED_BLOCK");
    } else {
      warnings.push("METADATA_RESOLVER_NOT_CONFIGURED");
    }

    // Probe every explicitly observed service, including one supplied by a
    // manual/import candidate when metadata resolution is unavailable. The
    // transport remains bounded and the probe result is persisted as an
    // observation; a probe never upgrades an identity or listing state.
    if (this.serviceProbe !== undefined && services.length > 0) {
      try {
        probes = await this.serviceProbe.probeManyAndPersist(this.repository, services, this.serviceProbeOptions);
      } catch {
        warnings.push("SERVICE_PROBE_FAILED");
      }
    }

    try {
      const categoryInput: CategoryClassificationInput = {
        ...(registration?.name === null || registration?.name === undefined
          ? candidate.metadata?.name === undefined ? {} : { name: candidate.metadata.name }
          : { name: registration.name }),
        ...(registration?.description === null || registration?.description === undefined
          ? candidate.metadata?.description === undefined ? {} : { description: candidate.metadata.description }
          : { description: registration.description }),
        protocols: [...(registration?.protocols ?? []), ...(registration?.skills ?? [])],
        capabilities: capabilityManifest,
        ...(publicMetadata === null
          ? candidate.metadata === undefined ? {} : { metadata: candidate.metadata }
          : { metadata: publicMetadata }),
        agentCard: probes.filter((probe) => probe.kind === "a2a").map((probe) => probe.safeCapabilityProbe).filter((probe) => probe !== null),
        mcpCapabilities: probes.filter((probe) => probe.kind === "mcp").map((probe) => probe.safeCapabilityProbe).filter((probe) => probe !== null)
      };
      const categoryInputWithRegistration: CategoryClassificationInput = registration === null
        ? categoryInput
        : { ...categoryInput, skills: registration.skills, domains: registration.domains };
      category = this.classifier.classify(categoryInputWithRegistration);
      if (this.categorySink !== undefined) await this.categorySink.save({ identityKey: key, classification: category });
    } catch (error) {
      warnings.push(asWarning(error));
    }

    if (this.gates.MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED) {
      if (this.embeddingProvider === undefined || this.vectorRepository === undefined || this.versionIdForIdentity === undefined) {
        warnings.push("SEMANTIC_INDEX_NOT_CONFIGURED");
      } else if (category !== null && registry === "verified" && metadata === "resolved") {
        try {
          const versionId = await this.versionIdForIdentity(candidate.identity);
          if (versionId === null) {
            warnings.push("SEMANTIC_VERSION_NOT_AVAILABLE");
          } else {
            const semanticInput: SemanticDocumentInput = {
              identity: candidate.identity,
              category: category.category,
              evidenceSummary: { registry: registry, metadata: metadata },
              classifierVersion: category.classifierVersion
            };
            // Candidate metadata is discovery input and is not authoritative.
            // Once enrichment succeeds, only the resolved registration fields
            // may enter the provider document.
            const semanticName = registration?.name;
            const semanticDescription = registration?.description;
            const completeSemanticInput: SemanticDocumentInput = {
              ...semanticInput,
              ...(semanticName === undefined ? {} : { name: semanticName }),
              ...(semanticDescription === undefined ? {} : { description: semanticDescription }),
              ...(capabilityManifest === null ? {} : { capabilityManifest }),
              ...(registration === null ? {} : {
                protocols: registration.protocols,
                actions: registration.skills,
                services: registration.services
              })
            };
            const document = buildSemanticDocument(completeSemanticInput);
            vector = await ensureSemanticVector({ agentVersionId: versionId, document, classifierVersion: category.classifierVersion, provider: this.embeddingProvider, now: this.now() }, this.vectorRepository);
          }
        } catch (error) {
          warnings.push(asWarning(error));
        }
      } else if (category !== null) {
        warnings.push("SEMANTIC_REQUIRES_VERIFIED_ENRICHMENT");
      }
    } else {
      warnings.push("MARKETPLACE_SEMANTIC_RETRIEVAL_DISABLED");
    }
    return {
      identityKey: key,
      ingestion: "completed",
      registry,
      metadata,
      publicMetadata,
      capabilityManifest,
      services,
      probes,
      category,
      vector,
      warnings: [...new Set(warnings)]
    };
  }
}

export async function runErc8004Pipeline(options: Erc8004PipelineOptions, query: EightHundredFourScanQuery = {}): Promise<PipelineRunResult> {
  return new Erc8004Pipeline(options).discover(query);
}

/**
 * Compose the gated pipeline from runtime configuration. This is the server
 * wiring point used by an E2E harness; it never enables a gate that the
 * caller's runtime configuration did not explicitly enable.
 */
export function createErc8004PipelineFromRuntimeConfig(options: RuntimeConfiguredPipelineOptions): Erc8004Pipeline {
  const { runtimeConfig, resolveEmbeddingSecret, embeddingProviderOptions, embeddingProvider: providedEmbeddingProvider, ...pipelineOptions } = options;
  let embeddingProvider: EmbeddingProvider | undefined = providedEmbeddingProvider;
  if (runtimeConfig.marketplaceSemanticRetrievalEnabled) {
    if (embeddingProvider === undefined) {
      if (resolveEmbeddingSecret === undefined) {
        throw ingestionError("EMBEDDING_CONFIG_INVALID", "Semantic retrieval requires a server-side embedding secret resolver.", "configure_embedding_secret");
      }
      embeddingProvider = createEmbeddingProviderFromRuntimeConfig(runtimeConfig, resolveEmbeddingSecret, embeddingProviderOptions);
    } else if (runtimeConfig.embedding !== null) {
      const validated = validateEmbeddingProvider(embeddingProvider);
      if (validated.provider !== runtimeConfig.embedding.provider ||
        validated.model !== runtimeConfig.embedding.model ||
        validated.modelVersion !== runtimeConfig.embedding.modelVersion ||
        validated.dimension !== runtimeConfig.embedding.dimension) {
        throw ingestionError("EMBEDDING_CONFIG_INVALID", "The injected embedding provider does not match runtime configuration.", "fix_embedding_configuration");
      }
      embeddingProvider = validated;
    }
  }
  return new Erc8004Pipeline({
    ...pipelineOptions,
    ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
    gates: {
      ERC8004_INGESTION_ENABLED: runtimeConfig.erc8004IngestionEnabled,
      ERC8004SCAN_DISCOVERY_ENABLED: runtimeConfig.erc8004ScanDiscoveryEnabled,
      MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: runtimeConfig.marketplaceSemanticRetrievalEnabled
    }
  });
}

/** One-shot server entry point for scheduled jobs and deterministic E2E harnesses. */
export async function runErc8004PipelineFromRuntimeConfig(
  options: RuntimeConfiguredPipelineOptions,
  query: EightHundredFourScanQuery = {}
): Promise<PipelineRunResult> {
  return createErc8004PipelineFromRuntimeConfig(options).discover(query);
}
