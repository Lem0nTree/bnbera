import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../packages/db/src/client.ts";
import { loadRuntimeConfig, validateSemanticEmbeddingLock, type RuntimeConfig } from "../packages/config/src/runtime.ts";
import { agentCategories, type AgentCategory } from "../packages/domain/src/index.ts";

const MAX_DB_CONNECTION_TIMEOUT_MS = 5_000;
const MAX_DB_QUERY_TIMEOUT_MS = 10_000;
const MAX_HTTP_PROBE_TIMEOUT_MS = 10_000;
const MARKETPLACE_CONTRACT_VERSION = "bnbera.marketplace-read/v0.1";
const MIGRATIONS_DIR = fileURLToPath(new URL("../packages/db/migrations/", import.meta.url));

const coreFeatureEnvironmentNames = [
  "ERC8004_INGESTION_ENABLED",
  "ERC8004SCAN_DISCOVERY_ENABLED"
] as const;

export type MarketplaceReadinessCounts = Readonly<{
  identities: number;
  exactIdentityReads: number;
  agents: number;
  publishedAgents: number;
  verifiedAgents: number;
  liveAgents: number;
  versions: number;
  capabilities: number;
  categoryPredictions: number;
  discoverySources: number;
  serviceObservations: number;
  healthyServiceObservations: number;
  services: number;
  healthyServices: number;
  serviceProbes: number;
  healthyServiceProbes: number;
  healthSnapshots: number;
  listingEmbeddings: number;
  enrichmentObservations: number;
  canonicalChainObservations: number;
}>;

export type MarketplaceDataDiagnosis = Readonly<{
  state: "ready" | "degraded" | "empty";
  reasonCodes: readonly string[];
}>;

export type MarketplaceCategorySupply = Readonly<{
  category: AgentCategory;
  agentCount: number;
  publishedCount: number;
  verifiedCount: number;
  liveCount: number;
}>;

type RawCountRow = Readonly<Record<string, number | string>>;

type RawCategorySupplyRow = Readonly<{
  category: string;
  agent_count: number | string;
  published_count: number | string;
  verified_count: number | string;
  live_count: number | string;
}>;

type MigrationRow = Readonly<{
  id: number | string;
  hash: string;
}>;

type MigrationInspection = Readonly<{
  appliedCount: number;
  expectedCount: number;
  appliedIds: readonly string[];
  expectedFiles: readonly string[];
  hashesMatch: boolean;
}>;

type DatabaseInspection = Readonly<{
  database: string;
  role: string;
  pgvectorVersion: string | null;
  migrations: MigrationInspection;
  counts: MarketplaceReadinessCounts;
  /** Bounded category supply stages; this does not change eligibility gates. */
  categorySupply: readonly MarketplaceCategorySupply[];
  diagnosis: MarketplaceDataDiagnosis;
}>;

type ApiInspection = Readonly<{
  status: "pass" | "blocked" | "skipped";
  reasonCode?: string;
  httpStatus?: number;
  contractVersion?: string;
  responseStatus?: string;
  responseMode?: string;
  total?: number;
  returnedAgents?: number;
  excluded?: number;
  fixtureCount?: number;
  retrievalMode?: string | null;
}>;

type ReadinessReport = Readonly<{
  contractVersion: "bnbera.marketplace-readiness/v0.1";
  scope: "database-and-web" | "database-only";
  status: "ready" | "degraded" | "empty" | "blocked";
  dataState: "ready" | "degraded" | "empty" | null;
  configuration: Readonly<{
    dataMode: string | null;
    databaseSsl: boolean | null;
    semanticRetrievalEnabled: boolean | null;
    ingestionEnabled: boolean | null;
    scanDiscoveryEnabled: boolean | null;
  }>;
  database: DatabaseInspection | null;
  api: ApiInspection;
  reasonCodes: readonly string[];
}>;

class ReadinessError extends Error {
  public constructor(public readonly reasonCode: string) {
    super(reasonCode);
    this.name = "ReadinessError";
  }
}

function boundedDatabaseUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new ReadinessError("DATABASE_URL_INVALID");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ReadinessError("DATABASE_URL_INVALID");
  }

  // Keep the read-only probe bounded. The input, including any credentials,
  // remains in memory only and is never emitted in the report.
  parsed.searchParams.set("connection_timeout", String(Math.ceil(MAX_DB_CONNECTION_TIMEOUT_MS / 1_000)));
  parsed.searchParams.set("query_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("statement_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("lock_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  parsed.searchParams.set("idle_in_transaction_session_timeout", String(MAX_DB_QUERY_TIMEOUT_MS));
  return parsed.toString();
}

function countValue(value: number | string | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ReadinessError("DATABASE_COUNT_INVALID");
  }
  return parsed;
}

async function expectedMigrations(): Promise<readonly { file: string; hash: string }[]> {
  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort();
  } catch {
    throw new ReadinessError("MIGRATION_FILES_UNAVAILABLE");
  }

  try {
    return await Promise.all(
      files.map(async (file) => ({
        file,
        hash: createHash("sha256").update(await readFile(join(MIGRATIONS_DIR, file))).digest("hex")
      }))
    );
  } catch {
    throw new ReadinessError("MIGRATION_FILES_UNAVAILABLE");
  }
}

function parseCounts(row: RawCountRow | undefined): MarketplaceReadinessCounts {
  if (row === undefined) throw new ReadinessError("DATABASE_COUNTS_UNAVAILABLE");
  return {
    identities: countValue(row.identity_count),
    exactIdentityReads: countValue(row.exact_identity_read_count),
    agents: countValue(row.agent_count),
    publishedAgents: countValue(row.published_agent_count),
    verifiedAgents: countValue(row.verified_agent_count),
    liveAgents: countValue(row.live_agent_count),
    versions: countValue(row.version_count),
    capabilities: countValue(row.capability_count),
    categoryPredictions: countValue(row.category_prediction_count),
    discoverySources: countValue(row.discovery_source_count),
    serviceObservations: countValue(row.service_observation_count),
    healthyServiceObservations: countValue(row.healthy_service_observation_count),
    services: countValue(row.service_count),
    healthyServices: countValue(row.healthy_service_count),
    serviceProbes: countValue(row.service_probe_count),
    healthyServiceProbes: countValue(row.healthy_service_probe_count),
    healthSnapshots: countValue(row.health_snapshot_count),
    listingEmbeddings: countValue(row.listing_embedding_count),
    enrichmentObservations: countValue(row.enrichment_observation_count),
    canonicalChainObservations: countValue(row.canonical_chain_observation_count)
  };
}

function parseCategorySupply(rows: readonly RawCategorySupplyRow[]): readonly MarketplaceCategorySupply[] {
  const byCategory = new Map<string, RawCategorySupplyRow>();
  for (const row of rows) {
    if (!agentCategories.includes(row.category as AgentCategory) || byCategory.has(row.category)) {
      throw new ReadinessError("DATABASE_CATEGORY_SUPPLY_INVALID");
    }
    byCategory.set(row.category, row);
  }
  return agentCategories.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      agentCount: countValue(row?.agent_count ?? 0),
      publishedCount: countValue(row?.published_count ?? 0),
      verifiedCount: countValue(row?.verified_count ?? 0),
      liveCount: countValue(row?.live_count ?? 0)
    };
  });
}

