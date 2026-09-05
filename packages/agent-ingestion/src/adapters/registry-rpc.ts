import { normalizeErc8004Identity, normalizeEvmAddress, type Erc8004Identity } from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import { normalizeDigest, normalizeRegistryEvent } from "../normalize.js";
import { normalizeNullableForRegistryRead } from "../registry-values.js";
import { assertReaderIdentityNetwork, normalizeChainBlockTag, type ChainBlockTag, type RegistryChainReader, type RegistryEventQuery } from "./registry.js";
import { JsonRpcClient } from "../rpc.js";
import type { DirectIdentityState, RegistryEvent } from "../types.js";

type CalldataBuilder = (identity: Erc8004Identity) => string;
type ResultDecoder<T> = (result: string) => T;

export type RegistryReadDefinition<T> = {
  /** ABI/calldata is supplied by the standards-locked runtime, never guessed. */
  readonly calldata: CalldataBuilder;
  /** Decoder is supplied/generated from the same reviewed ABI. */
  readonly decode: ResultDecoder<T>;
};

export type RegistryLogDecoder = (input: {
  readonly log: Readonly<Record<string, unknown>>;
  readonly chainId: number;
  readonly identityRegistry: string;
}) => RegistryEvent | null;

export type RegistryRpcReaderOptions = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly client: JsonRpcClient;
  readonly owner: RegistryReadDefinition<string | null>;
  readonly agentWallet: RegistryReadDefinition<string | null>;
  readonly agentUri: RegistryReadDefinition<string | null>;
  readonly contentDigest?: RegistryReadDefinition<string | null>;
  readonly readConsistency?: "finalized" | "provisional";
  readonly logTopics?: readonly (string | null | readonly string[])[];
  readonly decodeLog?: RegistryLogDecoder;
  readonly maxLogResults?: number;
};

function assertChainId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured registry chain ID is invalid.", "fix_chain_configuration");
  return value;
}

function assertCallData(value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value) || value.length < 10 || value.length % 2 !== 0) throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured registry calldata is invalid.", "fix_registry_abi");
  return value.toLowerCase();
}

function numberToTag(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry block number is invalid.", "fix_chain_read");
  return `0x${value.toString(16)}`;
}

function assertHash(value: string, field: string): string {
  if (!/^0x[0-9a-f]{64}$/iu.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry ${field} is invalid.`, "retry_chain_read");
  return value.toLowerCase();
}

function decoded<T>(definition: RegistryReadDefinition<T>, result: string, field: string): T {
  try {
    return definition.decode(result);
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry ${field} response could not be decoded.`, "fix_registry_abi", cause);
  }
}

