import { canonicalSha256Hex, normalizeErc8004Identity, normalizeEvmAddress } from "@bnbera/domain";
import { AppError } from "@bnbera/config";
import { z } from "zod";
import { ingestionError } from "../errors.js";
import { assertSafePublicValue, normalizeCandidate, normalizeIdentity, normalizeSourceReference } from "../normalize.js";
import type { IdentityCandidate, IdentityKey } from "../types.js";

/**
 * The reviewed Builder Hub contract (2026-09-04). Keep this manifest in
 * source control rather than relying on a cloned skill or an unpinned example.
 * The full document is fetched and checked by the release canary.
 */
export const officialEightHundredFourScanContract = Object.freeze({
  baseUrl: "https://api.8004scan.io/api/v1",
  openApiUrl: "https://api.8004scan.io/openapi.json",
  openApiVersion: "0.4.363",
  // Hashes are kept separately because verification receives parsed JSON,
  // while the release evidence also records the exact response bytes.
  openApiSha256: "a9686ae41d7a4d2c52c8e67fca193db643fe6dcd16a14bbfb6f35435f69a15ea",
  openApiRawSha256: "984ab5d6621c4ae555f30fb11fb831678a1355b68216f8edd2eed1f1e9c26eb1",
  listPath: "/agents",
  semanticSearchPath: "/agents/search/semantic",
  detailPath: "/agents/{chain_id}/{token_id}",
  fullDetailPath: "/agents/{chain_id}/{registry_address}/{token_id}",
  chainsPath: "/chains",
  authenticationHeader: "X-API-Key",
  pagination: "offset",
  anonymousRequestsPerMinute: 30,
  anonymousRequestsPerDay: 1_000,
  maxPageSize: 100
} as const);

export type EightHundredFourScanQuery = {
  readonly chainId?: number;
  /** Current API pagination. `cursor` remains accepted for the old adapter API. */
  readonly offset?: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly isTestnet?: boolean;
  readonly supportedProtocol?: string;
  readonly search?: string;
  /** Internal cancellation signal; never serialized into provider parameters. */
  readonly signal?: AbortSignal;
};

export type EightHundredFourScanPage = {
  readonly items: readonly unknown[];
  /** Kept for compatibility with the transport-independent adapter. */
  readonly nextCursor: string | null;
  readonly nextOffset?: number | null;
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
};

export type EightHundredFourScanSemanticQuery = {
  readonly query: string;
  readonly chainId?: number;
  readonly offset?: number;
  readonly limit?: number;
  readonly semanticWeight?: number;
  readonly similarityThreshold?: number;
};

export type EightHundredFourScanChainsResponse = Readonly<Record<string, unknown>>;

/** Provider transport boundary; tests inject this without vendor calls. */
export interface EightHundredFourScanClient {
  listCandidates(query: EightHundredFourScanQuery): Promise<EightHundredFourScanPage>;
}

export interface ExtendedEightHundredFourScanClient extends EightHundredFourScanClient {
  searchSemantic(query: EightHundredFourScanSemanticQuery): Promise<EightHundredFourScanPage>;
  getCandidate(chainId: number, agentId: string): Promise<unknown>;
  getCandidateByIdentity(identity: { readonly namespace: string; readonly chainId: number; readonly identityRegistry: string; readonly agentId: string }): Promise<unknown>;
  listChains(): Promise<EightHundredFourScanChainsResponse>;
  fetchOpenApiDocument(): Promise<unknown>;
}

export type MappedEightHundredFourScanCandidate = {
  readonly identity: unknown;
  readonly sourceReference: unknown;
  readonly observedAt?: Date;
  readonly rawResponseDigest?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly services?: readonly unknown[];
  readonly capabilityManifest?: unknown;
};

export type EightHundredFourScanMapper = (raw: unknown) => MappedEightHundredFourScanCandidate;

const canonicalScanRecordSchema = z.object({
  identity: z.unknown(),
  sourceReference: z.unknown(),
  observedAt: z.coerce.date().optional(),
  rawResponseDigest: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  services: z.array(z.unknown()).optional(),
  capabilityManifest: z.unknown().optional()
});

