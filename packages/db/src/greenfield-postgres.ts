import pg from "pg";
import type { EvidenceState } from "@bnbera/domain";

const { Pool } = pg;

type QueryRow = Record<string, unknown>;
type QueryResult = { readonly rows: readonly QueryRow[]; readonly rowCount: number | null };
type QueryExecutor = (text: string, values?: readonly unknown[]) => Promise<QueryResult>;

export type GreenfieldPublicationProvider = "ipfs" | "greenfield";
export type GreenfieldPublicationState =
  | "pending"
  | "validating"
  | "creating_object"
  | "submitted"
  | "uploading"
  | "awaiting_seal"
  | "reading_back"
  | "verified"
  | "validation_failed"
  | "create_failed"
  | "upload_failed"
  | "seal_timeout"
  | "readback_failed"
  | "hash_mismatch"
  | "duplicate"
  | "provider_failed"
  | "retrying";

export interface GreenfieldEvidenceObjectRow {
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

export interface GreenfieldPublicationAttemptRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly provider: GreenfieldPublicationProvider;
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
  readonly state: GreenfieldPublicationState;
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

export interface GreenfieldLocatorRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly publication_attempt_id: string | null;
  readonly provider: GreenfieldPublicationProvider;
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

export interface GreenfieldVerificationRow {
  readonly id: string;
  readonly evidence_object_id: string;
  readonly publication_attempt_id: string | null;
  readonly status: "not_verified" | "verified" | "failed";
  readonly seal_confirmed: boolean | null;
  readonly readback_status: "not_attempted" | "matched" | "missing" | "corrupt" | "timeout" | "provider_failed";
  readonly expected_sha256_digest: string;
  readonly observed_sha256_digest: string | null;
  readonly expected_keccak256_digest: string;
  readonly observed_keccak256_digest: string | null;
  readonly expected_size_bytes: number;
  readonly observed_size_bytes: number | null;
  readonly hashes_match: boolean;
  readonly size_matches: boolean;
  readonly reason_code: string | null;
  readonly checked_at: Date;
  readonly created_at: Date;
}

export interface GreenfieldPublicationAuditEvent {
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly action: "validation_failed";
  readonly reasonCode: string;
  readonly message: string;
  readonly createdAt: string;
}

export class GreenfieldPostgresError extends Error {
  readonly code: "DUPLICATE_IDEMPOTENCY_KEY" | "CONCURRENT_UPDATE" | "LEASE_LOST" | "DURABLE_GRAPH_INVALID";
  readonly retryable: boolean;

  constructor(
    code: "DUPLICATE_IDEMPOTENCY_KEY" | "CONCURRENT_UPDATE" | "LEASE_LOST" | "DURABLE_GRAPH_INVALID",
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = "GreenfieldPostgresError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface GreenfieldPostgresAdapterOptions {
  readonly ssl?: boolean;
  readonly poolMax?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
}

const objectColumns = `
  id, run_id, agent_id, benchmark_id, artifact_id, object_type,
  artifact_schema_version, resource_id, version, idempotency_key, state,
  ipfs_uri, greenfield_bucket, greenfield_object, creation_transaction_hash,
  seal_transaction_hash, sha256_digest, keccak256_digest, size_bytes, mime_type,
  readback_verified_at, "createdAt" AS created_at, "updatedAt" AS updated_at
`;

const attemptColumns = `
  id, evidence_object_id, provider, provider_label, idempotency_key,
  attempt_number, configuration_digest, configured_network, configured_bucket,
  revision, lease_owner, lease_expires_at, object_name, state,
  provider_reference, creation_transaction_hash, seal_transaction_hash,
  submitted_at, last_error_code, sanitized_error, retryable, started_at,
  completed_at, "createdAt" AS created_at, "updatedAt" AS updated_at
`;

const locatorColumns = `
  id, evidence_object_id, publication_attempt_id, provider, provider_label,
  network, uri, bucket, object_name, provider_reference, version,
  sha256_digest, keccak256_digest, size_bytes, immutable, verified_at,
  "createdAt" AS created_at
`;

const verificationColumns = `
  id, evidence_object_id, publication_attempt_id, status, seal_confirmed,
  readback_status, expected_sha256_digest, observed_sha256_digest,
  expected_keccak256_digest, observed_keccak256_digest, expected_size_bytes,
  observed_size_bytes, hashes_match, size_matches, reason_code, checked_at,
  "createdAt" AS created_at
`;

function asDate(value: unknown, field: string): Date {
  const result = value instanceof Date ? new Date(value.valueOf()) : new Date(String(value));
  if (!Number.isFinite(result.valueOf())) throw new Error(`${field} is not a valid timestamp`);
  return result;
}

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value, "database timestamp");
}

