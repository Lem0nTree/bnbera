import { erc8004IdentityKey, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import type { Erc8004Pipeline, PipelineCandidateResult, PipelineCategorySink } from "./pipeline.js";
import type { IdentityCandidate, IngestionRepository } from "./types.js";
import { buildSemanticDocument, type EmbeddingProvider } from "./semantic.js";
import { ensureSemanticVector, type SemanticVectorRepository } from "./vector.js";

/**
 * The composition layer depends on a small structural publication port. The
 * concrete PostgreSQL implementation lives in `@bnbera/marketplace`; keeping
 * this port here prevents the ingestion package from depending back on the
 * marketplace package.
 */
export type MarketplaceCompositionPublicationInput = {
  readonly identity: Erc8004Identity;
  readonly publicMetadata: Readonly<Record<string, unknown>>;
  readonly capabilityManifest: unknown;
};

export type MarketplaceCompositionPublicationDiagnostic = {
  readonly code: string;
};

export type MarketplaceCompositionPublicationResult = {
  readonly status: "published" | "withheld";
  readonly versionId: string | null;
  readonly diagnostics: readonly MarketplaceCompositionPublicationDiagnostic[];
};

export interface MarketplaceCompositionPublisher {
  publish(input: MarketplaceCompositionPublicationInput): Promise<MarketplaceCompositionPublicationResult>;
}

export type Erc8004MarketplaceCompositionStageCounts = {
  readonly discovered: number;
  readonly chainRead: number;
  readonly metadataResolved: number;
  readonly capabilityComplete: number;
  readonly servicesObserved: number;
  readonly serviceHealthy: number;
  readonly versioned: number;
  readonly published: number;
  readonly withheld: number;
  readonly categoriesPersisted: number;
  readonly failed: number;
};

export type Erc8004MarketplaceCompositionCandidateResult = {
  readonly identityKey: string;
  readonly status: "published" | "withheld" | "failed";
  readonly pipeline: Pick<PipelineCandidateResult, "ingestion" | "registry" | "metadata">;
  readonly versionId: string | null;
  readonly diagnostics: readonly string[];
};

export type Erc8004MarketplaceCompositionResult = {
  readonly status: "disabled" | "completed" | "degraded";
  readonly candidateCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly stageCounts: Erc8004MarketplaceCompositionStageCounts;
  /** Stable codes only; provider payloads and error messages never leave this boundary. */
  readonly reasons: Readonly<Record<string, number>>;
  readonly candidates: readonly Erc8004MarketplaceCompositionCandidateResult[];
};

export type Erc8004MarketplaceCompositionOptions = {
  readonly repository: IngestionRepository;
  readonly pipeline: Erc8004Pipeline;
  readonly publisher: MarketplaceCompositionPublisher;
  /** Called only after publication has returned a real immutable version ID. */
  readonly categorySink?: PipelineCategorySink;
  /**
   * Semantic indexing is deliberately owned by composition rather than the
   * enrichment pipeline. This keeps vectors behind the publication boundary:
   * only a category-bearing, immutable, published version may be indexed.
   */
  readonly semanticEmbeddingEnabled?: boolean;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly vectorRepository?: SemanticVectorRepository;
  readonly maxCandidates?: number;
};

export type Erc8004MarketplaceCompositionRunOptions = {
  readonly candidates: readonly IdentityCandidate[];
  readonly signal?: AbortSignal;
};

const MAX_CANDIDATES = 20;
const diagnosticCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/u;

function boundedCandidateCount(value: number | undefined): number {
  const result = value ?? MAX_CANDIDATES;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_CANDIDATES) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The marketplace composition candidate bound is invalid.", "fix_composition_bound");
  }
  return result;
}

function safeDiagnosticCode(value: unknown): string {
  if (typeof value !== "string") return "PUBLICATION_WITHHELD";
  const code = value.trim().toUpperCase();
  return diagnosticCodePattern.test(code) ? code : "PUBLICATION_WITHHELD";
}

