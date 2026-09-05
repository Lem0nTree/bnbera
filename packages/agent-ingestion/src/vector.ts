import pg from "pg";
import { ingestionError } from "./errors.js";
import { embedSemanticDocument, validateEmbeddingProvider, type EmbeddingProvider, type ValidatedEmbedding } from "./semantic.js";
import type { CanonicalSemanticDocument } from "./semantic.js";

export type SemanticVectorRecord = {
  readonly agentVersionId: string;
  readonly embedding: readonly number[];
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly sourceTextDigest: string;
  readonly semanticDocumentSchemaVersion: string;
  readonly classifierVersion: string | null;
  readonly createdAt: Date;
};

export type SemanticVectorHit = SemanticVectorRecord & {
  readonly similarity: number;
};

export type VectorSearchQuery = {
  readonly vector: readonly number[];
  readonly provider?: string;
  readonly model?: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly semanticDocumentSchemaVersion?: string;
  /**
   * Restrict a PostgreSQL search to the currently published public projection.
   * Marketplace callers must also provide the already hard-filtered candidate
   * version ids; this prevents a semantic query from becoming a broad listing
   * disclosure when a tenant/visibility boundary has not been established.
   * In-memory repositories accept the flag for contract parity, but do not
   * own publication state and therefore rely on the candidate set supplied by
   * the caller.
   */
  readonly publicOnly?: boolean;
  readonly candidateAgentVersionIds?: readonly string[];
  readonly limit?: number;
};

/** All immutable inputs that identify one semantic index entry. */
export type SemanticVectorIdentity = {
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly sourceTextDigest: string;
  readonly semanticDocumentSchemaVersion: string;
};

export interface SemanticVectorRepository {
  find(agentVersionId: string, modelVersion: string, identity?: SemanticVectorIdentity): Promise<SemanticVectorRecord | null>;
  upsert(record: SemanticVectorRecord): Promise<SemanticVectorRecord>;
  search(query: VectorSearchQuery): Promise<readonly SemanticVectorHit[]>;
}

const digestPattern = /^[0-9a-f]{64}$/iu;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function safeLabel(value: string, field: string, max = 128): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) throw ingestionError("EMBEDDING_CONFIG_INVALID", `The embedding ${field} is invalid.`, "fix_embedding_configuration");
  return normalized;
}

function assertUuid(value: string): string {
  if (!uuidPattern.test(value)) throw ingestionError("REPOSITORY_FAILURE", "The semantic vector version identifier is invalid.", "fix_vector_reference");
  return value.toLowerCase();
}

function assertDigest(value: string, field: string): string {
  if (!digestPattern.test(value)) throw ingestionError("REPOSITORY_FAILURE", `The semantic vector ${field} is invalid.`, "fix_vector_reference");
  return value.toLowerCase();
}

function assertVector(vector: readonly number[], dimension: number): readonly number[] {
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384 || !Array.isArray(vector) || vector.length !== dimension || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw ingestionError("EMBEDDING_DIMENSION_MISMATCH", "The vector dimension or values are invalid.", "fix_embedding_provider");
  }
  // pgvector does not index zero vectors for cosine distance. Rejecting them
  // at the boundary keeps exact and approximate paths consistent and makes a
  // bad provider response degrade to the marketplace's deterministic path.
  const normSquared = vector.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(normSquared) || normSquared === 0) {
    throw ingestionError("EMBEDDING_RESPONSE_INVALID", "The vector must have a non-zero magnitude for cosine retrieval.", "fix_embedding_provider");
  }
  return vector.map((value) => Object.is(value, -0) ? 0 : value);
}

function candidateIds(value: readonly string[] | undefined): readonly string[] | null {
  if (value === undefined) return null;
  const unique = new Map<string, string>();
  for (const id of value) {
    const validated = assertUuid(id);
    const key = validated.toLowerCase();
    if (!unique.has(key)) unique.set(key, validated);
  }
  return [...unique.values()];
}

function assertCompatibleVectorVersions(
  existing: SemanticVectorRecord,
  requested: SemanticVectorRecord
): void {
  // A source document may legitimately be refreshed for the same reviewed
  // model version. Provider/model/dimension/schema changes are different: the
  // row would no longer describe the index it belongs to and must be rebuilt
  // under a new modelVersion/table migration instead of being overwritten.
  if (
    existing.provider !== requested.provider ||
    existing.model !== requested.model ||
    existing.modelVersion !== requested.modelVersion ||
    existing.dimension !== requested.dimension ||
    existing.semanticDocumentSchemaVersion !== requested.semanticDocumentSchemaVersion
  ) {
    throw ingestionError(
      "EMBEDDING_VERSION_CONFLICT",
      "The existing vector uses an incompatible provider, model, dimension, or document schema.",
      "install_matching_vector_index"
    );
  }
}

