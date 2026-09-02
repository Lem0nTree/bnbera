import {
  assertStateTransition,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type OriginType
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import {
  normalizeCandidate,
  normalizeCapabilityManifest,
  normalizeRegistryEvent,
  normalizeServices,
  registryEventToObservation
} from "./normalize.js";
import {
  normalizeRegistryCheckpoint,
  normalizeRegistryEvents,
  normalizeChainBlockTag,
  type ChainBlockTag,
  type TrustedBlockHashReader,
  type RegistryChainReader
} from "./adapters/registry.js";
import type {
  ChainCheckpoint,
  ChainObservation,
  ClaimRecord,
  ClaimMutationActor,
  IdentityCandidate,
  IdentityKey,
  IdentityRecord,
  IngestionRepository,
  RegistryEvent,
  ServiceObservation
} from "./types.js";

function originForSource(source: IdentityCandidate["source"]): OriginType {
  switch (source) {
    case "manual":
      return "manual_import";
    case "creator":
      return "created";
    case "8004scan":
    case "registry_event":
      return "discovered";
  }
}

function registrySourceReference(observation: ChainObservation): string {
  return `${observation.transactionHash}:${observation.logIndex}`;
}

export type CandidateIngestionResult = {
  readonly identity: IdentityRecord;
  readonly identityKey: IdentityKey;
  readonly sourceRecorded: boolean;
  readonly services: readonly ServiceObservation[];
  readonly rejectedServices: readonly { readonly input: unknown; readonly reason: string }[];
  readonly capabilityDigest: string | null;
  readonly capabilityError: string | null;
};

export type RegistryIngestionResult = {
  readonly observations: readonly ChainObservation[];
  readonly duplicateCount: number;
};

export type RegistrySyncResult = {
  readonly scannedFromBlock: number | null;
  readonly scannedThroughBlock: number | null;
  readonly insertedObservationCount: number;
  readonly promotedObservationCount: number;
  readonly orphanedObservationCount: number;
  readonly affectedIdentityKeys: readonly IdentityKey[];
  readonly reorgRewound: boolean;
  readonly checkpoint: ChainCheckpoint | null;
};

export type RegistrySyncOptions = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly startBlock: number;
  readonly confirmationThreshold: number;
  /** Changing this value is an explicit cursor/configuration migration. */
  readonly indexerVersion?: string;
  readonly normalizedIngestionVersion?: string;
  readonly now?: () => Date;
};

/**
 * Coordinates the four supported supply paths without making publication or
 * verification side effects. The repository boundary is async so the same
 * orchestration can be backed by Drizzle in the application layer.
 */
export class AgentIngestionService {
  public constructor(
    private readonly repository: IngestionRepository,
    private readonly options: {
      readonly now?: () => Date;
      /** Trusted internal principal for automatic stale/reorg transitions. */
      readonly internalOperatorId?: string;
    } = {}
  ) {}

  async ingestCandidate(input: IdentityCandidate): Promise<CandidateIngestionResult> {
    return this.ingestCandidateInTransaction(this.repository, input);
  }

  private async ingestCandidateInTransaction(
    repository: IngestionRepository,
    input: IdentityCandidate
  ): Promise<CandidateIngestionResult> {
    const candidate = normalizeCandidate(input);
    const identityKey = erc8004IdentityKey(candidate.identity);
    const identity = await repository.upsertIdentity({
      identity: candidate.identity,
      originType: originForSource(candidate.source)
    });
    await repository.recordSource({
      identityKey,
      source: candidate.source,
      sourceReference: candidate.sourceReference,
      observedAt: candidate.observedAt,
      rawResponseDigest: candidate.rawResponseDigest ?? null,
      normalizedIngestionVersion: candidate.normalizedIngestionVersion
    });

    let capabilityDigest: string | null = null;
    let capabilityError: string | null = null;
    if (candidate.capabilityManifest !== undefined) {
      try {
        const capability = normalizeCapabilityManifest(
          identityKey,
          candidate.source,
          candidate.capabilityManifest,
          candidate.observedAt
        );
        capabilityDigest = capability.manifestDigest;
        await repository.upsertCapabilities(capability);
      } catch (error) {
        capabilityError = error instanceof Error ? error.message : "invalid capability manifest";
      }
    }

    const servicesResult = normalizeServices(
      identityKey,
      candidate.source,
      candidate.services ?? [],
      capabilityDigest,
      candidate.observedAt
    );
    for (const service of servicesResult.accepted) {
      await repository.upsertService(service);
    }

    return {
      identity,
      identityKey,
      sourceRecorded: true,
      services: servicesResult.accepted,
      rejectedServices: servicesResult.rejected,
      capabilityDigest,
      capabilityError
    };
  }

