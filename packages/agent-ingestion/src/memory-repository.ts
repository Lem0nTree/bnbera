import { randomUUID } from "node:crypto";
import {
  assertStateTransition,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type AgentStateAxes,
  type ChainObservationState,
  type Erc8004Identity,
  type OriginType
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { normalizeRegistryCheckpoint } from "./adapters/registry.js";
import { assertIdentityReadProvenance, identityRecordReadReference } from "./identity-provenance.js";
import {
  normalizeReputationCheckpoint,
  normalizeReputationFeedbackEvent,
  projectReputationFeedback
} from "./reputation.js";
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

function defaultState(originType: OriginType): AgentStateAxes {
  return {
    originType,
    claimStatus: "unclaimed",
    verificationStatus: "pending",
    runtimeStatus: "unavailable",
    authorityStatus: "none",
    listingStatus: "draft"
  };
}

function checkpointKey(chainId: number, identityRegistry: string): string {
  return `${chainId}:${normalizeEvmAddress(identityRegistry)}`;
}

function observationKey(transactionHash: string, logIndex: number): string {
  return `${transactionHash.toLowerCase()}:${logIndex}`;
}

function reputationEventKey(transactionHash: string, logIndex: number, blockHash: string): string {
  return `${transactionHash.toLowerCase()}:${logIndex}:${blockHash.toLowerCase()}`;
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

function compareReputationEvents(left: ReputationFeedbackEvent, right: ReputationFeedbackEvent): number {
  return left.blockNumber - right.blockNumber || left.logIndex - right.logIndex || left.transactionHash.localeCompare(right.transactionHash) || left.blockHash.localeCompare(right.blockHash);
}

function sourceKey(identityKey: IdentityKey, source: string, sourceReference: string): string {
  return `${identityKey}:${source}:${sourceReference}`;
}

function serviceKey(identityKey: IdentityKey, kind: string, url: string): string {
  return `${identityKey}:${kind}:${url}`;
}

function scanCheckpointKey(scope: string): string {
  const normalized = scope.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      "The 8004scan job scope is invalid.",
      "fix_scan_configuration"
    );
  }
  return normalized;
}

type RepositorySnapshot = {
  readonly identities: Map<IdentityKey, IdentityRecord>;
  readonly sources: Map<string, DiscoverySourceRecord>;
  readonly observations: Map<string, ChainObservation>;
  readonly reputationEvents: Map<string, ReputationFeedbackEvent>;
  readonly reputationCheckpoints: Map<string, ReputationCheckpoint>;
  readonly checkpoints: Map<string, ChainCheckpoint>;
  readonly scanCheckpoints: Map<string, ScanDiscoveryCheckpoint>;
  readonly claims: Map<IdentityKey, ClaimRecord>;
  readonly claimEvents: Map<IdentityKey, ClaimEvent[]>;
  readonly services: Map<string, ServiceObservation>;
  readonly capabilities: Map<string, CapabilityObservation>;
  readonly probeResults: ServiceProbeRecord[];
  readonly reconciliations: ReconciliationRecord[];
};

/**
 * Deterministic repository used by unit tests and local contract fixtures.
 * Production callers should implement the same ports over the Drizzle schema.
 * It intentionally models uniqueness and transaction boundaries so tests do
 * not accidentally bless duplicate ingestion or partial reorg updates.
 */