function addReason(reasons: Map<string, number>, code: string): void {
  reasons.set(code, (reasons.get(code) ?? 0) + 1);
}

function emptyStageCounts(): Erc8004MarketplaceCompositionStageCounts {
  return {
    discovered: 0,
    chainRead: 0,
    metadataResolved: 0,
    capabilityComplete: 0,
    servicesObserved: 0,
    serviceHealthy: 0,
    versioned: 0,
    published: 0,
    withheld: 0,
    categoriesPersisted: 0,
    failed: 0
  };
}

function incrementStage(
  counts: Erc8004MarketplaceCompositionStageCounts,
  field: keyof Erc8004MarketplaceCompositionStageCounts
): Erc8004MarketplaceCompositionStageCounts {
  return { ...counts, [field]: counts[field] + 1 };
}

function deduplicateCandidates(candidates: readonly IdentityCandidate[], maxCandidates: number): readonly IdentityCandidate[] {
  const seen = new Set<string>();
  const selected: IdentityCandidate[] = [];
  for (const candidate of candidates) {
    const key = erc8004IdentityKey(candidate.identity);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(candidate);
    if (selected.length >= maxCandidates) break;
  }
  return selected;
}

function pipelineSummary(result: PipelineCandidateResult): Pick<PipelineCandidateResult, "ingestion" | "registry" | "metadata"> {
  return { ingestion: result.ingestion, registry: result.registry, metadata: result.metadata };
}

/**
 * Run the durable enrichment/publication sequence for a bounded candidate
 * batch. Every candidate is isolated so a metadata, probe, or publication
 * failure remains visible while later candidates can continue. This runner
 * performs no chain writes. When explicitly configured, semantic indexing is
 * performed only after publication and category persistence have succeeded.
 */
export class Erc8004MarketplaceCompositionRunner {
  private readonly maxCandidates: number;

  public constructor(private readonly options: Erc8004MarketplaceCompositionOptions) {
    this.maxCandidates = boundedCandidateCount(options.maxCandidates);
  }