function normalizedRecord(record: SemanticVectorRecord): SemanticVectorRecord {
  const agentVersionId = assertUuid(record.agentVersionId);
  const provider = safeLabel(record.provider, "provider");
  const model = safeLabel(record.model, "model");
  const modelVersion = safeLabel(record.modelVersion, "model version");
  const dimension = record.dimension;
  const embedding = assertVector(record.embedding, dimension);
  const sourceTextDigest = assertDigest(record.sourceTextDigest, "source text digest");
  const semanticDocumentSchemaVersion = safeLabel(record.semanticDocumentSchemaVersion, "semantic document schema version");
  const classifierVersion = record.classifierVersion === null ? null : safeLabel(record.classifierVersion, "classifier version", 64);
  if (!(record.createdAt instanceof Date) || !Number.isFinite(record.createdAt.valueOf())) throw ingestionError("REPOSITORY_FAILURE", "The semantic vector creation timestamp is invalid.", "fix_vector_reference");
  return { ...record, agentVersionId, provider, model, modelVersion, dimension, embedding, sourceTextDigest, semanticDocumentSchemaVersion, classifierVersion };
}

function normalizedIdentity(identity: SemanticVectorIdentity): SemanticVectorIdentity {
  const provider = safeLabel(identity.provider, "provider");
  const model = safeLabel(identity.model, "model");
  const modelVersion = safeLabel(identity.modelVersion, "model version");
  const dimension = identity.dimension;
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384) {
    throw ingestionError("EMBEDDING_DIMENSION_MISMATCH", "The embedding identity dimension is invalid.", "fix_embedding_provider");
  }
  return {
    provider,
    model,
    modelVersion,
    dimension,
    sourceTextDigest: assertDigest(identity.sourceTextDigest, "source text digest"),
    semanticDocumentSchemaVersion: safeLabel(identity.semanticDocumentSchemaVersion, "semantic document schema version")
  };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

/** Deterministic repository used by unit tests and local fallback retrieval. */
export class InMemorySemanticVectorRepository implements SemanticVectorRepository {
  private readonly records = new Map<string, SemanticVectorRecord>();

  async find(agentVersionId: string, modelVersion: string, identity?: SemanticVectorIdentity): Promise<SemanticVectorRecord | null> {
    const id = assertUuid(agentVersionId);
    const requestedModelVersion = safeLabel(modelVersion, "model version");
    const record = this.records.get(`${id}:${requestedModelVersion}`) ?? null;
    if (record === null || identity === undefined) return record;
    const expected = normalizedIdentity(identity);
    if (expected.modelVersion !== requestedModelVersion) {
      throw ingestionError("REPOSITORY_FAILURE", "The semantic vector model version key is inconsistent.", "fix_vector_reference");
    }
    return record.provider === expected.provider &&
      record.model === expected.model &&
      record.modelVersion === expected.modelVersion &&
      record.dimension === expected.dimension &&
      record.sourceTextDigest === expected.sourceTextDigest &&
      record.semanticDocumentSchemaVersion === expected.semanticDocumentSchemaVersion
      ? record
      : null;
  }

  async upsert(record: SemanticVectorRecord): Promise<SemanticVectorRecord> {
    const normalized = normalizedRecord(record);
    const existing = this.records.get(`${normalized.agentVersionId}:${normalized.modelVersion}`);
    if (existing !== undefined) assertCompatibleVectorVersions(existing, normalized);
    this.records.set(`${normalized.agentVersionId}:${normalized.modelVersion}`, normalized);
    return normalized;
  }

