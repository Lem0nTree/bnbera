import { readFile } from "node:fs/promises";
import { loadRuntimeConfig } from "../packages/config/src/runtime.ts";
import {
  JsonRpcClient,
  JsonRpcReputationChainReader,
  PostgresIngestionRepository,
  ReputationIngestionService,
  assertOfficialErc8004ReputationAbi,
  readErc8004PipelineGates,
  resolveErc8004ReputationSyncConfig,
  type ReputationSyncResult
} from "../packages/agent-ingestion/src/index.ts";

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
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is outside its safe bound`);
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

function sanitized(result: ReputationSyncResult): Readonly<Record<string, unknown>> {
  return {
    status: "completed",
    scannedFromBlock: result.scannedFromBlock,
    scannedThroughBlock: result.scannedThroughBlock,
    insertedEventCount: result.insertedEventCount,
    promotedEventCount: result.promotedEventCount,
    orphanedEventCount: result.orphanedEventCount,
    affectedIdentityKeys: result.affectedIdentityKeys,
    reorgRewound: result.reorgRewound,
    checkpoint: result.checkpoint === null ? null : {
      lastScannedBlock: result.checkpoint.lastScannedBlock,
      lastScannedBlockHash: result.checkpoint.lastScannedBlockHash,
      lastFinalizedBlock: result.checkpoint.lastFinalizedBlock,
      lastFinalizedBlockHash: result.checkpoint.lastFinalizedBlockHash,
      confirmationThreshold: result.checkpoint.confirmationThreshold,
      cursorVersion: result.checkpoint.cursorVersion
    }
  };
}

async function main(): Promise<void> {
  const gates = readErc8004PipelineGates(process.env);
  if (!gates.ERC8004_INGESTION_ENABLED || process.env.ERC8004_REPUTATION_SYNC_ENABLED !== "true") {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: !gates.ERC8004_INGESTION_ENABLED ? "ERC8004_INGESTION_DISABLED" : "ERC8004_REPUTATION_SYNC_DISABLED" })}\n`);
    return;
  }
  const runtime = loadRuntimeConfig(process.env);
  if (runtime.databaseUrl === undefined) throw new Error("DATABASE_URL is required for reputation sync");
  const chainId = boundedNumber("ERC8004_REPUTATION_CHAIN_ID", runtime.bscChainId, 1, 2_147_483_647);
  const lock = JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
  const config = resolveErc8004ReputationSyncConfig(lock, chainId, "867b7975a5f2f9fee38c4a148a84471b141f4de91409ccc0c6bebe3df4f04001");
  const endpoint = rpcEndpoint(chainId);
  if (endpoint === undefined) throw new Error("REPUTATION_READER_NOT_CONFIGURED");
  const repository = new PostgresIngestionRepository(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  try {
    const checkpoint = await repository.getReputationCheckpoint(config.chainId, config.identityRegistry, config.reputationRegistry);
    const startBlock = checkpoint === null
      ? boundedNumber("ERC8004_REPUTATION_START_BLOCK", undefined, 0, 2_147_483_647)
      : boundedNumber("ERC8004_REPUTATION_START_BLOCK", 0, 0, 2_147_483_647);
    const maxBlockRange = boundedNumber("ERC8004_REPUTATION_MAX_BLOCK_RANGE", 10_000, 1, 100_000);
    const maxEvents = boundedNumber("ERC8004_REPUTATION_MAX_EVENTS", 10_000, 1, 100_000);
    const decoder = assertOfficialErc8004ReputationAbi(config.abiSha256);
    const reader = new JsonRpcReputationChainReader({
      chainId: config.chainId,
      identityRegistry: config.identityRegistry,
      reputationRegistry: config.reputationRegistry,
      client: new JsonRpcClient(endpoint, { timeoutMs: boundedNumber("ERC8004_RPC_TIMEOUT_MS", 15_000, 250, 120_000) }),
      // eth_getLogs treats each topic position as AND. Put both reviewed
      // event signatures in topic0's nested array so NewFeedback OR
      // FeedbackRevoked is requested without accidentally requiring a second
      // topic position.
      logTopics: [decoder.logTopics],
      decodeLog: decoder.decodeLog,
      maxLogResults: maxEvents
    });
    const result = await new ReputationIngestionService(repository).sync(reader, {
      chainId: config.chainId,
      identityRegistry: config.identityRegistry,
      reputationRegistry: config.reputationRegistry,
      startBlock,
      confirmationThreshold: config.confirmationThreshold,
      finalityMode: config.finalityMode,
      maxBlockRange,
      maxEvents
    });
    process.stdout.write(`${JSON.stringify(sanitized(result))}\n`);
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error, "REPUTATION_SYNC_FAILED") })}\n`);
  process.exitCode = 1;
});
