import { readFile } from "node:fs/promises";
import { loadRuntimeConfig, validateSemanticEmbeddingLock } from "../packages/config/src/runtime.ts";
import {
  BoundedMetadataResolver,
  BoundedServiceProbe,
  Erc8004MarketplaceCompositionRunner,
  Erc8004SemanticCandidateCollector,
  Erc8004Pipeline,
  Erc8004ScanJob,
  EightHundredFourScanHttpClient,
  HttpServiceProbeTransport,
  JsonRpcClient,
  JsonRpcRegistryChainReader,
  ManualImportAdapter,
  PgCategoryPredictionSink,
  PgVectorSemanticRepository,
  PostgresIngestionRepository,
  PostgresMarketplaceIngestionState,
  createEightHundredFourScanAdapter,
  createOfficialErc8004RegistryReadDefinitions,
  createEmbeddingProviderFromRuntimeConfig,
  pgVectorStorageDimension,
  readErc8004PipelineGates,
  resolveErc8004RegistrySyncConfig,
  type IdentityCandidate,
  type EmbeddingProvider,
  type IngestionSource,
  type MarketplaceCompositionPublicationResult,
  type RegistryChainReader,
  type SemanticVectorRepository
} from "../packages/agent-ingestion/src/index.ts";
import { PostgresMarketplacePublicationService } from "../packages/marketplace/src/index.ts";
import { createDb } from "../packages/db/src/client.ts";
import {
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "../packages/domain/src/index.ts";

type LockNetwork = {
  readonly erc8004?: {
    readonly identityRegistry?: unknown;
    readonly abiHashes?: { readonly identityRegistry?: unknown };
  };
};

type RuntimeStandardsLock = {
  readonly networks?: Readonly<Record<string, LockNetwork>>;
};

type ScanSummary = {
  readonly status: "disabled" | "completed" | "partial" | "failed";
  readonly errorCode: string | null;
  readonly pagesFetched: number;
  readonly candidatesFetched: number;
  readonly candidatesCommitted: number;
  readonly checkpoint: {
    readonly pagesProcessed: number;
    readonly candidatesProcessed: number;
    readonly cursorVersion: number;
    readonly completedAt: string | null;
  } | null;
};

type RegistrySummary = {
  readonly configured: boolean;
  readonly readConsistency: "finalized" | "provisional";
  readonly finalityMode: "rpc-finalized-tag" | "confirmations" | null;
  readonly reason: string | null;
};

type SemanticDiscoverySummary = {
  readonly status: "completed" | "degraded";
  readonly candidates: number;
  readonly categories: readonly {
    readonly category: string;
    readonly status: "completed" | "failed" | "cancelled";
    readonly candidateCount: number;
    readonly diagnostic: string | null;
  }[];
  readonly diagnostics: readonly string[];
};

const allowedPersistedSources = new Set<IngestionSource>(["8004scan", "registry_event", "manual"]);
const sourcePriority: Readonly<Record<IngestionSource, number>> = {
  manual: 0,
  "8004scan": 1,
  registry_event: 2,
  creator: 3
};

function optionalText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = optionalText(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is outside its safe bound`);
  return parsed;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const value = optionalText(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return fallback;
}

function parseLock(value: unknown): RuntimeStandardsLock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("STANDARDS_LOCK_INVALID");
  return value as RuntimeStandardsLock;
}

async function readStandardsLock(): Promise<RuntimeStandardsLock> {
  try {
    return parseLock(JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && error.message === "STANDARDS_LOCK_INVALID") throw error;
    throw new Error("STANDARDS_LOCK_UNAVAILABLE");
  }
}

function lockedRegistry(lock: RuntimeStandardsLock, chainId: number): string | null {
  const value = lock.networks?.[String(chainId)]?.erc8004?.identityRegistry;
  if (typeof value !== "string") return null;
  try {
    return normalizeEvmAddress(value);
  } catch {
    return null;
  }
}

function lockedAbiHash(lock: RuntimeStandardsLock, chainId: number): string | null {
  const value = lock.networks?.[String(chainId)]?.erc8004?.abiHashes?.identityRegistry;
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value) ? value.toLowerCase() : null;
}

function rpcEndpoint(chainId: number): string | undefined {
  return optionalText(chainId === 56 ? "BSC_MAINNET_RPC_URL" : "BSC_TESTNET_RPC_URL");
}

function manualIdentityFromKey(value: string, chainId: number, registry: string): Erc8004Identity {
  const match = /^([^:]+):([0-9]+):(0x[0-9a-f]{40}):([0-9]+)$/iu.exec(value.trim());
  if (match === null) throw new Error("MANUAL_IDENTITY_INVALID");
  const identity = normalizeErc8004Identity({
    namespace: match[1],
    chainId: Number(match[2]),
    identityRegistry: match[3],
    agentId: match[4]
  });
  if (identity.chainId !== chainId || identity.identityRegistry !== registry) throw new Error("MANUAL_IDENTITY_NETWORK_MISMATCH");
  return identity;
}

function manualImportCandidate(value: unknown, chainId: number, registry: string, index: number): IdentityCandidate {
  const adapter = new ManualImportAdapter();
  if (typeof value === "string") {
    const identity = manualIdentityFromKey(value, chainId, registry);
    return adapter.normalize({ identity, importReference: `manual:${erc8004IdentityKey(identity)}:${index}` });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("MANUAL_IMPORT_INVALID");
  const record = value as Record<string, unknown>;
  const identityValue = typeof record.identity === "string"
    ? manualIdentityFromKey(record.identity, chainId, registry)
    : record.identity;
  const identity = normalizeErc8004Identity(identityValue);
  if (identity.chainId !== chainId || identity.identityRegistry !== registry) throw new Error("MANUAL_IDENTITY_NETWORK_MISMATCH");
  const importReference = typeof record.importReference === "string" && record.importReference.trim().length > 0
    ? record.importReference
    : `manual:${erc8004IdentityKey(identity)}:${index}`;
  return adapter.normalize({
    identity,
    importReference,
    ...(record.importedAt === undefined ? {} : { importedAt: new Date(String(record.importedAt)) }),
    ...(record.metadata === undefined ? {} : { metadata: record.metadata as Readonly<Record<string, unknown>> }),
    ...(record.services === undefined ? {} : { services: record.services as readonly unknown[] }),
    ...(record.capabilityManifest === undefined ? {} : { capabilityManifest: record.capabilityManifest })
  });
}

function parseManualCandidates(chainId: number, registry: string): readonly IdentityCandidate[] {
  const raw = optionalText("ERC8004_MANUAL_IDENTITIES");
  if (raw === undefined) return [];
  let values: readonly unknown[];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("MANUAL_IMPORT_INVALID");
    values = parsed;
  } else {
    values = raw.split(/[\n,]/u).map((value) => value.trim()).filter((value) => value.length > 0);
  }
  if (values.length > 20) throw new Error("MANUAL_IMPORT_BOUND_EXCEEDED");
  return values.map((value, index) => manualImportCandidate(value, chainId, registry, index));
}

function candidateFromScanIdentity(identity: Erc8004Identity, observedAt: Date): IdentityCandidate {
  return {
    identity,
    source: "8004scan",
    sourceReference: `agent:${identity.chainId}:${identity.identityRegistry}:${identity.agentId}`,
    observedAt,
    normalizedIngestionVersion: "8004scan-openapi-0.4.363-v1"
  };
}

async function persistedCandidates(
  repository: PostgresIngestionRepository,
  chainId: number,
  registry: string,
  excludeKeys: ReadonlySet<string>,
  maxCandidates: number,
  isDue: (identityKey: string) => Promise<boolean>
): Promise<readonly IdentityCandidate[]> {
  const identities = [...await repository.listIdentities({ chainId, identityRegistry: registry })]
    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime() || erc8004IdentityKey(left.identity).localeCompare(erc8004IdentityKey(right.identity)));
  const candidates: IdentityCandidate[] = [];
  for (const record of identities) {
    const key = erc8004IdentityKey(record.identity);
    if (excludeKeys.has(key)) continue;
    if (!(await isDue(key))) continue;
    const sources = (await repository.listSources(key))
      .filter((source) => allowedPersistedSources.has(source.source))
      .sort((left, right) => sourcePriority[left.source] - sourcePriority[right.source] || right.lastObservedAt.getTime() - left.lastObservedAt.getTime() || left.sourceReference.localeCompare(right.sourceReference));
    const source = sources[0];
    if (source === undefined) continue;
    candidates.push({
      identity: record.identity,
      source: source.source,
      sourceReference: source.sourceReference,
      observedAt: source.lastObservedAt,
      ...(source.rawResponseDigest === null ? {} : { rawResponseDigest: source.rawResponseDigest }),
      normalizedIngestionVersion: source.normalizedIngestionVersion
    });
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
}

function buildRegistryReader(lock: RuntimeStandardsLock, chainId: number, registry: string): { readonly reader: RegistryChainReader | undefined; readonly summary: RegistrySummary } {
  const endpoint = rpcEndpoint(chainId);
  const abiHash = lockedAbiHash(lock, chainId);
  if (endpoint === undefined) return { reader: undefined, summary: { configured: false, readConsistency: "provisional", finalityMode: null, reason: "RPC_ENDPOINT_MISSING" } };
  if (abiHash === null) return { reader: undefined, summary: { configured: false, readConsistency: "provisional", finalityMode: null, reason: "ABI_HASH_UNRESOLVED" } };
  try {
    const syncConfig = resolveErc8004RegistrySyncConfig(lock, chainId, abiHash);
    const readConsistency = syncConfig.finalityMode === "rpc-finalized-tag" ? "finalized" : "provisional";
    const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: abiHash });
    return {
      reader: new JsonRpcRegistryChainReader({
        chainId,
        identityRegistry: registry,
        client: new JsonRpcClient(endpoint, { timeoutMs: boundedNumber("ERC8004_RPC_TIMEOUT_MS", 15_000, 250, 120_000) }),
        ...definitions,
        // BSC live publication is enabled only for the lock's finalized-tag
        // policy; unresolved policy remains unavailable.
        readConsistency
      }),
      summary: { configured: true, readConsistency, finalityMode: syncConfig.finalityMode, reason: null }
    };
  } catch (error) {
    return { reader: undefined, summary: { configured: false, readConsistency: "provisional", finalityMode: null, reason: safeErrorCode(error, "REGISTRY_READER_UNAVAILABLE") } };
  }
}

function sanitizedScan(result: {
  readonly status: "disabled" | "completed" | "partial";
  readonly metrics: { readonly pagesFetched: number; readonly candidatesFetched: number; readonly candidatesCommitted: number };
  readonly checkpoint: { readonly pagesProcessed: number; readonly candidatesProcessed: number; readonly cursorVersion: number; readonly completedAt: Date | null } | null;
}): ScanSummary {
  return {
    status: result.status,
    errorCode: null,
    pagesFetched: result.metrics.pagesFetched,
    candidatesFetched: result.metrics.candidatesFetched,
    candidatesCommitted: result.metrics.candidatesCommitted,
    checkpoint: result.checkpoint === null ? null : {
      pagesProcessed: result.checkpoint.pagesProcessed,
      candidatesProcessed: result.checkpoint.candidatesProcessed,
      cursorVersion: result.checkpoint.cursorVersion,
      completedAt: result.checkpoint.completedAt?.toISOString() ?? null
    }
  };
}

function sanitizedSemantic(result: SemanticDiscoverySummary): SemanticDiscoverySummary {
  return {
    status: result.status,
    candidates: result.candidates,
    categories: result.categories.map((category) => ({
      category: category.category,
      status: category.status,
      candidateCount: category.candidateCount,
      diagnostic: category.diagnostic
    })),
    diagnostics: [...result.diagnostics]
  };
}

async function main(): Promise<void> {
  const runtime = loadRuntimeConfig(process.env);
  const gates = readErc8004PipelineGates(process.env);
  if (!gates.ERC8004_INGESTION_ENABLED) {
    process.stdout.write(`${JSON.stringify({ status: "disabled", reason: "ERC8004_INGESTION_DISABLED" })}\n`);
    return;
  }
  if (runtime.databaseUrl === undefined) throw new Error("DATABASE_URL is required for marketplace ingestion");

  const chainId = boundedNumber("ERC8004_SCAN_CHAIN_ID", runtime.bscChainId, 1, 2_147_483_647);
  const lock = await readStandardsLock();
  if (runtime.marketplaceSemanticRetrievalEnabled) {
    // Semantic retrieval is independently lock-gated. A false release flag
    // may only be exercised by the explicit development/test canary mode.
    validateSemanticEmbeddingLock(lock, runtime);
  }
  const registry = lockedRegistry(lock, chainId);
  if (registry === null) throw new Error("REGISTRY_NOT_RESOLVED_FROM_STANDARDS_LOCK");
  const maxCandidates = boundedNumber("ERC8004_MARKETPLACE_MAX_CANDIDATES", 20, 1, 20);
  const pageSize = boundedNumber("ERC8004_SCAN_PAGE_SIZE", Math.min(20, maxCandidates), 1, Math.min(100, maxCandidates));
  const cursorScope = optionalText("ERC8004_MARKETPLACE_DISCOVERY_SCOPE") ?? `erc8004scan:marketplace:${chainId}`;
  const manual = parseManualCandidates(chainId, registry);
  const { reader: registryReader, summary: registrySummary } = buildRegistryReader(lock, chainId, registry);
  const repository = new PostgresIngestionRepository(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  const { pool } = createDb(runtime.databaseUrl, { ssl: runtime.databaseSsl });
  const state = new PostgresMarketplaceIngestionState(pool);
  let scanSummary: ScanSummary = {
    status: gates.ERC8004SCAN_DISCOVERY_ENABLED ? "failed" : "disabled",
    errorCode: gates.ERC8004SCAN_DISCOVERY_ENABLED ? "SCAN_NOT_ATTEMPTED" : null,
    pagesFetched: 0,
    candidatesFetched: 0,
    candidatesCommitted: 0,
    checkpoint: null
  };
  let semanticSummary: SemanticDiscoverySummary = {
    status: "completed",
    candidates: 0,
    categories: [],
    diagnostics: []
  };
  let cursor: Awaited<ReturnType<PostgresMarketplaceIngestionState["ensureDiscoveryCursor"]>>;
  try {
    cursor = await state.ensureDiscoveryCursor({
      scope: cursorScope,
      chainId,
      identityRegistry: registry,
      pageSize
    });
    const scanCandidates: IdentityCandidate[] = [];
    const semanticCandidates: IdentityCandidate[] = [];
    let discoveryAdapter: ReturnType<typeof createEightHundredFourScanAdapter> | undefined;
    if (gates.ERC8004SCAN_DISCOVERY_ENABLED) {
      try {
        const client = EightHundredFourScanHttpClient.fromEnvironment(process.env);
        const adapter = createEightHundredFourScanAdapter(client);
        discoveryAdapter = adapter;
        const job = new Erc8004ScanJob({
          repository,
          adapter,
          gates: {
            ERC8004_INGESTION_ENABLED: true,
            ERC8004SCAN_DISCOVERY_ENABLED: true
          }
        });
        const scanScope = `${cursorScope.slice(0, 96)}:sweep:${cursor.sweep}:offset:${cursor.nextOffset}`;
        const scan = await job.run({
          scope: optionalText("ERC8004SCAN_JOB_SCOPE") ?? scanScope,
          maxPages: boundedNumber("ERC8004SCAN_MAX_PAGES", 1, 1, 100),
          maxCandidates,
          maxRunMs: boundedNumber("ERC8004SCAN_MAX_RUN_MS", 120_000, 250, 600_000),
          query: {
            chainId,
            limit: pageSize,
            offset: cursor.nextOffset,
            ...(optionalText("ERC8004_SCAN_SEARCH") === undefined ? {} : { search: optionalText("ERC8004_SCAN_SEARCH") }),
            ...(optionalText("ERC8004_SCAN_SUPPORTED_PROTOCOL") === undefined ? {} : { supportedProtocol: optionalText("ERC8004_SCAN_SUPPORTED_PROTOCOL") }),
            ...(optionalText("ERC8004_SCAN_IS_TESTNET") === undefined ? {} : { isTestnet: parseBoolean("ERC8004_SCAN_IS_TESTNET", false) })
          }
        });
        scanSummary = sanitizedScan(scan);
        for (const candidate of scan.candidates) scanCandidates.push(candidateFromScanIdentity(candidate.identity.identity, new Date()));
        if (scan.checkpoint !== null) {
          // A provider can return an already-completed checkpoint with no
          // candidates after a process restart. Advance one bounded page in
          // that case so a crash between fetch and cursor persistence cannot
          // pin the sweep forever at the same offset.
          const returned = scan.metrics.candidatesFetched > 0 || scan.checkpoint.completedAt === null
            ? scan.metrics.candidatesFetched
            : pageSize;
          const providerNext = scan.checkpoint.nextOffset;
          const nextOffset = providerNext ?? (
            scan.checkpoint.total !== null && cursor.nextOffset + returned < scan.checkpoint.total
              ? cursor.nextOffset + returned
              : 0
          );
          await state.advanceDiscoveryCursor({
            scope: cursorScope,
            expectedOffset: cursor.nextOffset,
            nextOffset,
            total: scan.checkpoint.total,
            pageAt: new Date()
          });
        }
      } catch (error) {
        scanSummary = { ...scanSummary, status: "failed", errorCode: safeErrorCode(error, "SCAN_JOB_FAILED") };
      }
      if (discoveryAdapter !== undefined) {
        try {
          const semantic = await new Erc8004SemanticCandidateCollector({
            adapter: discoveryAdapter,
            maxCandidatesPerCategory: boundedNumber("ERC8004SCAN_SEMANTIC_PAGE_SIZE", Math.min(5, maxCandidates), 1, 20),
            maxCandidates,
            maxRunMs: boundedNumber("ERC8004SCAN_SEMANTIC_MAX_RUN_MS", 120_000, 250, 600_000)
          }).collect({ chainId, isTestnet: chainId === 97 });
          semanticSummary = sanitizedSemantic({
            status: semantic.status,
            candidates: semantic.candidates.length,
            categories: semantic.categories,
            diagnostics: semantic.diagnostics
          });
          for (const candidate of semantic.candidates) semanticCandidates.push(candidate);
        } catch (error) {
          semanticSummary = {
            status: "degraded",
            candidates: 0,
            categories: [],
            diagnostics: [safeErrorCode(error, "SEMANTIC_DISCOVERY_FAILED")]
          };
        }
      }
    }

    const attemptedAt = new Date();
    const initialCandidates: IdentityCandidate[] = [];
    for (const candidate of [...manual, ...scanCandidates]) {
      if (await state.isRetryDue(erc8004IdentityKey(candidate.identity), attemptedAt)) initialCandidates.push(candidate);
    }
    const initialKeys = new Set<string>(initialCandidates.map((candidate) => erc8004IdentityKey(candidate.identity)));
    const semanticFill = (await Promise.all(semanticCandidates
      .filter((candidate) => !initialKeys.has(erc8004IdentityKey(candidate.identity)))
      .map(async (candidate) => (await state.isRetryDue(erc8004IdentityKey(candidate.identity), attemptedAt)) ? candidate : null)))
      .filter((candidate): candidate is IdentityCandidate => candidate !== null)
      .slice(0, Math.max(0, maxCandidates - initialKeys.size));
    const selectedKeys = new Set<string>([...initialCandidates, ...semanticFill].map((candidate) => erc8004IdentityKey(candidate.identity)));
    const persisted = await persistedCandidates(repository, chainId, registry, selectedKeys, Math.max(0, maxCandidates - selectedKeys.size), (identityKey) => state.isRetryDue(identityKey, attemptedAt));
    const candidates = [...initialCandidates, ...semanticFill, ...persisted];
    const metadataResolver = new BoundedMetadataResolver({
      ipfsGateways: (optionalText("ERC8004_IPFS_GATEWAYS") ?? "").split(",").map((value) => value.trim()).filter((value) => value.length > 0)
    });
    const localProbeEscapes = runtime.nodeEnv === "test" || runtime.environment === "development";
    const probeTransport = new HttpServiceProbeTransport({
      allowPrivateAddresses: localProbeEscapes && parseBoolean("ERC8004_ALLOW_PRIVATE_ADDRESSES", false),
      allowInsecureHttp: localProbeEscapes && parseBoolean("ERC8004_ALLOW_INSECURE_SERVICE_HTTP", false)
    });
    const serviceProbe = new BoundedServiceProbe(probeTransport, {
      timeoutMs: boundedNumber("ERC8004_SERVICE_PROBE_TIMEOUT_MS", 5_000, 250, 30_000),
      maxResponseBytes: boundedNumber("ERC8004_SERVICE_PROBE_MAX_BYTES", 64 * 1024, 1_024, 1_048_576)
    });
    const pipeline = new Erc8004Pipeline({
      repository,
      ...(registryReader === undefined ? {} : { registryReader }),
      ...(registryReader === undefined ? {} : { registryReadPolicy: registrySummary.readConsistency === "finalized" ? "finalized-tag" as const : "provisional" as const }),
      metadataResolver,
      serviceProbe,
      serviceProbeOptions: {
        maxConcurrency: boundedNumber("ERC8004_SERVICE_PROBE_CONCURRENCY", 2, 1, 16),
        minIntervalMs: boundedNumber("ERC8004_SERVICE_PROBE_INTERVAL_MS", 250, 0, 60_000),
        maxServices: boundedNumber("ERC8004_SERVICE_PROBE_MAX_SERVICES", 32, 1, 256)
      },
      gates: {
        ERC8004_INGESTION_ENABLED: true,
        ERC8004SCAN_DISCOVERY_ENABLED: gates.ERC8004SCAN_DISCOVERY_ENABLED,
        // Enrichment remains embedding-free. Composition wires the explicit
        // semantic gate after publication/category persistence below.
        MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: false
      }
    });
    const publication = new PostgresMarketplacePublicationService(pool);
    const categorySink = new PgCategoryPredictionSink(pool, publication.versionIdForIdentityKey);
    let embeddingProvider: EmbeddingProvider | undefined;
    let vectorRepository: SemanticVectorRepository | undefined;
    if (runtime.marketplaceSemanticRetrievalEnabled && runtime.embedding !== null) {
      if (runtime.embedding.dimension !== pgVectorStorageDimension) {
        throw new Error("EMBEDDING_DIMENSION_INCOMPATIBLE_WITH_DATABASE_MIGRATION");
      }
      embeddingProvider = createEmbeddingProviderFromRuntimeConfig(
        runtime,
        (reference) => process.env[reference]
      );
      vectorRepository = new PgVectorSemanticRepository(pool, { storageDimension: pgVectorStorageDimension });
    }
    const runner = new Erc8004MarketplaceCompositionRunner({
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
      categorySink,
      semanticEmbeddingEnabled: runtime.marketplaceSemanticRetrievalEnabled,
      ...(embeddingProvider === undefined ? {} : { embeddingProvider }),
      ...(vectorRepository === undefined ? {} : { vectorRepository }),
      maxCandidates
    });
    const composition = await runner.run({ candidates });
    let retryRecorded = 0;
    for (const candidate of composition.candidates) {
      await state.recordRetry(candidate.identityKey, {
        stage: candidate.status,
        errorCode: candidate.diagnostics[0] ?? null,
        attemptedAt
      });
      retryRecorded += 1;
    }
    process.stdout.write(`${JSON.stringify({
      status: composition.status,
      registry: registrySummary,
      scan: scanSummary,
      semanticDiscovery: semanticSummary,
      composition: {
        candidateCount: composition.candidateCount,
        completedCount: composition.completedCount,
        failedCount: composition.failedCount,
        retryRecorded,
        stageCounts: composition.stageCounts,
        reasons: composition.reasons
      }
    })}\n`);
  } finally {
    await repository.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ errorCode: safeErrorCode(error, "MARKETPLACE_INGESTION_FAILED") })}\n`);
  process.exitCode = 1;
});