/** Required/consumed fields from the reviewed OpenAPI AgentSummary schema. */
const officialAgentSummarySchema = z.object({
  id: z.string().optional(),
  agent_id: z.string().optional(),
  token_id: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  chain_id: z.number().int().positive(),
  chain_type: z.string().optional(),
  contract_address: z.string(),
  owner_address: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  supported_protocols: z.array(z.string()).optional(),
  x402_supported: z.boolean().optional(),
  agent_wallet: z.string().nullable().optional(),
  // The vendor has returned both an object and an array in different API
  // generations. Keep the field opaque at the contract boundary and let the
  // bounded mapper normalize either representation deterministically.
  services: z.unknown().nullable().optional(),
  capabilities: z.unknown().optional(),
  capability_manifest: z.unknown().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
}).passthrough();

const officialListResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(officialEightHundredFourScanContract.maxPageSize),
  offset: z.number().int().nonnegative()
}).passthrough();

const officialSemanticResponseSchema = officialListResponseSchema;
type FetchLike = typeof globalThis.fetch;

export type EightHundredFourScanHttpOptions = {
  readonly baseUrl?: string;
  /** A server-injected secret; never read from browser code or persisted. */
  readonly apiKey?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRetries?: number;
  readonly maxBackoffMs?: number;
  readonly minRequestIntervalMs?: number;
  readonly cacheTtlMs?: number;
  readonly maxCacheEntries?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitCooldownMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Only useful for a local contract-test server. */
  readonly allowInsecureBaseUrl?: boolean;
};

type CachedResponse = { readonly expiresAt: number; readonly value: unknown };
type HttpFailure = {
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly timeout: boolean;
  readonly network: boolean;
  readonly contract: boolean;
  readonly cause?: unknown;
};

function httpFailureMessage(failure: HttpFailure): string {
  if (failure.timeout) return "The 8004scan request timed out.";
  if (failure.status === 401 || failure.status === 403) return "The 8004scan credential was rejected.";
  if (failure.status === 429) return "The 8004scan rate limit was reached.";
  if (failure.contract) return "The 8004scan response did not match the reviewed API contract.";
  if (failure.network || failure.status === null) return "The 8004scan service could not be reached.";
  return "The 8004scan service returned an unsuccessful response.";
}

function classifyFailure(failure: HttpFailure): { readonly code: Parameters<typeof ingestionError>[0]; readonly retriable: boolean; readonly nextAction: string } {
  if (failure.timeout) return { code: "SCAN_TIMEOUT", retriable: true, nextAction: "retry_scan" };
  if (failure.status === 401 || failure.status === 403) return { code: "SCAN_AUTH_FAILED", retriable: false, nextAction: "rotate_scan_credential" };
  if (failure.status === 429) return { code: "SCAN_RATE_LIMITED", retriable: true, nextAction: "wait_for_scan_rate_limit" };
  if (failure.contract || failure.status === 400) return { code: "SCAN_CONTRACT_INVALID", retriable: false, nextAction: "review_scan_contract" };
  return { code: "SCAN_UNAVAILABLE", retriable: true, nextAction: "retry_scan" };
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw ingestionError("SCAN_CONFIG_INVALID", `The 8004scan ${field} is outside its safe bound.`, "fix_scan_configuration");
  }
  return result;
}

function assertBaseUrl(value: string, allowInsecure: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan base URL is invalid.", "fix_scan_configuration", cause);
  }
  if ((parsed.protocol !== "https:" && !(allowInsecure && parsed.protocol === "http:")) || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan base URL must be HTTPS without credentials or query parameters.", "fix_scan_configuration");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function assertApiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan credential has an invalid format.", "rotate_scan_credential");
  }
  return value;
}

function parseOffset(query: EightHundredFourScanQuery): number {
  if (query.offset !== undefined) return boundedInteger(query.offset, 0, 0, 10_000_000, "offset");
  if (query.cursor === undefined || query.cursor.trim() === "") return 0;
  if (!/^[0-9]+$/u.test(query.cursor.trim())) {
    throw ingestionError("SCAN_CONFIG_INVALID", "The current 8004scan API uses a numeric offset, not a cursor.", "fix_scan_pagination");
  }
  return boundedInteger(Number(query.cursor), 0, 0, 10_000_000, "offset");
}

function queryNumber(value: number | undefined, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return String(boundedInteger(value, 0, 0, max, field));
}

function queryBoolean(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "true" : "false";
}

