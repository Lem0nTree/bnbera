import type { EvidenceLocator, VerificationResult } from "@bnbera/evidence";
import type { EvidenceState } from "@bnbera/domain";
import type {
  PublicationAttemptRecord,
  PublicationAuditEvent,
  PublicationStore
} from "./types.js";
import { publicationAttemptRecordSchema } from "./types.js";
import { InMemoryPublicationStore } from "./store.js";

/** Metadata persisted for one immutable canonical artifact version. Raw bytes
 * are intentionally absent; providers are responsible for storage payloads. */
export interface EvidenceObjectRecord {
  readonly id: string;
  readonly artifactId: string;
  readonly artifactType: string;
  readonly artifactSchemaVersion: string;
  readonly resourceId: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly state: EvidenceState;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly mimeType: "application/json";
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

/**
 * Persistence boundary for A0's database adapter. The snake_case row types
 * deliberately mirror the allocated evidence tables, while this package stays
 * independent of Drizzle, a database driver, provider SDKs, and credentials.
 */
export interface EvidenceObjectRow {
  readonly id: string;
  readonly artifact_id: string;
  readonly object_type: string;
  readonly artifact_schema_version: string;
  readonly resource_id: string;
  readonly version: number;
  readonly idempotency_key: string;
  readonly state: EvidenceState;
  readonly sha256_digest: string;
  readonly keccak256_digest: string;
  readonly size_bytes: number;
  readonly mime_type: "application/json";
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EvidencePublicationAttemptRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly provider: PublicationAttemptRecord["provider"];
  readonly idempotency_key: string;
  readonly attempt_number: number;
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly artifact_version: number;
  readonly object_name: string;
  readonly sha256_digest: string;
  readonly keccak256_digest: string;
  readonly size_bytes: number;
  readonly state: PublicationAttemptRecord["state"];
  readonly provider_reference: string | null;
  readonly creation_transaction_hash: string | null;
  readonly seal_transaction_hash: string | null;
  readonly submitted_at: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly retryable: boolean;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
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
  readonly immutable: true;
  readonly verified_at: string | null;
}

export interface EvidenceVerificationResultRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly publication_attempt_id: string | null;
  readonly status: VerificationResult["status"];
  readonly checked_at: string;
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
}

/**
 * A database implementation supplies these methods using a transaction for
 * createOrGet and a compare-and-set lease for acquireLease. No implementation
 * here performs persistence; this is the seam A0 can bind to Postgres.
 */
export interface PersistentEvidenceAdapter {
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
    readonly save: (row: EvidencePublicationAttemptRow) => Promise<void>;
    readonly acquireLease: (attemptId: string, leaseToken: string, now: string, durationMs: number) => Promise<boolean>;
    readonly releaseLease: (attemptId: string, leaseToken: string) => Promise<void>;
  };
  readonly locators: {
    readonly add: (row: EvidenceLocatorRow) => Promise<void>;
    readonly listForObject: (evidenceObjectId: string) => Promise<readonly EvidenceLocatorRow[]>;
    readonly latestForAttempt: (attemptId: string) => Promise<EvidenceLocator | null>;
  };
  readonly verifications: {
    readonly add: (row: EvidenceVerificationResultRow) => Promise<void>;
    readonly listForObject: (evidenceObjectId: string) => Promise<readonly EvidenceVerificationResultRow[]>;
    readonly latestForAttempt: (attemptId: string) => Promise<VerificationResult | null>;
  };
  readonly auditEvents: {
    readonly append: (event: PublicationAuditEvent) => Promise<void>;
  };
}