export class InMemoryIngestionRepository implements IngestionRepository, ScanDiscoveryCheckpointRepository {
  private identities = new Map<IdentityKey, IdentityRecord>();
  private sources = new Map<string, DiscoverySourceRecord>();
  private observations = new Map<string, ChainObservation>();
  private reputationEvents = new Map<string, ReputationFeedbackEvent>();
  private reputationCheckpoints = new Map<string, ReputationCheckpoint>();
  private checkpoints = new Map<string, ChainCheckpoint>();
  private scanCheckpoints = new Map<string, ScanDiscoveryCheckpoint>();
  private claims = new Map<IdentityKey, ClaimRecord>();
  private claimEvents = new Map<IdentityKey, ClaimEvent[]>();
  private services = new Map<string, ServiceObservation>();
  private capabilities = new Map<string, CapabilityObservation>();
  private probeResults: ServiceProbeRecord[] = [];
  private reconciliations: ReconciliationRecord[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();
  private activeScanScopes = new Set<string>();

  async withTransaction<T>(work: (repository: IngestionRepository) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.transactionQueue;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = this.snapshot();
    try {
      return await work(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    } finally {
      release?.();
    }
  }

  /**
   * The fixture implements the same all-or-nothing guarantee expected from a
   * production database transaction. Copying every mutable collection makes
   * failure tests catch accidental checkpoint/state/event partial commits.
   */
  private snapshot(): RepositorySnapshot {
    return {
      identities: new Map(this.identities),
      sources: new Map(this.sources),
      observations: new Map(this.observations),
      reputationEvents: new Map(this.reputationEvents),
      reputationCheckpoints: new Map(this.reputationCheckpoints),
      checkpoints: new Map(this.checkpoints),
      scanCheckpoints: new Map(this.scanCheckpoints),
      claims: new Map(this.claims),
      claimEvents: new Map([...this.claimEvents].map(([key, events]) => [key, [...events]])),
      services: new Map(this.services),
      capabilities: new Map(this.capabilities),
      probeResults: [...this.probeResults],
      reconciliations: [...this.reconciliations]
    };
  }

  private restore(snapshot: RepositorySnapshot): void {
    this.identities = snapshot.identities;
    this.sources = snapshot.sources;
    this.observations = snapshot.observations;
    this.reputationEvents = snapshot.reputationEvents;
    this.reputationCheckpoints = snapshot.reputationCheckpoints;
    this.checkpoints = snapshot.checkpoints;
    this.scanCheckpoints = snapshot.scanCheckpoints;
    this.claims = snapshot.claims;
    this.claimEvents = snapshot.claimEvents;
    this.services = snapshot.services;
    this.capabilities = snapshot.capabilities;
    this.probeResults = snapshot.probeResults;
    this.reconciliations = snapshot.reconciliations;
  }

  async findIdentity(input: Parameters<typeof normalizeErc8004Identity>[0]): Promise<IdentityRecord | null> {
    const identity = normalizeErc8004Identity(input);
    return this.identities.get(erc8004IdentityKey(identity)) ?? null;
  }

  async upsertIdentity(input: IdentityUpsertInput): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    if (input.canonicalState !== undefined) {
      assertIdentityReadProvenance(input.canonicalState, "canonical identity state");
    }
    const key = erc8004IdentityKey(identity);
    const existing = this.identities.get(key);
    if (existing !== undefined) {
      if (existing.identity.chainId !== identity.chainId || existing.identity.identityRegistry !== identity.identityRegistry) {
        throw ingestionError(
          "IDENTITY_CONFLICT",
          "The identity key conflicts with an existing registry record.",
          "review_identity",
          { existing, identity }
        );
      }
      if (existing.originType !== input.originType) {
        // Origin is immutable. Discovery can be followed by a manual import
        // without rewriting how the record first entered the marketplace.
        return existing;
      }
      if (input.canonicalState !== undefined) {
        return this.applyCanonicalState({ identity, ...input.canonicalState });
      }
      return existing;
    }

    const state = defaultState(input.originType);
    const now = new Date();
    const record: IdentityRecord = {
      id: randomUUID(),
      identity,
      originType: input.originType,
      ownerAddress: input.canonicalState?.ownerAddress ?? null,
      agentWallet: input.canonicalState?.agentWallet ?? null,
      agentUri: input.canonicalState?.agentUri ?? null,
      contentDigest: input.canonicalState?.contentDigest ?? null,
      observedBlock: input.canonicalState?.observedBlock ?? null,
      observedBlockHash: input.canonicalState?.observedBlockHash ?? null,
      readConsistency: input.canonicalState?.readConsistency ?? null,
      ownerObservedBlock: input.canonicalState?.ownerObservedBlock ?? null,
      agentWalletObservedBlock: input.canonicalState?.agentWalletObservedBlock ?? null,
      agentUriObservedBlock: input.canonicalState?.agentUriObservedBlock ?? null,
      contentDigestObservedBlock: input.canonicalState?.contentDigestObservedBlock ?? null,
      state,
      ownerClaimVerifiedAt: null,
      updatedAt: now
    };
    this.identities.set(key, record);
    return record;
  }

  async applyCanonicalState(input: IdentityCanonicalUpdate): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    assertIdentityReadProvenance(input, "canonical identity state");
    const key = erc8004IdentityKey(identity);
    const existing = this.identities.get(key);
    if (existing === undefined) {
      return this.upsertIdentity({
        identity,
        originType: "discovered",
        canonicalState: input
      });
    }

    const ownerAddress = normalizeNullableAddress(input.ownerAddress);
    const agentWallet = normalizeNullableAddress(input.agentWallet);
    const agentUri = input.agentUri;
    const contentDigest = input.contentDigest;
    let state = existing.state;
    const ownerChanged = existing.ownerAddress !== ownerAddress;
    if (ownerChanged && state.claimStatus === "claimed") {
      assertStateTransition("claimStatus", state.claimStatus, "stale");
      state = { ...state, claimStatus: "stale" };
    }
    const record: IdentityRecord = {
      ...existing,
      ownerAddress,
      agentWallet,
      agentUri,
      contentDigest,
      observedBlock: input.observedBlock,
      observedBlockHash: input.observedBlockHash.toLowerCase(),
      readConsistency: input.readConsistency,
      ownerObservedBlock: input.ownerObservedBlock,
      agentWalletObservedBlock: input.agentWalletObservedBlock,
      agentUriObservedBlock: input.agentUriObservedBlock,
      contentDigestObservedBlock: input.contentDigestObservedBlock,
      state,
      ownerClaimVerifiedAt: ownerChanged ? null : existing.ownerClaimVerifiedAt,
      updatedAt: new Date()
    };
    this.identities.set(key, record);
    return record;
  }

