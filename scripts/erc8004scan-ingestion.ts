import { loadRuntimeConfig } from "../packages/config/src/index.ts";
import {
  Erc8004ScanJob,
  EightHundredFourScanHttpClient,
  PostgresIngestionRepository,
  createEightHundredFourScanAdapter,
  mapOfficialEightHundredFourScanCandidate,
  readErc8004PipelineGates,
  type Erc8004ScanJobResult
} from "../packages/agent-ingestion/src/index.ts";

function optionalText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = optionalText(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its safe bound`);
  }
  return parsed;
}

function optionalBoolean(name: string): boolean | undefined {
  const value = optionalText(name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function sanitizedResult(result: Erc8004ScanJobResult): Record<string, unknown> {
  return {
    status: result.status,
    scope: result.scope,
    queryDigest: result.queryDigest,
    nextOffset: result.nextOffset,
    nextCursor: result.nextCursor,
    total: result.total,
    metrics: result.metrics,
    warnings: result.warnings,
    checkpoint: result.checkpoint === null
      ? null
      : {
          pagesProcessed: result.checkpoint.pagesProcessed,
          candidatesProcessed: result.checkpoint.candidatesProcessed,
          cursorVersion: result.checkpoint.cursorVersion,
          completedAt: result.checkpoint.completedAt?.toISOString() ?? null,
          updatedAt: result.checkpoint.updatedAt.toISOString()
        }
  };
}

async function main(): Promise<void> {
  const runtime = loadRuntimeConfig(process.env);
  const pipelineGates = readErc8004PipelineGates(process.env);
  if (!pipelineGates.ERC8004_INGESTION_ENABLED || !pipelineGates.ERC8004SCAN_DISCOVERY_ENABLED) {
    process.stdout.write(`${JSON.stringify({ status: "disabled", warnings: ["ERC-8004 discovery is disabled by feature gate."] })}\n`);
    return;
  }
  if (!runtime.databaseUrl) throw new Error("DATABASE_URL is required for the 8004scan job");
  const chainId = boundedNumber("ERC8004_SCAN_CHAIN_ID", runtime.bscChainId, 1, 2_147_483_647);
  const maxPages = boundedNumber("ERC8004SCAN_MAX_PAGES", 5, 1, 100);
  const maxCandidates = boundedNumber("ERC8004SCAN_MAX_CANDIDATES", 500, 1, 10_000);
  const maxRunMs = boundedNumber("ERC8004SCAN_MAX_RUN_MS", 120_000, 250, 600_000);
  const fullDirectory = optionalBoolean("MARKETPLACE_DIRECTORY_FULL_SCAN") === true;
  const client = EightHundredFourScanHttpClient.fromEnvironment(process.env, fullDirectory ? {maxRetries:0} : {});
  const adapter = createEightHundredFourScanAdapter(fullDirectory ? {listCandidates:query=>client.listCandidates(query)} : client, fullDirectory ? raw => { const mapped=mapOfficialEightHundredFourScanCandidate(raw); return {...mapped,sourceReference:`${mapped.sourceReference}|directory-full-v1`}; } : undefined, fullDirectory ? "bnbera-directory-full-v1" : undefined);
  const repository = new PostgresIngestionRepository(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  try {
    const job = new Erc8004ScanJob({
      repository,
      adapter,
      gates: {
        ERC8004_INGESTION_ENABLED: pipelineGates.ERC8004_INGESTION_ENABLED,
        ERC8004SCAN_DISCOVERY_ENABLED: pipelineGates.ERC8004SCAN_DISCOVERY_ENABLED
      }
    });
    const result = await job.run({
      scope: optionalText("ERC8004SCAN_JOB_SCOPE") ?? `erc8004scan:list:${chainId}`,
      maxPages,
      maxCandidates,
      maxRunMs,
      query: {
        chainId,
        ...(fullDirectory ? { isActive: "any" as const, sortBy: "created_at" as const, sortOrder: "asc" as const } : {}),
        limit: boundedNumber("ERC8004SCAN_PAGE_SIZE", 20, 1, 100),
        ...(optionalBoolean("ERC8004_SCAN_IS_TESTNET") === undefined ? {} : { isTestnet: optionalBoolean("ERC8004_SCAN_IS_TESTNET") }),
        ...(optionalText("ERC8004_SCAN_SUPPORTED_PROTOCOL") === undefined ? {} : { supportedProtocol: optionalText("ERC8004_SCAN_SUPPORTED_PROTOCOL") }),
        ...(optionalText("ERC8004_SCAN_SEARCH") === undefined ? {} : { search: optionalText("ERC8004_SCAN_SEARCH") })
      }
    });
    process.stdout.write(`${JSON.stringify(sanitizedResult(result))}\n`);
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "SCAN_JOB_FAILED";
  process.stderr.write(`${JSON.stringify({ errorCode: code })}\n`);
  process.exitCode = 1;
});
