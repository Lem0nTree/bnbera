import {
  agentCategories,
  authorityStatuses,
  chainObservationStates,
  claimStatuses,
  commerceJobStatuses,
  deploymentStates,
  discoverySources,
  draftStatuses,
  evidenceStates,
  evidenceReadbackStatuses,
  evidenceVerificationStatuses,
  eventActorTypes,
  listingStatuses,
  originTypes,
  publicationAttemptStates,
  publicationProviders,
  runtimeStatuses,
  serviceKinds,
  serviceValidationStatuses,
  templateReleaseStatuses,
  verificationStatuses,
  walletProviders
} from "@bnbera/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

function enumValues<T extends string>(values: readonly [T, ...T[]]): [T, ...T[]] {
  return [...values] as [T, ...T[]];
}

const now = () => timestamp({ withTimezone: true }).defaultNow().notNull();

export const originTypeEnum = pgEnum("origin_type", enumValues(originTypes));
export const claimStatusEnum = pgEnum("claim_status", enumValues(claimStatuses));
export const verificationStatusEnum = pgEnum("verification_status", enumValues(verificationStatuses));
export const runtimeStatusEnum = pgEnum("runtime_status", enumValues(runtimeStatuses));
export const authorityStatusEnum = pgEnum("authority_status", enumValues(authorityStatuses));
export const listingStatusEnum = pgEnum("listing_status", enumValues(listingStatuses));
export const discoverySourceEnum = pgEnum("discovery_source", enumValues(discoverySources));
export const chainObservationStateEnum = pgEnum(
  "chain_observation_state",
  enumValues(chainObservationStates)
);
export const serviceKindEnum = pgEnum("service_kind", enumValues(serviceKinds));
export const serviceValidationStatusEnum = pgEnum(
  "service_validation_status",
  enumValues(serviceValidationStatuses)
);
export const walletProviderEnum = pgEnum("wallet_provider", enumValues(walletProviders));
export const templateReleaseStatusEnum = pgEnum(
  "template_release_status",
  enumValues(templateReleaseStatuses)
);
export const draftStatusEnum = pgEnum("draft_status", enumValues(draftStatuses));
export const deploymentStateEnum = pgEnum("deployment_state", enumValues(deploymentStates));
export const commerceJobStatusEnum = pgEnum("commerce_job_status", enumValues(commerceJobStatuses));
export const erc8183JobStateEnum = pgEnum("erc8183_job_state", [
  "open",
  "funded",
  "submitted",
  "completed",
  "rejected",
  "expired"
]);
export const erc8183JobEventTypeEnum = pgEnum("erc8183_job_event_type", [
  "job_created",
  "provider_set",
  "budget_set",
  "job_funded",
  "job_submitted",
  "job_completed",
  "job_rejected",
  "job_expired",
  "reconciliation_requested",
  "reconciliation_succeeded",
  "reconciliation_failed"
]);
export const paymentRailEnum = pgEnum("payment_rail", ["x402_b402"]);
export const paymentMethodEnum = pgEnum("payment_method", ["eip3009", "permit2_exact"]);
export const paymentChallengeStatusEnum = pgEnum("payment_challenge_status", [
  "issued",
  "authorized",
  "expired",
  "rejected"
]);
export const paymentAttemptStatusEnum = pgEnum("payment_attempt_status", [
  "challenged",
  "authorized",
  "relay_pending",
  "relayed",
  "settlement_pending",
  "settled",
  "delivered",
  "rejected",
  "expired",
  "unknown",
  "partial_failure",
  "manual_review"
]);
export const paymentReceiptStatusEnum = pgEnum("payment_receipt_status", [
  "settled",
  "rejected",
  "unknown",
  "partial_failure"
]);
export const paymentEventTypeEnum = pgEnum("payment_event_type", [
  "challenge_issued",
  "payment_authorized",
  "relay_started",
  "relay_completed",
  "settlement_observed",
  "response_delivered",
  "payment_rejected",
  "payment_expired",
  "payment_unknown",
  "payment_partial_failure",
  "reconciliation_requested",
  "reconciliation_succeeded",
  "reconciliation_failed"
]);
export const paymentReplayStateEnum = pgEnum("payment_replay_state", ["inflight", "consumed", "rejected"]);
export const paymentReconciliationStateEnum = pgEnum("payment_reconciliation_state", [
  "pending",
  "in_progress",
  "reconciled",
  "failed",
  "manual_review"
]);
export const evidenceStateEnum = pgEnum("evidence_state", enumValues(evidenceStates));
export const publicationProviderEnum = pgEnum("publication_provider", enumValues(publicationProviders));
export const publicationAttemptStateEnum = pgEnum(
  "publication_attempt_state",
  enumValues(publicationAttemptStates)
);
export const evidenceVerificationStatusEnum = pgEnum(
  "evidence_verification_status",
  enumValues(evidenceVerificationStatuses)
);
export const evidenceReadbackStatusEnum = pgEnum(
  "evidence_readback_status",
  enumValues(evidenceReadbackStatuses)
);
export const eventActorTypeEnum = pgEnum("event_actor_type", enumValues(eventActorTypes));
export const agentCategoryEnum = pgEnum("agent_category", enumValues(agentCategories));

export const authUsers = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }),
    displayName: varchar("display_name", { length: 160 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("auth_sessions_token_digest_unique").on(table.tokenDigest),
    index("auth_sessions_user_idx").on(table.userId)
  ]
);

export const authNonces = pgTable(
  "auth_nonces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domain: varchar("domain", { length: 253 }).notNull(),
    chainId: integer("chain_id").notNull(),
    nonceDigest: varchar("nonce_digest", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("auth_nonces_nonce_digest_unique").on(table.nonceDigest),
    index("auth_nonces_context_idx").on(table.domain, table.chainId, table.expiresAt)
  ]
);

export const walletAddresses = pgTable(
  "wallet_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    address: varchar("address", { length: 42 }).notNull(),
    chainId: integer("chain_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    lastOwnershipVerifiedAt: timestamp("last_ownership_verified_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("wallet_addresses_chain_address_unique").on(table.chainId, table.address),
    index("wallet_addresses_user_idx").on(table.userId)
  ]
);

