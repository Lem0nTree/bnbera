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

export type DirectIdentityState = {
  readonly ownerAddress: string | null;
  readonly agentWallet: string | null;
  readonly agentUri: string | null;
  readonly contentDigest: string | null;
  readonly observedBlock: number;
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
  readonly lastScannedBlock: number;
  readonly lastScannedBlockHash: string;
  readonly lastFinalizedBlock: number;
  readonly lastFinalizedBlockHash: string;
  readonly confirmationThreshold: number;
  readonly cursorVersion: number;
  readonly lastReconciliationAt: Date | null;
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
  readonly status: ClaimStatus;
  readonly claimantAddress: string | null;
  readonly ownerAddressAtVerification: string | null;
  readonly agentWalletAtVerification: string | null;
  readonly verifiedAt: Date | null;
  readonly staleAt: Date | null;
  readonly lastReason: "claimed" | "owner_transfer" | "revoked" | "reconciliation" | null;
};

export type ClaimEvent = {
  readonly identityKey: IdentityKey;
  readonly eventType: "claimed" | "stale" | "revoked";
  readonly claimantAddress: string | null;
  readonly observedOwnerAddress: string | null;
  readonly observedAgentWallet: string | null;
  readonly proofDigest: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
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
  readonly address: string;
  readonly chainId: number;
  readonly issuedAt: Date;
  readonly expirationTime: Date;
  readonly nonce: string;
  readonly signatureDigest?: string;
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
  saveCheckpoint(input: ChainCheckpoint): Promise<ChainCheckpoint>;
}

export interface ClaimRepository {
  getClaim(identityKey: IdentityKey): Promise<ClaimRecord | null>;
  saveClaim(input: ClaimRecord): Promise<ClaimRecord>;
  appendClaimEvent(input: ClaimEvent): Promise<void>;
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
  withTransaction<T>(work: (repository: IngestionRepository) => Promise<T>): Promise<T>;
}