  async search(query: VectorSearchQuery): Promise<readonly SemanticVectorHit[]> {
    const modelVersion = safeLabel(query.modelVersion, "model version");
    const dimension = query.dimension;
    const vector = assertVector(query.vector, dimension);
    const candidateList = candidateIds(query.candidateAgentVersionIds);
    if (query.publicOnly === true && candidateList === null) {
      throw ingestionError("REPOSITORY_FAILURE", "A public semantic search requires a hard-filtered candidate set.", "provide_marketplace_candidates");
    }
    const candidates = candidateList === null ? null : new Set(candidateList.map((id) => id.toLowerCase()));
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw ingestionError("EMBEDDING_CONFIG_INVALID", "The vector result limit is invalid.", "fix_vector_query");
    if (candidateList !== null && candidateList.length === 0) return [];
    return [...this.records.values()]
      .filter((record) => record.modelVersion === modelVersion && record.dimension === dimension)
      .filter((record) => query.provider === undefined || record.provider === query.provider)
      .filter((record) => query.model === undefined || record.model === query.model)
      .filter((record) => query.semanticDocumentSchemaVersion === undefined || record.semanticDocumentSchemaVersion === query.semanticDocumentSchemaVersion)
      .filter((record) => candidates === null || candidates.has(record.agentVersionId))
      .map((record) => ({ ...record, similarity: cosineSimilarity(vector, record.embedding) }))
      .sort((a, b) => b.similarity - a.similarity || a.agentVersionId.localeCompare(b.agentVersionId))
      .slice(0, limit);
  }
}

export type PgVectorQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

/** The checked-in migration currently exposes vector(1536). */
export const pgVectorStorageDimension = 1536 as const;

export type PgVectorSemanticRepositoryOptions = {
  /** Override only when a reviewed dimension-specific migration is active. */
  readonly storageDimension?: number;
};

type VectorDbRow = {
  agent_version_id: string;
  embedding: string | readonly number[];
  provider: string;
  model: string;
  model_version: string;
  dimension: number | string;
  source_text_digest: string;
  semantic_document_schema_version: string;
  classifier_version: string | null;
  createdAt: Date;
};

function vectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => String(value)).join(",")}]`;
}

function vectorFromRow(value: string | readonly number[], dimension: number): readonly number[] {
  const vector: readonly number[] = typeof value === "string"
    ? value.replace(/^\[|\]$/gu, "").split(",").filter((part: string) => part.length > 0).map(Number)
    : value;
  return assertVector(vector, dimension);
}

function rowDimension(value: number | string): number {
  const dimension = typeof value === "number"
    ? value
    : /^(0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384) {
    throw ingestionError("EMBEDDING_DIMENSION_MISMATCH", "The persisted vector dimension is invalid.", "repair_vector_repository");
  }
  return dimension;
}

function rowToRecord(row: VectorDbRow): SemanticVectorRecord {
  const dimension = rowDimension(row.dimension);
  return normalizedRecord({
    agentVersionId: row.agent_version_id,
    embedding: vectorFromRow(row.embedding, dimension),
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
    dimension,
    sourceTextDigest: row.source_text_digest,
    semanticDocumentSchemaVersion: row.semantic_document_schema_version,
    classifierVersion: row.classifier_version,
    createdAt: row.createdAt
  });
}

/**
 * PostgreSQL/pgvector adapter. The configured provider/model/version/dimension
 * are always supplied by the caller; this class has no model default and does
 * not alter incompatible vectors in place.
 */
export class PgVectorSemanticRepository implements SemanticVectorRepository {
  private readonly storageDimension: number;

  public constructor(
    private readonly queryable: PgVectorQueryable,
    options: PgVectorSemanticRepositoryOptions = {}
  ) {
    const dimension = options.storageDimension ?? pgVectorStorageDimension;
    if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384) throw ingestionError("EMBEDDING_CONFIG_INVALID", "The pgvector storage dimension is invalid.", "fix_vector_migration");
    this.storageDimension = dimension;
  }

  async find(agentVersionId: string, modelVersion: string, identity?: SemanticVectorIdentity): Promise<SemanticVectorRecord | null> {
    const requestedModelVersion = safeLabel(modelVersion, "model version");
    const values: unknown[] = [assertUuid(agentVersionId), requestedModelVersion];
    const clauses = ["agent_version_id = $1", "model_version = $2"];
    if (identity !== undefined) {
      const expected = normalizedIdentity(identity);
      if (expected.modelVersion !== requestedModelVersion) {
        throw ingestionError("REPOSITORY_FAILURE", "The semantic vector model version key is inconsistent.", "fix_vector_reference");
      }
      values.push(expected.provider, expected.model, expected.dimension, expected.sourceTextDigest, expected.semanticDocumentSchemaVersion);
      clauses.push(`provider = $${values.length - 4}`, `model = $${values.length - 3}`, `dimension = $${values.length - 2}`, `source_text_digest = $${values.length - 1}`, `semantic_document_schema_version = $${values.length}`);
    }
    const result = await this.queryable.query<VectorDbRow>(
      `SELECT agent_version_id, embedding, provider, model, model_version, dimension,
              source_text_digest, semantic_document_schema_version, classifier_version, "createdAt"
         FROM agent_listing_embeddings
        WHERE ${clauses.join(" AND ")}
        LIMIT 1`,
      values
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const record = rowToRecord(row);
    this.assertStorageDimension(record.dimension);
    return record;
  }

  async upsert(record: SemanticVectorRecord): Promise<SemanticVectorRecord> {
    const normalized = normalizedRecord(record);
    this.assertStorageDimension(normalized.dimension);
    const result = await this.queryable.query<VectorDbRow>(
      `INSERT INTO agent_listing_embeddings
         (agent_version_id, embedding, provider, model, model_version, dimension,
          source_text_digest, semantic_document_schema_version, classifier_version, "createdAt")
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (agent_version_id, model_version) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         dimension = EXCLUDED.dimension,
         source_text_digest = EXCLUDED.source_text_digest,
         semantic_document_schema_version = EXCLUDED.semantic_document_schema_version,
         classifier_version = EXCLUDED.classifier_version,
         "createdAt" = EXCLUDED."createdAt"
       WHERE agent_listing_embeddings.provider = EXCLUDED.provider
         AND agent_listing_embeddings.model = EXCLUDED.model
         AND agent_listing_embeddings.dimension = EXCLUDED.dimension
         AND agent_listing_embeddings.semantic_document_schema_version = EXCLUDED.semantic_document_schema_version
       RETURNING agent_version_id, embedding, provider, model, model_version, dimension,
                 source_text_digest, semantic_document_schema_version, classifier_version, "createdAt"`,
      [normalized.agentVersionId, vectorLiteral(normalized.embedding), normalized.provider, normalized.model, normalized.modelVersion, normalized.dimension, normalized.sourceTextDigest, normalized.semanticDocumentSchemaVersion, normalized.classifierVersion, normalized.createdAt]
    );
    const row = result.rows[0];
    if (row === undefined) {
      // PostgreSQL returns no row when the unique key exists but the version
      // compatibility predicate above rejected the update. Read it only to
      // classify the conflict; no incompatible row is ever mutated.
      const existing = await this.find(normalized.agentVersionId, normalized.modelVersion);
      if (existing !== null) assertCompatibleVectorVersions(existing, normalized);
      throw ingestionError("REPOSITORY_FAILURE", "The vector upsert returned no row.", "retry_vector_repository", undefined, true);
    }
    const persisted = rowToRecord(row);
    this.assertStorageDimension(persisted.dimension);
    return persisted;
  }

  async search(query: VectorSearchQuery): Promise<readonly SemanticVectorHit[]> {
    this.assertStorageDimension(query.dimension);
    const vector = assertVector(query.vector, query.dimension);
    const modelVersion = safeLabel(query.modelVersion, "model version");
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw ingestionError("EMBEDDING_CONFIG_INVALID", "The vector result limit is invalid.", "fix_vector_query");
    const candidateList = candidateIds(query.candidateAgentVersionIds);
    if (query.publicOnly === true && candidateList === null) {
      throw ingestionError("REPOSITORY_FAILURE", "A public semantic search requires a hard-filtered candidate set.", "provide_marketplace_candidates");
    }
    if (candidateList !== null && candidateList.length === 0) return [];
    const values: unknown[] = [vectorLiteral(vector), modelVersion, query.dimension];
    const clauses = ["model_version = $2", "dimension = $3"];
    if (query.provider !== undefined) { values.push(safeLabel(query.provider, "provider")); clauses.push(`provider = $${values.length}`); }
    if (query.model !== undefined) { values.push(safeLabel(query.model, "model")); clauses.push(`model = $${values.length}`); }
    if (query.semanticDocumentSchemaVersion !== undefined) { values.push(safeLabel(query.semanticDocumentSchemaVersion, "semantic document schema version")); clauses.push(`semantic_document_schema_version = $${values.length}`); }
    if (candidateList !== null) {
      values.push(candidateList);
      clauses.push(`agent_version_id = ANY($${values.length}::uuid[])`);
    }
    if (query.publicOnly === true) {
      // A vector is public only when it belongs to the current version of an
      // agent that is both published and visible in the read model. The
      // candidate ANY clause above remains the request-specific hard-filter
      // boundary; these joins protect against stale/delisted version ids.
      clauses.push("agents.current_version_id = agent_listing_embeddings.agent_version_id");
      clauses.push("agents.listing_status = 'published'");
      clauses.push("agents.verification_status IN ('verified', 'degraded')");
      clauses.push("agents.runtime_status = 'live'");
    }
    values.push(limit);
    const publicJoins = query.publicOnly === true
      ? "\n         INNER JOIN agent_versions ON agent_versions.id = agent_listing_embeddings.agent_version_id\n         INNER JOIN agents ON agents.id = agent_versions.agent_id"
      : "";
    const result = await this.queryable.query<VectorDbRow & { similarity: number }>(
      `SELECT agent_listing_embeddings.agent_version_id,
              agent_listing_embeddings.embedding,
              agent_listing_embeddings.provider,
              agent_listing_embeddings.model,
              agent_listing_embeddings.model_version,
              agent_listing_embeddings.dimension,
              agent_listing_embeddings.source_text_digest,
              agent_listing_embeddings.semantic_document_schema_version,
              agent_listing_embeddings.classifier_version,
              agent_listing_embeddings."createdAt",
              1 - (agent_listing_embeddings.embedding <=> $1::vector) AS similarity
         FROM agent_listing_embeddings
         ${publicJoins}
        WHERE ${clauses.join(" AND ")}
        ORDER BY agent_listing_embeddings.embedding <=> $1::vector,
                 agent_listing_embeddings.agent_version_id
        LIMIT $${values.length}`,
      values
    );
    return result.rows.map((row) => {
      const record = rowToRecord(row);
      this.assertStorageDimension(record.dimension);
      const similarity = Number(row.similarity);
      if (!Number.isFinite(similarity)) throw ingestionError("REPOSITORY_FAILURE", "The vector similarity result is invalid.", "repair_vector_repository");
      return { ...record, similarity: Math.max(-1, Math.min(1, similarity)) };
    });
  }

  private assertStorageDimension(dimension: number): void {
    if (dimension !== this.storageDimension) throw ingestionError("EMBEDDING_DIMENSION_MISMATCH", "The embedding dimension is incompatible with the configured pgvector migration.", "install_matching_vector_migration");
  }
}

/**
 * Run one or more vector operations on a single PostgreSQL client. This keeps
 * version lookup/upsert/backfill units atomic while still allowing callers to
 * use the repository directly for independent read operations.
 */
export async function withPgVectorTransaction<T>(
  pool: pg.Pool,
  operation: (repository: PgVectorSemanticRepository) => Promise<T>,
  options: PgVectorSemanticRepositoryOptions = {}
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(new PgVectorSemanticRepository(client, options));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original operation error; callers can alert on a failed
      // rollback through their pool/connection telemetry.
    }
    throw error;
  } finally {
    client.release();
  }
}

export type SemanticVectorBuildInput = {
  readonly agentVersionId: string;
  readonly document: CanonicalSemanticDocument;
  readonly classifierVersion: string | null;
  readonly provider: EmbeddingProvider;
  readonly now?: Date;
};

/** Idempotently skip provider work when the same document/model is present. */
export async function ensureSemanticVector(
  input: SemanticVectorBuildInput,
  repository: SemanticVectorRepository
): Promise<{ readonly record: SemanticVectorRecord; readonly generated: boolean }> {
  const provider = validateEmbeddingProvider(input.provider);
  const existing = await repository.find(input.agentVersionId, provider.modelVersion, {
    provider: provider.provider,
    model: provider.model,
    modelVersion: provider.modelVersion,
    dimension: provider.dimension,
    sourceTextDigest: input.document.digest,
    semanticDocumentSchemaVersion: input.document.schemaVersion
  });
  if (existing !== null) return { record: existing, generated: false };
  const embedded: ValidatedEmbedding = await embedSemanticDocument(input.document, provider);
  const record = await repository.upsert({
    agentVersionId: input.agentVersionId,
    embedding: embedded.vector,
    provider: embedded.provider,
    model: embedded.model,
    modelVersion: embedded.modelVersion,
    dimension: embedded.dimension,
    sourceTextDigest: input.document.digest,
    semanticDocumentSchemaVersion: input.document.schemaVersion,
    classifierVersion: input.classifierVersion,
    createdAt: input.now ?? new Date()
  });
  return { record, generated: true };
}
