import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { creatorTemplate, type CreatorDraftRequest, canonicalCreatorDraft, canonicalDraftConfiguration, canonicalRuntimeConfigurationDigest, draftConfigurationDigest } from "./creator-contract";
import type { CreatorRuntimeAuthority } from "./creator-authority-runtime";
import { creatorStages, type CreatorStage, type CreatorWorkerStore } from "./creator-worker";
import { assertSafePublicNetworkTarget } from "@bnbera/agent-ingestion";
import type { ScopedPolicy } from "@bnbera/altana";

export type CreatorDraft = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly createdAt: string;
  readonly configuration?: Record<string, unknown>;
  readonly configurationDigest?: string;
  readonly deploymentId: string | null;
  readonly deploymentState: string | null;
  readonly currentStep: string | null;
  readonly authorityId: string | null;
  /** Public browser-grant observation; never a runtime secret/reference. */
  readonly authorityStatus?: "none" | "active" | "expired" | "revoked" | null;
  readonly authorityWallet?: string | null;
  readonly authoritySessionPublicAddress?: string | null;
  readonly authoritySessionPublicKey?: string | null;
  readonly authorityPolicyDigest?: string | null;
  readonly authorityExpiresAtUnix?: number | null;
  readonly authorityGrantTransactionHash?: string | null;
};

export type CreatorBrowserAuthority = {
  readonly authorityId: string;
  readonly draftId: string;
  readonly ownerAddress: string;
  readonly walletAddress: string;
  readonly sessionPublicAddress: string;
  readonly sessionPublicKey: string;
  readonly policyDigest: string;
  readonly expiresAtUnix: number;
  readonly status: "none" | "active" | "expired" | "revoked";
  readonly grantTransactionHash: string | null;
  readonly revokeTransactionHash: string | null;
};

export type CreatorBrowserAuthorityInput = {
  readonly walletAddress: string;
  readonly sessionPublicAddress: string;
  readonly sessionPublicKey: string;
  readonly policyDigest: string;
  readonly policy: ScopedPolicy;
  readonly grantIssuedAtUnix: number;
  readonly expiresAtUnix: number;
  readonly grantTransactionHash: string | null;
};

/** Public identifiers needed to compose one bounded worker run. */
export type CreatorDeploymentBinding = {
  readonly deploymentId: string;
  readonly draftId: string;
  readonly userId: string;
  readonly authorityId: string;
  readonly configurationDigest: string;
};

const pricing = { model: "fixed", amountAtomic: "1000000000000000", currency: "U", chainId: 97 };
const policy = creatorTemplate.contractSelectorAllowlist;
const json = (value: unknown) => JSON.stringify(value);

function encodedPolicy(value: ScopedPolicy): Record<string, unknown> {
  return {
    ...value,
    calls: value.calls.map((call) => ({ ...call, maxNativeValueWei: call.maxNativeValueWei.toString(10) })),
    spend: value.spend.map((entry) => ({ ...entry, limitAtomic: entry.limitAtomic.toString(10) })),
  };
}

