import {
  claimStatusSchema,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { normalizeDigest } from "./normalize.js";
import type {
  ChainObservation,
  ClaimRecord,
  DirectIdentityField
} from "./types.js";

/**
 * Stable storage shape consumed by a Drizzle repository adapter. Keeping this
 * mapping beside the repository ports makes the digest and claim provenance
 * fields explicit without coupling the orchestration package to Drizzle.
 */
export type ChainObservationRow = {
  readonly identity: Erc8004Identity;
  readonly identityKey: string;
  readonly eventType: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly confirmationState: ChainObservation["confirmationState"];
  readonly normalizedOwner: string | null;
  readonly normalizedAgentUri: string | null;
  readonly normalizedAgentWallet: string | null;
  readonly normalizedContentDigest: string | null;
  readonly observedFields: readonly DirectIdentityField[];
  readonly firstObservedAt: Date;
  readonly canonicalizedAt: Date | null;
  readonly orphanedAt: Date | null;
  readonly payloadDigest: string | null;
};

/** Complete claim row persisted on the agent projection. */
export type ClaimRecordRow = {
  readonly claimStatus: ClaimRecord["status"];
  readonly claimVersion: number;
  readonly claimantAddress: string | null;
  readonly claimOwnerAddressAtVerification: string | null;
  readonly claimAgentWalletAtVerification: string | null;
  readonly claimVerifiedAt: Date | null;
  readonly claimStaleAt: Date | null;
  readonly claimLastReason: ClaimRecord["lastReason"];
};

/**
 * Adapter surface an application-side Drizzle repository can implement or
 * delegate to. It is intentionally pure and has no database connection so
 * integration tests can exercise persistence losslessly before the adapter is
 * wired into a deployment.
 */
export type RepositoryMappingContract = {
  readonly observationToRow: typeof observationToRow;
  readonly observationFromRow: typeof observationFromRow;
  readonly claimRecordToRow: typeof claimRecordToRow;
  readonly claimRecordFromRow: typeof claimRecordFromRow;
};

export function observationToRow(observation: ChainObservation): ChainObservationRow {
  const identity = normalizeErc8004Identity(observation.identity);
  const identityKey = erc8004IdentityKey(identity);
  if (observation.identityKey !== identityKey) {
    throw ingestionError("REPOSITORY_FAILURE", "The observation identity key does not match its ERC-8004 identity.", "repair_repository_mapping");
  }
  return {
    identity,
    identityKey,
    eventType: observation.eventType,
    transactionHash: observation.transactionHash,
    logIndex: observation.logIndex,
    blockNumber: observation.blockNumber,
    blockHash: observation.blockHash,
    confirmationState: observation.confirmationState,
    normalizedOwner: normalizeNullableAddress(observation.ownerAddress),
    normalizedAgentUri: observation.agentUri,
    normalizedAgentWallet: normalizeNullableAddress(observation.agentWallet),
    normalizedContentDigest: normalizeDigest(observation.contentDigest, "content digest"),
    observedFields: [...observation.observedFields],
    firstObservedAt: observation.firstObservedAt,
    canonicalizedAt: observation.canonicalizedAt,
    orphanedAt: observation.orphanedAt,
    payloadDigest: normalizeDigest(observation.payloadDigest, "payload digest")
  };
}

export function observationFromRow(row: ChainObservationRow): ChainObservation {
  const identity = normalizeErc8004Identity(row.identity);
  const identityKey = erc8004IdentityKey(identity);
  if (row.identityKey !== identityKey) {
    throw ingestionError("REPOSITORY_FAILURE", "The observation identity key does not match its ERC-8004 identity.", "repair_repository_mapping");
  }
  if (!isValidDate(row.firstObservedAt) || (row.canonicalizedAt !== null && !isValidDate(row.canonicalizedAt)) || (row.orphanedAt !== null && !isValidDate(row.orphanedAt))) {
    throw ingestionError("REPOSITORY_FAILURE", "The observation timestamps are invalid.", "repair_repository_mapping");
  }
  return {
    identity,
    identityKey,
    eventType: row.eventType,
    transactionHash: row.transactionHash,
    logIndex: row.logIndex,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    confirmationState: row.confirmationState,
    ownerAddress: normalizeNullableAddress(row.normalizedOwner),
    agentUri: row.normalizedAgentUri,
    agentWallet: normalizeNullableAddress(row.normalizedAgentWallet),
    contentDigest: normalizeDigest(row.normalizedContentDigest, "content digest"),
    observedFields: [...row.observedFields],
    firstObservedAt: row.firstObservedAt,
    canonicalizedAt: row.canonicalizedAt,
    orphanedAt: row.orphanedAt,
    payloadDigest: normalizeDigest(row.payloadDigest, "payload digest")
  };
}

export function claimRecordToRow(record: ClaimRecord): ClaimRecordRow {
  return {
    claimStatus: record.status,
    claimVersion: record.version,
    claimantAddress: normalizeNullableAddress(record.claimantAddress),
    claimOwnerAddressAtVerification: normalizeNullableAddress(record.ownerAddressAtVerification),
    claimAgentWalletAtVerification: normalizeNullableAddress(record.agentWalletAtVerification),
    claimVerifiedAt: record.verifiedAt,
    claimStaleAt: record.staleAt,
    claimLastReason: record.lastReason
  };
}

export function claimRecordFromRow(identityKey: string, row: ClaimRecordRow): ClaimRecord {
  const status = claimStatusSchema.safeParse(row.claimStatus);
  if (!status.success || !Number.isSafeInteger(row.claimVersion) || row.claimVersion < 0) {
    throw ingestionError("REPOSITORY_FAILURE", "The persisted claim status or version is invalid.", "repair_repository_mapping");
  }
  const reasons = new Set<ClaimRecord["lastReason"]>(["claimed", "owner_transfer", "revoked", "reconciliation", null]);
  if (!reasons.has(row.claimLastReason)) {
    throw ingestionError("REPOSITORY_FAILURE", "The persisted claim reason is invalid.", "repair_repository_mapping");
  }
  if ((row.claimVerifiedAt !== null && !isValidDate(row.claimVerifiedAt)) || (row.claimStaleAt !== null && !isValidDate(row.claimStaleAt))) {
    throw ingestionError("REPOSITORY_FAILURE", "The persisted claim timestamps are invalid.", "repair_repository_mapping");
  }
  return {
    identityKey,
    version: row.claimVersion,
    status: status.data,
    claimantAddress: normalizeNullableAddress(row.claimantAddress),
    ownerAddressAtVerification: normalizeNullableAddress(row.claimOwnerAddressAtVerification),
    agentWalletAtVerification: normalizeNullableAddress(row.claimAgentWalletAtVerification),
    verifiedAt: row.claimVerifiedAt,
    staleAt: row.claimStaleAt,
    lastReason: row.claimLastReason
  };
}

function normalizeNullableAddress(value: string | null): string | null {
  return value === null ? null : normalizeEvmAddress(value);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export const repositoryMappingContract: RepositoryMappingContract = {
  observationToRow,
  observationFromRow,
  claimRecordToRow,
  claimRecordFromRow
};
