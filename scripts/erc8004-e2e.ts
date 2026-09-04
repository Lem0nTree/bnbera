import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { loadRuntimeConfig, type RuntimeConfig } from "../packages/config/src/runtime.ts";
import {
  canonicalSha256Hex,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  type Erc8004Identity
} from "../packages/domain/src/index.ts";
import {
  AgentIngestionService,
  BoundedMetadataResolver,
  BoundedServiceProbe,
  DeterministicCategoryClassifier,
  Erc8004Pipeline,
  EightHundredFourScanHttpClient,
  HttpServiceProbeTransport,
  InMemoryIngestionRepository,
  InMemorySemanticVectorRepository,
  JsonRpcClient,
  JsonRpcRegistryChainReader,
  PostgresIngestionRepository,
  PgVectorSemanticRepository,
  buildSemanticDocument,
  createOfficialErc8004RegistryReadDefinitions,
  createEightHundredFourScanAdapter,
  createOpenRouterEmbeddingProviderFromEnvironment,
  ensureSemanticVector,
  mapOfficialEightHundredFourScanCandidate,
  normalizeServices,
  officialEightHundredFourScanContract,
  officialErc8004IdentityAbiSha256,
  pgVectorStorageDimension,
  verifyEightHundredFourScanOpenApi,
  type EightHundredFourScanPage,
  type IdentityCandidate,
  type IngestionRepository,
  type RegistrationMetadata,
  type ServiceObservation,
  type EmbeddingProvider
} from "../packages/agent-ingestion/src/index.ts";
import { probeRpc } from "../packages/agent-ingestion/src/rpc.ts";
import {
  InMemoryMarketplaceSource,
  MarketplaceReadService,
  developmentFixtureListings
} from "../packages/marketplace/src/index.ts";
import { createDb, migrateDb } from "../packages/db/src/client.ts";

type EvidenceLevel = "deterministic" | "contract" | "live-read-only" | "blocked" | "skipped";
type CheckStatus = "pass" | "fail" | "blocked" | "skipped";
type EvidenceCheck = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly evidenceLevel: EvidenceLevel;
  readonly checkedAt: string;
  readonly details: Readonly<Record<string, unknown>>;
};
type StandardsLock = {
  readonly lockStatus?: unknown;
  readonly networks?: Readonly<Record<string, {
    readonly erc8004?: {
      readonly identityRegistry?: unknown;
      readonly reputationRegistry?: unknown;
      readonly abiHashes?: { readonly identityRegistry?: unknown; readonly reputationRegistry?: unknown };
    };
  }>>;
};
type MappedPage = {
  readonly candidates: readonly IdentityCandidate[];
  readonly nextCursor: string | null;
  readonly nextOffset: number | null;
  readonly total: number | null;
};
type ScanContext = {
  readonly client: EightHundredFourScanHttpClient;
  readonly rawPage: EightHundredFourScanPage;
  readonly mappedPage: MappedPage;
  readonly candidates: readonly IdentityCandidate[];
  readonly selected: IdentityCandidate | null;
  readonly selectedDetail: unknown | null;
};
type MetadataContext = {
  readonly identity: Erc8004Identity;
  readonly registration: RegistrationMetadata;
  readonly acceptedServices: readonly ServiceObservation[];
  readonly semanticDocument: ReturnType<typeof buildSemanticDocument>;
  readonly classification: {
    readonly category: string;
    readonly classifierVersion: string;
  };
};

type RpcContext = {
  readonly reader: JsonRpcRegistryChainReader | null;
  readonly selectedRead: Awaited<ReturnType<JsonRpcRegistryChainReader["readIdentity"]>> | null;
  readonly selectedBlock: { readonly blockNumber: number; readonly blockHash: string } | null;
  readonly dualProviderEvidence: boolean;
};

class SanitizedFailure extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "SanitizedFailure";
  }
}

/**
 * E2E ingestion checks run in a transaction and roll it back deliberately so
 * live discovery evidence cannot pollute the developer marketplace database.
 */
class RollbackE2ETransaction extends Error {
  public constructor() {
    super("E2E transaction rolled back after assertions.");
    this.name = "RollbackE2ETransaction";
  }
}

const execFileAsync = promisify(execFile);
const checks: EvidenceCheck[] = [];
const startedAt = new Date().toISOString();

function nowIso(): string {
  return new Date().toISOString();
}

function nonEmpty(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function safeErrorCode(error: unknown): string {
  if (error instanceof SanitizedFailure) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "28P01") return "DATABASE_AUTH_FAILED";
    if (code === "ECONNREFUSED") return "DATABASE_CONNECTION_REFUSED";
    if (code === "ENOTFOUND") return "DATABASE_HOST_UNRESOLVED";
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return "UNCLASSIFIED_FAILURE";
}

function blockedErrorCode(code: string): boolean {
  return code === "NETWORK_UNAVAILABLE" ||
    code === "DATABASE_CONNECTION_REFUSED" ||
    code === "DATABASE_HOST_UNRESOLVED" ||
    code === "SCAN_UNAVAILABLE" ||
    code === "SCAN_TIMEOUT" ||
    code === "SCAN_RATE_LIMITED" ||
    code === "SCAN_CIRCUIT_OPEN" ||
    code === "EMBEDDING_PROVIDER_FAILED" ||
    code === "EMBEDDING_TIMEOUT" ||
    code === "EMBEDDING_RATE_LIMITED" ||
    code === "CHAIN_PROVIDER_UNAVAILABLE" ||
    code === "SERVICE_PROBE_FAILED" ||
    code === "SERVICE_PROBE_TIMEOUT" ||
    code === "HTTP_408" ||
    code === "HTTP_429" ||
    code === "HTTP_500" ||
    code === "HTTP_502" ||
    code === "HTTP_503" ||
    code === "HTTP_504";
}

function statusForError(error: unknown, fallback: CheckStatus = "fail"): CheckStatus {
  return blockedErrorCode(safeErrorCode(error)) ? "blocked" : fallback;
}

function emptyRpcContext(): RpcContext {
  return { reader: null, selectedRead: null, selectedBlock: null, dualProviderEvidence: false };
}

function validAgentId(value: string): boolean {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return false;
  try {
    return BigInt(value) <= (1n << 256n) - 1n;
  } catch {
    return false;
  }
}

function endpointLabel(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol + "//" + url.host;
  } catch {
    return "invalid-endpoint";
  }
}

function hashBytes(bytes: ArrayBuffer): string {
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function hashIdentity(identity: Erc8004Identity): string {
  return canonicalSha256Hex(erc8004IdentityKey(identity));
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recordCheck(name: string, status: CheckStatus, evidenceLevel: EvidenceLevel, details: Readonly<Record<string, unknown>> = {}): void {
  checks.push({ name, status, evidenceLevel, checkedAt: nowIso(), details });
}

type ConfiguredE2EDatabase = {
  readonly connectionString: string;
  readonly ssl: boolean;
};

function configuredE2EDatabase(runtimeConfig: RuntimeConfig | null): ConfiguredE2EDatabase | null {
  const connectionString = runtimeConfig?.databaseUrl ?? nonEmpty("DATABASE_URL");
  if (connectionString === undefined || connectionString.trim() === "") return null;
  return {
    connectionString,
    ssl: runtimeConfig?.databaseSsl ?? process.env.DATABASE_SSL === "true"
  };
}

function createE2EIngestionRepository(
  runtimeConfig: RuntimeConfig | null,
  now: () => Date
): { readonly repository: IngestionRepository; readonly databaseBacked: boolean } {
  const database = configuredE2EDatabase(runtimeConfig);
  if (database === null) return { repository: new InMemoryIngestionRepository(), databaseBacked: false };
  return {
    repository: new PostgresIngestionRepository(database.connectionString, { now, ssl: database.ssl }),
    databaseBacked: true
  };
}

async function closeE2EIngestionRepository(repository: IngestionRepository): Promise<void> {
  if (repository instanceof PostgresIngestionRepository) await repository.close();
}

async function runInRollback<T>(
  repository: IngestionRepository,
  operation: (unitOfWork: IngestionRepository) => Promise<T>
): Promise<T> {
  let result: T | undefined;
  try {
    await repository.withTransaction(async (unitOfWork) => {
      result = await operation(unitOfWork);
      throw new RollbackE2ETransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackE2ETransaction)) throw error;
  }
  if (result === undefined) throw new SanitizedFailure("E2E_TRANSACTION_RESULT_MISSING");
  return result;
}

async function executeCheck(name: string, evidenceLevel: EvidenceLevel, operation: () => Promise<Readonly<Record<string, unknown>>>): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    const details = await operation();
    recordCheck(name, "pass", evidenceLevel, details);
    return details;
  } catch (error) {
    recordCheck(name, statusForError(error), evidenceLevel, { errorCode: safeErrorCode(error) });
    return null;
  }
}

