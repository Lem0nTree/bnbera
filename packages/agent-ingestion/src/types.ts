import type {
  AdvertisedService,
  AgentStateAxes,
  ChainObservationState,
  ClaimStatus,
  DiscoverySource,
  Erc8004Identity,
  OriginType,
  ServiceValidationStatus
} from "@bnbera/domain";

export type IdentityKey = string;

export type IngestionSource = Extract<DiscoverySource, "8004scan" | "registry_event" | "manual" | "creator">;

export type IdentityCandidate = {
  readonly identity: Erc8004Identity;
  readonly source: IngestionSource;
  /** Provider-owned ID or caller-owned idempotency reference; never a secret. */
  readonly sourceReference: string;
  readonly observedAt: Date;
  readonly rawResponseDigest?: string;
  readonly normalizedIngestionVersion: string;
  /** Public metadata only; private configuration and credentials are rejected by adapters. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly services?: readonly unknown[];
  readonly capabilityManifest?: unknown;
};

export type ManualIdentityImport = {
  readonly identity: Erc8004Identity;
  readonly importReference: string;
  readonly importedAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly services?: readonly unknown[];
  readonly capabilityManifest?: unknown;
};

/**
 * Provenance attached to every direct registry read. A read may be
 * finalized or provisional, but it must always identify the exact block hash
 * that produced the values. This prevents claim/reconciliation callers from
 * accidentally persisting a head read as canonical state.
 */
export type IdentityReadConsistency = "finalized" | "provisional";

export type IdentityReadReference = {
  readonly observedBlock: number;
  readonly observedBlockHash: string;
  readonly readConsistency: IdentityReadConsistency;
};

export type DirectIdentityState = {
  readonly ownerAddress: string | null;
  readonly agentWallet: string | null;
  readonly agentUri: string | null;
  readonly contentDigest: string | null;
  readonly observedBlock: number;
  readonly observedBlockHash: string;
  readonly readConsistency: IdentityReadConsistency;
  /** Block at which each value was observed; null means no value was read. */
  readonly ownerObservedBlock: number | null;
  readonly agentWalletObservedBlock: number | null;
  readonly agentUriObservedBlock: number | null;
  readonly contentDigestObservedBlock: number | null;
};

export const directIdentityFields = [
  "ownerAddress",
  "agentWallet",
  "agentUri",
  "contentDigest"
] as const;
export type DirectIdentityField = (typeof directIdentityFields)[number];

export type RegistryEvent = {
  readonly identity: Erc8004Identity;
  readonly eventType: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly ownerAddress?: string | null;
  readonly agentUri?: string | null;
  readonly agentWallet?: string | null;
  readonly contentDigest?: string | null;
  /** Fields changed by this event; absent fields must not erase prior state. */
  readonly changedFields?: readonly DirectIdentityField[];
  readonly observedAt?: Date;
  readonly payload?: Readonly<Record<string, unknown>>;
};

export type ChainObservation = {
  readonly identityKey: IdentityKey;
  readonly identity: Erc8004Identity;
  readonly eventType: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly confirmationState: ChainObservationState;
  readonly ownerAddress: string | null;
  readonly agentUri: string | null;
  readonly agentWallet: string | null;
  readonly contentDigest: string | null;
  readonly observedFields: readonly DirectIdentityField[];
  readonly firstObservedAt: Date;
  readonly canonicalizedAt: Date | null;
  readonly orphanedAt: Date | null;
  readonly payloadDigest: string | null;
};

export type ChainCheckpoint = {
  readonly chainId: number;
  readonly identityRegistry: string;
  /** Immutable configuration identity for this cursor stream. */
  readonly indexerVersion: string;
  readonly lastScannedBlock: number;
  readonly lastScannedBlockHash: string;
  readonly lastFinalizedBlock: number;
  readonly lastFinalizedBlockHash: string;
  readonly confirmationThreshold: number;
  readonly cursorVersion: number;
  readonly lastReconciliationAt: Date | null;
};

/**
 * Compare-and-swap conditions for a checkpoint write. A production adapter
 * must evaluate this condition in the same transaction as the upsert; the
 * in-memory adapter models the same contract for tests.
 */
export type CheckpointWriteCondition = {
  readonly expectedCursorVersion: number | null;
  readonly expectedLastScannedBlockHash: string | null;
  /** Persisted predecessor used to prove scan continuity and avoid gaps. */
  readonly previousScannedBlock?: number | null;
  readonly previousScannedBlockHash?: string | null;
  /** Required only when an explicitly verified maintenance rewind is requested. */
  readonly verifiedRewind?: {
    readonly previousScannedBlock: number;
    readonly previousScannedBlockHash: string;
    readonly commonAncestorBlock: number;
    readonly commonAncestorHash: string;
  };
};

export type IdentityRecord = {
  readonly id: string;
  readonly identity: Erc8004Identity;
  readonly originType: OriginType;
  readonly ownerAddress: string | null;
  readonly agentWallet: string | null;
  readonly agentUri: string | null;
  readonly contentDigest: string | null;
  readonly observedBlock: number | null;
  readonly observedBlockHash: string | null;
  readonly readConsistency: IdentityReadConsistency | null;
  readonly ownerObservedBlock: number | null;
  readonly agentWalletObservedBlock: number | null;
  readonly agentUriObservedBlock: number | null;
  readonly contentDigestObservedBlock: number | null;
  readonly state: AgentStateAxes;
  readonly ownerClaimVerifiedAt: Date | null;
  readonly updatedAt: Date;
};

export type DiscoverySourceRecord = {
  readonly identityKey: IdentityKey;
  readonly source: IngestionSource;
  readonly sourceReference: string;
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
  readonly rawResponseDigest: string | null;
  readonly normalizedIngestionVersion: string;
};

export type ClaimRecord = {
  readonly identityKey: IdentityKey;
  /** Monotonic row version used by claim mutations for compare-and-swap. */
  readonly version: number;
  readonly status: ClaimStatus;
  readonly claimantAddress: string | null;
  readonly ownerAddressAtVerification: string | null;
  readonly agentWalletAtVerification: string | null;
  readonly verifiedAt: Date | null;
  readonly staleAt: Date | null;
  readonly lastReason: "claimed" | "owner_transfer" | "revoked" | "reconciliation" | null;
  /** Exact identity read used to verify the claim, when one exists. */
  readonly verificationObservedBlock: number | null;
  readonly verificationObservedBlockHash: string | null;
  readonly verificationReadConsistency: IdentityReadConsistency | null;
};

export type ClaimEvent = {
  readonly identityKey: IdentityKey;
  readonly eventType: "claimed" | "stale" | "revoked";
  readonly claimantAddress: string | null;
  readonly observedOwnerAddress: string | null;
  readonly observedAgentWallet: string | null;
  readonly proofDigest: string | null;
  readonly actorType: "owner" | "operator";
  readonly actorId: string;
  readonly reason: string;
  readonly occurredAt: Date;
};

export type ClaimMutationActor =
  | {
      readonly type: "owner";
      readonly walletAddress: string;
      readonly proofDigest: string;
    }
  | {
      readonly type: "operator";
      /** Authenticated operator principal, never a caller-supplied display name. */
      readonly operatorId: string;
      /** Scope granted by the authenticated operator session. */
      readonly scope: "identity.claim.revoke" | "identity.claim.reconcile";
  };

export type AuthenticatedOperator = {
  readonly operatorId: string;
  readonly scopes: readonly ("identity.claim.revoke" | "identity.claim.reconcile")[];
};

export type ClaimMutation = {
  readonly identityKey: IdentityKey;
  /** Null means the caller expects that no claim row exists yet. */
  readonly expectedVersion: number | null;
  readonly expectedStatus: ClaimStatus | null;
  /**
   * Canonical owner value expected by this mutation. Repositories must compare
   * it with the stored identity row in the same transaction; callers cannot
   * use this field to establish ownership.
   */
  readonly expectedOwnerAddress: string | null;
  /** Identity read that the repository must still hold before the CAS. */
  readonly expectedCanonicalRead: IdentityReadReference;
  readonly claim: ClaimRecord;
  readonly event: ClaimEvent;
  readonly actor: ClaimMutationActor;
};

export type ServiceObservation = AdvertisedService & {
  readonly identityKey: IdentityKey;
  readonly capabilityManifestDigest: string | null;
};

export type ServiceProbeRecord = {
  readonly identityKey: IdentityKey;
  readonly kind: AdvertisedService["kind"];
  readonly url: string;
  readonly validationStatus: Extract<ServiceValidationStatus, "healthy" | "unhealthy" | "rejected">;
  readonly statusCode: number | null;
  readonly latencyMs: number | null;
  readonly safeCapabilityProbe: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
  readonly observedAt: Date;
};

export type CapabilityObservation = {
  readonly identityKey: IdentityKey;
  readonly source: IngestionSource;
  readonly schemaVersion: string;
  readonly capabilityManifest: unknown;
  readonly manifestDigest: string;
  readonly observedAt: Date;
};

export type ReconciliationRecord = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly previousScannedBlock: number;
  readonly commonAncestorBlock: number;
  readonly affectedIdentityKeys: readonly IdentityKey[];
  readonly status: "started" | "completed" | "failed";
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly errorCode: string | null;
};