export function diagnoseMarketplaceData(
  counts: MarketplaceReadinessCounts,
  flags: Readonly<{
    ingestionEnabled: boolean;
    scanDiscoveryEnabled: boolean;
    semanticRetrievalEnabled: boolean;
  }>
): MarketplaceDataDiagnosis {
  const reasonCodes: string[] = [];
  if (counts.identities === 0) reasonCodes.push("READ_MODEL_EMPTY_NO_IDENTITIES");
  if (counts.agents === 0 && counts.identities > 0) reasonCodes.push("READ_MODEL_EMPTY_NO_AGENT_PROJECTION");
  if (counts.agents > 0 && counts.versions === 0) reasonCodes.push("READ_MODEL_EMPTY_NO_VERSIONS");
  if (counts.identities > 0 && counts.exactIdentityReads < counts.identities) {
    reasonCodes.push("READ_MODEL_WITHHELD_INCOMPLETE_IDENTITY_PROVENANCE");
  }
  if (counts.agents > 0 && counts.capabilities === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_CAPABILITY_OBSERVATION");
  }
  if (counts.agents > 0 && counts.publishedAgents === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_PUBLISHED_LISTING");
  }
  if (counts.agents > 0 && counts.liveAgents === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_LIVE_RUNTIME");
  }
  if (counts.agents > 0 && counts.serviceObservations === 0 && counts.services === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_SERVICE_OBSERVATION");
  }
  if (counts.agents > 0 && counts.healthyServiceProbes === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_HEALTHY_SERVICE_PROBE");
  }
  if (counts.agents > 0 && counts.versions > 0 && counts.categoryPredictions === 0) {
    reasonCodes.push("READ_MODEL_WITHHELD_NO_CATEGORY_PREDICTION");
  }
  if (!flags.ingestionEnabled) reasonCodes.push("ERC8004_INGESTION_DISABLED_READ_MODEL_MAY_BE_STALE");
  if (!flags.scanDiscoveryEnabled) reasonCodes.push("ERC8004SCAN_DISCOVERY_DISABLED_DISCOVERY_MAY_BE_STALE");
  const structuralEmpty = counts.identities === 0 || counts.agents === 0 || counts.versions === 0;
  const state: MarketplaceDataDiagnosis["state"] = structuralEmpty
    ? "empty"
    : reasonCodes.some((reason) => reason.startsWith("READ_MODEL_WITHHELD_"))
      ? "degraded"
      : "ready";
  return { state, reasonCodes };
}

