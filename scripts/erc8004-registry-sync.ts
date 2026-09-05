import { readFile } from "node:fs/promises";
import { loadRuntimeConfig } from "../packages/config/src/runtime.ts";
import {
  BoundedMetadataResolver,
  Erc8004DirectRegistrySyncJob,
  Erc8004MarketplaceCompositionRunner,
  Erc8004Pipeline,
  JsonRpcClient,
  PostgresIngestionRepository,
  createOfficialErc8004RegistryReader,
  officialErc8004IdentityAbiSha256,
  readErc8004PipelineGates,
  resolveErc8004RegistrySyncConfig,
  type DirectRegistrySyncJobResult
} from "../packages/agent-ingestion/src/index.ts";
import type { MarketplaceCompositionPublicationResult } from "../packages/agent-ingestion/src/composition.ts";

function optionalText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function boundedNumber(name: string, fallback: number | undefined, minimum: number, maximum: number): number {
  const value = optionalText(name);
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`${name} is required`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its safe bound`);
  }
  return parsed;
}

function rpcEndpoint(chainId: number): string | undefined {
  return optionalText(chainId === 56 ? "BSC_MAINNET_RPC_URL" : "BSC_TESTNET_RPC_URL");
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return fallback;
}

function sanitized(result: DirectRegistrySyncJobResult): Readonly<Record<string, unknown>> {
  return {
    status: result.status,
    reason: result.reason,
    forwardedCount: result.forwardedCount,
    forwardedIdentityKeys: result.forwardedIdentityKeys,
    composition: result.composition,
    sync: result.sync === null ? null : {
      scannedFromBlock: result.sync.scannedFromBlock,
      scannedThroughBlock: result.sync.scannedThroughBlock,
      insertedObservationCount: result.sync.insertedObservationCount,
      promotedObservationCount: result.sync.promotedObservationCount,
      orphanedObservationCount: result.sync.orphanedObservationCount,
      affectedIdentityKeys: result.sync.affectedIdentityKeys,
      reorgRewound: result.sync.reorgRewound,
      checkpoint: result.sync.checkpoint === null ? null : {
        lastScannedBlock: result.sync.checkpoint.lastScannedBlock,
        lastScannedBlockHash: result.sync.checkpoint.lastScannedBlockHash,
        lastFinalizedBlock: result.sync.checkpoint.lastFinalizedBlock,
        lastFinalizedBlockHash: result.sync.checkpoint.lastFinalizedBlockHash,
        confirmationThreshold: result.sync.checkpoint.confirmationThreshold,
        cursorVersion: result.sync.checkpoint.cursorVersion
      }
    }
  };
}

async function readStandardsLock(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
  } catch {
    throw new Error("STANDARDS_LOCK_UNAVAILABLE");
  }
}

async function main(): Promise<void> {
  const gates = readErc8004PipelineGates(process.env);
  const directGate = process.env.ERC8004_DIRECT_REGISTRY_SYNC_ENABLED === "true";
  if (!gates.ERC8004_INGESTION_ENABLED || !directGate) {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: !gates.ERC8004_INGESTION_ENABLED ? "ERC8004_INGESTION_DISABLED" : "ERC8004_DIRECT_REGISTRY_SYNC_DISABLED" })}\n`);
    return;
  }

  const runtime = loadRuntimeConfig(process.env);
  if (runtime.databaseUrl === undefined) throw new Error("DATABASE_URL is required for direct registry sync");
  const chainId = boundedNumber("ERC8004_REGISTRY_CHAIN_ID", runtime.bscChainId, 56, 97);
  const lock = await readStandardsLock();
  const config = resolveErc8004RegistrySyncConfig(lock, chainId, officialErc8004IdentityAbiSha256);
  const endpoint = rpcEndpoint(chainId);
  if (endpoint === undefined) throw new Error("REGISTRY_READER_NOT_CONFIGURED");

  const repository = new PostgresIngestionRepository(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  const checkpoint = await repository.getCheckpoint(config.chainId, config.identityRegistry);
  const startBlock = checkpoint === null
    ? boundedNumber("ERC8004_REGISTRY_START_BLOCK", undefined, 0, 2_147_483_647)
    : boundedNumber("ERC8004_REGISTRY_START_BLOCK", 0, 0, 2_147_483_647);
  const maxBlockRange = boundedNumber("ERC8004_REGISTRY_MAX_BLOCK_RANGE", 10_000, 1, 100_000);
  const maxEvents = boundedNumber("ERC8004_REGISTRY_MAX_EVENTS", 10_000, 1, 100_000);
  const maxCandidates = boundedNumber("ERC8004_REGISTRY_MAX_CANDIDATES", 20, 1, 20);
  // Keep database/publication dependencies behind the direct gate so a
  // disabled command can report its state without initializing adapters.
  const [{ PostgresMarketplacePublicationService }, { createDb }] = await Promise.all([
    import("../packages/marketplace/src/index.ts"),
    import("../packages/db/src/client.ts")
  ]);
  const { pool } = createDb(runtime.databaseUrl, { ssl: runtime.databaseSsl });

  try {
    const reader = createOfficialErc8004RegistryReader({
      chainId: config.chainId,
      identityRegistry: config.identityRegistry,
      client: new JsonRpcClient(endpoint, { timeoutMs: boundedNumber("ERC8004_RPC_TIMEOUT_MS", 15_000, 250, 120_000) }),
      expectedAbiSha256: config.abiSha256,
      // The lock-derived confirmation threshold makes the exact block reads
      // finality-bound for this command. No head read is used for publication.
      readConsistency: "finalized",
      maxLogResults: maxEvents
    });
    const metadataResolver = new BoundedMetadataResolver({
      ipfsGateways: (optionalText("ERC8004_IPFS_GATEWAYS") ?? "").split(",").map((value) => value.trim()).filter((value) => value.length > 0)
    });
    const pipeline = new Erc8004Pipeline({
      repository,
      metadataResolver,
      // Direct event sync already established the canonical identity read;
      // omitting registryReader avoids replacing it with an unfinalized head.
      gates: {
        ERC8004_INGESTION_ENABLED: true,
        ERC8004SCAN_DISCOVERY_ENABLED: false,
        MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: false
      }
    });
    const publication = new PostgresMarketplacePublicationService(pool);
    const composition = new Erc8004MarketplaceCompositionRunner({
      repository,
      pipeline,
      publisher: {
        async publish(input): Promise<MarketplaceCompositionPublicationResult> {
          const result = await publication.publish(input);
          return {
            status: result.status,
            versionId: result.versionId,
            diagnostics: result.diagnostics.map((diagnostic) => ({ code: diagnostic.code }))
          };
        }
      },
      maxCandidates
    });
    const job = new Erc8004DirectRegistrySyncJob({
      repository,
      reader,
      gates: {
        ERC8004_INGESTION_ENABLED: gates.ERC8004_INGESTION_ENABLED,
        ERC8004_DIRECT_REGISTRY_SYNC_ENABLED: directGate
      },
      chainId: config.chainId,
      identityRegistry: config.identityRegistry,
      startBlock,
      confirmationThreshold: config.confirmationThreshold,
      maxBlockRange,
      maxEvents,
      maxCandidates,
      forwardCandidates: async (candidates) => composition.run({ candidates })
    });
    const result = await job.run();
    process.stdout.write(`${JSON.stringify(sanitized(result))}\n`);
  } finally {
    await repository.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error, "REGISTRY_SYNC_FAILED") })}\n`);
  process.exitCode = 1;
});