export type IdentityUpsertInput = {
  readonly identity: Erc8004Identity;
  readonly originType: OriginType;
  readonly canonicalState?: DirectIdentityState;
};

export type IdentityCanonicalUpdate = DirectIdentityState & {
  readonly identity: Erc8004Identity;
};

export type IngestionFilter = {
  readonly chainId?: number;
  readonly identityRegistry?: string;
};

export type ClaimVerificationProof = {
  /** Full ERC-8004 identity bound into the signed SIWE message. */
  readonly identity: Erc8004Identity;
  readonly address: string;
  readonly chainId: number;
  /** EIP-4361 domain supplied by the server-side SIWE challenge. */
  readonly domain: string;
  /** EIP-4361 URI supplied by the server-side SIWE challenge. */
  readonly uri: string;
  /** EIP-4361 resources supplied by the server-side SIWE challenge. */
  readonly resources: readonly string[];
  /** BNBEra claim action bound into the SIWE challenge. */
  readonly action: "claim";
  readonly issuedAt: Date;
  readonly expirationTime: Date;
  readonly nonce: string;
  /** Digest of the verified signature or signed SIWE payload. */
  readonly signatureDigest: string;
};

export type ClaimVerificationContext = Pick<
  ClaimVerificationProof,
  "domain" | "uri" | "resources" | "action"