async function inspectDatabase(config: RuntimeConfig): Promise<DatabaseInspection> {
  if (config.databaseUrl === undefined) throw new ReadinessError("DATABASE_URL_MISSING");
  const { pool } = createDb(boundedDatabaseUrl(config.databaseUrl), { ssl: config.databaseSsl });
  try {
    let identity: { database: string; role: string; pgvector_version: string | null } | undefined;
    try {
      identity = (
        await pool.query<{ database: string; role: string; pgvector_version: string | null }>(`
          SELECT current_database() AS database,
                 current_user AS role,
                 (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector_version
        `)
      ).rows[0];
    } catch {
      throw new ReadinessError("DATABASE_UNAVAILABLE");
    }
    if (identity === undefined) throw new ReadinessError("DATABASE_UNAVAILABLE");
    if (identity.pgvector_version === null) throw new ReadinessError("PGVECTOR_EXTENSION_MISSING");

    const migrations = await expectedMigrations();
    let journalRows: readonly MigrationRow[];
    try {
      journalRows = (
        await pool.query<MigrationRow>(`
          SELECT id, hash
            FROM drizzle.__drizzle_migrations
           ORDER BY id
        `)
      ).rows;
    } catch {
      throw new ReadinessError("MIGRATION_JOURNAL_UNAVAILABLE");
    }
    const journalInspection: MigrationInspection = {
      appliedCount: journalRows.length,
      expectedCount: migrations.length,
      appliedIds: journalRows.map((row) => String(row.id)),
      expectedFiles: migrations.map((migration) => basename(migration.file)),
      hashesMatch:
        journalRows.length === migrations.length &&
        journalRows.every((row, index) => row.hash === migrations[index]?.hash)
    };
    if (!journalInspection.hashesMatch) throw new ReadinessError("MIGRATION_JOURNAL_MISMATCH");

    let rawCounts: RawCountRow | undefined;
    try {
      rawCounts = (
        await pool.query<RawCountRow>(`
          SELECT
            (SELECT count(*)::int FROM erc8004_identities) AS identity_count,
            (SELECT count(*)::int FROM erc8004_identities
              WHERE observed_block IS NOT NULL
                AND observed_block_hash IS NOT NULL
                AND read_consistency IS NOT NULL) AS exact_identity_read_count,
            (SELECT count(*)::int FROM agents) AS agent_count,
            (SELECT count(*)::int FROM agents WHERE listing_status = 'published') AS published_agent_count,
            (SELECT count(*)::int FROM agents WHERE verification_status = 'verified') AS verified_agent_count,
            (SELECT count(*)::int FROM agents WHERE runtime_status = 'live') AS live_agent_count,
            (SELECT count(*)::int FROM agent_versions) AS version_count,
            (SELECT count(*)::int FROM agent_capability_observations) AS capability_count,
            (SELECT count(*)::int FROM agent_category_predictions) AS category_prediction_count,
            (SELECT count(*)::int FROM agent_discovery_sources) AS discovery_source_count,
            (SELECT count(*)::int FROM agent_service_observations) AS service_observation_count,
            (SELECT count(*)::int FROM agent_service_observations WHERE validation_status = 'healthy') AS healthy_service_observation_count,
            (SELECT count(*)::int FROM agent_services) AS service_count,
            (SELECT count(*)::int FROM agent_services WHERE validation_status = 'healthy') AS healthy_service_count,
            (SELECT count(*)::int FROM agent_service_probe_results) AS service_probe_count,
            (SELECT count(*)::int FROM agent_service_probe_results WHERE validation_status = 'healthy') AS healthy_service_probe_count,
            (SELECT count(*)::int FROM agent_health_snapshots) AS health_snapshot_count,
            (SELECT count(*)::int FROM agent_listing_embeddings) AS listing_embedding_count,
            (SELECT count(*)::int FROM agent_enrichment_observations) AS enrichment_observation_count,
            (SELECT count(*)::int FROM erc8004_chain_observations WHERE confirmation_state = 'canonical') AS canonical_chain_observation_count
        `)
      ).rows[0];
    } catch {
      throw new ReadinessError("DATABASE_COUNTS_UNAVAILABLE");
    }
    const counts = parseCounts(rawCounts);
    let rawCategorySupply: readonly RawCategorySupplyRow[];
    try {
      rawCategorySupply = (
        await pool.query<RawCategorySupplyRow>(`
          SELECT category,
                 count(*)::int AS agent_count,
                 count(*) FILTER (WHERE listing_status = 'published')::int AS published_count,
                 count(*) FILTER (WHERE verification_status = 'verified')::int AS verified_count,
                 count(*) FILTER (WHERE runtime_status = 'live')::int AS live_count
            FROM agents
           GROUP BY category
           ORDER BY category
        `)
      ).rows;
    } catch {
      throw new ReadinessError("DATABASE_CATEGORY_SUPPLY_UNAVAILABLE");
    }
    const categorySupply = parseCategorySupply(rawCategorySupply);
    const diagnosis = diagnoseMarketplaceData(counts, {
      ingestionEnabled: config.erc8004IngestionEnabled,
      scanDiscoveryEnabled: config.erc8004ScanDiscoveryEnabled,
      semanticRetrievalEnabled: config.marketplaceSemanticRetrievalEnabled
    });
    return {
      database: identity.database,
      role: identity.role,
      pgvectorVersion: identity.pgvector_version,
      migrations: journalInspection,
      counts,
      categorySupply,
      diagnosis
    };
  } finally {
    await pool.end();
  }
}

function recordConfiguration(config: RuntimeConfig): ReadinessReport["configuration"] {
  return {
    dataMode: process.env.MARKETPLACE_DATA_MODE ?? null,
    databaseSsl: config.databaseSsl,
    semanticRetrievalEnabled: config.marketplaceSemanticRetrievalEnabled,
    ingestionEnabled: config.erc8004IngestionEnabled,
    scanDiscoveryEnabled: config.erc8004ScanDiscoveryEnabled
  };
}

