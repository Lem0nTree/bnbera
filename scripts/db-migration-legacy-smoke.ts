import { randomUUID } from "node:crypto";
import { createDb, migrateDb } from "../packages/db/src/client.ts";

const MAX_DB_CONNECTION_TIMEOUT_MS = 5_000;
const MAX_DB_QUERY_TIMEOUT_MS = 10_000;
const DISPOSABLE_DATABASE_PREFIX = "bnbera_t6_adr0003_";

class MigrationSmokeError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "MigrationSmokeError";
  }
}

function boundedDatabaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new MigrationSmokeError("DATABASE_URL_INVALID");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new MigrationSmokeError("DATABASE_URL_INVALID");
  }
  parsed.searchParams.set(
    "connection_timeout",
    String(Math.ceil(MAX_DB_CONNECTION_TIMEOUT_MS / 1_000))
  );
  parsed.searchParams.set("query_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("statement_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("lock_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set(
    "idle_in_transaction_session_timeout",
    String(MAX_DB_QUERY_TIMEOUT_MS)
  );
  return parsed;
}

function databaseUrlFor(base: URL, database: string): string {
  const parsed = new URL(base.toString());
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(identifier)) {
    throw new MigrationSmokeError("DISPOSABLE_DATABASE_NAME_INVALID");
  }
  return `"${identifier}"`;
}

function errorCode(error: unknown): string {
  if (error instanceof MigrationSmokeError) return error.code;
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNKNOWN";
  }
  const value = String((error as { readonly code?: unknown }).code ?? "UNKNOWN");
  return /^[A-Z0-9_]{1,64}$/u.test(value) ? value : "UNKNOWN";
}

function assertCondition(condition: boolean, code: string): asserts condition {
  if (!condition) throw new MigrationSmokeError(code);
}

function createPool(connectionString: string): ReturnType<typeof createDb>["pool"] {
  return createDb(connectionString).pool;
}

async function createDisposableDatabase(base: URL, database: string): Promise<void> {
  const adminPool = createPool(databaseUrlFor(base, "postgres"));
  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
  } catch {
    throw new MigrationSmokeError("DISPOSABLE_DATABASE_CREATE_FAILED");
  } finally {
    await adminPool.end();
  }
}

async function dropDisposableDatabase(base: URL, database: string): Promise<void> {
  const adminPool = createPool(databaseUrlFor(base, "postgres"));
  try {
    // The database is generated for this one process and no application pool
    // is allowed to outlive the verification call. FORCE also cleans up a
    // failed test connection without touching any other database.
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
  } catch {
    throw new MigrationSmokeError("DISPOSABLE_DATABASE_DROP_FAILED");
  } finally {
    await adminPool.end();
  }
}

async function makeLegacyShape(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    // Start from a fully migrated disposable database, then model the three
    // branch-local surfaces called out by ADR 0003. CASCADE is safe here: the
    // database is generated for this test and the repair migration recreates
    // the reviewed constraints and indexes.
    await pool.query(`
      ALTER TABLE "erc8183_jobs"
        DROP COLUMN IF EXISTS "spec_revision" CASCADE,
        DROP COLUMN IF EXISTS "abi_hash" CASCADE,
        DROP COLUMN IF EXISTS "evaluator_profile" CASCADE,
        DROP COLUMN IF EXISTS "confirmation_threshold" CASCADE,
        DROP COLUMN IF EXISTS "min_expiry_lead_seconds" CASCADE,
        DROP COLUMN IF EXISTS "max_expiry_horizon_seconds" CASCADE,
        DROP COLUMN IF EXISTS "min_budget_atomic" CASCADE,
        DROP COLUMN IF EXISTS "max_budget_atomic" CASCADE,
        DROP COLUMN IF EXISTS "deployment_pin_digest" CASCADE;

      ALTER TABLE "payment_attempts"
        ADD COLUMN IF NOT EXISTS "receipt_id" uuid,
        DROP COLUMN IF EXISTS "max_challenge_lifetime_seconds" CASCADE,
        DROP COLUMN IF EXISTS "pin_digest" CASCADE,
        DROP COLUMN IF EXISTS "configuration_version" CASCADE,
        DROP COLUMN IF EXISTS "configuration_digest" CASCADE,
        DROP COLUMN IF EXISTS "fixed_egress_profile" CASCADE,
        DROP COLUMN IF EXISTS "payout_address" CASCADE,
        DROP COLUMN IF EXISTS "payout_verification_state" CASCADE;

      ALTER TABLE "evidence_objects"
        DROP COLUMN IF EXISTS "artifact_id" CASCADE,
        DROP COLUMN IF EXISTS "artifact_schema_version" CASCADE;

      ALTER TABLE "evidence_publication_attempts"
        DROP COLUMN IF EXISTS "provider_label" CASCADE,
        DROP COLUMN IF EXISTS "configuration_digest" CASCADE,
        DROP COLUMN IF EXISTS "configured_network" CASCADE,
        DROP COLUMN IF EXISTS "configured_bucket" CASCADE,
        DROP COLUMN IF EXISTS "revision" CASCADE,
        DROP COLUMN IF EXISTS "lease_owner" CASCADE,
        DROP COLUMN IF EXISTS "lease_expires_at" CASCADE;

      ALTER TABLE "evidence_locators"
        DROP COLUMN IF EXISTS "provider_label" CASCADE;

      ALTER TABLE "erc8004_identities"
        DROP COLUMN IF EXISTS "agent_uri_observed_block" CASCADE,
        DROP COLUMN IF EXISTS "content_digest_observed_block" CASCADE,
        DROP COLUMN IF EXISTS "observed_block" CASCADE,
        DROP COLUMN IF EXISTS "observed_block_hash" CASCADE,
        DROP COLUMN IF EXISTS "read_consistency" CASCADE;

      ALTER TABLE "erc8183_jobs"
        DROP COLUMN IF EXISTS "provider_binding" CASCADE,
        DROP COLUMN IF EXISTS "buyer_approval_address" CASCADE,
        DROP COLUMN IF EXISTS "buyer_approval_result_digest" CASCADE,
        DROP COLUMN IF EXISTS "buyer_approved_at" CASCADE;

      -- 0002 through 0007 are deliberately rewound below. Remove the tables
      -- introduced by the replayed migrations so their CREATE statements do
      -- not collide with the original disposable shape.
      DROP TABLE IF EXISTS "marketplace_ingestion_retries" CASCADE;
      DROP TABLE IF EXISTS "marketplace_discovery_cursors" CASCADE;
      DROP TABLE IF EXISTS "scan_discovery_checkpoints" CASCADE;
      DROP TABLE IF EXISTS "erc8004_reputation_events" CASCADE;
      DROP TABLE IF EXISTS "erc8004_reputation_checkpoints" CASCADE;
      DROP TABLE IF EXISTS "erc8183_operations" CASCADE;
      DELETE FROM drizzle.__drizzle_migrations
       WHERE id IN (
         SELECT id
           FROM drizzle.__drizzle_migrations
          ORDER BY id DESC
          LIMIT 6
       );
    `);
  } catch {
    throw new MigrationSmokeError("LEGACY_SHAPE_SETUP_FAILED");
  } finally {
    await pool.end();
  }
}

