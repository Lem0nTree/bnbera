import type { RuntimeConfig, RuntimeEmbeddingConfig } from "@bnbera/config";
import { ingestionError } from "../errors.js";
import { validateEmbeddingProvider, type EmbeddingProvider } from "../semantic.js";

const defaultEndpoint = "https://openrouter.ai/api/v1/embeddings";
const defaultTimeoutMs = 20_000;
const defaultMaxRetries = 2;
const defaultMaxBatchSize = 16;
const defaultMaxInputCharacters = 32_000;
const defaultMaxResponseBytes = 8 * 1024 * 1024;
const defaultBackoffMs = 250;
const maximumBackoffMs = 8_000;
const maximumDocuments = 1_024;

type FetchLike = typeof fetch;

export type EmbeddingSecretResolver = (
  reference: string
) => string | undefined | Promise<string | undefined>;

export type OpenRouterEmbeddingProviderOptions = {
  readonly config: RuntimeEmbeddingConfig;
  /** Resolves only the configured secret reference; the value is never part of runtime config. */
  readonly resolveSecret: EmbeddingSecretResolver;
  readonly endpoint?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxBatchSize?: number;
  readonly maxInputCharacters?: number;
  readonly maxResponseBytes?: number;
  readonly backoffMs?: number;
  /** Injected in deterministic tests; production uses a bounded timer. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Injected in deterministic tests; production uses Math.random. */
  readonly random?: () => number;
  /** HTTP is rejected by default, even when a custom fetch implementation is supplied. */
  readonly allowInsecureEndpoint?: boolean;
  /** Optional OpenRouter application metadata. Authorization cannot be overridden. */
  readonly headers?: Readonly<Record<string, string>>;
};

type EmbeddingItem = {
  readonly index: number;
  readonly embedding: readonly number[];
};

type OpenRouterResponse = {
  readonly data: readonly EmbeddingItem[];
};

type ProviderFailureCode =
  | "EMBEDDING_AUTH_FAILED"
  | "EMBEDDING_RATE_LIMITED"
  | "EMBEDDING_TIMEOUT"
  | "EMBEDDING_RESPONSE_INVALID"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "EMBEDDING_PROVIDER_FAILED";

class OpenRouterRequestFailure extends Error {
  public constructor(
    public readonly failureCode: ProviderFailureCode,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null = null,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = "OpenRouterRequestFailure";
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw ingestionError(
      "EMBEDDING_CONFIG_INVALID",
      `The embedding ${field} is outside the supported bound.`,
      "fix_embedding_configuration"
    );
  }
  return resolved;
}

function boundedRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function validateEndpoint(value: string, allowInsecure: boolean): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding endpoint is invalid.", "fix_embedding_configuration");
  }
  if ((endpoint.protocol !== "https:" && !(allowInsecure && endpoint.protocol === "http:")) || endpoint.username !== "" || endpoint.password !== "") {
    throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding endpoint must be an HTTPS URL without credentials.", "fix_embedding_configuration");
  }
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/u, "");
}

function validateSecretReference(value: string): string {
  const reference = value.trim();
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reference)) {
    throw ingestionError("EMBEDDING_CONFIG_INVALID", "The embedding secret reference is invalid.", "fix_embedding_configuration");
  }
  return reference;
}

function validateInput(input: string, maxCharacters: number): string {
  if (typeof input !== "string" || input.trim().length === 0 || input.length > maxCharacters || /[\u0000-\u001f\u007f]/u.test(input)) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The semantic embedding input is invalid or too large.", "reduce_semantic_text");
  }
  return input;
}

function validateModelName(value: string): string {
  const model = value.trim();
  // OpenRouter model identifiers are provider/model labels. Restrict the
  // accepted alphabet so a malformed value cannot become a URL/header or
  // accidentally carry control data into a request body.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(model)) {
    throw ingestionError("EMBEDDING_CONFIG_INVALID", "The configured embedding model is invalid.", "fix_embedding_configuration");
  }
  return model;
}

function retryAfterMilliseconds(response: Response): number | null {
  const header = response.headers.get("retry-after")?.trim();
  if (header === undefined || header === "") return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(maximumBackoffMs, Math.round(seconds * 1_000));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524 || status === 529;
}