> & {
  readonly chainId: number;
};

export type VerifiedClaimProof = ClaimVerificationProof & {
  /** Set by the verifier only after signature and address recovery succeed. */
  readonly verifiedAt: Date;
};

export interface IdentityRepository {
  findIdentity(identity: Erc8004Identity): Promise<IdentityRecord | null>;
  upsertIdentity(input: IdentityUpsertInput): Promise<IdentityRecord>;
  applyCanonicalState(input: IdentityCanonicalUpdate): Promise<IdentityRecord>;
  listIdentities(filter?: IngestionFilter): Promise<readonly IdentityRecord[]>;
}

export interface DiscoverySourceRepository {
  recordSource(input: {
    readonly identityKey: IdentityKey;
    readonly source: IngestionSource;
    readonly sourceReference: string;
    readonly observedAt: Date;
    readonly rawResponseDigest: string | null;
    readonly normalizedIngestionVersion: string;
  }): Promise<DiscoverySourceRecord>;
  listSources(identityKey: IdentityKey): Promise<readonly DiscoverySourceRecord[]>;
}

export interface ObservationRepository {
  appendObservation(input: ChainObservation): Promise<ChainObservation>;
  findObservation(transactionHash: string, logIndex: number): Promise<ChainObservation | null>;
  markCanonical(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly throughBlock: number;
    readonly canonicalizedAt: Date;
  }): Promise<readonly ChainObservation[]>;
  listObservations(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly fromBlock?: number;
    readonly toBlock?: number;
    readonly state?: ChainObservationState;
  }): Promise<readonly ChainObservation[]>;
  markOrphaned(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly fromBlock: number;
    readonly occurredAt: Date;
  }): Promise<readonly IdentityKey[]>;
}