function checkCoreEnvironment(): readonly string[] {
  const reasons: string[] = [];
  if (process.env.MARKETPLACE_DATA_MODE !== "live") {
    reasons.push("MARKETPLACE_DATA_MODE_NOT_LIVE");
  }
  for (const name of coreFeatureEnvironmentNames) {
    const value = process.env[name];
    if (value !== undefined && value !== "false" && value !== "") {
      reasons.push(value === "true" ? `${name}_ENABLED_CORE_GATE_VIOLATION` : `${name}_INVALID`);
    }
  }
  return reasons;
}

async function validateSemanticReadiness(config: RuntimeConfig): Promise<void> {
  if (!config.marketplaceSemanticRetrievalEnabled) return;
  try {
    const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
    validateSemanticEmbeddingLock(lock, config);
  } catch {
    // Keep the readiness envelope stable and never expose lock/provider
    // details. The ingestion and web entry points apply the same validation.
    throw new ReadinessError("SEMANTIC_EMBEDDING_NOT_READY");
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedApiUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ReadinessError("WEB_API_URL_INVALID");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new ReadinessError("WEB_API_URL_INVALID");
  }
  return url;
}

async function probeMarketplaceApi(): Promise<ApiInspection> {
  const configuredUrl = process.env.BNBERA_MARKETPLACE_API_URL;
  if (configuredUrl === undefined || configuredUrl.trim() === "") {
    return { status: "blocked", reasonCode: "WEB_API_URL_MISSING" };
  }

  let url: URL;
  try {
    url = boundedApiUrl(configuredUrl);
  } catch (error) {
    return {
      status: "blocked",
      reasonCode: error instanceof ReadinessError ? error.reasonCode : "WEB_API_URL_INVALID"
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_HTTP_PROBE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
    } catch {
      return { status: "blocked", reasonCode: "WEB_API_UNREACHABLE" };
    }
    if (!response.ok) {
      return { status: "blocked", reasonCode: "WEB_API_HTTP_ERROR", httpStatus: response.status };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "blocked", reasonCode: "WEB_API_NON_JSON", httpStatus: response.status };
    }
    const record = objectRecord(body);
    if (record === null) {
      return { status: "blocked", reasonCode: "WEB_API_CONTRACT_INVALID", httpStatus: response.status };
    }
    const contractVersion = record.contractVersion;
    const responseStatus = record.status;
    const responseMode = record.mode;
    const total = record.total;
    const agents = record.agents;
    const excluded = record.excluded;
    const meta = objectRecord(record.meta);
    const fixtureCount = meta?.fixtureCount;
    const retrievalMode = meta?.retrievalMode;
    if (
      contractVersion !== MARKETPLACE_CONTRACT_VERSION ||
      typeof responseStatus !== "string" ||
      !["ready", "loading", "empty", "degraded", "error"].includes(responseStatus) ||
      typeof responseMode !== "string" ||
      !["fixture", "live", "degraded", "empty", "error"].includes(responseMode) ||
      (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0) ||
      !Array.isArray(agents) ||
      !Array.isArray(excluded) ||
      (fixtureCount !== undefined &&
        (typeof fixtureCount !== "number" ||
          !Number.isSafeInteger(fixtureCount) ||
          fixtureCount < 0))
    ) {
      return { status: "blocked", reasonCode: "WEB_API_CONTRACT_INVALID", httpStatus: response.status };
    }
    if (responseMode === "fixture" || (typeof fixtureCount === "number" && fixtureCount > 0)) {
      return { status: "blocked", reasonCode: "WEB_API_FIXTURE_FALLBACK", httpStatus: response.status };
    }
    if (responseStatus === "error" || responseMode === "error") {
      return { status: "blocked", reasonCode: "WEB_API_RESPONSE_ERROR", httpStatus: response.status };
    }
    if (retrievalMode !== "deterministic") {
      return { status: "blocked", reasonCode: "WEB_API_RETRIEVAL_MODE_UNEXPECTED", httpStatus: response.status };
    }
    const validatedContractVersion = contractVersion as string;
    const validatedResponseStatus = responseStatus as string;
    const validatedResponseMode = responseMode as string;
    const validatedTotal = total as number;
    return {
      status: "pass",
      httpStatus: response.status,
      contractVersion: validatedContractVersion,
      responseStatus: validatedResponseStatus,
      responseMode: validatedResponseMode,
      total: validatedTotal,
      returnedAgents: agents.length,
      excluded: excluded.length,
      fixtureCount: typeof fixtureCount === "number" ? fixtureCount : 0,
      retrievalMode
    };
  } finally {
    clearTimeout(timeout);
  }
}