function asNumber(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : Number(String(value));
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${field} is not a safe non-negative integer`);
  return result;
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value, "database integer");
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is not a string`);
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function objectRow(row: QueryRow): GreenfieldEvidenceObjectRow {
  return {
    id: asString(row.id, "evidence object id"),
    run_id: asNullableString(row.run_id),
    agent_id: asNullableString(row.agent_id),
    benchmark_id: asNullableString(row.benchmark_id),
    artifact_id: asString(row.artifact_id, "artifact id"),
    object_type: asString(row.object_type, "object type"),
    artifact_schema_version: asString(row.artifact_schema_version, "artifact schema version"),
    resource_id: asString(row.resource_id, "resource id"),
    version: asNumber(row.version, "artifact version"),
    idempotency_key: asString(row.idempotency_key, "idempotency key"),
    state: asString(row.state, "evidence state") as EvidenceState,
    ipfs_uri: asNullableString(row.ipfs_uri),
    greenfield_bucket: asNullableString(row.greenfield_bucket),
    greenfield_object: asNullableString(row.greenfield_object),
    creation_transaction_hash: asNullableString(row.creation_transaction_hash),
    seal_transaction_hash: asNullableString(row.seal_transaction_hash),
    sha256_digest: asNullableString(row.sha256_digest),
    keccak256_digest: asNullableString(row.keccak256_digest),
    size_bytes: asNullableNumber(row.size_bytes),
    mime_type: asNullableString(row.mime_type),
    readback_verified_at: asNullableDate(row.readback_verified_at),
    created_at: asDate(row.created_at, "created_at"),
    updated_at: asDate(row.updated_at, "updated_at")
  };
}

function attemptRow(row: QueryRow): GreenfieldPublicationAttemptRow {
  return {
    id: asString(row.id, "publication attempt id"),
    evidence_object_id: asString(row.evidence_object_id, "evidence object id"),
    provider: asString(row.provider, "provider") as GreenfieldPublicationProvider,
    provider_label: asString(row.provider_label, "provider label"),
    idempotency_key: asString(row.idempotency_key, "idempotency key"),
    attempt_number: asNumber(row.attempt_number, "attempt number"),
    configuration_digest: asString(row.configuration_digest, "configuration digest"),
    configured_network: asString(row.configured_network, "configured network"),
    configured_bucket: asNullableString(row.configured_bucket),
    revision: asNumber(row.revision, "revision"),
    lease_owner: asNullableString(row.lease_owner),
    lease_expires_at: asNullableDate(row.lease_expires_at),
    object_name: asString(row.object_name, "object name"),
    state: asString(row.state, "publication state") as GreenfieldPublicationState,
    provider_reference: asNullableString(row.provider_reference),
    creation_transaction_hash: asNullableString(row.creation_transaction_hash),
    seal_transaction_hash: asNullableString(row.seal_transaction_hash),
    submitted_at: asNullableDate(row.submitted_at),
    last_error_code: asNullableString(row.last_error_code),
    sanitized_error: asNullableString(row.sanitized_error),
    retryable: Boolean(row.retryable),
    started_at: asNullableDate(row.started_at),
    completed_at: asNullableDate(row.completed_at),
    created_at: asDate(row.created_at, "created_at"),
    updated_at: asDate(row.updated_at, "updated_at")
  };
}