async function verifyLegacyRepair(connectionString: string): Promise<void> {
  const pool = createPool(connectionString);
  try {
    const columns = await pool.query<{ readonly table_name: string; readonly column_name: string }>(`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'erc8183_jobs' AND column_name IN ('deployment_pin_digest', 'spec_revision'))
           OR (table_name = 'payment_attempts' AND column_name IN ('receipt_id', 'pin_digest'))
           OR (table_name = 'evidence_publication_attempts' AND column_name IN ('lease_owner', 'provider_label'))
           OR (table_name = 'erc8004_identities' AND column_name IN ('read_consistency', 'observed_block_hash'))
         )
    `);
    const columnNames = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const column of [
      "erc8183_jobs.deployment_pin_digest",
      "erc8183_jobs.spec_revision",
      "payment_attempts.pin_digest",
      "evidence_publication_attempts.lease_owner",
      "erc8004_identities.read_consistency"
    ]) {
      assertCondition(columnNames.has(column), "LEGACY_REPAIR_COLUMN_MISSING");
    }
    assertCondition(!columnNames.has("payment_attempts.receipt_id"), "LEGACY_RECEIPT_LINK_REMAINS");

    const tables = await pool.query<{ readonly scan_exists: boolean; readonly discovery_exists: boolean; readonly retry_exists: boolean }>(`
      SELECT
        to_regclass('public.scan_discovery_checkpoints') IS NOT NULL AS scan_exists,
        to_regclass('public.marketplace_discovery_cursors') IS NOT NULL AS discovery_exists,
        to_regclass('public.marketplace_ingestion_retries') IS NOT NULL AS retry_exists
    `);
    assertCondition(tables.rows[0]?.scan_exists === true, "SCAN_CHECKPOINT_MIGRATION_MISSING");
    assertCondition(tables.rows[0]?.discovery_exists === true, "MARKETPLACE_DISCOVERY_CURSOR_MIGRATION_MISSING");
    assertCondition(tables.rows[0]?.retry_exists === true, "MARKETPLACE_RETRY_MIGRATION_MISSING");

    const journal = await pool.query<{ readonly count: string }>(`
      SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
    `);
    assertCondition(journal.rows[0]?.count === "8", "MIGRATION_JOURNAL_INCOMPLETE");
  } catch (error) {
    if (error instanceof MigrationSmokeError) throw error;
    throw new MigrationSmokeError("LEGACY_REPAIR_VERIFICATION_FAILED");
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (process.env.BNBERA_DISPOSABLE_DB_TEST !== "true") {
    throw new MigrationSmokeError("DISPOSABLE_DB_TEST_NOT_EXPLICITLY_ENABLED");
  }
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (rawDatabaseUrl === undefined || rawDatabaseUrl.trim() === "") {
    throw new MigrationSmokeError("DATABASE_URL_MISSING");
  }
  const base = boundedDatabaseUrl(rawDatabaseUrl);
  const database = `${DISPOSABLE_DATABASE_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const disposableUrl = databaseUrlFor(base, database);
  let created = false;
  try {
    await createDisposableDatabase(base, database);
    created = true;

    // Empty database migration plus a repeat proves fresh installation and
    // restart/no-op behavior before the ADR 0003 upgrade simulation.
    await migrateDb(disposableUrl, { ssl: process.env.DATABASE_SSL === "true" });
    await migrateDb(disposableUrl, { ssl: process.env.DATABASE_SSL === "true" });
    await makeLegacyShape(disposableUrl);
    await migrateDb(disposableUrl, { ssl: process.env.DATABASE_SSL === "true" });
    await verifyLegacyRepair(disposableUrl);

    console.log(JSON.stringify({
      ok: true,
      freshInstall: true,
      restartNoOp: true,
      adr0003LegacyRepair: true,
      disposableDatabase: true
    }));
  } finally {
    if (created) await dropDisposableDatabase(base, database);
  }
}

try {
  await main();
} catch (error) {
  console.error(`PostgreSQL migration smoke failed: ${errorCode(error)}.`);
  process.exitCode = 1;
}
