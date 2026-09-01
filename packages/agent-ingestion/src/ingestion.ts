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
import { normalizeRegistryCheckpoint, type RegistryChainReader } from "./adapters/registry.js";
import type {
  ChainCheckpoint,
  ChainObservation,
  ClaimRecord,
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
    private readonly options: { readonly now?: () => Date } = {}
  ) {}

  async ingestCandidate(input: IdentityCandidate): Promise<CandidateIngestionResult> {
    const candidate = normalizeCandidate(input);
    const identityKey = erc8004IdentityKey(candidate.identity);
    const identity = await this.repository.upsertIdentity({
      identity: candidate.identity,
      originType: originForSource(candidate.source)
    });
    await this.repository.recordSource({
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
        await this.repository.upsertCapabilities(capability);
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
      await this.repository.upsertService(service);
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
    return this.repository.withTransaction(async () => {
      const results: CandidateIngestionResult[] = [];
      for (const input of inputs) {
        results.push(await this.ingestCandidate(input));
      }
      return results;
    });
  }

  async ingestRegistryEvents(
    inputs: readonly RegistryEvent[],
    expected: { readonly chainId: number; readonly identityRegistry: string },
    normalizedIngestionVersion = "registry-event-v1"
  ): Promise<RegistryIngestionResult> {
    const registry = normalizeEvmAddress(expected.identityRegistry);
    const observations: ChainObservation[] = [];
    let duplicateCount = 0;
    await this.repository.withTransaction(async () => {
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
        const previous = await this.repository.findObservation(
          observation.transactionHash,
          observation.logIndex
        );
        const stored = await this.repository.appendObservation(observation);
        if (previous !== null) {
          duplicateCount += 1;
        }
        await this.repository.upsertIdentity({
          identity: observation.identity,
          originType: "discovered"
        });
        await this.repository.recordSource({
          identityKey: observation.identityKey,
          source: "registry_event",
          sourceReference: registrySourceReference(observation),
          observedAt: observation.firstObservedAt,
          rawResponseDigest: observation.payloadDigest,
          normalizedIngestionVersion
        });
        observations.push(stored);
      }
    });
    return { observations, duplicateCount };
  }

  async canonicalizeThrough(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly throughBlock: number;
    readonly finalizedBlockHash: string;
    readonly canonicalizedAt?: Date;
  }): Promise<readonly ChainObservation[]> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    if (
      !Number.isSafeInteger(input.throughBlock) ||
      input.throughBlock < 0 ||
      !/^0x[0-9a-fA-F]{64}$/u.test(input.finalizedBlockHash)
    ) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The finality block is invalid.", "fix_finality");
    }
    const promoted = await this.repository.markCanonical({
      chainId: input.chainId,
      identityRegistry: registry,
      throughBlock: input.throughBlock,
      canonicalizedAt: input.canonicalizedAt ?? this.now()
    });
    for (const observation of promoted) {
      const previous = await this.repository.findIdentity(observation.identity);
      const previousState = previous ?? {
        ownerAddress: null,
        agentWallet: null,
        agentUri: null,
        contentDigest: null
      };
      const record = await this.repository.applyCanonicalState({
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
          record,
          "owner_transfer",
          "Canonical registry ownership changed; prior claim is stale."
        );
      }
    }
    return promoted;
  }

  async syncRegistry(reader: RegistryChainReader, options: RegistrySyncOptions): Promise<RegistrySyncResult> {
    const registry = normalizeEvmAddress(options.identityRegistry);
    const now = options.now ?? this.options.now ?? (() => new Date());
    if (!Number.isSafeInteger(options.confirmationThreshold) || options.confirmationThreshold < 0) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The confirmation threshold is invalid.", "fix_finality");
    }
    const latestBlock = await reader.getLatestBlock();
    if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The chain head is invalid.", "retry_chain_read");
    }
    const finalizedBlock = Math.max(0, latestBlock - options.confirmationThreshold);
    let checkpoint = await this.repository.getCheckpoint(options.chainId, registry);
    let reorgRewound = false;
    let orphanedObservationCount = 0;
    const affectedIdentityKeys = new Set<IdentityKey>();

    if (checkpoint !== null && checkpoint.lastScannedBlock > 0) {
      const currentHash = await reader.getBlockHash(checkpoint.lastScannedBlock);
      if (currentHash === null || currentHash.toLowerCase() !== checkpoint.lastScannedBlockHash.toLowerCase()) {
        const reorg = await this.rewindAndReconcile(reader, checkpoint, now);
        reorgRewound = true;
        orphanedObservationCount = reorg.orphanedObservationCount;
        for (const key of reorg.affectedIdentityKeys) {
          affectedIdentityKeys.add(key);
        }
        checkpoint = reorg.checkpoint;
      }
    }

    const fromBlock = checkpoint === null
      ? options.startBlock
      : Math.max(options.startBlock, checkpoint.lastScannedBlock + 1);
    let insertedObservationCount = 0;
    let promotedObservationCount = 0;
    let scannedFromBlock: number | null = null;
    let scannedThrough: number | null = null;
    if (fromBlock <= latestBlock) {
      scannedFromBlock = fromBlock;
      scannedThrough = latestBlock;
      const events = await reader.getRegistryEvents({
        chainId: options.chainId,
        identityRegistry: registry,
        fromBlock,
        toBlock: latestBlock
      });
      if (events.some((event) => event.blockNumber < fromBlock || event.blockNumber > latestBlock)) {
        throw ingestionError(
          "INGESTION_INPUT_INVALID",
          "The registry provider returned an event outside the requested block range.",
          "review_chain_provider"
        );
      }
      const ingested = await this.ingestRegistryEvents(events, {
        chainId: options.chainId,
        identityRegistry: registry
      }, options.normalizedIngestionVersion);
      insertedObservationCount = ingested.observations.length - ingested.duplicateCount;
      for (const observation of ingested.observations) {
        affectedIdentityKeys.add(observation.identityKey);
      }
      const scannedHash = await reader.getBlockHash(latestBlock);
      const finalizedHash = await reader.getBlockHash(finalizedBlock);
      if (scannedHash === null || finalizedHash === null) {
        throw ingestionError(
          "REORG_RECONCILIATION_REQUIRED",
          "The chain provider did not return block hashes required for a safe checkpoint.",
          "retry_chain_read",
          undefined,
          true
        );
      }
      checkpoint = normalizeRegistryCheckpoint({
        chainId: options.chainId,
        identityRegistry: registry,
        lastScannedBlock: latestBlock,
        lastScannedBlockHash: scannedHash,
        lastFinalizedBlock: finalizedBlock,
        lastFinalizedBlockHash: finalizedHash,
        confirmationThreshold: options.confirmationThreshold,
        cursorVersion: (checkpoint?.cursorVersion ?? 0) + 1,
        lastReconciliationAt: checkpoint?.lastReconciliationAt ?? null
      });
      await this.repository.saveCheckpoint(checkpoint);
      const promoted = await this.canonicalizeThrough({
        chainId: options.chainId,
        identityRegistry: registry,
        throughBlock: finalizedBlock,
        finalizedBlockHash: finalizedHash,
        canonicalizedAt: now()
      });
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
    const previous = await this.repository.findIdentity(normalizedIdentity);
    const record = await this.repository.applyCanonicalState({ identity: normalizedIdentity, ...current });
    if (
      previous !== null &&
      previous.state.claimStatus === "claimed" &&
      previous.ownerAddress !== record.ownerAddress
    ) {
      await this.markClaimStale(record, "reconciliation", reason);
    }
    return record;
  }

  private async rewindAndReconcile(
    reader: RegistryChainReader,
    checkpoint: ChainCheckpoint,
    now: () => Date
  ): Promise<{
    readonly checkpoint: ChainCheckpoint;
    readonly orphanedObservationCount: number;
    readonly affectedIdentityKeys: readonly IdentityKey[];
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
    const ancestorHash = await reader.getBlockHash(commonAncestor);
    if (ancestorHash === null) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The common ancestor block hash is unavailable.",
        "retry_chain_read",
        undefined,
        true
      );
    }
    const affectedIdentityKeys = await this.repository.markOrphaned({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      fromBlock: commonAncestor + 1,
      occurredAt: startedAt
    });
    const affectedSet = new Set(affectedIdentityKeys);
    for (const identityKey of affectedIdentityKeys) {
      const record = (await this.repository.listIdentities()).find(
        (candidate) => erc8004IdentityKey(candidate.identity) === identityKey
      );
      if (record === undefined) {
        continue;
      }
      const current = await reader.readIdentity(record.identity);
      const previousOwner = record.ownerAddress;
      const reconciled = await this.repository.applyCanonicalState({ identity: record.identity, ...current });
      if (previousOwner !== reconciled.ownerAddress && record.state.claimStatus === "claimed") {
        await this.markClaimStale(reconciled, "reconciliation", "Canonical state was reread after a reorg.");
      }
    }
    const nextCheckpoint: ChainCheckpoint = {
      ...checkpoint,
      lastScannedBlock: commonAncestor,
      lastScannedBlockHash: ancestorHash.toLowerCase(),
      lastFinalizedBlock: Math.min(checkpoint.lastFinalizedBlock, commonAncestor),
      lastFinalizedBlockHash:
        checkpoint.lastFinalizedBlock <= commonAncestor
          ? checkpoint.lastFinalizedBlockHash
          : ancestorHash.toLowerCase(),
      cursorVersion: checkpoint.cursorVersion + 1,
      lastReconciliationAt: startedAt
    };
    await this.repository.saveCheckpoint(nextCheckpoint);
    const finishedAt = now();
    await this.repository.appendReconciliation({
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
    const observations = await this.repository.listObservations({
      chainId: checkpoint.chainId,
      identityRegistry: checkpoint.identityRegistry,
      fromBlock: commonAncestor + 1
    });
    return {
      checkpoint: nextCheckpoint,
      orphanedObservationCount: observations.filter((observation) => observation.confirmationState === "orphaned").length,
      affectedIdentityKeys: [...affectedSet].sort()
    };
  }

  private async markClaimStale(
    identity: IdentityRecord,
    reason: ClaimRecord["lastReason"],
    message: string
  ): Promise<void> {
    const existing = await this.repository.getClaim(erc8004IdentityKey(identity.identity));
    if (existing === null || existing.status !== "claimed") {
      return;
    }
    assertStateTransition("claimStatus", existing.status, "stale");
    const staleAt = this.now();
    await this.repository.saveClaim({
      ...existing,
      status: "stale",
      staleAt,
      lastReason: reason
    });
    await this.repository.appendClaimEvent({
      identityKey: erc8004IdentityKey(identity.identity),
      eventType: reason === "revoked" ? "revoked" : "stale",
      claimantAddress: existing.claimantAddress,
      observedOwnerAddress: identity.ownerAddress,
      observedAgentWallet: identity.agentWallet,
      proofDigest: null,
      reason: message,
      occurredAt: staleAt
    });
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
