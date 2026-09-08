import { createHash } from "node:crypto";
import type { EvidenceLocator, VerificationResult } from "@bnbera/evidence";
import { evidenceLocatorSchema, verificationResultSchema } from "@bnbera/evidence";
import type { EvidenceState } from "@bnbera/domain";
import {
  PublicationProviderError,
  assertDurablePublicationAttempt,
  publicationAttemptRecordSchema,
  type PublicationAttemptRecord,
  type PublicationAuditEvent,
  type PublicationStore
} from "./types.js";
import { InMemoryPublicationStore } from "./store.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  if (!uuidPattern.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
  return value;
}

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex
    .slice(16, 20)
    .join("")}-${hex.slice(20, 32).join("")}`;
}

function asDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return date;
}

function fromDate(value: Date, field: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error(`${field} must be a valid database timestamp`);
  }
  return value.toISOString();
}

function requiredString(value: string | null, field: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`${field} is required for a canonical evidence object`);
  }
  return value;
}

function requiredNumber(value: number | null, field: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is required for a canonical evidence object`);
  }
  return value;
}

function requiredDigest(value: string | null, field: string): string {
  const digest = requiredString(value, field);
  if (!/^[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(`${field} must be a 32-byte hexadecimal digest`);
  }
  return digest;
}

function optionalTransactionHash(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${field} must be a canonical transaction hash`);
  }
  return value;
}

function requiredVersion(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

/** Metadata persisted for one immutable canonical artifact version. Raw bytes
 * are intentionally absent; providers are responsible for storage payloads.
 * artifactId identifies the canonical artifact, while resourceId identifies
 * the application resource/run that produced it. They are deliberately not
 * collapsed into one column. */
export interface EvidenceObjectRecord {
  readonly id: string;
  readonly runId: string | null;
  readonly agentId: string | null;
  readonly benchmarkId: string | null;
  readonly artifactId: string;
  readonly artifactType: string;
  readonly artifactSchemaVersion: string;
  readonly resourceId: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly state: EvidenceState;
  readonly ipfsUri: string | null;
  readonly greenfieldBucket: string | null;
  readonly greenfieldObject: string | null;
  readonly creationTransactionHash: string | null;
  readonly sealTransactionHash: string | null;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly mimeType: "application/json";
  readonly readbackVerifiedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceObjectRepository {
  readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<EvidenceObjectRecord | null>;
  readonly findById: (id: string) => Promise<EvidenceObjectRecord | null>;
  readonly save: (record: EvidenceObjectRecord) => Promise<void>;
}

export interface EvidencePublicationAttemptRepository extends PublicationStore {}

export interface EvidenceLocatorRepository {
  readonly addLocator: (locator: EvidenceLocator & { readonly evidenceObjectId: string }) => Promise<void>;
  readonly listLocatorsForObject: (evidenceObjectId: string) => Promise<readonly EvidenceLocator[]>;
}

export interface EvidenceVerificationRepository {
  readonly addVerification: (result: VerificationResult & { readonly evidenceObjectId: string }) => Promise<void>;
  readonly listVerificationsForObject: (evidenceObjectId: string) => Promise<readonly VerificationResult[]>;
}

export interface EvidenceRepositoryBundle {
  readonly objects: EvidenceObjectRepository;
  readonly attempts: EvidencePublicationAttemptRepository;
  readonly locators: EvidenceLocatorRepository;
  readonly verifications: EvidenceVerificationRepository;
}

/** All object, attempt, locator and verification mutations for one evidence
 * publication are executed through one transaction boundary. */
export interface EvidencePublicationUnitOfWork {
  readonly run: <T>(work: (repositories: EvidenceRepositoryBundle) => Promise<T>) => Promise<T>;
}

/** Persistence boundary for A0's database adapter. The row types mirror the
 * actual Drizzle tables: UUIDs are strings, database timestamps are Date
 * values, nullable columns remain nullable, and attempt payload metadata lives
 * on evidence_objects rather than being duplicated on attempts. */
export interface EvidenceObjectRow {
  readonly id: string;
  readonly run_id: string | null;
  readonly agent_id: string | null;
  readonly benchmark_id: string | null;
  readonly artifact_id: string;
  readonly object_type: string;
  readonly artifact_schema_version: string;
  readonly resource_id: string;
  readonly version: number;
  readonly idempotency_key: string;
  readonly state: EvidenceState;
  readonly ipfs_uri: string | null;
  readonly greenfield_bucket: string | null;
  readonly greenfield_object: string | null;
  readonly creation_transaction_hash: string | null;
  readonly seal_transaction_hash: string | null;
  readonly sha256_digest: string | null;
  readonly keccak256_digest: string | null;
  readonly size_bytes: number | null;
  readonly mime_type: string | null;
  readonly readback_verified_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface EvidencePublicationAttemptRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly provider: PublicationAttemptRecord["provider"];
  readonly provider_label: string;
  readonly idempotency_key: string;
  readonly attempt_number: number;
  readonly configuration_digest: string;
  readonly configured_network: string;
  readonly configured_bucket: string | null;
  readonly revision: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly object_name: string;
  readonly state: PublicationAttemptRecord["state"];
  readonly provider_reference: string | null;
  readonly creation_transaction_hash: string | null;
  readonly seal_transaction_hash: string | null;
  readonly submitted_at: Date | null;
  readonly last_error_code: string | null;
  readonly sanitized_error: string | null;
  readonly retryable: boolean;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface EvidenceLocatorRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly publication_attempt_id: string | null;
  readonly provider: EvidenceLocator["provider"];
  readonly provider_label: string;
  readonly network: string;
  readonly uri: string;
  readonly bucket: string | null;
  readonly object_name: string | null;
  readonly provider_reference: string | null;
  readonly version: number;
  readonly sha256_digest: string;
  readonly keccak256_digest: string;
  readonly size_bytes: number;
  readonly immutable: boolean;
  readonly verified_at: Date | null;
  readonly created_at: Date;
}

export interface EvidenceVerificationResultRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly publication_attempt_id: string | null;
  readonly status: VerificationResult["status"];
  readonly checked_at: Date;
  readonly seal_confirmed: boolean | null;
  readonly readback_status: VerificationResult["readbackStatus"];
  readonly expected_sha256_digest: string;
  readonly observed_sha256_digest: string | null;
  readonly expected_keccak256_digest: string;
  readonly observed_keccak256_digest: string | null;
  readonly expected_size_bytes: number;
  readonly observed_size_bytes: number | null;
  readonly hashes_match: boolean;
  readonly size_matches: boolean;
  readonly reason_code: string | null;
  readonly created_at: Date;
}

/** A database implementation supplies all operations on a transaction-scoped
 * adapter. CAS arguments are mandatory for attempt writes so a stale worker
 * cannot overwrite a newer state or a different lease owner. */
export interface PersistentEvidenceAdapter {
  readonly transaction: <T>(work: (transaction: PersistentEvidenceAdapter) => Promise<T>) => Promise<T>;
  readonly objects: {
    readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<EvidenceObjectRow | null>;
    readonly findById: (id: string) => Promise<EvidenceObjectRow | null>;
    readonly save: (row: EvidenceObjectRow) => Promise<void>;
  };
  readonly attempts: {
    readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<EvidencePublicationAttemptRow | null>;
    readonly findByAttemptId: (attemptId: string) => Promise<EvidencePublicationAttemptRow | null>;
    readonly createOrGet: (
      row: EvidencePublicationAttemptRow
    ) => Promise<{ readonly row: EvidencePublicationAttemptRow; readonly created: boolean }>;
    readonly save: (
      row: EvidencePublicationAttemptRow,
      expectedRevision: number,
      leaseToken: string,
      now?: Date
    ) => Promise<void>;
    readonly acquireLease: (
      attemptId: string,
      leaseToken: string,
      now: Date,
      durationMs: number
    ) => Promise<{ readonly row: EvidencePublicationAttemptRow | null; readonly acquired: boolean }>;
    readonly releaseLease: (attemptId: string, leaseToken: string, now?: Date) => Promise<EvidencePublicationAttemptRow | null>;
  };
  readonly locators: {
    readonly add: (row: EvidenceLocatorRow) => Promise<void>;
    readonly listForObject: (evidenceObjectId: string) => Promise<readonly EvidenceLocatorRow[]>;
    readonly latestForAttempt: (attemptId: string) => Promise<EvidenceLocatorRow | null>;
  };
  readonly verifications: {
    readonly add: (row: EvidenceVerificationResultRow) => Promise<void>;
    readonly listForObject: (evidenceObjectId: string) => Promise<readonly EvidenceVerificationResultRow[]>;
    readonly latestForAttempt: (attemptId: string) => Promise<EvidenceVerificationResultRow | null>;
  };
  readonly auditEvents: {
    readonly append: (event: PublicationAuditEvent) => Promise<void>;
  };
}

export function toEvidenceObjectRow(record: EvidenceObjectRecord): EvidenceObjectRow {
  requireUuid(record.id, "evidence object id");
  return {
    id: record.id,
    run_id: record.runId === null ? null : requireUuid(record.runId, "run id"),
    agent_id: record.agentId === null ? null : requireUuid(record.agentId, "agent id"),
    benchmark_id: record.benchmarkId,
    artifact_id: record.artifactId,
    object_type: record.artifactType,
    artifact_schema_version: record.artifactSchemaVersion,
    resource_id: record.resourceId,
    version: record.version,
    idempotency_key: record.idempotencyKey,
    state: record.state,
    ipfs_uri: record.ipfsUri,
    greenfield_bucket: record.greenfieldBucket,
    greenfield_object: record.greenfieldObject,
    creation_transaction_hash: record.creationTransactionHash,
    seal_transaction_hash: record.sealTransactionHash,
    sha256_digest: record.sha256Digest,
    keccak256_digest: record.keccak256Digest,
    size_bytes: record.sizeBytes,
    mime_type: record.mimeType,
    readback_verified_at: record.readbackVerifiedAt === null ? null : asDate(record.readbackVerifiedAt, "readback_verified_at"),
    created_at: asDate(record.createdAt, "created_at"),
    updated_at: asDate(record.updatedAt, "updated_at")
  };
}

export function fromEvidenceObjectRow(row: EvidenceObjectRow): EvidenceObjectRecord {
  requireUuid(row.id, "evidence object id");
  const mimeType = requiredString(row.mime_type, "mime_type");
  if (mimeType !== "application/json") {
    throw new Error("Canonical evidence objects must use application/json");
  }
  return {
    id: row.id,
    runId: row.run_id === null ? null : requireUuid(row.run_id, "run id"),
    agentId: row.agent_id === null ? null : requireUuid(row.agent_id, "agent id"),
    benchmarkId: row.benchmark_id,
    artifactId: requiredString(row.artifact_id, "artifact_id"),
    artifactType: requiredString(row.object_type, "object_type"),
    artifactSchemaVersion: requiredString(row.artifact_schema_version, "artifact_schema_version"),
    resourceId: requiredString(row.resource_id, "resource_id"),
    version: requiredVersion(row.version, "version"),
    idempotencyKey: row.idempotency_key,
    state: row.state,
    ipfsUri: row.ipfs_uri,
    greenfieldBucket: row.greenfield_bucket,
    greenfieldObject: row.greenfield_object,
    creationTransactionHash: optionalTransactionHash(row.creation_transaction_hash, "creation_transaction_hash"),
    sealTransactionHash: optionalTransactionHash(row.seal_transaction_hash, "seal_transaction_hash"),
    sha256Digest: requiredDigest(row.sha256_digest, "sha256_digest"),
    keccak256Digest: requiredDigest(row.keccak256_digest, "keccak256_digest"),
    sizeBytes: requiredNumber(row.size_bytes, "size_bytes"),
    mimeType: "application/json",
    readbackVerifiedAt: row.readback_verified_at === null ? null : fromDate(row.readback_verified_at, "readback_verified_at"),
    createdAt: fromDate(row.created_at, "created_at"),
    updatedAt: fromDate(row.updated_at, "updated_at")
  };
}

export function toEvidencePublicationAttemptRow(
  record: PublicationAttemptRecord,
  evidenceObjectId: string
): EvidencePublicationAttemptRow {
  requireUuid(record.attemptId, "publication attempt id");
  requireUuid(evidenceObjectId, "evidence object id");
  return {
    id: record.attemptId,
    evidence_object_id: evidenceObjectId,
    provider: record.provider,
    provider_label: record.providerLabel,
    idempotency_key: record.idempotencyKey,
    attempt_number: record.retryCount,
    configuration_digest: record.configurationDigest,
    configured_network: record.configuredNetwork,
    configured_bucket: record.configuredBucket,
    revision: record.revision,
    lease_owner: record.leaseOwner === null ? null : requireUuid(record.leaseOwner, "lease owner"),
    lease_expires_at: record.leaseExpiresAt === null ? null : asDate(record.leaseExpiresAt, "lease_expires_at"),
    object_name: record.objectName,
    state: record.state,
    provider_reference: record.providerReference,
    creation_transaction_hash: record.creationTransactionHash,
    seal_transaction_hash: record.sealTransactionHash,
    submitted_at: record.submittedAt === null ? null : asDate(record.submittedAt, "submitted_at"),
    last_error_code: record.lastErrorCode,
    sanitized_error: record.lastErrorMessage,
    retryable: record.retryable,
    started_at: record.startedAt === null ? null : asDate(record.startedAt, "started_at"),
    completed_at: record.completedAt === null ? null : asDate(record.completedAt, "completed_at"),
    created_at: asDate(record.createdAt, "created_at"),
    updated_at: asDate(record.updatedAt, "updated_at")
  };
}

export function fromEvidencePublicationAttemptRow(
  row: EvidencePublicationAttemptRow,
  object: EvidenceObjectRecord | EvidenceObjectRow,
  locator: EvidenceLocator | null,
  verification: VerificationResult | null
): PublicationAttemptRecord {
  const objectRecord = "artifactId" in object ? object : fromEvidenceObjectRow(object);
  if (row.evidence_object_id !== objectRecord.id) {
    throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Publication attempt is linked to a different evidence object", false);
  }
  const record = publicationAttemptRecordSchema.parse({
    attemptId: requireUuid(row.id, "publication attempt id"),
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    providerLabel: row.provider_label,
    configurationDigest: row.configuration_digest,
    configuredNetwork: row.configured_network,
    configuredBucket: row.configured_bucket,
    artifactId: objectRecord.artifactId,
    artifactType: objectRecord.artifactType,
    artifactVersion: requiredVersion(objectRecord.version, "artifact version"),
    objectName: row.object_name,
    sha256Digest: requiredString(objectRecord.sha256Digest, "sha256_digest"),
    keccak256Digest: requiredString(objectRecord.keccak256Digest, "keccak256_digest"),
    sizeBytes: objectRecord.sizeBytes,
    state: row.state,
    revision: row.revision,
    leaseOwner: row.lease_owner === null ? null : requireUuid(row.lease_owner, "lease owner"),
    leaseExpiresAt: row.lease_expires_at === null ? null : fromDate(row.lease_expires_at, "lease_expires_at"),
    providerReference: row.provider_reference,
    creationTransactionHash: row.creation_transaction_hash,
    sealTransactionHash: row.seal_transaction_hash,
    locator,
    verification,
    retryCount: row.attempt_number,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.sanitized_error,
    retryable: row.retryable,
    submittedAt: row.submitted_at === null ? null : fromDate(row.submitted_at, "submitted_at"),
    startedAt: row.started_at === null ? null : fromDate(row.started_at, "started_at"),
    completedAt: row.completed_at === null ? null : fromDate(row.completed_at, "completed_at"),
    createdAt: fromDate(row.created_at, "created_at"),
    updatedAt: fromDate(row.updated_at, "updated_at")
  });
  assertDurablePublicationAttempt(record);
  return record;
}

export function toEvidenceLocatorRow(
  locator: EvidenceLocator & { readonly evidenceObjectId: string },
  publicationAttemptId: string | null = null,
  createdAt: string | Date = new Date(0)
): EvidenceLocatorRow {
  requireUuid(locator.evidenceObjectId, "evidence object id");
  if (publicationAttemptId !== null) {
    requireUuid(publicationAttemptId, "publication attempt id");
  }
  return {
    id: deterministicUuid(`bnbera.evidence-locator:${locator.evidenceObjectId}:${locator.provider}:${locator.uri}`),
    evidence_object_id: locator.evidenceObjectId,
    publication_attempt_id: publicationAttemptId,
    provider: locator.provider,
    provider_label: locator.providerLabel,
    network: locator.network,
    uri: locator.uri,
    bucket: locator.bucket,
    object_name: locator.objectName,
    provider_reference: locator.providerReference,
    version: locator.version,
    sha256_digest: locator.sha256Digest,
    keccak256_digest: locator.keccak256Digest,
    size_bytes: locator.sizeBytes,
    immutable: true,
    verified_at: locator.verifiedAt === null ? null : asDate(locator.verifiedAt, "verified_at"),
    created_at: createdAt instanceof Date ? createdAt : asDate(createdAt, "created_at")
  };
}

export function fromEvidenceLocatorRow(row: EvidenceLocatorRow): EvidenceLocator {
  requireUuid(row.id, "evidence locator id");
  requireUuid(row.evidence_object_id, "evidence object id");
  if (row.publication_attempt_id !== null) {
    requireUuid(row.publication_attempt_id, "publication attempt id");
  }
  if (!row.immutable) {
    throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Evidence locator is not immutable", false);
  }
  return evidenceLocatorSchema.parse({
    provider: row.provider,
    providerLabel: row.provider_label,
    network: row.network,
    uri: row.uri,
    bucket: row.bucket,
    objectName: row.object_name,
    providerReference: row.provider_reference,
    version: row.version,
    sha256Digest: row.sha256_digest,
    keccak256Digest: row.keccak256_digest,
    sizeBytes: row.size_bytes,
    immutable: true,
    verifiedAt: row.verified_at === null ? null : fromDate(row.verified_at, "verified_at")
  });
}

export function toEvidenceVerificationResultRow(
  result: VerificationResult & { readonly evidenceObjectId: string },
  publicationAttemptId: string | null = null,
  createdAt: string | Date = new Date(0)
): EvidenceVerificationResultRow {
  requireUuid(result.evidenceObjectId, "evidence object id");
  if (publicationAttemptId !== null) {
    requireUuid(publicationAttemptId, "publication attempt id");
  }
  return {
    id: deterministicUuid(`bnbera.evidence-verification:${result.evidenceObjectId}:${result.checkedAt}`),
    evidence_object_id: result.evidenceObjectId,
    publication_attempt_id: publicationAttemptId,
    status: result.status,
    checked_at: asDate(result.checkedAt, "checked_at"),
    seal_confirmed: result.sealConfirmed,
    readback_status: result.readbackStatus,
    expected_sha256_digest: result.expectedSha256Digest,
    observed_sha256_digest: result.observedSha256Digest,
    expected_keccak256_digest: result.expectedKeccak256Digest,
    observed_keccak256_digest: result.observedKeccak256Digest,
    expected_size_bytes: result.expectedSizeBytes,
    observed_size_bytes: result.observedSizeBytes,
    hashes_match: result.hashesMatch,
    size_matches: result.sizeMatches,
    reason_code: result.reasonCode,
    created_at: createdAt instanceof Date ? createdAt : asDate(createdAt, "created_at")
  };
}

export function fromEvidenceVerificationResultRow(row: EvidenceVerificationResultRow): VerificationResult {
  requireUuid(row.id, "evidence verification id");
  requireUuid(row.evidence_object_id, "evidence object id");
  if (row.publication_attempt_id !== null) {
    requireUuid(row.publication_attempt_id, "publication attempt id");
  }
  return verificationResultSchema.parse({
    status: row.status,
    checkedAt: fromDate(row.checked_at, "checked_at"),
    sealConfirmed: row.seal_confirmed,
    readbackStatus: row.readback_status,
    expectedSha256Digest: row.expected_sha256_digest,
    observedSha256Digest: row.observed_sha256_digest,
    expectedKeccak256Digest: row.expected_keccak256_digest,
    observedKeccak256Digest: row.observed_keccak256_digest,
    expectedSizeBytes: row.expected_size_bytes,
    observedSizeBytes: row.observed_size_bytes,
    hashesMatch: row.hashes_match,
    sizeMatches: row.size_matches,
    reasonCode: row.reason_code
  });
}

export class InMemoryEvidenceObjectRepository implements EvidenceObjectRepository {
  private readonly objects = new Map<string, EvidenceObjectRecord>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<EvidenceObjectRecord | null> {
    for (const object of this.objects.values()) {
      if (object.idempotencyKey === idempotencyKey) {
        return object;
      }
    }
    return null;
  }

  async findById(id: string): Promise<EvidenceObjectRecord | null> {
    return this.objects.get(id) ?? null;
  }

  async save(record: EvidenceObjectRecord): Promise<void> {
    requireUuid(record.id, "evidence object id");
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (existing !== null && existing.sha256Digest !== record.sha256Digest) {
      throw new PublicationProviderError("DUPLICATE_IDEMPOTENCY_KEY", "Evidence idempotency key is already bound to different content", false);
    }
    if (existing !== null && existing.id !== record.id) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Evidence idempotency key already has an immutable object", false);
    }
    if (existing !== null) {
      for (const [field, label] of [
        ["agentId", "agent ownership"],
        ["runId", "run ownership"],
        ["resourceId", "resource binding"]
      ] as const) {
        const prior = existing[field];
        const incoming = record[field];
        if (prior !== null && incoming !== null && prior !== incoming) {
          throw new PublicationProviderError("DURABLE_GRAPH_INVALID", `Evidence ${label} changed`, false);
        }
      }
    }
    if (existing === null) {
      this.objects.set(record.id, record);
      return;
    }
    this.objects.set(record.id, {
      ...record,
      agentId: record.agentId ?? existing.agentId,
      runId: record.runId ?? existing.runId,
      resourceId: existing.resourceId,
      ipfsUri: record.ipfsUri ?? existing.ipfsUri,
      greenfieldBucket: record.greenfieldBucket ?? existing.greenfieldBucket,
      greenfieldObject: record.greenfieldObject ?? existing.greenfieldObject,
      creationTransactionHash: record.creationTransactionHash ?? existing.creationTransactionHash,
      sealTransactionHash: record.sealTransactionHash ?? existing.sealTransactionHash,
      readbackVerifiedAt: record.readbackVerifiedAt ?? existing.readbackVerifiedAt
    });
  }
}

export class InMemoryEvidenceLocatorRepository implements EvidenceLocatorRepository {
  private readonly locators = new Map<string, (EvidenceLocator & { readonly evidenceObjectId: string })[]>();

  async addLocator(locator: EvidenceLocator & { readonly evidenceObjectId: string }): Promise<void> {
    requireUuid(locator.evidenceObjectId, "evidence object id");
    const values = this.locators.get(locator.evidenceObjectId) ?? [];
    if (!values.some((existing) => existing.provider === locator.provider && existing.uri === locator.uri)) {
      values.push(locator);
    }
    this.locators.set(locator.evidenceObjectId, values);
  }

  async listLocatorsForObject(evidenceObjectId: string): Promise<readonly EvidenceLocator[]> {
    requireUuid(evidenceObjectId, "evidence object id");
    return this.locators.get(evidenceObjectId) ?? [];
  }
}

export class InMemoryEvidenceVerificationRepository implements EvidenceVerificationRepository {
  private readonly verifications = new Map<string, (VerificationResult & { readonly evidenceObjectId: string })[]>();

  async addVerification(result: VerificationResult & { readonly evidenceObjectId: string }): Promise<void> {
    requireUuid(result.evidenceObjectId, "evidence object id");
    const values = this.verifications.get(result.evidenceObjectId) ?? [];
    values.push(result);
    this.verifications.set(result.evidenceObjectId, values);
  }

  async listVerificationsForObject(evidenceObjectId: string): Promise<readonly VerificationResult[]> {
    requireUuid(evidenceObjectId, "evidence object id");
    return this.verifications.get(evidenceObjectId) ?? [];
  }
}

/** Adapter-backed repositories. A0 supplies transaction-scoped row
 * operations, object-id resolution, and provider-neutral persistence. */
export class PersistentEvidenceRepositories implements EvidenceRepositoryBundle {
  readonly objects: EvidenceObjectRepository;
  readonly attempts: EvidencePublicationAttemptRepository;
  readonly locators: EvidenceLocatorRepository;
  readonly verifications: EvidenceVerificationRepository;
  readonly unitOfWork: EvidencePublicationUnitOfWork;

  constructor(
    private readonly adapter: PersistentEvidenceAdapter,
    private readonly evidenceObjectIdForAttempt: (record: PublicationAttemptRecord) => string
  ) {
    this.objects = {
      findByIdempotencyKey: async (key) => {
        const row = await adapter.objects.findByIdempotencyKey(key);
        return row === null ? null : fromEvidenceObjectRow(row);
      },
      findById: async (id) => {
        const row = await adapter.objects.findById(id);
        return row === null ? null : fromEvidenceObjectRow(row);
      },
      save: async (record) => adapter.objects.save(toEvidenceObjectRow(record))
    };

    const hydrate = async (row: EvidencePublicationAttemptRow): Promise<PublicationAttemptRecord> => {
      const objectRow = await adapter.objects.findById(row.evidence_object_id);
      if (objectRow === null) {
        throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Publication attempt has no evidence object", false);
      }
      const object = fromEvidenceObjectRow(objectRow);
      const [locatorRow, verificationRow] = await Promise.all([
        adapter.locators.latestForAttempt(row.id),
        adapter.verifications.latestForAttempt(row.id)
      ]);
      if (locatorRow !== null && (locatorRow.evidence_object_id !== object.id || locatorRow.publication_attempt_id !== row.id)) {
        throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Locator is not correlated to its publication attempt", false);
      }
      if (
        verificationRow !== null &&
        (verificationRow.evidence_object_id !== object.id || verificationRow.publication_attempt_id !== row.id)
      ) {
        throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Verification is not correlated to its publication attempt", false);
      }
      return fromEvidencePublicationAttemptRow(
        row,
        object,
        locatorRow === null ? null : fromEvidenceLocatorRow(locatorRow),
        verificationRow === null ? null : fromEvidenceVerificationResultRow(verificationRow)
      );
    };

    this.attempts = {
      findByIdempotencyKey: async (key) => {
        const row = await adapter.attempts.findByIdempotencyKey(key);
        return row === null ? null : hydrate(row);
      },
      findByAttemptId: async (id) => {
        const row = await adapter.attempts.findByAttemptId(id);
        return row === null ? null : hydrate(row);
      },
      createOrGet: async (record) => {
        const row = toEvidencePublicationAttemptRow(record, this.evidenceObjectIdForAttempt(record));
        const result = await adapter.transaction((transaction) => transaction.attempts.createOrGet(row));
        return { record: await hydrate(result.row), created: result.created };
      },
      save: async (record, expectedRevision, leaseToken, now) => {
        const evidenceObjectId = this.evidenceObjectIdForAttempt(record);
        const row = toEvidencePublicationAttemptRow(record, evidenceObjectId);
        await adapter.transaction(async (transaction) => {
          await transaction.attempts.save(row, expectedRevision, leaseToken, now === undefined ? undefined : asDate(now, "now"));
          if (record.locator !== null) {
            await transaction.locators.add(toEvidenceLocatorRow({ ...record.locator, evidenceObjectId }, record.attemptId, record.updatedAt));
          }
          if (record.verification !== null) {
            await transaction.verifications.add(
              toEvidenceVerificationResultRow({ ...record.verification, evidenceObjectId }, record.attemptId, record.updatedAt)
            );
          }
        });
      },
      acquireLease: async (id, token, now, duration) => {
        const result = await adapter.attempts.acquireLease(id, token, asDate(now, "now"), duration);
        return {
          acquired: result.acquired,
          record: result.row === null ? null : await hydrate(result.row)
        };
      },
      releaseLease: async (id, token, now) => {
        const row = await adapter.attempts.releaseLease(id, token, now === undefined ? undefined : asDate(now, "now"));
        return row === null ? null : hydrate(row);
      },
      appendAudit: (event) => adapter.auditEvents.append(event)
    };

    this.locators = {
      addLocator: async (locator) => adapter.locators.add(toEvidenceLocatorRow(locator)),
      listLocatorsForObject: async (id) => {
        const rows = await adapter.locators.listForObject(requireUuid(id, "evidence object id"));
        return rows.map(fromEvidenceLocatorRow);
      }
    };

    this.verifications = {
      addVerification: async (result) => adapter.verifications.add(toEvidenceVerificationResultRow(result)),
      listVerificationsForObject: async (id) => {
        const rows = await adapter.verifications.listForObject(requireUuid(id, "evidence object id"));
        return rows.map(fromEvidenceVerificationResultRow);
      }
    };

    this.unitOfWork = {
      run: (work) => adapter.transaction((transaction) => work(new PersistentEvidenceRepositories(transaction, this.evidenceObjectIdForAttempt)))
    };
  }
}

export interface EvidenceObjectFactory {
  readonly create: (record: PublicationAttemptRecord) => EvidenceObjectRecord;
}

export interface EvidenceObjectBinding {
  readonly agentId: string | null;
  readonly agentVersionId: string | null;
  readonly runId: string | null;
  readonly jobId: string | null;
  readonly resourceId: string;
}

/** Stable object identity shared by IPFS and Greenfield attempts for one
 * immutable artifact version. Provider-specific idempotency remains on the
 * publication attempt row. */
export function deterministicEvidenceObjectId(record: PublicationAttemptRecord): string {
  return deterministicEvidenceObjectIdForBinding(record, {
    agentId: null,
    agentVersionId: null,
    runId: null,
    jobId: null,
    resourceId: record.artifactId
  });
}

/** Include every durable ownership/resource component in the object id. The
 * tuple is intentionally not shortened to artifact id/version: two persisted
 * resources with the same public label must never alias one evidence row. */
export function deterministicEvidenceObjectIdForBinding(
  record: PublicationAttemptRecord,
  binding: EvidenceObjectBinding
): string {
  return deterministicUuid([
    "bnbera.evidence-object",
    record.artifactType,
    record.artifactId,
    String(record.artifactVersion),
    binding.agentId ?? "",
    binding.agentVersionId ?? "",
    binding.runId ?? "",
    binding.jobId ?? "",
    binding.resourceId
  ].join(":"));
}

function defaultEvidenceObjectBinding(record: PublicationAttemptRecord): EvidenceObjectBinding {
  return {
    agentId: null,
    agentVersionId: null,
    runId: null,
    jobId: null,
    resourceId: record.artifactId
  };
}

export function defaultEvidenceObjectForAttempt(
  record: PublicationAttemptRecord,
  binding: EvidenceObjectBinding = defaultEvidenceObjectBinding(record)
): EvidenceObjectRecord {
  const timestamp = record.createdAt;
  return {
    id: deterministicEvidenceObjectIdForBinding(record, binding),
    runId: binding.runId,
    agentId: binding.agentId,
    benchmarkId: null,
    artifactId: record.artifactId,
    artifactType: record.artifactType,
    artifactSchemaVersion: "bnbera.evidence/v1",
    resourceId: binding.resourceId,
    version: record.artifactVersion,
    idempotencyKey: `artifact:${record.artifactType}:${record.artifactId}:${record.artifactVersion}`,
    state: "pending",
    ipfsUri: null,
    greenfieldBucket: record.provider === "greenfield" ? record.configuredBucket : null,
    greenfieldObject: null,
    creationTransactionHash: null,
    sealTransactionHash: null,
    sha256Digest: record.sha256Digest,
    keccak256Digest: record.keccak256Digest,
    sizeBytes: record.sizeBytes,
    mimeType: "application/json",
    readbackVerifiedAt: null,
    createdAt: timestamp,
    updatedAt: record.updatedAt
  };
}

/**
 * PublicationStore facade that creates the shared evidence object and its
 * provider attempt atomically. The underlying adapter's transaction-scoped
 * implementation gives create-or-get and object insertion one unit of work.
 */
export class PersistentEvidencePublicationStore implements PublicationStore {
  private readonly repositories: PersistentEvidenceRepositories;
  private readonly evidenceObjectFactory: EvidenceObjectFactory;
  private readonly evidenceObjectIdForAttempt: (record: PublicationAttemptRecord) => string;

  constructor(
    private readonly adapter: PersistentEvidenceAdapter,
    options?: {
      readonly evidenceObjectIdForAttempt?: (record: PublicationAttemptRecord) => string;
      readonly evidenceObjectFactory?: EvidenceObjectFactory;
    }
  ) {
    this.evidenceObjectIdForAttempt = options?.evidenceObjectIdForAttempt ?? deterministicEvidenceObjectId;
    this.repositories = new PersistentEvidenceRepositories(
      adapter,
      this.evidenceObjectIdForAttempt
    );
    this.evidenceObjectFactory = options?.evidenceObjectFactory ?? { create: defaultEvidenceObjectForAttempt };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<PublicationAttemptRecord | null> {
    return this.repositories.attempts.findByIdempotencyKey(idempotencyKey);
  }

  async findByAttemptId(attemptId: string): Promise<PublicationAttemptRecord | null> {
    return this.repositories.attempts.findByAttemptId(attemptId);
  }

  async createOrGet(record: PublicationAttemptRecord): Promise<{ readonly record: PublicationAttemptRecord; readonly created: boolean }> {
    const object = this.evidenceObjectFactory.create(record);
    const objectId = this.evidenceObjectIdForAttempt(record);
    if (object.id !== objectId) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Evidence object factory returned an inconsistent id", false);
    }
    return this.adapter.transaction(async (transaction) => {
      await transaction.objects.save(toEvidenceObjectRow(object));
      const repositories = new PersistentEvidenceRepositories(transaction, this.evidenceObjectIdForAttempt);
      return repositories.attempts.createOrGet(record);
    });
  }

  save(record: PublicationAttemptRecord, expectedRevision: number, leaseToken: string, now?: string): Promise<void> {
    return this.repositories.attempts.save(record, expectedRevision, leaseToken, now);
  }

  acquireLease(
    attemptId: string,
    leaseToken: string,
    now: string,
    durationMs: number
  ): Promise<{ readonly acquired: boolean; readonly record: PublicationAttemptRecord | null }> {
    return this.repositories.attempts.acquireLease(attemptId, leaseToken, now, durationMs);
  }

  releaseLease(attemptId: string, leaseToken: string, now?: string): Promise<PublicationAttemptRecord | null> {
    return this.repositories.attempts.releaseLease(attemptId, leaseToken, now);
  }

  appendAudit(event: PublicationAuditEvent): Promise<void> {
    return this.repositories.attempts.appendAudit(event);
  }
}

/** Deterministic repository bundle for local adapter tests and contract tests. */
export class InMemoryEvidenceRepositories implements EvidenceRepositoryBundle {
  readonly objects = new InMemoryEvidenceObjectRepository();
  readonly attempts: EvidencePublicationAttemptRepository = new InMemoryPublicationStore();
  readonly locators = new InMemoryEvidenceLocatorRepository();
  readonly verifications = new InMemoryEvidenceVerificationRepository();
  readonly unitOfWork: EvidencePublicationUnitOfWork = {
    run: async <T>(work: (repositories: EvidenceRepositoryBundle) => Promise<T>): Promise<T> => work(this)
  };
}
