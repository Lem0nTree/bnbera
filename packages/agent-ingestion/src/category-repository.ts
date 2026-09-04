import pg from "pg";
import { agentCategorySchema, canonicalSha256Hex } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertSafePublicValue } from "./normalize.js";
import { categoryClassifierVersion, type CategoryClassification } from "./categorization.js";

export type CategoryPredictionQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export type CategoryPredictionVersionResolver = (identityKey: string) => string | null | Promise<string | null>;

function boundedLabel(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw ingestionError("REPOSITORY_FAILURE", `The category ${field} is invalid.`, "repair_category_prediction");
  }
  return normalized;
}

function boundedScore(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw ingestionError("REPOSITORY_FAILURE", `The category ${field} is outside its safe range.`, "repair_category_prediction");
  }
  return value;
}

function deterministicPredictionId(input: {
  readonly agentVersionId: string;
  readonly category: string;
  readonly method: string;
  readonly classifierVersion: string;
  readonly evidenceDigest: string;
}): string {
  const digest = canonicalSha256Hex(input);
  // UUIDv5-shaped deterministic IDs keep replays and concurrent workers on
  // the primary-key conflict path without exposing the evidence payload.
  const versioned = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${digest.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20, 32)}`;
}

function validatedClassification(input: CategoryClassification): CategoryClassification {
  const category = agentCategorySchema.parse(input.category);
  const structuredScore = boundedScore(input.structuredScore, 0, 100, "structured score");
  const semanticScore = boundedScore(input.semanticScore, 0, 100, "semantic score");
  const confidence = boundedScore(input.confidence, 0, 1, "confidence");
  const method = boundedLabel(input.method, "method", 64);
  const classifierVersion = boundedLabel(input.classifierVersion, "classifier version", 64);
  if (input.reviewState !== "auto" && input.reviewState !== "needs_review") throw ingestionError("REPOSITORY_FAILURE", "The category review state is invalid.", "repair_category_prediction");
  if (method !== categoryClassifierVersion || classifierVersion !== categoryClassifierVersion) throw ingestionError("REPOSITORY_FAILURE", "The category classifier version is not the reviewed deterministic version.", "review_category_classifier");
  assertSafePublicValue(input.evidence, "category.evidence");
  return { ...input, category, structuredScore, semanticScore, confidence, method, classifierVersion };
}

/**
 * PostgreSQL sink for append-only category predictions. Identity version
 * resolution is injected so this boundary never guesses an agent-version
 * relationship or changes the marketplace listing projection itself.
 */
export class PgCategoryPredictionSink {
  public constructor(
    private readonly queryable: CategoryPredictionQueryable,
    private readonly versionIdForIdentityKey: CategoryPredictionVersionResolver,
    private readonly now: () => Date = () => new Date()
  ) {}

  async save(input: { readonly identityKey: string; readonly classification: CategoryClassification }): Promise<void> {
    const identityKey = boundedLabel(input.identityKey, "identity key", 400);
    const classification = validatedClassification(input.classification);
    const agentVersionId = await this.versionIdForIdentityKey(identityKey);
    if (agentVersionId === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(agentVersionId)) {
      throw ingestionError("REPOSITORY_FAILURE", "The category prediction has no valid agent version.", "repair_category_version");
    }
    const createdAt = this.now();
    if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.valueOf())) throw ingestionError("REPOSITORY_FAILURE", "The category prediction timestamp is invalid.", "repair_category_prediction");
    // Keep one stable digest for the evidence payload. The digest is stored in
    // the JSON row and passed separately to the idempotency predicate so a
    // replay of the same classifier output inserts no second prediction.
    const evidenceDigest = canonicalSha256Hex(classification.evidence);
    const evidence = { ...classification.evidence, digest: evidenceDigest };
    const predictionId = deterministicPredictionId({
      agentVersionId,
      category: classification.category,
      method: classification.method,
      classifierVersion: classification.classifierVersion,
      evidenceDigest
    });
    // Persist the append-only prediction and refresh the current marketplace
    // projection in one statement. Older agent versions remain auditable but
    // cannot overwrite a newer current-version category.
    await this.queryable.query(
      `WITH prediction AS (
        INSERT INTO agent_category_predictions
          (id, agent_version_id, predicted_category, structured_score, semantic_score,
           confidence, evidence, method, classifier_version, review_state, createdAt)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         WHERE NOT EXISTS (
           SELECT 1
             FROM agent_category_predictions AS existing
            WHERE existing.agent_version_id = $2
              AND existing.classifier_version = $9
              AND existing.method = $8
              AND existing.evidence->>'digest' = $12
         )
        ON CONFLICT (id) DO NOTHING
        RETURNING agent_version_id, predicted_category
      )
      UPDATE agents AS a
         SET category = prediction.predicted_category,
             "updatedAt" = now()
        FROM prediction
        JOIN agent_versions AS av ON av.id = prediction.agent_version_id
       WHERE a.id = av.agent_id
         AND (a.current_version_id IS NULL OR a.current_version_id = prediction.agent_version_id)`,
      [
        predictionId,
        agentVersionId,
        classification.category,
        classification.structuredScore,
        classification.semanticScore,
        classification.confidence,
        evidence,
        classification.method,
        classification.classifierVersion,
        classification.reviewState,
        createdAt,
        evidenceDigest
      ]
    );
  }
}