function statusFailure(response: Response): OpenRouterRequestFailure {
  const retryable = isRetryableStatus(response.status);
  if (response.status === 401 || response.status === 403) {
    return new OpenRouterRequestFailure("EMBEDDING_AUTH_FAILED", "The embedding provider rejected the configured credential.", false, null, response.status);
  }
  if (response.status === 429) {
    return new OpenRouterRequestFailure("EMBEDDING_RATE_LIMITED", "The embedding provider rate limit was reached.", true, retryAfterMilliseconds(response), response.status);
  }
  return new OpenRouterRequestFailure(
    "EMBEDDING_PROVIDER_FAILED",
    `The embedding provider returned HTTP ${response.status}.`,
    retryable,
    retryable ? retryAfterMilliseconds(response) : null,
    response.status
  );
}

function parseEmbeddingResponse(payload: unknown, expectedCount: number): OpenRouterResponse {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response is not an object.", false);
  }
  const data = (payload as { readonly data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an unexpected item count.", false);
  }
  const items: EmbeddingItem[] = [];
  const seen = new Set<number>();
  for (const item of data) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an invalid item.", false);
    }
    const rawIndex = (item as { readonly index?: unknown }).index;
    const index = typeof rawIndex === "number" ? rawIndex : Number.NaN;
    const embedding = (item as { readonly embedding?: unknown }).embedding;
    if (!Number.isSafeInteger(index) || index < 0 || index >= expectedCount || seen.has(index) || !Array.isArray(embedding) || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned an invalid vector item.", false);
    }
    seen.add(index);
    items.push({ index, embedding: embedding.map((value) => Object.is(value, -0) ? 0 : value) });
  }
  if (seen.size !== expectedCount) {
    throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response indexes are incomplete.", false);
  }
  return { data: items.sort((left, right) => left.index - right.index) };
}

function responseBodyLimit(response: Response, maximumBytes: number): void {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null) return;
  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > maximumBytes) {
    throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response is too large.", false);
  }
}

type ResponseBodyReader = {
  read(): Promise<{ readonly done: boolean; readonly value?: unknown }>;
  cancel?: () => Promise<unknown>;
};

type ResponseBodyWithReader = {
  getReader?: () => ResponseBodyReader;
};