function hashSecretSafeEvidence(serialized: string): void {
  const configured = [
    nonEmpty("EIGHTSCAN_API_KEY"),
    nonEmpty("ERC8004_EMBEDDING_API_KEY"),
    nonEmpty("OPENROUTER_API_KEY")
  ].filter((value): value is string => value !== undefined && value.length > 0);
  if (configured.some((secret) => serialized.includes(secret))) {
    throw new SanitizedFailure("EVIDENCE_SECRET_DETECTED");
  }
}

function numberFromEnv(name: string, fallback: number, maximum: number): number {
  const value = nonEmpty(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new SanitizedFailure(name + "_INVALID");
  return parsed;
}

function selectedChainId(): number {
  const value = nonEmpty("ERC8004_E2E_CHAIN_ID") ?? nonEmpty("BSC_CHAIN_ID") ?? "97";
  const parsed = Number(value);
  if (parsed !== 56 && parsed !== 97) throw new SanitizedFailure("BSC_CHAIN_ID_INVALID");
  return parsed;
}

async function readStandardsLock(): Promise<StandardsLock> {
  try {
    const content = await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8");
    const value = JSON.parse(content) as unknown;
    const record = plainRecord(value);
    if (record === null) throw new SanitizedFailure("STANDARDS_LOCK_INVALID");
    return record as StandardsLock;
  } catch (error) {
    if (error instanceof SanitizedFailure) throw error;
    throw new SanitizedFailure("STANDARDS_LOCK_UNAVAILABLE");
  }
}

function lockRegistry(lock: StandardsLock, chainId: number): string | null {
  const value = lock.networks?.[String(chainId)]?.erc8004?.identityRegistry;
  if (typeof value !== "string") return null;
  try {
    return normalizeEvmAddress(value);
  } catch {
    return null;
  }
}

async function fetchBounded(
  endpoint: string,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly timeoutMs: number; readonly maxBytes: number }
): Promise<{ readonly response: Response; readonly bytes: ArrayBuffer }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: options.headers,
        redirect: "error",
        signal: controller.signal
      });
    } catch {
      throw new SanitizedFailure("NETWORK_UNAVAILABLE");
    }
    if (!response.ok) throw new SanitizedFailure("HTTP_" + response.status);
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && /^[0-9]+$/u.test(contentLength) && Number(contentLength) > options.maxBytes) throw new SanitizedFailure("RESPONSE_TOO_LARGE");
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      throw new SanitizedFailure("RESPONSE_READ_FAILED");
    }
    if (bytes.byteLength > options.maxBytes) throw new SanitizedFailure("RESPONSE_TOO_LARGE");
    return { response, bytes };
  } finally {
    clearTimeout(timer);
  }
}

function checkIdentityTuple(identity: Erc8004Identity): boolean {
  try {
    const normalized = normalizeErc8004Identity(identity);
    return normalized.namespace.length > 0 &&
      normalized.chainId > 0 &&
      /^0x[0-9a-f]{40}$/u.test(normalized.identityRegistry) &&
      /^(0|[1-9][0-9]*)$/u.test(normalized.agentId);
  } catch {
    return false;
  }
}

async function checkOpenApi(client: EightHundredFourScanHttpClient, timeoutMs: number): Promise<Readonly<Record<string, unknown>>> {
  const apiKey = nonEmpty("EIGHTSCAN_API_KEY");
  if (apiKey === undefined) throw new SanitizedFailure("EIGHTSCAN_API_KEY_MISSING");
  const raw = await fetchBounded("https://api.8004scan.io/openapi.json", {
    timeoutMs,
    maxBytes: 8 * 1024 * 1024,
    headers: { accept: "application/json", "X-API-Key": apiKey }
  });
  const contentType = raw.response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "" && contentType !== "application/json") throw new SanitizedFailure("OPENAPI_CONTENT_TYPE_INVALID");
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(raw.bytes));
  } catch {
    throw new SanitizedFailure("OPENAPI_JSON_INVALID");
  }
  const verification = verifyEightHundredFourScanOpenApi(document);
  const rawSha256 = hashBytes(raw.bytes);
  const expectedRawSha256 = officialEightHundredFourScanContract.openApiRawSha256;
  if (rawSha256 !== expectedRawSha256) throw new SanitizedFailure("OPENAPI_RAW_DIGEST_DRIFT");
  return {
    httpStatus: raw.response.status,
    contentType: contentType || "unspecified",
    byteLength: raw.bytes.byteLength,
    canonicalSha256: verification.sha256,
    canonicalDigestMatches: verification.matches,
    rawSha256,
    rawDigestMatches: rawSha256 === expectedRawSha256,
    version: verification.version,
    apiKeyPresent: true,
    clientCircuit: client.circuitState().open ? "open" : "closed"
  };
}

async function runScan(
  chainId: number,
  registry: string | null,
  maxCandidates: number,
  timeoutMs: number,
  runtimeConfig: RuntimeConfig | null
): Promise<ScanContext | null> {
  if (runtimeConfig === null) {
    recordCheck("8004scan_authenticated_api", "blocked", "contract", { reason: "RUNTIME_CONFIGURATION_UNAVAILABLE" });
    return null;
  }
  if (!runtimeConfig.erc8004IngestionEnabled || !runtimeConfig.erc8004ScanDiscoveryEnabled) {
    recordCheck("8004scan_authenticated_api", "skipped", "skipped", {
      reason: "ERC8004_DISCOVERY_FEATURE_GATE_DISABLED",
      ingestionEnabled: runtimeConfig.erc8004IngestionEnabled,
      scanDiscoveryEnabled: runtimeConfig.erc8004ScanDiscoveryEnabled
    });
    return null;
  }
  if (nonEmpty("EIGHTSCAN_API_KEY") === undefined) {
    recordCheck("8004scan_authenticated_api", "blocked", "contract", { reason: "EIGHTSCAN_API_KEY_MISSING" });
    return null;
  }
  if (registry === null) {
    recordCheck("8004scan_authenticated_discovery", "blocked", "blocked", {
      reason: "REGISTRY_NOT_RESOLVED_FROM_STANDARDS_LOCK",
      chainId
    });
    return null;
  }
  const client = EightHundredFourScanHttpClient.fromEnvironment(process.env, {
    timeoutMs,
    maxRetries: 0,
    minRequestIntervalMs: 0,
    cacheTtlMs: 0
  });
  const openApi = await executeCheck("8004scan_openapi_digest_and_drift", "contract", () => checkOpenApi(client, timeoutMs));
  if (openApi === null) {
    // Do not call a provider whose contract pin failed. The provider response
    // may still look parseable, but it is not evidence for this release pin.
    recordCheck("8004scan_authenticated_discovery", "blocked", "contract", { reason: "OPENAPI_CONTRACT_CHECK_FAILED" });
    return null;
  }
  let rawPage: EightHundredFourScanPage;
  try {
    rawPage = await client.listCandidates({ chainId, isTestnet: chainId === 97, limit: maxCandidates, offset: 0 });
    if (rawPage.items.length > maxCandidates) throw new SanitizedFailure("CANDIDATE_BOUND_EXCEEDED");
    recordCheck("8004scan_authenticated_discovery", "pass", "live-read-only", {
      chainId,
      isTestnet: chainId === 97,
      requestedLimit: maxCandidates,
      returnedCount: rawPage.items.length,
      total: rawPage.total ?? null,
      nextOffset: rawPage.nextOffset ?? null,
      nextCursor: rawPage.nextCursor === null ? null : "present"
    });
  } catch (error) {
    recordCheck("8004scan_authenticated_discovery", statusForError(error), "live-read-only", { errorCode: safeErrorCode(error), chainId, requestedLimit: maxCandidates });
    return null;
  }
  const adapter = createEightHundredFourScanAdapter({ listCandidates: async () => rawPage });
  let mappedPage: MappedPage;
  try {
    mappedPage = await adapter.fetchPage({ chainId, isTestnet: chainId === 97, limit: maxCandidates, offset: 0 });
  } catch (error) {
    recordCheck("identity_tuple_normalization_and_page_bound", statusForError(error), "live-read-only", { chainId, errorCode: safeErrorCode(error) });
    return null;
  }
  const selectedId = nonEmpty("ERC8004_E2E_AGENT_ID");
  if (selectedId !== undefined && !validAgentId(selectedId)) {
    recordCheck("identity_tuple_normalization_and_page_bound", "fail", "contract", { chainId, errorCode: "ERC8004_E2E_AGENT_ID_INVALID" });
    return null;
  }
  const selected = selectedId === undefined
    ? mappedPage.candidates[0] ?? null
    : mappedPage.candidates.find((candidate) => candidate.identity.agentId === selectedId) ?? null;
  if (selectedId !== undefined && selected === null) {
    recordCheck("8004scan_identity_detail_contract", "fail", "live-read-only", { chainId, errorCode: "ERC8004_E2E_AGENT_NOT_FOUND" });
    return null;
  }
  const uniqueKeys = new Set(mappedPage.candidates.map((candidate) => erc8004IdentityKey(candidate.identity)));
  const tupleValid = mappedPage.candidates.every((candidate) => checkIdentityTuple(candidate.identity));
  const registryMatches = registry !== null && mappedPage.candidates.every((candidate) => candidate.identity.chainId === chainId && candidate.identity.identityRegistry === registry);
  const tupleWithinConfiguredNetwork = mappedPage.candidates.every((candidate) => candidate.identity.chainId === chainId && (registry === null || candidate.identity.identityRegistry === registry));
  const tupleCheckPassed = mappedPage.candidates.length <= maxCandidates && tupleValid && registryMatches && tupleWithinConfiguredNetwork;
  recordCheck("identity_tuple_normalization_and_page_bound", tupleCheckPassed ? "pass" : "fail", "live-read-only", {
    chainId,
    registry: registry ?? "unconfigured",
    candidates: mappedPage.candidates.length,
    uniqueIdentityTuples: uniqueKeys.size,
    normalizedTuplesValid: tupleValid,
    registryMatches,
    tupleWithinConfiguredNetwork,
    identityDigests: [...uniqueKeys].slice(0, maxCandidates).map((key) => canonicalSha256Hex(key))
  });
  if (!tupleCheckPassed) return null;
  await executeCheck("8004scan_semantic_endpoint_contract", "contract", async () => {
    const semantic = await client.searchSemantic({ query: "read-only BSC agent", chainId, limit: 1, offset: 0 });
    return { chainId, returnedCount: semantic.items.length, bounded: semantic.items.length <= 1, total: semantic.total ?? null };
  });
  await executeCheck("8004scan_chain_catalog_contract", "contract", async () => {
    const chains = await client.listChains();
    return { objectResponse: plainRecord(chains) !== null, chainCount: Object.keys(chains).length };
  });
  let selectedDetail: unknown | null = null;
  if (selected === null) {
    recordCheck("8004scan_identity_detail_contract", "blocked", "live-read-only", { reason: "NO_CANDIDATE_RETURNED" });
  } else {
    try {
      selectedDetail = await client.getCandidateByIdentity(selected.identity);
      const mapped = mapOfficialEightHundredFourScanCandidate(selectedDetail);
      if (!checkIdentityTuple(mapped.identity as Erc8004Identity)) throw new SanitizedFailure("DETAIL_IDENTITY_INVALID");
      recordCheck("8004scan_identity_detail_contract", "pass", "live-read-only", {
        chainId,
        identityDigest: hashIdentity(selected.identity),
        detailMapped: true,
        metadataFields: Object.keys(mapped.metadata ?? {}).length,
        advertisedServiceCount: mapped.services?.length ?? 0,
        capabilityManifestPresent: mapped.capabilityManifest !== undefined
      });
    } catch (error) {
      recordCheck("8004scan_identity_detail_contract", statusForError(error), "live-read-only", { errorCode: safeErrorCode(error), identityDigest: hashIdentity(selected.identity) });
    }
  }
  return { client, rawPage, mappedPage, candidates: mappedPage.candidates, selected, selectedDetail };
}