/** Production HTTP transport with bounded retry/rate-limit/cache/circuit policy. */
export class EightHundredFourScanHttpClient implements ExtendedEightHundredFourScanClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly minRequestIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cache = new Map<string, CachedResponse>();
  private lastRequestAt = 0;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  public constructor(options: EightHundredFourScanHttpOptions = {}) {
    this.baseUrl = assertBaseUrl(options.baseUrl ?? officialEightHundredFourScanContract.baseUrl, options.allowInsecureBaseUrl === true);
    this.apiKey = assertApiKey(options.apiKey);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = boundedInteger(options.timeoutMs, 10_000, 250, 120_000, "timeout");
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, 2 * 1024 * 1024, 1_024, 8 * 1024 * 1024, "response size");
    this.maxRetries = boundedInteger(options.maxRetries, 3, 0, 5, "retry count");
    this.maxBackoffMs = boundedInteger(options.maxBackoffMs, 10_000, 50, 120_000, "backoff");
    this.minRequestIntervalMs = boundedInteger(options.minRequestIntervalMs, 2_000, 0, 60_000, "request interval");
    this.cacheTtlMs = boundedInteger(options.cacheTtlMs, 30_000, 0, 300_000, "cache TTL");
    this.maxCacheEntries = boundedInteger(options.maxCacheEntries, 128, 1, 2_048, "cache size");
    this.circuitFailureThreshold = boundedInteger(options.circuitFailureThreshold, 5, 1, 20, "circuit threshold");
    this.circuitCooldownMs = boundedInteger(options.circuitCooldownMs, 30_000, 1_000, 600_000, "circuit cooldown");
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  /** Build a client from server runtime configuration without exposing a key. */
  public static fromEnvironment(
    env: Readonly<Record<string, string | undefined>> = process.env,
    options: Omit<EightHundredFourScanHttpOptions, "apiKey"> = {}
  ): EightHundredFourScanHttpClient {
    return new EightHundredFourScanHttpClient(
      env.EIGHTSCAN_API_KEY === undefined ? options : { ...options, apiKey: env.EIGHTSCAN_API_KEY }
    );
  }

  public async listCandidates(query: EightHundredFourScanQuery = {}): Promise<EightHundredFourScanPage> {
    const offset = parseOffset(query);
    const limit = boundedInteger(query.limit, 20, 1, officialEightHundredFourScanContract.maxPageSize, "page size");
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    this.appendParam(params, "chain_id", queryNumber(query.chainId, "chain ID", 2_147_483_647));
    this.appendParam(params, "is_testnet", queryBoolean(query.isTestnet));
    this.appendParam(params, "supported_protocol", this.boundedText(query.supportedProtocol, 128, "supported protocol"));
    this.appendParam(params, "search", this.boundedText(query.search, 200, "search"));
    const body = await this.getJson(`${officialEightHundredFourScanContract.listPath}?${params.toString()}`, query.signal);
    return this.mapPage(body, false);
  }

  public async searchSemantic(query: EightHundredFourScanSemanticQuery): Promise<EightHundredFourScanPage> {
    const q = this.boundedText(query.query, 500, "semantic query");
    if (q === undefined || q.length === 0) {
      throw ingestionError("SCAN_CONFIG_INVALID", "A non-empty semantic query is required.", "fix_scan_query");
    }
    const limit = boundedInteger(query.limit, 20, 1, officialEightHundredFourScanContract.maxPageSize, "page size");
    const offset = boundedInteger(query.offset, 0, 0, 10_000_000, "offset");
    const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
    this.appendParam(params, "chain_id", queryNumber(query.chainId, "chain ID", 2_147_483_647));
    if (query.semanticWeight !== undefined) params.set("semantic_weight", this.boundedNumber(query.semanticWeight, 0, 1, "semantic weight"));
    if (query.similarityThreshold !== undefined) params.set("similarity_threshold", this.boundedNumber(query.similarityThreshold, 0, 1, "similarity threshold"));
    const body = await this.getJson(`${officialEightHundredFourScanContract.semanticSearchPath}?${params.toString()}`);
    return this.mapPage(body, true);
  }

  public async getCandidate(chainId: number, agentId: string): Promise<unknown> {
    const normalizedChainId = boundedInteger(chainId, 0, 1, 2_147_483_647, "chain ID");
    const normalizedAgentId = this.boundedAgentId(agentId);
    return this.getJson(`${officialEightHundredFourScanContract.listPath}/${normalizedChainId}/${normalizedAgentId}`);
  }

  /** Use the full-identity detail route when a registry address is known. */
  public async getCandidateByIdentity(identity: { readonly namespace: string; readonly chainId: number; readonly identityRegistry: string; readonly agentId: string }): Promise<unknown> {
    const normalized = normalizeErc8004Identity(identity as Parameters<typeof normalizeErc8004Identity>[0]);
    if (normalized.namespace !== "eip155") throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan detail route accepts EVM identities only.", "fix_scan_identity");
    return this.getJson(`${officialEightHundredFourScanContract.listPath}/${normalized.chainId}/${normalizeEvmAddress(normalized.identityRegistry)}/${this.boundedAgentId(normalized.agentId)}`);
  }

  public async listChains(): Promise<EightHundredFourScanChainsResponse> {
    const body = await this.getJson(officialEightHundredFourScanContract.chainsPath);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan chains response is invalid.", "review_scan_contract");
    }
    return body as EightHundredFourScanChainsResponse;
  }

  public async fetchOpenApiDocument(): Promise<unknown> {
    const body = await this.getJsonAbsolute(officialEightHundredFourScanContract.openApiUrl, true);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan OpenAPI document is invalid.", "review_scan_contract");
    }
    return body;
  }

  public circuitState(): { readonly open: boolean; readonly consecutiveFailures: number; readonly openedAt: number | null } {
    return { open: this.circuitOpenedAt !== null && this.now() - this.circuitOpenedAt < this.circuitCooldownMs, consecutiveFailures: this.consecutiveFailures, openedAt: this.circuitOpenedAt };
  }

  private async getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.getJsonAbsolute(`${this.baseUrl}${path}`, false, signal);
  }

  private async getJsonAbsolute(url: string, contractDocument = false, signal?: AbortSignal): Promise<unknown> {
    const cached = this.cache.get(url);
    const now = this.now();
    if (cached !== undefined && cached.expiresAt > now) return cached.value;
    if (cached !== undefined) this.cache.delete(url);
    if (this.circuitOpenedAt !== null) {
      if (now - this.circuitOpenedAt < this.circuitCooldownMs) {
        throw ingestionError("SCAN_CIRCUIT_OPEN", "The 8004scan circuit breaker is open after repeated provider failures.", "wait_for_scan_provider", undefined, true);
      }
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
    }
    let lastFailure: HttpFailure | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (signal?.aborted === true) {
        throw ingestionError("SCAN_TIMEOUT", "The 8004scan request timed out.", "resume_scan_run", undefined, true);
      }
      await this.waitForRateLimit();
      try {
        const value = await this.requestJson(url, contractDocument, signal);
        this.consecutiveFailures = 0;
        this.cacheValue(url, value);
        return value;
      } catch (cause) {
        const failure = this.asHttpFailure(cause);
        lastFailure = failure;
        if (signal?.aborted) break;
        const retryable = failure.timeout || failure.network || failure.status === 429 || (failure.status !== null && failure.status >= 500);
        if (!retryable || attempt >= this.maxRetries) break;
        const delay = Math.min(this.maxBackoffMs, failure.retryAfterMs ?? Math.min(this.maxBackoffMs, 250 * 2 ** attempt) + this.jitter(attempt));
        await this.sleep(delay);
      }
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold) this.circuitOpenedAt = this.now();
    const failure = lastFailure ?? { status: null, retryAfterMs: null, timeout: false, network: true, contract: false };
    const classified = classifyFailure(failure);
    throw ingestionError(classified.code, httpFailureMessage(failure), classified.nextAction, failure.cause, classified.retriable);
  }

  private async requestJson(url: string, contractDocument = false, externalSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromExternal = (): void => controller.abort();
    if (externalSignal?.aborted === true) controller.abort();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey !== undefined) headers[officialEightHundredFourScanContract.authenticationHeader] = this.apiKey;
    let response: Response;
    try {
      response = await this.fetcher(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
    } catch (cause) {
      const timeout = cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
      clearTimeout(timer);
      this.lastRequestAt = this.now();
      throw { status: null, retryAfterMs: null, timeout, network: !timeout, contract: false, cause } satisfies HttpFailure;
    }
    try {
      if (response.status === 429) throw { status: 429, retryAfterMs: this.retryAfter(response), timeout: false, network: false, contract: false } satisfies HttpFailure;
      if (response.status === 401 || response.status === 403) throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: false } satisfies HttpFailure;
      if (!response.ok) throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: response.status === 400 } satisfies HttpFailure;
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && /^[0-9]+$/u.test(contentLength) && Number(contentLength) > this.maxResponseBytes) throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: true } satisfies HttpFailure;
      let bytes: ArrayBuffer;
      try {
        bytes = await response.arrayBuffer();
      } catch (cause) {
        throw { status: response.status, retryAfterMs: null, timeout: false, network: true, contract: false, cause } satisfies HttpFailure;
      }
      if (bytes.byteLength > this.maxResponseBytes) throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: true } satisfies HttpFailure;
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== undefined && contentType !== "" && contentType !== "application/json" && contentType !== "application/problem+json") throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: true } satisfies HttpFailure;
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch (cause) {
        throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: true, cause } satisfies HttpFailure;
      }
      if (!contractDocument) {
        try {
          assertSafePublicValue(value, "8004scanResponse");
        } catch (cause) {
          throw { status: response.status, retryAfterMs: null, timeout: false, network: false, contract: true, cause } satisfies HttpFailure;
        }
      }
      return value;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
      this.lastRequestAt = this.now();
    }
  }

  private mapPage(body: unknown, semantic: boolean): EightHundredFourScanPage {
    const parsed = (semantic ? officialSemanticResponseSchema : officialListResponseSchema).safeParse(body);
    if (!parsed.success) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan page does not match the reviewed OpenAPI response.", "review_scan_contract", parsed.error);
    const page = parsed.data;
    return {
      items: page.items,
      nextCursor: page.offset + page.limit < page.total ? String(page.offset + page.limit) : null,
      nextOffset: page.offset + page.limit < page.total ? page.offset + page.limit : null,
      total: page.total,
      limit: page.limit,
      offset: page.offset
    };
  }

  private cacheValue(url: string, value: unknown): void {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(url, { value, expiresAt: this.now() + this.cacheTtlMs });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const wait = this.minRequestIntervalMs - (this.now() - this.lastRequestAt);
    if (wait > 0) await this.sleep(wait);
  }

  private retryAfter(response: Response): number | null {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(this.maxBackoffMs, seconds * 1_000);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(0, Math.min(this.maxBackoffMs, date - this.now()));
    }
    const reset = response.headers.get("x-ratelimit-reset");
    if (reset !== null && /^[0-9]+$/u.test(reset)) {
      const value = Number(reset);
      const delta = value > 1_000_000_000 ? value * 1_000 - this.now() : value * 1_000;
      return Math.max(0, Math.min(this.maxBackoffMs, delta));
    }
    return null;
  }

  private asHttpFailure(cause: unknown): HttpFailure {
    if (typeof cause === "object" && cause !== null && "status" in cause && "contract" in cause) return cause as HttpFailure;
    if (cause instanceof AppError) return { status: null, retryAfterMs: null, timeout: false, network: false, contract: cause.code === "SCAN_CONTRACT_INVALID", cause };
    return { status: null, retryAfterMs: null, timeout: false, network: true, contract: false, cause };
  }

  private jitter(attempt: number): number {
    // A bounded deterministic floor avoids making tests depend on Math.random.
    return Math.min(250, attempt * 37);
  }

  private appendParam(params: URLSearchParams, key: string, value: string | undefined): void {
    if (value !== undefined) params.set(key, value);
  }

  private boundedText(value: string | undefined, max: number, field: string): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) throw ingestionError("SCAN_CONFIG_INVALID", `The 8004scan ${field} is invalid.`, "fix_scan_query");
    return normalized;
  }

  private boundedNumber(value: number, minimum: number, maximum: number, field: string): string {
    if (!Number.isFinite(value) || value < minimum || value > maximum) throw ingestionError("SCAN_CONFIG_INVALID", `The 8004scan ${field} is invalid.`, "fix_scan_query");
    return String(value);
  }

  private boundedAgentId(value: string): string {
    if (!/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > (1n << 256n) - 1n) throw ingestionError("SCAN_CONFIG_INVALID", "The 8004scan agent ID is invalid.", "fix_scan_identity");
    return value;
  }
}

