import {
  claimStatusSchema,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  originTypes,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { normalizeDigest } from "./normalize.js";
import type {
  ChainObservation,
  ClaimRecord,
  DirectIdentityField,
  IdentityRecord
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
  readonly claimVerificationObservedBlock: number | null;
  readonly claimVerificationObservedBlockHash: string | null;
  readonly claimVerificationReadConsistency: ClaimRecord["verificationReadConsistency"];
};

/** Identity projection row, including per-field and whole-read provenance. */
export type IdentityRecordRow = {
  readonly id: string;
  readonly identity: Erc8004Identity;
  readonly originType: IdentityRecord["originType"];
  readonly ownerAddress: string | null;
  readonly ownerObservedBlock: number | null;
  readonly agentWallet: string | null;
  readonly agentWalletObservedBlock: number | null;
  readonly agentUri: string | null;
  readonly agentUriObservedBlock: number | null;
  readonly contentDigest: string | null;
  readonly contentDigestObservedBlock: number | null;
  readonly observedBlock: number | null;
  readonly observedBlockHash: string | null;
  readonly readConsistency: IdentityRecord["readConsistency"];
  readonly state: IdentityRecord["state"];
  readonly ownerClaimVerifiedAt: Date | null;
  readonly updatedAt: Date;
};

/**
 * Adapter surface an application-side Drizzle repository can implement or
 * delegate to. It is intentionally pure and has no database connection so
 * integration tests can exercise persistence losslessly before the adapter is
 * wired into a deployment.
 */
export type RepositoryMappingContract = {
  readonly identityRecordToRow: typeof identityRecordToRow;
  readonly identityRecordFromRow: typeof identityRecordFromRow;
  readonly observationToRow: typeof observationToRow;
  readonly observationFromRow: typeof observationFromRow;
  readonly claimRecordToRow: typeof claimRecordToRow;
  readonly claimRecordFromRow: typeof claimRecordFromRow;
};

export function identityRecordToRow(record: IdentityRecord): IdentityRecordRow {
  const identity = normalizeErc8004Identity(record.identity);
  const originType = originTypes.includes(record.originType) ? record.originType : null;
  if (originType === null || record.id.trim().length === 0) {
    throw ingestionError("REPOSITORY_FAILURE", "The persisted identity row is invalid.", "repair_repository_mapping");
  }
  const observedBlock = normalizeNullableBlock(record.observedBlock, "identity observed block");
  const observedBlockHash = normalizeNullableBlockHash(record.observedBlockHash, "identity observed block hash");
  const readConsistency = normalizeNullableReadConsistency(record.readConsistency, "identity read consistency");
  assertWholeReadReference(observedBlock, observedBlockHash, readConsistency);
  return {
    id: record.id,
    identity,
    originType,
    ownerAddress: normalizeNullableAddress(record.ownerAddress),
    ownerObservedBlock: normalizeNullableBlock(record.ownerObservedBlock, "owner observed block"),
    agentWallet: normalizeNullableAddress(record.agentWallet),
    agentWalletObservedBlock: normalizeNullableBlock(record.agentWalletObservedBlock, "agent wallet observed block"),
    agentUri: record.agentUri,
    agentUriObservedBlock: normalizeNullableBlock(record.agentUriObservedBlock, "agent URI observed block"),
    contentDigest: normalizeDigest(record.contentDigest, "content digest"),
    contentDigestObservedBlock: normalizeNullableBlock(record.contentDigestObservedBlock, "content digest observed block"),
    observedBlock,
    observedBlockHash,
    readConsistency,
    state: record.state,
    ownerClaimVerifiedAt: normalizeNullableDate(record.ownerClaimVerifiedAt, "owner claim verified timestamp"),
    updatedAt: requireDate(record.updatedAt, "identity updated timestamp")
  };
}

export function identityRecordFromRow(row: IdentityRecordRow): IdentityRecord {
  const identity = normalizeErc8004Identity(row.identity);
  const originType = originTypes.includes(row.originType) ? row.originType : null;
  if (originType === null || row.id.trim().length === 0) {
    throw ingestionError("REPOSITORY_FAILURE", "The persisted identity row is invalid.", "repair_repository_mapping");
  }
  const observedBlock = normalizeNullableBlock(row.observedBlock, "identity observed block");
  const observedBlockHash = normalizeNullableBlockHash(row.observedBlockHash, "identity observed block hash");
  const readConsistency = normalizeNullableReadConsistency(row.readConsistency, "identity read consistency");
  assertWholeReadReference(observedBlock, observedBlockHash, readConsistency);
  return {
    id: row.id,
    identity,
    originType,
    ownerAddress: normalizeNullableAddress(row.ownerAddress),
    ownerObservedBlock: normalizeNullableBlock(row.ownerObservedBlock, "owner observed block"),
    agentWallet: normalizeNullableAddress(row.agentWallet),
    agentWalletObservedBlock: normalizeNullableBlock(row.agentWalletObservedBlock, "agent wallet observed block"),
    agentUri: row.agentUri,
    agentUriObservedBlock: normalizeNullableBlock(row.agentUriObservedBlock, "agent URI observed block"),
    contentDigest: normalizeDigest(row.contentDigest, "content digest"),
    contentDigestObservedBlock: normalizeNullableBlock(row.contentDigestObservedBlock, "content digest observed block"),
    observedBlock,
    observedBlockHash,
    readConsistency,
    state: row.state,
    ownerClaimVerifiedAt: normalizeNullableDate(row.ownerClaimVerifiedAt, "owner claim verified timestamp"),
    updatedAt: requireDate(row.updatedAt, "identity updated timestamp")
  };
}

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
    claimLastReason: record.lastReason,
    claimVerificationObservedBlock: normalizeNullableBlock(
      record.verificationObservedBlock,
      "claim verification observed block"
    ),
    claimVerificationObservedBlockHash: normalizeNullableBlockHash(
      record.verificationObservedBlockHash,
      "claim verification observed block hash"
    ),
    claimVerificationReadConsistency: normalizeNullableReadConsistency(
      record.verificationReadConsistency,
      "claim verification read consistency"
    )
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
  const verificationObservedBlock = normalizeNullableBlock(
    row.claimVerificationObservedBlock,
    "claim verification observed block"
  );
  const verificationObservedBlockHash = normalizeNullableBlockHash(
    row.claimVerificationObservedBlockHash,
    "claim verification observed block hash"
  );
  const verificationReadConsistency = normalizeNullableReadConsistency(
    row.claimVerificationReadConsistency,
    "claim verification read consistency"
  );
  assertWholeReadReference(verificationObservedBlock, verificationObservedBlockHash, verificationReadConsistency);
  return {
    identityKey,
    version: row.claimVersion,
    status: status.data,
    claimantAddress: normalizeNullableAddress(row.claimantAddress),
    ownerAddressAtVerification: normalizeNullableAddress(row.claimOwnerAddressAtVerification),
    agentWalletAtVerification: normalizeNullableAddress(row.claimAgentWalletAtVerification),
    verifiedAt: row.claimVerifiedAt,
    staleAt: row.claimStaleAt,
    lastReason: row.claimLastReason,
    verificationObservedBlock,
    verificationObservedBlockHash,
    verificationReadConsistency
  };
}

