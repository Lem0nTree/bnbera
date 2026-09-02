import { ingestionError } from "./errors.js";
import type {
  DirectIdentityState,
  IdentityReadConsistency,
  IdentityReadReference,
  IdentityRecord
} from "./types.js";

const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/u;

/**
 * Validate and return a direct registry read before it is used for a claim,
 * reconciliation, or canonical projection. The source is allowed to return
 * a provisional read, but it must say so explicitly and bind the complete
 * read to a block number and hash.
 */
export function assertIdentityReadProvenance(
  read: DirectIdentityState,
  purpose: string,
  expectedBlock?: IdentityReadReference
): DirectIdentityState {
  if (
    !Number.isSafeInteger(read.observedBlock) ||
    read.observedBlock < 0 ||
    typeof read.observedBlockHash !== "string" ||
    !BLOCK_HASH.test(read.observedBlockHash) ||
    !isReadConsistency(read.readConsistency)
  ) {
    throw ingestionError(
      "REORG_RECONCILIATION_REQUIRED",
      `The ${purpose} is missing an exact block provenance reference.`,
      "retry_chain_read"
    );
  }

  for (const [field, observedBlock] of [
    ["owner", read.ownerObservedBlock],
    ["agentWallet", read.agentWalletObservedBlock],
    ["agentUri", read.agentUriObservedBlock],
    ["contentDigest", read.contentDigestObservedBlock]
  ] as const) {
    if (
      observedBlock !== null &&
      (!Number.isSafeInteger(observedBlock) || observedBlock < 0 || observedBlock > read.observedBlock)
    ) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        `The ${purpose} has invalid ${field} field provenance.`,
        "retry_chain_read"
      );
    }
  }

  if (expectedBlock !== undefined) {
    if (
      read.observedBlock !== expectedBlock.observedBlock ||
      read.observedBlockHash.toLowerCase() !== expectedBlock.observedBlockHash.toLowerCase() ||
      read.readConsistency !== expectedBlock.readConsistency
    ) {
      throw ingestionError(
        "REORG_RECONCILIATION_REQUIRED",
        `The ${purpose} was not read at the required canonical block.`,
        "reconcile_chain"
      );
    }
  }

  return read;
}

export function identityReadReference(read: DirectIdentityState): IdentityReadReference {
  assertIdentityReadProvenance(read, "identity read");
  return {
    observedBlock: read.observedBlock,
    observedBlockHash: read.observedBlockHash.toLowerCase(),
    readConsistency: read.readConsistency
  };
}

export function identityRecordReadReference(record: IdentityRecord): IdentityReadReference | null {
  const present = [record.observedBlock, record.observedBlockHash, record.readConsistency]
    .filter((value) => value !== null).length;
  if (present === 0) {
    return null;
  }
  if (present !== 3) {
    throw ingestionError(
      "REPOSITORY_FAILURE",
      "The persisted identity read provenance is incomplete.",
      "repair_repository_mapping"
    );
  }
  const observedBlock = record.observedBlock;
  const observedBlockHash = record.observedBlockHash;
  const readConsistency = record.readConsistency;
  if (observedBlock === null || observedBlockHash === null || readConsistency === null) {
    throw ingestionError(
      "REPOSITORY_FAILURE",
      "The persisted identity read provenance is incomplete.",
      "repair_repository_mapping"
    );
  }
  const reference: IdentityReadReference = {
    observedBlock,
    observedBlockHash,
    readConsistency
  };
  if (!Number.isSafeInteger(reference.observedBlock) || reference.observedBlock < 0 || !BLOCK_HASH.test(reference.observedBlockHash)) {
    throw ingestionError(
      "REPOSITORY_FAILURE",
      "The persisted identity read provenance is invalid.",
      "repair_repository_mapping"
    );
  }
  return { ...reference, observedBlockHash: reference.observedBlockHash.toLowerCase() };
}

function isReadConsistency(value: unknown): value is IdentityReadConsistency {
  return value === "finalized" || value === "provisional";
}