  public async run(options: Erc8004MarketplaceCompositionRunOptions): Promise<Erc8004MarketplaceCompositionResult> {
    const gates = this.options.pipeline.featureGates();
    if (!gates.ERC8004_INGESTION_ENABLED) {
      return {
        status: "disabled",
        candidateCount: 0,
        completedCount: 0,
        failedCount: 0,
        stageCounts: emptyStageCounts(),
        reasons: { ERC8004_INGESTION_DISABLED: 1 },
        candidates: []
      };
    }

    const candidates = deduplicateCandidates(options.candidates, this.maxCandidates);
    let stageCounts = { ...emptyStageCounts(), discovered: candidates.length };
    const reasons = new Map<string, number>();
    const results: Erc8004MarketplaceCompositionCandidateResult[] = [];

    for (const candidate of candidates) {
      const key = erc8004IdentityKey(candidate.identity);
      if (options.signal?.aborted === true) {
        stageCounts = incrementStage(stageCounts, "failed");
        addReason(reasons, "RUN_CANCELLED");
        results.push({
          identityKey: key,
          status: "failed",
          pipeline: { ingestion: "failed", registry: "skipped", metadata: "skipped" },
          versionId: null,
          diagnostics: ["RUN_CANCELLED"]
        });
        continue;
      }

      let pipelineResult: PipelineCandidateResult;
      try {
        pipelineResult = await this.options.pipeline.processCandidate(candidate);
      } catch {
        stageCounts = incrementStage(stageCounts, "failed");
        addReason(reasons, "PIPELINE_FAILED");
        results.push({
          identityKey: key,
          status: "failed",
          pipeline: { ingestion: "failed", registry: "skipped", metadata: "skipped" },
          versionId: null,
          diagnostics: ["PIPELINE_FAILED"]
        });
        continue;
      }

      if (pipelineResult.registry === "verified") stageCounts = incrementStage(stageCounts, "chainRead");
      else addReason(reasons, pipelineResult.registry === "failed" ? "CHAIN_READ_FAILED" : "CHAIN_READ_SKIPPED");
      if (pipelineResult.metadata === "resolved") stageCounts = incrementStage(stageCounts, "metadataResolved");
      else addReason(reasons, pipelineResult.metadata === "failed" ? "METADATA_FAILED" : "METADATA_SKIPPED");
      if (pipelineResult.capabilityManifest !== null) stageCounts = incrementStage(stageCounts, "capabilityComplete");
      else addReason(reasons, "CAPABILITY_MISSING");
      if (pipelineResult.services.length > 0) stageCounts = incrementStage(stageCounts, "servicesObserved");
      else addReason(reasons, "SERVICE_MISSING");
      if (pipelineResult.probes.some((probe) => probe.validationStatus === "healthy")) stageCounts = incrementStage(stageCounts, "serviceHealthy");
      else if (pipelineResult.services.length > 0) addReason(reasons, "SERVICE_HEALTH_UNVERIFIED");

      if (pipelineResult.ingestion === "failed") {
        stageCounts = incrementStage(stageCounts, "failed");
        addReason(reasons, "INGESTION_FAILED");
        results.push({ identityKey: key, status: "failed", pipeline: pipelineSummary(pipelineResult), versionId: null, diagnostics: ["INGESTION_FAILED"] });
        continue;
      }

      // An empty object is an intentionally invalid publication input when a
      // prerequisite is absent. It cannot be stored by the publication
      // service and prevents this composition layer from inventing metadata
      // or capability evidence.
      const publicationInput = {
        identity: candidate.identity,
        publicMetadata: pipelineResult.publicMetadata ?? {},
        capabilityManifest: pipelineResult.capabilityManifest ?? {}
      };
      let publication: MarketplaceCompositionPublicationResult;
      try {
        publication = await this.options.publisher.publish(publicationInput);
      } catch {
        stageCounts = incrementStage(stageCounts, "failed");
        addReason(reasons, "PUBLICATION_FAILED");
        results.push({ identityKey: key, status: "failed", pipeline: pipelineSummary(pipelineResult), versionId: null, diagnostics: ["PUBLICATION_FAILED"] });
        continue;
      }

      const diagnostics = publication.diagnostics.map((entry) => safeDiagnosticCode(entry.code));
      if (publication.versionId !== null) stageCounts = incrementStage(stageCounts, "versioned");
      else addReason(reasons, "VERSION_UNAVAILABLE");
      if (publication.status === "published") stageCounts = incrementStage(stageCounts, "published");
      else stageCounts = incrementStage(stageCounts, "withheld");
      if (publication.status === "withheld") {
        for (const diagnostic of diagnostics.length > 0 ? diagnostics : ["PUBLICATION_WITHHELD"]) addReason(reasons, diagnostic);
      }

      let categoryPersisted = false;
      if (publication.versionId !== null && pipelineResult.category !== null && this.options.categorySink !== undefined) {
        try {
          await this.options.categorySink.save({ identityKey: key, classification: pipelineResult.category });
          stageCounts = incrementStage(stageCounts, "categoriesPersisted");
          categoryPersisted = true;
        } catch {
          addReason(reasons, "CATEGORY_WRITE_FAILED");
        }
      } else if (pipelineResult.category !== null && this.options.categorySink !== undefined) {
        addReason(reasons, "CATEGORY_VERSION_UNAVAILABLE");
      }

      const semanticEnabled = this.options.semanticEmbeddingEnabled === true;
      const category = pipelineResult.category;
      let embeddingDiagnostic: string | null = null;
      if (publication.status === "published" && publication.versionId !== null && semanticEnabled) {
        if (this.options.embeddingProvider === undefined || this.options.vectorRepository === undefined) {
          addReason(reasons, "SEMANTIC_INDEX_NOT_CONFIGURED");
        } else if (!categoryPersisted || category === null) {
          // A vector without the versioned category projection would make the
          // semantic index observably ahead of the marketplace read model.
          addReason(reasons, "SEMANTIC_CATEGORY_NOT_PERSISTED");
        } else if (pipelineResult.registry !== "verified" || pipelineResult.metadata !== "resolved" || pipelineResult.publicMetadata === null) {
          addReason(reasons, "SEMANTIC_REQUIRES_VERIFIED_ENRICHMENT");
        } else {
          try {
            const metadata = pipelineResult.publicMetadata;
            const valueList = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
            const semanticDocument = buildSemanticDocument({
              identity: candidate.identity,
              category: category.category,
              ...(typeof metadata.name === "string" ? { name: metadata.name } : {}),
              ...(typeof metadata.description === "string" ? { description: metadata.description } : {}),
              ...(pipelineResult.capabilityManifest === null ? {} : { capabilityManifest: pipelineResult.capabilityManifest }),
              protocols: valueList(metadata.supportedProtocols ?? metadata.supported_protocols ?? metadata.protocols),
              actions: valueList(metadata.actions ?? metadata.skills),
              services: pipelineResult.services.map((service) => ({
                kind: service.kind,
                url: service.url,
                protocolVersion: service.protocolVersion
              })),
              evidenceSummary: { registry: pipelineResult.registry, metadata: pipelineResult.metadata },
              classifierVersion: category.classifierVersion
            });
            const vector = await ensureSemanticVector({
              agentVersionId: publication.versionId,
              document: semanticDocument,
              classifierVersion: category.classifierVersion,
              provider: this.options.embeddingProvider
            }, this.options.vectorRepository);
            embeddingDiagnostic = vector.generated ? "SEMANTIC_EMBEDDING_GENERATED" : "SEMANTIC_EMBEDDING_REUSED";
            addReason(reasons, embeddingDiagnostic);
          } catch {
            embeddingDiagnostic = "SEMANTIC_EMBEDDING_FAILED";
            addReason(reasons, embeddingDiagnostic);
          }
        }
      }

      if (publication.status === "published") {
        results.push({ identityKey: key, status: "published", pipeline: pipelineSummary(pipelineResult), versionId: publication.versionId, diagnostics: embeddingDiagnostic === null ? diagnostics : [...diagnostics, embeddingDiagnostic] });
      } else {
        results.push({ identityKey: key, status: "withheld", pipeline: pipelineSummary(pipelineResult), versionId: publication.versionId, diagnostics: diagnostics.length > 0 ? diagnostics : ["PUBLICATION_WITHHELD"] });
      }
    }

    const failedCount = results.filter((result) => result.status === "failed").length;
    const withheldCount = results.filter((result) => result.status === "withheld").length;
    const degradedStage = [
      "CATEGORY_WRITE_FAILED",
      "SEMANTIC_INDEX_NOT_CONFIGURED",
      "SEMANTIC_CATEGORY_NOT_PERSISTED",
      "SEMANTIC_REQUIRES_VERIFIED_ENRICHMENT",
      "SEMANTIC_EMBEDDING_FAILED"
    ].some((code) => reasons.has(code));
    return {
      status: failedCount > 0 || withheldCount > 0 || degradedStage ? "degraded" : "completed",
      candidateCount: results.length,
      completedCount: results.filter((result) => result.status !== "failed").length,
      failedCount,
      stageCounts: { ...stageCounts, failed: failedCount },
      reasons: Object.fromEntries([...reasons.entries()].sort(([left], [right]) => left.localeCompare(right))),
      candidates: results
    };
  }
}

export function createErc8004MarketplaceCompositionRunner(
  options: Erc8004MarketplaceCompositionOptions
): Erc8004MarketplaceCompositionRunner {
  return new Erc8004MarketplaceCompositionRunner(options);
}