/** Read response bytes without allowing a provider to allocate an unbounded body. */
async function readBoundedResponseBody(response: Response, maximumBytes: number): Promise<string> {
  const body = response.body as ResponseBodyWithReader | null;
  const getReader = body?.getReader;
  if (typeof getReader !== "function") {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response is too large.", false);
    }
    return text;
  }

  const reader = getReader.call(body);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response stream is invalid.", false);
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        try { await reader.cancel?.(); } catch { /* best effort */ }
        throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response is too large.", false);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof OpenRouterRequestFailure) throw error;
    throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response could not be read.", false);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Server-only OpenRouter adapter for the documented `/api/v1/embeddings`
 * contract. It intentionally uses native fetch so the browser cannot receive
 * or bundle a provider credential.
 */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  public readonly provider = "openrouter" as const;
  public readonly model: string;
  public readonly modelVersion: string;
  public readonly dimension: number;
  public readonly maxBatchSize: number;
  private readonly endpoint: string;
  private readonly resolveSecret: EmbeddingSecretResolver;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxInputCharacters: number;
  private readonly maxResponseBytes: number;
  private readonly backoffMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly secretReference: string;

  public constructor(options: OpenRouterEmbeddingProviderOptions) {
    if (options.config.provider !== "openrouter") {
      throw ingestionError("EMBEDDING_CONFIG_INVALID", "The configured embedding provider is unsupported.", "choose_supported_embedding_provider");
    }
    this.model = validateModelName(options.config.model);
    this.modelVersion = options.config.modelVersion.trim();
    this.dimension = options.config.dimension;
    if (this.modelVersion.length === 0 || this.modelVersion.length > 128 || /[\u0000-\u001f\u007f]/u.test(this.modelVersion)) {
      throw ingestionError("EMBEDDING_CONFIG_INVALID", "The configured embedding model version is invalid.", "fix_embedding_configuration");
    }
    if (!Number.isSafeInteger(this.dimension) || this.dimension < 1 || this.dimension > 16_384) {
      throw ingestionError("EMBEDDING_CONFIG_INVALID", "The configured embedding dimension is invalid.", "fix_embedding_configuration");
    }
    if (typeof options.resolveSecret !== "function") {
      throw ingestionError("EMBEDDING_CONFIG_INVALID", "An embedding secret resolver is required.", "configure_embedding_secret");
    }
    this.resolveSecret = options.resolveSecret;
    this.secretReference = validateSecretReference(options.config.secretReference);
    this.fetcher = options.fetch ?? fetch;
    this.endpoint = validateEndpoint(options.endpoint ?? defaultEndpoint, options.allowInsecureEndpoint === true);
    this.timeoutMs = boundedInteger(options.timeoutMs, defaultTimeoutMs, 1, 120_000, "timeout");
    this.maxRetries = boundedInteger(options.maxRetries, defaultMaxRetries, 0, 5, "retry count");
    this.maxBatchSize = boundedInteger(options.maxBatchSize, defaultMaxBatchSize, 1, 64, "batch size");
    this.maxInputCharacters = boundedInteger(options.maxInputCharacters, defaultMaxInputCharacters, 1, 128_000, "input length");
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, defaultMaxResponseBytes, 1, 64 * 1024 * 1024, "response size");
    this.backoffMs = boundedInteger(options.backoffMs, defaultBackoffMs, 0, maximumBackoffMs, "backoff");
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.headers = Object.freeze(Object.fromEntries(
      Object.entries(options.headers ?? {})
        .filter(([name]) => name.toLowerCase() !== "authorization")
    ));
    validateEmbeddingProvider(this);
  }

  public async embed(input: string): Promise<readonly number[]> {
    const vectors = await this.embedMany([input]);
    const vector = vectors[0];
    if (vector === undefined) {
      throw ingestionError("EMBEDDING_RESPONSE_INVALID", "The embedding provider returned no vector.", "retry_embedding");
    }
    return vector;
  }

  /** Generate bounded batches while preserving caller order. */
  public async embedMany(inputs: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > maximumDocuments) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The embedding batch is outside the supported bound.", "reduce_embedding_batch");
    }
    const normalized = inputs.map((input) => validateInput(input, this.maxInputCharacters));
    const output: Array<readonly number[]> = [];
    for (let offset = 0; offset < normalized.length; offset += this.maxBatchSize) {
      const batch = normalized.slice(offset, offset + this.maxBatchSize);
      const result = await this.requestBatch(batch);
      output.push(...result);
    }
    return output;
  }

  private async requestBatch(inputs: readonly string[]): Promise<readonly (readonly number[])[]> {
    let secret: string | undefined;
    try {
      secret = await this.resolveSecret(this.secretReference);
    } catch {
      // A secret manager error must not cross the provider boundary because
      // some SDKs include request material in their diagnostic message.
      throw ingestionError("EMBEDDING_AUTH_FAILED", "The embedding provider secret could not be resolved.", "configure_embedding_secret");
    }
    if (typeof secret !== "string" || secret.trim().length === 0) {
      throw ingestionError("EMBEDDING_AUTH_FAILED", "The embedding provider secret is not configured.", "configure_embedding_secret");
    }
    // The key is scoped to this request and is never included in an error,
    // diagnostic, response, or persisted record.
    const authorization = `Bearer ${secret.trim()}`;
    let lastFailure: OpenRouterRequestFailure | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.performRequest(inputs, authorization);
      } catch (error) {
        const failure = error instanceof OpenRouterRequestFailure
          ? error
          : new OpenRouterRequestFailure("EMBEDDING_PROVIDER_FAILED", "The embedding provider request failed.", true);
        lastFailure = failure;
        if (!failure.retryable || attempt >= this.maxRetries) break;
        const exponential = Math.min(maximumBackoffMs, this.backoffMs * (2 ** attempt));
        const jitter = Math.round(exponential * 0.25 * boundedRatio(this.random()));
        const delay = Math.min(maximumBackoffMs, failure.retryAfterMs ?? exponential + jitter);
        if (delay > 0) await this.sleep(delay);
      }
    }
    const failure = lastFailure ?? new OpenRouterRequestFailure("EMBEDDING_PROVIDER_FAILED", "The embedding provider request failed.", true);
    throw ingestionError(failure.failureCode, failure.message, failure.failureCode === "EMBEDDING_AUTH_FAILED" ? "configure_embedding_secret" : "retry_embedding", undefined, failure.retryable);
  }

  private async performRequest(inputs: readonly string[], authorization: string): Promise<readonly (readonly number[])[]> {
    const controller = new AbortController();
    let timedOut = false;
    let rejectTimeout: ((reason: OpenRouterRequestFailure) => void) | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectTimeout?.(new OpenRouterRequestFailure("EMBEDDING_TIMEOUT", "The embedding provider request timed out.", true));
    }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await Promise.race([
          this.fetcher(this.endpoint, {
            method: "POST",
            headers: {
              ...this.headers,
              Authorization: authorization,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              input: inputs.length === 1 ? inputs[0] : inputs,
              model: this.model,
              dimensions: this.dimension
            }),
            signal: controller.signal
          }),
          timeoutPromise
        ]);
      } catch {
        if (timedOut) {
          throw new OpenRouterRequestFailure("EMBEDDING_TIMEOUT", "The embedding provider request timed out.", true);
        }
        // Do not retain or expose arbitrary fetch errors: custom transports
        // can accidentally include request headers in their error text.
        throw new OpenRouterRequestFailure("EMBEDDING_PROVIDER_FAILED", "The embedding provider request failed.", true);
      }
      if (timedOut) throw new OpenRouterRequestFailure("EMBEDDING_TIMEOUT", "The embedding provider request timed out.", true);
      if (!response.ok) throw statusFailure(response);
      responseBodyLimit(response, this.maxResponseBytes);
      let body: string;
      try {
        body = await Promise.race([readBoundedResponseBody(response, this.maxResponseBytes), timeoutPromise]);
      } catch {
        if (timedOut) {
          throw new OpenRouterRequestFailure("EMBEDDING_TIMEOUT", "The embedding provider request timed out.", true);
        }
        throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response could not be read.", false);
      }
      if (timedOut) throw new OpenRouterRequestFailure("EMBEDDING_TIMEOUT", "The embedding provider request timed out.", true);
      let payload: unknown;
      try {
        payload = JSON.parse(body) as unknown;
      } catch {
        throw new OpenRouterRequestFailure("EMBEDDING_RESPONSE_INVALID", "The embedding provider response is not valid JSON.", false);
      }
      const parsed = parseEmbeddingResponse(payload, inputs.length);
      const vectors = parsed.data.map((item) => item.embedding);
      for (const vector of vectors) {
        if (vector.length !== this.dimension) {
          throw new OpenRouterRequestFailure("EMBEDDING_DIMENSION_MISMATCH", "The embedding provider returned an incompatible vector dimension.", false);
        }
      }
      return vectors;
    } catch (error) {
      if (error instanceof OpenRouterRequestFailure) {
        throw error;
      }
      throw new OpenRouterRequestFailure("EMBEDDING_PROVIDER_FAILED", "The embedding provider request failed.", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Construct the selected provider without putting a secret into RuntimeConfig. */
export function createOpenRouterEmbeddingProvider(
  options: OpenRouterEmbeddingProviderOptions
): OpenRouterEmbeddingProvider {
  return new OpenRouterEmbeddingProvider(options);
}

/** Convenience server helper; it reads only the named secret reference. */
export function createOpenRouterEmbeddingProviderFromEnvironment(
  config: RuntimeEmbeddingConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: Omit<OpenRouterEmbeddingProviderOptions, "config" | "resolveSecret"> = {}
): OpenRouterEmbeddingProvider {
  return new OpenRouterEmbeddingProvider({
    ...options,
    config,
    resolveSecret: (reference) => env[reference]
  });
}

/**
 * Provider selection boundary used by server jobs and E2E harnesses. Runtime
 * configuration carries only the secret reference; callers supply a resolver
 * backed by their server-side secret manager.
 */
export function createEmbeddingProviderFromRuntimeConfig(
  runtimeConfig: RuntimeConfig,
  resolveSecret: EmbeddingSecretResolver,
  options: Omit<OpenRouterEmbeddingProviderOptions, "config" | "resolveSecret"> = {}
): OpenRouterEmbeddingProvider {
  if (runtimeConfig.embedding === null) {
    throw ingestionError("EMBEDDING_CONFIG_INVALID", "Semantic embedding configuration is not enabled.", "configure_embedding_configuration");
  }
  return new OpenRouterEmbeddingProvider({
    ...options,
    config: runtimeConfig.embedding,
    resolveSecret
  });
}
