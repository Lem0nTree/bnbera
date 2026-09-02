import {
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "../errors.js";
import { normalizeRegistryEvent, registryEventToObservation } from "../normalize.js";
import type {
  ChainCheckpoint,
  ChainObservation,
  DirectIdentityState,
  RegistryEvent
} from "../types.js";

/** A provider read pinned to one canonical block, never an implicit head read. */
export type ChainBlockTag = {
  readonly blockNumber: number;
  readonly blockHash: string;
};

export type RegistryEventQuery = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly fromBlock: number;
  readonly toBlock: number;
  /** The provider must evaluate this range against this exact chain view. */
  readonly blockTag?: ChainBlockTag;
};

export interface TrustedBlockHashReader {
  /** Hashes must come from the provider's canonical/finality-aware view. */
  getTrustedBlockHash(blockNumber: number): Promise<string | null>;
}

/**
 * Chain access is a port, not an embedded RPC implementation. This prevents a
 * guessed registry address, provider endpoint, event ABI, or universal health
 * route from silently becoming protocol truth.
 */
export interface RegistryChainReader extends TrustedBlockHashReader {
  getLatestBlock(): Promise<number>;
  /**
   * Read the canonical hash from a trusted/finality-aware chain provider.
   * Ordinary event payload hashes are never accepted as a substitute.
   */
  getRegistryEvents(query: RegistryEventQuery): Promise<readonly RegistryEvent[]>;
  /**
   * Read identity state at an explicit block tag for reorg/finality replay.
   * A missing tag is retained only for non-finality, operator-triggered reads.
   */
  readIdentity(identity: Erc8004Identity, blockTag?: ChainBlockTag): Promise<DirectIdentityState>;
  findCommonAncestor(input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly lastKnownBlock: number;
    readonly lastKnownHash: string;
  }): Promise<number>;
}

export function normalizeRegistryCheckpoint(input: ChainCheckpoint): ChainCheckpoint {
  const registry = normalizeEvmAddress(input.identityRegistry);
  const hashPattern = /^0x[0-9a-fA-F]{64}$/u;
  const indexerVersion = typeof input.indexerVersion === "string" ? input.indexerVersion.trim() : "";
  if (
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !Number.isSafeInteger(input.lastScannedBlock) ||
    input.lastScannedBlock < 0 ||
    !Number.isSafeInteger(input.lastFinalizedBlock) ||
    input.lastFinalizedBlock < 0 ||
    !Number.isSafeInteger(input.confirmationThreshold) ||
    input.confirmationThreshold < 0 ||
    indexerVersion.length === 0 ||
    indexerVersion.length > 64 ||
    !hashPattern.test(input.lastScannedBlockHash) ||
    !hashPattern.test(input.lastFinalizedBlockHash)
  ) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The chain checkpoint is invalid.", "fix_checkpoint");
  }
  if (input.lastFinalizedBlock > input.lastScannedBlock) {
    throw ingestionError("INGESTION_INPUT_INVALID", "A finalized block cannot exceed the scanned block.", "fix_checkpoint");
  }
  return { ...input, identityRegistry: registry, indexerVersion };
}

export function normalizeChainBlockTag(input: ChainBlockTag): ChainBlockTag {
  if (
    !Number.isSafeInteger(input.blockNumber) ||
    input.blockNumber < 0 ||
    !/^0x[0-9a-fA-F]{64}$/u.test(input.blockHash)
  ) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The chain block tag is invalid.", "fix_chain_read");
  }
  return { blockNumber: input.blockNumber, blockHash: input.blockHash.toLowerCase() };
}

export function normalizeRegistryEvents(inputs: readonly RegistryEvent[]): readonly ChainObservation[] {
  return inputs.map((input) => {
    normalizeRegistryEvent(input);
    return registryEventToObservation(input);
  });
}

export function registryQueryFromCheckpoint(
  checkpoint: ChainCheckpoint | null,
  input: {
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly startBlock: number;
    readonly endBlock: number;
    readonly blockTag?: ChainBlockTag;
  }
): RegistryEventQuery {
  const registry = normalizeEvmAddress(input.identityRegistry);
  const fromBlock = checkpoint === null ? input.startBlock : Math.max(input.startBlock, checkpoint.lastScannedBlock + 1);
  if (fromBlock > input.endBlock) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry scan range is empty.", "advance_scan");
  }
  return {
    chainId: input.chainId,
    identityRegistry: registry,
    fromBlock,
    toBlock: input.endBlock,
    ...(input.blockTag === undefined ? {} : { blockTag: normalizeChainBlockTag(input.blockTag) })
  };
}

export function assertReaderIdentityNetwork(
  identity: Erc8004Identity,
  expectedChainId: number,
  expectedRegistry: string
): void {
  const normalized = normalizeErc8004Identity(identity);
  if (normalized.chainId !== expectedChainId || normalized.identityRegistry !== normalizeEvmAddress(expectedRegistry)) {
    throw ingestionError(
      "IDENTITY_CONFLICT",
      "The identity does not belong to the configured registry network.",
      "review_identity"
    );
  }
}