/** Verify a fetched OpenAPI document against the reviewed release pin. */
function assertBoundedContractValue(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (depth > 12 || budget.nodes++ > 100_000) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract document is too large or deeply nested.", "review_scan_contract");
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract contains an invalid number.", "review_scan_contract");
    return;
  }
  if (typeof value === "string") {
    if (value.length > 100_000) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract contains an oversized string.", "review_scan_contract");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100_000) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract contains too many entries.", "review_scan_contract");
    for (const entry of value) assertBoundedContractValue(entry, depth + 1, budget);
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract is not plain JSON.", "review_scan_contract");
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > 256 || /[\u0000-\u001f\u007f]/u.test(key)) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan contract contains an invalid key.", "review_scan_contract");
    assertBoundedContractValue(entry, depth + 1, budget);
  }
}

export function verifyEightHundredFourScanOpenApi(
  document: unknown,
  expectedSha256 = officialEightHundredFourScanContract.openApiSha256
): { readonly version: string; readonly sha256: string; readonly matches: boolean } {
  assertBoundedContractValue(document);
  const digest = canonicalSha256Hex(document);
  const record = document as { readonly info?: { readonly version?: unknown }; readonly openapi?: unknown };
  const version = typeof record.info?.version === "string" ? record.info.version : "unknown";
  const matches = digest === expectedSha256;
  if (record.openapi !== "3.1.0" || version !== officialEightHundredFourScanContract.openApiVersion || !matches) throw ingestionError("SCAN_CONTRACT_INVALID", "The fetched 8004scan OpenAPI document differs from the reviewed pin.", "review_scan_contract", { version, digest, expectedSha256 });
  return { version, sha256: digest, matches };
}