  async ingestCandidates(inputs: readonly IdentityCandidate[]): Promise<readonly CandidateIngestionResult[]> {
    return this.repository.withTransaction(async (unitOfWork) => {
      const results: CandidateIngestionResult[] = [];
      for (const input of inputs) {
        results.push(await this.ingestCandidateInTransaction(unitOfWork, input));
      }
      return results;
    });
  }

  async ingestRegistryEvents(
    inputs: readonly RegistryEvent[],
    expected: { readonly chainId: number; readonly identityRegistry: string },
    normalizedIngestionVersion = "registry-event-v1"
  ): Promise<RegistryIngestionResult> {
    return this.repository.withTransaction((unitOfWork) =>
      this.ingestRegistryEventsInTransaction(unitOfWork, inputs, expected, normalizedIngestionVersion)
    );
  }

  private async ingestRegistryEventsInTransaction(
    repository: IngestionRepository,
    inputs: readonly RegistryEvent[],
    expected: { readonly chainId: number; readonly identityRegistry: string },
    normalizedIngestionVersion: string
  ): Promise<RegistryIngestionResult> {
    const registry = normalizeEvmAddress(expected.identityRegistry);
    const observations: ChainObservation[] = [];
    let duplicateCount = 0;
    for (const input of inputs) {
      const normalized = normalizeRegistryEvent(input);
      if (
        normalized.identity.chainId !== expected.chainId ||
        normalized.identity.identityRegistry !== registry
      ) {
        throw ingestionError(
          "IDENTITY_CONFLICT",
          "A registry event belongs to a different configured network.",
          "review_chain_configuration"
        );
      }
      const observation = registryEventToObservation(input);
      const previous = await repository.findObservation(
        observation.transactionHash,
        observation.logIndex
      );
      const stored = await repository.appendObservation(observation);
      if (previous !== null) {
        duplicateCount += 1;
      }
      await repository.upsertIdentity({
        identity: observation.identity,
        originType: "discovered"
      });
      await repository.recordSource({
        identityKey: observation.identityKey,
        source: "registry_event",
        sourceReference: registrySourceReference(observation),
        observedAt: observation.firstObservedAt,
        rawResponseDigest: observation.payloadDigest,
        normalizedIngestionVersion
      });
      observations.push(stored);
    }
    return { observations, duplicateCount };
  }

  async canonicalizeThrough(
    input: {
      readonly chainId: number;
      readonly identityRegistry: string;
      readonly throughBlock: number;
      /** Finality promotion is pinned to this exact trusted block. */
      readonly finalizedBlockTag: ChainBlockTag;
      readonly canonicalizedAt?: Date;
    },
    trustedBlockHashReader: TrustedBlockHashReader
  ): Promise<readonly ChainObservation[]> {
    return this.repository.withTransaction((unitOfWork) =>
      this.canonicalizeThroughInTransaction(unitOfWork, input, trustedBlockHashReader)
    );
  }