export function toEvidenceObjectRow(record: EvidenceObjectRecord): EvidenceObjectRow {
  return {
    id: record.id,
    artifact_id: record.artifactId,
    object_type: record.artifactType,
    artifact_schema_version: record.artifactSchemaVersion,
    resource_id: record.resourceId,
    version: record.version,
    idempotency_key: record.idempotencyKey,
    state: record.state,
    sha256_digest: record.sha256Digest,
    keccak256_digest: record.keccak256Digest,
    size_bytes: record.sizeBytes,
    mime_type: record.mimeType,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export function fromEvidenceObjectRow(row: EvidenceObjectRow): EvidenceObjectRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    artifactType: row.object_type,
    artifactSchemaVersion: row.artifact_schema_version,
    resourceId: row.resource_id,
    version: row.version,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    sha256Digest: row.sha256_digest,
    keccak256Digest: row.keccak256_digest,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toEvidencePublicationAttemptRow(
  record: PublicationAttemptRecord,
  evidenceObjectId: string
): EvidencePublicationAttemptRow {
  return {
    id: record.attemptId,
    evidence_object_id: evidenceObjectId,
    provider: record.provider,
    idempotency_key: record.idempotencyKey,
    attempt_number: record.retryCount,
    artifact_id: record.artifactId,
    artifact_type: record.artifactType,
    artifact_version: record.artifactVersion,
    object_name: record.objectName,
    sha256_digest: record.sha256Digest,
    keccak256_digest: record.keccak256Digest,
    size_bytes: record.sizeBytes,
    state: record.state,
    provider_reference: record.providerReference,
    creation_transaction_hash: record.creationTransactionHash,
    seal_transaction_hash: record.sealTransactionHash,
    submitted_at: record.submittedAt,
    last_error_code: record.lastErrorCode,
    last_error_message: record.lastErrorMessage,
    retryable: record.retryable,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

export function fromEvidencePublicationAttemptRow(
  row: EvidencePublicationAttemptRow,
  locator: EvidenceLocator | null,
  verification: VerificationResult | null
): PublicationAttemptRecord {
  return publicationAttemptRecordSchema.parse({
    attemptId: row.id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    artifactId: row.artifact_id,
    artifactType: row.artifact_type,
    artifactVersion: row.artifact_version,
    objectName: row.object_name,
    sha256Digest: row.sha256_digest,
    keccak256Digest: row.keccak256_digest,
    sizeBytes: row.size_bytes,
    state: row.state,
    providerReference: row.provider_reference,
    creationTransactionHash: row.creation_transaction_hash,
    sealTransactionHash: row.seal_transaction_hash,
    locator,
    verification,
    retryCount: row.attempt_number,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    retryable: row.retryable,
    submittedAt: row.submitted_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export function toEvidenceLocatorRow(
  locator: EvidenceLocator & { readonly evidenceObjectId: string },
  publicationAttemptId: string | null = null
): EvidenceLocatorRow {
  return {
    id: `${locator.evidenceObjectId}:${locator.provider}:${locator.uri}`,
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
    verified_at: locator.verifiedAt
  };
}

export function fromEvidenceLocatorRow(row: EvidenceLocatorRow): EvidenceLocator {
  return {
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
    verifiedAt: row.verified_at
  };
}

export function toEvidenceVerificationResultRow(
  result: VerificationResult & { readonly evidenceObjectId: string },
  publicationAttemptId: string | null = null
): EvidenceVerificationResultRow {
  return {
    id: `${result.evidenceObjectId}:${result.checkedAt}`,
    evidence_object_id: result.evidenceObjectId,
    publication_attempt_id: publicationAttemptId,
    status: result.status,
    checked_at: result.checkedAt,
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
    reason_code: result.reasonCode
  };
}

export function fromEvidenceVerificationResultRow(row: EvidenceVerificationResultRow): VerificationResult {
  return {
    status: row.status,
    checkedAt: row.checked_at,
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
  };
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
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (existing !== null && existing.sha256Digest !== record.sha256Digest) {
      throw new Error("Evidence idempotency key is already bound to different content");
    }
    if (existing !== null && existing.id !== record.id) {
      throw new Error("Evidence idempotency key already has an immutable object");
    }
    this.objects.set(record.id, record);
  }
}

export class InMemoryEvidenceLocatorRepository implements EvidenceLocatorRepository {
  private readonly locators = new Map<string, (EvidenceLocator & { readonly evidenceObjectId: string })[]>();

  async addLocator(locator: EvidenceLocator & { readonly evidenceObjectId: string }): Promise<void> {
    const values = this.locators.get(locator.evidenceObjectId) ?? [];
    if (!values.some((existing) => existing.provider === locator.provider && existing.uri === locator.uri)) {
      values.push(locator);
    }
    this.locators.set(locator.evidenceObjectId, values);
  }

  async listLocatorsForObject(evidenceObjectId: string): Promise<readonly EvidenceLocator[]> {
    return this.locators.get(evidenceObjectId) ?? [];
  }
}

export class InMemoryEvidenceVerificationRepository implements EvidenceVerificationRepository {
  private readonly verifications = new Map<string, (VerificationResult & { readonly evidenceObjectId: string })[]>();

  async addVerification(result: VerificationResult & { readonly evidenceObjectId: string }): Promise<void> {
    const values = this.verifications.get(result.evidenceObjectId) ?? [];
    values.push(result);
    this.verifications.set(result.evidenceObjectId, values);
  }

  async listVerificationsForObject(evidenceObjectId: string): Promise<readonly VerificationResult[]> {
    return this.verifications.get(evidenceObjectId) ?? [];
  }
}

/** Adapter-backed repositories. A0 supplies row operations and object-id
 * resolution; this layer owns the mapping and hydration contract. */
export class PersistentEvidenceRepositories {
  readonly objects: EvidenceObjectRepository;
  readonly attempts: EvidencePublicationAttemptRepository;
  readonly locators: EvidenceLocatorRepository;
  readonly verifications: EvidenceVerificationRepository;

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
      const [locator, verification] = await Promise.all([
        adapter.locators.latestForAttempt(row.id),
        adapter.verifications.latestForAttempt(row.id)
      ]);
      return fromEvidencePublicationAttemptRow(row, locator, verification);
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
        const result = await adapter.attempts.createOrGet(
          toEvidencePublicationAttemptRow(record, evidenceObjectIdForAttempt(record))
        );
        return { record: await hydrate(result.row), created: result.created };
      },
      save: async (record) => adapter.attempts.save(toEvidencePublicationAttemptRow(record, evidenceObjectIdForAttempt(record))),
      acquireLease: (id, token, now, duration) => adapter.attempts.acquireLease(id, token, now, duration),
      releaseLease: (id, token) => adapter.attempts.releaseLease(id, token),
      appendAudit: (event) => adapter.auditEvents.append(event)
    };

    this.locators = {
      addLocator: async (locator) => adapter.locators.add(toEvidenceLocatorRow(locator)),
      listLocatorsForObject: async (id) => {
        const rows = await adapter.locators.listForObject(id);
        return rows.map(fromEvidenceLocatorRow);
      }
    };

    this.verifications = {
      addVerification: async (result) => adapter.verifications.add(toEvidenceVerificationResultRow(result)),
      listVerificationsForObject: async (id) => {
        const rows = await adapter.verifications.listForObject(id);
        return rows.map(fromEvidenceVerificationResultRow);
      }
    };
  }
}

/** Deterministic repository bundle for local adapter tests and contract tests. */
export class InMemoryEvidenceRepositories {
  readonly objects = new InMemoryEvidenceObjectRepository();
  readonly attempts: EvidencePublicationAttemptRepository = new InMemoryPublicationStore();
  readonly locators = new InMemoryEvidenceLocatorRepository();
  readonly verifications = new InMemoryEvidenceVerificationRepository();
}