  async listIdentities(filter?: IngestionFilter): Promise<readonly IdentityRecord[]> {
    return [...this.identities.values()]
      .filter((record) => filter?.chainId === undefined || record.identity.chainId === filter.chainId)
      .filter(
        (record) =>
          filter?.identityRegistry === undefined ||
          record.identity.identityRegistry === normalizeEvmAddress(filter.identityRegistry)
      )
      .sort((a, b) => erc8004IdentityKey(a.identity).localeCompare(erc8004IdentityKey(b.identity)));
  }

  async recordSource(input: {
    readonly identityKey: IdentityKey;
    readonly source: DiscoverySourceRecord["source"];
    readonly sourceReference: string;
    readonly observedAt: Date;
    readonly rawResponseDigest: string | null;
    readonly normalizedIngestionVersion: string;
  }): Promise<DiscoverySourceRecord> {
    const key = sourceKey(input.identityKey, input.source, input.sourceReference);
    const existing = this.sources.get(key);
    if (existing !== undefined) {
      const updated: DiscoverySourceRecord = {
        ...existing,
        lastObservedAt:
          input.observedAt.getTime() > existing.lastObservedAt.getTime() ? input.observedAt : existing.lastObservedAt,
        rawResponseDigest: input.rawResponseDigest ?? existing.rawResponseDigest,
        normalizedIngestionVersion: input.normalizedIngestionVersion
      };
      this.sources.set(key, updated);
      return updated;
    }
    const record: DiscoverySourceRecord = {
      identityKey: input.identityKey,
      source: input.source,
      sourceReference: input.sourceReference,
      firstObservedAt: input.observedAt,
      lastObservedAt: input.observedAt,
      rawResponseDigest: input.rawResponseDigest,
      normalizedIngestionVersion: input.normalizedIngestionVersion
    };
    this.sources.set(key, record);
    return record;
  }

  async listSources(identityKey: IdentityKey): Promise<readonly DiscoverySourceRecord[]> {
    return [...this.sources.values()]
      .filter((record) => record.identityKey === identityKey)
      .sort((a, b) => a.sourceReference.localeCompare(b.sourceReference));
  }

