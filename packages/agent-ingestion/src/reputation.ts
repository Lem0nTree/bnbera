import {
  canonicalSha256Hex,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import type {
  IdentityRecord,
  IngestionRepository,
  ReputationCheckpoint,
  ReputationCheckpointWriteCondition,
  ReputationFeedback,
  ReputationFeedbackEvent,
  ReputationEventType
} from "./types.js";

const addressPattern = /^0x[0-9a-f]{40}$/iu;
const hashPattern = /^0x[0-9a-f]{64}$/iu;
const unsignedDecimalPattern = /^(0|[1-9][0-9]*)$/u;
const signedDecimalPattern = /^-?(0|[1-9][0-9]*)$/u;
const maxUint64 = (1n << 64n) - 1n;
const maxInt128 = (1n << 127n) - 1n;
const minInt128 = -(1n << 127n);

function boundedString(value: string | null | undefined, maximum: number, field: string): string {
  const normalized = value ?? "";
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is invalid.`, "review_reputation_event");
  }
  return normalized;
}

function nullableBoundedString(value: string | null | undefined, maximum: number, field: string): string | null {
  if (value === null || value === undefined || value.length === 0) return null;
  return boundedString(value, maximum, field);
}

function decimal(value: string, field: string, maximum: bigint): string {
  if (!unsignedDecimalPattern.test(value)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is not an unsigned decimal.`, "review_reputation_event");
  }
  const parsed = BigInt(value);
  if (parsed > maximum) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} exceeds its protocol bound.`, "review_reputation_event");
  }
  return value;
}

function signedInt128(value: string, field: string): string {
  if (!signedDecimalPattern.test(value)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is not a signed decimal.`, "review_reputation_event");
  }
  const parsed = BigInt(value);
  if (parsed < minInt128 || parsed > maxInt128) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is outside int128 range.`, "review_reputation_event");
  }
  return value;
}

function address(value: string, field: string): string {
  if (!addressPattern.test(value)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is not an EVM address.`, "review_reputation_event");
  }
  return normalizeEvmAddress(value);
}

function hash(value: string, field: string): string {
  if (!hashPattern.test(value)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is not a bytes32 hash.`, "review_reputation_event");
  }
  return value.toLowerCase();
}

function digest(value: string, field: string): string {
  if (!/^[0-9a-f]{64}$/iu.test(value)) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is not a SHA-256 digest.`, "review_reputation_event");
  }
  return value.toLowerCase();
}

function eventType(value: ReputationEventType): ReputationEventType {
  if (value !== "NewFeedback" && value !== "FeedbackRevoked") {
    throw ingestionError("INGESTION_INPUT_INVALID", "The reputation event type is unsupported.", "review_reputation_event");
  }
  return value;
}

function safeDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} timestamp is invalid.`, "review_reputation_event");
  }
  return value;
}

function safeBlock(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The reputation ${field} is invalid.`, "review_reputation_event");
  }
  return value;
}

function safeLogIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The reputation log index is invalid.", "review_reputation_event");
  }
  return value;
}

function normalizeOptionalFeedbackValue(value: string | null | undefined, field: string, signed: boolean): string | null {
  if (value === null || value === undefined) return null;
  return signed ? signedInt128(value, field) : boundedString(value, 256, field);
}

