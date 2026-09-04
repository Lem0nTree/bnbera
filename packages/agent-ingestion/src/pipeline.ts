import type { RuntimeConfig } from "@bnbera/config";
import { erc8004IdentityKey, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { AgentIngestionService } from "./ingestion.js";
import { BoundedMetadataResolver, parseAgentRegistrationMetadata } from "./metadata.js";
import { normalizeCapabilityManifest, normalizeServices } from "./normalize.js";
import { type CategoryClassification, type CategoryClassificationInput, DeterministicCategoryClassifier } from "./categorization.js";
import { buildSemanticDocument, validateEmbeddingProvider, type EmbeddingProvider, type SemanticDocumentInput } from "./semantic.js";
import type { EightHundredFourScanAdapter, EightHundredFourScanQuery } from "./adapters/8004scan.js";
import type { RegistryChainReader } from "./adapters/registry.js";
import type { IdentityCandidate, IdentityRecord, IngestionRepository } from "./types.js";
import { ensureSemanticVector, type SemanticVectorRepository, type SemanticVectorRecord } from "./vector.js";
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
    try {
      identityRecord = (await this.ingestion.ingestCandidate(candidate)).identity;
    } catch (error) {
      return { identityKey: key, ingestion: "failed", registry: "skipped", metadata: "skipped", category: null, vector: null, warnings: [asWarning(error)] };
    }

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
    let category: CategoryClassification | null = null;
    let vector: PipelineCandidateResult["vector"] = null;
    const agentUri = identityRecord.agentUri;
    let registration: ReturnType<typeof parseAgentRegistrationMetadata> | null = null;
    if (this.metadataResolver !== undefined && agentUri !== null) {
      try {
        const resolution = await this.metadataResolver.resolve(agentUri, identityRecord.contentDigest);
        if (resolution.digestMatches === false) {
          throw ingestionError("METADATA_PARSE_FAILED", "The resolved metadata does not match the registry content digest.", "repair_metadata_digest");
        }
        registration = this.metadataResolver.parseRegistration(resolution);
        metadata = "resolved";
        warnings.push(...registration.warnings);
        const capabilityManifest = candidate.capabilityManifest;
        if (capabilityManifest !== undefined) {
          try {
            await this.repository.upsertCapabilities(normalizeCapabilityManifest(key, candidate.source, capabilityManifest, this.now()));
          } catch (error) {
            warnings.push(asWarning(error));
          }
        }
        const normalizedServices = normalizeServices(key, candidate.source, registration.services, null, this.now());
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

    try {
      const categoryInput: CategoryClassificationInput = {
        ...(registration?.name === null || registration?.name === undefined
          ? candidate.metadata?.name === undefined ? {} : { name: candidate.metadata.name }
          : { name: registration.name }),
        ...(registration?.description === null || registration?.description === undefined
          ? candidate.metadata?.description === undefined ? {} : { description: candidate.metadata.description }
          : { description: registration.description }),
        protocols: [...(registration?.protocols ?? []), ...(registration?.skills ?? [])],
        capabilities: candidate.capabilityManifest,
        ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata })
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
              ...(candidate.capabilityManifest === undefined ? {} : { capabilityManifest: candidate.capabilityManifest }),
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
    return { identityKey: key, ingestion: "completed", registry, metadata, category, vector, warnings: [...new Set(warnings)] };
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