export const erc8004Identities = pgTable(
  "erc8004_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    namespace: varchar("namespace", { length: 128 }).notNull(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    agentId: text("agent_id").notNull(),
    ownerAddress: varchar("owner_address", { length: 42 }),
    ownerObservedBlock: bigint("owner_observed_block", { mode: "number" }),
    agentWallet: varchar("agent_wallet", { length: 42 }),
    agentWalletObservedBlock: bigint("agent_wallet_observed_block", { mode: "number" }),
    agentUri: text("agent_uri"),
    agentUriObservedBlock: bigint("agent_uri_observed_block", { mode: "number" }),
    contentDigest: varchar("content_digest", { length: 64 }),
    contentDigestObservedBlock: bigint("content_digest_observed_block", { mode: "number" }),
    observedBlock: bigint("observed_block", { mode: "number" }),
    observedBlockHash: varchar("observed_block_hash", { length: 66 }),
    readConsistency: varchar("read_consistency", { length: 16 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("erc8004_identity_key_unique").on(
      table.namespace,
      table.chainId,
      table.identityRegistry,
      table.agentId
    ),
    index("erc8004_identity_owner_idx").on(table.chainId, table.ownerAddress)
  ]
);

export const agentDiscoverySources = pgTable(
  "agent_discovery_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    source: discoverySourceEnum("source").notNull(),
    sourceReference: text("source_reference").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    rawResponseDigest: varchar("raw_response_digest", { length: 64 }),
    normalizedIngestionVersion: varchar("normalized_ingestion_version", { length: 64 }).notNull(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("agent_discovery_source_unique").on(table.identityId, table.source, table.sourceReference),
    index("agent_discovery_source_source_idx").on(table.source, table.lastObservedAt)
  ]
);

/** Raw identity-scoped service observations collected before a marketplace
 * version exists. A4 may promote verified observations to agent_services. */
export const agentServiceObservations = pgTable(
  "agent_service_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    kind: serviceKindEnum("kind").notNull(),
    url: text("url").notNull(),
    protocolVersion: varchar("protocol_version", { length: 128 }).notNull(),
    discoverySource: discoverySourceEnum("discovery_source").notNull(),
    validationStatus: serviceValidationStatusEnum("validation_status").notNull().default("pending"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    latencyMs: integer("latency_ms"),
    safeCapabilityProbe: jsonb("safe_capability_probe").$type<Record<string, unknown>>(),
    capabilityManifestDigest: varchar("capability_manifest_digest", { length: 64 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("agent_service_observation_unique").on(table.identityId, table.kind, table.url),
    index("agent_service_observation_validation_idx").on(table.validationStatus, table.observedAt)
  ]
);

export const agentServiceProbeResults = pgTable(
  "agent_service_probe_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    kind: serviceKindEnum("kind").notNull(),
    url: text("url").notNull(),
    validationStatus: serviceValidationStatusEnum("validation_status").notNull(),
    statusCode: integer("status_code"),
    latencyMs: integer("latency_ms"),
    safeCapabilityProbe: jsonb("safe_capability_probe").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 64 }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    index("agent_service_probe_identity_time_idx").on(table.identityId, table.kind, table.url, table.observedAt),
    index("agent_service_probe_status_idx").on(table.validationStatus, table.observedAt)
  ]
);

export const agentCapabilityObservations = pgTable(
  "agent_capability_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    source: discoverySourceEnum("source").notNull(),
    schemaVersion: varchar("schema_version", { length: 64 }).notNull(),
    capabilityManifest: jsonb("capability_manifest").$type<Record<string, unknown>>().notNull(),
    manifestDigest: varchar("manifest_digest", { length: 64 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("agent_capability_observation_unique").on(table.identityId, table.schemaVersion, table.manifestDigest),
    index("agent_capability_observation_source_idx").on(table.source, table.observedAt)
  ]
);

export const erc8004ChainObservations = pgTable(
  "erc8004_chain_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    confirmationState: chainObservationStateEnum("confirmation_state").notNull(),
    normalizedOwner: varchar("normalized_owner", { length: 42 }),
    normalizedAgentUri: text("normalized_agent_uri"),
    normalizedAgentWallet: varchar("normalized_agent_wallet", { length: 42 }),
    normalizedContentDigest: varchar("normalized_content_digest", { length: 64 }),
    observedFields: jsonb("observed_fields").$type<readonly string[]>().notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    canonicalizedAt: timestamp("canonicalized_at", { withTimezone: true }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    payloadDigest: varchar("payload_digest", { length: 64 }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("erc8004_observation_log_unique").on(table.transactionHash, table.logIndex),
    index("erc8004_observation_block_idx").on(table.identityId, table.blockNumber),
    index("erc8004_observation_state_idx").on(table.confirmationState, table.blockNumber)
  ]
);

/**
 * Append-only ERC-8004 Reputation Registry events. Identity observations use
 * a different event shape and checkpoint stream, so reputation events keep
 * their complete registry identity/provenance here. A read projection derives
 * active feedback by applying canonical NewFeedback and FeedbackRevoked rows;
 * revoked history is never deleted.
 */
export const erc8004ReputationEvents = pgTable(
  "erc8004_reputation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    namespace: varchar("namespace", { length: 128 }).notNull(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    reputationRegistry: varchar("reputation_registry", { length: 42 }).notNull(),
    agentId: text("agent_id").notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    clientAddress: varchar("client_address", { length: 42 }).notNull(),
    feedbackIndex: text("feedback_index").notNull(),
    value: text("value"),
    valueDecimals: integer("value_decimals"),
    indexedTag1: text("indexed_tag1"),
    tag1: text("tag1"),
    tag2: text("tag2"),
    endpoint: text("endpoint"),
    feedbackUri: text("feedback_uri"),
    feedbackHash: varchar("feedback_hash", { length: 66 }),
    transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockHash: varchar("block_hash", { length: 66 }).notNull(),
    confirmationState: chainObservationStateEnum("confirmation_state").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    canonicalizedAt: timestamp("canonicalized_at", { withTimezone: true }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("erc8004_reputation_event_log_unique").on(table.transactionHash, table.logIndex, table.blockHash),
    index("erc8004_reputation_event_identity_state_idx").on(table.identityId, table.confirmationState, table.blockNumber),
    index("erc8004_reputation_event_feedback_key_idx").on(table.identityId, table.clientAddress, table.feedbackIndex),
    check("erc8004_reputation_event_type_check", sql`${table.eventType} in ('NewFeedback', 'FeedbackRevoked')`),
    check("erc8004_reputation_event_identity_registry_check", sql`${table.identityRegistry} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.reputationRegistry} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("erc8004_reputation_event_agent_id_check", sql`${table.agentId} ~ '^(0|[1-9][0-9]*)$'`),
    check("erc8004_reputation_event_feedback_index_check", sql`${table.feedbackIndex} ~ '^(0|[1-9][0-9]*)$'`),
    check("erc8004_reputation_event_value_check", sql`${table.value} IS NULL OR ${table.value} ~ '^-?(0|[1-9][0-9]*)$'`),
    check("erc8004_reputation_event_value_decimals_check", sql`${table.valueDecimals} IS NULL OR ${table.valueDecimals} between 0 and 255`),
    check("erc8004_reputation_event_payload_digest_check", sql`${table.payloadDigest} ~ '^[0-9A-Fa-f]{64}$'`)
  ]
);

/** Independent finalized/reorg-safe cursor for Reputation Registry events. */
export const erc8004ReputationCheckpoints = pgTable(
  "erc8004_reputation_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    reputationRegistry: varchar("reputation_registry", { length: 42 }).notNull(),
    indexerVersion: varchar("indexer_version", { length: 64 }).notNull().default("reputation-indexer-v1"),
    lastScannedBlock: bigint("last_scanned_block", { mode: "number" }).notNull(),
    lastScannedBlockHash: varchar("last_scanned_block_hash", { length: 66 }).notNull(),
    lastFinalizedBlock: bigint("last_finalized_block", { mode: "number" }).notNull(),
    lastFinalizedBlockHash: varchar("last_finalized_block_hash", { length: 66 }).notNull(),
    confirmationThreshold: integer("confirmation_threshold").notNull(),
    cursorVersion: integer("cursor_version").notNull().default(1),
    lastReconciliationAt: timestamp("last_reconciliation_at", { withTimezone: true }),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("erc8004_reputation_checkpoint_unique").on(table.chainId, table.identityRegistry, table.reputationRegistry),
    index("erc8004_reputation_checkpoint_updated_idx").on(table.updatedAt),
    check("erc8004_reputation_checkpoint_registry_check", sql`${table.identityRegistry} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.reputationRegistry} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("erc8004_reputation_checkpoint_block_check", sql`${table.lastFinalizedBlock} <= ${table.lastScannedBlock} AND ${table.confirmationThreshold} >= 0 AND ${table.cursorVersion} > 0`)
  ]
);

export const chainIngestionCheckpoints = pgTable(
  "chain_ingestion_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    indexerVersion: varchar("indexer_version", { length: 64 }).notNull().default("registry-indexer-v1"),
    lastScannedBlock: bigint("last_scanned_block", { mode: "number" }).notNull(),
    lastScannedBlockHash: varchar("last_scanned_block_hash", { length: 66 }).notNull(),
    lastFinalizedBlock: bigint("last_finalized_block", { mode: "number" }).notNull(),
    lastFinalizedBlockHash: varchar("last_finalized_block_hash", { length: 66 }).notNull(),
    confirmationThreshold: integer("confirmation_threshold").notNull(),
    cursorVersion: integer("cursor_version").notNull().default(1),
    lastReconciliationAt: timestamp("last_reconciliation_at", { withTimezone: true }),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("chain_ingestion_checkpoint_unique").on(table.chainId, table.identityRegistry)
  ]
);

/**
 * Provider pagination is deliberately separate from chain block checkpoints.
 * An 8004scan offset/cursor carries no finality semantics and must not be
 * consumed by the registry indexer as a block position.
 */
export const scanDiscoveryCheckpoints = pgTable(
  "scan_discovery_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 160 }).notNull(),
    queryDigest: varchar("query_digest", { length: 64 }).notNull(),
    initialOffset: bigint("initial_offset", { mode: "number" }),
    initialCursor: varchar("initial_cursor", { length: 256 }),
    nextOffset: bigint("next_offset", { mode: "number" }),
    nextCursor: varchar("next_cursor", { length: 256 }),
    pageSize: integer("page_size").notNull(),
    total: bigint("total", { mode: "number" }),
    pagesProcessed: integer("pages_processed").notNull().default(0),
    candidatesProcessed: integer("candidates_processed").notNull().default(0),
    lastPageDigest: varchar("last_page_digest", { length: 64 }),
    cursorVersion: integer("cursor_version").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("scan_discovery_checkpoint_scope_unique").on(table.scope),
    index("scan_discovery_checkpoint_updated_idx").on(table.updatedAt),
    check("scan_discovery_checkpoint_query_digest_check", sql`${table.queryDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    check("scan_discovery_checkpoint_cursor_check", sql`(${table.nextOffset} IS NULL OR ${table.nextCursor} IS NULL)`),
    check("scan_discovery_checkpoint_counters_check", sql`${table.pageSize} > 0 AND ${table.pagesProcessed} >= 0 AND ${table.candidatesProcessed} >= 0 AND ${table.cursorVersion} > 0`)
  ]
);

/**
 * Marketplace discovery owns a small cursor in addition to the provider's
 * page checkpoints. The provider checkpoint is immutable once it reaches the
 * end of a page stream; this cursor lets the five-minute sweep start the next
 * bounded page (and wrap only after a complete sweep) without re-reading the
 * same first page forever.
 */
export const marketplaceDiscoveryCursors = pgTable(
  "marketplace_discovery_cursors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 160 }).notNull(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    pageSize: integer("page_size").notNull(),
    nextOffset: bigint("next_offset", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }),
    sweep: integer("sweep").notNull().default(0),
    lastPageAt: timestamp("last_page_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("marketplace_discovery_cursor_scope_unique").on(table.scope),
    index("marketplace_discovery_cursor_due_idx").on(table.updatedAt)
  ]
);

/**
 * Per-identity composition retry state. Failure state is intentionally kept
 * separate from immutable marketplace versions and raw observations so a
 * provider outage cannot churn listing history while still being retried with
 * bounded backoff.
 */
export const marketplaceIngestionRetries = pgTable(
  "marketplace_ingestion_retries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastStage: varchar("last_stage", { length: 64 }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("marketplace_ingestion_retry_identity_unique").on(table.identityId),
    index("marketplace_ingestion_retry_due_idx").on(table.nextAttemptAt, table.updatedAt)
  ]
);

export const agentClaimEvents = pgTable(
  "agent_claim_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    claimantAddress: varchar("claimant_address", { length: 42 }),
    observedOwnerAddress: varchar("observed_owner_address", { length: 42 }),
    observedAgentWallet: varchar("observed_agent_wallet", { length: 42 }),
    proofDigest: varchar("proof_digest", { length: 64 }),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    actorId: varchar("actor_id", { length: 160 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    index("agent_claim_event_identity_time_idx").on(table.identityId, table.occurredAt),
    index("agent_claim_event_type_idx").on(table.eventType, table.occurredAt)
  ]
);

export const agentReorgReconciliations = pgTable(
  "agent_reorg_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    previousScannedBlock: bigint("previous_scanned_block", { mode: "number" }).notNull(),
    commonAncestorBlock: bigint("common_ancestor_block", { mode: "number" }).notNull(),
    affectedIdentityKeys: jsonb("affected_identity_keys").$type<readonly string[]>().notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: now()
  },
  (table) => [
    index("agent_reorg_reconciliation_network_idx").on(table.chainId, table.identityRegistry, table.startedAt),
    index("agent_reorg_reconciliation_status_idx").on(table.status, table.startedAt)
  ]
);

export const agentTemplates = pgTable(
  "agent_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull(),
    semanticVersion: varchar("semantic_version", { length: 32 }).notNull(),
    category: agentCategoryEnum("category").notNull(),
    displayMetadata: jsonb("display_metadata").$type<Record<string, unknown>>().notNull(),
    configurationSchema: jsonb("configuration_schema").$type<Record<string, unknown>>().notNull(),
    capabilityManifest: jsonb("capability_manifest").$type<Record<string, unknown>>().notNull(),
    protocolManifest: jsonb("protocol_manifest").$type<Record<string, unknown>>().notNull(),
    contractSelectorAllowlist: jsonb("contract_selector_allowlist")
      .$type<Record<string, unknown>>()
      .notNull(),
    artifactDigest: varchar("artifact_digest", { length: 64 }).notNull(),
    sourceCommit: varchar("source_commit", { length: 64 }).notNull(),
    releaseStatus: templateReleaseStatusEnum("release_status").notNull().default("draft"),
    createdAt: now(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("agent_template_slug_version_unique").on(table.slug, table.semanticVersion),
    index("agent_template_category_status_idx").on(table.category, table.releaseStatus)
  ]
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => erc8004Identities.id, { onDelete: "restrict" }),
    creatorUserId: uuid("creator_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    observedExternalOwner: varchar("observed_external_owner", { length: 42 }),
    originType: originTypeEnum("origin_type").notNull(),
    claimStatus: claimStatusEnum("claim_status").notNull().default("unclaimed"),
    // Compare-and-swap token for atomic claim and claim-event mutations.
    claimVersion: integer("claim_version").notNull().default(0),
    claimantAddress: varchar("claimant_address", { length: 42 }),
    claimOwnerAddressAtVerification: varchar("claim_owner_address_at_verification", { length: 42 }),
    claimAgentWalletAtVerification: varchar("claim_agent_wallet_at_verification", { length: 42 }),
    claimVerifiedAt: timestamp("claim_verified_at", { withTimezone: true }),
    claimStaleAt: timestamp("claim_stale_at", { withTimezone: true }),
    claimLastReason: varchar("claim_last_reason", { length: 64 }),
    claimVerificationObservedBlock: bigint("claim_verification_observed_block", { mode: "number" }),
    claimVerificationObservedBlockHash: varchar("claim_verification_observed_block_hash", { length: 66 }),
    claimVerificationReadConsistency: varchar("claim_verification_read_consistency", { length: 16 }),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("pending"),
    runtimeStatus: runtimeStatusEnum("runtime_status").notNull().default("unavailable"),
    authorityStatus: authorityStatusEnum("authority_status").notNull().default("none"),
    listingStatus: listingStatusEnum("listing_status").notNull().default("draft"),
    ownerClaimVerifiedAt: timestamp("owner_claim_verified_at", { withTimezone: true }),
    category: agentCategoryEnum("category").notNull().default("uncategorized"),
    // The physical FK is declared in the migration after both tables exist.
    // Drizzle evaluates inline references while each table is initialized, so
    // declaring this reverse edge inline would create a circular TDZ failure.
    currentVersionId: uuid("current_version_id"),
    executionWallet: varchar("execution_wallet", { length: 42 }),
    walletProvider: walletProviderEnum("wallet_provider").notNull().default("unknown"),
    currentServiceSetVersion: integer("current_service_set_version").notNull().default(1),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("agents_identity_unique").on(table.identityId),
    index("agents_listing_search_idx").on(table.listingStatus, table.verificationStatus, table.category),
    index("agents_owner_idx").on(table.creatorUserId, table.claimStatus)
  ]
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    publicMetadata: jsonb("public_metadata").$type<Record<string, unknown>>().notNull(),
    capabilityManifest: jsonb("capability_manifest").$type<Record<string, unknown>>().notNull(),
    pricingManifest: jsonb("pricing_manifest").$type<Record<string, unknown>>().notNull(),
    greenfieldProfileReference: jsonb("greenfield_profile_reference").$type<Record<string, unknown>>(),
    templateId: uuid("template_id").references(() => agentTemplates.id, { onDelete: "set null" }),
    templateDigest: varchar("template_digest", { length: 64 }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("agent_version_number_unique").on(table.agentId, table.version),
    index("agent_version_template_idx").on(table.templateId)
  ]
);

export const agentServices = pgTable(
  "agent_services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    kind: serviceKindEnum("kind").notNull(),
    url: text("url").notNull(),
    protocolVersion: varchar("protocol_version", { length: 128 }).notNull(),
    discoverySource: discoverySourceEnum("discovery_source").notNull(),
    validationStatus: serviceValidationStatusEnum("validation_status").notNull().default("pending"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    latencyMs: integer("latency_ms"),
    safeCapabilityProbe: jsonb("safe_capability_probe").$type<Record<string, unknown>>(),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("agent_service_url_unique").on(table.agentVersionId, table.kind, table.url),
    index("agent_service_validation_idx").on(table.validationStatus, table.observedAt)
  ]
);

export const agentDrafts = pgTable(
  "agent_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorUserId: uuid("creator_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => agentTemplates.id, { onDelete: "restrict" }),
    templateVersion: varchar("template_version", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    description: varchar("description", { length: 2_000 }).notNull(),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
    pricingConfiguration: jsonb("pricing_configuration").$type<Record<string, unknown>>().notNull(),
    derivedPolicy: jsonb("derived_policy").$type<Record<string, unknown>>().notNull(),
    status: draftStatusEnum("status").notNull().default("draft"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    publicationConsent: boolean("publication_consent").notNull().default(false),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("agent_draft_creator_idempotency_unique").on(table.creatorUserId, table.idempotencyKey),
    index("agent_draft_creator_status_idx").on(table.creatorUserId, table.status)
  ]
);

export const agentAuthorities = pgTable(
  "agent_authorities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => agentDrafts.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    walletProvider: walletProviderEnum("wallet_provider").notNull(),
    executionWallet: varchar("execution_wallet", { length: 42 }),
    altanaSmartWallet: varchar("altana_smart_wallet", { length: 42 }),
    adminWallet: varchar("admin_wallet", { length: 42 }),
    sessionPublicAddress: varchar("session_public_address", { length: 42 }),
    callsAllowlist: jsonb("calls_allowlist").$type<Record<string, unknown>>().notNull(),
    spendLimits: jsonb("spend_limits").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    keystoreRegistrationTx: varchar("keystore_registration_tx", { length: 66 }),
    lastVerifiedBlock: bigint("last_verified_block", { mode: "number" }),
    status: authorityStatusEnum("status").notNull().default("none"),
    secretReference: text("secret_reference"),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    check(
      "agent_authority_owner_check",
      sql`num_nonnulls("agent_id", "draft_id") = 1`
    ),
    index("agent_authority_agent_status_idx").on(table.agentId, table.status),
    index("agent_authority_expiry_idx").on(table.status, table.expiresAt)
  ]
);

export const agentDeployments = pgTable(
  "agent_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    draftId: uuid("draft_id").references(() => agentDrafts.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 64 }).notNull(),
    region: varchar("region", { length: 64 }).notNull(),
    agentCoreArn: text("agent_core_arn"),
    ingressIdentifier: text("ingress_identifier"),
    publicUrl: text("public_url"),
    templateDigest: varchar("template_digest", { length: 64 }).notNull(),
    configurationDigest: varchar("configuration_digest", { length: 64 }).notNull(),
    state: deploymentStateEnum("state").notNull().default("draft"),
    currentStep: varchar("current_step", { length: 128 }),
    attempt: integer("attempt").notNull().default(0),
    errorCode: varchar("error_code", { length: 64 }),
    sanitizedError: varchar("sanitized_error", { length: 500 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    index("agent_deployment_state_idx").on(table.state, table.createdAt),
    index("agent_deployment_agent_idx").on(table.agentId)
  ]
);

export const deploymentEvents = pgTable(
  "deployment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => agentDeployments.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    previousState: deploymentStateEnum("previous_state"),
    nextState: deploymentStateEnum("next_state").notNull(),
    statusMessage: varchar("status_message", { length: 500 }).notNull(),
    externalResourceReferences: jsonb("external_resource_references").$type<Record<string, unknown>>(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    retryable: boolean("retryable").notNull().default(false),
    createdAt: now()
  },
  (table) => [index("deployment_events_deployment_idx").on(table.deploymentId, table.createdAt)]
);

export const agentListingEmbeddings = pgTable(
  "agent_listing_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    embedding: customType<{ data: number[]; driverData: string }>({
      dataType: () => "vector(1536)",
      toDriver: (value) => `[${value.join(",")}]`,
      fromDriver: (value) => {
        const textValue = String(value);
        return textValue
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(",")
          .filter((item) => item.length > 0)
          .map(Number);
      }
    })("embedding").notNull(),
    provider: varchar("provider", { length: 128 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    modelVersion: varchar("model_version", { length: 128 }).notNull(),
    dimension: integer("dimension").notNull().default(1536),
    sourceTextDigest: varchar("source_text_digest", { length: 64 }).notNull(),
    semanticDocumentSchemaVersion: varchar("semantic_document_schema_version", { length: 64 }).notNull(),
    classifierVersion: varchar("classifier_version", { length: 64 }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("agent_listing_embedding_version_unique").on(table.agentVersionId, table.modelVersion),
    index("agent_listing_embedding_model_idx").on(table.provider, table.model, table.dimension)
  ]
);

export const agentCategoryPredictions = pgTable(
  "agent_category_predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    predictedCategory: agentCategoryEnum("predicted_category").notNull(),
    structuredScore: numeric("structured_score", { precision: 5, scale: 2 }).notNull(),
    semanticScore: numeric("semantic_score", { precision: 5, scale: 2 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    method: varchar("method", { length: 64 }).notNull(),
    classifierVersion: varchar("classifier_version", { length: 64 }).notNull(),
    reviewState: varchar("review_state", { length: 64 }).notNull(),
    reviewer: varchar("reviewer", { length: 160 }),
    createdAt: now()
  },
  (table) => [
    index("agent_category_prediction_version_idx").on(table.agentVersionId, table.createdAt),
    index("agent_category_prediction_category_idx").on(table.predictedCategory, table.reviewState)
  ]
);

export const agentHealthSnapshots = pgTable(
  "agent_health_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => agentServices.id, { onDelete: "set null" }),
    endpointStatus: varchar("endpoint_status", { length: 64 }).notNull(),
    protocolChecks: jsonb("protocol_checks").$type<Record<string, unknown>>().notNull(),
    authorityStatus: authorityStatusEnum("authority_status").notNull(),
    dataFreshness: jsonb("data_freshness").$type<Record<string, unknown>>().notNull(),
    latencyMs: integer("latency_ms"),
    observedBlock: bigint("observed_block", { mode: "number" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [index("agent_health_agent_time_idx").on(table.agentId, table.observedAt)]
);

export const agentEnrichmentObservations = pgTable(
  "agent_enrichment_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 128 }).notNull(),
    observationType: varchar("observation_type", { length: 128 }).notNull(),
    normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>().notNull(),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    sourceBlock: bigint("source_block", { mode: "number" }),
    freshness: varchar("freshness", { length: 64 }).notNull(),
    validationState: varchar("validation_state", { length: 64 }).notNull(),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    createdAt: now()
  },
  (table) => [index("agent_enrichment_version_provider_idx").on(table.agentVersionId, table.provider)]
);

export const b402SellerConfigurations = pgTable(
  "b402_seller_configurations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    merchantEnvironment: varchar("merchant_environment", { length: 64 }).notNull(),
    merchantAccountReference: varchar("merchant_account_reference", { length: 160 }).notNull(),
    merchantCredentialReference: text("merchant_credential_reference"),
    facilitatorEndpoint: text("facilitator_endpoint").notNull(),
    settlementNetwork: integer("settlement_network").notNull(),
    settlementAsset: varchar("settlement_asset", { length: 42 }).notNull(),
    settlementDecimals: integer("settlement_decimals").notNull(),
    payoutAddress: varchar("payout_address", { length: 42 }).notNull(),
    payoutVerificationState: varchar("payout_verification_state", { length: 64 }).notNull(),
    fixedEgressProfile: varchar("fixed_egress_profile", { length: 160 }).notNull(),
    publicX402Url: text("public_x402_url").notNull(),
    agentCoreRelayAuthenticationReference: text("agent_core_relay_authentication_reference"),
    priceUsd: numeric("price_usd", { precision: 20, scale: 8 }).notNull(),
    configurationVersion: integer("configuration_version").notNull().default(1),
    configurationDigest: varchar("configuration_digest", { length: 64 }).notNull(),
    lastPaidCanaryResult: jsonb("last_paid_canary_result").$type<Record<string, unknown>>(),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("b402_seller_agent_unique").on(table.agentId),
    check("b402_seller_network_check", sql`${table.settlementNetwork} in (56, 97)`),
    check("b402_seller_decimals_check", sql`${table.settlementDecimals} between 0 and 255`),
    check("b402_seller_configuration_version_check", sql`${table.configurationVersion} > 0`),
    check("b402_seller_configuration_digest_check", sql`${table.configurationDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    index("b402_seller_enabled_idx").on(table.enabled, table.settlementNetwork)
  ]
);

export const commerceJobs = pgTable(
  "commerce_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    erc8183JobId: text("erc8183_job_id").notNull(),
    buyerUserId: uuid("buyer_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    providerAgentId: uuid("provider_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    quote: jsonb("quote").$type<Record<string, unknown>>().notNull(),
    price: numeric("price", { precision: 78, scale: 0 }).notNull(),
    taskInputDigest: varchar("task_input_digest", { length: 64 }).notNull(),
    status: commerceJobStatusEnum("status").notNull().default("draft"),
    fundingTransactionHash: varchar("funding_transaction_hash", { length: 66 }),
    fulfillmentTransactionHash: varchar("fulfillment_transaction_hash", { length: 66 }),
    disputeTransactionHash: varchar("dispute_transaction_hash", { length: 66 }),
    settlementTransactionHash: varchar("settlement_transaction_hash", { length: 66 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    // Protocol identity is canonicalized in erc8183_jobs as
    // (chain_id, commerce_contract, erc8183_job_id). Do not enforce a global
    // protocol job-id uniqueness constraint on the legacy commerce projection.
    index("commerce_provider_status_idx").on(table.providerAgentId, table.status)
  ]
);

/**
 * Canonical ERC-8183 terms and on-chain state. `commerce_jobs` keeps the
 * application-facing quote/job record; this table keeps protocol terms
 * separate from the internal commerce status vocabulary.
 */
export const erc8183Jobs = pgTable(
  "erc8183_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commerceJobId: uuid("commerce_job_id")
      .notNull()
      .references(() => commerceJobs.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    erc8183JobId: text("erc8183_job_id").notNull(),
    // Immutable standards-lock snapshot required to reconstruct validation.
    specRevision: varchar("spec_revision", { length: 160 }).notNull(),
    abiHash: varchar("abi_hash", { length: 64 }).notNull(),
    evaluatorProfile: varchar("evaluator_profile", { length: 160 }).notNull(),
    confirmationThreshold: integer("confirmation_threshold").notNull(),
    minExpiryLeadSeconds: integer("min_expiry_lead_seconds").notNull(),
    maxExpiryHorizonSeconds: integer("max_expiry_horizon_seconds").notNull(),
    minBudgetAtomic: numeric("min_budget_atomic", { precision: 78, scale: 0 }).notNull(),
    maxBudgetAtomic: numeric("max_budget_atomic", { precision: 78, scale: 0 }).notNull(),
    deploymentPinDigest: varchar("deployment_pin_digest", { length: 64 }).notNull(),
    paymentToken: varchar("payment_token", { length: 42 }).notNull(),
    paymentDecimals: integer("payment_decimals").notNull(),
    clientAddress: varchar("client_address", { length: 42 }).notNull(),
    providerAddress: varchar("provider_address", { length: 42 }),
    evaluatorAddress: varchar("evaluator_address", { length: 42 }).notNull(),
    hookAddress: varchar("hook_address", { length: 42 }),
    budgetAtomic: numeric("budget_atomic", { precision: 78, scale: 0 }).notNull(),
    descriptionDigest: varchar("description_digest", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: erc8183JobStateEnum("state").notNull().default("open"),
    deliverableDigest: varchar("deliverable_digest", { length: 64 }),
    // Full ERC-8004 identity/version binding for the marketplace provider.
    // The canonical identity row remains owned by the agents relationship;
    // this immutable JSON snapshot keeps a historical job self-describing.
    providerBinding: jsonb("provider_binding").$type<Record<string, unknown>>(),
    buyerApprovalAddress: varchar("buyer_approval_address", { length: 42 }),
    buyerApprovalResultDigest: varchar("buyer_approval_result_digest", { length: 64 }),
    buyerApprovedAt: timestamp("buyer_approved_at", { withTimezone: true }),
    fundingTransactionHash: varchar("funding_transaction_hash", { length: 66 }),
    submissionTransactionHash: varchar("submission_transaction_hash", { length: 66 }),
    completionTransactionHash: varchar("completion_transaction_hash", { length: 66 }),
    rejectionTransactionHash: varchar("rejection_transaction_hash", { length: 66 }),
    refundTransactionHash: varchar("refund_transaction_hash", { length: 66 }),
    lastObservedBlock: bigint("last_observed_block", { mode: "number" }),
    lastObservedBlockHash: varchar("last_observed_block_hash", { length: 66 }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("erc8183_job_commerce_job_unique").on(table.commerceJobId),
    uniqueIndex("erc8183_job_network_identity_unique").on(table.chainId, table.commerceContract, table.erc8183JobId),
    check("erc8183_job_chain_check", sql`${table.chainId} in (56, 97)`),
    check("erc8183_job_decimals_check", sql`${table.paymentDecimals} between 0 and 255`),
    check("erc8183_job_budget_check", sql`${table.budgetAtomic} >= 0`),
    check("erc8183_job_contract_check", sql`${table.commerceContract} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.paymentToken} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("erc8183_job_spec_check", sql`char_length(${table.specRevision}) > 0 AND char_length(${table.evaluatorProfile}) > 0`),
    check("erc8183_job_abi_hash_check", sql`${table.abiHash} ~ '^[0-9A-Fa-f]{64}$'`),
    check("erc8183_job_pin_digest_check", sql`${table.deploymentPinDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    check("erc8183_job_confirmation_check", sql`${table.confirmationThreshold} > 0`),
    check("erc8183_job_expiry_bounds_check", sql`${table.minExpiryLeadSeconds} > 0 AND ${table.maxExpiryHorizonSeconds} >= ${table.minExpiryLeadSeconds}`),
    check("erc8183_job_pin_budget_bounds_check", sql`${table.minBudgetAtomic} >= 0 AND ${table.maxBudgetAtomic} >= ${table.minBudgetAtomic} AND ${table.budgetAtomic} between ${table.minBudgetAtomic} and ${table.maxBudgetAtomic}`),
    check("erc8183_job_id_decimal_check", sql`${table.erc8183JobId} ~ '^(0|[1-9][0-9]*)$'`),
    check("erc8183_job_buyer_approval_check", sql`num_nonnulls(${table.buyerApprovalAddress}, ${table.buyerApprovalResultDigest}, ${table.buyerApprovedAt}) in (0, 3)`),
    check("erc8183_job_buyer_approval_address_check", sql`${table.buyerApprovalAddress} IS NULL OR ${table.buyerApprovalAddress} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("erc8183_job_buyer_approval_digest_check", sql`${table.buyerApprovalResultDigest} IS NULL OR ${table.buyerApprovalResultDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    index("erc8183_job_state_idx").on(table.state, table.expiresAt),
    index("erc8183_job_provider_idx").on(table.providerAddress, table.state)
  ]
);

export const erc8183JobEvents = pgTable(
  "erc8183_job_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    erc8183JobId: uuid("erc8183_job_id")
      .notNull()
      .references(() => erc8183Jobs.id, { onDelete: "cascade" }),
    eventKey: varchar("event_key", { length: 240 }).notNull(),
    eventType: erc8183JobEventTypeEnum("event_type").notNull(),
    previousState: erc8183JobStateEnum("previous_state"),
    nextState: erc8183JobStateEnum("next_state"),
    actorAddress: varchar("actor_address", { length: 42 }),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    blockNumber: bigint("block_number", { mode: "number" }),
    blockHash: varchar("block_hash", { length: 66 }),
    logIndex: integer("log_index"),
    confirmationState: chainObservationStateEnum("confirmation_state").notNull().default("canonical"),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    correlationId: varchar("correlation_id", { length: 160 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("erc8183_job_event_key_unique").on(table.eventKey),
    uniqueIndex("erc8183_job_event_chain_log_unique").on(table.transactionHash, table.logIndex),
    index("erc8183_job_event_job_time_idx").on(table.erc8183JobId, table.observedAt),
    index("erc8183_job_event_state_idx").on(table.confirmationState, table.blockNumber)
  ]
);

/**
 * Public result projection for a confirmed BNBEra ERC-8183 job. The protocol
 * job/event tables remain the canonical lifecycle; this table is deliberately
 * a small read projection that keeps the two result digests and the receipt
 * provenance needed by marketplace cards, detail pages, and verified reviews.
 * It is populated only after a receipt-backed submission/settlement event.
 */
export const commerceJobResults = pgTable(
  "commerce_job_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commerceJobId: uuid("commerce_job_id")
      .notNull()
      .references(() => commerceJobs.id, { onDelete: "cascade" }),
    erc8183JobRecordId: uuid("erc8183_job_record_id")
      .notNull()
      .references(() => erc8183Jobs.id, { onDelete: "cascade" }),
    chainId: integer("chain_id").notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    protocolJobId: text("protocol_job_id").notNull(),
    buyerUserId: uuid("buyer_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    buyerAddress: varchar("buyer_address", { length: 42 }).notNull(),
    identityNamespace: varchar("identity_namespace", { length: 128 }).notNull(),
    identityChainId: integer("identity_chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    identityAgentId: text("identity_agent_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    providerAddress: varchar("provider_address", { length: 42 }).notNull(),
    providerBinding: jsonb("provider_binding").$type<Record<string, unknown>>().notNull(),
    resultSha256: varchar("result_sha256", { length: 64 }).notNull(),
    resultKeccak: varchar("result_keccak", { length: 66 }).notNull(),
    resultUrl: text("result_url"),
    resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
    submissionTransactionHash: varchar("submission_transaction_hash", { length: 66 }).notNull(),
    submissionBlockNumber: bigint("submission_block_number", { mode: "number" }).notNull(),
    submissionBlockHash: varchar("submission_block_hash", { length: 66 }).notNull(),
    submissionLogIndex: integer("submission_log_index"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    state: varchar("state", { length: 16 }).notNull().default("submitted"),
    settlementTransactionHash: varchar("settlement_transaction_hash", { length: 66 }),
    settlementBlockNumber: bigint("settlement_block_number", { mode: "number" }),
    settlementBlockHash: varchar("settlement_block_hash", { length: 66 }),
    settlementLogIndex: integer("settlement_log_index"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("commerce_job_result_protocol_unique").on(table.chainId, table.commerceContract, table.protocolJobId),
    uniqueIndex("commerce_job_result_erc8183_job_unique").on(table.erc8183JobRecordId),
    index("commerce_job_result_identity_idx").on(table.identityNamespace, table.identityChainId, table.identityRegistry, table.identityAgentId, table.agentVersionId),
    index("commerce_job_result_settled_idx").on(table.state, table.settledAt),
    check("commerce_job_result_chain_check", sql`${table.chainId} in (56, 97) AND ${table.identityChainId} = ${table.chainId}`),
    check("commerce_job_result_contract_check", sql`${table.commerceContract} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.identityRegistry} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("commerce_job_result_protocol_job_id_check", sql`${table.protocolJobId} ~ '^(0|[1-9][0-9]*)$'`),
    check("commerce_job_result_address_check", sql`${table.buyerAddress} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.providerAddress} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("commerce_job_result_agent_id_check", sql`${table.identityAgentId} ~ '^(0|[1-9][0-9]*)$'`),
    check("commerce_job_result_version_check", sql`${table.agentVersion} > 0`),
    check("commerce_job_result_sha_check", sql`${table.resultSha256} ~ '^[0-9A-Fa-f]{64}$'`),
    check("commerce_job_result_keccak_check", sql`${table.resultKeccak} ~ '^0x[0-9A-Fa-f]{64}$'`),
    check("commerce_job_result_submission_hash_check", sql`${table.submissionTransactionHash} ~ '^0x[0-9A-Fa-f]{64}$' AND ${table.submissionBlockHash} ~ '^0x[0-9A-Fa-f]{64}$'`),
    check("commerce_job_result_settlement_state_check", sql`${table.state} in ('submitted', 'settled')`),
    check("commerce_job_result_settlement_fields_check", sql`num_nonnulls(${table.settlementTransactionHash}, ${table.settlementBlockNumber}, ${table.settlementBlockHash}, ${table.settledAt}) in (0, 4)`),
    check("commerce_job_result_settled_state_check", sql`(${table.state} = 'settled') = (${table.settlementTransactionHash} IS NOT NULL)`),
    check("commerce_job_result_log_index_check", sql`(${table.submissionLogIndex} IS NULL OR ${table.submissionLogIndex} >= 0) AND (${table.settlementLogIndex} IS NULL OR ${table.settlementLogIndex} >= 0)`)
  ]
);

/**
 * BNBEra verified-purchase reviews are revisioned rows, not a generic review
 * platform and not ERC-8004 Reputation Registry feedback. Historical rows are
 * retained as revoked/superseded; `activeReviewKey` is non-null only for the
 * current row and its unique index enforces at most one active review/job.
 */
export const commerceJobReviews = pgTable(
  "commerce_job_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commerceJobResultId: uuid("commerce_job_result_id")
      .notNull()
      .references(() => commerceJobResults.id, { onDelete: "cascade" }),
    commerceJobId: uuid("commerce_job_id")
      .notNull()
      .references(() => commerceJobs.id, { onDelete: "cascade" }),
    buyerUserId: uuid("buyer_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    buyerAddress: varchar("buyer_address", { length: 42 }).notNull(),
    identityNamespace: varchar("identity_namespace", { length: 128 }).notNull(),
    identityChainId: integer("identity_chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
    identityAgentId: text("identity_agent_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    providerBinding: jsonb("provider_binding").$type<Record<string, unknown>>().notNull(),
    resultSha256: varchar("result_sha256", { length: 64 }).notNull(),
    resultKeccak: varchar("result_keccak", { length: 66 }).notNull(),
    settlementTransactionHash: varchar("settlement_transaction_hash", { length: 66 }).notNull(),
    score: integer("score").notNull(),
    comment: text("comment").notNull().default(""),
    reviewState: varchar("review_state", { length: 16 }).notNull().default("active"),
    revision: integer("revision").notNull().default(1),
    activeReviewKey: uuid("active_review_key"),
    supersedesReviewId: uuid("supersedes_review_id"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: varchar("revocation_reason", { length: 240 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("commerce_job_review_active_unique").on(table.activeReviewKey),
    uniqueIndex("commerce_job_review_revision_unique").on(table.commerceJobId, table.revision),
    uniqueIndex("commerce_job_review_idempotency_unique").on(table.buyerUserId, table.idempotencyKey),
    index("commerce_job_review_identity_idx").on(table.identityNamespace, table.identityChainId, table.identityRegistry, table.identityAgentId, table.agentVersionId, table.reviewState),
    index("commerce_job_review_result_idx").on(table.commerceJobResultId, table.reviewState),
    check("commerce_job_review_chain_check", sql`${table.identityChainId} in (56, 97)`),
    check("commerce_job_review_address_check", sql`${table.buyerAddress} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.identityRegistry} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("commerce_job_review_agent_id_check", sql`${table.identityAgentId} ~ '^(0|[1-9][0-9]*)$'`),
    check("commerce_job_review_version_check", sql`${table.agentVersion} > 0`),
    check("commerce_job_review_sha_check", sql`${table.resultSha256} ~ '^[0-9A-Fa-f]{64}$'`),
    check("commerce_job_review_keccak_check", sql`${table.resultKeccak} ~ '^0x[0-9A-Fa-f]{64}$'`),
    check("commerce_job_review_receipt_check", sql`${table.settlementTransactionHash} ~ '^0x[0-9A-Fa-f]{64}$'`),
    check("commerce_job_review_score_check", sql`${table.score} between 1 and 5`),
    check("commerce_job_review_state_check", sql`${table.reviewState} in ('active', 'superseded', 'revoked')`),
    check("commerce_job_review_active_key_check", sql`(${table.reviewState} = 'active') = (${table.activeReviewKey} IS NOT NULL)`),
    check("commerce_job_review_revocation_check", sql`(${table.reviewState} = 'revoked') = (${table.revokedAt} IS NOT NULL)`),
    check("commerce_job_review_revision_check", sql`${table.revision} > 0`)
  ]
);

/** Durable pre-send/idempotency and reconciliation state for SDK operations. */
export const erc8183Operations = pgTable(
  "erc8183_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestDigest: varchar("request_digest", { length: 64 }).notNull(),
    chainId: integer("chain_id").notNull(),
    commerceContract: varchar("commerce_contract", { length: 42 }).notNull(),
    erc8183JobId: text("erc8183_job_id"),
    operationKind: varchar("operation_kind", { length: 32 }).notNull(),
    signerRole: varchar("signer_role", { length: 16 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("awaiting_signature"),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    blockNumber: bigint("block_number", { mode: "number" }),
    blockHash: varchar("block_hash", { length: 66 }),
    logIndex: integer("log_index"),
    failureCode: varchar("failure_code", { length: 80 }),
    operationContext: jsonb("operation_context").$type<Record<string, unknown>>(),
    createdAtUnix: bigint("created_at_unix", { mode: "number" }).notNull(),
    updatedAtUnix: bigint("updated_at_unix", { mode: "number" }).notNull()
  },
  (table) => [
    uniqueIndex("erc8183_operation_idempotency_unique").on(table.idempotencyKey),
    index("erc8183_operation_job_idx").on(table.chainId, table.commerceContract, table.erc8183JobId),
    index("erc8183_operation_status_idx").on(table.status, table.updatedAtUnix),
    check("erc8183_operation_chain_check", sql`${table.chainId} in (56, 97)`),
    check("erc8183_operation_contract_check", sql`${table.commerceContract} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("erc8183_operation_digest_check", sql`${table.requestDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    check("erc8183_operation_job_id_check", sql`${table.erc8183JobId} IS NULL OR ${table.erc8183JobId} ~ '^(0|[1-9][0-9]*)$'`),
    check("erc8183_operation_kind_check", sql`${table.operationKind} in ('create', 'register', 'set_budget', 'approve', 'fund', 'submit', 'settle', 'claim_refund', 'mark_expired', 'cancel', 'reject', 'dispute', 'vote')`),
    check("erc8183_operation_role_check", sql`${table.signerRole} in ('client', 'provider', 'evaluator', 'voter', 'system')`),
    check("erc8183_operation_status_check", sql`${table.status} in ('awaiting_signature', 'submitted', 'confirmed', 'reverted', 'unknown', 'reconciled', 'manual_review')`),
    check("erc8183_operation_hash_check", sql`(${table.transactionHash} IS NULL OR ${table.transactionHash} ~ '^0x[0-9A-Fa-f]{64}$') AND (${table.blockHash} IS NULL OR ${table.blockHash} ~ '^0x[0-9A-Fa-f]{64}$')`),
    check("erc8183_operation_log_check", sql`${table.logIndex} IS NULL OR ${table.logIndex} >= 0`)
  ]
);

export const paymentChallenges = pgTable(
  "payment_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    challengeId: varchar("challenge_id", { length: 240 }).notNull(),
    rail: paymentRailEnum("rail").notNull(),
    version: varchar("version", { length: 240 }).notNull(),
    challengeDigest: varchar("challenge_digest", { length: 64 }).notNull(),
    settlementNetwork: integer("settlement_network").notNull(),
    settlementAsset: varchar("settlement_asset", { length: 42 }).notNull(),
    settlementDecimals: integer("settlement_decimals").notNull(),
    amountAtomic: numeric("amount_atomic", { precision: 78, scale: 0 }).notNull(),
    recipient: varchar("recipient", { length: 42 }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    destination: text("destination").notNull(),
    facilitatorEndpoint: text("facilitator_endpoint").notNull(),
    nonceDigest: varchar("nonce_digest", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: paymentChallengeStatusEnum("status").notNull().default("issued"),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("payment_challenge_id_unique").on(table.challengeId),
    uniqueIndex("payment_challenge_digest_unique").on(table.challengeDigest),
    check("payment_challenge_network_check", sql`${table.settlementNetwork} in (56, 97)`),
    check("payment_challenge_decimals_check", sql`${table.settlementDecimals} between 0 and 255`),
    check("payment_challenge_amount_check", sql`${table.amountAtomic} > 0`),
    index("payment_challenge_expiry_idx").on(table.status, table.expiresAt)
  ]
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commerceJobId: uuid("commerce_job_id").references(() => commerceJobs.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => paymentChallenges.id, { onDelete: "restrict" }),
    rail: paymentRailEnum("rail").notNull(),
    requestId: varchar("request_id", { length: 240 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 240 }).notNull(),
    challengeDigest: varchar("challenge_digest", { length: 64 }).notNull(),
    authorizationDigest: varchar("authorization_digest", { length: 64 }),
    payerAddress: varchar("payer_address", { length: 42 }),
    settlementNetwork: integer("settlement_network").notNull(),
    settlementAsset: varchar("settlement_asset", { length: 42 }).notNull(),
    settlementDecimals: integer("settlement_decimals").notNull(),
    amountAtomic: numeric("amount_atomic", { precision: 78, scale: 0 }).notNull(),
    expectedRecipient: varchar("expected_recipient", { length: 42 }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    destination: text("destination").notNull(),
    facilitatorEndpoint: text("facilitator_endpoint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxChallengeLifetimeSeconds: integer("max_challenge_lifetime_seconds").notNull(),
    status: paymentAttemptStatusEnum("status").notNull().default("challenged"),
    relayRequestDigest: varchar("relay_request_digest", { length: 64 }),
    // Immutable request-time payment pin/config snapshot.
    pinDigest: varchar("pin_digest", { length: 64 }).notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    configurationDigest: varchar("configuration_digest", { length: 64 }).notNull(),
    fixedEgressProfile: varchar("fixed_egress_profile", { length: 160 }).notNull(),
    payoutAddress: varchar("payout_address", { length: 42 }).notNull(),
    payoutVerificationState: varchar("payout_verification_state", { length: 64 }).notNull(),
    failureCode: varchar("failure_code", { length: 240 }),
    sanitizedFailure: varchar("sanitized_failure", { length: 500 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("payment_attempt_rail_idempotency_unique").on(table.rail, table.idempotencyKey),
    uniqueIndex("payment_attempt_challenge_unique").on(table.challengeId),
    check("payment_attempt_network_check", sql`${table.settlementNetwork} in (56, 97)`),
    check("payment_attempt_decimals_check", sql`${table.settlementDecimals} between 0 and 255`),
    check("payment_attempt_amount_check", sql`${table.amountAtomic} > 0`),
    check("payment_attempt_pin_digest_check", sql`${table.pinDigest} ~ '^[0-9A-Fa-f]{64}$' AND ${table.configurationDigest} ~ '^[0-9A-Fa-f]{64}$'`),
    check("payment_attempt_configuration_version_check", sql`${table.configurationVersion} > 0`),
    check("payment_attempt_challenge_lifetime_check", sql`${table.maxChallengeLifetimeSeconds} > 0`),
    check("payment_attempt_payout_verification_check", sql`${table.payoutVerificationState} = 'verified'`),
    check("payment_attempt_address_check", sql`${table.settlementAsset} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.expectedRecipient} ~ '^0x[0-9A-Fa-f]{40}$' AND ${table.payoutAddress} ~ '^0x[0-9A-Fa-f]{40}$'`),
    index("payment_attempt_status_idx").on(table.status, table.updatedAt),
    index("payment_attempt_request_idx").on(table.requestId)
  ]
);

export const paymentAttemptEvents = pgTable(
  "payment_attempt_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    eventKey: varchar("event_key", { length: 240 }).notNull(),
    eventType: paymentEventTypeEnum("event_type").notNull(),
    previousStatus: paymentAttemptStatusEnum("previous_status"),
    nextStatus: paymentAttemptStatusEnum("next_status"),
    paymentTransactionHash: varchar("payment_transaction_hash", { length: 66 }),
    settlementTransactionHash: varchar("settlement_transaction_hash", { length: 66 }),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    correlationId: varchar("correlation_id", { length: 240 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("payment_attempt_event_key_unique").on(table.eventKey),
    index("payment_attempt_event_attempt_time_idx").on(table.attemptId, table.observedAt)
  ]
);

export const paymentReceipts = pgTable(
  "payment_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => paymentChallenges.id, { onDelete: "restrict" }),
    rail: paymentRailEnum("rail").notNull(),
    status: paymentReceiptStatusEnum("status").notNull(),
    settlementNetwork: integer("settlement_network").notNull(),
    settlementAsset: varchar("settlement_asset", { length: 42 }).notNull(),
    settlementDecimals: integer("settlement_decimals").notNull(),
    amountAtomic: numeric("amount_atomic", { precision: 78, scale: 0 }).notNull(),
    expectedRecipient: varchar("expected_recipient", { length: 42 }).notNull(),
    actualRecipient: varchar("actual_recipient", { length: 42 }),
    method: paymentMethodEnum("method").notNull(),
    destination: text("destination").notNull(),
    paymentTransactionHash: varchar("payment_transaction_hash", { length: 66 }),
    settlementTransactionHash: varchar("settlement_transaction_hash", { length: 66 }),
    payoutAddress: varchar("payout_address", { length: 42 }),
    payoutVerified: boolean("payout_verified").notNull().default(false),
    facilitatorRequestReference: varchar("facilitator_request_reference", { length: 240 }),
    responseStatus: integer("response_status"),
    responseDigest: varchar("response_digest", { length: 64 }),
    receiptDigest: varchar("receipt_digest", { length: 64 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    // Receipt ownership is a single-direction relationship. The attempt
    // record intentionally has no receipt backlink; unknown/partial
    // receipts are replaced by the canonical attempt row here.
    uniqueIndex("payment_receipt_attempt_unique").on(table.attemptId),
    uniqueIndex("payment_receipt_digest_unique").on(table.receiptDigest),
    check("payment_receipt_network_check", sql`${table.settlementNetwork} in (56, 97)`),
    check("payment_receipt_decimals_check", sql`${table.settlementDecimals} between 0 and 255`),
    check("payment_receipt_amount_check", sql`${table.amountAtomic} > 0`),
    index("payment_receipt_status_time_idx").on(table.status, table.observedAt)
  ]
);

export const paymentReplayReservations = pgTable(
  "payment_replay_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    replayKey: varchar("replay_key", { length: 64 }).notNull(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    state: paymentReplayStateEnum("state").notNull().default("inflight"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    responseDigest: varchar("response_digest", { length: 64 }),
    createdAt: now(),
    updatedAt: now(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true })
  },
  (table) => [
    uniqueIndex("payment_replay_key_unique").on(table.replayKey),
    index("payment_replay_state_expiry_idx").on(table.state, table.expiresAt)
  ]
);

export const paymentReconciliations = pgTable(
  "payment_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: "cascade" }),
    reasonCode: varchar("reason_code", { length: 240 }).notNull(),
    state: paymentReconciliationStateEnum("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    observedPaymentTransactionHash: varchar("observed_payment_transaction_hash", { length: 66 }),
    observedSettlementTransactionHash: varchar("observed_settlement_transaction_hash", { length: 66 }),
    detailDigest: varchar("detail_digest", { length: 64 }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("payment_reconciliation_reason_unique").on(table.attemptId, table.reasonCode),
    index("payment_reconciliation_due_idx").on(table.state, table.nextAttemptAt)
  ]
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").references(() => commerceJobs.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => agentTemplates.id, { onDelete: "set null" }),
    templateVersion: varchar("template_version", { length: 32 }),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    decisionSummary: jsonb("decision_summary").$type<Record<string, unknown>>().notNull(),
    selectedAction: jsonb("selected_action").$type<Record<string, unknown>>(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    outcome: varchar("outcome", { length: 64 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [index("agent_runs_agent_time_idx").on(table.agentId, table.startedAt)]
);

export const evidenceObjects = pgTable(
  "evidence_objects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    benchmarkId: varchar("benchmark_id", { length: 160 }),
    artifactId: varchar("artifact_id", { length: 160 }).notNull(),
    objectType: varchar("object_type", { length: 64 }).notNull(),
    artifactSchemaVersion: varchar("artifact_schema_version", { length: 64 }).notNull().default("bnbera.evidence/v1"),
    resourceId: varchar("resource_id", { length: 160 }).notNull(),
    version: integer("version").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    state: evidenceStateEnum("state").notNull().default("pending"),
    ipfsUri: text("ipfs_uri"),
    greenfieldBucket: varchar("greenfield_bucket", { length: 128 }),
    greenfieldObject: text("greenfield_object"),
    creationTransactionHash: varchar("creation_transaction_hash", { length: 66 }),
    sealTransactionHash: varchar("seal_transaction_hash", { length: 66 }),
    sha256Digest: varchar("sha256_digest", { length: 64 }),
    keccak256Digest: varchar("keccak256_digest", { length: 64 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    mimeType: varchar("mime_type", { length: 128 }),
    readbackVerifiedAt: timestamp("readback_verified_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("evidence_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("evidence_resource_version_unique").on(table.objectType, table.resourceId, table.version),
    index("evidence_state_idx").on(table.state, table.createdAt)
  ]
);

export const evidencePublicationAttempts = pgTable(
  "evidence_publication_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceObjectId: uuid("evidence_object_id")
      .notNull()
      .references(() => evidenceObjects.id, { onDelete: "cascade" }),
    provider: publicationProviderEnum("provider").notNull(),
    providerLabel: varchar("provider_label", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    attemptNumber: integer("attempt_number").notNull().default(0),
    configurationDigest: varchar("configuration_digest", { length: 64 }).notNull(),
    configuredNetwork: varchar("configured_network", { length: 128 }).notNull(),
    configuredBucket: varchar("configured_bucket", { length: 128 }),
    revision: integer("revision").notNull().default(0),
    leaseOwner: uuid("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    objectName: text("object_name").notNull(),
    state: publicationAttemptStateEnum("state").notNull().default("pending"),
    providerReference: text("provider_reference"),
    creationTransactionHash: varchar("creation_transaction_hash", { length: 66 }),
    sealTransactionHash: varchar("seal_transaction_hash", { length: 66 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    sanitizedError: varchar("sanitized_error", { length: 500 }),
    retryable: boolean("retryable").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("evidence_publication_idempotency_unique").on(table.idempotencyKey),
    index("evidence_publication_object_provider_idx").on(table.evidenceObjectId, table.provider),
    index("evidence_publication_state_idx").on(table.state, table.updatedAt)
  ]
);

export const evidenceLocators = pgTable(
  "evidence_locators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceObjectId: uuid("evidence_object_id")
      .notNull()
      .references(() => evidenceObjects.id, { onDelete: "cascade" }),
    publicationAttemptId: uuid("publication_attempt_id").references(() => evidencePublicationAttempts.id, {
      onDelete: "set null"
    }),
    provider: publicationProviderEnum("provider").notNull(),
    providerLabel: varchar("provider_label", { length: 128 }).notNull(),
    network: varchar("network", { length: 128 }).notNull(),
    uri: text("uri").notNull(),
    bucket: varchar("bucket", { length: 128 }),
    objectName: text("object_name"),
    providerReference: text("provider_reference"),
    version: integer("version").notNull(),
    sha256Digest: varchar("sha256_digest", { length: 64 }).notNull(),
    keccak256Digest: varchar("keccak256_digest", { length: 64 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    immutable: boolean("immutable").notNull().default(true),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("evidence_locator_uri_unique").on(table.provider, table.uri),
    index("evidence_locator_object_provider_idx").on(table.evidenceObjectId, table.provider)
  ]
);

export const evidenceVerificationResults = pgTable(
  "evidence_verification_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceObjectId: uuid("evidence_object_id")
      .notNull()
      .references(() => evidenceObjects.id, { onDelete: "cascade" }),
    publicationAttemptId: uuid("publication_attempt_id").references(() => evidencePublicationAttempts.id, {
      onDelete: "set null"
    }),
    status: evidenceVerificationStatusEnum("status").notNull().default("not_verified"),
    sealConfirmed: boolean("seal_confirmed"),
    readbackStatus: evidenceReadbackStatusEnum("readback_status").notNull().default("not_attempted"),
    expectedSha256Digest: varchar("expected_sha256_digest", { length: 64 }).notNull(),
    observedSha256Digest: varchar("observed_sha256_digest", { length: 64 }),
    expectedKeccak256Digest: varchar("expected_keccak256_digest", { length: 64 }).notNull(),
    observedKeccak256Digest: varchar("observed_keccak256_digest", { length: 64 }),
    expectedSizeBytes: bigint("expected_size_bytes", { mode: "number" }).notNull(),
    observedSizeBytes: bigint("observed_size_bytes", { mode: "number" }),
    hashesMatch: boolean("hashes_match").notNull().default(false),
    sizeMatches: boolean("size_matches").notNull().default(false),
    reasonCode: varchar("reason_code", { length: 64 }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    createdAt: now()
  },
  (table) => [
    index("evidence_verification_object_time_idx").on(table.evidenceObjectId, table.checkedAt),
    index("evidence_verification_status_idx").on(table.status, table.checkedAt)
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: eventActorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 160 }),
    action: varchar("action", { length: 160 }).notNull(),
    resourceType: varchar("resource_type", { length: 160 }).notNull(),
    resourceId: varchar("resource_id", { length: 160 }).notNull(),
    inputDigest: varchar("input_digest", { length: 64 }),
    outputDigest: varchar("output_digest", { length: 64 }),
    requestId: varchar("request_id", { length: 160 }).notNull(),
    blockNumber: bigint("block_number", { mode: "number" }),
    transactionHash: varchar("transaction_hash", { length: 66 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: now()
  },
  (table) => [index("audit_resource_time_idx").on(table.resourceType, table.resourceId, table.createdAt)]
);

export const matchEvents = pgTable(
  "match_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerRequestDigest: varchar("buyer_request_digest", { length: 64 }).notNull(),
    eligibleAgents: jsonb("eligible_agents").$type<Record<string, unknown>>().notNull(),
    excludedAgents: jsonb("excluded_agents").$type<Record<string, unknown>>().notNull(),
    componentScores: jsonb("component_scores").$type<Record<string, unknown>>().notNull(),
    exclusionReasons: jsonb("exclusion_reasons").$type<Record<string, unknown>>().notNull(),
    selectedAgentId: uuid("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: now()
  },
  (table) => [index("match_request_time_idx").on(table.buyerRequestDigest, table.createdAt)]
);

export const schemaTables = {
  authUsers,
  authSessions,
  authNonces,
  walletAddresses,
  erc8004Identities,
  agentDiscoverySources,
  agentServiceObservations,
  agentServiceProbeResults,
  agentCapabilityObservations,
  erc8004ChainObservations,
  erc8004ReputationEvents,
  erc8004ReputationCheckpoints,
  chainIngestionCheckpoints,
  scanDiscoveryCheckpoints,
  marketplaceDiscoveryCursors,
  marketplaceIngestionRetries,
  agentClaimEvents,
  agentReorgReconciliations,
  agentTemplates,
  agents,
  agentVersions,
  agentServices,
  agentDrafts,
  agentAuthorities,
  agentDeployments,
  deploymentEvents,
  agentListingEmbeddings,
  agentCategoryPredictions,
  agentHealthSnapshots,
  agentEnrichmentObservations,
  b402SellerConfigurations,
  commerceJobs,
  erc8183Jobs,
  erc8183JobEvents,
  commerceJobResults,
  commerceJobReviews,
  erc8183Operations,
  paymentChallenges,
  paymentAttempts,
  paymentAttemptEvents,
  paymentReceipts,
  paymentReplayReservations,
  paymentReconciliations,
  agentRuns,
  evidenceObjects,
  evidencePublicationAttempts,
  evidenceLocators,
  evidenceVerificationResults,
  auditEvents,
  matchEvents
} as const;
