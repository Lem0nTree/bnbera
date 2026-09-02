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
    contentDigest: varchar("content_digest", { length: 64 }),
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
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    canonicalizedAt: timestamp("canonicalized_at", { withTimezone: true }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: now()
  },
  (table) => [
    uniqueIndex("erc8004_observation_log_unique").on(table.transactionHash, table.logIndex),
    index("erc8004_observation_block_idx").on(table.identityId, table.blockNumber),
    index("erc8004_observation_state_idx").on(table.confirmationState, table.blockNumber)
  ]
);

export const chainIngestionCheckpoints = pgTable(
  "chain_ingestion_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    identityRegistry: varchar("identity_registry", { length: 42 }).notNull(),
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
    lastPaidCanaryResult: jsonb("last_paid_canary_result").$type<Record<string, unknown>>(),
    createdAt: now(),
    updatedAt: now()
  },
  (table) => [
    uniqueIndex("b402_seller_agent_unique").on(table.agentId),
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
    uniqueIndex("commerce_erc8183_job_unique").on(table.erc8183JobId),
    index("commerce_provider_status_idx").on(table.providerAgentId, table.status)
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
  erc8004ChainObservations,
  chainIngestionCheckpoints,
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
  agentRuns,
  evidenceObjects,
  evidencePublicationAttempts,
  evidenceLocators,
  evidenceVerificationResults,
  auditEvents,
  matchEvents
} as const;
