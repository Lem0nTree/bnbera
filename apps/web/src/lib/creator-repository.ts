import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { creatorTemplate, type CreatorDraftRequest, canonicalDraftConfiguration, draftConfigurationDigest } from "./creator-contract";

export type CreatorDraft = { readonly id: string; readonly name: string; readonly slug: string; readonly status: string; readonly createdAt: string; readonly deploymentId: string | null; readonly deploymentState: string | null; readonly currentStep: string | null; };

const pricing = { model: "none", amountAtomic: "0", currency: "none" };
const policy = creatorTemplate.contractSelectorAllowlist;
const json = (value: unknown) => JSON.stringify(value);
const configurationDigest = (input: CreatorDraftRequest) => draftConfigurationDigest(input);

type Queryable = Pick<Pool, "query">;

export class CreatorRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}

  async ensureTemplate(): Promise<string> {
    const row = await this.pool.query<{ id: string }>(
      `INSERT INTO agent_templates (slug, semantic_version, category, display_metadata, configuration_schema, capability_manifest, protocol_manifest, contract_selector_allowlist, artifact_digest, source_commit, release_status, activated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,'review',NULL)
       ON CONFLICT (slug, semantic_version) DO UPDATE SET artifact_digest = EXCLUDED.artifact_digest
       RETURNING id`,
      [creatorTemplate.slug, creatorTemplate.semanticVersion, creatorTemplate.category, json(creatorTemplate.displayMetadata), json(creatorTemplate.configurationSchema), json(creatorTemplate.capabilityManifest), json(creatorTemplate.protocolManifest), json(policy), creatorTemplate.artifactDigest, creatorTemplate.sourceCommit]
    );
    return row.rows[0]!.id;
  }

  async createDraft(userId: string, input: CreatorDraftRequest): Promise<CreatorDraft> {
    const templateId = await this.ensureTemplate();
    const digest = configurationDigest(input);
    const result = await this.pool.query<CreatorDraft & { readonly configuration: unknown; readonly description: string; readonly publicationConsent: boolean }>(
      `INSERT INTO agent_drafts (creator_user_id, template_id, template_version, name, slug, description, configuration, pricing_configuration, derived_policy, status, idempotency_key, publication_consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'awaiting_authority',$10,true)
       ON CONFLICT (creator_user_id, idempotency_key) DO UPDATE SET updated_at = agent_drafts.updated_at
       RETURNING id, name, slug, status, created_at AS "createdAt", configuration, description, publication_consent AS "publicationConsent"`,
      [userId, templateId, creatorTemplate.semanticVersion, input.name, input.slug, input.description, json(canonicalDraftConfiguration(input)), json(pricing), json({ ...policy, configurationDigest: digest }), input.idempotencyKey]
    );
    const row = result.rows[0]!;
    const persisted = row.configuration as Record<string, unknown>;
    const persistedDigest = createHash("sha256").update(JSON.stringify({
      name: row.name, slug: row.slug, description: row.description, configuration: persisted, publicationConsent: row.publicationConsent
    })).digest("hex");
    if (persistedDigest !== digest) throw new CreatorRepositoryError("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different draft.");
    return { ...row, deploymentId: null, deploymentState: null, currentStep: null };
  }

  async listDrafts(userId: string): Promise<readonly CreatorDraft[]> {
    const result = await this.pool.query<CreatorDraft>(
      `SELECT d.id, d.name, d.slug, d.status, d.created_at AS "createdAt", x.id AS "deploymentId", x.state AS "deploymentState", x.current_step AS "currentStep"
         FROM agent_drafts d
         LEFT JOIN LATERAL (SELECT id, state, current_step FROM agent_deployments WHERE draft_id = d.id ORDER BY created_at DESC LIMIT 1) x ON true
        WHERE d.creator_user_id = $1 ORDER BY d.created_at DESC`, [userId]
    );
    return result.rows;
  }

  async queueDeployment(userId: string, draftId: string, authorityId: string): Promise<CreatorDraft> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // This transaction-scoped lock is the existing PostgreSQL mechanism that
      // serializes retries even though the historical schema lacks draft_id UNIQUE.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-deployment:${draftId}`]);
      const result = await this.queueDeploymentLocked(client, userId, draftId, authorityId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async queueDeploymentLocked(pool: Queryable, userId: string, draftId: string, authorityId: string): Promise<CreatorDraft> {
    const draft = await pool.query<{ id: string; name: string; slug: string; status: string; created_at: string }>(
      `SELECT id, name, slug, status, created_at FROM agent_drafts WHERE id = $1 AND creator_user_id = $2 FOR UPDATE`, [draftId, userId]
    );
    if (draft.rows[0] === undefined) throw new CreatorRepositoryError("DRAFT_NOT_FOUND", "Creator draft not found.");
    const runtimeName = `bnberahf${createHash("sha256").update(draftId).digest("hex").slice(0, 12)}`;
    const configDigest = createHash("sha256").update(`${draftId}:${authorityId}`).digest("hex");
    // Replay/reconcile before insertion. The advisory lock makes this check
    // and the following insert one atomic idempotency boundary.
    const prior = await pool.query<{ id: string; state: string; current_step: string | null }>(
      `SELECT id, state, current_step FROM agent_deployments WHERE draft_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [draftId]
    );
    if (prior.rows[0] !== undefined) {
      const existing = prior.rows[0];
      return { id: draft.rows[0]!.id, name: draft.rows[0]!.name, slug: draft.rows[0]!.slug, status: draft.rows[0]!.status, createdAt: draft.rows[0]!.created_at, deploymentId: existing.id, deploymentState: existing.state, currentStep: existing.current_step };
    }
    const deployment = await pool.query<{ id: string; state: string; current_step: string | null }>(
      `INSERT INTO agent_deployments (draft_id, provider, region, agent_core_arn, template_digest, configuration_digest, state, current_step, attempt, started_at)
       VALUES ($1,'bnb-agent-studio','bsc-testnet',NULL,$2,$3,'awaiting_authority','validate',0,NOW())
       ON CONFLICT DO NOTHING RETURNING id, state, current_step`, [draftId, creatorTemplate.artifactDigest, configDigest]
    );
    const existing = deployment.rows[0]!;
    await pool.query(
      `INSERT INTO deployment_events (deployment_id, attempt, previous_state, next_state, status_message, external_resource_references, retryable)
       SELECT $1, 0, NULL, $2, 'Waiting for T6 runtime authority reconciliation.', jsonb_build_object('runtimeName',$3), false
       WHERE NOT EXISTS (SELECT 1 FROM deployment_events WHERE deployment_id = $1 AND next_state = $2)`, [existing.id, existing.state, runtimeName]
    );
    return { id: draft.rows[0]!.id, name: draft.rows[0]!.name, slug: draft.rows[0]!.slug, status: draft.rows[0]!.status, createdAt: draft.rows[0]!.created_at, deploymentId: existing.id, deploymentState: existing.state, currentStep: existing.current_step };
  }
}

export class CreatorRepositoryError extends Error { constructor(readonly code: string, message: string) { super(message); } }