async function runRpcChecks(
  chainId: number,
  registry: string | null,
  selected: IdentityCandidate | null,
  timeoutMs: number,
  lock: StandardsLock
): Promise<RpcContext> {
  if (registry === null) {
    recordCheck("bsc_rpc_chain_bytecode_and_exact_block", "blocked", "blocked", { reason: "REGISTRY_NOT_RESOLVED_FROM_STANDARDS_LOCK", chainId });
    return emptyRpcContext();
  }
  const endpointNames = chainId === 56
    ? ["BSC_MAINNET_RPC_URL", "BSC_MAINNET_RPC_URL_SECONDARY", "BSC_MAINNET_RPC_URL_2"]
    : ["BSC_TESTNET_RPC_URL", "BSC_TESTNET_RPC_URL_SECONDARY", "BSC_TESTNET_RPC_URL_2"];
  // A second provider is required for live identity evidence. The public BNB
  // seed is only a bounded read-only fallback when no secondary is configured;
  // it is still reported explicitly as a provider so disagreement is visible.
  const defaultSecondary = chainId === 56
    ? "https://bsc-dataseed1.bnbchain.org"
    : "https://data-seed-prebsc-2-s1.bnbchain.org:8545";
  const configuredEndpoints = [...new Set(
    endpointNames.map(nonEmpty).filter((value): value is string => value !== undefined)
  )];
  if (configuredEndpoints.length === 0) {
    recordCheck("bsc_rpc_chain_bytecode_and_exact_block", "blocked", "live-read-only", { reason: "RPC_ENDPOINT_MISSING", chainId });
    return emptyRpcContext();
  }
  const endpoints = [...new Set([configuredEndpoints[0]!, configuredEndpoints[1] ?? defaultSecondary])];
  const secondaryConfigured = configuredEndpoints.length >= 2;
  const reputationValue = lock.networks?.[String(chainId)]?.erc8004?.reputationRegistry;
  if (typeof reputationValue !== "string") {
    recordCheck("bsc_rpc_chain_bytecode_and_exact_block", "blocked", "blocked", { reason: "REPUTATION_REGISTRY_UNRESOLVED", chainId });
    return emptyRpcContext();
  }
  let reputationRegistry: string;
  try {
    reputationRegistry = normalizeEvmAddress(reputationValue);
  } catch {
    recordCheck("bsc_rpc_chain_bytecode_and_exact_block", "fail", "contract", { reason: "REPUTATION_REGISTRY_INVALID", chainId });
    return emptyRpcContext();
  }
  const contracts = [
    { name: "identity", address: registry },
    { name: "reputation", address: reputationRegistry }
  ];
  const reports: Awaited<ReturnType<typeof probeRpc>>[] = [];
  for (const endpoint of endpoints.slice(0, 2)) {
    try {
      reports.push(await probeRpc(endpoint, chainId, contracts, { timeoutMs }));
    } catch (error) {
      recordCheck("bsc_rpc_provider_" + endpointLabel(endpoint), statusForError(error, "fail"), "live-read-only", { chainId, endpoint: endpointLabel(endpoint), errorCode: safeErrorCode(error) });
    }
  }
  if (reports.length === 0) {
    recordCheck("bsc_rpc_chain_bytecode_and_exact_block", "blocked", "live-read-only", {
      chainId,
      registry,
      endpoints: endpoints.map(endpointLabel),
      secondaryConfigured,
      reason: "NO_RPC_PROVIDER_REACHABLE"
    });
    return emptyRpcContext();
  }
  const first = reports[0];
  const bytecodePresent = reports.every((report) => report.contracts.every((contract) => contract.bytecodePresent));
  const implementationShape = reports.every((report) => report.contracts.every((contract) => contract.implementation === null || /^0x[0-9a-f]{40}$/u.test(contract.implementation)));
  const providerComparison = reports.length < 2
    ? "single-provider"
    : reports.every((report) => report.observedChainId === chainId && report.contracts.length === first.contracts.length && report.contracts.every((contract, index) => contract.bytecodePresent === first.contracts[index]?.bytecodePresent && contract.bytecodeLength === first.contracts[index]?.bytecodeLength && contract.implementation === first.contracts[index]?.implementation))
      ? "agree"
      : "diverged";
  const bytecodeCheckStatus: CheckStatus = bytecodePresent && implementationShape && providerComparison === "agree"
    ? "pass"
    : providerComparison === "single-provider"
      ? "blocked"
      : "fail";
  recordCheck("bsc_rpc_chain_bytecode_and_exact_block", bytecodeCheckStatus, "live-read-only", {
    chainId,
    registry,
    endpoints: reports.map((report) => endpointLabel(report.endpoint)),
    secondaryConfigured,
    secondarySource: secondaryConfigured ? "configured" : "bounded_public_fallback",
    observedChainIds: reports.map((report) => report.observedChainId),
    latestBlocks: reports.map((report) => report.latestBlock),
    latestBlockHashes: reports.map((report) => report.latestBlockHash),
    contracts: first.contracts.map((contract) => ({
      name: contract.name,
      address: contract.address,
      bytecodePresent: contract.bytecodePresent,
      bytecodeLength: contract.bytecodeLength,
      implementation: contract.implementation
    })),
    providerComparison
  });
  const abiHashes = lock.networks?.[String(chainId)]?.erc8004?.abiHashes;
  const abiHashesResolved = typeof abiHashes?.identityRegistry === "string" && typeof abiHashes?.reputationRegistry === "string";
  if (!abiHashesResolved) {
    recordCheck("erc8004_official_identity_abi_codec_lock", "blocked", "blocked", {
      chainId,
      registry,
      reason: "ABI_HASHES_UNRESOLVED_NO_SELECTORS_OR_DECODERS_MAY_BE_GUESSED"
    });
    recordCheck("bsc_exact_block_identity_reads", "blocked", "blocked", {
      chainId,
      registry,
      reason: "ABI_HASHES_UNRESOLVED_NO_SELECTORS_OR_DECODERS_MAY_BE_GUESSED",
      observedBlock: first.latestBlock,
      observedBlockHash: first.latestBlockHash
    });
    return emptyRpcContext();
  }

  let definitions: ReturnType<typeof createOfficialErc8004RegistryReadDefinitions>;
  try {
    definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: abiHashes.identityRegistry });
    recordCheck("erc8004_official_identity_abi_codec_lock", definitions.abiSha256 === officialErc8004IdentityAbiSha256 ? "pass" : "fail", "contract", {
      chainId,
      registry,
      artifactSha256: definitions.abiSha256,
      lockSha256: abiHashes.identityRegistry,
      functions: ["ownerOf(uint256)", "getAgentWallet(uint256)", "tokenURI(uint256)"]
    });
  } catch (error) {
    recordCheck("erc8004_official_identity_abi_codec_lock", "fail", "contract", { chainId, registry, errorCode: safeErrorCode(error) });
    recordCheck("bsc_exact_block_identity_reads", "blocked", "blocked", {
      chainId,
      registry,
      reason: "OFFICIAL_ABI_CODEC_LOCK_FAILED",
      observedBlock: first.latestBlock,
      observedBlockHash: first.latestBlockHash
    });
    return emptyRpcContext();
  }

  // The pipeline reader is only exposed to the orchestration check after the
  // two-provider contract probe agrees. A one-provider read can still be
  // useful diagnostically, but it must not be reported as dual-provider
  // pipeline evidence.
  const pipelineReader = providerComparison === "agree" && reports.length >= 2
    ? new JsonRpcRegistryChainReader({
        chainId,
        identityRegistry: registry,
        client: new JsonRpcClient(first.endpoint, { timeoutMs }),
        ...definitions,
        readConsistency: "provisional"
      })
    : null;

  let targetIdentity: Erc8004Identity | null = selected?.identity ?? null;
  const configuredAgentId = nonEmpty("ERC8004_E2E_AGENT_ID");
  if (targetIdentity === null && configuredAgentId !== undefined) {
    targetIdentity = { namespace: "eip155", chainId, identityRegistry: registry, agentId: configuredAgentId };
  }
  if (targetIdentity === null) {
    recordCheck("bsc_exact_block_identity_reads", "skipped", "skipped", {
      chainId,
      registry,
      reason: "NO_SELECTED_IDENTITY_OR_ERC8004_E2E_AGENT_ID",
      observedBlock: first.latestBlock,
      observedBlockHash: first.latestBlockHash
    });
    return { reader: pipelineReader, selectedRead: null, selectedBlock: null, dualProviderEvidence: false };
  }
  try {
    targetIdentity = normalizeErc8004Identity(targetIdentity);
    if (targetIdentity.chainId !== chainId || targetIdentity.identityRegistry !== registry) throw new SanitizedFailure("IDENTITY_DOES_NOT_MATCH_LOCKED_REGISTRY");
  } catch (error) {
    recordCheck("bsc_exact_block_identity_reads", "fail", "live-read-only", {
      chainId,
      registry,
      identityDigest: validAgentId(targetIdentity.agentId) ? canonicalSha256Hex({ namespace: targetIdentity.namespace, chainId: targetIdentity.chainId, identityRegistry: targetIdentity.identityRegistry, agentId: targetIdentity.agentId }) : null,
      errorCode: safeErrorCode(error)
    });
    return { reader: pipelineReader, selectedRead: null, selectedBlock: null, dualProviderEvidence: false };
  }
  if (first.latestBlockHash === null) {
    recordCheck("bsc_exact_block_identity_reads", "blocked", "live-read-only", {
      chainId,
      registry,
      identityDigest: hashIdentity(targetIdentity),
      reason: "PRIMARY_BLOCK_HASH_UNAVAILABLE"
    });
    return { reader: pipelineReader, selectedRead: null, selectedBlock: null, dualProviderEvidence: false };
  }
  const blockTag = { blockNumber: first.latestBlock, blockHash: first.latestBlockHash } as const;
  const reads: Array<{ readonly endpoint: string; readonly state: Awaited<ReturnType<JsonRpcRegistryChainReader["readIdentity"]>> }> = [];
  const readErrors: Array<{ readonly endpoint: string; readonly errorCode: string }> = [];
  for (const report of reports) {
    try {
      const reader = new JsonRpcRegistryChainReader({
        chainId,
        identityRegistry: registry,
        client: new JsonRpcClient(report.endpoint, { timeoutMs }),
        ...definitions,
        readConsistency: "provisional"
      });
      reads.push({ endpoint: endpointLabel(report.endpoint), state: await reader.readIdentity(targetIdentity, blockTag) });
    } catch (error) {
      readErrors.push({ endpoint: endpointLabel(report.endpoint), errorCode: safeErrorCode(error) });
    }
  }
  const firstRead = reads[0]?.state;
  const sameState = firstRead !== undefined && reads.every(({ state }) => state.ownerAddress === firstRead.ownerAddress && state.agentWallet === firstRead.agentWallet && state.agentUri === firstRead.agentUri && state.contentDigest === firstRead.contentDigest && state.observedBlock === blockTag.blockNumber && state.observedBlockHash === blockTag.blockHash);
  const providerCount = reports.length;
  const twoProviderEvidence = providerComparison === "agree" && providerCount >= 2 && reads.length === providerCount && sameState;
  recordCheck("bsc_exact_block_identity_reads", twoProviderEvidence ? "pass" : reads.length > 0 ? "blocked" : "fail", "live-read-only", {
    chainId,
    registry,
    identityDigest: hashIdentity(targetIdentity),
    agentId: targetIdentity.agentId,
    observedBlock: blockTag.blockNumber,
    observedBlockHash: blockTag.blockHash,
    readConsistency: firstRead?.readConsistency ?? null,
    providersAttempted: providerCount,
    providersRead: reads.length,
    providerAgreement: sameState,
    twoProviderEvidence,
    reads: reads.map(({ endpoint, state }) => ({
      endpoint,
      owner: state.ownerAddress,
      agentWallet: state.agentWallet,
      agentUriScheme: state.agentUri === null ? null : new URL(state.agentUri).protocol,
      agentUriSha256: state.agentUri === null ? null : createHash("sha256").update(state.agentUri).digest("hex"),
      ownerObservedBlock: state.ownerObservedBlock,
      agentWalletObservedBlock: state.agentWalletObservedBlock,
      agentUriObservedBlock: state.agentUriObservedBlock
    })),
    readErrors,
    expectedFunctions: ["ownerOf(uint256)", "getAgentWallet(uint256)", "tokenURI(uint256)"],
    zeroAgentWalletIsNull: reads.every(({ state }) => state.agentWallet === null || /^0x[0-9a-f]{40}$/u.test(state.agentWallet))
  });
  return {
    reader: pipelineReader,
    selectedRead: twoProviderEvidence ? firstRead ?? null : null,
    selectedBlock: blockTag,
    dualProviderEvidence: twoProviderEvidence
  };
}

