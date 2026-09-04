import {
  semanticDocumentSchemaVersion,
  validateEmbeddingProvider,
  type EmbeddingProvider,
  type SemanticVectorRepository
} from "@bnbera/agent-ingestion";
import type { MarketplaceSearchRequest } from "./types.js";

export type MarketplaceSemanticHit = {
  readonly identityKey: string;
  readonly similarity: number;
  readonly modelVersion: string;
};

export interface MarketplaceSemanticRetriever {
  /** Candidate keys have already passed marketplace hard eligibility. */
  search(input: { readonly request: MarketplaceSearchRequest; readonly candidateIdentityKeys: readonly string[] }): Promise<readonly MarketplaceSemanticHit[]>;
}

export type VectorMarketplaceRetrieverOptions = {
  readonly versionIdForIdentityKey: (identityKey: string) => string | null | Promise<string | null>;
  readonly identityKeyForVersionId: (agentVersionId: string) => string | null | Promise<string | null>;
  readonly modelVersion?: string;
  readonly semanticDocumentSchemaVersion?: string;
  readonly limit?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizedCandidateKeys(keys: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const normalized = key.trim();
    if (normalized.length > 0) unique.add(normalized);
  }
  return [...unique];
}

function compareIdentityKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validSimilarity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Bridges the versioned pgvector repository to the marketplace identity key. */
export class VectorMarketplaceSemanticRetriever implements MarketplaceSemanticRetriever {
  private readonly provider: EmbeddingProvider;
  private readonly repository: SemanticVectorRepository;
  private readonly options: VectorMarketplaceRetrieverOptions;
  private readonly modelVersion: string;
  private readonly documentSchemaVersion: string;
  private readonly limit: number;

  public constructor(provider: EmbeddingProvider, repository: SemanticVectorRepository, options: VectorMarketplaceRetrieverOptions) {
    if (typeof options.versionIdForIdentityKey !== "function" || typeof options.identityKeyForVersionId !== "function") {
      throw new Error("semantic retriever identity mapping is invalid");
    }
    this.provider = validateEmbeddingProvider(provider);
    this.repository = repository;
    this.options = options;
    this.modelVersion = options.modelVersion === undefined ? this.provider.modelVersion : options.modelVersion.trim();
    this.documentSchemaVersion = options.semanticDocumentSchemaVersion === undefined
      ? semanticDocumentSchemaVersion
      : options.semanticDocumentSchemaVersion.trim();
    this.limit = options.limit ?? 20;
    if (this.modelVersion.length === 0 || this.documentSchemaVersion.length === 0) {
      throw new Error("semantic retriever version configuration is invalid");
    }
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 100) {
      throw new Error("semantic retriever result limit is invalid");
    }
  }

  async search(input: { readonly request: MarketplaceSearchRequest; readonly candidateIdentityKeys: readonly string[] }): Promise<readonly MarketplaceSemanticHit[]> {
    if (input.request.query.trim().length === 0) return [];
    const candidateKeys = normalizedCandidateKeys(input.candidateIdentityKeys);
    if (candidateKeys.length === 0) return [];
    if (this.modelVersion !== this.provider.modelVersion) {
      // A query embedding produced under one version must never be ranked
      // against rows from another version. Let the read model turn this into
      // its explicit deterministic fallback.
      throw new Error("semantic embedding and vector index versions are incompatible");
    }
    const resolved = await Promise.all(candidateKeys.map(async (key) => ({
      key,
      versionId: await this.options.versionIdForIdentityKey(key)
    })));
    const versionToKey = new Map<string, string>();
    const versionIds: string[] = [];
    for (const item of resolved) {
      if (item.versionId === null) continue;
      if (typeof item.versionId !== "string" || !uuidPattern.test(item.versionId)) {
        throw new Error("semantic retriever returned an invalid agent version identifier");
      }
      const versionId = item.versionId.toLowerCase();
      const previousKey = versionToKey.get(versionId);
      if (previousKey !== undefined && previousKey !== item.key) {
        // Two public identities resolving to one version would make the
        // reverse mapping ambiguous and can cross a tenant boundary.
        throw new Error("semantic retriever identity mapping is ambiguous");
      }
      if (previousKey === undefined) {
        versionToKey.set(versionId, item.key);
        versionIds.push(versionId);
      }
    }
    if (versionIds.length === 0) return [];
    let vector: readonly number[];
    try { vector = await this.provider.embed(input.request.query.trim()); } catch (cause) { throw new Error("semantic embedding provider failed", { cause }); }
    if (!Array.isArray(vector) || vector.length !== this.provider.dimension || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("semantic embedding dimension mismatch");
    const normSquared = vector.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(normSquared) || normSquared === 0) throw new Error("semantic embedding returned an unusable vector");
    const rows = await this.repository.search({
      vector,
      provider: this.provider.provider,
      model: this.provider.model,
      modelVersion: this.modelVersion,
      dimension: this.provider.dimension,
      semanticDocumentSchemaVersion: this.documentSchemaVersion,
      publicOnly: true,
      candidateAgentVersionIds: versionIds,
      limit: this.limit
    });
    const hitsByIdentity = new Map<string, MarketplaceSemanticHit>();
    for (const row of rows) {
      if (
        typeof row.agentVersionId !== "string" ||
        !uuidPattern.test(row.agentVersionId) ||
        row.provider !== this.provider.provider ||
        row.model !== this.provider.model ||
        row.modelVersion !== this.modelVersion ||
        row.dimension !== this.provider.dimension ||
        row.semanticDocumentSchemaVersion !== this.documentSchemaVersion ||
        !validSimilarity(row.similarity)
      ) continue;
      const versionId = row.agentVersionId.toLowerCase();
      const expectedKey = versionToKey.get(versionId);
      if (expectedKey === undefined) continue;
      const key = await this.options.identityKeyForVersionId(row.agentVersionId);
      if (key === null || typeof key !== "string" || key.trim() !== expectedKey) continue;
      const hit: MarketplaceSemanticHit = {
        identityKey: expectedKey,
        similarity: Math.max(-1, Math.min(1, row.similarity)),
        modelVersion: this.modelVersion
      };
      const previous = hitsByIdentity.get(expectedKey);
      if (previous === undefined || hit.similarity > previous.similarity) hitsByIdentity.set(expectedKey, hit);
    }
    return [...hitsByIdentity.values()].sort((a, b) => b.similarity - a.similarity || compareIdentityKeys(a.identityKey, b.identityKey));
  }
}
