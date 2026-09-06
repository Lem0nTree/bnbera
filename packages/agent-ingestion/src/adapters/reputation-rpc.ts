import { normalizeErc8004Identity, normalizeEvmAddress } from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import {
  normalizeReputationEventWithDigest,
  type ReputationChainBlockTag,
  type ReputationChainReader,
  type ReputationEventQuery
} from "../reputation.js";
import { JsonRpcClient } from "../rpc.js";
import type { ReputationFeedbackEvent } from "../types.js";
import type { DecodedReputationEvent, ReputationLogDecoder } from "./reputation-codec.js";

export type ReputationRpcReaderOptions = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly reputationRegistry: string;
  readonly client: JsonRpcClient;
  readonly logTopics?: readonly (string | null | readonly string[])[];
  readonly decodeLog?: ReputationLogDecoder;
  readonly maxLogResults?: number;
  readonly now?: () => Date;
};

function assertChainId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured reputation chain ID is invalid.", "fix_chain_configuration");
  return value;
}

function blockTag(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation block number is invalid.", "retry_chain_read");
  return `0x${value.toString(16)}`;
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation ${field} is invalid.`, "retry_chain_read");
  return value.toLowerCase();
}

function position(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${field} is invalid.`, "retry_chain_read");
  const parsed = Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw ingestionError("CHAIN_PROVIDER_INVALID", `The reputation event ${field} is out of range.`, "retry_chain_read");
  return parsed;
}

function eventNetwork(identity: ReputationFeedbackEvent["identity"], chainId: number, identityRegistry: string): void {
  const normalized = normalizeErc8004Identity(identity);
  if (normalized.namespace !== "eip155" || normalized.chainId !== chainId || normalized.identityRegistry !== identityRegistry) throw ingestionError("IDENTITY_CONFLICT", "A reputation event belongs to a different configured identity registry.", "review_reputation_configuration");
}

export class JsonRpcReputationChainReader implements ReputationChainReader {
  private readonly chainId: number;
  private readonly identityRegistry: string;
  private readonly reputationRegistry: string;
  private readonly client: JsonRpcClient;
  private readonly logTopics: readonly (string | null | readonly string[])[] | undefined;
  private readonly decodeLog: ReputationLogDecoder | undefined;
  private readonly maxLogResults: number;
  private readonly clock: () => Date;
  private networkVerified = false;