/** Helper for a pre-normalized provider response. */
export function mapCanonicalScanCandidate(raw: unknown): MappedEightHundredFourScanCandidate {
  const parsed = canonicalScanRecordSchema.safeParse(raw);
  if (!parsed.success) throw ingestionError("INGESTION_INPUT_INVALID", "The 8004scan candidate does not match the mapped provider contract.", "fix_scan_mapper", parsed.error);
  const value = parsed.data;
  return {
    identity: value.identity,
    sourceReference: value.sourceReference,
    ...(value.observedAt === undefined ? {} : { observedAt: value.observedAt }),
    ...(value.rawResponseDigest === undefined ? {} : { rawResponseDigest: value.rawResponseDigest }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
    ...(value.services === undefined ? {} : { services: value.services }),
    ...(value.capabilityManifest === undefined ? {} : { capabilityManifest: value.capabilityManifest })
  };
}

function officialTimestamp(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numericAgentId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return value;
  return undefined;
}

function parseCompositeAgentId(value: string): { readonly chainId: number; readonly registry: string; readonly agentId: string } | null {
  const parts = value.split(":");
  if (parts.length !== 3 || !/^[0-9]+$/u.test(parts[0] ?? "") || !/^(0|[1-9][0-9]*)$/u.test(parts[2] ?? "")) return null;
  try {
    return { chainId: Number(parts[0]), registry: normalizeEvmAddress(parts[1] ?? ""), agentId: parts[2] ?? "" };
  } catch {
    return null;
  }
}

function normalizeOfficialServices(value: unknown): readonly unknown[] {
  const result: unknown[] = [];
  const push = (kind: string | undefined, descriptor: unknown): void => {
    const object = typeof descriptor === "object" && descriptor !== null && !Array.isArray(descriptor) ? descriptor as Record<string, unknown> : { url: descriptor };
    const url = asString(object.url) ?? asString(object.endpoint) ?? asString(object.server) ?? asString(object.mcp_server) ?? asString(object.a2a_endpoint);
    const protocolVersion = asString(object.protocolVersion) ?? asString(object.protocol_version) ?? asString(object.version);
    // A vendor summary is not allowed to acquire a generic service kind or
    // protocol version here. Unsupported descriptors remain absent and are
    // reported by the bounded ingestion/reconciliation stages instead of
    // becoming apparently usable observations.
    if (kind === undefined || url === undefined || protocolVersion === undefined) return;
    result.push({ kind: kind.toLowerCase(), url, protocolVersion });
  };
  if (Array.isArray(value)) {
    for (const descriptor of value) {
      const object = typeof descriptor === "object" && descriptor !== null ? descriptor as Record<string, unknown> : {};
      push(asString(object.kind) ?? asString(object.type), descriptor);
    }
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [kind, descriptor] of Object.entries(value as Record<string, unknown>)) push(kind, descriptor);
  }
  return result;
}