function normalizeNullableAddress(value: string | null): string | null {
  return value === null ? null : normalizeEvmAddress(value);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function requireDate(value: Date, field: string): Date {
  if (!isValidDate(value)) {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return value;
}

function normalizeNullableDate(value: Date | null, field: string): Date | null {
  return value === null ? null : requireDate(value, field);
}

function normalizeNullableBlock(value: number | null, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return value;
}

function normalizeNullableBlockHash(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return value.toLowerCase();
}

function normalizeNullableReadConsistency(
  value: IdentityRecord["readConsistency"] | ClaimRecord["verificationReadConsistency"],
  field: string
): "finalized" | "provisional" | null {
  if (value === null) {
    return null;
  }
  if (value !== "finalized" && value !== "provisional") {
    throw ingestionError("REPOSITORY_FAILURE", `The persisted ${field} is invalid.`, "repair_repository_mapping");
  }
  return value;
}

function assertWholeReadReference(
  observedBlock: number | null,
  observedBlockHash: string | null,
  readConsistency: "finalized" | "provisional" | null
): void {
  const present = [observedBlock, observedBlockHash, readConsistency].filter((value) => value !== null).length;
  if (present !== 0 && present !== 3) {
    throw ingestionError(
      "REPOSITORY_FAILURE",
      "The persisted identity read provenance is incomplete.",
      "repair_repository_mapping"
    );
  }
}

export const repositoryMappingContract: RepositoryMappingContract = {
  identityRecordToRow,
  identityRecordFromRow,
  observationToRow,
  observationFromRow,
  claimRecordToRow,
  claimRecordFromRow
};