  public constructor(options: ReputationRpcReaderOptions) {
    this.chainId = assertChainId(options.chainId);
    try {
      this.identityRegistry = normalizeEvmAddress(options.identityRegistry);
      this.reputationRegistry = normalizeEvmAddress(options.reputationRegistry);
    } catch (cause) {
      throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured reputation registry addresses are invalid.", "fix_chain_configuration", cause);
    }
    this.client = options.client;
    this.logTopics = options.logTopics;
    this.decodeLog = options.decodeLog;
    this.maxLogResults = options.maxLogResults ?? 10_000;
    this.clock = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.maxLogResults) || this.maxLogResults < 1 || this.maxLogResults > 100_000) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation log result bound is invalid.", "fix_chain_configuration");
  }

  async getLatestBlock(): Promise<number> {
    await this.assertProviderNetwork();
    return this.client.latestBlock();
  }

  async getTrustedBlockHash(blockNumber: number): Promise<string | null> {
    await this.assertProviderNetwork();
    const value = await this.client.blockHash(blockNumber);
    return value === null ? null : hash(value, "trusted block hash");
  }

  async getFinalizedBlockTag(): Promise<ReputationChainBlockTag> {
    await this.assertProviderNetwork();
    const finalized = await this.client.finalizedBlock();
    const trusted = await this.getTrustedBlockHash(finalized.number);
    if (trusted === null || trusted !== finalized.hash.toLowerCase()) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The provider finalized block hash is not stable in its canonical view.", "retry_chain_read", undefined, true);
    return { blockNumber: finalized.number, blockHash: finalized.hash.toLowerCase() };
  }

  async getReputationEvents(query: ReputationEventQuery): Promise<readonly ReputationFeedbackEvent[]> {
    const identityRegistry = normalizeEvmAddress(query.identityRegistry);
    const reputationRegistry = normalizeEvmAddress(query.reputationRegistry);
    if (query.chainId !== this.chainId || identityRegistry !== this.identityRegistry || reputationRegistry !== this.reputationRegistry) throw ingestionError("IDENTITY_CONFLICT", "The reputation query does not match the configured registries.", "review_reputation_configuration");
    if (!Number.isSafeInteger(query.fromBlock) || !Number.isSafeInteger(query.toBlock) || query.fromBlock < 0 || query.toBlock < query.fromBlock || query.toBlock - query.fromBlock > 100_000) throw ingestionError("REPUTATION_SYNC_RANGE_EXCEEDED", "The reputation event range is invalid or too large.", "reduce_reputation_range");
    if (query.blockTag !== undefined) {
      if (query.toBlock > query.blockTag.blockNumber) throw ingestionError("REPUTATION_SYNC_RANGE_EXCEEDED", "The reputation event range exceeds its pinned block tag.", "reduce_reputation_range");
      const trusted = await this.getTrustedBlockHash(query.blockTag.blockNumber);
      if (trusted === null || trusted !== query.blockTag.blockHash.toLowerCase()) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The reputation event block tag is no longer canonical.", "retry_chain_read", undefined, true);
    }
    await this.assertProviderNetwork();
    if (this.decodeLog === undefined) throw ingestionError("REPUTATION_READER_NOT_CONFIGURED", "No reviewed Reputation Registry event decoder is configured.", "configure_reputation_abi");
    const filter: Record<string, unknown> = { address: reputationRegistry, fromBlock: blockTag(query.fromBlock), toBlock: blockTag(query.toBlock) };
    if (this.logTopics !== undefined) filter.topics = this.logTopics;
    const logs = await this.client.logs(filter);
    if (logs.length > this.maxLogResults) throw ingestionError("REPUTATION_SYNC_EVENT_LIMIT_EXCEEDED", "The reputation provider returned more events than its bound.", "reduce_reputation_range");
    const events: ReputationFeedbackEvent[] = [];
    const trustedHashes = new Map<number, string>();
    for (const log of logs) {
      let logAddress: string;
      try {
        logAddress = typeof log.address === "string" ? normalizeEvmAddress(log.address) : "";
      } catch (cause) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation provider returned a log with an invalid contract address.", "review_chain_provider", cause);
      }
      if (logAddress !== reputationRegistry) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation provider returned a log from a different contract.", "review_chain_provider");
      const decoded: DecodedReputationEvent | null = this.decodeLog({ log, chainId: query.chainId, identityRegistry, reputationRegistry });
      if (decoded === null) continue;
      eventNetwork(decoded.identity, query.chainId, identityRegistry);
      if (normalizeEvmAddress(decoded.reputationRegistry) !== reputationRegistry) throw ingestionError("IDENTITY_CONFLICT", "A reputation event decoder returned a different registry.", "review_reputation_configuration");
      const blockNumber = position(log.blockNumber, "block number");
      const transactionHash = hash(log.transactionHash, "transaction hash");
      const logIndex = position(log.logIndex, "log index");
      const blockHash = hash(log.blockHash, "block hash");
      if (blockNumber < query.fromBlock || blockNumber > query.toBlock) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation provider returned an event outside the requested range.", "review_chain_provider");
      const trusted = trustedHashes.get(blockNumber) ?? await this.getTrustedBlockHash(blockNumber);
      if (trusted === null || trusted !== blockHash) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "A reputation event block hash is not canonical.", "retry_chain_read", undefined, true);
      trustedHashes.set(blockNumber, trusted);
      const observedAt = this.clock();
      if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.valueOf())) throw ingestionError("CHAIN_PROVIDER_INVALID", "The reputation reader clock is invalid.", "check_clock");
      events.push(normalizeReputationEventWithDigest({ ...decoded, transactionHash, logIndex, blockNumber, blockHash, observedAt, canonicalizedAt: null, orphanedAt: null }));
    }
    return events;
  }

  async findCommonAncestor(input: { readonly chainId: number; readonly identityRegistry: string; readonly reputationRegistry: string; readonly lastKnownBlock: number; readonly lastKnownHash: string }): Promise<number> {
    if (input.chainId !== this.chainId || normalizeEvmAddress(input.identityRegistry) !== this.identityRegistry || normalizeEvmAddress(input.reputationRegistry) !== this.reputationRegistry) throw ingestionError("IDENTITY_CONFLICT", "The reputation reorganization query does not match configured registries.", "review_reputation_configuration");
    if (!Number.isSafeInteger(input.lastKnownBlock) || input.lastKnownBlock < 1) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The last known reputation checkpoint is invalid.", "review_reputation_checkpoint");
    const lastKnownHash = hash(input.lastKnownHash, "last known block hash");
    await this.assertProviderNetwork();
    let oldBranch = await this.client.blockByHash(lastKnownHash);
    if (oldBranch === null || oldBranch.number !== input.lastKnownBlock) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The RPC provider cannot prove the previous reputation checkpoint branch.", "manual_review_reorg");
    const maxWalk = Math.min(100_000, input.lastKnownBlock + 1);
    for (let walked = 0; walked < maxWalk; walked += 1) {
      const canonical = await this.getTrustedBlockHash(oldBranch.number);
      if (canonical !== null && canonical === oldBranch.hash) return oldBranch.number;
      if (oldBranch.number === 0) break;
      const parent = await this.client.blockByHash(oldBranch.parentHash);
      if (parent === null || parent.number !== oldBranch.number - 1) break;
      oldBranch = parent;
    }
    throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The reputation common ancestor could not be proven from provider history.", "manual_review_reorg");
  }

  private async assertProviderNetwork(): Promise<void> {
    if (this.networkVerified) return;
    const observed = await this.client.chainId();
    if (observed !== this.chainId) throw ingestionError("CHAIN_NETWORK_MISMATCH", "The configured RPC endpoint is serving a different chain than the reputation registry.", "fix_chain_provider");
    this.networkVerified = true;
  }
}

export { JsonRpcReputationChainReader as ConfiguredReputationChainReader };