function locatorRow(row: QueryRow): GreenfieldLocatorRow {
  return {
    id: asString(row.id, "locator id"),
    evidence_object_id: asString(row.evidence_object_id, "evidence object id"),
    publication_attempt_id: asNullableString(row.publication_attempt_id),
    provider: asString(row.provider, "provider") as GreenfieldPublicationProvider,
    provider_label: asString(row.provider_label, "provider label"),
    network: asString(row.network, "network"),
    uri: asString(row.uri, "locator URI"),
    bucket: asNullableString(row.bucket),
    object_name: asNullableString(row.object_name),
    provider_reference: asNullableString(row.provider_reference),
    version: asNumber(row.version, "locator version"),
    sha256_digest: asString(row.sha256_digest, "locator sha256"),
    keccak256_digest: asString(row.keccak256_digest, "locator keccak256"),
    size_bytes: asNumber(row.size_bytes, "locator size"),
    immutable: Boolean(row.immutable),
    verified_at: asNullableDate(row.verified_at),
    created_at: asDate(row.created_at, "created_at")
  };
}

function verificationRow(row: QueryRow): GreenfieldVerificationRow {
  return {
    id: asString(row.id, "verification id"),
    evidence_object_id: asString(row.evidence_object_id, "evidence object id"),
    publication_attempt_id: asNullableString(row.publication_attempt_id),
    status: asString(row.status, "verification status") as GreenfieldVerificationRow["status"],
    seal_confirmed: row.seal_confirmed === null || row.seal_confirmed === undefined ? null : Boolean(row.seal_confirmed),
    readback_status: asString(row.readback_status, "readback status") as GreenfieldVerificationRow["readback_status"],
    expected_sha256_digest: asString(row.expected_sha256_digest, "expected sha256"),
    observed_sha256_digest: asNullableString(row.observed_sha256_digest),
    expected_keccak256_digest: asString(row.expected_keccak256_digest, "expected keccak256"),
    observed_keccak256_digest: asNullableString(row.observed_keccak256_digest),
    expected_size_bytes: asNumber(row.expected_size_bytes, "expected size"),
    observed_size_bytes: asNullableNumber(row.observed_size_bytes),
    hashes_match: Boolean(row.hashes_match),
    size_matches: Boolean(row.size_matches),
    reason_code: asNullableString(row.reason_code),
    checked_at: asDate(row.checked_at, "checked_at"),
    created_at: asDate(row.created_at, "created_at")
  };
}

function rowCount(result: QueryResult): number {
  return result.rowCount ?? result.rows.length;
}

function sqlState(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? typeof (error as { readonly code?: unknown }).code === "string"
      ? (error as { readonly code: string }).code
      : null
    : null;
}

function isoOrDate(value: Date | undefined): Date {
  return value === undefined ? new Date() : new Date(value.valueOf());
}

function compareImmutableObject(existing: GreenfieldEvidenceObjectRow, incoming: GreenfieldEvidenceObjectRow): void {
  const fields: readonly [keyof GreenfieldEvidenceObjectRow, string][] = [
    ["artifact_id", "artifact id"],
    ["object_type", "object type"],
    ["artifact_schema_version", "artifact schema version"],
    ["resource_id", "resource id"],
    ["version", "artifact version"],
    ["sha256_digest", "sha256 digest"],
    ["keccak256_digest", "keccak256 digest"],
    ["size_bytes", "size"],
    ["mime_type", "mime type"]
  ];
  for (const [field, label] of fields) {
    if (existing[field] !== incoming[field]) {
      throw new GreenfieldPostgresError("DUPLICATE_IDEMPOTENCY_KEY", `Evidence idempotency key is bound to different ${label}`);
    }
  }
  for (const [field, label] of [
    ["agent_id", "agent ownership"],
    ["run_id", "run ownership"],
    ["resource_id", "resource binding"]
  ] as const) {
    const prior = existing[field];
    const incomingValue = incoming[field];
    if (prior !== null && incomingValue !== null && prior !== incomingValue) {
      throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", `Evidence ${label} changed`);
    }
  }
}

function compareAttemptIdentity(existing: GreenfieldPublicationAttemptRow, incoming: GreenfieldPublicationAttemptRow): void {
  const fields: readonly [keyof GreenfieldPublicationAttemptRow, string][] = [
    ["evidence_object_id", "evidence object"],
    ["provider", "provider"],
    ["provider_label", "provider label"],
    ["configuration_digest", "configuration"],
    ["configured_network", "network"],
    ["configured_bucket", "bucket"],
    ["object_name", "object name"]
  ];
  for (const [field, label] of fields) {
    if (existing[field] !== incoming[field]) {
      throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", `Publication attempt ${label} changed`);
    }
  }
}

