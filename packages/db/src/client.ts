import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Pool as PgPool } from "pg";
import { schemaTables } from "./schema.js";

const { Pool } = pg;

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
    await migrate(db, {
      migrationsFolder:
        options?.migrationsFolder ?? fileURLToPath(new URL("../migrations", import.meta.url))
    });
  } finally {
    await pool.end();
  }
}