  private async canonicalizeThroughInTransaction(
    repository: IngestionRepository,
    input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly throughBlock: number;
    readonly finalizedBlockTag: ChainBlockTag;
    readonly canonicalizedAt?: Date;
    },
    trustedBlockHashReader: TrustedBlockHashReader
  ): Promise<readonly ChainObservation[]> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    const finalizedBlockTag = normalizeChainBlockTag(input.finalizedBlockTag);
    if (
      !Number.isSafeInteger(input.throughBlock) ||
      input.throughBlock < 0 ||
      finalizedBlockTag.blockNumber !== input.throughBlock
    ) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The finality block is invalid.", "fix_finality");
    }
    await this.assertTrustedBlockHash(
      trustedBlockHashReader,
      finalizedBlockTag.blockNumber,
      finalizedBlockTag.blockHash,
      "The finality block hash changed before canonicalization."
    );
    const candidates = await repository.listObservations({
      chainId: input.chainId,
      identityRegistry: registry,
      toBlock: input.throughBlock,
      state: "provisional"
    });
    await this.assertTrustedObservationHashes(trustedBlockHashReader, candidates);
    const promoted = await repository.markCanonical({
      chainId: input.chainId,
      identityRegistry: registry,
      throughBlock: input.throughBlock,
      canonicalizedAt: input.canonicalizedAt ?? this.now()
    });
    for (const observation of promoted) {
      const previous = await repository.findIdentity(observation.identity);
      const previousState = previous ?? {
        ownerAddress: null,
        agentWallet: null,
        agentUri: null,
        contentDigest: null
      };
      const record = await repository.applyCanonicalState({
        identity: observation.identity,
        ownerAddress: observation.observedFields.includes("ownerAddress")
          ? observation.ownerAddress
          : previousState.ownerAddress,
        agentWallet: observation.observedFields.includes("agentWallet")
          ? observation.agentWallet
          : previousState.agentWallet,
        agentUri: observation.observedFields.includes("agentUri")
          ? observation.agentUri
          : previousState.agentUri,
        contentDigest: observation.observedFields.includes("contentDigest")
          ? observation.contentDigest
          : previousState.contentDigest,
        observedBlock: observation.blockNumber
      });
      if (
        previous !== null &&
        previous.ownerAddress !== record.ownerAddress &&
        previous.state.claimStatus === "claimed"
      ) {
        await this.markClaimStale(
          repository,
          record,
          "owner_transfer",
          "Canonical registry ownership changed; prior claim is stale."
        );
      }
    }
    return promoted;
  }

  async syncRegistry(reader: RegistryChainReader, options: RegistrySyncOptions): Promise<RegistrySyncResult> {
    return this.repository.withTransaction((unitOfWork) =>
      this.syncRegistryInTransaction(unitOfWork, reader, options)
    );
  }

  private async syncRegistryInTransaction(
    repository: IngestionRepository,
    reader: RegistryChainReader,
    options: RegistrySyncOptions
  ): Promise<RegistrySyncResult> {
    const registry = normalizeEvmAddress(options.identityRegistry);
    const now = options.now ?? this.options.now ?? (() => new Date());
    if (!Number.isSafeInteger(options.confirmationThreshold) || options.confirmationThreshold < 0) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The confirmation threshold is invalid.", "fix_finality");
    }
    const indexerVersion = normalizeIndexerVersion(options.indexerVersion);
    const latestBlock = await reader.getLatestBlock();
    if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The chain head is invalid.", "retry_chain_read");
    }
    const finalizedBlock = Math.max(0, latestBlock - options.confirmationThreshold);
    let checkpoint = await repository.getCheckpoint(options.chainId, registry);
    const persistedCheckpoint = checkpoint;
    if (
      checkpoint !== null &&
      checkpoint.indexerVersion === indexerVersion &&
      checkpoint.confirmationThreshold !== options.confirmationThreshold
    ) {
      throw ingestionError(
        "CHECKPOINT_CONFLICT",
        "The confirmation threshold is immutable for the configured indexer version.",
        "bump_indexer_version"
      );
    }
    let reorgRewound = false;
    let orphanedObservationCount = 0;
    let verifiedRewind: {
      readonly previousScannedBlock: number;
      readonly previousScannedBlockHash: string;
      readonly commonAncestorBlock: number;
      readonly commonAncestorHash: string;
    } | undefined;
    const affectedIdentityKeys = new Set<IdentityKey>();

    if (checkpoint !== null && checkpoint.lastScannedBlock > 0) {
      const currentHash = await reader.getTrustedBlockHash(checkpoint.lastScannedBlock);
      if (currentHash === null || currentHash.toLowerCase() !== checkpoint.lastScannedBlockHash.toLowerCase()) {
        const reorg = await this.rewindAndReconcile(repository, reader, checkpoint, now);
        reorgRewound = true;
        orphanedObservationCount = reorg.orphanedObservationCount;
        for (const key of reorg.affectedIdentityKeys) {
          affectedIdentityKeys.add(key);
        }
        checkpoint = reorg.checkpoint;
        verifiedRewind = reorg.verifiedRewind;
      }
    }

    const fromBlock = checkpoint === null
      ? options.startBlock
      : Math.max(options.startBlock, checkpoint.lastScannedBlock + 1);
    let insertedObservationCount = 0;
    let promotedObservationCount = 0;
    let scannedFromBlock: number | null = null;
    let scannedThrough: number | null = null;
    let scannedBlock: number | null = checkpoint?.lastScannedBlock ?? null;
    let scannedHashForQuery: string | null = null;
    if (fromBlock <= latestBlock) {
      scannedFromBlock = fromBlock;
      scannedThrough = latestBlock;
      scannedBlock = latestBlock;
      scannedHashForQuery = await reader.getTrustedBlockHash(latestBlock);
      if (scannedHashForQuery === null) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "The chain provider did not return a trusted scan-head hash.",
          "retry_chain_read",
          undefined,
          true
        );
      }
      const events = await reader.getRegistryEvents({
        chainId: options.chainId,
        identityRegistry: registry,
        fromBlock,
        toBlock: latestBlock,
        blockTag: { blockNumber: latestBlock, blockHash: scannedHashForQuery }
      });
      if (events.some((event) => event.blockNumber < fromBlock || event.blockNumber > latestBlock)) {
        throw ingestionError(
          "INGESTION_INPUT_INVALID",
          "The registry provider returned an event outside the requested block range.",
          "review_chain_provider"
        );
      }
      const normalizedEvents = normalizeRegistryEvents(events);
      await this.assertTrustedObservationHashes(reader, normalizedEvents);
      const ingested = await this.ingestRegistryEventsInTransaction(repository, events, {
        chainId: options.chainId,
        identityRegistry: registry
      }, options.normalizedIngestionVersion ?? "registry-event-v1");
      insertedObservationCount = ingested.observations.length - ingested.duplicateCount;
      for (const observation of ingested.observations) {
        affectedIdentityKeys.add(observation.identityKey);
      }
    }

    if (scannedBlock !== null) {
      const finalityBlock = Math.min(finalizedBlock, scannedBlock);
      if (persistedCheckpoint !== null && finalityBlock < persistedCheckpoint.lastFinalizedBlock) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "The computed finality would move backwards; manual review is required.",
          "manual_review_finality"
        );
      }
      const scannedHash = await reader.getTrustedBlockHash(scannedBlock);
      const finalizedHash = await reader.getTrustedBlockHash(finalityBlock);
      if (scannedHash === null || finalizedHash === null) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "The chain provider did not return block hashes required for a safe checkpoint.",
          "retry_chain_read",
          undefined,
          true
        );
      }
      const promoted = await this.canonicalizeThroughInTransaction(repository, {
        chainId: options.chainId,
        identityRegistry: registry,
        throughBlock: finalityBlock,
        finalizedBlockTag: { blockNumber: finalityBlock, blockHash: finalizedHash },
        canonicalizedAt: now()
      }, reader);
      // This is deliberately the final write in the unit of work. If
      // canonicalization or any identity/claim mutation fails, the enclosing
      // transaction rolls back and this checkpoint is never committed.
      const nextCheckpoint = normalizeRegistryCheckpoint({
        chainId: options.chainId,
        identityRegistry: registry,
        lastScannedBlock: scannedBlock,
        lastScannedBlockHash: scannedHash,
        lastFinalizedBlock: finalityBlock,
        lastFinalizedBlockHash: finalizedHash,
        confirmationThreshold: options.confirmationThreshold,
        indexerVersion,
        cursorVersion: (persistedCheckpoint?.cursorVersion ?? 0) + 1,
        lastReconciliationAt: checkpoint?.lastReconciliationAt ?? null
      });
      await repository.saveCheckpoint(nextCheckpoint, {
        expectedCursorVersion: persistedCheckpoint?.cursorVersion ?? null,
        expectedLastScannedBlockHash: persistedCheckpoint?.lastScannedBlockHash ?? null,
        previousScannedBlock: persistedCheckpoint?.lastScannedBlock ?? null,
        previousScannedBlockHash: persistedCheckpoint?.lastScannedBlockHash ?? null,
        ...(verifiedRewind === undefined ? {} : { verifiedRewind })
      });
      checkpoint = nextCheckpoint;
      promotedObservationCount = promoted.length;
      for (const observation of promoted) {
        affectedIdentityKeys.add(observation.identityKey);
      }
    }

    return {
      scannedFromBlock,
      scannedThroughBlock: scannedThrough,
      insertedObservationCount,
      promotedObservationCount,
      orphanedObservationCount,
      affectedIdentityKeys: [...affectedIdentityKeys].sort(),
      reorgRewound,
      checkpoint
    };
  }

  async reconcileIdentity(
    reader: Pick<RegistryChainReader, "readIdentity">,
    identity: IdentityCandidate["identity"],
    reason = "reconciliation"
  ): Promise<IdentityRecord> {
    const normalizedIdentity = normalizeErc8004Identity(identity);
    const current = await reader.readIdentity(normalizedIdentity);
    return this.repository.withTransaction(async (unitOfWork) => {
      const previous = await unitOfWork.findIdentity(normalizedIdentity);
      const record = await unitOfWork.applyCanonicalState({ identity: normalizedIdentity, ...current });
      if (
        previous !== null &&
        previous.state.claimStatus === "claimed" &&
        previous.ownerAddress !== record.ownerAddress
      ) {
        await this.markClaimStale(unitOfWork, record, "reconciliation", reason);
      }
      return record;
    });
  }

  private async rewindAndReconcile(
    repository: IngestionRepository,
    reader: RegistryChainReader,
    checkpoint: ChainCheckpoint,
    now: () => Date
  ): Promise<{
    readonly checkpoint: ChainCheckpoint;
    readonly orphanedObservationCount: number;
    readonly affectedIdentityKeys: readonly IdentityKey[];
    readonly verifiedRewind: {
      readonly previousScannedBlock: number;
      readonly previousScannedBlockHash: string;
      readonly commonAncestorBlock: number;
      readonly commonAncestorHash: string;
    };
  }> {
    const startedAt = now();
    const commonAncestor = await reader.findCommonAncestor({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      lastKnownBlock: checkpoint.lastScannedBlock,
      lastKnownHash: checkpoint.lastScannedBlockHash
    });
    if (!Number.isSafeInteger(commonAncestor) || commonAncestor < 0 || commonAncestor >= checkpoint.lastScannedBlock) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The chain provider did not identify a valid common ancestor.",
        "review_chain_reconciliation"
      );
    }
    if (commonAncestor < checkpoint.lastFinalizedBlock) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The reorganization crosses finalized history and requires manual review.",
        "manual_review_finality"
      );
    }
    const ancestorHash = await reader.getTrustedBlockHash(commonAncestor);
    if (ancestorHash === null) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The common ancestor block hash is unavailable.",
        "retry_chain_read",
        undefined,
        true
      );
    }
    if (
      commonAncestor === checkpoint.lastFinalizedBlock &&
      ancestorHash.toLowerCase() !== checkpoint.lastFinalizedBlockHash.toLowerCase()
    ) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The finalized block hash changed and requires manual review.",
        "manual_review_finality"
      );
    }
    const affectedIdentityKeys = await repository.markOrphaned({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      fromBlock: commonAncestor + 1,
      occurredAt: startedAt
    });
    const affectedSet = new Set(affectedIdentityKeys);
    for (const identityKey of affectedIdentityKeys) {
      const record = (await repository.listIdentities()).find(
        (candidate) => erc8004IdentityKey(candidate.identity) === identityKey
      );
      if (record === undefined) {
        continue;
      }
      const current = await reader.readIdentity(record.identity, {
        blockNumber: commonAncestor,
        blockHash: ancestorHash
      });
      if (current.observedBlock > commonAncestor) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "The identity provider returned head state for an ancestor-tagged replay.",
          "review_chain_provider"
        );
      }
      const previousOwner = record.ownerAddress;
      const reconciled = await repository.applyCanonicalState({ identity: record.identity, ...current });
      if (previousOwner !== reconciled.ownerAddress && record.state.claimStatus === "claimed") {
        await this.markClaimStale(repository, reconciled, "reconciliation", "Canonical state was reread after a reorg.");
      }
    }
    const nextCheckpoint: ChainCheckpoint = {
      ...checkpoint,
      lastScannedBlock: commonAncestor,
      lastScannedBlockHash: ancestorHash.toLowerCase(),
      // A verified reorg is allowed to rewind the scan cursor only after the
      // finalized boundary. Finality itself is never silently lowered.
      lastFinalizedBlock: checkpoint.lastFinalizedBlock,
      lastFinalizedBlockHash: checkpoint.lastFinalizedBlockHash,
      cursorVersion: checkpoint.cursorVersion + 1,
      lastReconciliationAt: startedAt
    };
    const finishedAt = now();
    await repository.appendReconciliation({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      previousScannedBlock: checkpoint.lastScannedBlock,
      commonAncestorBlock: commonAncestor,
      affectedIdentityKeys: [...affectedSet].sort(),
      status: "completed",
      startedAt,
      finishedAt,
      errorCode: null
    });
    const observations = await repository.listObservations({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      fromBlock: commonAncestor + 1
    });
    return {
      checkpoint: nextCheckpoint,
      orphanedObservationCount: observations.filter((observation) => observation.confirmationState === "orphaned").length,
      affectedIdentityKeys: [...affectedSet].sort(),
      verifiedRewind: {
        previousScannedBlock: checkpoint.lastScannedBlock,
        previousScannedBlockHash: checkpoint.lastScannedBlockHash,
        commonAncestorBlock: commonAncestor,
        commonAncestorHash: ancestorHash.toLowerCase()
      }
    };
  }

  private async markClaimStale(
    repository: IngestionRepository,
    identity: IdentityRecord,
    reason: ClaimRecord["lastReason"],
    message: string
  ): Promise<void> {
    const existing = await repository.getClaim(erc8004IdentityKey(identity.identity));
    if (existing === null || existing.status !== "claimed") {
      return;
    }
    assertStateTransition("claimStatus", existing.status, "stale");
    const staleAt = this.now();
    const operator: ClaimMutationActor = {
      type: "operator",
      operatorId: this.options.internalOperatorId?.trim() || "identity-indexer",
      scope: "identity.claim.reconcile"
    };
    await repository.mutateClaim({
      identityKey: erc8004IdentityKey(identity.identity),
      expectedVersion: existing.version,
      expectedStatus: existing.status,
      expectedOwnerAddress: identity.ownerAddress,
      claim: {
        ...existing,
        version: existing.version + 1,
        status: "stale",
        staleAt,
        lastReason: reason
      },
      actor: operator,
      event: {
        identityKey: erc8004IdentityKey(identity.identity),
        eventType: reason === "revoked" ? "revoked" : "stale",
        claimantAddress: existing.claimantAddress,
        observedOwnerAddress: identity.ownerAddress,
        observedAgentWallet: identity.agentWallet,
        proofDigest: null,
        actorType: "operator",
        actorId: operator.operatorId,
        reason: message,
        occurredAt: staleAt
      }
    });
  }

  private async assertTrustedObservationHashes(
    reader: TrustedBlockHashReader,
    observations: readonly ChainObservation[]
  ): Promise<void> {
    const checked = new Map<number, string | null>();
    for (const observation of observations) {
      let trustedHash = checked.get(observation.blockNumber);
      if (trustedHash === undefined && !checked.has(observation.blockNumber)) {
        try {
          trustedHash = await reader.getTrustedBlockHash(observation.blockNumber);
        } catch (cause) {
          throw ingestionError(
            "REORG_RECONCILIATION_REQUIRED",
            "The trusted chain provider could not validate an event block hash.",
            "retry_chain_read",
            cause,
            true
          );
        }
        checked.set(observation.blockNumber, trustedHash);
      }
      if (
        trustedHash === null ||
        trustedHash === undefined ||
        !/^0x[0-9a-fA-F]{64}$/u.test(trustedHash) ||
        trustedHash.toLowerCase() !== observation.blockHash.toLowerCase()
      ) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "A registry event block hash does not match the trusted canonical chain.",
          "reconcile_chain",
          { blockNumber: observation.blockNumber, eventHash: observation.blockHash, trustedHash },
          true
        );
      }
    }
  }

  private async assertTrustedBlockHash(
    reader: TrustedBlockHashReader,
    blockNumber: number,
    expectedHash: string,
    message: string
  ): Promise<void> {
    let trustedHash: string | null;
    try {
      trustedHash = await reader.getTrustedBlockHash(blockNumber);
    } catch (cause) {
      throw ingestionError("REORG_RECONCILIATION_REQUIRED", message, "retry_chain_read", cause, true);
    }
    if (
      trustedHash === null ||
      !/^0x[0-9a-fA-F]{64}$/u.test(trustedHash) ||
      trustedHash.toLowerCase() !== expectedHash.toLowerCase()
    ) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        message,
        "reconcile_chain",
        { blockNumber, expectedHash, trustedHash },
        true
      );
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function normalizeIndexerVersion(value: string | undefined): string {
  const normalized = (value ?? "registry-indexer-v1").trim();
  if (normalized.length === 0 || normalized.length > 64) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The indexer configuration version is invalid.", "fix_indexer_configuration");
  }
  return normalized;
}