type BrowserAuthorityRow = {
  readonly id: string;
  readonly draft_id: string;
  readonly admin_wallet: string | null;
  readonly execution_wallet: string | null;
  readonly session_public_address: string | null;
  readonly calls_allowlist: unknown;
  readonly expires_at: Date | string;
  readonly keystore_registration_tx: string | null;
  readonly status: "none" | "active" | "expired" | "revoked";
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function browserAuthorityFromRow(row: BrowserAuthorityRow): CreatorBrowserAuthority {
  const metadata = objectValue(row.calls_allowlist);
  const persistedPolicy = objectValue(metadata?.policy);
  const sessionPublicKey = typeof persistedPolicy?.sessionPublicKey === "string" ? persistedPolicy.sessionPublicKey : null;
  const policyDigest = typeof metadata?.policyDigest === "string" ? metadata.policyDigest : null;
  const revokeTransactionHash = typeof metadata?.revocationTransactionHash === "string" ? metadata.revocationTransactionHash : null;
  if (row.admin_wallet === null || row.execution_wallet === null || row.session_public_address === null || sessionPublicKey === null || policyDigest === null) {
    throw new CreatorRepositoryError("CREATOR_BROWSER_AUTHORITY_INVALID", "The persisted browser authority is missing public policy metadata.");
  }
  return {
    authorityId: row.id,
    draftId: row.draft_id,
    ownerAddress: row.admin_wallet,
    walletAddress: row.execution_wallet,
    sessionPublicAddress: row.session_public_address,
    sessionPublicKey,
    policyDigest,
    expiresAtUnix: Math.floor(new Date(row.expires_at).getTime() / 1000),
    status: row.status,
    grantTransactionHash: row.keystore_registration_tx,
    revokeTransactionHash,
  };
}

type Queryable = Pick<Pool, "query">;

export class CreatorRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}

  async ensureTemplate(): Promise<string> {
    const row = await this.pool.query<{ id: string }>(
      `INSERT INTO agent_templates (slug, semantic_version, category, display_metadata, configuration_schema, capability_manifest, protocol_manifest, contract_selector_allowlist, artifact_digest, source_commit, release_status, activated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,'review',NULL)
       ON CONFLICT (slug, semantic_version) DO NOTHING
       RETURNING id`,
      [creatorTemplate.slug, creatorTemplate.semanticVersion, creatorTemplate.category, json(creatorTemplate.displayMetadata), json(creatorTemplate.configurationSchema), json(creatorTemplate.capabilityManifest), json(creatorTemplate.protocolManifest), json(policy), creatorTemplate.artifactDigest, creatorTemplate.sourceCommit]
    );
    if (row.rows[0] !== undefined) return row.rows[0].id;
    // PostgreSQL JSONB equality is key-order independent. Do not stringify a
    // returned JSONB value: PostgreSQL may normalize its object key order.
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM agent_templates
        WHERE slug=$1 AND semantic_version=$2 AND artifact_digest=$3
          AND configuration_schema=$4::jsonb AND capability_manifest=$5::jsonb
          AND protocol_manifest=$6::jsonb AND contract_selector_allowlist=$7::jsonb`,
      [creatorTemplate.slug, creatorTemplate.semanticVersion, creatorTemplate.artifactDigest, json(creatorTemplate.configurationSchema), json(creatorTemplate.capabilityManifest), json(creatorTemplate.protocolManifest), json(policy)]
    );
    const value = existing.rows[0];
    if (value === undefined) throw new CreatorRepositoryError("TEMPLATE_IMMUTABLE_MISMATCH", "The fixed Creator template version differs from its persisted manifest.");
    return value.id;
  }

  async createDraft(userId: string, input: CreatorDraftRequest): Promise<CreatorDraft> {
    const normalized = canonicalCreatorDraft(input);
    const templateId = await this.ensureTemplate();
    const digest = draftConfigurationDigest(normalized);
    const runtimeDigest = canonicalRuntimeConfigurationDigest(canonicalDraftConfiguration(normalized));
    const result = await this.pool.query<CreatorDraft & { readonly configuration: unknown; readonly description: string; readonly publicationConsent: boolean }>(
      `INSERT INTO agent_drafts (creator_user_id, template_id, template_version, name, slug, description, configuration, pricing_configuration, derived_policy, status, idempotency_key, publication_consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'awaiting_authority',$10,true)
       ON CONFLICT (creator_user_id, idempotency_key) DO UPDATE SET "updatedAt" = agent_drafts."updatedAt"
       RETURNING id, name, slug, status, "createdAt", configuration, description, publication_consent AS "publicationConsent"`,
      [userId, templateId, creatorTemplate.semanticVersion, normalized.name, normalized.slug, normalized.description, json(canonicalDraftConfiguration(normalized)), json(pricing), json({ ...policy, configurationDigest: runtimeDigest }), normalized.idempotencyKey]
    );
    const row = result.rows[0]!;
    const persisted = row.configuration as Record<string, unknown>;
    if (row.publicationConsent !== true) throw new CreatorRepositoryError("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different draft.");
    const persistedDigest = draftConfigurationDigest({ ...normalized, name: row.name, slug: row.slug, description: row.description, ...persisted, publicationConsent: true });
    if (persistedDigest !== digest) throw new CreatorRepositoryError("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for a different draft.");
    return { ...row, configuration: persisted, deploymentId: null, deploymentState: null, currentStep: null, authorityId: null };
  }

  async listDrafts(userId: string): Promise<readonly CreatorDraft[]> {
    const result = await this.pool.query<CreatorDraft>(
      `SELECT d.id, d.name, d.slug, d.status, d.configuration, d.derived_policy->>'configurationDigest' AS "configurationDigest", d."createdAt", x.id AS "deploymentId", x.state AS "deploymentState", x.current_step AS "currentStep", au.id AS "authorityId", au.status AS "authorityStatus", au.execution_wallet AS "authorityWallet", au.session_public_address AS "authoritySessionPublicAddress", au.calls_allowlist->'policy'->>'sessionPublicKey' AS "authoritySessionPublicKey", au.calls_allowlist->>'policyDigest' AS "authorityPolicyDigest", EXTRACT(EPOCH FROM au.expires_at)::int AS "authorityExpiresAtUnix", au.keystore_registration_tx AS "authorityGrantTransactionHash"
         FROM agent_drafts d
         LEFT JOIN LATERAL (SELECT id, state, current_step FROM agent_deployments WHERE draft_id = d.id ORDER BY "createdAt" DESC LIMIT 1) x ON true
         LEFT JOIN LATERAL (SELECT id, status, execution_wallet, session_public_address, calls_allowlist, expires_at, keystore_registration_tx FROM agent_authorities WHERE draft_id=d.id ORDER BY "updatedAt" DESC LIMIT 1) au ON true
        WHERE d.creator_user_id = $1 ORDER BY d."createdAt" DESC`, [userId]
    );
    return result.rows;
  }

  /**
   * Records the browser-confirmed public half of an Altana grant. The raw
   * session signer is deliberately absent: the existing runtime resolver will
   * not treat this row as deployable until T6 supplies a secret-manager
   * handoff/reference.
   */
  async recordBrowserAuthority(userId: string, draftId: string, input: CreatorBrowserAuthorityInput): Promise<CreatorBrowserAuthority> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-browser-authority:${draftId}`]);
      const draft = await client.query<{ id: string }>("SELECT id FROM agent_drafts WHERE id=$1 AND creator_user_id=$2 FOR UPDATE", [draftId, userId]);
      if (draft.rows[0] === undefined) throw new CreatorRepositoryError("DRAFT_NOT_FOUND", "Creator draft not found.");
      const existing = await client.query<BrowserAuthorityRow>(
        `SELECT id,draft_id,admin_wallet,execution_wallet,session_public_address,calls_allowlist,expires_at,keystore_registration_tx,status
           FROM agent_authorities
          WHERE draft_id=$1 AND status='active'
          ORDER BY "updatedAt" DESC LIMIT 1 FOR UPDATE`,
        [draftId],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        const priorPublic = browserAuthorityFromRow(prior);
        if (priorPublic.policyDigest.toLowerCase() === input.policyDigest.toLowerCase() && priorPublic.sessionPublicAddress.toLowerCase() === input.sessionPublicAddress.toLowerCase()) {
          await client.query("COMMIT");
          return priorPublic;
        }
        throw new CreatorRepositoryError("CREATOR_AUTHORITY_EXISTS", "This draft already has a different active browser authority.");
      }
      const serialized = encodedPolicy(input.policy);
      const metadata = {
        sessionId: `creator-browser:${draftId}:${input.sessionPublicAddress.slice(2, 14).toLowerCase()}`,
        policyDigest: input.policyDigest,
        policy: serialized,
        grantedAtUnix: input.grantIssuedAtUnix,
        source: "browser-sdk-grant-confirmed",
      };
      const result = await client.query<BrowserAuthorityRow>(
        `INSERT INTO agent_authorities
          (draft_id,chain_id,wallet_provider,execution_wallet,altana_smart_wallet,admin_wallet,session_public_address,calls_allowlist,spend_limits,expires_at,keystore_registration_tx,last_verified_block,status,secret_reference)
         VALUES ($1,97,'altana',$2,$2,$3,$4,$5::jsonb,$6::jsonb,to_timestamp($7),$8,NULL,'active',NULL)
         RETURNING id,draft_id,admin_wallet,execution_wallet,session_public_address,calls_allowlist,expires_at,keystore_registration_tx,status`,
        [draftId, input.walletAddress, input.policy.adminAddress, input.sessionPublicAddress, json(metadata), json(serialized.spend), input.expiresAtUnix, input.grantTransactionHash],
      );
      const row = result.rows[0];
      if (row === undefined) throw new CreatorRepositoryError("CREATOR_BROWSER_AUTHORITY_INVALID", "The browser authority could not be persisted.");
      await client.query("COMMIT");
      return browserAuthorityFromRow(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async browserAuthorityForUser(userId: string, authorityId: string): Promise<CreatorBrowserAuthority | null> {
    const result = await this.pool.query<BrowserAuthorityRow>(
      `SELECT a.id,a.draft_id,a.admin_wallet,a.execution_wallet,a.session_public_address,a.calls_allowlist,a.expires_at,a.keystore_registration_tx,a.status
         FROM agent_authorities a
         JOIN agent_drafts d ON d.id=a.draft_id
        WHERE a.id=$1 AND d.creator_user_id=$2
        LIMIT 1`,
      [authorityId, userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    try {
      return browserAuthorityFromRow(row);
    } catch {
      return null;
    }
  }

  /** Marks a browser-revoked session using only its public key and tx hash. */
  async recordBrowserRevocation(userId: string, authorityId: string, sessionPublicKey: string, transactionHash: string | null): Promise<CreatorBrowserAuthority> {
    const result = await this.pool.query<BrowserAuthorityRow>(
      `UPDATE agent_authorities a
          SET status='revoked',
              calls_allowlist=CASE WHEN $3::text IS NULL THEN a.calls_allowlist ELSE a.calls_allowlist || jsonb_build_object('revocationTransactionHash',$3::text) END,
              "updatedAt"=NOW()
         FROM agent_drafts d
        WHERE a.id=$1 AND a.draft_id=d.id AND d.creator_user_id=$2
          AND a.calls_allowlist->'policy'->>'sessionPublicKey'=$4
        RETURNING a.id,a.draft_id,a.admin_wallet,a.execution_wallet,a.session_public_address,a.calls_allowlist,a.expires_at,a.keystore_registration_tx,a.status`,
      [authorityId, userId, transactionHash, sessionPublicKey],
    );
    const row = result.rows[0];
    if (row === undefined) throw new CreatorRepositoryError("CREATOR_AUTHORITY_NOT_FOUND", "The browser authority was not found for this account or public key.");
    return browserAuthorityFromRow(row);
  }

  async queueDeployment(userId: string, draftId: string, authority: CreatorRuntimeAuthority): Promise<CreatorDraft> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // This transaction-scoped lock is the existing PostgreSQL mechanism that
      // serializes retries even though the historical schema lacks draft_id UNIQUE.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-deployment:${draftId}`]);
      const result = await this.queueDeploymentLocked(client, userId, draftId, authority);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async queueDeploymentLocked(pool: Queryable, userId: string, draftId: string, authority: CreatorRuntimeAuthority): Promise<CreatorDraft> {
    const draft = await pool.query<{ id: string; name: string; slug: string; status: string; created_at: string; configuration: Record<string, unknown>; description: string; publication_consent: boolean }>(
      `SELECT id, name, slug, status, "createdAt" AS created_at, configuration, description, publication_consent FROM agent_drafts WHERE id = $1 AND creator_user_id = $2 FOR UPDATE`, [draftId, userId]
    );
    if (draft.rows[0] === undefined) throw new CreatorRepositoryError("DRAFT_NOT_FOUND", "Creator draft not found.");
    const authorityRow = await pool.query<{ execution_wallet: string | null }>("SELECT execution_wallet FROM agent_authorities WHERE id=$1 AND draft_id=$2 AND status='active' AND expires_at > NOW() FOR UPDATE", [authority.authorityId, draftId]);
    const executionWallet = authorityRow.rows[0]?.execution_wallet;
    if (executionWallet === null || executionWallet === undefined) throw new CreatorRepositoryError("CREATOR_AUTHORITY_WALLET_UNAVAILABLE", "An active T6 execution wallet is required before deployment.");
    await pool.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`creator-active-wallet:${executionWallet.toLowerCase()}`]);
    const activeForWallet = await pool.query<{ id: string }>(`SELECT d.id FROM agent_deployments d JOIN agent_authorities a ON a.draft_id=d.draft_id WHERE lower(a.execution_wallet)=lower($1) AND d.draft_id <> $2 AND d.state NOT IN ('failed','revoked','destroyed') LIMIT 1 FOR UPDATE`, [executionWallet, draftId]);
    if (activeForWallet.rows[0] !== undefined) throw new CreatorRepositoryError("CREATOR_ACTIVE_WALLET_EXISTS", "That Altana execution wallet already has an active Creator agent.");
    const runtimeName = `bnberahf${createHash("sha256").update(draftId).digest("hex").slice(0, 12)}`;
    const configDigest = canonicalRuntimeConfigurationDigest(draft.rows[0]!.configuration);
    // Replay/reconcile before insertion. The advisory lock makes this check
    // and the following insert one atomic idempotency boundary.
    const prior = await pool.query<{ id: string; state: string; current_step: string | null }>(
      `SELECT id, state, current_step FROM agent_deployments WHERE draft_id = $1 ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`, [draftId]
    );
    if (prior.rows[0] !== undefined) {
      const existing = prior.rows[0];
      return { id: draft.rows[0]!.id, name: draft.rows[0]!.name, slug: draft.rows[0]!.slug, status: draft.rows[0]!.status, createdAt: draft.rows[0]!.created_at, deploymentId: existing.id, deploymentState: existing.state, currentStep: existing.current_step, authorityId: authority.authorityId };
    }
    const deployment = await pool.query<{ id: string; state: string; current_step: string | null }>(
      `INSERT INTO agent_deployments (draft_id, provider, region, agent_core_arn, template_digest, configuration_digest, state, current_step, attempt, started_at)
       VALUES ($1,'bnb-agent-studio','bsc-testnet',NULL,$2,$3,'queued','studio_scaffold_package',0,NOW())
       ON CONFLICT DO NOTHING RETURNING id, state, current_step`, [draftId, creatorTemplate.artifactDigest, configDigest]
    );
    const existing = deployment.rows[0]!;
    await pool.query(
      `INSERT INTO deployment_events (deployment_id, attempt, previous_state, next_state, status_message, external_resource_references, retryable)
       SELECT $1, 0, NULL, $2, 'T6 authority accepted; Studio scaffold is queued.', jsonb_build_object('runtimeName',$3::text,'authorityId',$4::text,'policyDigest',$5::text,'secretReference',$6::text,'authorityExpiresAt',$7::text,'agentWallet',$8::text), false
       WHERE NOT EXISTS (SELECT 1 FROM deployment_events WHERE deployment_id = $1 AND next_state = $2)`, [existing.id, existing.state, runtimeName, authority.authorityId, authority.policyDigest, authority.secretReference, authority.expiresAt, executionWallet]
    );
    return { id: draft.rows[0]!.id, name: draft.rows[0]!.name, slug: draft.rows[0]!.slug, status: draft.rows[0]!.status, createdAt: draft.rows[0]!.created_at, deploymentId: existing.id, deploymentState: existing.state, currentStep: existing.current_step, authorityId: authority.authorityId };
  }

  /**
   * Resolves the current owner/authority binding without returning a secret or
   * policy body. An expired/revoked authority is intentionally not a worker
   * binding: the caller must stop before any Studio side effect.
   */
  async workerDeploymentBinding(deploymentId: string): Promise<CreatorDeploymentBinding | null> {
    const result = await this.pool.query<{
      deployment_id: string;
      draft_id: string;
      user_id: string;
      authority_id: string;
      configuration_digest: string;
    }>(
      `SELECT d.id AS deployment_id, d.draft_id, r.creator_user_id AS user_id,
              a.id AS authority_id, d.configuration_digest
         FROM agent_deployments d
         JOIN agent_drafts r ON r.id = d.draft_id
         JOIN LATERAL (
           SELECT external_resource_references->>'authorityId' AS authority_id
             FROM deployment_events
            WHERE deployment_id = d.id
              AND status_message LIKE 'T6 authority accepted%'
              AND external_resource_references ? 'authorityId'
            ORDER BY "createdAt" ASC
            LIMIT 1
         ) accepted ON true
         JOIN agent_authorities a ON a.id::text = accepted.authority_id
              AND a.draft_id = d.draft_id
              AND a.status = 'active' AND a.expires_at > NOW()
        WHERE d.id = $1 AND d.provider = 'bnb-agent-studio'
        ORDER BY a."updatedAt" DESC
        LIMIT 1`,
      [deploymentId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          deploymentId: row.deployment_id,
          draftId: row.draft_id,
          userId: row.user_id,
          authorityId: row.authority_id,
          configurationDigest: row.configuration_digest,
        };
  }

  /**
   * Claims the oldest queued Creator deployment, or an unfinished deployment
   * whose short lease expired, using the existing row lock. The state/event
   * transition is the durable lease; a later invocation reconciles any
   * persisted Studio intent after a crash.
   */
  async claimNextQueuedDeployment(): Promise<CreatorDeploymentBinding | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{
        deployment_id: string;
        draft_id: string;
        user_id: string;
        authority_id: string;
        configuration_digest: string;
        state: string;
        attempt: number;
      }>(
        `SELECT d.id AS deployment_id, d.draft_id, r.creator_user_id AS user_id,
                a.id AS authority_id, d.configuration_digest, d.state, d.attempt
           FROM agent_deployments d
           JOIN agent_drafts r ON r.id = d.draft_id
           JOIN LATERAL (
             SELECT external_resource_references->>'authorityId' AS authority_id
               FROM deployment_events
              WHERE deployment_id = d.id
                AND status_message LIKE 'T6 authority accepted%'
                AND external_resource_references ? 'authorityId'
              ORDER BY "createdAt" ASC
              LIMIT 1
           ) accepted ON true
           JOIN agent_authorities a ON a.id::text = accepted.authority_id
                AND a.draft_id = d.draft_id
                AND a.status = 'active' AND a.expires_at > NOW()
          WHERE d.provider = 'bnb-agent-studio'
            AND (
              (d.state = 'queued' AND d.current_step = 'studio_scaffold_package')
              OR (d.state IN ('building','deploying_runtime','registering_identity',
                              'publishing_evidence','configuring_commerce')
                  AND d."updatedAt" < NOW() - INTERVAL '30 seconds')
            )
          ORDER BY d."createdAt" ASC, d.id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
      );
      const row = selected.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return null;
      }
      const claimed = await client.query(
        `UPDATE agent_deployments
            SET state = CASE WHEN state = 'queued' THEN 'building'::deployment_state ELSE state END,
                "updatedAt" = NOW()
          WHERE id = $1`,
        [row.deployment_id],
      );
      if (claimed.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `INSERT INTO deployment_events
          (deployment_id, attempt, previous_state, next_state, status_message,
           external_resource_references, retryable)
         SELECT $1, $2, 'queued'::deployment_state, 'building'::deployment_state,
                'CREATOR_WORKER_CLAIMED',
                jsonb_build_object('worker','creator-worker'), true
          WHERE $3 = 'queued' AND NOT EXISTS (
            SELECT 1 FROM deployment_events
             WHERE deployment_id = $1 AND status_message = 'CREATOR_WORKER_CLAIMED'
          )`,
        [row.deployment_id, row.attempt, row.state],
      );
      await client.query("COMMIT");
      return {
        deploymentId: row.deployment_id,
        draftId: row.draft_id,
        userId: row.user_id,
        authorityId: row.authority_id,
        configurationDigest: row.configuration_digest,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Existing deployment/event tables hold only public provider facts. */
  workerStore(projectRoot: string): CreatorWorkerStore {
    if (!projectRoot.startsWith("/")) throw new CreatorRepositoryError("STUDIO_PROJECT_ROOT_INVALID", "Creator Studio workspace parent must be absolute.");
    const stageState: Record<CreatorStage, string> = { validate: "validating", authority_ready: "queued", studio_scaffold_package: "building", deploy_reconcile: "deploying_runtime", erc8004_register_reconcile: "registering_identity", marketplace_publish: "publishing_evidence", g2_funded_job_reconcile: "configuring_commerce", g2_activation_reconcile: "configuring_commerce", completed: "listed" };
    return {
      load: async (deploymentId) => {
        const result = await this.pool.query<{ current_step: string | null; agent_core_arn: string | null; public_url: string | null; draft_id: string; configuration: Record<string, unknown>; configuration_digest: string }>("SELECT x.current_step, x.agent_core_arn, x.public_url, x.draft_id, x.configuration_digest, d.configuration FROM agent_deployments x JOIN agent_drafts d ON d.id=x.draft_id WHERE x.id=$1 AND x.provider='bnb-agent-studio'", [deploymentId]);
        const row = result.rows[0];
        if (row === undefined || !creatorStages.includes(row.current_step as CreatorStage)) throw new CreatorRepositoryError("DEPLOYMENT_NOT_FOUND", "Creator deployment was not found or has an unsupported stage.");
        const config = row.configuration as Record<string, unknown>;
        if (config.protocol !== "pancakeswap-v2" || !["tbnb-cake", "tbnb-busd"].includes(String(config.tradingPair)) || !["100000000000000", "500000000000000", "1000000000000000"].includes(String(config.inputAmountWei)) || ![10, 25, 50].includes(Number(config.slippageBps)) || ![30, 60].includes(Number(config.quoteMaxAgeSeconds)) || ![60, 120].includes(Number(config.deadlineSeconds))) throw new CreatorRepositoryError("CREATOR_PUBLIC_CONFIG_INVALID", "Persisted Creator configuration is not an audited bounded configuration.");
        if (canonicalRuntimeConfigurationDigest(config) !== row.configuration_digest) throw new CreatorRepositoryError("CREATOR_PUBLIC_CONFIG_DIGEST_MISMATCH", "Creator deployment configuration no longer matches its persisted digest.");
        return { stage: row.current_step as CreatorStage, runtimeName: `bnberahf${createHash("sha256").update(row.draft_id).digest("hex").slice(0, 12)}`, projectRoot, publicId: row.agent_core_arn, endpoint: row.public_url, configurationDigest: row.configuration_digest, publicConfig: config as import("./creator-studio").CreatorPublicRuntimeConfig };
      },
      record: async (deploymentId, input) => {
        if (input.endpoint !== undefined && input.endpoint !== null) await assertCreatorPublicHttpsEndpoint(input.endpoint);
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const prior = await client.query<{ state: string; attempt: number }>("SELECT state, attempt FROM agent_deployments WHERE id=$1 FOR UPDATE", [deploymentId]);
          if (prior.rows[0] === undefined) throw new CreatorRepositoryError("DEPLOYMENT_NOT_FOUND", "Creator deployment was not found.");
          const nextState = input.reasonCode === "STUDIO_TEMPLATE_MISMATCH" ? "failed" : stageState[input.stage];
          await client.query("UPDATE agent_deployments SET state=$2::deployment_state, current_step=$3, agent_core_arn=COALESCE($4,agent_core_arn), public_url=COALESCE($5,public_url), error_code=CASE WHEN $2='failed' THEN 'STUDIO_TEMPLATE_MISMATCH' ELSE error_code END, \"updatedAt\"=NOW() WHERE id=$1", [deploymentId, nextState, input.stage, input.publicId, input.endpoint ?? null]);
          await client.query("INSERT INTO deployment_events (deployment_id, attempt, previous_state, next_state, status_message, external_resource_references, retryable) VALUES ($1,$2,$3::deployment_state,$4::deployment_state,$5,jsonb_strip_nulls(jsonb_build_object('providerDeploymentId',$6::text,'endpoint',$7::text,'handoffOperationId',$8::text)),false)", [deploymentId, prior.rows[0].attempt, prior.rows[0].state, nextState, input.reasonCode, input.publicId, input.endpoint ?? null, input.operationId ?? null]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      },
      recordIntent: async (deploymentId) => {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const locked = await client.query<{ state: string; attempt: number; agent_core_arn: string | null }>("SELECT state, attempt, agent_core_arn FROM agent_deployments WHERE id=$1 FOR UPDATE SKIP LOCKED", [deploymentId]);
          const row = locked.rows[0];
          if (row === undefined) { await client.query("ROLLBACK"); return "reconcile" as const; }
          const existing = await client.query("SELECT 1 FROM deployment_events WHERE deployment_id=$1 AND status_message='STUDIO_DEPLOY_INTENT' LIMIT 1", [deploymentId]);
          if (row.agent_core_arn !== null || existing.rowCount !== 0) { await client.query("COMMIT"); return "reconcile" as const; }
          await client.query("UPDATE agent_deployments SET state='deploying_runtime', current_step='deploy_reconcile', attempt=attempt+1, \"updatedAt\"=NOW() WHERE id=$1", [deploymentId]);
          await client.query("INSERT INTO deployment_events (deployment_id, attempt, previous_state, next_state, status_message, external_resource_references, retryable) VALUES ($1,$2,$3::deployment_state,'deploying_runtime','STUDIO_DEPLOY_INTENT',jsonb_build_object('operation','bag deploy --provider bnb'),true)", [deploymentId, row.attempt + 1, row.state]);
          await client.query("COMMIT"); return "claimed" as const;
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      },
      hasDeployIntent: async (deploymentId) => {
        const existing = await this.pool.query("SELECT 1 FROM deployment_events WHERE deployment_id=$1 AND status_message='STUDIO_DEPLOY_INTENT' LIMIT 1", [deploymentId]);
        return existing.rows.length !== 0;
      },
      recordScaffoldIntent: async (deploymentId) => {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const locked = await client.query<{ state: string; attempt: number; current_step: string | null }>("SELECT state, attempt, current_step FROM agent_deployments WHERE id=$1 FOR UPDATE SKIP LOCKED", [deploymentId]);
          const row = locked.rows[0];
          if (row === undefined || row.current_step !== "studio_scaffold_package") { await client.query("ROLLBACK"); return "reconcile" as const; }
          const existing = await client.query("SELECT 1 FROM deployment_events WHERE deployment_id=$1 AND status_message='STUDIO_SCAFFOLD_INTENT' LIMIT 1", [deploymentId]);
          if (existing.rowCount !== 0) { await client.query("COMMIT"); return "reconcile" as const; }
          const claimed = await client.query("UPDATE agent_deployments SET state='building', \"updatedAt\"=NOW() WHERE id=$1 AND current_step='studio_scaffold_package'", [deploymentId]);
          if (claimed.rowCount !== 1) { await client.query("ROLLBACK"); return "reconcile" as const; }
          await client.query("INSERT INTO deployment_events (deployment_id, attempt, previous_state, next_state, status_message, external_resource_references, retryable) VALUES ($1,$2,$3::deployment_state,'building','STUDIO_SCAFFOLD_INTENT',NULL,true)", [deploymentId, row.attempt, row.state]);
          await client.query("COMMIT"); return "claimed" as const;
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      }
    };
  }
}

/** Same fail-closed public HTTPS boundary used by marketplace-facing paths. */
async function assertCreatorPublicHttpsEndpoint(value: string): Promise<void> {
  try {
    const url = await assertSafePublicNetworkTarget(value);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
  } catch { throw new CreatorRepositoryError("STUDIO_ENDPOINT_UNSAFE", "Studio returned a non-public HTTPS endpoint."); }
}

export class CreatorRepositoryError extends Error { constructor(readonly code: string, message: string) { super(message); } }