function evidenceStateFor(state: GreenfieldPublicationState): string {
  if (state === "submitted") return "creating_object";
  if (state === "duplicate" || state === "provider_failed" || state === "retrying") return "pending";
  return state;
}

function compareLocator(existing: GreenfieldLocatorRow, incoming: GreenfieldLocatorRow): void {
  const fields: readonly [keyof GreenfieldLocatorRow, string][] = [
    ["evidence_object_id", "evidence object"],
    ["provider", "provider"],
    ["provider_label", "provider label"],
    ["network", "network"],
    ["bucket", "bucket"],
    ["object_name", "object name"],
    ["provider_reference", "provider reference"],
    ["version", "version"],
    ["sha256_digest", "sha256 digest"],
    ["keccak256_digest", "keccak256 digest"],
    ["size_bytes", "size"]
  ];
  for (const [field, label] of fields) {
    if (existing[field] !== incoming[field]) {
      throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", `Locator URI is already bound to a different ${label}`);
    }
  }
  if (!existing.immutable) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Existing locator is mutable");
}

/**
 * Transaction-scoped PostgreSQL implementation for the existing evidence
 * tables. It intentionally has no schema/migration ownership: deployments
 * must run the active DB migrations separately.
 */
export class GreenfieldPostgresAdapter {
  readonly pool: pg.Pool | null;
  private readonly execute: QueryExecutor;
  private readonly scoped: boolean;