export interface CheckpointRepository {
  getCheckpoint(chainId: number, identityRegistry: string): Promise<ChainCheckpoint | null>;
  saveCheckpoint(input: ChainCheckpoint, condition: CheckpointWriteCondition): Promise<ChainCheckpoint>;
}

/**
 * Durable provider-pagination state for the bounded 8004scan discovery job.
 * This is intentionally separate from ChainCheckpoint: provider offsets are
 * not block cursors and must never be interpreted as chain finality.
 */
export type ScanDiscoveryCheckpoint = {
  readonly scope: string;
  readonly queryDigest: string;
  readonly initialOffset: number | null;
  readonly initialCursor: string | null;
  readonly nextOffset: number | null;
  readonly nextCursor: string | null;
  readonly pageSize: number;
  readonly total: number | null;
  readonly pagesProcessed: number;
  readonly candidatesProcessed: number;
  readonly lastPageDigest: string | null;
  readonly cursorVersion: number;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
};

export type ScanDiscoveryCheckpointWriteCondition = {
  readonly expectedCursorVersion: number | null;
  readonly expectedQueryDigest: string;
  readonly expectedInitialOffset: number | null;
  readonly expectedInitialCursor: string | null;
};

/**
 * The job uses a transaction-scoped advisory lock in PostgreSQL and an
 * equivalent in-memory guard in tests. Keeping this port outside the general
 * ingestion repository means normal candidate ingestion remains unchanged.
 */
export interface ScanDiscoveryCheckpointRepository {
  getScanDiscoveryCheckpoint(scope: string): Promise<ScanDiscoveryCheckpoint | null>;
  saveScanDiscoveryCheckpoint(
    input: ScanDiscoveryCheckpoint,
    condition: ScanDiscoveryCheckpointWriteCondition
  ): Promise<ScanDiscoveryCheckpoint>;
  withScanDiscoveryRunLock<T>(scope: string, work: () => Promise<T>): Promise<T>;
}

export type ResumableScanRepository = IngestionRepository & ScanDiscoveryCheckpointRepository;

export interface ClaimRepository {
  getClaim(identityKey: IdentityKey): Promise<ClaimRecord | null>;
  /**
   * Atomically compare-and-swaps the claim row, identity claim axis, and
   * append-only event. Implementations must execute all three writes in one
   * database transaction and reject a stale expectedVersion/status.
   */
  mutateClaim(input: ClaimMutation): Promise<ClaimRecord>;
  listClaimEvents(identityKey: IdentityKey): Promise<readonly ClaimEvent[]>;
}

export interface ServiceRepository {
  upsertService(input: ServiceObservation): Promise<ServiceObservation>;
  listServices(identityKey: IdentityKey): Promise<readonly ServiceObservation[]>;
  upsertCapabilities(input: CapabilityObservation): Promise<CapabilityObservation>;
  listCapabilities(identityKey: IdentityKey): Promise<readonly CapabilityObservation[]>;
  appendProbeResult(input: ServiceProbeRecord): Promise<void>;
  listProbeResults(identityKey: IdentityKey): Promise<readonly ServiceProbeRecord[]>;
}

export interface ReconciliationRepository {
  appendReconciliation(input: ReconciliationRecord): Promise<void>;
  listReconciliations(chainId: number, identityRegistry: string): Promise<readonly ReconciliationRecord[]>;
}

export interface IngestionRepository
  extends IdentityRepository,
    DiscoverySourceRepository,
    ObservationRepository,
    CheckpointRepository,
    ClaimRepository,
    ServiceRepository,
    ReconciliationRepository {
  /**
   * Execute a unit of work with atomic commit/rollback semantics. A
   * checkpoint may be persisted only inside the same unit after all
   * ingestion, canonicalization, and identity/claim updates succeed.
   */
  withTransaction<T>(work: (repository: IngestionRepository) => Promise<T>): Promise<T>;
}