/** Normalize one event before it reaches either the in-memory or PostgreSQL repository. */
export function normalizeReputationFeedbackEvent(input: ReputationFeedbackEvent): ReputationFeedbackEvent {
  const identity = normalizeErc8004Identity(input.identity);
  const normalized: ReputationFeedbackEvent = {
    identity,
    reputationRegistry: address(input.reputationRegistry, "registry"),
    eventType: eventType(input.eventType),
    clientAddress: address(input.clientAddress, "client address"),
    feedbackIndex: decimal(input.feedbackIndex, "feedback index", maxUint64),
    value: normalizeOptionalFeedbackValue(input.value, "value", true),
    valueDecimals: input.valueDecimals,
    indexedTag1: nullableBoundedString(input.indexedTag1, 512, "indexed tag"),
    tag1: nullableBoundedString(input.tag1, 512, "tag1"),
    tag2: nullableBoundedString(input.tag2, 512, "tag2"),
    endpoint: nullableBoundedString(input.endpoint, 2_048, "endpoint"),
    feedbackUri: nullableBoundedString(input.feedbackUri, 2_048, "feedback URI"),
    feedbackHash: input.feedbackHash === null ? null : hash(input.feedbackHash, "feedback hash"),
    transactionHash: hash(input.transactionHash, "transaction hash"),
    logIndex: safeLogIndex(input.logIndex),
    blockNumber: safeBlock(input.blockNumber, "block number"),
    blockHash: hash(input.blockHash, "block hash"),
    confirmationState: input.confirmationState,
    observedAt: safeDate(input.observedAt, "observation"),
    canonicalizedAt: input.canonicalizedAt === null ? null : safeDate(input.canonicalizedAt, "canonicalization"),
    orphanedAt: input.orphanedAt === null ? null : safeDate(input.orphanedAt, "orphan"),
    payloadDigest: digest(input.payloadDigest, "payload digest")
  };
  if (!/^(provisional|canonical|orphaned)$/u.test(normalized.confirmationState)) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The reputation confirmation state is invalid.", "review_reputation_event");
  }
  if (normalized.valueDecimals !== null && (!Number.isSafeInteger(normalized.valueDecimals) || normalized.valueDecimals < 0 || normalized.valueDecimals > 255)) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The reputation value decimals are invalid.", "review_reputation_event");
  }
  if (normalized.eventType === "NewFeedback" && (normalized.value === null || normalized.valueDecimals === null)) {
    throw ingestionError("INGESTION_INPUT_INVALID", "NewFeedback must include its fixed-point value and decimals.", "review_reputation_event");
  }
  if (normalized.eventType === "FeedbackRevoked" && (normalized.value !== null || normalized.valueDecimals !== null)) {
    throw ingestionError("INGESTION_INPUT_INVALID", "FeedbackRevoked must not carry a feedback value.", "review_reputation_event");
  }
  return normalized;
}

/**
 * Build a stable payload digest from normalized public event fields. The raw
 * RPC log is intentionally not persisted or returned to the marketplace.
 */
export function reputationFeedbackPayloadDigest(input: Omit<ReputationFeedbackEvent, "payloadDigest">): string {
  return canonicalSha256Hex({
    identity: input.identity,
    reputationRegistry: input.reputationRegistry,
    eventType: input.eventType,
    clientAddress: input.clientAddress,
    feedbackIndex: input.feedbackIndex,
    value: input.value,
    valueDecimals: input.valueDecimals,
    indexedTag1: input.indexedTag1,
    tag1: input.tag1,
    tag2: input.tag2,
    endpoint: input.endpoint,
    feedbackUri: input.feedbackUri,
    feedbackHash: input.feedbackHash,
    transactionHash: input.transactionHash,
    logIndex: input.logIndex,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash
  });
}

export function normalizeReputationEventWithDigest(input: Omit<ReputationFeedbackEvent, "payloadDigest">): ReputationFeedbackEvent {
  const normalized = normalizeReputationFeedbackEvent({ ...input, payloadDigest: reputationFeedbackPayloadDigest(input) });
  const expected = reputationFeedbackPayloadDigest(normalized);
  return { ...normalized, payloadDigest: expected };
}

export type ReputationSyncResult = {
  readonly scannedFromBlock: number | null;
  readonly scannedThroughBlock: number | null;
  readonly insertedEventCount: number;
  readonly promotedEventCount: number;
  readonly orphanedEventCount: number;
  readonly affectedIdentityKeys: readonly string[];
  readonly reorgRewound: boolean;
  readonly checkpoint: ReputationCheckpoint | null;
};

export function normalizeReputationCheckpoint(input: ReputationCheckpoint): ReputationCheckpoint {
  const identityRegistry = address(input.identityRegistry, "identity registry");
  const reputationRegistry = address(input.reputationRegistry, "reputation registry");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0 || !Number.isSafeInteger(input.confirmationThreshold) || input.confirmationThreshold < 0 || !Number.isSafeInteger(input.cursorVersion) || input.cursorVersion < 1 || input.indexerVersion.trim().length === 0 || input.indexerVersion.length > 64) {
    throw ingestionError("REPUTATION_SYNC_CONFIG_INVALID", "The reputation checkpoint is invalid.", "repair_reputation_checkpoint");
  }
  for (const [field, value] of [["last scanned block", input.lastScannedBlock], ["last finalized block", input.lastFinalizedBlock]] as const) safeBlock(value, field);
  hash(input.lastScannedBlockHash, "last scanned block hash");
  hash(input.lastFinalizedBlockHash, "last finalized block hash");
  if (input.lastFinalizedBlock > input.lastScannedBlock) throw ingestionError("REPUTATION_SYNC_CONFIG_INVALID", "A finalized reputation block cannot exceed the scanned block.", "repair_reputation_checkpoint");
  return { ...input, identityRegistry, reputationRegistry, indexerVersion: input.indexerVersion.trim() };
}

