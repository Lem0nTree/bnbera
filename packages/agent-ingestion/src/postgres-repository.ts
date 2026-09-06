import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  assertStateTransition,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type AgentStateAxes,
  type ChainObservationState,
  type OriginType
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertIdentityReadProvenance, identityRecordReadReference } from "./identity-provenance.js";
import {
  normalizeReputationCheckpoint,
  normalizeReputationFeedbackEvent,
  projectReputationFeedback
} from "./reputation.js";
import { normalizeRegistryCheckpoint } from "./adapters/registry.js";
import {
  claimRecordFromRow,
  identityRecordFromRow,
  observationFromRow,
  observationToRow,
  type ClaimRecordRow,
  type IdentityRecordRow,
  type ChainObservationRow
} from "./repository-mapping.js";
import type {
  CapabilityObservation,
  ChainCheckpoint,
  ChainObservation,
  CheckpointWriteCondition,
  ClaimEvent,
  ClaimMutation,
  ClaimRecord,
  DiscoverySourceRecord,
  IdentityCanonicalUpdate,
  IdentityKey,
  IdentityRecord,
  IdentityUpsertInput,
  IngestionFilter,
  IngestionRepository,
  ReconciliationRecord,
  ReputationCheckpoint,
  ReputationCheckpointWriteCondition,
  ReputationFeedback,
  ReputationFeedbackEvent,
  ScanDiscoveryCheckpoint,
  ScanDiscoveryCheckpointWriteCondition,
  ScanDiscoveryCheckpointRepository,
  ServiceObservation,
  ServiceProbeRecord
} from "./types.js";

const { Pool } = pg;
type PgPool = pg.Pool;
type PgClient = pg.PoolClient;
type Queryable = Pick<PgPool, "query"> | Pick<PgClient, "query">;

type IdentityJoinRow = {
  id: string;
  agent_projection_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  agent_id: string;
  owner_address: string | null;
  owner_observed_block: number | null;
  agent_wallet: string | null;
  agent_wallet_observed_block: number | null;
  agent_uri: string | null;
  agent_uri_observed_block: number | null;
  content_digest: string | null;
  content_digest_observed_block: number | null;
  observed_block: number | null;
  observed_block_hash: string | null;
  read_consistency: "finalized" | "provisional" | null;
  origin_type: OriginType;
  claim_status: AgentStateAxes["claimStatus"];
  claim_version: number;
  claimant_address: string | null;
  claim_owner_address_at_verification: string | null;
  claim_agent_wallet_at_verification: string | null;
  claim_verified_at: Date | null;
  claim_stale_at: Date | null;
  claim_last_reason: ClaimRecord["lastReason"];
  claim_verification_observed_block: number | null;
  claim_verification_observed_block_hash: string | null;
  claim_verification_read_consistency: ClaimRecord["verificationReadConsistency"];
  verification_status: AgentStateAxes["verificationStatus"];
  runtime_status: AgentStateAxes["runtimeStatus"];
  authority_status: AgentStateAxes["authorityStatus"];
  listing_status: AgentStateAxes["listingStatus"];
  owner_claim_verified_at: Date | null;
  updated_at: Date;
};

type ObservationDbRow = {
  id: string;
  identity_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  agent_id: string;
  event_type: string;
  transaction_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string;
  confirmation_state: ChainObservationState;
  normalized_owner: string | null;
  normalized_agent_uri: string | null;
  normalized_agent_wallet: string | null;
  normalized_content_digest: string | null;
  observed_fields: readonly string[];
  first_observed_at: Date;
  canonicalized_at: Date | null;
  orphaned_at: Date | null;
  payload_digest: string | null;
};

type CheckpointDbRow = {
  chain_id: number;
  identity_registry: string;
  indexer_version: string;
  last_scanned_block: number;
  last_scanned_block_hash: string;
  last_finalized_block: number;
  last_finalized_block_hash: string;
  confirmation_threshold: number;
  cursor_version: number;
  last_reconciliation_at: Date | null;
};

type ReputationEventDbRow = {
  id: string;
  identity_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  reputation_registry: string;
  agent_id: string;
  event_type: ReputationFeedbackEvent["eventType"];
  client_address: string;
  feedback_index: string;
  value: string | null;
  value_decimals: number | null;
  indexed_tag1: string | null;
  tag1: string | null;
  tag2: string | null;
  endpoint: string | null;
  feedback_uri: string | null;
  feedback_hash: string | null;
  transaction_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string;
  confirmation_state: ChainObservationState;
  observed_at: Date;
  canonicalized_at: Date | null;
  orphaned_at: Date | null;
  payload_digest: string;
};

type ReputationCheckpointDbRow = {
  chain_id: number;
  identity_registry: string;
  reputation_registry: string;
  indexer_version: string;
  last_scanned_block: number;
  last_scanned_block_hash: string;
  last_finalized_block: number;
  last_finalized_block_hash: string;
  confirmation_threshold: number;
  cursor_version: number;
  last_reconciliation_at: Date | null;
};

type ScanDiscoveryCheckpointDbRow = {
  scope: string;
  query_digest: string;
  initial_offset: number | string | null;
  initial_cursor: string | null;
  next_offset: number | string | null;
  next_cursor: string | null;
  page_size: number;
  total: number | string | null;
  pages_processed: number;
  candidates_processed: number;
  last_page_digest: string | null;
  cursor_version: number;
  completed_at: Date | null;
  updated_at: Date;
};

function keyFor(identity: IdentityKey): string {
  return identity;
}

function dateOrNull(value: Date | null, field: string): Date | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return parsed;
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : safeInteger(value, field);
}

function mapIdentity(row: IdentityJoinRow): IdentityRecord {
  const mapped: IdentityRecordRow = {
    id: row.id,
    identity: {
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    },
    originType: row.origin_type,
    ownerAddress: row.owner_address,
    ownerObservedBlock: nullableInteger(row.owner_observed_block, "owner observed block"),
    agentWallet: row.agent_wallet,
    agentWalletObservedBlock: nullableInteger(row.agent_wallet_observed_block, "agent wallet observed block"),
    agentUri: row.agent_uri,
    agentUriObservedBlock: nullableInteger(row.agent_uri_observed_block, "agent URI observed block"),
    contentDigest: row.content_digest,
    contentDigestObservedBlock: nullableInteger(row.content_digest_observed_block, "content digest observed block"),
    observedBlock: nullableInteger(row.observed_block, "identity observed block"),
    observedBlockHash: row.observed_block_hash,
    readConsistency: row.read_consistency,
    state: {
      originType: row.origin_type,
      claimStatus: row.claim_status,
      verificationStatus: row.verification_status,
      runtimeStatus: row.runtime_status,
      authorityStatus: row.authority_status,
      listingStatus: row.listing_status
    },
    ownerClaimVerifiedAt: row.owner_claim_verified_at,
    updatedAt: row.updated_at
  };
  return identityRecordFromRow(mapped);
}

function mapClaim(row: IdentityJoinRow, identityKey: IdentityKey): ClaimRecord | null {
  if (row.claim_version === 0 && row.claim_status === "unclaimed" && row.claimant_address === null) {
    return null;
  }
  const mapped: ClaimRecordRow = {
    claimStatus: row.claim_status,
    claimVersion: row.claim_version,
    claimantAddress: row.claimant_address,
    claimOwnerAddressAtVerification: row.claim_owner_address_at_verification,
    claimAgentWalletAtVerification: row.claim_agent_wallet_at_verification,
    claimVerifiedAt: dateOrNull(row.claim_verified_at, "claim verified timestamp"),
    claimStaleAt: dateOrNull(row.claim_stale_at, "claim stale timestamp"),
    claimLastReason: row.claim_last_reason,
    claimVerificationObservedBlock: nullableInteger(row.claim_verification_observed_block, "claim verification observed block"),
    claimVerificationObservedBlockHash: row.claim_verification_observed_block_hash,
    claimVerificationReadConsistency: row.claim_verification_read_consistency
  };
  return claimRecordFromRow(identityKey, mapped);
}

function mapObservation(row: ObservationDbRow): ChainObservation {
  const mapped: ChainObservationRow = {
    identity: {
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    },
    identityKey: erc8004IdentityKey({
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    }),
    eventType: row.event_type,
    transactionHash: row.transaction_hash,
    logIndex: row.log_index,
    blockNumber: safeInteger(row.block_number, "observation block number"),
    blockHash: row.block_hash,
    confirmationState: row.confirmation_state,
    normalizedOwner: row.normalized_owner,
    normalizedAgentUri: row.normalized_agent_uri,
    normalizedAgentWallet: row.normalized_agent_wallet,
    normalizedContentDigest: row.normalized_content_digest,
    observedFields: row.observed_fields as ChainObservation["observedFields"],
    firstObservedAt: row.first_observed_at,
    canonicalizedAt: row.canonicalized_at,
    orphanedAt: row.orphaned_at,
    payloadDigest: row.payload_digest
  };
  return observationFromRow(mapped);
}

function mapCheckpoint(row: CheckpointDbRow): ChainCheckpoint {
  return normalizeRegistryCheckpoint({
    chainId: row.chain_id,
    identityRegistry: row.identity_registry,
    indexerVersion: row.indexer_version,
    lastScannedBlock: safeInteger(row.last_scanned_block, "last scanned block"),
    lastScannedBlockHash: row.last_scanned_block_hash,
    lastFinalizedBlock: safeInteger(row.last_finalized_block, "last finalized block"),
    lastFinalizedBlockHash: row.last_finalized_block_hash,
    confirmationThreshold: row.confirmation_threshold,
    cursorVersion: row.cursor_version,
    lastReconciliationAt: row.last_reconciliation_at
  });
}

