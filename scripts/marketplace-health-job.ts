import { loadRuntimeConfig } from "../packages/config/src/runtime.ts";
import {
  BoundedServiceProbe,
  HttpServiceProbeTransport,
  PostgresIngestionRepository,
  readErc8004PipelineGates
} from "../packages/agent-ingestion/src/index.ts";
import { erc8004IdentityKey } from "../packages/domain/src/index.ts";
import { createDb } from "../packages/db/src/client.ts";

type AdvisoryPool = {
  connect(): Promise<{
    query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ readonly rows: readonly T[]; readonly rowCount?: number | null }>;
    release(): void;
  }>;
};

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

function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return fallback;
}

async function withAdvisoryLock<T>(pool: AdvisoryPool, lockName: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
      [lockName]
    );
    if (result.rows[0]?.locked !== true) {
      await client.query("ROLLBACK");
      const error = new Error("MARKETPLACE_HEALTH_ALREADY_RUNNING");
      Object.assign(error, { code: "MARKETPLACE_HEALTH_ALREADY_RUNNING" });
      throw error;
    }
    const value = await work();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the stable job error; the pool discards an unusable client.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const runtime = loadRuntimeConfig(process.env);
  const gates = readErc8004PipelineGates(process.env);
  if (!gates.ERC8004_INGESTION_ENABLED) {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: "ERC8004_INGESTION_DISABLED" })}\n`);
    return;
  }
  if (runtime.databaseUrl === undefined) throw new Error("DATABASE_URL_REQUIRED");

  const maxAgents = boundedNumber("ERC8004_HEALTH_MAX_AGENTS", 128, 1, 500);
  const maxServices = boundedNumber("ERC8004_HEALTH_MAX_SERVICES", 32, 1, 256);
  const runMs = boundedNumber("ERC8004_HEALTH_MAX_RUN_MS", 45_000, 250, 120_000);
  const timeoutMs = boundedNumber("ERC8004_SERVICE_PROBE_TIMEOUT_MS", 5_000, 250, 30_000);
  const maxResponseBytes = boundedNumber("ERC8004_SERVICE_PROBE_MAX_BYTES", 64 * 1024, 1_024, 1_048_576);
  const maxConcurrency = boundedNumber("ERC8004_HEALTH_PROBE_CONCURRENCY", 2, 1, 16);
  const minIntervalMs = boundedNumber("ERC8004_HEALTH_PROBE_INTERVAL_MS", 250, 0, 60_000);
  const localProbeEscapes = runtime.nodeEnv === "test" || runtime.environment === "development";
  const { pool } = createDb(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  const repository = new PostgresIngestionRepository(pool, { ssl: runtime.databaseSsl });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runMs);
  try {
    const result = await withAdvisoryLock(pool, "bnbera:marketplace:health", async () => {
      const identities = (await repository.listIdentities({ chainId: runtime.bscChainId }))
        .filter((identity) => identity.state.listingStatus === "published")
        .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime() || erc8004IdentityKey(left.identity).localeCompare(erc8004IdentityKey(right.identity)))
        .slice(0, maxAgents);
      const transport = new HttpServiceProbeTransport({
        allowPrivateAddresses: localProbeEscapes && process.env.ERC8004_ALLOW_PRIVATE_ADDRESSES === "true",
        allowInsecureHttp: localProbeEscapes && process.env.ERC8004_ALLOW_INSECURE_SERVICE_HTTP === "true"
      });
      const probe = new BoundedServiceProbe(transport, { timeoutMs, maxResponseBytes, signal: controller.signal });
      let serviceCount = 0;
      let healthyCount = 0;
      let unhealthyCount = 0;
      let skippedCount = 0;
      for (const identity of identities) {
        if (controller.signal.aborted) break;
        const services = (await repository.listServices(erc8004IdentityKey(identity.identity))).slice(0, maxServices);
        if (services.length === 0) {
          skippedCount += 1;
          continue;
        }
        const results = await probe.probeManyAndPersist(repository, services, {
          maxConcurrency,
          minIntervalMs,
          maxServices,
          signal: controller.signal
        });
        serviceCount += results.length;
        healthyCount += results.filter((result) => result.validationStatus === "healthy").length;
        unhealthyCount += results.filter((result) => result.validationStatus !== "healthy").length;
      }
      return {
        status: controller.signal.aborted ? "partial" : "completed",
        agents: identities.length,
        services: serviceCount,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        skipped: skippedCount
      } as const;
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    clearTimeout(timeout);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error, "MARKETPLACE_HEALTH_FAILED") })}\n`);
  process.exitCode = 1;
});