export function projectReputationFeedback(
  events: readonly ReputationFeedbackEvent[],
  identity: Erc8004Identity,
  options: { readonly includeRevoked?: boolean } = {}
): readonly ReputationFeedback[] {
  const normalizedIdentity = normalizeErc8004Identity(identity);
  const scoped = events
    .filter((event) => event.identity.chainId === normalizedIdentity.chainId)
    .filter((event) => erc8004IdentityKey(event.identity) === erc8004IdentityKey(normalizedIdentity))
    .filter((event) => event.confirmationState === "canonical")
    .sort(compareEventPosition);
  const feedback = new Map<string, ReputationFeedbackEvent>();
  const revocations = new Map<string, ReputationFeedbackEvent>();
  for (const event of scoped) {
    const key = `${event.reputationRegistry}:${event.clientAddress}:${event.feedbackIndex}`;
    if (event.eventType === "NewFeedback") feedback.set(key, event);
    else revocations.set(key, event);
  }
  const result: ReputationFeedback[] = [];
  for (const [key, event] of feedback) {
    const revocation = revocations.get(key);
    const revoked = revocation !== undefined && compareEventPosition(revocation, event) > 0;
    if (revoked && options.includeRevoked !== true) continue;
    if (event.value === null || event.valueDecimals === null) continue;
    result.push({
      identity: event.identity,
      reputationRegistry: event.reputationRegistry,
      clientAddress: event.clientAddress,
      feedbackIndex: event.feedbackIndex,
      value: event.value,
      valueDecimals: event.valueDecimals,
      indexedTag1: event.indexedTag1 ?? "",
      tag1: event.tag1 ?? "",
      tag2: event.tag2 ?? "",
      endpoint: event.endpoint ?? "",
      feedbackUri: event.feedbackUri ?? "",
      feedbackHash: event.feedbackHash ?? "",
      feedbackTransactionHash: event.transactionHash,
      feedbackLogIndex: event.logIndex,
      feedbackBlockNumber: event.blockNumber,
      feedbackBlockHash: event.blockHash,
      feedbackObservedAt: event.observedAt,
      revoked,
      revocationTransactionHash: revoked ? revocation?.transactionHash ?? null : null,
      revocationLogIndex: revoked ? revocation?.logIndex ?? null : null,
      revocationBlockNumber: revoked ? revocation?.blockNumber ?? null : null,
      revocationBlockHash: revoked ? revocation?.blockHash ?? null : null,
      revocationObservedAt: revoked ? revocation?.observedAt ?? null : null
    });
  }
  return result.sort((left, right) => left.feedbackBlockNumber - right.feedbackBlockNumber || left.feedbackLogIndex - right.feedbackLogIndex || left.clientAddress.localeCompare(right.clientAddress) || left.feedbackIndex.localeCompare(right.feedbackIndex));
}

export type ReputationChainBlockTag = { readonly blockNumber: number; readonly blockHash: string };

export type ReputationEventQuery = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly reputationRegistry: string;
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly blockTag?: ReputationChainBlockTag;
};

export interface ReputationChainReader {
  getLatestBlock(): Promise<number>;
  getTrustedBlockHash(blockNumber: number): Promise<string | null>;
  getFinalizedBlockTag?(): Promise<ReputationChainBlockTag>;
  getReputationEvents(query: ReputationEventQuery): Promise<readonly ReputationFeedbackEvent[]>;
  findCommonAncestor(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly reputationRegistry: string;
    readonly lastKnownBlock: number;
    readonly lastKnownHash: string;
  }): Promise<number>;
}