function mapReputationEvent(row: ReputationEventDbRow): ReputationFeedbackEvent {
  return normalizeReputationFeedbackEvent({
    identity: {
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    },
    reputationRegistry: row.reputation_registry,
    eventType: row.event_type,
    clientAddress: row.client_address,
    feedbackIndex: row.feedback_index,
    value: row.value,
    valueDecimals: row.value_decimals,
    indexedTag1: row.indexed_tag1,
    tag1: row.tag1,
    tag2: row.tag2,
    endpoint: row.endpoint,
    feedbackUri: row.feedback_uri,
    feedbackHash: row.feedback_hash,
    transactionHash: row.transaction_hash,
    logIndex: safeInteger(row.log_index, "reputation log index"),
    blockNumber: safeInteger(row.block_number, "reputation block number"),
    blockHash: row.block_hash,
    confirmationState: row.confirmation_state,
    observedAt: row.observed_at,
    canonicalizedAt: row.canonicalized_at,
    orphanedAt: row.orphaned_at,
    payloadDigest: row.payload_digest
  });
}

function mapReputationCheckpoint(row: ReputationCheckpointDbRow): ReputationCheckpoint {
  return normalizeReputationCheckpoint({
    chainId: row.chain_id,
    identityRegistry: row.identity_registry,
    reputationRegistry: row.reputation_registry,
    indexerVersion: row.indexer_version,
    lastScannedBlock: safeInteger(row.last_scanned_block, "reputation last scanned block"),
    lastScannedBlockHash: row.last_scanned_block_hash,
    lastFinalizedBlock: safeInteger(row.last_finalized_block, "reputation last finalized block"),
    lastFinalizedBlockHash: row.last_finalized_block_hash,
    confirmationThreshold: row.confirmation_threshold,
    cursorVersion: row.cursor_version,
    lastReconciliationAt: row.last_reconciliation_at
  });
}

function mapScanDiscoveryCheckpoint(row: ScanDiscoveryCheckpointDbRow): ScanDiscoveryCheckpoint {
  return {
    scope: row.scope,
    queryDigest: row.query_digest,
    initialOffset: row.initial_offset === null ? null : safeInteger(row.initial_offset, "scan initial offset"),
    initialCursor: row.initial_cursor,
    nextOffset: row.next_offset === null ? null : safeInteger(row.next_offset, "scan next offset"),
    nextCursor: row.next_cursor,
    pageSize: safeInteger(row.page_size, "scan page size"),
    total: row.total === null ? null : safeInteger(row.total, "scan total"),
    pagesProcessed: safeInteger(row.pages_processed, "scan pages processed"),
    candidatesProcessed: safeInteger(row.candidates_processed, "scan candidates processed"),
    lastPageDigest: row.last_page_digest,
    cursorVersion: safeInteger(row.cursor_version, "scan cursor version"),
    completedAt: dateOrNull(row.completed_at, "scan completed timestamp"),
    updatedAt: dateOrNull(row.updated_at, "scan updated timestamp") ?? new Date(0)
  };
}

function conflict(message: string, details?: unknown): never {
  throw ingestionError("CHECKPOINT_CONFLICT", message, "reconcile_chain", details);
}

function scanScope(scope: string): string {
  const normalized = scope.trim();
  if (normalized.length === 0 || normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw ingestionError("SCAN_JOB_CONFIG_INVALID", "The 8004scan job scope is invalid.", "fix_scan_configuration");
  }
  return normalized;
}

function scanConflict(message: string, details: unknown): never {
  throw ingestionError("SCAN_JOB_CHECKPOINT_CONFLICT", message, "reload_scan_checkpoint", details);
}

function sameHash(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : left.toLowerCase() === right.toLowerCase();
}

function sameReputationEvent(left: ReputationFeedbackEvent, right: ReputationFeedbackEvent): boolean {
  return left.identity.namespace === right.identity.namespace
    && left.identity.chainId === right.identity.chainId
    && left.identity.identityRegistry === right.identity.identityRegistry
    && left.identity.agentId === right.identity.agentId
    && left.reputationRegistry === right.reputationRegistry
    && left.eventType === right.eventType
    && left.clientAddress === right.clientAddress
    && left.feedbackIndex === right.feedbackIndex
    && left.value === right.value
    && left.valueDecimals === right.valueDecimals
    && left.indexedTag1 === right.indexedTag1
    && left.tag1 === right.tag1
    && left.tag2 === right.tag2
    && left.endpoint === right.endpoint
    && left.feedbackUri === right.feedbackUri
    && left.feedbackHash === right.feedbackHash
    && left.blockNumber === right.blockNumber
    && left.blockHash === right.blockHash
    && left.payloadDigest === right.payloadDigest;
}

function observationSelect(): string {
  return `
    SELECT o.id, o.identity_id, i.namespace, i.chain_id, i.identity_registry, i.agent_id,
           o.event_type, o.transaction_hash, o.log_index, o.block_number, o.block_hash,
           o.confirmation_state, o.normalized_owner, o.normalized_agent_uri,
           o.normalized_agent_wallet, o.normalized_content_digest, o.observed_fields,
           o.first_observed_at, o.canonicalized_at, o.orphaned_at, o.payload_digest
      FROM erc8004_chain_observations o
      JOIN erc8004_identities i ON i.id = o.identity_id`;
}

function reputationEventSelect(): string {
  return `
    SELECT r.id, r.identity_id, i.namespace, i.chain_id, i.identity_registry,
           r.reputation_registry, i.agent_id, r.event_type, r.client_address,
           r.feedback_index, r.value, r.value_decimals, r.indexed_tag1, r.tag1,
           r.tag2, r.endpoint, r.feedback_uri, r.feedback_hash, r.transaction_hash,
           r.log_index, r.block_number, r.block_hash, r.confirmation_state,
           r.observed_at, r.canonicalized_at, r.orphaned_at, r.payload_digest
      FROM erc8004_reputation_events r
      JOIN erc8004_identities i ON i.id = r.identity_id`;
}

function identitySelect(): string {
  return `
    SELECT i.id, a.id AS agent_projection_id, i.namespace, i.chain_id, i.identity_registry, i.agent_id,
           i.owner_address, i.owner_observed_block, i.agent_wallet,
           i.agent_wallet_observed_block, i.agent_uri, i.agent_uri_observed_block,
           i.content_digest, i.content_digest_observed_block, i.observed_block,
           i.observed_block_hash, i.read_consistency,
           a.origin_type, a.claim_status, a.claim_version, a.claimant_address,
           a.claim_owner_address_at_verification, a.claim_agent_wallet_at_verification,
           a.claim_verified_at, a.claim_stale_at, a.claim_last_reason,
           a.claim_verification_observed_block, a.claim_verification_observed_block_hash,
           a.claim_verification_read_consistency, a.verification_status,
           a.runtime_status, a.authority_status, a.listing_status,
           a.owner_claim_verified_at, a."updatedAt" AS updated_at
      FROM erc8004_identities i
      JOIN agents a ON a.identity_id = i.id`;
}

export type PostgresIngestionRepositoryOptions = {
  readonly now?: () => Date;
  readonly ssl?: boolean;
};

/**
 * Durable implementation of the Wave 1 ingestion ports.
 *
 * The orchestration package intentionally owns no database dependency. This
 * adapter maps its ports to the checked-in PostgreSQL schema and uses one
 * client-scoped transaction for each service operation. Callers should use
 * `withTransaction` around ingestion, reconciliation, or claim mutations;
 * direct reads remain safe and are useful for health checks.
 */
export class PostgresIngestionRepository implements IngestionRepository, ScanDiscoveryCheckpointRepository {
  private readonly pool: PgPool | null;
  private readonly client: PgClient | null;
  private readonly queryable: Queryable;
  private readonly options: PostgresIngestionRepositoryOptions;

  constructor(connection: string | PgPool | PgClient, options: PostgresIngestionRepositoryOptions = {}) {
    this.options = options;
    if (typeof connection === "string") {
      this.pool = new Pool({
        connectionString: connection,
        ssl: options.ssl === true ? { rejectUnauthorized: true } : undefined
      });
      this.client = null;
      this.queryable = this.pool;
    } else if ("release" in connection) {
      this.pool = null;
      this.client = connection;
      this.queryable = connection;
    } else {
      this.pool = connection;
      this.client = null;
      this.queryable = connection;
    }
  }

  async close(): Promise<void> {
    if (this.pool !== null && this.client === null) await this.pool.end();
  }