function blockedReport(
  scope: ReadinessReport["scope"],
  configuration: ReadinessReport["configuration"],
  reasonCodes: readonly string[]
): ReadinessReport {
  return {
    contractVersion: "bnbera.marketplace-readiness/v0.1",
    scope,
    status: "blocked",
    dataState: null,
    configuration,
    database: null,
    api: { status: "skipped" },
    reasonCodes
  };
}

function printReport(report: ReadinessReport): void {
  // Deliberately print only bounded state, counts and reason codes. Never add
  // connection strings, environment values, response bodies or stack traces.
  console.log(JSON.stringify(report, null, 2));
}

export async function runMarketplaceReadiness(options: Readonly<{ databaseOnly?: boolean }> = {}): Promise<number> {
  const scope = options.databaseOnly ? "database-only" : "database-and-web";
  let config: RuntimeConfig;
  try {
    config = loadRuntimeConfig(process.env);
  } catch {
    printReport(blockedReport(scope, {
      dataMode: process.env.MARKETPLACE_DATA_MODE ?? null,
      databaseSsl: null,
      semanticRetrievalEnabled: null,
      ingestionEnabled: null,
      scanDiscoveryEnabled: null
    }, ["RUNTIME_CONFIGURATION_INVALID"]));
    return 2;
  }

  const configuration = recordConfiguration(config);
  const environmentReasons = checkCoreEnvironment();
  if (environmentReasons.length > 0) {
    printReport(blockedReport(scope, configuration, environmentReasons));
    return 2;
  }

  try {
    await validateSemanticReadiness(config);
  } catch (error) {
    const reasonCode = error instanceof ReadinessError ? error.reasonCode : "SEMANTIC_EMBEDDING_NOT_READY";
    printReport(blockedReport(scope, configuration, [reasonCode]));
    return 2;
  }

  let database: DatabaseInspection;
  try {
    database = await inspectDatabase(config);
  } catch (error) {
    const reasonCode = error instanceof ReadinessError ? error.reasonCode : "DATABASE_UNAVAILABLE";
    printReport(blockedReport(scope, configuration, [reasonCode]));
    return 1;
  }

  const api = options.databaseOnly ? { status: "skipped" as const } : await probeMarketplaceApi();
  const reasonCodes = [...database.diagnosis.reasonCodes];
  if (api.status === "blocked" && api.reasonCode !== undefined) reasonCodes.push(api.reasonCode);
  const status: ReadinessReport["status"] = api.status === "blocked"
    ? "blocked"
    : database.diagnosis.state;
  printReport({
    contractVersion: "bnbera.marketplace-readiness/v0.1",
    scope,
    status,
    dataState: database.diagnosis.state,
    configuration,
    database,
    api,
    reasonCodes
  });
  return api.status === "blocked" ? 1 : 0;
}

const isMainModule = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const databaseOnly = process.argv.slice(2).includes("--database-only");
  void runMarketplaceReadiness({ databaseOnly }).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    printReport(blockedReport(databaseOnly ? "database-only" : "database-and-web", {
      dataMode: process.env.MARKETPLACE_DATA_MODE ?? null,
      databaseSsl: null,
      semanticRetrievalEnabled: null,
      ingestionEnabled: null,
      scanDiscoveryEnabled: null
    }, ["READINESS_CHECK_FAILED"]));
    process.exitCode = 1;
  });
}