export type ReputationSyncOptions = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly reputationRegistry: string;
  readonly startBlock: number;
  readonly confirmationThreshold: number;
  readonly finalityMode?: "rpc-finalized-tag" | "confirmations";
  readonly indexerVersion?: string;
  readonly maxBlockRange?: number;
  readonly maxEvents?: number;
  readonly now?: () => Date;
};

const defaultMaxBlockRange = 100_000;
const defaultMaxEvents = 10_000;

function bounded(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw ingestionError("REPUTATION_SYNC_CONFIG_INVALID", `The reputation ${field} bound is invalid.`, "fix_reputation_sync_configuration");
  return result;
}

function compareEventPosition(left: ReputationFeedbackEvent, right: ReputationFeedbackEvent): number {
  return left.blockNumber - right.blockNumber || left.logIndex - right.logIndex || left.transactionHash.localeCompare(right.transactionHash);
}

/** Bounded, finalized/reorg-aware event sync for one configured reputation registry. */
export class ReputationIngestionService {
  public constructor(private readonly repository: IngestionRepository, private readonly clock: () => Date = () => new Date()) {}

  public async sync(reader: ReputationChainReader, options: ReputationSyncOptions): Promise<ReputationSyncResult> {
    return this.repository.withTransaction((unit) => this.syncInTransaction(unit, reader, options));
  }

