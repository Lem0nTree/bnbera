import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Pool as PgPool } from "pg";
import { schemaTables } from "./schema.js";

const { Pool } = pg;

const legacyWaveOneTables = [
  "agent_capability_observations",
  "agent_service_observations",
  "erc8183_jobs",
  "payment_attempts",
  "evidence_publication_attempts"
] as const;

const duplicateSafeSqlStates = new Set([
  "42701", // duplicate_column
  "42710", // duplicate_object (types, constraints and indexes)
  "42P07" // duplicate_table / duplicate_relation
]);

/**
 * Wave 1 was developed on three isolated branches before being merged into a
 * single Drizzle history. Databases that applied any of those branch-local
 * migrations have a newer migration timestamp than the generated combined
 * migration, so Drizzle correctly skips that older file. Replaying the
 * combined baseline statement-by-statement with duplicate-object errors
 * ignored fills in the *other* two surfaces without deleting data. The later
 * repair migration then normalizes legacy columns and removes obsolete links.
 *
 * This is intentionally limited to a recognizable, incomplete Wave 1 shape.
 * A database already at the integrated shape never enters this path.
 */
async function repairLegacyWaveOneBaseline(pool: PgPool, migrationsFolder: string): Promise<void> {
  const shape = await pool.query<{
    has_wave_one: boolean;
    has_payment_receipt_link: boolean;
    has_erc8183_pin: boolean;
    has_evidence_lease: boolean;
    has_identity_read_provenance: boolean;
  }>(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ) AS has_wave_one,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payment_attempts' AND column_name = 'receipt_id'
      ) AS has_payment_receipt_link,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'erc8183_jobs' AND column_name = 'deployment_pin_digest'
      ) AS has_erc8183_pin,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'evidence_publication_attempts' AND column_name = 'lease_owner'
      ) AS has_evidence_lease,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'erc8004_identities' AND column_name = 'read_consistency'
      ) AS has_identity_read_provenance
  `, [legacyWaveOneTables]);
  const current = shape.rows[0];

  if (
    current === undefined ||
    !current.has_wave_one ||
    (!current.has_payment_receipt_link && current.has_erc8183_pin && current.has_evidence_lease && current.has_identity_read_provenance)
  ) {
    return;
  }

  const baseline = await readFile(`${migrationsFolder}/0001_wave1_combined.sql`, "utf8");
  const statements = baseline
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query("SAVEPOINT bnbera_wave1_legacy_statement");
      try {
        await client.query(statement);
        await client.query("RELEASE SAVEPOINT bnbera_wave1_legacy_statement");
      } catch (error: unknown) {
        await client.query("ROLLBACK TO SAVEPOINT bnbera_wave1_legacy_statement");
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: string }).code
          : undefined;
        if (!duplicateSafeSqlStates.has(code ?? "")) {
          throw error;
        }
        await client.query("RELEASE SAVEPOINT bnbera_wave1_legacy_statement");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function createDb(connectionString: string, options?: { readonly ssl?: boolean }): {
  readonly db: ReturnType<typeof drizzle<typeof schemaTables>>;
  readonly pool: PgPool;
} {
  const pool = new Pool({
    connectionString,
    ssl: options?.ssl === true ? { rejectUnauthorized: true } : undefined
  });
  const db = drizzle(pool, { schema: schemaTables });
  return { db, pool };
}

export async function migrateDb(
  connectionString: string,
  options?: { readonly ssl?: boolean; readonly migrationsFolder?: string }
): Promise<void> {
  const { db, pool } = createDb(connectionString, options);
  try {
    const migrationsFolder =
      options?.migrationsFolder ?? fileURLToPath(new URL("../migrations", import.meta.url));
    await repairLegacyWaveOneBaseline(pool, migrationsFolder);
    await migrate(db, {
      migrationsFolder
    });
  } finally {
    await pool.end();
  }
}