  constructor(connection: string | pg.Pool | pg.PoolClient, options?: GreenfieldPostgresAdapterOptions & { readonly scoped?: boolean }) {
    this.scoped = options?.scoped === true;
    if (typeof connection === "string") {
      this.pool = new Pool({
        connectionString: connection,
        ssl: options?.ssl === true ? { rejectUnauthorized: true } : undefined,
        ...(options?.poolMax === undefined ? {} : { max: options.poolMax }),
        ...(options?.idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis: options.idleTimeoutMillis }),
        ...(options?.connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis: options.connectionTimeoutMillis })
      });
      this.execute = (text, values) => this.pool!.query(text, values === undefined ? [] : [...values]) as Promise<QueryResult>;
    } else if ("connect" in connection && typeof connection.connect === "function") {
      this.pool = connection as pg.Pool;
      this.execute = (text, values) => this.pool!.query(text, values === undefined ? [] : [...values]) as Promise<QueryResult>;
    } else {
      this.pool = null;
      this.execute = (text, values) => connection.query(text, values === undefined ? [] : [...values]) as Promise<QueryResult>;
    }
  }

  async transaction<T>(work: (transaction: GreenfieldPostgresAdapter) => Promise<T>): Promise<T> {
    if (this.scoped || this.pool === null) return work(this);
    const client = await this.pool.connect();
    const scoped = new GreenfieldPostgresAdapter(client, { scoped: true });
    try {
      await client.query("BEGIN");
      const result = await work(scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original transaction failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  readonly objects = {
    findByIdempotencyKey: async (idempotencyKey: string): Promise<GreenfieldEvidenceObjectRow | null> => {
      const result = await this.execute(`SELECT ${objectColumns} FROM evidence_objects WHERE idempotency_key = $1`, [idempotencyKey]);
      return result.rows[0] === undefined ? null : objectRow(result.rows[0]);
    },
    findById: async (id: string): Promise<GreenfieldEvidenceObjectRow | null> => {
      const result = await this.execute(`SELECT ${objectColumns} FROM evidence_objects WHERE id = $1`, [id]);
      return result.rows[0] === undefined ? null : objectRow(result.rows[0]);
    },
    save: async (row: GreenfieldEvidenceObjectRow): Promise<void> => {
      const existing = await this.objects.findByIdempotencyKey(row.idempotency_key);
      if (existing !== null) {
        if (existing.id !== row.id) {
          throw new GreenfieldPostgresError("DUPLICATE_IDEMPOTENCY_KEY", "Evidence idempotency key is already bound to another object");
        }
        compareImmutableObject(existing, row);
      }
      try {
        await this.execute(
          `INSERT INTO evidence_objects (
             id, run_id, agent_id, benchmark_id, artifact_id, object_type,
             artifact_schema_version, resource_id, version, idempotency_key,
             state, ipfs_uri, greenfield_bucket, greenfield_object,
             creation_transaction_hash, seal_transaction_hash, sha256_digest,
             keccak256_digest, size_bytes, mime_type, readback_verified_at,
           "createdAt", "updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
           ON CONFLICT (id) DO UPDATE SET
             run_id = COALESCE(EXCLUDED.run_id, evidence_objects.run_id),
             agent_id = COALESCE(EXCLUDED.agent_id, evidence_objects.agent_id),
             benchmark_id = EXCLUDED.benchmark_id,
             state = CASE WHEN evidence_objects.state <> 'pending' THEN evidence_objects.state ELSE EXCLUDED.state END,
             ipfs_uri = COALESCE(EXCLUDED.ipfs_uri, evidence_objects.ipfs_uri),
             greenfield_bucket = COALESCE(EXCLUDED.greenfield_bucket, evidence_objects.greenfield_bucket),
             greenfield_object = COALESCE(EXCLUDED.greenfield_object, evidence_objects.greenfield_object),
             creation_transaction_hash = COALESCE(EXCLUDED.creation_transaction_hash, evidence_objects.creation_transaction_hash),
             seal_transaction_hash = COALESCE(EXCLUDED.seal_transaction_hash, evidence_objects.seal_transaction_hash),
             sha256_digest = COALESCE(EXCLUDED.sha256_digest, evidence_objects.sha256_digest),
             keccak256_digest = COALESCE(EXCLUDED.keccak256_digest, evidence_objects.keccak256_digest),
             size_bytes = COALESCE(EXCLUDED.size_bytes, evidence_objects.size_bytes),
             mime_type = COALESCE(EXCLUDED.mime_type, evidence_objects.mime_type),
             readback_verified_at = COALESCE(EXCLUDED.readback_verified_at, evidence_objects.readback_verified_at),
             "updatedAt" = EXCLUDED."updatedAt"`,
          [
            row.id,
            row.run_id,
            row.agent_id,
            row.benchmark_id,
            row.artifact_id,
            row.object_type,
            row.artifact_schema_version,
            row.resource_id,
            row.version,
            row.idempotency_key,
            row.state,
            row.ipfs_uri,
            row.greenfield_bucket,
            row.greenfield_object,
            row.creation_transaction_hash,
            row.seal_transaction_hash,
            row.sha256_digest,
            row.keccak256_digest,
            row.size_bytes,
            row.mime_type,
            row.readback_verified_at,
            row.created_at,
            row.updated_at
          ]
        );
      } catch (error) {
        if (sqlState(error) === "23505") {
          throw new GreenfieldPostgresError("DUPLICATE_IDEMPOTENCY_KEY", "Evidence object conflicts with an existing immutable key");
        }
        throw error;
      }
    }
  };

  readonly attempts = {
    findByIdempotencyKey: async (idempotencyKey: string): Promise<GreenfieldPublicationAttemptRow | null> => {
      const result = await this.execute(`SELECT ${attemptColumns} FROM evidence_publication_attempts WHERE idempotency_key = $1`, [idempotencyKey]);
      return result.rows[0] === undefined ? null : attemptRow(result.rows[0]);
    },
    findByAttemptId: async (attemptId: string): Promise<GreenfieldPublicationAttemptRow | null> => {
      const result = await this.execute(`SELECT ${attemptColumns} FROM evidence_publication_attempts WHERE id = $1`, [attemptId]);
      return result.rows[0] === undefined ? null : attemptRow(result.rows[0]);
    },
    createOrGet: async (row: GreenfieldPublicationAttemptRow): Promise<{ readonly row: GreenfieldPublicationAttemptRow; readonly created: boolean }> => {
      const values = [
        row.id,
        row.evidence_object_id,
        row.provider,
        row.provider_label,
        row.idempotency_key,
        row.attempt_number,
        row.configuration_digest,
        row.configured_network,
        row.configured_bucket,
        row.revision,
        row.lease_owner,
        row.lease_expires_at,
        row.object_name,
        row.state,
        row.provider_reference,
        row.creation_transaction_hash,
        row.seal_transaction_hash,
        row.submitted_at,
        row.last_error_code,
        row.sanitized_error,
        row.retryable,
        row.started_at,
        row.completed_at,
        row.created_at,
        row.updated_at
      ];
      let result: QueryResult;
      try {
        result = await this.execute(
          `INSERT INTO evidence_publication_attempts (
             id, evidence_object_id, provider, provider_label, idempotency_key,
             attempt_number, configuration_digest, configured_network,
             configured_bucket, revision, lease_owner, lease_expires_at,
             object_name, state, provider_reference, creation_transaction_hash,
             seal_transaction_hash, submitted_at, last_error_code,
             sanitized_error, retryable, started_at, completed_at,
             "createdAt", "updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING ${attemptColumns}`,
          values
        );
      } catch (error) {
        if (sqlState(error) === "23505") {
          throw new GreenfieldPostgresError("DUPLICATE_IDEMPOTENCY_KEY", "Publication idempotency key conflicts with an existing attempt");
        }
        throw error;
      }
      if (result.rows[0] !== undefined) return { row: attemptRow(result.rows[0]), created: true };
      const existing = await this.attempts.findByIdempotencyKey(row.idempotency_key);
      if (existing === null) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Publication attempt disappeared after create-or-get");
      compareAttemptIdentity(existing, row);
      return { row: existing, created: false };
    },
    save: async (row: GreenfieldPublicationAttemptRow, expectedRevision: number, leaseToken: string, now?: Date): Promise<void> => {
      const effectiveNow = isoOrDate(now);
      const updated = await this.execute(
        `UPDATE evidence_publication_attempts
            SET provider_label = $2,
                attempt_number = $3,
                configuration_digest = $4,
                configured_network = $5,
                configured_bucket = $6,
                revision = revision + 1,
                lease_owner = $7,
                lease_expires_at = $8,
                object_name = $9,
                state = $10,
                provider_reference = $11,
                creation_transaction_hash = $12,
                seal_transaction_hash = $13,
                submitted_at = $14,
                last_error_code = $15,
                sanitized_error = $16,
                retryable = $17,
                started_at = $18,
                completed_at = $19,
                "updatedAt" = $20
          WHERE id = $1
            AND revision = $21
            AND lease_owner = $22
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at > $23
          RETURNING ${attemptColumns}`,
        [
          row.id,
          row.provider_label,
          row.attempt_number,
          row.configuration_digest,
          row.configured_network,
          row.configured_bucket,
          leaseToken,
          row.lease_expires_at,
          row.object_name,
          row.state,
          row.provider_reference,
          row.creation_transaction_hash,
          row.seal_transaction_hash,
          row.submitted_at,
          row.last_error_code,
          row.sanitized_error,
          row.retryable,
          row.started_at,
          row.completed_at,
          row.updated_at,
          expectedRevision,
          leaseToken,
          effectiveNow
        ]
      );
      if (rowCount(updated) === 0) {
        const current = await this.attempts.findByAttemptId(row.id);
        if (current === null) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Publication attempt no longer exists");
        if (current.revision !== expectedRevision) throw new GreenfieldPostgresError("CONCURRENT_UPDATE", "Publication attempt revision is stale", true);
        throw new GreenfieldPostgresError("LEASE_LOST", "Publication attempt lease is not held by this worker", false);
      }
      const object = await this.objects.findById(row.evidence_object_id);
      if (object === null) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Publication attempt has no evidence object");
      const nextState = evidenceStateFor(row.state);
      const verifiedAt = row.state === "verified" ? row.updated_at : object.readback_verified_at;
      await this.execute(
        `UPDATE evidence_objects
            SET state = $2,
                greenfield_bucket = CASE WHEN $3 = 'greenfield' THEN $4 ELSE greenfield_bucket END,
                greenfield_object = CASE WHEN $3 = 'greenfield' THEN $5 ELSE greenfield_object END,
                creation_transaction_hash = CASE WHEN $3 = 'greenfield' THEN COALESCE($6, creation_transaction_hash) ELSE creation_transaction_hash END,
                seal_transaction_hash = CASE WHEN $3 = 'greenfield' THEN COALESCE($7, seal_transaction_hash) ELSE seal_transaction_hash END,
                sha256_digest = COALESCE(sha256_digest, $8),
                keccak256_digest = COALESCE(keccak256_digest, $9),
                size_bytes = COALESCE(size_bytes, $10),
                mime_type = COALESCE(mime_type, 'application/json'),
                readback_verified_at = $11,
                "updatedAt" = $12
          WHERE id = $1`,
        [
          row.evidence_object_id,
          nextState,
          row.provider,
          row.configured_bucket,
          row.provider_reference,
          row.creation_transaction_hash,
          row.seal_transaction_hash,
          object.sha256_digest,
          object.keccak256_digest,
          object.size_bytes,
          verifiedAt,
          row.updated_at
        ]
      );
    },
    acquireLease: async (attemptId: string, leaseToken: string, now: Date, durationMs: number): Promise<{ readonly row: GreenfieldPublicationAttemptRow | null; readonly acquired: boolean }> => {
      const expiresAt = new Date(now.valueOf() + durationMs);
      const result = await this.execute(
        `UPDATE evidence_publication_attempts
            SET revision = revision + 1,
                lease_owner = $2,
                lease_expires_at = $3,
                "updatedAt" = $4
          WHERE id = $1
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= $5 OR lease_owner = $2)
          RETURNING ${attemptColumns}`,
        [attemptId, leaseToken, expiresAt, now, now]
      );
      if (result.rows[0] !== undefined) return { row: attemptRow(result.rows[0]), acquired: true };
      const current = await this.attempts.findByAttemptId(attemptId);
      return { row: current, acquired: false };
    },
    releaseLease: async (attemptId: string, leaseToken: string, now?: Date): Promise<GreenfieldPublicationAttemptRow | null> => {
      const effectiveNow = isoOrDate(now);
      const result = await this.execute(
        `UPDATE evidence_publication_attempts
            SET revision = revision + 1,
                lease_owner = NULL,
                lease_expires_at = NULL,
                "updatedAt" = $3
          WHERE id = $1 AND lease_owner = $2
          RETURNING ${attemptColumns}`,
        [attemptId, leaseToken, effectiveNow]
      );
      return result.rows[0] === undefined ? null : attemptRow(result.rows[0]);
    }
  };

  readonly locators = {
    add: async (row: GreenfieldLocatorRow): Promise<void> => {
      const inserted = await this.execute(
        `INSERT INTO evidence_locators (
           id, evidence_object_id, publication_attempt_id, provider,
           provider_label, network, uri, bucket, object_name,
           provider_reference, version, sha256_digest, keccak256_digest,
           size_bytes, immutable, verified_at, "createdAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15,$16)
         ON CONFLICT (provider, uri) DO NOTHING
         RETURNING ${locatorColumns}`,
        [
          row.id,
          row.evidence_object_id,
          row.publication_attempt_id,
          row.provider,
          row.provider_label,
          row.network,
          row.uri,
          row.bucket,
          row.object_name,
          row.provider_reference,
          row.version,
          row.sha256_digest,
          row.keccak256_digest,
          row.size_bytes,
          row.verified_at,
          row.created_at
        ]
      );
      if (rowCount(inserted) > 0) return;
      const existingResult = await this.execute(
        `SELECT ${locatorColumns} FROM evidence_locators WHERE provider = $1 AND uri = $2`,
        [row.provider, row.uri]
      );
      const existing = existingResult.rows[0] === undefined ? null : locatorRow(existingResult.rows[0]);
      if (existing === null) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Locator disappeared after conflict");
      compareLocator(existing, row);
      // A locator is inserted before readback verification is known. Once the
      // same immutable locator is observed with a verified timestamp, promote
      // only that state. The null predicate makes concurrent/replayed calls
      // unable to replace an already recorded verification time.
      if (existing.verified_at === null && row.verified_at !== null) {
        await this.execute(
          `UPDATE evidence_locators
              SET verified_at = $4
            WHERE id = $1
              AND provider = $2
              AND uri = $3
              AND verified_at IS NULL`,
          [existing.id, row.provider, row.uri, row.verified_at]
        );
      }
    },
    listForObject: async (evidenceObjectId: string): Promise<readonly GreenfieldLocatorRow[]> => {
      const result = await this.execute(
        `SELECT ${locatorColumns} FROM evidence_locators WHERE evidence_object_id = $1 ORDER BY "createdAt" ASC, id ASC`,
        [evidenceObjectId]
      );
      return result.rows.map(locatorRow);
    },
    latestForAttempt: async (attemptId: string): Promise<GreenfieldLocatorRow | null> => {
      const result = await this.execute(
        `SELECT ${locatorColumns} FROM evidence_locators WHERE publication_attempt_id = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
        [attemptId]
      );
      return result.rows[0] === undefined ? null : locatorRow(result.rows[0]);
    }
  };

  readonly verifications = {
    add: async (row: GreenfieldVerificationRow): Promise<void> => {
      const inserted = await this.execute(
        `INSERT INTO evidence_verification_results (
           id, evidence_object_id, publication_attempt_id, status,
           seal_confirmed, readback_status, expected_sha256_digest,
           observed_sha256_digest, expected_keccak256_digest,
           observed_keccak256_digest, expected_size_bytes, observed_size_bytes,
           hashes_match, size_matches, reason_code, checked_at, "createdAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO NOTHING
         RETURNING ${verificationColumns}`,
        [
          row.id,
          row.evidence_object_id,
          row.publication_attempt_id,
          row.status,
          row.seal_confirmed,
          row.readback_status,
          row.expected_sha256_digest,
          row.observed_sha256_digest,
          row.expected_keccak256_digest,
          row.observed_keccak256_digest,
          row.expected_size_bytes,
          row.observed_size_bytes,
          row.hashes_match,
          row.size_matches,
          row.reason_code,
          row.checked_at,
          row.created_at
        ]
      );
      if (rowCount(inserted) > 0) return;
      const existingResult = await this.execute(`SELECT ${verificationColumns} FROM evidence_verification_results WHERE id = $1`, [row.id]);
      if (existingResult.rows[0] === undefined) throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Verification disappeared after conflict");
      const existing = verificationRow(existingResult.rows[0]);
      if (
        existing.evidence_object_id !== row.evidence_object_id ||
        existing.publication_attempt_id !== row.publication_attempt_id ||
        existing.status !== row.status ||
        existing.expected_sha256_digest !== row.expected_sha256_digest ||
        existing.expected_keccak256_digest !== row.expected_keccak256_digest ||
        existing.expected_size_bytes !== row.expected_size_bytes
      ) {
        throw new GreenfieldPostgresError("DURABLE_GRAPH_INVALID", "Verification id is already bound to different evidence");
      }
    },
    listForObject: async (evidenceObjectId: string): Promise<readonly GreenfieldVerificationRow[]> => {
      const result = await this.execute(
        `SELECT ${verificationColumns} FROM evidence_verification_results WHERE evidence_object_id = $1 ORDER BY checked_at ASC, id ASC`,
        [evidenceObjectId]
      );
      return result.rows.map(verificationRow);
    },
    latestForAttempt: async (attemptId: string): Promise<GreenfieldVerificationRow | null> => {
      const result = await this.execute(
        `SELECT ${verificationColumns} FROM evidence_verification_results WHERE publication_attempt_id = $1 ORDER BY checked_at DESC, id DESC LIMIT 1`,
        [attemptId]
      );
      return result.rows[0] === undefined ? null : verificationRow(result.rows[0]);
    }
  };

  readonly auditEvents = {
    append: async (event: GreenfieldPublicationAuditEvent): Promise<void> => {
      await this.execute(
        `INSERT INTO audit_events (
           actor_type, actor_id, action, resource_type, resource_id,
           request_id, metadata, "createdAt"
         ) VALUES ('system', NULL, $1, 'evidence_publication_attempt', $2, $3, $4, $5)`,
        [
          event.action,
          event.attemptId,
          event.idempotencyKey,
          { reasonCode: event.reasonCode, message: event.message },
          asDate(event.createdAt, "audit createdAt")
        ]
      );
    }
  };
}

export function createGreenfieldPostgresAdapter(
  connectionString: string,
  options?: GreenfieldPostgresAdapterOptions
): { readonly adapter: GreenfieldPostgresAdapter; readonly pool: pg.Pool } {
  const adapter = new GreenfieldPostgresAdapter(connectionString, options);
  if (adapter.pool === null) throw new Error("PostgreSQL adapter did not create a pool");
  return { adapter, pool: adapter.pool };
}