async function runDedupCheck(candidates: readonly IdentityCandidate[], runtimeConfig: RuntimeConfig | null): Promise<void> {
  if (candidates.length === 0) {
    recordCheck("repository_identity_idempotency_and_dedup", "skipped", "skipped", { reason: "NO_DISCOVERED_CANDIDATES" });
    return;
  }
  const now = () => new Date("2026-09-02T00:00:00.000Z");
  const { repository, databaseBacked } = createE2EIngestionRepository(runtimeConfig, now);
  try {
    const result = await runInRollback(repository, async (unitOfWork) => {
      const ingestion = new AgentIngestionService(unitOfWork);
      for (const candidate of candidates) {
        await ingestion.ingestCandidate(candidate);
        await ingestion.ingestCandidate(candidate);
      }
      const expected = new Set(candidates.map((candidate) => erc8004IdentityKey(candidate.identity)));
      const actual = new Set<string>();
      for (const candidate of candidates) {
        if (await unitOfWork.findIdentity(candidate.identity) !== null) {
          actual.add(erc8004IdentityKey(candidate.identity));
        }
      }
      return { expected, actual };
    });
    recordCheck(
      "repository_identity_idempotency_and_dedup",
      result.actual.size === result.expected.size && [...result.expected].every((key) => result.actual.has(key)) ? "pass" : "fail",
      databaseBacked ? "live-read-only" : "deterministic",
      {
        inputCandidates: candidates.length,
        uniqueInputTuples: result.expected.size,
        persistedUniqueIdentities: result.actual.size,
        duplicateReplayCount: candidates.length,
        repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture",
        transactionRolledBack: true
      }
    );
  } catch (error) {
    recordCheck("repository_identity_idempotency_and_dedup", statusForError(error), databaseBacked ? "live-read-only" : "deterministic", { errorCode: safeErrorCode(error), repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture" });
  } finally {
    await closeE2EIngestionRepository(repository);
  }
}

function serviceDescriptor(value: unknown): Readonly<Record<string, unknown>> | null {
  const object = plainRecord(value);
  if (object === null) return null;
  const urlValue = ["url", "endpoint", "server", "mcp_server", "a2a_endpoint"]
    .map((key) => object[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  if (urlValue === undefined || urlValue.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return null;
  const rawKind = ["kind", "type", "protocol"]
    .map((key) => object[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "")
    ?.toLowerCase() ?? "adapter";
  const kind = rawKind.includes("mcp") ? "mcp"
    : rawKind.includes("a2a") ? "a2a"
      : rawKind.includes("x402") ? "x402"
        : rawKind.includes("mpp") ? "mpp"
          : rawKind.includes("readiness") ? "readiness"
            : "adapter";
  const protocolVersion = ["protocolVersion", "version", "protocol"]
    .map((key) => object[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "") ?? "unknown";
  return { kind, url: parsed.toString(), protocolVersion: protocolVersion.slice(0, 128) };
}

async function runMetadata(context: ScanContext | null, rpc: RpcContext, timeoutMs: number, runtimeConfig: RuntimeConfig | null): Promise<MetadataContext | null> {
  if (context?.selected === null || context?.selected === undefined || context.selectedDetail === null) {
    recordCheck("bounded_metadata_resolution_and_service_enrichment", "skipped", "skipped", { reason: "SELECTED_DETAIL_UNAVAILABLE" });
    return null;
  }
  const selected = context.selected;
  if (!rpc.dualProviderEvidence || rpc.selectedRead === null) {
    recordCheck("bounded_metadata_resolution_and_service_enrichment", "blocked", "live-read-only", { reason: "EXACT_BLOCK_DUAL_PROVIDER_READ_UNAVAILABLE" });
    return null;
  }
  const uri = rpc.selectedRead.agentUri;
  if (uri === null) {
    recordCheck("bounded_metadata_resolution_and_service_enrichment", "blocked", "live-read-only", { reason: "EXACT_BLOCK_IDENTITY_HAS_NO_METADATA_URI" });
    return null;
  }
  const resolver = new BoundedMetadataResolver({ timeoutMs: Math.min(8_000, timeoutMs), maxBytes: 512 * 1024, maxRedirects: 2 });
  let resolution: Awaited<ReturnType<BoundedMetadataResolver["resolve"]>>;
  let registration: RegistrationMetadata;
  try {
    resolution = await resolver.resolve(uri, rpc.selectedRead.contentDigest);
    if (resolution.digestMatches === false) throw new SanitizedFailure("METADATA_CONTENT_DIGEST_MISMATCH");
    registration = resolver.parseRegistration(resolution);
  } catch (error) {
    recordCheck("bounded_metadata_resolution_and_service_enrichment", statusForError(error), "live-read-only", {
      reason: "METADATA_RESOLUTION_FAILED",
      identityDigest: hashIdentity(selected.identity),
      uriScheme: (() => { try { return new URL(uri).protocol; } catch { return "invalid"; } })(),
      errorCode: safeErrorCode(error)
    });
    return null;
  }
  const descriptors = registration.services.map(serviceDescriptor).filter((service): service is Readonly<Record<string, unknown>> => service !== null).slice(0, 8);
  const unmappedServices = Math.max(0, registration.services.length - descriptors.length);
  const normalized = normalizeServices(erc8004IdentityKey(selected.identity), "8004scan", descriptors, null, new Date());
  const { repository, databaseBacked } = createE2EIngestionRepository(runtimeConfig, () => new Date());
  const probe = new BoundedServiceProbe(new HttpServiceProbeTransport({ maxRedirects: 0 }), { timeoutMs: Math.min(5_000, timeoutMs), maxResponseBytes: 64 * 1024 });
  const probes: Array<Readonly<Record<string, unknown>>> = [];
  let persistedServices = 0;
  let persistedProbes = 0;
  try {
    const persisted = await runInRollback(repository, async (unitOfWork) => {
      // Establish only the identity projection. Discovery enrichment must not
      // imply verification, publication, claim, runtime, or authority state.
      await unitOfWork.upsertIdentity({ identity: selected.identity, originType: "discovered" });
      for (const service of normalized.accepted) await unitOfWork.upsertService(service);
      const results = await probe.probeMany(normalized.accepted.slice(0, 3), {
        maxConcurrency: 2,
        minIntervalMs: 250,
        maxServices: 3
      });
      for (const result of results) {
        const ageSeconds = Math.max(0, (Date.now() - result.observedAt.getTime()) / 1_000);
        probes.push({
          kind: result.kind,
          endpoint: endpointLabel(result.url),
          validationStatus: result.validationStatus,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
          errorCode: result.errorCode,
          observedAt: result.observedAt.toISOString(),
          freshnessSeconds: ageSeconds
        });
        await unitOfWork.appendProbeResult(result);
      }
      return {
        services: (await unitOfWork.listServices(erc8004IdentityKey(selected.identity))).length,
        probes: (await unitOfWork.listProbeResults(erc8004IdentityKey(selected.identity))).length
      };
    });
    persistedServices = persisted.services;
    persistedProbes = persisted.probes;
  } catch (error) {
    await closeE2EIngestionRepository(repository);
    recordCheck("bounded_metadata_resolution_and_service_enrichment", "blocked", "live-read-only", { reason: "POSTGRES_INGESTION_PERSISTENCE_FAILED", errorCode: safeErrorCode(error), repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture" });
    return null;
  }
  await closeE2EIngestionRepository(repository);
  const metadataEnrichmentComplete = unmappedServices === 0 && normalized.rejected.length === 0;
  recordCheck("bounded_metadata_resolution_and_service_enrichment", metadataEnrichmentComplete ? "pass" : "fail", "live-read-only", {
    identityDigest: hashIdentity(selected.identity),
    requestedUriScheme: new URL(uri).protocol,
    contentType: resolution.contentType,
    byteLength: resolution.byteLength,
    contentDigest: resolution.contentDigest,
    parserVersion: registration.parserVersion,
    registrationType: registration.type === null ? "missing" : registration.type === "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" ? "erc8004-registration-v1" : "legacy-or-unknown",
    registrationWarnings: registration.warnings.length,
    serviceDescriptors: registration.services.length,
    unmappedServices,
    acceptedServices: normalized.accepted.length,
    rejectedServices: normalized.rejected.length,
    persistedServices,
    persistedProbes,
    repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture",
    transactionRolledBack: true,
    probeResults: probes
  });
  const healthyProbeCount = probes.filter((probe) => probe.validationStatus === "healthy").length;
  const healthStatus: CheckStatus = normalized.accepted.length === 0 ? "skipped" : healthyProbeCount > 0 ? "pass" : "blocked";
  recordCheck("bounded_service_health_probes", healthStatus, normalized.accepted.length === 0 ? "skipped" : "live-read-only", {
    attempted: probes.length,
    healthy: healthyProbeCount,
    reason: normalized.accepted.length === 0 ? "NO_ADVERTISED_SERVICES" : healthyProbeCount > 0 ? "healthy_public_endpoint_observed" : "no_healthy_public_endpoint_observed"
  });
  const classifier = new DeterministicCategoryClassifier();
  const input = {
    name: registration.name ?? undefined,
    description: registration.description ?? undefined,
    protocols: registration.protocols,
    skills: registration.skills,
    domains: registration.domains,
    metadata: { parserVersion: registration.parserVersion }
  };
  const classification = classifier.classify(input);
  const repeat = classifier.classify(input);
  const evidenceDigest = canonicalSha256Hex(classification.evidence);
  await executeCheck("deterministic_categorization_and_evidence", "deterministic", async () => {
    if (classification.category !== repeat.category || canonicalSha256Hex(repeat.evidence) !== evidenceDigest) throw new SanitizedFailure("CATEGORY_NONDETERMINISTIC");
    return {
      identityDigest: hashIdentity(selected.identity),
      category: classification.category,
      structuredScore: classification.structuredScore,
      semanticScore: classification.semanticScore,
      confidence: classification.confidence,
      method: classification.method,
      classifierVersion: classification.classifierVersion,
      reviewState: classification.reviewState,
      evidenceDigest
    };
  });
  const semanticDocument = buildSemanticDocument({
    identity: selected.identity,
    category: classification.category,
    ...(registration.name === null ? {} : { name: registration.name }),
    ...(registration.description === null ? {} : { description: registration.description }),
    protocols: registration.protocols,
    actions: registration.skills,
    services: normalized.accepted,
    evidenceSummary: { metadata: "resolved", metadataDigest: resolution.contentDigest, registry: "blocked-abi-lock" },
    classifierVersion: classification.classifierVersion
  });
  await executeCheck("semantic_document_allowlist_and_digest", "deterministic", async () => ({
    identityDigest: hashIdentity(selected.identity),
    schemaVersion: semanticDocument.schemaVersion,
    textCharacters: semanticDocument.text.length,
    documentDigest: semanticDocument.digest,
    serviceCount: semanticDocument.document.services.length,
    capabilityCount: semanticDocument.document.capabilities.length
  }));
  return {
    identity: selected.identity,
    registration,
    acceptedServices: normalized.accepted,
    semanticDocument,
    classification: { category: classification.category, classifierVersion: classification.classifierVersion }
  };
}

async function runEmbedding(runtimeConfig: RuntimeConfig | null, metadata: MetadataContext | null, timeoutMs: number): Promise<{ readonly provider: EmbeddingProvider; readonly vector: readonly number[] } | null> {
  if (runtimeConfig === null) {
    recordCheck("openrouter_real_embedding_call", "blocked", "contract", { reason: "RUNTIME_CONFIGURATION_UNAVAILABLE" });
    return null;
  }
  if (!runtimeConfig.marketplaceSemanticRetrievalEnabled) {
    recordCheck("openrouter_real_embedding_call", "skipped", "skipped", { reason: "MARKETPLACE_SEMANTIC_RETRIEVAL_FEATURE_GATE_DISABLED" });
    recordCheck("pgvector_dimension_migration_compatibility", "skipped", "skipped", { reason: "MARKETPLACE_SEMANTIC_RETRIEVAL_FEATURE_GATE_DISABLED" });
    return null;
  }
  const embeddingConfig = runtimeConfig.embedding;
  if (embeddingConfig === null || embeddingConfig === undefined) {
    recordCheck("openrouter_real_embedding_call", "blocked", "live-read-only", { reason: "EMBEDDING_CONFIGURATION_MISSING" });
    return null;
  }
  const secretReference = embeddingConfig.secretReference;
  if (nonEmpty(secretReference) === undefined && nonEmpty("ERC8004_EMBEDDING_API_KEY") === undefined) {
    recordCheck("openrouter_real_embedding_call", "blocked", "live-read-only", { reason: "EMBEDDING_SECRET_MISSING" });
    return null;
  }
  if (embeddingConfig.dimension !== pgVectorStorageDimension) {
    recordCheck("openrouter_real_embedding_call", "blocked", "blocked", {
      reason: "EMBEDDING_DIMENSION_INCOMPATIBLE",
      configuredDimension: embeddingConfig.dimension,
      migrationDimension: pgVectorStorageDimension
    });
    recordCheck("pgvector_dimension_migration_compatibility", "fail", "blocked", {
      configuredDimension: embeddingConfig.dimension,
      migrationDimension: pgVectorStorageDimension,
      reason: "EMBEDDING_DIMENSION_INCOMPATIBLE_DO_NOT_MODIFY_MIGRATION"
    });
    return null;
  }
  recordCheck("pgvector_dimension_migration_compatibility", "pass", "contract", { configuredDimension: embeddingConfig.dimension, migrationDimension: pgVectorStorageDimension });
  try {
    const provider = createOpenRouterEmbeddingProviderFromEnvironment(embeddingConfig, process.env, {
      timeoutMs: Math.min(20_000, Math.max(250, timeoutMs)),
      maxRetries: 0,
      maxBatchSize: 1
    });
    const input = metadata?.semanticDocument.text ?? "Read-only ERC-8004 BSC pipeline verification.";
    const vector = await provider.embed(input);
    const valid = vector.length === embeddingConfig.dimension && vector.every((value) => Number.isFinite(value));
    recordCheck("openrouter_real_embedding_call", valid ? "pass" : "fail", "live-read-only", {
      provider: provider.provider,
      model: provider.model,
      modelVersion: provider.modelVersion,
      configuredDimension: embeddingConfig.dimension,
      vectorLength: vector.length,
      finiteValues: vector.every((value) => Number.isFinite(value)),
      inputDigest: canonicalSha256Hex(input)
    });
    return valid ? { provider, vector } : null;
  } catch (error) {
    recordCheck("openrouter_real_embedding_call", statusForError(error), "live-read-only", { errorCode: safeErrorCode(error) });
    return null;
  }
}

async function runPipeline(
  context: ScanContext | null,
  embedding: { readonly provider: EmbeddingProvider; readonly vector: readonly number[] } | null,
  runtimeConfig: RuntimeConfig | null,
  rpc: RpcContext
): Promise<void> {
  if (context === null) {
    recordCheck("gated_erc8004_pipeline_orchestration", "blocked", "live-read-only", { reason: "DISCOVERY_CONTEXT_UNAVAILABLE" });
    return;
  }
  const adapter = createEightHundredFourScanAdapter({ listCandidates: async () => context.rawPage });
  const query = context.selected === null
    ? { limit: Math.max(1, context.candidates.length) }
    : { chainId: context.selected.identity.chainId, isTestnet: context.selected.identity.chainId === 97, limit: Math.max(1, context.candidates.length), offset: 0 };
  const { repository, databaseBacked } = createE2EIngestionRepository(runtimeConfig, () => new Date());
  try {
    const result = await runInRollback(repository, async (unitOfWork) => {
      const enabled = new Erc8004Pipeline({
        repository: unitOfWork,
        adapter,
        ...(rpc.reader === null ? {} : { registryReader: rpc.reader }),
        ...(embedding === null ? {} : { embeddingProvider: embedding.provider, vectorRepository: new InMemorySemanticVectorRepository() }),
        versionIdForIdentity: () => randomUUID(),
        metadataResolver: new BoundedMetadataResolver({ maxRedirects: 0 }),
        gates: runtimeConfig === null ? undefined : {
          ERC8004_INGESTION_ENABLED: runtimeConfig.erc8004IngestionEnabled,
          ERC8004SCAN_DISCOVERY_ENABLED: runtimeConfig.erc8004ScanDiscoveryEnabled,
          MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: runtimeConfig.marketplaceSemanticRetrievalEnabled
        }
      });
      return { pipeline: enabled, result: await enabled.discover(query) };
    });
    const expectedFailedCount = result.result.candidates.filter((candidate) => candidate.ingestion === "failed" || candidate.registry !== "verified" || candidate.metadata !== "resolved" || (result.pipeline.featureGates().MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED && candidate.vector === null)).length;
    const expectedStatus = expectedFailedCount > 0 ? "degraded" : "completed";
    const statusConsistent = result.result.discoveryStatus === "completed" &&
      result.result.candidateCount === context.candidates.length &&
      result.result.failedCount === expectedFailedCount &&
      result.result.completedCount === result.result.candidateCount - result.result.failedCount &&
      result.result.status === expectedStatus;
    recordCheck("gated_erc8004_pipeline_orchestration", statusConsistent ? "pass" : "fail", databaseBacked ? "live-read-only" : "deterministic", {
      enabledGates: result.pipeline.featureGates(),
      registryReaderConfigured: rpc.reader !== null,
      dualProviderEvidence: rpc.dualProviderEvidence,
      status: result.result.status,
      discoveryStatus: result.result.discoveryStatus,
      candidateCount: result.result.candidateCount,
      completedCount: result.result.completedCount,
      failedCount: result.result.failedCount,
      expectedStatus,
      expectedFailedCount,
      statusConsistent,
      warnings: result.result.warnings.slice(0, 8),
      repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture",
      transactionRolledBack: true
    });
  } catch (error) {
    recordCheck("gated_erc8004_pipeline_orchestration", statusForError(error), databaseBacked ? "live-read-only" : "deterministic", { errorCode: safeErrorCode(error), repository: databaseBacked ? "postgresql" : "in-memory-contract-fixture" });
  } finally {
    try {
      const disabled = new Erc8004Pipeline({ repository, adapter });
      const disabledResult = await disabled.discover({ limit: 1 });
      recordCheck("disabled_provider_api_rpc_degraded_paths", disabledResult.status === "disabled" ? "pass" : "fail", "deterministic", {
        disabledGates: disabled.featureGates(),
        observedStatus: disabledResult.status,
        warningCount: disabledResult.warnings.length
      });
    } finally {
      await closeE2EIngestionRepository(repository);
    }
  }
}

async function runMarketplaceEligibility(): Promise<void> {
  const source = new InMemoryMarketplaceSource(developmentFixtureListings);
  const now = () => new Date("2026-09-02T12:00:00.000Z");
  const deterministic = new MarketplaceReadService(source, { semanticRetrievalEnabled: false, now });
  const baseline = await deterministic.search({ query: "venus" });
  const seen: string[][] = [];
  const semantic = new MarketplaceReadService(source, {
    semanticRetrievalEnabled: true,
    now,
    semanticRetriever: {
      search: async (input) => {
        seen.push([...input.candidateIdentityKeys]);
        return [...input.candidateIdentityKeys].reverse().map((identityKey, index) => ({ identityKey, similarity: index === 0 ? 0.99 : 0.01, modelVersion: "e2e-test" }));
      }
    }
  });
  const ranked = await semantic.search({ query: "venus" });
  const baselineKeys = baseline.results.map((result) => result.identityKey);
  const rankedKeys = ranked.results.map((result) => result.identityKey);
  const subset = seen.length === 1 && seen[0] !== undefined && seen[0].length === baselineKeys.length && seen[0].every((key) => baselineKeys.includes(key)) && baseline.excluded.length > 0;
  const reordered = baselineKeys.length >= 2 && rankedKeys[0] === baselineKeys[baselineKeys.length - 1];
  recordCheck("hard_eligibility_before_semantic_ranking", subset && reordered ? "pass" : "fail", "deterministic", {
    hardEligibleCount: baseline.results.length,
    excludedCount: baseline.excluded.length,
    semanticCandidateCount: seen[0]?.length ?? 0,
    semanticCandidateSubsetOfEligible: subset,
    semanticReorderedEligibleOnly: reordered
  });
  const fallback = new MarketplaceReadService(source, {
    semanticRetrievalEnabled: true,
    now,
    semanticRetriever: { search: async () => { throw new SanitizedFailure("SEMANTIC_PROVIDER_UNAVAILABLE"); } }
  });
  const degraded = await fallback.search({ query: "venus" });
  recordCheck("deterministic_marketplace_fallback_on_semantic_failure", JSON.stringify(degraded.results.map((result) => result.identityKey)) === JSON.stringify(baselineKeys) && degraded.meta.warning !== null ? "pass" : "fail", "deterministic", {
    resultCount: degraded.results.length,
    fallbackWarningPresent: degraded.meta.warning !== null,
    resultOrderDigest: canonicalSha256Hex(degraded.results.map((result) => result.identityKey))
  });
}

async function runDatabaseVectorTest(runtimeConfig: RuntimeConfig | null, metadata: MetadataContext | null, embedding: { readonly provider: EmbeddingProvider; readonly vector: readonly number[] } | null, chainId: number, registry: string | null): Promise<void> {
  if (runtimeConfig?.databaseUrl === undefined || runtimeConfig.databaseUrl.trim() === "") {
    recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", "blocked", "live-read-only", { reason: "DATABASE_URL_MISSING" });
    return;
  }
  if (runtimeConfig.environment !== "development" || runtimeConfig.nodeEnv === "production") {
    recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", "blocked", "live-read-only", { reason: "DATABASE_NOT_EXPLICITLY_DEVELOPMENT", environment: runtimeConfig.environment, nodeEnv: runtimeConfig.nodeEnv });
    return;
  }
  if (embedding === null || runtimeConfig.embedding?.dimension !== pgVectorStorageDimension || registry === null) {
    recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", "blocked", "blocked", {
      reason: embedding === null ? "EMBEDDING_UNAVAILABLE" : runtimeConfig.embedding?.dimension !== pgVectorStorageDimension ? "EMBEDDING_DIMENSION_INCOMPATIBLE" : "REGISTRY_UNRESOLVED",
      migrationDimension: pgVectorStorageDimension,
      configuredDimension: runtimeConfig.embedding?.dimension ?? null
    });
    return;
  }
  const identityId = randomUUID();
  const agentId = randomUUID();
  const versionId = randomUUID();
  const testIdentity: Erc8004Identity = {
    namespace: "eip155",
    chainId,
    identityRegistry: registry,
    agentId: (9_000_000_000_000_000n + BigInt(Date.now())).toString()
  };
  const { pool } = createDb(runtimeConfig.databaseUrl, { ssl: runtimeConfig.databaseSsl });
  let rollbackAttempted = false;
  try {
    await migrateDb(runtimeConfig.databaseUrl, { ssl: runtimeConfig.databaseSsl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO erc8004_identities (id, namespace, chain_id, identity_registry, agent_id) VALUES ($1, $2, $3, $4, $5)", [identityId, testIdentity.namespace, testIdentity.chainId, testIdentity.identityRegistry, testIdentity.agentId]);
      await client.query("INSERT INTO agents (id, identity_id, origin_type) VALUES ($1, $2, $3)", [agentId, identityId, "manual_import"]);
      await client.query("INSERT INTO agent_versions (id, agent_id, version, public_metadata, capability_manifest, pricing_manifest) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)", [versionId, agentId, 1, JSON.stringify({ name: "ERC-8004 E2E semantic row" }), JSON.stringify({ schemaVersion: "bnbera.capability/v1", capabilities: [] }), JSON.stringify({ model: "unavailable" })]);
      const repository = new PgVectorSemanticRepository(client, { storageDimension: pgVectorStorageDimension });
      const document = metadata?.semanticDocument ?? buildSemanticDocument({ identity: testIdentity, category: "uncategorized", name: "ERC-8004 E2E semantic row", description: "Read-only semantic index transaction verification.", evidenceSummary: { source: "e2e" } });
      const first = await ensureSemanticVector({ agentVersionId: versionId, document, classifierVersion: metadata?.classification.classifierVersion ?? null, provider: embedding.provider, now: new Date() }, repository);
      const second = await ensureSemanticVector({ agentVersionId: versionId, document, classifierVersion: metadata?.classification.classifierVersion ?? null, provider: embedding.provider, now: new Date() }, repository);
      const hits = await repository.search({ vector: first.record.embedding, provider: embedding.provider.provider, model: embedding.provider.model, modelVersion: embedding.provider.modelVersion, dimension: embedding.provider.dimension, candidateAgentVersionIds: [versionId], limit: 1 });
      const idempotent = first.generated && !second.generated && first.record.sourceTextDigest === second.record.sourceTextDigest;
      const similarity = hits.length === 1 && hits[0]?.agentVersionId === versionId && Number.isFinite(hits[0]?.similarity);
      await client.query("ROLLBACK");
      rollbackAttempted = true;
      const after = await pool.query<{ readonly table_name: string; readonly row_count: string }>("SELECT table_name, row_count::text FROM (VALUES ('erc8004_identities', (SELECT count(*) FROM erc8004_identities WHERE id = $1)), ('agents', (SELECT count(*) FROM agents WHERE id = $2)), ('agent_versions', (SELECT count(*) FROM agent_versions WHERE id = $3)), ('agent_listing_embeddings', (SELECT count(*) FROM agent_listing_embeddings WHERE agent_version_id = $3))) AS rows(table_name, row_count)", [identityId, agentId, versionId]);
      const cleanup = after.rows.every((row) => row.row_count === "0");
      recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", idempotent && similarity && cleanup ? "pass" : "fail", "live-read-only", {
        migrationApplied: true,
        vectorDimension: first.record.dimension,
        firstGenerated: first.generated,
        secondGenerated: second.generated,
        similarityHitCount: hits.length,
        similarityFinite: similarity,
        rollbackAttempted,
        testRowsAbsentAfterRollback: cleanup
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); rollbackAttempted = true; } catch { /* best effort */ }
      recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", "fail", "live-read-only", { errorCode: safeErrorCode(error), rollbackAttempted });
    } finally {
      client.release();
    }
  } catch (error) {
    recordCheck("postgres_pgvector_transaction_idempotency_similarity_rollback", "blocked", "live-read-only", { errorCode: safeErrorCode(error), rollbackAttempted });
  } finally {
    await pool.end();
  }
}

async function runApiAndBrowser(timeoutMs: number): Promise<void> {
  const apiEndpoint = nonEmpty("BNBERA_MARKETPLACE_API_URL");
  if (apiEndpoint === undefined) {
    recordCheck("marketplace_api_live_database_backed_read", "blocked", "live-read-only", { reason: "BNBERA_MARKETPLACE_API_URL_MISSING" });
  } else {
    try {
      const parsed = new URL(apiEndpoint);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || parsed.search !== "") throw new SanitizedFailure("MARKETPLACE_API_URL_INVALID");
      const result = await fetchBounded(parsed.toString(), { timeoutMs, maxBytes: 1_048_576, headers: { accept: "application/json" } });
      const contentType = result.response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      let body: unknown;
      try { body = JSON.parse(new TextDecoder().decode(result.bytes)); } catch { throw new SanitizedFailure("MARKETPLACE_API_JSON_INVALID"); }
      const record = plainRecord(body);
      const mode = record?.mode;
      if ((mode !== "live" && mode !== "degraded") || record?.contractVersion !== "bnbera.marketplace-read/v0.1") throw new SanitizedFailure("MARKETPLACE_API_NOT_LIVE_CONTRACT");
      recordCheck("marketplace_api_live_database_backed_read", "pass", "live-read-only", { endpoint: endpointLabel(apiEndpoint), httpStatus: result.response.status, contentType: contentType || "unspecified", byteLength: result.bytes.byteLength, mode, contractVersion: record.contractVersion });
    } catch (error) {
      recordCheck("marketplace_api_live_database_backed_read", "blocked", "live-read-only", { endpoint: endpointLabel(apiEndpoint), errorCode: safeErrorCode(error) });
    }
  }
  const preview = nonEmpty("BNBERA_PREVIEW_URL");
  if (preview === undefined) {
    recordCheck("marketplace_browser_routes", "skipped", "skipped", { reason: "BNBERA_PREVIEW_URL_MISSING" });
    return;
  }
  let parsedPreview: URL;
  try {
    parsedPreview = new URL(preview);
    if ((parsedPreview.protocol !== "http:" && parsedPreview.protocol !== "https:") || parsedPreview.username !== "" || parsedPreview.password !== "" || parsedPreview.search !== "" || parsedPreview.hash !== "") throw new SanitizedFailure("PREVIEW_URL_INVALID");
  } catch (error) {
    recordCheck("marketplace_browser_routes", "fail", "live-read-only", { errorCode: safeErrorCode(error) });
    return;
  }
  try {
    await execFileAsync("agent-browser", ["open", parsedPreview.toString()], { timeout: timeoutMs, maxBuffer: 256 * 1024 });
    await execFileAsync("agent-browser", ["wait", "--load", "networkidle"], { timeout: timeoutMs, maxBuffer: 256 * 1024 });
    const body = await execFileAsync("agent-browser", ["eval", "document.body?.innerText ?? ''"], { timeout: timeoutMs, maxBuffer: 512 * 1024 });
    const text = body.stdout.toLowerCase();
    if (text.trim() === "" || text.includes("application error") || text.includes("internal server error")) throw new SanitizedFailure("BROWSER_RENDER_FAILED");
    recordCheck("marketplace_browser_routes", "pass", "live-read-only", { endpoint: endpointLabel(preview), routesChecked: 1, readableBody: true });
  } catch (error) {
    recordCheck("marketplace_browser_routes", "blocked", "skipped", { endpoint: endpointLabel(preview), reason: safeErrorCode(error) });
  } finally {
    try { await execFileAsync("agent-browser", ["close"], { timeout: Math.min(timeoutMs, 5_000), maxBuffer: 64 * 1024 }); } catch { /* best effort */ }
  }
}

async function main(): Promise<void> {
  // Runtime secrets and endpoints must be injected by the caller/secret
  // manager. Never read a dotenv file here; evidence stores only presence
  // booleans and sanitized endpoint labels.
  let runtimeConfig: RuntimeConfig | null = null;
  let chainId = 97;
  let registry: string | null = null;
  try {
    const timeoutMs = numberFromEnv("ERC8004_E2E_TIMEOUT_MS", 10_000, 120_000);
    const maxCandidates = numberFromEnv("ERC8004_E2E_MAX_CANDIDATES", 3, 10);
    chainId = selectedChainId();
    try {
      runtimeConfig = loadRuntimeConfig(process.env);
      recordCheck("runtime_configuration_presence_and_feature_gates", "pass", "contract", {
        environment: runtimeConfig.environment,
        nodeEnv: runtimeConfig.nodeEnv,
        chainId: runtimeConfig.bscChainId,
        databaseConfigured: runtimeConfig.databaseUrl !== undefined,
        embeddingConfigured: runtimeConfig.embedding !== null,
        embeddingSecretReferenceConfigured: runtimeConfig.embedding?.secretReference !== undefined,
        sourceGatesRemainDisabled: !runtimeConfig.erc8004IngestionEnabled && !runtimeConfig.erc8004ScanDiscoveryEnabled && !runtimeConfig.marketplaceSemanticRetrievalEnabled
      });
    } catch (error) {
      recordCheck("runtime_configuration_presence_and_feature_gates", "fail", "contract", { errorCode: safeErrorCode(error) });
    }
    const lock = await readStandardsLock();
    const lockedRegistry = lockRegistry(lock, chainId);
    const configuredRegistry = nonEmpty("ERC8004_E2E_IDENTITY_REGISTRY");
    if (configuredRegistry !== undefined) {
      try { registry = normalizeEvmAddress(configuredRegistry); } catch { throw new SanitizedFailure("E2E_REGISTRY_INVALID"); }
      if (lockedRegistry !== null && registry !== lockedRegistry) recordCheck("standards_lock_network_and_abi_gate", "fail", "contract", { chainId, reason: "E2E_REGISTRY_DIFFERS_FROM_STANDARDS_LOCK" });
    } else {
      registry = lockedRegistry;
    }
    const abiHashes = lock.networks?.[String(chainId)]?.erc8004?.abiHashes;
    recordCheck("standards_lock_network_and_abi_gate", registry !== null ? "pass" : "fail", "contract", {
      lockStatus: typeof lock.lockStatus === "string" ? lock.lockStatus : "unknown",
      chainId,
      identityRegistry: registry ?? "unresolved",
      abiHashesResolved: typeof abiHashes?.identityRegistry === "string" && typeof abiHashes?.reputationRegistry === "string",
      exactIdentityReadGate: "disabled-until-reviewed-abi"
    });
    const context = await runScan(chainId, registry, maxCandidates, timeoutMs, runtimeConfig);
    const rpc = await runRpcChecks(chainId, registry, context?.selected ?? null, timeoutMs, lock);
    await runDedupCheck(context?.candidates ?? [], runtimeConfig);
    const metadata = await runMetadata(context, rpc, timeoutMs, runtimeConfig);
    const embedding = await runEmbedding(runtimeConfig, metadata, timeoutMs);
    await runPipeline(context, embedding, runtimeConfig, rpc);
    await runMarketplaceEligibility();
    await runDatabaseVectorTest(runtimeConfig, metadata, embedding, chainId, registry);
    await runApiAndBrowser(timeoutMs);
  } catch (error) {
    recordCheck("e2e_harness_execution", "fail", "deterministic", { errorCode: safeErrorCode(error) });
  }
  const evidence = {
    schemaVersion: "bnbera.erc8004-e2e/v1",
    startedAt,
    completedAt: nowIso(),
    pipelineComplete: checks.length > 0 && checks.every((check) => check.status === "pass"),
    noSecretsWritten: true,
    safety: {
      readOnlyRpcMethodsOnly: true,
      noWalletsOrSignatures: true,
      noOnchainWrites: true,
      noPaymentsOrDeployments: true,
      databaseRowsRolledBack: checks.some((check) => check.name === "postgres_pgvector_transaction_idempotency_similarity_rollback" && check.details.testRowsAbsentAfterRollback === true)
    },
    configurationPresence: {
      eightsScanApiKey: nonEmpty("EIGHTSCAN_API_KEY") !== undefined,
      embeddingApiKey: nonEmpty("ERC8004_EMBEDDING_API_KEY") !== undefined,
      embeddingModel: nonEmpty("ERC8004_EMBEDDING_MODEL") !== undefined,
      embeddingDimension: nonEmpty("ERC8004_EMBEDDING_DIMENSION") ?? "default-1536",
      databaseUrl: nonEmpty("DATABASE_URL") !== undefined,
      marketplaceApiUrl: nonEmpty("BNBERA_MARKETPLACE_API_URL") !== undefined,
      previewUrl: nonEmpty("BNBERA_PREVIEW_URL") !== undefined
    },
    checks
  } satisfies Readonly<Record<string, unknown>>;
  const serialized = JSON.stringify(evidence, null, 2);
  hashSecretSafeEvidence(serialized);
  await writeFile(new URL("../docs/release-evidence/erc8004-e2e.json", import.meta.url), serialized + "\n", "utf8");
  console.log(JSON.stringify({
    ok: evidence.pipelineComplete,
    evidenceFile: "docs/release-evidence/erc8004-e2e.json",
    checkCount: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
    failed: checks.filter((check) => check.status === "fail").length
  }));
  if (!evidence.pipelineComplete) process.exitCode = 1;
}

await main();
