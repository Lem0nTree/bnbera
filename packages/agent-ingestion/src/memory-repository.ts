import { randomUUID } from "node:crypto";
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
import type {
  CapabilityObservation,
  ChainCheckpoint,
  ChainObservation,
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

function sourceKey(identityKey: IdentityKey, source: string, sourceReference: string): string {
  return `${identityKey}:${source}:${sourceReference}`;
}

function serviceKey(identityKey: IdentityKey, kind: string, url: string): string {
  return `${identityKey}:${kind}:${url}`;
}

type RepositorySnapshot = {
  readonly identities: Map<IdentityKey, IdentityRecord>;
  readonly sources: Map<string, DiscoverySourceRecord>;
  readonly observations: Map<string, ChainObservation>;
  readonly checkpoints: Map<string, ChainCheckpoint>;
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
export class InMemoryIngestionRepository implements IngestionRepository {
  private identities = new Map<IdentityKey, IdentityRecord>();
  private sources = new Map<string, DiscoverySourceRecord>();
  private observations = new Map<string, ChainObservation>();
  private checkpoints = new Map<string, ChainCheckpoint>();
  private claims = new Map<IdentityKey, ClaimRecord>();
  private claimEvents = new Map<IdentityKey, ClaimEvent[]>();
  private services = new Map<string, ServiceObservation>();
  private capabilities = new Map<string, CapabilityObservation>();
  private probeResults: ServiceProbeRecord[] = [];
  private reconciliations: ReconciliationRecord[] = [];
  private transactionQueue: Promise<void> = Promise.resolve();

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
      checkpoints: new Map(this.checkpoints),
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
    this.checkpoints = snapshot.checkpoints;
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
      state,
      ownerClaimVerifiedAt: null,
      updatedAt: now
    };
    this.identities.set(key, record);
    return record;
  }

  async applyCanonicalState(input: IdentityCanonicalUpdate): Promise<IdentityRecord> {
    const identity = normalizeErc8004Identity(input.identity);
    const key = erc8004IdentityKey(identity);
    const existing = this.identities.get(key);
    if (existing === undefined) {
      return this.upsertIdentity({
        identity,
        originType: "discovered",
        canonicalState: input
      });
    }

    let state = existing.state;
    const ownerChanged = existing.ownerAddress !== input.ownerAddress;
    if (ownerChanged && state.claimStatus === "claimed") {
      assertStateTransition("claimStatus", state.claimStatus, "stale");
      state = { ...state, claimStatus: "stale" };
    }
    const record: IdentityRecord = {
      ...existing,
      ownerAddress: normalizeNullableAddress(input.ownerAddress),
      agentWallet: normalizeNullableAddress(input.agentWallet),
      agentUri: input.agentUri,
      contentDigest: input.contentDigest,
      observedBlock: input.observedBlock,
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

  async getCheckpoint(chainId: number, identityRegistry: string): Promise<ChainCheckpoint | null> {
    return this.checkpoints.get(checkpointKey(chainId, identityRegistry)) ?? null;
  }

  async saveCheckpoint(input: ChainCheckpoint): Promise<ChainCheckpoint> {
    const key = checkpointKey(input.chainId, input.identityRegistry);
    const existing = this.checkpoints.get(key);
    if (
      existing !== undefined &&
      input.cursorVersion < existing.cursorVersion &&
      input.lastScannedBlock >= existing.lastScannedBlock
    ) {
      throw ingestionError(
        "CHECKPOINT_CONFLICT",
        "The ingestion checkpoint would move backwards without a reorg rewind.",
        "reconcile_chain",
        { existing, input }
      );
    }
    this.checkpoints.set(key, input);
    return input;
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
    if (input.actor.type === "owner") {
      if (
        input.claim.claimantAddress !== normalizeEvmAddress(input.actor.walletAddress) ||
        input.event.proofDigest !== input.actor.proofDigest ||
        input.event.actorId !== normalizeEvmAddress(input.actor.walletAddress)
      ) {
        throw ingestionError("CLAIM_CONFLICT", "The owner claim actor does not match the verified proof.", "reload_claim");
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

function normalizeNullableAddress(value: string | null): string | null {
  return value === null ? null : normalizeEvmAddress(value);
}