function normalizeAddressResult(value: string | null, field: string, zeroMeansNull = false): string | null {
  if (value === null) return null;
  try {
    const normalized = normalizeEvmAddress(value);
    // ERC-8004 uses the zero address to mean that no agentWallet is set. An
    // ownerOf result is never silently collapsed into that sentinel: a zero
    // owner is retained so callers can fail closed on an invalid registry
    // response instead of confusing it with an unset execution wallet.
    return zeroMeansNull && /^0x0{40}$/iu.test(normalized) ? null : normalized;
  } catch (cause) {
    throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry ${field} response is not an address.`, "fix_registry_abi", cause);
  }
}

function normalizeUriResult(value: string | null): string | null {
  if (value === null) return null;
  return normalizeNullableForRegistryRead(value);
}

function normalizeDigestResult(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  return normalizeDigest(normalized, "registry content digest");
}

function blockHashFromLog(value: unknown): string {
  return assertHash(String(value), "event block hash");
}

function logPosition(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry event ${field} is invalid.`, "retry_chain_read");
  const number = Number(BigInt(value));
  if (!Number.isSafeInteger(number) || number < 0) throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry event ${field} is out of range.`, "retry_chain_read");
  return number;
}

/**
 * Read-only JSON-RPC registry adapter. ABI selectors, decoders, registry
 * address, chain ID and event topics are all injected from a reviewed lock;
 * this class intentionally cannot invent a protocol contract.
 */
export class JsonRpcRegistryChainReader implements RegistryChainReader {
  private readonly chainId: number;
  private readonly registry: string;
  private readonly client: JsonRpcClient;
  private readonly owner: RegistryReadDefinition<string | null>;
  private readonly agentWallet: RegistryReadDefinition<string | null>;
  private readonly agentUri: RegistryReadDefinition<string | null>;
  private readonly contentDigest: RegistryReadDefinition<string | null> | undefined;
  private readonly readConsistency: "finalized" | "provisional";
  private readonly logTopics: readonly (string | null | readonly string[])[] | undefined;
  private readonly decodeLog: RegistryLogDecoder | undefined;
  private readonly maxLogResults: number;
  private networkVerified = false;

  public constructor(options: RegistryRpcReaderOptions) {
    this.chainId = assertChainId(options.chainId);
    try { this.registry = normalizeEvmAddress(options.identityRegistry); } catch (cause) { throw ingestionError("CHAIN_PROVIDER_INVALID", "The configured identity registry address is invalid.", "fix_chain_configuration", cause); }
    this.client = options.client;
    this.owner = options.owner;
    this.agentWallet = options.agentWallet;
    this.agentUri = options.agentUri;
    this.contentDigest = options.contentDigest;
    this.readConsistency = options.readConsistency ?? "provisional";
    this.logTopics = options.logTopics;
    this.decodeLog = options.decodeLog;
    this.maxLogResults = options.maxLogResults ?? 10_000;
    if (!Number.isSafeInteger(this.maxLogResults) || this.maxLogResults < 1 || this.maxLogResults > 100_000) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry log result bound is invalid.", "fix_chain_configuration");
  }

  async getLatestBlock(): Promise<number> {
    return this.client.latestBlock();
  }

  /**
   * Resolve BSC's consensus-backed finalized tag to an exact number/hash
   * pair. The numeric hash is reread from the provider's canonical view so a
   * caller can bind all registry calls and event replay to one block proof.
   */
  async getFinalizedBlockTag(): Promise<ChainBlockTag> {
    const finalized = await this.client.finalizedBlock();
    const trustedHash = await this.getTrustedBlockHash(finalized.number);
    if (trustedHash === null || trustedHash !== finalized.hash) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        "The provider finalized block hash is not stable in its canonical view.",
        "retry_chain_read",
        undefined,
        true
      );
    }
    return { blockNumber: finalized.number, blockHash: finalized.hash };
  }

  async getTrustedBlockHash(blockNumber: number): Promise<string | null> {
    const result = await this.client.blockHash(blockNumber);
    return result === null ? null : assertHash(result, "trusted block hash");
  }

  async readIdentity(identity: Erc8004Identity, blockTag?: ChainBlockTag): Promise<DirectIdentityState> {
    const normalized = normalizeErc8004Identity(identity);
    if (normalized.namespace !== "eip155") throw ingestionError("IDENTITY_CONFLICT", "The configured registry reader accepts EVM identities only.", "review_identity");
    assertReaderIdentityNetwork(normalized, this.chainId, this.registry);
    await this.assertProviderNetwork();
    const tag = blockTag === undefined
      ? this.readConsistency === "finalized" ? await this.getFinalizedBlockTag() : await this.explicitHeadTag()
      : normalizeChainBlockTag(blockTag);
    if (blockTag !== undefined) {
      const trusted = await this.getTrustedBlockHash(tag.blockNumber);
      if (trusted === null || trusted !== tag.blockHash.toLowerCase()) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The requested registry block hash is no longer canonical.", "retry_chain_read", undefined, true);
    }
    const block = numberToTag(tag.blockNumber);
    const reads = await Promise.all([
      this.readDefinition(this.owner, normalized, block, "owner"),
      this.readDefinition(this.agentWallet, normalized, block, "agent wallet"),
      this.readDefinition(this.agentUri, normalized, block, "agent URI"),
      this.contentDigest === undefined ? Promise.resolve(null) : this.readDefinition(this.contentDigest, normalized, block, "content digest")
    ]);
    const ownerAddress = normalizeAddressResult(reads[0], "owner");
    const agentWallet = normalizeAddressResult(reads[1], "agent wallet", true);
    const agentUri = normalizeUriResult(reads[2]);
    const contentDigest = normalizeDigestResult(reads[3]);
    return {
      ownerAddress,
      agentWallet,
      agentUri,
      contentDigest,
      observedBlock: tag.blockNumber,
      observedBlockHash: tag.blockHash.toLowerCase(),
      readConsistency: this.readConsistency,
      ownerObservedBlock: tag.blockNumber,
      agentWalletObservedBlock: tag.blockNumber,
      agentUriObservedBlock: tag.blockNumber,
      contentDigestObservedBlock: this.contentDigest === undefined ? null : tag.blockNumber
    };
  }

  async getRegistryEvents(query: RegistryEventQuery): Promise<readonly RegistryEvent[]> {
    const registry = normalizeEvmAddress(query.identityRegistry);
    assertReaderIdentityNetwork({ namespace: "eip155", chainId: query.chainId, identityRegistry: registry, agentId: "0" }, this.chainId, this.registry);
    if (!Number.isSafeInteger(query.fromBlock) || !Number.isSafeInteger(query.toBlock) || query.fromBlock < 0 || query.toBlock < query.fromBlock || query.toBlock - query.fromBlock > 100_000) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event range is invalid or too large.", "fix_chain_range");
    if (query.blockTag !== undefined && query.toBlock > query.blockTag.blockNumber) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event range exceeds its pinned block tag.", "fix_chain_range");
    if (query.blockTag !== undefined) {
      const trustedTagHash = await this.getTrustedBlockHash(query.blockTag.blockNumber);
      if (trustedTagHash === null || trustedTagHash !== query.blockTag.blockHash.toLowerCase()) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The registry event block tag is no longer canonical.", "retry_chain_read", undefined, true);
    }
    await this.assertProviderNetwork();
    if (this.decodeLog === undefined) throw ingestionError("CHAIN_PROVIDER_INVALID", "No reviewed registry event decoder is configured.", "configure_registry_abi");
    const filter: Record<string, unknown> = { address: registry, fromBlock: numberToTag(query.fromBlock), toBlock: numberToTag(query.toBlock) };
    if (this.logTopics !== undefined) filter.topics = this.logTopics;
    const logs = await this.client.logs(filter);
    if (logs.length > this.maxLogResults) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry event response exceeded its bound.", "reduce_chain_range");
    const events: RegistryEvent[] = [];
    const trustedHashes = new Map<number, string>();
    for (const log of logs) {
      if (typeof log.address !== "string") {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned a log without an address.", "review_chain_provider");
      }
      let logAddress: string;
      try {
        logAddress = normalizeEvmAddress(log.address);
      } catch (cause) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned an invalid log address.", "review_chain_provider", cause);
      }
      if (logAddress !== registry) {
        throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned a log from a different contract.", "review_chain_provider");
      }
      const decodedEvent = this.decodeLog({ log, chainId: query.chainId, identityRegistry: registry });
      if (decodedEvent === null) continue;
      const decodedIdentity = normalizeErc8004Identity(decodedEvent.identity);
      assertReaderIdentityNetwork(decodedIdentity, query.chainId, registry);
      const blockNumber = logPosition(log.blockNumber, "block number");
      const transactionHash = assertHash(String(log.transactionHash), "event transaction hash");
      const logIndex = logPosition(log.logIndex, "log index");
      const blockHash = blockHashFromLog(log.blockHash);
      if (blockNumber < query.fromBlock || blockNumber > query.toBlock) throw ingestionError("CHAIN_PROVIDER_INVALID", "The registry provider returned an event outside the requested range.", "review_chain_provider");
      const trusted = trustedHashes.get(blockNumber) ?? await this.getTrustedBlockHash(blockNumber);
      if (trusted === null || trusted !== blockHash) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "A registry event block hash is not canonical.", "retry_chain_read", undefined, true);
      trustedHashes.set(blockNumber, trusted);
      const normalizedEvent = normalizeRegistryEvent({ ...decodedEvent, transactionHash, logIndex, blockNumber, blockHash, identity: decodedIdentity });
      events.push({ ...decodedEvent, ...normalizedEvent });
    }
    return events;
  }

  async findCommonAncestor(input: { readonly chainId: number; readonly identityRegistry: string; readonly lastKnownBlock: number; readonly lastKnownHash: string }): Promise<number> {
    assertReaderIdentityNetwork({ namespace: "eip155", chainId: input.chainId, identityRegistry: normalizeEvmAddress(input.identityRegistry), agentId: "0" }, this.chainId, this.registry);
    await this.assertProviderNetwork();
    if (!Number.isSafeInteger(input.lastKnownBlock) || input.lastKnownBlock < 1 || !/^0x[0-9a-f]{64}$/iu.test(input.lastKnownHash)) throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The last known registry checkpoint is invalid.", "review_chain_checkpoint");
    let oldBranch = await this.client.blockByHash(input.lastKnownHash);
    if (oldBranch === null || oldBranch.number !== input.lastKnownBlock) {
      throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The RPC provider cannot prove the previous checkpoint branch.", "manual_review_reorg");
    }
    const maxWalk = Math.min(100_000, input.lastKnownBlock + 1);
    for (let walked = 0; walked < maxWalk; walked += 1) {
      const canonical = await this.getTrustedBlockHash(oldBranch.number);
      if (canonical !== null && canonical === oldBranch.hash) return oldBranch.number;
      if (oldBranch.number === 0) break;
      const parent = await this.client.blockByHash(oldBranch.parentHash);
      if (parent === null || parent.number !== oldBranch.number - 1) break;
      oldBranch = parent;
    }
    throw ingestionError("REORG_RECONCILIATION_REQUIRED", "The registry common ancestor could not be proven from provider history.", "manual_review_reorg");
  }

  private async explicitHeadTag(): Promise<ChainBlockTag> {
    const blockNumber = await this.getLatestBlock();
    const blockHash = await this.getTrustedBlockHash(blockNumber);
    if (blockHash === null) throw ingestionError("CHAIN_PROVIDER_UNAVAILABLE", "The registry head block hash was unavailable.", "retry_chain_read", undefined, true);
    return { blockNumber, blockHash };
  }

  private async assertProviderNetwork(): Promise<void> {
    if (this.networkVerified) return;
    const observed = await this.client.chainId();
    if (observed !== this.chainId) throw ingestionError("CHAIN_NETWORK_MISMATCH", "The configured RPC endpoint is serving a different chain than the registry.", "fix_chain_provider");
    this.networkVerified = true;
  }

  private async readDefinition<T>(definition: RegistryReadDefinition<T>, identity: Erc8004Identity, block: string, field: string): Promise<T> {
    let calldata: string;
    try { calldata = assertCallData(definition.calldata(identity)); } catch (cause) { throw ingestionError("CHAIN_PROVIDER_INVALID", `The registry ${field} calldata is invalid.`, "fix_registry_abi", cause); }
    const result = await this.client.call(this.registry, calldata, block);
    return decoded(definition, result, field);
  }
}

export { JsonRpcRegistryChainReader as ConfiguredRegistryChainReader };