function normalizeOfficialCapabilities(value: unknown): unknown | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const candidates: readonly unknown[] | null = Array.isArray(value)
    ? value
    : record !== null && Array.isArray(record.capabilities)
      ? record.capabilities
      : null;
  if (candidates === null || candidates.length === 0) return undefined;
  const capabilities = candidates.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const object = candidate as Record<string, unknown>;
    const id = asString(object.id) ?? asString(object.name);
    const description = asString(object.description);
    const inputSchema = object.inputSchema;
    const outputSchema = object.outputSchema;
    const requiredProtocols = object.requiredProtocols;
    const allowedActions = object.allowedActions;
    const maxTaskBounds = object.maxTaskBounds;
    if (
      id === undefined ||
      description === undefined ||
      typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema) ||
      typeof outputSchema !== "object" || outputSchema === null || Array.isArray(outputSchema) ||
      (requiredProtocols !== undefined && (!Array.isArray(requiredProtocols) || requiredProtocols.some((item) => typeof item !== "string"))) ||
      (allowedActions !== undefined && (!Array.isArray(allowedActions) || allowedActions.some((item) => typeof item !== "string"))) ||
      (maxTaskBounds !== undefined && (typeof maxTaskBounds !== "object" || maxTaskBounds === null || Array.isArray(maxTaskBounds)))
    ) return null;
    return {
      id,
      description,
      inputSchema,
      outputSchema,
      requiredProtocols: requiredProtocols === undefined ? [] : requiredProtocols,
      allowedActions: allowedActions === undefined ? [] : allowedActions,
      ...(maxTaskBounds === undefined ? {} : { maxTaskBounds })
    };
  });
  if (capabilities.some((capability) => capability === null)) return undefined;
  const schemaVersion = record === null || record.schemaVersion === undefined
    ? "8004scan-capabilities-v1"
    : asString(record.schemaVersion);
  if (schemaVersion === undefined) return undefined;
  return { schemaVersion, capabilities };
}