  async appendObservation(input: ChainObservation): Promise<ChainObservation> {
    const key = observationKey(input.transactionHash, input.logIndex);
    const existing = this.observations.get(key);
    if (existing !== undefined) {
      if (
        existing.blockHash !== input.blockHash ||
        existing.identityKey !== input.identityKey ||
        existing.eventType !== input.eventType ||
        existing.payloadDigest !== input.payloadDigest ||
        existing.observedFields.join(",") !== input.observedFields.join(",")
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
    this.observations.set(key, input);
    return input;
  }

  async findObservation(transactionHash: string, logIndex: number): Promise<ChainObservation | null> {
    return this.observations.get(observationKey(transactionHash, logIndex)) ?? null;
  }

  async markCanonical(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly throughBlock: number;
    readonly canonicalizedAt: Date;
  }): Promise<readonly ChainObservation[]> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    const promoted: ChainObservation[] = [];
    for (const [key, observation] of this.observations.entries()) {
      if (
        observation.identity.chainId !== input.chainId ||
        observation.identity.identityRegistry !== registry ||
        observation.blockNumber > input.throughBlock ||
        observation.confirmationState !== "provisional"
      ) {
        continue;
      }
      const canonical: ChainObservation = {
        ...observation,
        confirmationState: "canonical",
        canonicalizedAt: input.canonicalizedAt
      };
      this.observations.set(key, canonical);
      promoted.push(canonical);
    }
    return promoted.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async listObservations(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly fromBlock?: number;
    readonly toBlock?: number;
    readonly state?: ChainObservationState;
  }): Promise<readonly ChainObservation[]> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    return [...this.observations.values()]
      .filter((observation) => observation.identity.chainId === input.chainId)
      .filter((observation) => observation.identity.identityRegistry === registry)
      .filter((observation) => input.fromBlock === undefined || observation.blockNumber >= input.fromBlock)
      .filter((observation) => input.toBlock === undefined || observation.blockNumber <= input.toBlock)
      .filter((observation) => input.state === undefined || observation.confirmationState === input.state)
      .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  }

  async markOrphaned(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly fromBlock: number;
    readonly occurredAt: Date;
  }): Promise<readonly IdentityKey[]> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    const affected = new Set<IdentityKey>();
    for (const [key, observation] of this.observations.entries()) {
      if (
        observation.identity.chainId !== input.chainId ||
        observation.identity.identityRegistry !== registry ||
        observation.blockNumber < input.fromBlock ||
        observation.confirmationState === "orphaned"
      ) {
        continue;
      }
      this.observations.set(key, {
        ...observation,
        confirmationState: "orphaned",
        orphanedAt: input.occurredAt
      });
      affected.add(observation.identityKey);
    }
    return [...affected];
  }

  async appendReputationEvent(input: ReputationFeedbackEvent): Promise<ReputationFeedbackEvent> {
    const normalized = normalizeReputationFeedbackEvent(input);
    const identityKey = erc8004IdentityKey(normalized.identity);
    if (!this.identities.has(identityKey)) {
      throw ingestionError("REPUTATION_IDENTITY_NOT_FOUND", "The reputation event identity is not in the ingestion index.", "import_identity");
    }
    const key = reputationEventKey(normalized.transactionHash, normalized.logIndex, normalized.blockHash);
    const existing = this.reputationEvents.get(key);
    if (existing !== undefined) {
      if (!sameReputationEvent(existing, normalized)) {
        throw ingestionError("REPUTATION_DUPLICATE_CONFLICT", "A reputation log position was observed with conflicting data.", "reconcile_reputation", { existing, input: normalized });
      }
      return existing;
    }
    this.reputationEvents.set(key, normalized);
    return normalized;
  }

  async markReputationCanonical(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly reputationRegistry: string;
    readonly throughBlock: number;
    readonly canonicalizedAt: Date;
  }): Promise<readonly ReputationFeedbackEvent[]> {
    const identityRegistry = normalizeEvmAddress(input.identityRegistry);
    const reputationRegistry = normalizeEvmAddress(input.reputationRegistry);
    const promoted: ReputationFeedbackEvent[] = [];
    for (const [key, event] of this.reputationEvents) {
      if (event.identity.chainId !== input.chainId || event.identity.identityRegistry !== identityRegistry || event.reputationRegistry !== reputationRegistry || event.blockNumber > input.throughBlock || event.confirmationState !== "provisional") continue;
      const canonical = { ...event, confirmationState: "canonical" as const, canonicalizedAt: input.canonicalizedAt };
      this.reputationEvents.set(key, canonical);
      promoted.push(canonical);
    }
    return promoted.sort(compareReputationEvents);
  }

  async listReputationEvents(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly reputationRegistry: string;
    readonly fromBlock?: number;
    readonly toBlock?: number;
    readonly state?: ChainObservationState;
  }): Promise<readonly ReputationFeedbackEvent[]> {
    const identityRegistry = normalizeEvmAddress(input.identityRegistry);
    const reputationRegistry = normalizeEvmAddress(input.reputationRegistry);
    return [...this.reputationEvents.values()]
      .filter((event) => event.identity.chainId === input.chainId && event.identity.identityRegistry === identityRegistry && event.reputationRegistry === reputationRegistry)
      .filter((event) => input.fromBlock === undefined || event.blockNumber >= input.fromBlock)
      .filter((event) => input.toBlock === undefined || event.blockNumber <= input.toBlock)
      .filter((event) => input.state === undefined || event.confirmationState === input.state)
      .sort(compareReputationEvents);
  }

  async markReputationOrphaned(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly reputationRegistry: string;
    readonly fromBlock: number;
    readonly occurredAt: Date;
  }): Promise<void> {
    const identityRegistry = normalizeEvmAddress(input.identityRegistry);
    const reputationRegistry = normalizeEvmAddress(input.reputationRegistry);
    for (const [key, event] of this.reputationEvents) {
      if (event.identity.chainId !== input.chainId || event.identity.identityRegistry !== identityRegistry || event.reputationRegistry !== reputationRegistry || event.blockNumber < input.fromBlock || event.confirmationState === "orphaned") continue;
      this.reputationEvents.set(key, { ...event, confirmationState: "orphaned", orphanedAt: input.occurredAt });
    }
  }

  async listReputationFeedback(identity: Erc8004Identity, options: { readonly includeRevoked?: boolean } = {}): Promise<readonly ReputationFeedback[]> {
    const normalizedIdentity = normalizeErc8004Identity(identity);
    const events = [...this.reputationEvents.values()].filter((event) => erc8004IdentityKey(event.identity) === erc8004IdentityKey(normalizedIdentity));
    return projectReputationFeedback(events, normalizedIdentity, options);
  }

  async getReputationCheckpoint(chainId: number, identityRegistry: string, reputationRegistry: string): Promise<ReputationCheckpoint | null> {
    return this.reputationCheckpoints.get(`${chainId}:${normalizeEvmAddress(identityRegistry)}:${normalizeEvmAddress(reputationRegistry)}`) ?? null;
  }

  async saveReputationCheckpoint(input: ReputationCheckpoint, condition: ReputationCheckpointWriteCondition): Promise<ReputationCheckpoint> {
    const normalized = normalizeReputationCheckpoint(input);
    const key = `${normalized.chainId}:${normalized.identityRegistry}:${normalized.reputationRegistry}`;
    const existing = this.reputationCheckpoints.get(key);
    if (existing === undefined) {
      if (condition.expectedCursorVersion !== null || condition.expectedLastScannedBlockHash !== null || normalized.cursorVersion !== 1) {
        throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint create condition does not match an empty cursor.", "reconcile_reputation", { condition, input: normalized });
      }
      this.reputationCheckpoints.set(key, normalized);
      return normalized;
    }
    if (condition.expectedCursorVersion !== existing.cursorVersion || !sameNullableHash(condition.expectedLastScannedBlockHash, existing.lastScannedBlockHash)) {
      throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint changed before this update completed.", "reconcile_reputation", { existing, input: normalized, condition });
    }
    if (normalized.indexerVersion === existing.indexerVersion && normalized.confirmationThreshold !== existing.confirmationThreshold) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation confirmation threshold is immutable for an indexer version.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.cursorVersion !== existing.cursorVersion + 1) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint cursor must advance exactly once.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.lastScannedBlock > existing.lastScannedBlock && (condition.previousScannedBlock !== existing.lastScannedBlock || !sameNullableHash(condition.previousScannedBlockHash ?? null, existing.lastScannedBlockHash))) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint predecessor does not match the persisted scan cursor.", "reconcile_reputation", { existing, input: normalized, condition });
    const rewind = condition.verifiedRewind;
    const lowersScanned = normalized.lastScannedBlock < existing.lastScannedBlock;
    const lowersFinality = normalized.lastFinalizedBlock < existing.lastFinalizedBlock;
    if (lowersScanned || lowersFinality) {
      if (rewind === undefined || rewind.previousScannedBlock !== existing.lastScannedBlock || !sameNullableHash(rewind.previousScannedBlockHash, existing.lastScannedBlockHash) || rewind.commonAncestorBlock !== normalized.lastScannedBlock || !sameNullableHash(rewind.commonAncestorHash, normalized.lastScannedBlockHash)) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "The reputation checkpoint would move backwards without an explicit verified rewind.", "reconcile_reputation", { existing, input: normalized, condition });
    } else if (normalized.lastScannedBlock === existing.lastScannedBlock && !sameNullableHash(normalized.lastScannedBlockHash, existing.lastScannedBlockHash)) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "A reputation checkpoint block cannot change its hash without a verified rewind.", "reconcile_reputation", { existing, input: normalized });
    if (normalized.lastFinalizedBlock === existing.lastFinalizedBlock && !sameNullableHash(normalized.lastFinalizedBlockHash, existing.lastFinalizedBlockHash) && rewind === undefined) throw ingestionError("REPUTATION_CHECKPOINT_CONFLICT", "A finalized reputation block cannot change its hash without a verified rewind.", "reconcile_reputation", { existing, input: normalized });
    this.reputationCheckpoints.set(key, normalized);
    return normalized;
  }

  async getCheckpoint(chainId: number, identityRegistry: string): Promise<ChainCheckpoint | null> {
    return this.checkpoints.get(checkpointKey(chainId, identityRegistry)) ?? null;
  }

  async saveCheckpoint(input: ChainCheckpoint, condition: CheckpointWriteCondition): Promise<ChainCheckpoint> {
    const normalized = normalizeRegistryCheckpoint(input);
    const key = checkpointKey(normalized.chainId, normalized.identityRegistry);
    const existing = this.checkpoints.get(key);
    if (existing === undefined) {
      if (condition.expectedCursorVersion !== null || condition.expectedLastScannedBlockHash !== null) {
        throw checkpointConflict("The checkpoint create condition does not match an empty cursor.", { condition, input: normalized });
      }
      if (normalized.cursorVersion < 1) {
        throw checkpointConflict("The initial ingestion checkpoint version is invalid.", { input: normalized });
      }
      this.checkpoints.set(key, normalized);
      return normalized;
    }

    if (
      condition.expectedCursorVersion !== existing.cursorVersion ||
      !sameNullableHash(condition.expectedLastScannedBlockHash, existing.lastScannedBlockHash)
    ) {
      throw checkpointConflict("The ingestion checkpoint changed before this update completed.", { existing, input: normalized, condition });
    }
    if (normalized.indexerVersion === existing.indexerVersion && normalized.confirmationThreshold !== existing.confirmationThreshold) {
      throw checkpointConflict("The confirmation threshold is immutable for an indexer version.", {
        existing,
        input: normalized,
        reason: "confirmation_threshold_changed"
      });
    }
    if (normalized.cursorVersion !== existing.cursorVersion + 1) {
      throw checkpointConflict("The ingestion checkpoint cursor must advance exactly once.", { existing, input: normalized });
    }
    const continuityBlock = condition.previousScannedBlock;
    const continuityHash = condition.previousScannedBlockHash;
    if (
      normalized.lastScannedBlock > existing.lastScannedBlock &&
      (continuityBlock !== existing.lastScannedBlock ||
        !sameNullableHash(continuityHash ?? null, existing.lastScannedBlockHash))
    ) {
      throw checkpointConflict("The checkpoint predecessor does not match the persisted scan cursor.", { existing, input: normalized, condition });
    }

    const rewind = condition.verifiedRewind;
    const lowersScanned = normalized.lastScannedBlock < existing.lastScannedBlock;
    const lowersFinality = normalized.lastFinalizedBlock < existing.lastFinalizedBlock;
    if (lowersScanned || lowersFinality) {
      if (
        rewind === undefined ||
        rewind.previousScannedBlock !== existing.lastScannedBlock ||
        !sameNullableHash(rewind.previousScannedBlockHash, existing.lastScannedBlockHash) ||
        rewind.commonAncestorBlock !== normalized.lastScannedBlock ||
        !sameNullableHash(rewind.commonAncestorHash, normalized.lastScannedBlockHash)
      ) {
        throw checkpointConflict("The checkpoint would move backwards without an explicit verified rewind.", {
          existing,
          input: normalized,
          condition
        });
      }
    } else if (
      normalized.lastScannedBlock === existing.lastScannedBlock &&
      !sameNullableHash(normalized.lastScannedBlockHash, existing.lastScannedBlockHash)
    ) {
      throw checkpointConflict("A checkpoint block cannot change its hash without a verified rewind.", { existing, input: normalized });
    }
    if (
      normalized.lastFinalizedBlock === existing.lastFinalizedBlock &&
      !sameNullableHash(normalized.lastFinalizedBlockHash, existing.lastFinalizedBlockHash) &&
      rewind === undefined
    ) {
      throw checkpointConflict("A finalized block cannot change its hash without a verified rewind.", { existing, input: normalized });
    }
    this.checkpoints.set(key, normalized);
    return normalized;
  }

  async getScanDiscoveryCheckpoint(scope: string): Promise<ScanDiscoveryCheckpoint | null> {
    return this.scanCheckpoints.get(scanCheckpointKey(scope)) ?? null;
  }

  async saveScanDiscoveryCheckpoint(
    input: ScanDiscoveryCheckpoint,
    condition: ScanDiscoveryCheckpointWriteCondition
  ): Promise<ScanDiscoveryCheckpoint> {
    const normalizedScope = scanCheckpointKey(input.scope);
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
      throw scanCheckpointConflict("The 8004scan checkpoint shape is invalid.", { input });
    }
    const key = normalizedScope;
    const existing = this.scanCheckpoints.get(key);
    if (existing === undefined) {
      if (
        condition.expectedCursorVersion !== null ||
        condition.expectedQueryDigest !== input.queryDigest ||
        condition.expectedInitialOffset !== input.initialOffset ||
        condition.expectedInitialCursor !== input.initialCursor
      ) {
        throw scanCheckpointConflict("The scan checkpoint create condition does not match an empty cursor.", {
          condition,
          input
        });
      }
      if (input.cursorVersion !== 1) {
        throw scanCheckpointConflict("The initial scan checkpoint version is invalid.", { input });
      }
      this.scanCheckpoints.set(key, input);
      return input;
    }
    if (
      condition.expectedCursorVersion !== existing.cursorVersion ||
      condition.expectedQueryDigest !== existing.queryDigest ||
      condition.expectedInitialOffset !== existing.initialOffset ||
      condition.expectedInitialCursor !== existing.initialCursor
    ) {
      throw scanCheckpointConflict("The 8004scan checkpoint changed before this page completed.", {
        existing,
        input,
        condition
      });
    }
    if (input.cursorVersion !== existing.cursorVersion + 1) {
      throw scanCheckpointConflict("The 8004scan checkpoint cursor must advance exactly once.", { existing, input });
    }
    if (existing.completedAt !== null) {
      throw scanCheckpointConflict("A completed 8004scan checkpoint cannot be advanced.", { existing, input });
    }
    if (input.scope !== existing.scope || input.queryDigest !== existing.queryDigest) {
      throw scanCheckpointConflict("The 8004scan checkpoint query scope is immutable.", { existing, input });
    }
    if (input.initialOffset !== existing.initialOffset || input.initialCursor !== existing.initialCursor) {
      throw scanCheckpointConflict("The 8004scan checkpoint start position is immutable.", { existing, input });
    }
    if (input.pageSize !== existing.pageSize) {
      throw scanCheckpointConflict("The 8004scan checkpoint page size is immutable.", { existing, input });
    }
    if (input.pagesProcessed !== existing.pagesProcessed + 1 || input.candidatesProcessed < existing.candidatesProcessed) {
      throw scanCheckpointConflict("The 8004scan checkpoint counters must advance monotonically.", { existing, input });
    }
    if (existing.total !== null && input.total !== null && input.total !== existing.total) {
      throw scanCheckpointConflict("The 8004scan total changed within one query stream.", { existing, input });
    }
    if (
      (existing.nextOffset !== null && input.nextCursor !== null) ||
      (existing.nextCursor !== null && input.nextOffset !== null)
    ) {
      throw scanCheckpointConflict("The 8004scan pagination mode changed within one query stream.", { existing, input });
    }
    if (existing.nextOffset !== null && input.nextOffset !== null && input.nextOffset <= existing.nextOffset) {
      throw scanCheckpointConflict("The 8004scan offset must advance monotonically.", { existing, input });
    }
    if (existing.nextCursor !== null && input.nextCursor !== null && input.nextCursor === existing.nextCursor) {
      throw scanCheckpointConflict("The 8004scan cursor must advance monotonically.", { existing, input });
    }
    this.scanCheckpoints.set(key, input);
    return input;
  }

  async withScanDiscoveryRunLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const key = scanCheckpointKey(scope);
    if (this.activeScanScopes.has(key)) {
      throw ingestionError(
        "SCAN_JOB_ALREADY_RUNNING",
        "An 8004scan discovery run is already active for this scope.",
        "wait_for_scan_run",
        undefined,
        true
      );
    }
    this.activeScanScopes.add(key);
    try {
      return await work();
    } finally {
      this.activeScanScopes.delete(key);
    }
  }

  async getClaim(identityKey: IdentityKey): Promise<ClaimRecord | null> {
    return this.claims.get(identityKey) ?? null;
  }

  async mutateClaim(input: ClaimMutation): Promise<ClaimRecord> {
    const existing = this.claims.get(input.identityKey) ?? null;
    if (
      (existing === null && input.expectedVersion !== null) ||
      (existing !== null &&
        (input.expectedVersion !== existing.version || input.expectedStatus !== existing.status)) ||
      (existing === null && input.expectedStatus !== null)
    ) {
      throw ingestionError(
        "CLAIM_CONFLICT",
        "The claim changed before this operation completed.",
        "reload_claim",
        { existing, expectedVersion: input.expectedVersion, expectedStatus: input.expectedStatus }
      );
    }
    if (
      input.claim.identityKey !== input.identityKey ||
      input.event.identityKey !== input.identityKey ||
      input.claim.version !== (existing?.version ?? 0) + 1 ||
      input.event.actorId.trim().length === 0 ||
      input.event.actorType !== input.actor.type
    ) {
      throw ingestionError("CLAIM_CONFLICT", "The claim mutation is internally inconsistent.", "reload_claim");
    }
    if (existing !== null && existing.status !== input.claim.status) {
      try {
        assertStateTransition("claimStatus", existing.status, input.claim.status);
      } catch (cause) {
        throw ingestionError("CLAIM_CONFLICT", "The claim status transition is not allowed.", "reload_claim", cause);
      }
    }
    if (
      (input.claim.status === "claimed" && input.event.eventType !== "claimed") ||
      (input.claim.status === "stale" && !["stale", "revoked"].includes(input.event.eventType))
    ) {
      throw ingestionError("CLAIM_CONFLICT", "The claim event does not describe the next claim state.", "reload_claim");
    }
    const identity = [...this.identities.entries()].find(([key]) => key === input.identityKey)?.[1];
    if (identity === undefined) {
      throw ingestionError("CLAIM_NOT_ACTIVE", "The identity is not in the ingestion index.", "import_identity");
    }
    const canonicalOwner = identity.ownerAddress;
    const expectedOwner = input.expectedOwnerAddress === null
      ? null
      : normalizeEvmAddress(input.expectedOwnerAddress);
    if (expectedOwner !== canonicalOwner) {
      throw ingestionError(
        "CLAIM_OWNER_MISMATCH",
        "The claim owner expectation does not match the canonical identity owner.",
        "reload_identity"
      );
    }
    const actualCanonicalRead = identityRecordReadReference(identity);
    if (
      actualCanonicalRead === null ||
      actualCanonicalRead.observedBlock !== input.expectedCanonicalRead.observedBlock ||
      actualCanonicalRead.observedBlockHash !== input.expectedCanonicalRead.observedBlockHash.toLowerCase() ||
      actualCanonicalRead.readConsistency !== input.expectedCanonicalRead.readConsistency
    ) {
      throw ingestionError(
        "CLAIM_CONFLICT",
        "The canonical identity read changed before the claim mutation completed.",
        "reload_identity"
      );
    }
    if (input.actor.type === "owner") {
      if (
        canonicalOwner === null ||
        normalizeEvmAddress(input.actor.walletAddress) !== canonicalOwner ||
        input.claim.claimantAddress !== canonicalOwner ||
        input.claim.ownerAddressAtVerification !== canonicalOwner ||
        input.event.proofDigest !== input.actor.proofDigest ||
        input.event.actorId !== canonicalOwner
      ) {
        throw ingestionError("CLAIM_OWNER_MISMATCH", "The owner claim actor does not match the canonical identity owner.", "reload_identity");
      }
    } else if (input.event.actorId !== input.actor.operatorId || input.actor.operatorId.trim().length === 0) {
      throw ingestionError("CLAIM_CONFLICT", "The operator claim actor is invalid.", "authenticate_operator");
    } else if (
      (input.event.eventType === "revoked" && input.actor.scope !== "identity.claim.revoke") ||
      (input.event.eventType !== "revoked" && input.actor.scope !== "identity.claim.reconcile")
    ) {
      throw ingestionError("CLAIM_CONFLICT", "The operator scope does not authorize this claim event.", "authenticate_operator");
    }
    const nextState = { ...identity.state, claimStatus: input.claim.status };
    this.claims.set(input.identityKey, input.claim);
    this.identities.set(input.identityKey, {
      ...identity,
      state: nextState,
      ownerClaimVerifiedAt: input.claim.verifiedAt,
      updatedAt: new Date()
    });
    const events = this.claimEvents.get(input.identityKey) ?? [];
    events.push(input.event);
    this.claimEvents.set(input.identityKey, events);
    return input.claim;
  }

  async listClaimEvents(identityKey: IdentityKey): Promise<readonly ClaimEvent[]> {
    return [...(this.claimEvents.get(identityKey) ?? [])];
  }

  async upsertService(input: ServiceObservation): Promise<ServiceObservation> {
    const key = serviceKey(input.identityKey, input.kind, input.url);
    const existing = this.services.get(key);
    const record = existing === undefined ? input : { ...existing, ...input };
    this.services.set(key, record);
    return record;
  }

  async listServices(identityKey: IdentityKey): Promise<readonly ServiceObservation[]> {
    return [...this.services.values()]
      .filter((service) => service.identityKey === identityKey)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
  }

  async upsertCapabilities(input: CapabilityObservation): Promise<CapabilityObservation> {
    const key = `${input.identityKey}:${input.schemaVersion}:${input.manifestDigest}`;
    const existing = this.capabilities.get(key);
    if (existing !== undefined) {
      return existing;
    }
    this.capabilities.set(key, input);
    return input;
  }

  async listCapabilities(identityKey: IdentityKey): Promise<readonly CapabilityObservation[]> {
    return [...this.capabilities.values()]
      .filter((capability) => capability.identityKey === identityKey)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }

  async appendProbeResult(input: ServiceProbeRecord): Promise<void> {
    this.probeResults.push(input);
  }

  async listProbeResults(identityKey: IdentityKey): Promise<readonly ServiceProbeRecord[]> {
    return this.probeResults
      .filter((result) => result.identityKey === identityKey)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }

  async appendReconciliation(input: ReconciliationRecord): Promise<void> {
    this.reconciliations.push(input);
  }

  async listReconciliations(chainId: number, identityRegistry: string): Promise<readonly ReconciliationRecord[]> {
    const registry = normalizeEvmAddress(identityRegistry);
    return this.reconciliations.filter(
      (record) => record.chainId === chainId && record.identityRegistry === registry
    );
  }

  /** Test helper for assertions that no orphan observation is visible. */
  async listVisibleCanonicalObservations(
    chainId: number,
    identityRegistry: string
  ): Promise<readonly ChainObservation[]> {
    return this.listObservations({ chainId, identityRegistry, state: "canonical" });
  }
}

function sameNullableHash(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase();
}

function checkpointConflict(message: string, details: unknown): ReturnType<typeof ingestionError> {
  return ingestionError("CHECKPOINT_CONFLICT", message, "reconcile_chain", details);
}

function scanCheckpointConflict(message: string, details: unknown): ReturnType<typeof ingestionError> {
  return ingestionError("SCAN_JOB_CHECKPOINT_CONFLICT", message, "reload_scan_checkpoint", details);
}

function normalizeNullableAddress(value: string | null): string | null {
  return value === null ? null : normalizeEvmAddress(value);
}
