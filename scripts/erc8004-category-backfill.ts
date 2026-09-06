import type { PoolClient } from "pg";
import { loadRuntimeConfig } from "../packages/config/src/runtime.ts";
import {
  PgCategoryPredictionSink,
  classifyAgent,
  readErc8004PipelineGates,
  type CategoryClassificationInput
} from "../packages/agent-ingestion/src/index.ts";
import { createDb } from "../packages/db/src/client.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const maxCandidates = 100;
const maxRunMs = 120_000;

type BackfillRow = {
  readonly agent_version_id: string;
  readonly namespace: string;
  readonly chain_id: number;
  readonly identity_registry: string;
  readonly agent_id: string;
  readonly public_metadata: unknown;
  readonly capability_manifest: unknown;
  readonly service_observations: unknown;
};

type PublicRecord = Readonly<Record<string, unknown>>;

function optionalText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = optionalText(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name}_OUT_OF_BOUNDS`);
  return parsed;
}

function boundedUuid(name: string, value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!uuidPattern.test(value)) throw new Error(`${name}_INVALID`);
  return value.toLowerCase();
}

function publicRecord(value: unknown): PublicRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as PublicRecord;
}

function publicArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonValue(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function categoryInput(row: BackfillRow): CategoryClassificationInput {
  const metadata = publicRecord(jsonValue(row.public_metadata, {})) ?? {};
  const capabilities = jsonValue(row.capability_manifest, undefined);
  const services = publicArray(jsonValue(row.service_observations, []))
    .map((value) => publicRecord(value))
    .filter((value): value is PublicRecord => value !== null);
  const cards = services
    .filter((service) => service.kind === "a2a")
    .map((service) => publicRecord(jsonValue(service.safeCapabilityProbe, undefined)))
    .filter((value): value is PublicRecord => value !== null);
  const mcpCapabilities = services
    .filter((service) => service.kind === "mcp")
    .map((service) => publicRecord(jsonValue(service.safeCapabilityProbe, undefined)))
    .filter((value): value is PublicRecord => value !== null);
  const advertisedSkills = cards.flatMap((card) => publicArray(card.skills));

  return {
    ...(typeof metadata.name === "string" ? { name: metadata.name } : {}),
    ...(typeof metadata.description === "string" ? { description: metadata.description } : {}),
    metadata,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(cards.length === 0 ? {} : { agentCard: cards }),
    ...(mcpCapabilities.length === 0 ? {} : { mcpCapabilities }),
    ...(advertisedSkills.length === 0 ? {} : { advertisedSkills })
  };
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return fallback;
}

function increment(map: Map<string, number>, code: string): void {
  map.set(code, (map.get(code) ?? 0) + 1);
}

async function currentRows(client: PoolClient, after: string | null, limit: number): Promise<readonly BackfillRow[]> {
  const result = await client.query<BackfillRow>(
    `SELECT av.id AS agent_version_id,
            i.namespace,
            i.chain_id,
            i.identity_registry,
            i.agent_id,
            av.public_metadata,
            av.capability_manifest,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'kind', s.kind,
                       'url', s.url,
                       'protocolVersion', s.protocol_version,
                       'safeCapabilityProbe', s.safe_capability_probe
                     ) ORDER BY s.kind, s.url, s.id)
                FROM agent_service_observations AS s
               WHERE s.identity_id = a.identity_id
            ), '[]'::jsonb) AS service_observations
       FROM agent_versions AS av
       JOIN agents AS a ON a.id = av.agent_id
       JOIN erc8004_identities AS i ON i.id = a.identity_id
      WHERE a.current_version_id = av.id
        AND ($1::uuid IS NULL OR av.id > $1::uuid)
      ORDER BY av.id ASC
      LIMIT $2`,
    [after, limit]
  );
  return result.rows;
}

async function run(): Promise<void> {
  const runtime = loadRuntimeConfig(process.env);
  const gates = readErc8004PipelineGates(process.env);
  if (process.env.ERC8004_CATEGORY_BACKFILL_ENABLED !== "true") {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: "ERC8004_CATEGORY_BACKFILL_DISABLED" })}\n`);
    return;
  }
  if (!gates.ERC8004_INGESTION_ENABLED) {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: "ERC8004_INGESTION_DISABLED" })}\n`);
    return;
  }
  if (runtime.databaseUrl === undefined) throw new Error("DATABASE_URL_REQUIRED");

  const limit = boundedNumber("ERC8004_CATEGORY_BACKFILL_MAX_CANDIDATES", 20, 1, maxCandidates);
  const runMs = boundedNumber("ERC8004_CATEGORY_BACKFILL_MAX_RUN_MS", 30_000, 250, maxRunMs);
  const after = boundedUuid("ERC8004_CATEGORY_BACKFILL_AFTER_VERSION", optionalText("ERC8004_CATEGORY_BACKFILL_AFTER_VERSION"));
  const lockScope = optionalText("ERC8004_CATEGORY_BACKFILL_SCOPE") ?? "bnbera:erc8004:category:deterministic-rules-v3";
  if (lockScope.length > 160 || /[\u0000-\u001f\u007f]/u.test(lockScope)) throw new Error("ERC8004_CATEGORY_BACKFILL_SCOPE_INVALID");

  const { pool } = createDb(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [lockScope]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      process.stdout.write(`${JSON.stringify({ status: "deferred", reason: "ERC8004_CATEGORY_BACKFILL_ALREADY_RUNNING" })}\n`);
      return;
    }

    // Fetch one sentinel row so a bounded page reports whether another
    // invocation is needed. Never process beyond the configured bound.
    const rows = await currentRows(client, after, limit + 1);
    const candidates = rows.slice(0, limit);
    const versionByIdentity = new Map<string, string>();
    for (const row of candidates) {
      versionByIdentity.set(`${row.namespace}:${row.chain_id}:${row.identity_registry.toLowerCase()}:${row.agent_id}`, row.agent_version_id);
    }
    const sink = new PgCategoryPredictionSink(
      client,
      async (identityKey) => versionByIdentity.get(identityKey) ?? null
    );
    const deadline = Date.now() + runMs;
    const failures = new Map<string, number>();
    let processed = 0;
    let classified = 0;
    let nextCursor: string | null = after;
    let firstFailureSeen = false;
    for (const row of candidates) {
      if (Date.now() >= deadline && processed > 0) break;
      processed += 1;
      try {
        const classification = classifyAgent(categoryInput(row));
        const identityKey = `${row.namespace}:${row.chain_id}:${row.identity_registry.toLowerCase()}:${row.agent_id}`;
        await sink.save({ identityKey, classification });
        classified += 1;
        // Do not advance past a failed candidate. A later invocation can
        // retry that row, while successful rows remain idempotent.
        if (!firstFailureSeen) nextCursor = row.agent_version_id;
      } catch (error) {
        firstFailureSeen = true;
        increment(failures, safeErrorCode(error, "CATEGORY_BACKFILL_FAILED"));
      }
    }

    process.stdout.write(`${JSON.stringify({
      status: processed < candidates.length || rows.length > candidates.length || failures.size > 0 ? "partial" : "completed",
      classifierVersion: "deterministic-rules-v3",
      requested: candidates.length,
      processed,
      classified,
      failed: processed - classified,
      failureCodes: Object.fromEntries([...failures.entries()].sort(([left], [right]) => left.localeCompare(right))),
      nextAfterAgentVersionId: nextCursor,
      hasMore: rows.length > candidates.length
    })}\n`);
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockScope]);
      } catch {
        // The connection close releases the session advisory lock as a fallback.
      }
    }
    client.release();
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error, "ERC8004_CATEGORY_BACKFILL_FAILED") })}\n`);
  process.exitCode = 1;
});