/** Strict mapper for the reviewed `AgentSummary` response shape. */
export function mapOfficialEightHundredFourScanCandidate(raw: unknown): MappedEightHundredFourScanCandidate {
  const parsed = officialAgentSummarySchema.safeParse(raw);
  if (!parsed.success) return mapCanonicalScanCandidate(raw);
  const value = parsed.data;
  if (value.chain_type !== undefined && value.chain_type.toLowerCase() !== "evm") throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan candidate is not an EVM identity.", "review_scan_mapper");
  const rawComposite = asString(value.agent_id);
  const composite = rawComposite === undefined ? null : parseCompositeAgentId(rawComposite);
  if (rawComposite !== undefined && composite === null) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan identity tuple is malformed.", "review_scan_mapper");
  const chainId = composite?.chainId ?? value.chain_id;
  let registry: string;
  try {
    registry = normalizeEvmAddress(composite?.registry ?? value.contract_address);
  } catch (cause) {
    throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan registry address is invalid.", "review_scan_mapper", cause);
  }
  const agentId = numericAgentId(value.token_id) ?? composite?.agentId;
  if (agentId === undefined || (composite !== null && composite.chainId !== value.chain_id) || (composite !== null && composite.registry !== registry)) throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan identity tuple is inconsistent.", "review_scan_mapper");
  let identity: ReturnType<typeof normalizeErc8004Identity>;
  try {
    identity = normalizeErc8004Identity({ namespace: "eip155", chainId, identityRegistry: registry, agentId });
  } catch (cause) {
    throw ingestionError("SCAN_CONTRACT_INVALID", "The 8004scan identity tuple is invalid.", "review_scan_mapper", cause);
  }
  const supportedProtocols = (value.supported_protocols ?? []).filter((item) => item.trim().length > 0).slice(0, 64);
  const metadata: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries({ name: value.name, description: value.description, image_url: value.image_url, tags: value.tags, categories: value.categories, supported_protocols: supportedProtocols, x402_supported: value.x402_supported, agent_wallet: value.agent_wallet, created_at: value.created_at, updated_at: value.updated_at })) {
    if (candidate !== undefined && candidate !== null) metadata[key] = candidate;
  }
  const services = normalizeOfficialServices(value.services);
  const capabilityManifest = normalizeOfficialCapabilities(value.capability_manifest ?? value.capabilities);
  const observedAt = officialTimestamp(value.updated_at ?? value.created_at);
  const safeDigestInput = { identity, metadata, services, ...(capabilityManifest === undefined ? {} : { capabilityManifest }) };
  assertSafePublicValue(safeDigestInput, "8004scanCandidate");
  return {
    identity,
    sourceReference: `agent:${identity.chainId}:${identity.identityRegistry}:${identity.agentId}`,
    ...(observedAt === undefined ? {} : { observedAt }),
    rawResponseDigest: canonicalSha256Hex(safeDigestInput),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    ...(services.length === 0 ? {} : { services }),
    ...(capabilityManifest === undefined ? {} : { capabilityManifest })
  };
}