  private async syncInTransaction(repository: IngestionRepository, reader: ReputationChainReader, options: ReputationSyncOptions): Promise<ReputationSyncResult> {
    const identityRegistry = address(options.identityRegistry, "identity registry");
    const reputationRegistry = address(options.reputationRegistry, "reputation registry");
    if (!Number.isSafeInteger(options.chainId) || options.chainId <= 0 || !Number.isSafeInteger(options.startBlock) || options.startBlock < 0) throw ingestionError("REPUTATION_SYNC_CONFIG_INVALID", "The reputation sync network or start block is invalid.", "fix_reputation_sync_configuration");
    const finalityMode = options.finalityMode ?? "confirmations";
    if (finalityMode !== "rpc-finalized-tag" && finalityMode !== "confirmations") throw ingestionError("REPUTATION_FINALITY_UNRESOLVED", "The reputation finality mode is unresolved.", "resolve_reputation_finality_lock");
    if (!Number.isSafeInteger(options.confirmationThreshold) || options.confirmationThreshold < 0 || (finalityMode === "rpc-finalized-tag" && options.confirmationThreshold !== 0)) throw ingestionError("REPUTATION_FINALITY_UNRESOLVED", "The reputation confirmation policy is invalid.", "resolve_reputation_finality_lock");
    if (finalityMode === "rpc-finalized-tag" && reader.getFinalizedBlockTag === undefined) throw ingestionError("REPUTATION_FINALITY_UNRESOLVED", "The configured reputation reader cannot prove the finalized RPC tag.", "configure_finalized_reputation_reader");
    const maxBlockRange = bounded(options.maxBlockRange, defaultMaxBlockRange, defaultMaxBlockRange, "block range");
    const maxEvents = bounded(options.maxEvents, defaultMaxEvents, defaultMaxEvents, "event");
    const indexerVersion = options.indexerVersion ?? (finalityMode === "rpc-finalized-tag" ? "reputation-indexer-v1-finalized-tag" : "reputation-indexer-v1");
    const now = options.now ?? this.clock;
    const latestBlock = await reader.getLatestBlock();
    safeBlock(latestBlock, "latest block");
    const finalizedTag = finalityMode === "rpc-finalized-tag" ? await reader.getFinalizedBlockTag!() : null;
    const finalizedBlock = finalizedTag?.blockNumber ?? Math.max(0, latestBlock - options.confirmationThreshold);
    safeBlock(finalizedBlock, "finalized block");
    if (finalizedBlock > latestBlock) throw ingestionError("REPUTATION_FINALITY_UNRESOLVED", "The configured reputation finality tag is ahead of the provider head.", "retry_reputation_read", undefined, true);
    const scanThroughBlock = finalizedTag?.blockNumber ?? latestBlock;
    let checkpoint = await repository.getReputationCheckpoint(options.chainId, identityRegistry, reputationRegistry);
    const persisted = checkpoint;
    let reorgRewound = false;
    let orphanedEventCount = 0;
    let verifiedRewind: ReputationCheckpointWriteCondition["verifiedRewind"];
    const affected = new Set<string>();
    if (checkpoint !== null && checkpoint.lastScannedBlock > 0) {
      const currentHash = await reader.getTrustedBlockHash(checkpoint.lastScannedBlock);
      if (currentHash === null || currentHash.toLowerCase() !== checkpoint.lastScannedBlockHash.toLowerCase()) {
        const commonAncestor = await reader.findCommonAncestor({ chainId: options.chainId, identityRegistry, reputationRegistry, lastKnownBlock: checkpoint.lastScannedBlock, lastKnownHash: checkpoint.lastScannedBlockHash });
        if (!Number.isSafeInteger(commonAncestor) || commonAncestor < checkpoint.lastFinalizedBlock || commonAncestor >= checkpoint.lastScannedBlock) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The reputation reorganization cannot be proven within finalized history.", "manual_review_reputation_reorg");
        const ancestorHash = await reader.getTrustedBlockHash(commonAncestor);
        if (ancestorHash === null) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The reputation common-ancestor hash is unavailable.", "retry_reputation_read", undefined, true);
        const orphanedBefore = (await repository.listReputationEvents({ chainId: options.chainId, identityRegistry, reputationRegistry, fromBlock: commonAncestor + 1, state: "orphaned" })).length;
        await repository.markReputationOrphaned({ chainId: options.chainId, identityRegistry, reputationRegistry, fromBlock: commonAncestor + 1, occurredAt: now() });
        orphanedEventCount = Math.max(0, (await repository.listReputationEvents({ chainId: options.chainId, identityRegistry, reputationRegistry, fromBlock: commonAncestor + 1, state: "orphaned" })).length - orphanedBefore);
        checkpoint = {
          ...checkpoint,
          lastScannedBlock: commonAncestor,
          lastScannedBlockHash: ancestorHash,
          lastFinalizedBlock: Math.min(checkpoint.lastFinalizedBlock, commonAncestor),
          lastFinalizedBlockHash: checkpoint.lastFinalizedBlock <= commonAncestor ? checkpoint.lastFinalizedBlockHash : ancestorHash,
          cursorVersion: checkpoint.cursorVersion + 1,
          lastReconciliationAt: now()
        };
        reorgRewound = true;
        verifiedRewind = { previousScannedBlock: persisted?.lastScannedBlock ?? checkpoint.lastScannedBlock, previousScannedBlockHash: persisted?.lastScannedBlockHash ?? checkpoint.lastScannedBlockHash, commonAncestorBlock: commonAncestor, commonAncestorHash: ancestorHash };
      }
    }
    const fromBlock = checkpoint === null ? options.startBlock : Math.max(options.startBlock, checkpoint.lastScannedBlock + 1);
    let scannedFromBlock: number | null = null;
    let scannedThroughBlock: number | null = null;
    let scannedBlock = checkpoint?.lastScannedBlock ?? null;
    let insertedEventCount = 0;
    if (fromBlock <= scanThroughBlock) {
      if (scanThroughBlock - fromBlock + 1 > maxBlockRange) throw ingestionError("REPUTATION_SYNC_RANGE_EXCEEDED", "The reputation sync range exceeds its bounded read window.", "advance_reputation_checkpoint");
      scannedFromBlock = fromBlock;
      scannedThroughBlock = scanThroughBlock;
      scannedBlock = scanThroughBlock;
      const scannedHash = await reader.getTrustedBlockHash(scanThroughBlock);
      if (scannedHash === null) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The reputation scan-head hash is unavailable.", "retry_reputation_read", undefined, true);
      const events = [...await reader.getReputationEvents({ chainId: options.chainId, identityRegistry, reputationRegistry, fromBlock, toBlock: scanThroughBlock, ...(finalizedTag === null ? {} : { blockTag: finalizedTag }) })].sort(compareEventPosition);
      if (events.length > maxEvents) throw ingestionError("REPUTATION_SYNC_EVENT_LIMIT_EXCEEDED", "The reputation provider returned more events than the bounded sync limit.", "reduce_reputation_range");
      for (const event of events) {
        const { payloadDigest: suppliedPayloadDigest, ...eventWithoutDigest } = event;
        const normalized = normalizeReputationEventWithDigest(eventWithoutDigest);
        if (suppliedPayloadDigest !== normalized.payloadDigest) throw ingestionError("REPUTATION_DUPLICATE_CONFLICT", "The reputation event payload digest is inconsistent.", "reconcile_reputation");
        if (normalized.blockNumber < fromBlock || normalized.blockNumber > scanThroughBlock) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation reader returned an event outside the requested range.", "review_reputation_reader");
        if (normalized.identity.chainId !== options.chainId || normalized.identity.identityRegistry !== identityRegistry || normalized.reputationRegistry !== reputationRegistry) throw ingestionError("IDENTITY_CONFLICT", "A reputation event belongs to a different configured network or registry.", "review_reputation_configuration");
        const existingIdentity = await repository.findIdentity(normalized.identity);
        if (existingIdentity === null) await repository.upsertIdentity({ identity: normalized.identity, originType: "discovered" });
        const before = await repository.listReputationEvents({ chainId: options.chainId, identityRegistry, reputationRegistry, fromBlock: normalized.blockNumber, toBlock: normalized.blockNumber });
        const stored = await repository.appendReputationEvent(normalized);
        if (before.some((candidate) => candidate.transactionHash === normalized.transactionHash && candidate.logIndex === normalized.logIndex)) {
          if (stored.payloadDigest !== normalized.payloadDigest) throw ingestionError("REPUTATION_DUPLICATE_CONFLICT", "A reputation log position was observed with conflicting data.", "reconcile_reputation");
        } else {
          insertedEventCount += 1;
        }
        affected.add(erc8004IdentityKey(normalized.identity));
      }
      const finalityThrough = Math.min(finalizedBlock, scanThroughBlock);
      const finalizedHash = await reader.getTrustedBlockHash(finalityThrough);
      if (finalizedHash === null) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The finalized reputation block hash is unavailable.", "retry_reputation_read", undefined, true);
      const promoted = await repository.markReputationCanonical({ chainId: options.chainId, identityRegistry, reputationRegistry, throughBlock: finalityThrough, canonicalizedAt: now() });
      for (const event of promoted) affected.add(erc8004IdentityKey(event.identity));
      const nextCheckpoint = normalizeReputationCheckpoint({
        chainId: options.chainId,
        identityRegistry,
        reputationRegistry,
        indexerVersion,
        lastScannedBlock: scannedBlock,
        lastScannedBlockHash: scannedHash,
        lastFinalizedBlock: finalityThrough,
        lastFinalizedBlockHash: finalizedHash,
        confirmationThreshold: options.confirmationThreshold,
        cursorVersion: (persisted?.cursorVersion ?? 0) + 1,
        lastReconciliationAt: checkpoint?.lastReconciliationAt ?? null
      });
      await repository.saveReputationCheckpoint(nextCheckpoint, {
        expectedCursorVersion: persisted?.cursorVersion ?? null,
        expectedLastScannedBlockHash: persisted?.lastScannedBlockHash ?? null,
        previousScannedBlock: persisted?.lastScannedBlock ?? null,
        previousScannedBlockHash: persisted?.lastScannedBlockHash ?? null,
        ...(verifiedRewind === undefined ? {} : { verifiedRewind })
      });
      checkpoint = nextCheckpoint;
      return { scannedFromBlock, scannedThroughBlock, insertedEventCount, promotedEventCount: promoted.length, orphanedEventCount, affectedIdentityKeys: [...affected].sort(), reorgRewound, checkpoint };
    }
    if (reorgRewound && checkpoint !== null && persisted !== null) {
      await repository.saveReputationCheckpoint(checkpoint, {
        expectedCursorVersion: persisted.cursorVersion,
        expectedLastScannedBlockHash: persisted.lastScannedBlockHash,
        previousScannedBlock: persisted.lastScannedBlock,
        previousScannedBlockHash: persisted.lastScannedBlockHash,
        ...(verifiedRewind === undefined ? {} : { verifiedRewind })
      });
    }
    return { scannedFromBlock, scannedThroughBlock, insertedEventCount, promotedEventCount: 0, orphanedEventCount, affectedIdentityKeys: [...affected].sort(), reorgRewound, checkpoint };
  }
}

export function reputationFeedbackIdentityKey(feedback: ReputationFeedback): string {
  return `${erc8004IdentityKey(feedback.identity)}:${feedback.clientAddress}:${feedback.feedbackIndex}`;
}

export type ReputationIdentityRecord = IdentityRecord;