  private now(): Date {
    const value = this.options.now?.() ?? new Date();
    if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
      throw ingestionError("REPOSITORY_FAILURE", "The repository clock returned an invalid timestamp.", "check_clock");
    }
    return value;
  }

  private async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.queryable.query<T>(text, values as unknown[]);
  }

  async withTransaction<T>(work: (repository: IngestionRepository) => Promise<T>): Promise<T> {
    if (this.client !== null) return work(this);
    if (this.pool === null) throw new Error("Postgres ingestion repository has no connection");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const transactional = new PostgresIngestionRepository(client, this.options);
      const result = await work(transactional);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      // Preserve the original application/constraint error if the connection
      // has already failed while rolling back. A rollback failure must never
      // hide the reason the unit of work was rejected.
      try {
        await client.query("ROLLBACK");
      } catch {
        // The pool will discard an unusable client when it is released.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findIdentity(input: Parameters<typeof normalizeErc8004Identity>[0]): Promise<IdentityRecord | null> {
    const identity = normalizeErc8004Identity(input);
    const result = await this.query<IdentityJoinRow>(
      `${identitySelect()} WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4`,
      [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
    );
    return result.rows[0] === undefined ? null : mapIdentity(result.rows[0]);
  }

  async upsertIdentity(input: IdentityUpsertInput): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    if (input.canonicalState !== undefined) assertIdentityReadProvenance(input.canonicalState, "canonical identity state");
    const canonical = input.canonicalState === undefined
      ? undefined
      : {
        ...input.canonicalState,
        ownerAddress: input.canonicalState.ownerAddress === null ? null : normalizeEvmAddress(input.canonicalState.ownerAddress),
        agentWallet: input.canonicalState.agentWallet === null ? null : normalizeEvmAddress(input.canonicalState.agentWallet),
        observedBlockHash: input.canonicalState.observedBlockHash.toLowerCase()
      };
    const id = randomUUID();
    const now = this.now();
    const identityColumns = ["id", "namespace", "chain_id", "identity_registry", "agent_id"];
    const identityValues: unknown[] = [id, identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId];
    const updates: string[] = [];
    if (canonical !== undefined) {
      identityColumns.push(
        "owner_address", "owner_observed_block", "agent_wallet", "agent_wallet_observed_block",
        "agent_uri", "agent_uri_observed_block", "content_digest", "content_digest_observed_block",
        "observed_block", "observed_block_hash", "read_consistency"
      );
      identityValues.push(
        canonical.ownerAddress, canonical.ownerObservedBlock, canonical.agentWallet,
        canonical.agentWalletObservedBlock, canonical.agentUri, canonical.agentUriObservedBlock,
        canonical.contentDigest, canonical.contentDigestObservedBlock, canonical.observedBlock,
        canonical.observedBlockHash.toLowerCase(), canonical.readConsistency
      );
      const first = identityValues.length - 11;
      for (let index = 0; index < 11; index += 1) updates.push(`${identityColumns[first + index]} = EXCLUDED.${identityColumns[first + index]}`);
    }
    const placeholders = identityColumns.map((_, index) => `$${index + 1}`);
    const identityResult = await this.query<{ id: string }>(
      `INSERT INTO erc8004_identities (${identityColumns.join(", ")}) VALUES (${placeholders.join(", ")})
       ON CONFLICT (namespace, chain_id, identity_registry, agent_id)
       DO UPDATE SET ${updates.length === 0 ? '"updatedAt" = erc8004_identities."updatedAt"' : `${updates.join(", ")}, "updatedAt" = now()`}
       RETURNING id`,
      identityValues
    );
    const identityId = identityResult.rows[0]?.id;
    if (identityId === undefined) throw ingestionError("REPOSITORY_FAILURE", "Identity upsert returned no row.", "repair_repository_mapping");

    const ownerForAgent = canonical?.ownerAddress ?? null;
    await this.query(
      `INSERT INTO agents (id, identity_id, origin_type, observed_external_owner, "updatedAt")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (identity_id) DO UPDATE SET
         observed_external_owner = CASE WHEN $6::boolean THEN EXCLUDED.observed_external_owner ELSE agents.observed_external_owner END,
         "updatedAt" = CASE WHEN $6::boolean THEN EXCLUDED."updatedAt" ELSE agents."updatedAt" END`,
      [randomUUID(), identityId, input.originType, ownerForAgent, now, canonical !== undefined]
    );
    const result = await this.query<IdentityJoinRow>(`${identitySelect()} WHERE i.id = $1`, [identityId]);
    const row = result.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "Identity projection was not created.", "repair_repository_mapping");
    return mapIdentity(row);
  }

  async applyCanonicalState(input: IdentityCanonicalUpdate): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    assertIdentityReadProvenance(input, "canonical identity state");
    const previous = await this.findIdentity(identity);
    if (previous === null) return this.upsertIdentity({ identity, originType: "discovered", canonicalState: input });
    const previousRow = await this.identityJoinByKey(erc8004IdentityKey(identity));
    if (previousRow === null) throw ingestionError("REPOSITORY_FAILURE", "Identity projection disappeared during canonical update.", "retry_repository");
    const ownerAddress = input.ownerAddress === null ? null : normalizeEvmAddress(input.ownerAddress);
    const agentWallet = input.agentWallet === null ? null : normalizeEvmAddress(input.agentWallet);
    const ownerChanged = previous.ownerAddress !== ownerAddress;
    const nextClaimStatus = ownerChanged && previous.state.claimStatus === "claimed" ? "stale" : previous.state.claimStatus;
    if (nextClaimStatus !== previous.state.claimStatus) assertStateTransition("claimStatus", previous.state.claimStatus, nextClaimStatus);
    const now = this.now();
    await this.query(
      `UPDATE erc8004_identities SET owner_address=$1, owner_observed_block=$2,
         agent_wallet=$3, agent_wallet_observed_block=$4, agent_uri=$5, agent_uri_observed_block=$6,
         content_digest=$7, content_digest_observed_block=$8, observed_block=$9,
         observed_block_hash=$10, read_consistency=$11, "updatedAt"=$12 WHERE id=$13`,
      [ownerAddress, input.ownerObservedBlock, agentWallet, input.agentWalletObservedBlock,
        input.agentUri, input.agentUriObservedBlock, input.contentDigest, input.contentDigestObservedBlock,
        input.observedBlock, input.observedBlockHash.toLowerCase(), input.readConsistency, now, previous.id]
    );
    await this.query(
      `UPDATE agents SET observed_external_owner=$1, claim_status=$2,
         owner_claim_verified_at=CASE WHEN $3::boolean THEN NULL ELSE owner_claim_verified_at END,
         "updatedAt"=$4 WHERE id=$5`,
      [ownerAddress, nextClaimStatus, ownerChanged, now, previousRow.agent_projection_id]
    );
    const result = await this.query<IdentityJoinRow>(`${identitySelect()} WHERE i.id = $1`, [previous.id]);
    const row = result.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "Canonical identity update returned no row.", "repair_repository_mapping");
    return mapIdentity(row);
  }

  async listIdentities(filter: IngestionFilter = {}): Promise<readonly IdentityRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (filter.chainId !== undefined) { values.push(filter.chainId); clauses.push(`i.chain_id = $${values.length}`); }
    if (filter.identityRegistry !== undefined) { values.push(normalizeEvmAddress(filter.identityRegistry)); clauses.push(`i.identity_registry = $${values.length}`); }
    const result = await this.query<IdentityJoinRow>(`${identitySelect()}${clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`} ORDER BY i.namespace, i.chain_id, i.identity_registry, i.agent_id`, values);
    return result.rows.map(mapIdentity);
  }

  async recordSource(input: {
    readonly identityKey: IdentityKey;
    readonly source: DiscoverySourceRecord["source"];
    readonly sourceReference: string;
    readonly observedAt: Date;
    readonly rawResponseDigest: string | null;
    readonly normalizedIngestionVersion: string;
  }): Promise<DiscoverySourceRecord> {
    const identity = await this.identityId(input.identityKey);
    const result = await this.query<{ first_observed_at: Date; last_observed_at: Date; raw_response_digest: string | null; normalized_ingestion_version: string }>(
      `INSERT INTO agent_discovery_sources (id, identity_id, source, source_reference, first_observed_at, last_observed_at, raw_response_digest, normalized_ingestion_version)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7)
       ON CONFLICT (identity_id, source, source_reference) DO UPDATE SET
         last_observed_at = GREATEST(agent_discovery_sources.last_observed_at, EXCLUDED.last_observed_at),
         raw_response_digest = COALESCE(EXCLUDED.raw_response_digest, agent_discovery_sources.raw_response_digest),
         normalized_ingestion_version = EXCLUDED.normalized_ingestion_version
       RETURNING first_observed_at, last_observed_at, raw_response_digest, normalized_ingestion_version`,
      [randomUUID(), identity.id, input.source, input.sourceReference, input.observedAt, input.rawResponseDigest, input.normalizedIngestionVersion]
    );
    const row = result.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "Discovery source upsert returned no row.", "repair_repository_mapping");
    return {
      identityKey: input.identityKey,
      source: input.source,
      sourceReference: input.sourceReference,
      firstObservedAt: row.first_observed_at,
      lastObservedAt: row.last_observed_at,
      rawResponseDigest: row.raw_response_digest,
      normalizedIngestionVersion: row.normalized_ingestion_version
    };
  }

  async listSources(identityKey: IdentityKey): Promise<readonly DiscoverySourceRecord[]> {
    const identity = await this.identityId(identityKey);
    const result = await this.query<{ source: DiscoverySourceRecord["source"]; source_reference: string; first_observed_at: Date; last_observed_at: Date; raw_response_digest: string | null; normalized_ingestion_version: string }>(
      `SELECT source, source_reference, first_observed_at, last_observed_at, raw_response_digest, normalized_ingestion_version
       FROM agent_discovery_sources WHERE identity_id=$1 ORDER BY source_reference`, [identity.id]
    );
    return result.rows.map((row) => ({ identityKey, source: row.source, sourceReference: row.source_reference, firstObservedAt: row.first_observed_at, lastObservedAt: row.last_observed_at, rawResponseDigest: row.raw_response_digest, normalizedIngestionVersion: row.normalized_ingestion_version }));
  }

  async appendObservation(input: ChainObservation): Promise<ChainObservation> {
    const row = observationToRow(input);
    const identity = await this.identityId(row.identityKey);
    // The read-before-write check used by the original adapter was safe for
    // sequential replays but could race two workers. Let PostgreSQL arbitrate
    // the unique log position, then compare the canonical row below so a
    // duplicate replay is idempotent while conflicting payloads fail closed.
    await this.query(
      `INSERT INTO erc8004_chain_observations
       (id, identity_id, event_type, transaction_hash, log_index, block_number, block_hash, confirmation_state,
        normalized_owner, normalized_agent_uri, normalized_agent_wallet, normalized_content_digest,
        observed_fields, first_observed_at, canonicalized_at, orphaned_at, payload_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (transaction_hash, log_index) DO NOTHING`,
      [randomUUID(), identity.id, row.eventType, row.transactionHash, row.logIndex, row.blockNumber, row.blockHash,
        row.confirmationState, row.normalizedOwner, row.normalizedAgentUri, row.normalizedAgentWallet,
        row.normalizedContentDigest, JSON.stringify(row.observedFields), row.firstObservedAt, row.canonicalizedAt,
        row.orphanedAt, row.payloadDigest]
    );
    const stored = await this.query<ObservationDbRow>(
      `${observationSelect()} WHERE o.transaction_hash=$1 AND o.log_index=$2`,
      [row.transactionHash, row.logIndex]
    );
    const existingRow = stored.rows[0];
    if (existingRow === undefined) {
      throw ingestionError("REPOSITORY_FAILURE", "The chain observation was not readable after persistence.", "retry_repository");
    }
    const existing = mapObservation(existingRow);
    if (
      existing.blockHash !== row.blockHash ||
      existing.identityKey !== row.identityKey ||
      existing.eventType !== row.eventType ||
      existing.payloadDigest !== row.payloadDigest ||
      existing.observedFields.join(",") !== row.observedFields.join(",")
    ) {
      throw ingestionError(
        "DUPLICATE_CHAIN_LOG_CONFLICT",
        "A chain log position was observed with conflicting data.",
        "reconcile_chain",
        { existing, input }
      );
    }
    return existing;
  }

  async findObservation(transactionHash: string, logIndex: number): Promise<ChainObservation | null> {
    const result = await this.query<ObservationDbRow>(`${observationSelect()} WHERE o.transaction_hash=$1 AND o.log_index=$2`, [transactionHash.toLowerCase(), logIndex]);
    return result.rows[0] === undefined ? null : mapObservation(result.rows[0]);
  }

  async markCanonical(input: { readonly chainId: number; readonly identityRegistry: string; readonly throughBlock: number; readonly canonicalizedAt: Date }): Promise<readonly ChainObservation[]> {
    const result = await this.query<ObservationDbRow>(
      `WITH promoted AS (
         UPDATE erc8004_chain_observations o SET confirmation_state='canonical', canonicalized_at=$1
          FROM erc8004_identities i
         WHERE o.identity_id=i.id AND i.chain_id=$2 AND i.identity_registry=$3
           AND o.block_number <= $4 AND o.confirmation_state='provisional'
         RETURNING o.*
       )
       SELECT p.id, p.identity_id, i.namespace, i.chain_id, i.identity_registry, i.agent_id,
              p.event_type, p.transaction_hash, p.log_index, p.block_number, p.block_hash,
              p.confirmation_state, p.normalized_owner, p.normalized_agent_uri,
              p.normalized_agent_wallet, p.normalized_content_digest, p.observed_fields,
              p.first_observed_at, p.canonicalized_at, p.orphaned_at, p.payload_digest
         FROM promoted p JOIN erc8004_identities i ON i.id=p.identity_id
        ORDER BY p.block_number, p.log_index`,
      [input.canonicalizedAt, input.chainId, normalizeEvmAddress(input.identityRegistry), input.throughBlock]
    );
    return result.rows.map(mapObservation);
  }

  async listObservations(input: { readonly chainId: number; readonly identityRegistry: string; readonly fromBlock?: number; readonly toBlock?: number; readonly state?: ChainObservationState }): Promise<readonly ChainObservation[]> {
    const values: unknown[] = [input.chainId, normalizeEvmAddress(input.identityRegistry)];
    const clauses = ["i.chain_id=$1", "i.identity_registry=$2"];
    if (input.fromBlock !== undefined) { values.push(input.fromBlock); clauses.push(`o.block_number >= $${values.length}`); }
    if (input.toBlock !== undefined) { values.push(input.toBlock); clauses.push(`o.block_number <= $${values.length}`); }
    if (input.state !== undefined) { values.push(input.state); clauses.push(`o.confirmation_state = $${values.length}`); }
    const result = await this.query<ObservationDbRow>(`${observationSelect()} WHERE ${clauses.join(" AND ")} ORDER BY o.block_number, o.log_index`, values);
    return result.rows.map(mapObservation);
  }

  async markOrphaned(input: { readonly chainId: number; readonly identityRegistry: string; readonly fromBlock: number; readonly occurredAt: Date }): Promise<readonly IdentityKey[]> {
    const result = await this.query<{ namespace: string; chain_id: number; identity_registry: string; agent_id: string }>(
      `WITH orphaned AS (
         UPDATE erc8004_chain_observations o SET confirmation_state='orphaned', orphaned_at=$1
            FROM erc8004_identities i
           WHERE o.identity_id=i.id AND i.chain_id=$2 AND i.identity_registry=$3
             AND o.block_number >= $4 AND o.confirmation_state <> 'orphaned'
         RETURNING o.identity_id
       )
       SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id
         FROM orphaned o JOIN erc8004_identities i ON i.id=o.identity_id`,
      [input.occurredAt, input.chainId, normalizeEvmAddress(input.identityRegistry), input.fromBlock]
    );
    return [...new Set(result.rows.map((row) => erc8004IdentityKey({ namespace: row.namespace, chainId: row.chain_id, identityRegistry: row.identity_registry, agentId: row.agent_id })))]
      .sort();
  }

  async appendReputationEvent(input: ReputationFeedbackEvent): Promise<ReputationFeedbackEvent> {
    const normalized = normalizeReputationFeedbackEvent(input);
    const identity = await this.findIdentity(normalized.identity);
    if (identity === null) throw ingestionError("REPUTATION_IDENTITY_NOT_FOUND", "The reputation event identity is not in the ingestion index.", "import_identity");
    await this.query(
      `INSERT INTO erc8004_reputation_events
       (id, identity_id, namespace, chain_id, identity_registry, reputation_registry, agent_id,
        event_type, client_address, feedback_index, value, value_decimals, indexed_tag1, tag1,
        tag2, endpoint, feedback_uri, feedback_hash, transaction_hash, log_index, block_number,
        block_hash, confirmation_state, observed_at, canonicalized_at, orphaned_at, payload_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       ON CONFLICT (transaction_hash, log_index, block_hash) DO NOTHING`,
      [randomUUID(), identity.id, normalized.identity.namespace, normalized.identity.chainId, normalized.identity.identityRegistry, normalized.reputationRegistry, normalized.identity.agentId,
        normalized.eventType, normalized.clientAddress, normalized.feedbackIndex, normalized.value, normalized.valueDecimals, normalized.indexedTag1, normalized.tag1,
        normalized.tag2, normalized.endpoint, normalized.feedbackUri, normalized.feedbackHash, normalized.transactionHash, normalized.logIndex, normalized.blockNumber,
        normalized.blockHash, normalized.confirmationState, normalized.observedAt, normalized.canonicalizedAt, normalized.orphanedAt, normalized.payloadDigest]
    );
    const stored = await this.query<ReputationEventDbRow>(`${reputationEventSelect()} WHERE r.transaction_hash=$1 AND r.log_index=$2 AND r.block_hash=$3`, [normalized.transactionHash, normalized.logIndex, normalized.blockHash]);
    const row = stored.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "The reputation event was not readable after persistence.", "retry_repository");
    const existing = mapReputationEvent(row);
    if (!sameReputationEvent(existing, normalized)) throw ingestionError("REPUTATION_DUPLICATE_CONFLICT", "A reputation log position was observed with conflicting data.", "reconcile_reputation", { existing, input: normalized });
    return existing;
  }

  async markReputationCanonical(input: { readonly chainId: number; readonly identityRegistry: string; readonly reputationRegistry: string; readonly throughBlock: number; readonly canonicalizedAt: Date }): Promise<readonly ReputationFeedbackEvent[]> {
    const result = await this.query<ReputationEventDbRow>(
      `WITH promoted AS (
         UPDATE erc8004_reputation_events r SET confirmation_state='canonical', canonicalized_at=$1
          FROM erc8004_identities i
         WHERE r.identity_id=i.id AND i.chain_id=$2 AND i.identity_registry=$3
           AND r.reputation_registry=$4 AND r.block_number <= $5 AND r.confirmation_state='provisional'
         RETURNING r.*
       )
       SELECT p.id, p.identity_id, i.namespace, i.chain_id, i.identity_registry,
              p.reputation_registry, i.agent_id, p.event_type, p.client_address,
              p.feedback_index, p.value, p.value_decimals, p.indexed_tag1, p.tag1,
              p.tag2, p.endpoint, p.feedback_uri, p.feedback_hash, p.transaction_hash,
              p.log_index, p.block_number, p.block_hash, p.confirmation_state,
              p.observed_at, p.canonicalized_at, p.orphaned_at, p.payload_digest
         FROM promoted p JOIN erc8004_identities i ON i.id=p.identity_id
        ORDER BY p.block_number, p.log_index, p.transaction_hash, p.block_hash`,
      [input.canonicalizedAt, input.chainId, normalizeEvmAddress(input.identityRegistry), normalizeEvmAddress(input.reputationRegistry), input.throughBlock]
    );
    return result.rows.map(mapReputationEvent);
  }

  async listReputationEvents(input: { readonly chainId: number; readonly identityRegistry: string; readonly reputationRegistry: string; readonly fromBlock?: number; readonly toBlock?: number; readonly state?: ChainObservationState }): Promise<readonly ReputationFeedbackEvent[]> {
    const values: unknown[] = [input.chainId, normalizeEvmAddress(input.identityRegistry), normalizeEvmAddress(input.reputationRegistry)];
    const clauses = ["i.chain_id=$1", "i.identity_registry=$2", "r.reputation_registry=$3"];
    if (input.fromBlock !== undefined) { values.push(input.fromBlock); clauses.push(`r.block_number >= $${values.length}`); }
    if (input.toBlock !== undefined) { values.push(input.toBlock); clauses.push(`r.block_number <= $${values.length}`); }
    if (input.state !== undefined) { values.push(input.state); clauses.push(`r.confirmation_state = $${values.length}`); }
    const result = await this.query<ReputationEventDbRow>(`${reputationEventSelect()} WHERE ${clauses.join(" AND ")} ORDER BY r.block_number, r.log_index, r.transaction_hash, r.block_hash`, values);
    return result.rows.map(mapReputationEvent);
  }

  async markReputationOrphaned(input: { readonly chainId: number; readonly identityRegistry: string; readonly reputationRegistry: string; readonly fromBlock: number; readonly occurredAt: Date }): Promise<readonly IdentityKey[]> {
    const result = await this.query<{ namespace: string; chain_id: number; identity_registry: string; agent_id: string }>(
      `WITH orphaned AS (
         UPDATE erc8004_reputation_events r SET confirmation_state='orphaned', orphaned_at=$1
            FROM erc8004_identities i
           WHERE r.identity_id=i.id AND i.chain_id=$2 AND i.identity_registry=$3
             AND r.reputation_registry=$4 AND r.block_number >= $5 AND r.confirmation_state <> 'orphaned'
           RETURNING r.identity_id
       )
       SELECT i.namespace, i.chain_id, i.identity_registry, i.agent_id
         FROM orphaned o JOIN erc8004_identities i ON i.id=o.identity_id`,
      [input.occurredAt, input.chainId, normalizeEvmAddress(input.identityRegistry), normalizeEvmAddress(input.reputationRegistry), input.fromBlock]
    );
    return [...new Set(result.rows.map((row) => erc8004IdentityKey({
      namespace: row.namespace,
      chainId: row.chain_id,
      identityRegistry: row.identity_registry,
      agentId: row.agent_id
    })))]
      .sort();
  }

  async listReputationFeedback(identity: import("@bnbera/domain").Erc8004Identity, options: { readonly includeRevoked?: boolean } = {}): Promise<readonly ReputationFeedback[]> {
    const normalizedIdentity = normalizeErc8004Identity(identity);
    // The registry is a separate configured axis; callers of this method query
    // all rows for the identity below, then project canonical feedback. Keeping
    // the identity tuple in the WHERE clause prevents cross-agent joins.
    const all = await this.query<ReputationEventDbRow>(`${reputationEventSelect()} WHERE i.namespace=$1 AND i.chain_id=$2 AND i.identity_registry=$3 AND i.agent_id=$4 ORDER BY r.block_number, r.log_index, r.transaction_hash, r.block_hash`, [normalizedIdentity.namespace, normalizedIdentity.chainId, normalizedIdentity.identityRegistry, normalizedIdentity.agentId]);
    return projectReputationFeedback(all.rows.map(mapReputationEvent), normalizedIdentity, options);
  }

  async getReputationCheckpoint(chainId: number, identityRegistry: string, reputationRegistry: string): Promise<ReputationCheckpoint | null> {
    const result = await this.query<ReputationCheckpointDbRow>(
      `SELECT chain_id, identity_registry, reputation_registry, indexer_version,
              last_scanned_block, last_scanned_block_hash, last_finalized_block,
              last_finalized_block_hash, confirmation_threshold, cursor_version,
              last_reconciliation_at
         FROM erc8004_reputation_checkpoints
        WHERE chain_id=$1 AND identity_registry=$2 AND reputation_registry=$3`,
      [chainId, normalizeEvmAddress(identityRegistry), normalizeEvmAddress(reputationRegistry)]
    );
    return result.rows[0] === undefined ? null : mapReputationCheckpoint(result.rows[0]);
  }

  async saveReputationCheckpoint(input: ReputationCheckpoint, condition: ReputationCheckpointWriteCondition): Promise<ReputationCheckpoint> {
    const normalized = normalizeReputationCheckpoint(input);
    const existing = await this.getReputationCheckpoint(normalized.chainId, normalized.identityRegistry, normalized.reputationRegistry);
    if (existing === null) {
      if (condition.expectedCursorVersion !== null || condition.expectedLastScannedBlockHash !== null || normalized.cursorVersion !== 1) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint create condition does not match an empty cursor.", "reconcile_reputation", { condition, input: normalized });
      const inserted = await this.query(
        `INSERT INTO erc8004_reputation_checkpoints
          (id, chain_id, identity_registry, reputation_registry, indexer_version,
           last_scanned_block, last_scanned_block_hash, last_finalized_block,
           last_finalized_block_hash, confirmation_threshold, cursor_version,
           last_reconciliation_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (chain_id, identity_registry, reputation_registry) DO NOTHING`,
        [randomUUID(), normalized.chainId, normalized.identityRegistry, normalized.reputationRegistry, normalized.indexerVersion, normalized.lastScannedBlock, normalized.lastScannedBlockHash, normalized.lastFinalizedBlock, normalized.lastFinalizedBlockHash, normalized.confirmationThreshold, normalized.cursorVersion, normalized.lastReconciliationAt]
      );
      if (inserted.rowCount !== 1) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint changed before this update completed.", "reconcile_reputation", { condition, input: normalized, concurrentCreate: true });
      return normalized;
    }
    if (condition.expectedCursorVersion !== existing.cursorVersion || !sameHash(condition.expectedLastScannedBlockHash, existing.lastScannedBlockHash)) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint changed before this update completed.", "reconcile_reputation", { existing, input: normalized, condition });
    if (normalized.indexerVersion === existing.indexerVersion && normalized.confirmationThreshold !== existing.confirmationThreshold) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation confirmation threshold is immutable for an indexer version.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.cursorVersion !== existing.cursorVersion + 1) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint cursor must advance exactly once.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.lastScannedBlock > existing.lastScannedBlock && (condition.previousScannedBlock !== existing.lastScannedBlock || !sameHash(condition.previousScannedBlockHash ?? null, existing.lastScannedBlockHash))) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint predecessor does not match the persisted scan cursor.", "reconcile_reputation", { existing, input: normalized, condition });
    const rewind = condition.verifiedRewind;
    const lowersScanned = normalized.lastScannedBlock < existing.lastScannedBlock;
    const lowersFinality = normalized.lastFinalizedBlock < existing.lastFinalizedBlock;
    if (lowersScanned || lowersFinality) {
      if (rewind === undefined || rewind.previousScannedBlock !== existing.lastScannedBlock || !sameHash(rewind.previousScannedBlockHash, existing.lastScannedBlockHash) || rewind.commonAncestorBlock !== normalized.lastScannedBlock || !sameHash(rewind.commonAncestorHash, normalized.lastScannedBlockHash)) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint would move backwards without an explicit verified rewind.", "reconcile_reputation", { existing, input: normalized, condition });
    } else if (normalized.lastScannedBlock === existing.lastScannedBlock && !sameHash(normalized.lastScannedBlockHash, existing.lastScannedBlockHash)) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "A reputation checkpoint block cannot change its hash without a verified rewind.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.lastFinalizedBlock === existing.lastFinalizedBlock && !sameHash(normalized.lastFinalizedBlockHash, existing.lastFinalizedBlockHash) && rewind === undefined) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "A finalized reputation block cannot change its hash without a verified rewind.", "reconcile_reputation", { existing, input: normalized });
    const result = await this.query(
      `UPDATE erc8004_reputation_checkpoints SET indexer_version=$1, last_scanned_block=$2,
        last_scanned_block_hash=$3, last_finalized_block=$4, last_finalized_block_hash=$5,
        confirmation_threshold=$6, cursor_version=$7, last_reconciliation_at=$8, "updatedAt"=now()
       WHERE chain_id=$9 AND identity_registry=$10 AND reputation_registry=$11
         AND cursor_version=$12 AND last_scanned_block_hash=$13`,
      [normalized.indexerVersion, normalized.lastScannedBlock, normalized.lastScannedBlockHash, normalized.lastFinalizedBlock, normalized.lastFinalizedBlockHash, normalized.confirmationThreshold, normalized.cursorVersion, normalized.lastReconciliationAt, normalized.chainId, normalized.identityRegistry, normalized.reputationRegistry, existing.cursorVersion, existing.lastScannedBlockHash]
    );
    if (result.rowCount !== 1) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint changed before this update completed.", "reconcile_reputation", { existing, input: normalized });
    return normalized;
  }

  async getCheckpoint(chainId: number, identityRegistry: string): Promise<ChainCheckpoint | null> {
    const result = await this.query<CheckpointDbRow>(
      `SELECT chain_id, identity_registry, indexer_version, last_scanned_block, last_scanned_block_hash,
              last_finalized_block, last_finalized_block_hash, confirmation_threshold, cursor_version,
              last_reconciliation_at FROM chain_ingestion_checkpoints WHERE chain_id=$1 AND identity_registry=$2`,
      [chainId, normalizeEvmAddress(identityRegistry)]
    );
    return result.rows[0] === undefined ? null : mapCheckpoint(result.rows[0]);
  }

  async saveCheckpoint(input: ChainCheckpoint, condition: CheckpointWriteCondition): Promise<ChainCheckpoint> {
    const normalized = normalizeRegistryCheckpoint(input);
    const existing = await this.getCheckpoint(normalized.chainId, normalized.identityRegistry);
    if (existing === null) {
      if (condition.expectedCursorVersion !== null || condition.expectedLastScannedBlockHash !== null || normalized.cursorVersion < 1) {
        conflict("The checkpoint create condition does not match an empty cursor.", { condition, input: normalized });
      }
      const inserted = await this.query<{ id: string }>(
        `INSERT INTO chain_ingestion_checkpoints (id, chain_id, identity_registry, indexer_version,
          last_scanned_block, last_scanned_block_hash, last_finalized_block, last_finalized_block_hash,
          confirmation_threshold, cursor_version, last_reconciliation_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (chain_id, identity_registry) DO NOTHING
         RETURNING id`,
        [randomUUID(), normalized.chainId, normalized.identityRegistry, normalized.indexerVersion,
          normalized.lastScannedBlock, normalized.lastScannedBlockHash, normalized.lastFinalizedBlock,
          normalized.lastFinalizedBlockHash, normalized.confirmationThreshold, normalized.cursorVersion,
          normalized.lastReconciliationAt]
      );
      if (inserted.rowCount !== 1) {
        // Another worker created this cursor after our initial read. Report a
        // structured CAS conflict instead of leaking a raw unique violation.
        conflict("The ingestion checkpoint changed before this update completed.", {
          input: normalized,
          condition,
          concurrentCreate: true
        });
      }
      return normalized;
    }
    if (condition.expectedCursorVersion !== existing.cursorVersion || !sameHash(condition.expectedLastScannedBlockHash, existing.lastScannedBlockHash)) conflict("The ingestion checkpoint changed before this update completed.", { existing, input: normalized, condition });
    if (normalized.indexerVersion === existing.indexerVersion && normalized.confirmationThreshold !== existing.confirmationThreshold) conflict("The confirmation threshold is immutable for an indexer version.", { existing, input: normalized });
    if (normalized.cursorVersion !== existing.cursorVersion + 1) conflict("The ingestion checkpoint cursor must advance exactly once.", { existing, input: normalized });
    if (normalized.lastScannedBlock > existing.lastScannedBlock && (condition.previousScannedBlock !== existing.lastScannedBlock || !sameHash(condition.previousScannedBlockHash ?? null, existing.lastScannedBlockHash))) conflict("The checkpoint predecessor does not match the persisted scan cursor.", { existing, input: normalized, condition });
    const rewind = condition.verifiedRewind;
    const lowersScanned = normalized.lastScannedBlock < existing.lastScannedBlock;
    const lowersFinality = normalized.lastFinalizedBlock < existing.lastFinalizedBlock;
    if (lowersScanned || lowersFinality) {
      if (rewind === undefined || rewind.previousScannedBlock !== existing.lastScannedBlock || !sameHash(rewind.previousScannedBlockHash, existing.lastScannedBlockHash) || rewind.commonAncestorBlock !== normalized.lastScannedBlock || !sameHash(rewind.commonAncestorHash, normalized.lastScannedBlockHash)) conflict("The checkpoint would move backwards without an explicit verified rewind.", { existing, input: normalized, condition });
    } else if (normalized.lastScannedBlock === existing.lastScannedBlock && !sameHash(normalized.lastScannedBlockHash, existing.lastScannedBlockHash)) conflict("A checkpoint block cannot change its hash without a verified rewind.", { existing, input: normalized });
    if (normalized.lastFinalizedBlock === existing.lastFinalizedBlock && !sameHash(normalized.lastFinalizedBlockHash, existing.lastFinalizedBlockHash) && rewind === undefined) conflict("A finalized block cannot change its hash without a verified rewind.", { existing, input: normalized });
    const result = await this.query(
      `UPDATE chain_ingestion_checkpoints SET indexer_version=$1, last_scanned_block=$2,
        last_scanned_block_hash=$3, last_finalized_block=$4, last_finalized_block_hash=$5,
        confirmation_threshold=$6, cursor_version=$7, last_reconciliation_at=$8, "updatedAt"=now()
       WHERE chain_id=$9 AND identity_registry=$10 AND cursor_version=$11 AND last_scanned_block_hash=$12`,
      [normalized.indexerVersion, normalized.lastScannedBlock, normalized.lastScannedBlockHash,
        normalized.lastFinalizedBlock, normalized.lastFinalizedBlockHash, normalized.confirmationThreshold,
        normalized.cursorVersion, normalized.lastReconciliationAt, normalized.chainId,
        normalized.identityRegistry, existing.cursorVersion, existing.lastScannedBlockHash]
    );
    if (result.rowCount !== 1) conflict("The ingestion checkpoint changed before this update completed.", { existing, input: normalized });
    return normalized;
  }

  async getScanDiscoveryCheckpoint(scope: string): Promise<ScanDiscoveryCheckpoint | null> {
    const normalizedScope = scanScope(scope);
    const result = await this.query<ScanDiscoveryCheckpointDbRow>(
      `SELECT scope, query_digest, initial_offset, initial_cursor, next_offset, next_cursor,
              page_size, total, pages_processed, candidates_processed, last_page_digest,
              cursor_version, completed_at, "updatedAt" AS updated_at
         FROM scan_discovery_checkpoints
        WHERE scope=$1`,
      [normalizedScope]
    );
    return result.rows[0] === undefined ? null : mapScanDiscoveryCheckpoint(result.rows[0]);
  }

  async saveScanDiscoveryCheckpoint(
    input: ScanDiscoveryCheckpoint,
    condition: ScanDiscoveryCheckpointWriteCondition
  ): Promise<ScanDiscoveryCheckpoint> {
    const normalizedScope = scanScope(input.scope);
    if (
      normalizedScope !== input.scope ||
      !/^[0-9A-Fa-f]{64}$/u.test(input.queryDigest) ||
      (input.initialOffset !== null && input.initialCursor !== null) ||
      (input.nextOffset !== null && input.nextCursor !== null) ||
      !Number.isSafeInteger(input.pageSize) ||
      input.pageSize <= 0 ||
      !Number.isSafeInteger(input.pagesProcessed) ||
      input.pagesProcessed < 0 ||
      !Number.isSafeInteger(input.candidatesProcessed) ||
      input.candidatesProcessed < 0 ||
      !Number.isSafeInteger(input.cursorVersion) ||
      input.cursorVersion <= 0 ||
      (input.lastPageDigest !== null && !/^[0-9A-Fa-f]{64}$/u.test(input.lastPageDigest)) ||
      (input.completedAt === null) !== (input.nextOffset !== null || input.nextCursor !== null)
    ) {
      scanConflict("The 8004scan checkpoint shape is invalid.", { input });
    }
    const existing = await this.getScanDiscoveryCheckpoint(normalizedScope);
    if (existing === null) {
      if (
        condition.expectedCursorVersion !== null ||
        condition.expectedQueryDigest !== input.queryDigest ||
        condition.expectedInitialOffset !== input.initialOffset ||
        condition.expectedInitialCursor !== input.initialCursor ||
        input.cursorVersion !== 1
      ) {
        scanConflict("The scan checkpoint create condition does not match an empty cursor.", { condition, input });
      }
      const inserted = await this.query<{ scope: string }>(
        `INSERT INTO scan_discovery_checkpoints
          (id, scope, query_digest, initial_offset, initial_cursor, next_offset, next_cursor,
           page_size, total, pages_processed, candidates_processed, last_page_digest,
           cursor_version, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (scope) DO NOTHING
         RETURNING scope`,
        [randomUUID(), normalizedScope, input.queryDigest, input.initialOffset, input.initialCursor,
          input.nextOffset, input.nextCursor, input.pageSize, input.total, input.pagesProcessed,
          input.candidatesProcessed, input.lastPageDigest, input.cursorVersion, input.completedAt]
      );
      if (inserted.rowCount !== 1) {
        scanConflict("The 8004scan checkpoint changed before this page completed.", {
          condition,
          input,
          concurrentCreate: true
        });
      }
      return input;
    }
    if (
      condition.expectedCursorVersion !== existing.cursorVersion ||
      condition.expectedQueryDigest !== existing.queryDigest ||
      condition.expectedInitialOffset !== existing.initialOffset ||
      condition.expectedInitialCursor !== existing.initialCursor
    ) {
      scanConflict("The 8004scan checkpoint changed before this page completed.", { existing, input, condition });
    }
    if (input.cursorVersion !== existing.cursorVersion + 1) {
      scanConflict("The 8004scan checkpoint cursor must advance exactly once.", { existing, input });
    }
    if (existing.completedAt !== null) {
      scanConflict("A completed 8004scan checkpoint cannot be advanced.", { existing, input });
    }
    if (input.scope !== existing.scope || input.queryDigest !== existing.queryDigest) {
      scanConflict("The 8004scan checkpoint query scope is immutable.", { existing, input });
    }
    if (input.initialOffset !== existing.initialOffset || input.initialCursor !== existing.initialCursor) {
      scanConflict("The 8004scan checkpoint start position is immutable.", { existing, input });
    }
    if (input.pageSize !== existing.pageSize) {
      scanConflict("The 8004scan checkpoint page size is immutable.", { existing, input });
    }
    if (input.pagesProcessed !== existing.pagesProcessed + 1 || input.candidatesProcessed < existing.candidatesProcessed) {
      scanConflict("The 8004scan checkpoint counters must advance monotonically.", { existing, input });
    }
    if (existing.total !== null && input.total !== null && input.total !== existing.total) {
      scanConflict("The 8004scan total changed within one query stream.", { existing, input });
    }
    if (
      (existing.nextOffset !== null && input.nextCursor !== null) ||
      (existing.nextCursor !== null && input.nextOffset !== null)
    ) {
      scanConflict("The 8004scan pagination mode changed within one query stream.", { existing, input });
    }
    if (existing.nextOffset !== null && input.nextOffset !== null && input.nextOffset <= existing.nextOffset) {
      scanConflict("The 8004scan offset must advance monotonically.", { existing, input });
    }
    if (existing.nextCursor !== null && input.nextCursor !== null && input.nextCursor === existing.nextCursor) {
      scanConflict("The 8004scan cursor must advance monotonically.", { existing, input });
    }
    const result = await this.query(
      `UPDATE scan_discovery_checkpoints SET
          query_digest=$1, initial_offset=$2, initial_cursor=$3, next_offset=$4, next_cursor=$5,
          page_size=$6, total=$7, pages_processed=$8, candidates_processed=$9,
          last_page_digest=$10, cursor_version=$11, completed_at=$12, "updatedAt"=now()
        WHERE scope=$13 AND cursor_version=$14`,
      [input.queryDigest, input.initialOffset, input.initialCursor, input.nextOffset, input.nextCursor,
        input.pageSize, input.total, input.pagesProcessed, input.candidatesProcessed,
        input.lastPageDigest, input.cursorVersion, input.completedAt, normalizedScope, existing.cursorVersion]
    );
    if (result.rowCount !== 1) scanConflict("The 8004scan checkpoint changed before this page completed.", { existing, input });
    return input;
  }

  async withScanDiscoveryRunLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const normalizedScope = scanScope(scope);
    if (this.client !== null) {
      const lock = await this.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
        [normalizedScope]
      );
      if (lock.rows[0]?.locked !== true) {
        throw ingestionError(
          "SCAN_JOB_ALREADY_RUNNING",
          "An 8004scan discovery run is already active for this scope.",
          "wait_for_scan_run",
          undefined,
          true
        );
      }
      return work();
    }
    if (this.pool === null) throw new Error("Postgres ingestion repository has no connection");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
        [normalizedScope]
      );
      if (lock.rows[0]?.locked !== true) {
        await client.query("ROLLBACK");
        throw ingestionError(
          "SCAN_JOB_ALREADY_RUNNING",
          "An 8004scan discovery run is already active for this scope.",
          "wait_for_scan_run",
          undefined,
          true
        );
      }
      const result = await work();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original job error and let the pool discard a failed client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getClaim(identityKey: IdentityKey): Promise<ClaimRecord | null> {
    const row = await this.identityJoinByKey(identityKey);
    return row === null ? null : mapClaim(row, identityKey);
  }

  async mutateClaim(input: ClaimMutation): Promise<ClaimRecord> {
    const current = await this.identityJoinByKey(input.identityKey);
    const existing = current === null ? null : mapClaim(current, input.identityKey);
    if ((existing === null && input.expectedVersion !== null) || (existing !== null && (input.expectedVersion !== existing.version || input.expectedStatus !== existing.status)) || (existing === null && input.expectedStatus !== null)) {
      throw ingestionError("CLAIM_CONFLICT", "The claim changed before this operation completed.", "reload_claim");
    }
    if (current === null) throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    if (input.claim.identityKey !== input.identityKey || input.event.identityKey !== input.identityKey || input.claim.version !== (existing?.version ?? 0) + 1 || input.event.actorId.trim().length === 0 || input.event.actorType !== input.actor.type) throw ingestionError("CLAIM_CONFLICT", "The claim mutation is internally inconsistent.", "reload_claim");
    if (existing !== null && existing.status !== input.claim.status) {
      try { assertStateTransition("claimStatus", existing.status, input.claim.status); } catch (cause) { throw ingestionError("CLAIM_CONFLICT", "The claim status transition is not allowed.", "reload_claim", cause); }
    }
    if ((input.claim.status === "claimed" && input.event.eventType !== "claimed") || (input.claim.status === "stale" && !["stale", "revoked"].includes(input.event.eventType))) throw ingestionError("CLAIM_CONFLICT", "The claim event does not describe the next claim state.", "reload_claim");
    const expectedOwner = input.expectedOwnerAddress === null ? null : normalizeEvmAddress(input.expectedOwnerAddress);
    if (expectedOwner !== current.owner_address) throw ingestionError("CLAIM_OWNER_MISMATCH", "The claim owner expectation does not match the canonical identity owner.", "reload_identity");
    const actualRead = identityRecordReadReference(mapIdentity(current));
    if (actualRead === null || actualRead.observedBlock !== input.expectedCanonicalRead.observedBlock || actualRead.observedBlockHash !== input.expectedCanonicalRead.observedBlockHash.toLowerCase() || actualRead.readConsistency !== input.expectedCanonicalRead.readConsistency) throw ingestionError("CLAIM_CONFLICT", "The canonical identity read changed before the claim mutation completed.", "reload_identity");
    if (input.actor.type === "owner") {
      if (current.owner_address === null || normalizeEvmAddress(input.actor.walletAddress) !== current.owner_address || input.claim.claimantAddress !== current.owner_address || input.claim.ownerAddressAtVerification !== current.owner_address || input.event.proofDigest !== input.actor.proofDigest || input.event.actorId !== current.owner_address) throw ingestionError("CLAIM_OWNER_MISMATCH", "The owner claim actor does not match the canonical identity owner.", "reload_identity");
    } else if (input.event.actorId !== input.actor.operatorId || input.actor.operatorId.trim().length === 0) throw ingestionError("CLAIM_CONFLICT", "The operator claim actor is invalid.", "authenticate_operator");
    else if ((input.event.eventType === "revoked" && input.actor.scope !== "identity.claim.revoke") || (input.event.eventType !== "revoked" && input.actor.scope !== "identity.claim.reconcile")) throw ingestionError("CLAIM_CONFLICT", "The operator scope does not authorize this claim event.", "authenticate_operator");
    const result = await this.query(
      `UPDATE agents SET claim_status=$1, claim_version=$2, claimant_address=$3,
        claim_owner_address_at_verification=$4, claim_agent_wallet_at_verification=$5,
        claim_verified_at=$6, claim_stale_at=$7, claim_last_reason=$8,
        claim_verification_observed_block=$9, claim_verification_observed_block_hash=$10,
        claim_verification_read_consistency=$11, owner_claim_verified_at=$12, "updatedAt"=$13
       WHERE id=$14 AND claim_version=$15 AND claim_status=$16`,
      [input.claim.status, input.claim.version, input.claim.claimantAddress, input.claim.ownerAddressAtVerification,
        input.claim.agentWalletAtVerification, input.claim.verifiedAt, input.claim.staleAt, input.claim.lastReason,
        input.claim.verificationObservedBlock, input.claim.verificationObservedBlockHash,
        input.claim.verificationReadConsistency, input.claim.verifiedAt, this.now(), current.agent_projection_id,
        existing?.version ?? 0, existing?.status ?? "unclaimed"]
    );
    if (result.rowCount !== 1) throw ingestionError("CLAIM_CONFLICT", "The claim changed before this operation completed.", "reload_claim");
    await this.query(
      `INSERT INTO agent_claim_events (id, identity_id, event_type, claimant_address, observed_owner_address,
        observed_agent_wallet, proof_digest, actor_type, actor_id, reason, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [randomUUID(), current.id, input.event.eventType, input.event.claimantAddress, input.event.observedOwnerAddress,
        input.event.observedAgentWallet, input.event.proofDigest, input.event.actorType, input.event.actorId,
        input.event.reason, input.event.occurredAt]
    );
    return input.claim;
  }

  async listClaimEvents(identityKey: IdentityKey): Promise<readonly ClaimEvent[]> {
    const identity = await this.identityId(identityKey);
    const result = await this.query<{
      event_type: ClaimEvent["eventType"]; claimant_address: string | null; observed_owner_address: string | null; observed_agent_wallet: string | null; proof_digest: string | null; actor_type: ClaimEvent["actorType"]; actor_id: string; reason: string; occurred_at: Date;
    }>(`SELECT event_type, claimant_address, observed_owner_address, observed_agent_wallet, proof_digest, actor_type, actor_id, reason, occurred_at FROM agent_claim_events WHERE identity_id=$1 ORDER BY occurred_at, id`, [identity.id]);
    return result.rows.map((row) => ({ identityKey, eventType: row.event_type, claimantAddress: row.claimant_address, observedOwnerAddress: row.observed_owner_address, observedAgentWallet: row.observed_agent_wallet, proofDigest: row.proof_digest, actorType: row.actor_type, actorId: row.actor_id, reason: row.reason, occurredAt: row.occurred_at }));
  }

  async upsertService(input: ServiceObservation): Promise<ServiceObservation> {
    const identity = await this.identityId(input.identityKey);
    const result = await this.query<{ kind: ServiceObservation["kind"]; url: string; protocol_version: string; discovery_source: ServiceObservation["discoverySource"]; validation_status: ServiceObservation["validationStatus"]; observed_at: Date; latency_ms: number | null; safe_capability_probe: Record<string, unknown> | null; capability_manifest_digest: string | null }>(
      `INSERT INTO agent_service_observations (id, identity_id, kind, url, protocol_version, discovery_source, validation_status, observed_at, latency_ms, safe_capability_probe, capability_manifest_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (identity_id, kind, url) DO UPDATE SET protocol_version=EXCLUDED.protocol_version,
         discovery_source=EXCLUDED.discovery_source, validation_status=EXCLUDED.validation_status,
         observed_at=EXCLUDED.observed_at, latency_ms=EXCLUDED.latency_ms,
         safe_capability_probe=EXCLUDED.safe_capability_probe, capability_manifest_digest=EXCLUDED.capability_manifest_digest,
         "updatedAt"=now()
       RETURNING kind, url, protocol_version, discovery_source, validation_status, observed_at, latency_ms, safe_capability_probe, capability_manifest_digest`,
      [randomUUID(), identity.id, input.kind, input.url, input.protocolVersion, input.discoverySource, input.validationStatus, new Date(input.observedAt), input.latencyMs, input.safeCapabilityProbe, input.capabilityManifestDigest]
    );
    const row = result.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "Service upsert returned no row.", "repair_repository_mapping");
    return { identityKey: input.identityKey, kind: row.kind, url: row.url, protocolVersion: row.protocol_version, discoverySource: row.discovery_source, validationStatus: row.validation_status, observedAt: row.observed_at.toISOString(), latencyMs: row.latency_ms, safeCapabilityProbe: row.safe_capability_probe, capabilityManifestDigest: row.capability_manifest_digest };
  }

  async listServices(identityKey: IdentityKey): Promise<readonly ServiceObservation[]> {
    const identity = await this.identityId(identityKey);
    const result = await this.query<{ kind: ServiceObservation["kind"]; url: string; protocol_version: string; discovery_source: ServiceObservation["discoverySource"]; validation_status: ServiceObservation["validationStatus"]; observed_at: Date; latency_ms: number | null; safe_capability_probe: Record<string, unknown> | null; capability_manifest_digest: string | null }>(`SELECT kind, url, protocol_version, discovery_source, validation_status, observed_at, latency_ms, safe_capability_probe, capability_manifest_digest FROM agent_service_observations WHERE identity_id=$1 ORDER BY kind, url`, [identity.id]);
    return result.rows.map((row) => ({ identityKey, kind: row.kind, url: row.url, protocolVersion: row.protocol_version, discoverySource: row.discovery_source, validationStatus: row.validation_status, observedAt: row.observed_at.toISOString(), latencyMs: row.latency_ms, safeCapabilityProbe: row.safe_capability_probe, capabilityManifestDigest: row.capability_manifest_digest }));
  }

  async upsertCapabilities(input: CapabilityObservation): Promise<CapabilityObservation> {
    const identity = await this.identityId(input.identityKey);
    const result = await this.query<{ source: CapabilityObservation["source"]; schema_version: string; capability_manifest: unknown; manifest_digest: string; observed_at: Date }>(
      `INSERT INTO agent_capability_observations (id, identity_id, source, schema_version, capability_manifest, manifest_digest, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (identity_id, schema_version, manifest_digest) DO UPDATE SET observed_at=GREATEST(agent_capability_observations.observed_at, EXCLUDED.observed_at)
       RETURNING source, schema_version, capability_manifest, manifest_digest, observed_at`,
      [randomUUID(), identity.id, input.source, input.schemaVersion, input.capabilityManifest, input.manifestDigest, input.observedAt]
    );
    const row = result.rows[0];
    if (row === undefined) throw ingestionError("REPOSITORY_FAILURE", "Capability upsert returned no row.", "repair_repository_mapping");
    return { identityKey: input.identityKey, source: row.source, schemaVersion: row.schema_version, capabilityManifest: row.capability_manifest, manifestDigest: row.manifest_digest, observedAt: row.observed_at };
  }

  async listCapabilities(identityKey: IdentityKey): Promise<readonly CapabilityObservation[]> {
    const identity = await this.identityId(identityKey);
    const result = await this.query<{ source: CapabilityObservation["source"]; schema_version: string; capability_manifest: unknown; manifest_digest: string; observed_at: Date }>(`SELECT source, schema_version, capability_manifest, manifest_digest, observed_at FROM agent_capability_observations WHERE identity_id=$1 ORDER BY observed_at`, [identity.id]);
    return result.rows.map((row) => ({ identityKey, source: row.source, schemaVersion: row.schema_version, capabilityManifest: row.capability_manifest, manifestDigest: row.manifest_digest, observedAt: row.observed_at }));
  }

  async appendProbeResult(input: ServiceProbeRecord): Promise<void> {
    const identity = await this.identityId(input.identityKey);
    await this.query(
      `INSERT INTO agent_service_probe_results (id, identity_id, kind, url, validation_status, status_code, latency_ms, safe_capability_probe, error_code, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), identity.id, input.kind, input.url, input.validationStatus, input.statusCode, input.latencyMs, input.safeCapabilityProbe, input.errorCode, input.observedAt]
    );
  }

  async listProbeResults(identityKey: IdentityKey): Promise<readonly ServiceProbeRecord[]> {
    const identity = await this.identityId(identityKey);
    const result = await this.query<{ kind: ServiceProbeRecord["kind"]; url: string; validation_status: ServiceProbeRecord["validationStatus"]; status_code: number | null; latency_ms: number | null; safe_capability_probe: Record<string, unknown> | null; error_code: string | null; observed_at: Date }>(`SELECT kind, url, validation_status, status_code, latency_ms, safe_capability_probe, error_code, observed_at FROM agent_service_probe_results WHERE identity_id=$1 ORDER BY observed_at`, [identity.id]);
    return result.rows.map((row) => ({ identityKey, kind: row.kind, url: row.url, validationStatus: row.validation_status, statusCode: row.status_code, latencyMs: row.latency_ms, safeCapabilityProbe: row.safe_capability_probe, errorCode: row.error_code, observedAt: row.observed_at }));
  }

  async appendReconciliation(input: ReconciliationRecord): Promise<void> {
    await this.query(
      `INSERT INTO agent_reorg_reconciliations (id, chain_id, identity_registry, previous_scanned_block, common_ancestor_block, affected_identity_keys, status, started_at, finished_at, error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), input.chainId, normalizeEvmAddress(input.identityRegistry), input.previousScannedBlock, input.commonAncestorBlock, JSON.stringify(input.affectedIdentityKeys), input.status, input.startedAt, input.finishedAt, input.errorCode]
    );
  }

  async listReconciliations(chainId: number, identityRegistry: string): Promise<readonly ReconciliationRecord[]> {
    const result = await this.query<{ chain_id: number; identity_registry: string; previous_scanned_block: number | string; common_ancestor_block: number | string; affected_identity_keys: readonly string[]; status: ReconciliationRecord["status"]; started_at: Date; finished_at: Date | null; error_code: string | null }>(`SELECT chain_id, identity_registry, previous_scanned_block, common_ancestor_block, affected_identity_keys, status, started_at, finished_at, error_code FROM agent_reorg_reconciliations WHERE chain_id=$1 AND identity_registry=$2 ORDER BY started_at`, [chainId, normalizeEvmAddress(identityRegistry)]);
    return result.rows.map((row) => ({ chainId: row.chain_id, identityRegistry: row.identity_registry, previousScannedBlock: safeInteger(row.previous_scanned_block, "reconciliation previous scanned block"), commonAncestorBlock: safeInteger(row.common_ancestor_block, "reconciliation common ancestor block"), affectedIdentityKeys: row.affected_identity_keys, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, errorCode: row.error_code }));
  }

  private async identityJoinByKey(identityKey: IdentityKey): Promise<IdentityJoinRow | null> {
    const parsed = identityKey.split(":");
    if (parsed.length !== 4) throw ingestionError("INGESTION_INPUT_INVALID", "The identity key is invalid.", "fix_identity");
    const result = await this.query<IdentityJoinRow>(`${identitySelect()} WHERE i.namespace=$1 AND i.chain_id=$2 AND i.identity_registry=$3 AND i.agent_id=$4`, [parsed[0], Number(parsed[1]), normalizeEvmAddress(parsed[2] ?? ""), parsed[3]]);
    return result.rows[0] ?? null;
  }

  private async identityId(identityKey: IdentityKey): Promise<{ id: string }> {
    const row = await this.identityJoinByKey(keyFor(identityKey));
    if (row === null) throw ingestionError("REPOSITORY_FAILURE", "The identity is not in the ingestion index.", "import_identity");
    return { id: row.id };
  }
}