export function createEightHundredFourScanAdapter(
  client: EightHundredFourScanClient,
  mapper: EightHundredFourScanMapper = mapOfficialEightHundredFourScanCandidate,
  normalizedIngestionVersion = "8004scan-openapi-0.4.363-v1"
): EightHundredFourScanAdapter {
  return new EightHundredFourScanAdapter(client, mapper, normalizedIngestionVersion);
}

export class EightHundredFourScanAdapter {
  public constructor(private readonly client: EightHundredFourScanClient, private readonly mapper: EightHundredFourScanMapper, private readonly normalizedIngestionVersion: string) {}

  async fetchPage(query: EightHundredFourScanQuery = {}): Promise<{ readonly candidates: readonly IdentityCandidate[]; readonly nextCursor: string | null; readonly nextOffset: number | null; readonly total: number | null }> {
    const page = await this.client.listCandidates(query);
    if (!Array.isArray(page.items) || page.items.length > (query.limit ?? officialEightHundredFourScanContract.maxPageSize)) throw ingestionError("INGESTION_INPUT_INVALID", "The 8004scan response has no bounded candidate list.", "retry_scan");
    const candidates = page.items.map((raw) => {
      const mapped = this.mapper(raw);
      return normalizeCandidate({
        identity: normalizeIdentity(mapped.identity),
        source: "8004scan",
        sourceReference: normalizeSourceReference(mapped.sourceReference),
        observedAt: mapped.observedAt ?? new Date(),
        normalizedIngestionVersion: this.normalizedIngestionVersion,
        ...(mapped.rawResponseDigest === undefined ? {} : { rawResponseDigest: mapped.rawResponseDigest as string }),
        ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
        ...(mapped.services === undefined ? {} : { services: mapped.services }),
        ...(mapped.capabilityManifest === undefined ? {} : { capabilityManifest: mapped.capabilityManifest })
      });
    });
    return {
      candidates,
      nextCursor: page.nextCursor ?? (page.nextOffset === null || page.nextOffset === undefined ? null : String(page.nextOffset)),
      nextOffset: page.nextOffset ?? (page.nextCursor !== null && page.nextCursor !== undefined && /^[0-9]+$/u.test(page.nextCursor) ? Number(page.nextCursor) : null),
      total: page.total ?? null
    };
  }

  async *iterate(query: EightHundredFourScanQuery = {}): AsyncGenerator<IdentityCandidate, void, void> {
    let offset = query.offset ?? (query.cursor === undefined ? undefined : Number(query.cursor));
    let first = true;
    do {
      const pageQuery: EightHundredFourScanQuery = {
        ...query,
        ...(offset === undefined ? {} : { offset })
      };
      if (!first) delete (pageQuery as { cursor?: string }).cursor;
      const page = await this.fetchPage(pageQuery);
      for (const candidate of page.candidates) yield candidate;
      first = false;
      offset = page.nextOffset ?? undefined;
    } while (offset !== undefined);
  }

  /** Stable key used by ingestion callers for idempotent page replay. */
  static candidateIdentityKey(candidate: IdentityCandidate): IdentityKey {
    return [candidate.identity.namespace, candidate.identity.chainId, candidate.identity.identityRegistry, candidate.identity.agentId].join(":");
  }
}
