import { Buffer } from "node:buffer";
import { AppError } from "@bnbera/config";
import {
  canonicalSha256Hex,
  serviceValidationStatusSchema,
  type ServiceKind,
  type ServiceValidationStatus
} from "@bnbera/domain";
import { ingestionError, type IngestionErrorCode } from "./errors.js";
import {
  resolveSafePublicNetworkTarget,
  type MetadataResolverOptions
} from "./metadata.js";
import { assertSafePublicValue } from "./normalize.js";
import type {
  IngestionRepository,
  ServiceObservation,
  ServiceProbeRecord
} from "./types.js";

type ProbeValidationStatus = Extract<ServiceValidationStatus, "healthy" | "unhealthy" | "rejected">;

export type ServiceProbeTransportInput = {
  readonly url: string;
  /** The explicit service kind is used for protocol validation. */
  readonly kind?: ServiceKind;
  /** Provider-declared protocol version; never guessed or used as a credential. */
  readonly protocolVersion?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly signal?: AbortSignal;
};

export type ServiceProbeTransportResponse = {
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly contentType?: string | null;
  /** A bounded, allow-listed summary; the response body is never persisted. */
  readonly safeCapabilityProbe?: Readonly<Record<string, unknown>>;
  readonly redirected?: boolean;
  /** Protocol validation can override an HTTP 2xx status (for example ready=false). */
  readonly contractStatus?: ProbeValidationStatus;
  /** Stable, non-sensitive reason code for a degraded/rejected probe. */
  readonly errorCode?: string | null;
};

/**
 * Transport is supplied by the runtime so DNS, timeout, redirect, SSRF, and
 * response-size policy can be enforced in one infrastructure boundary. This
 * package never appends `/health`, `/a2a`, or `/apex` to an advertised URL.
 */
export interface ServiceProbeTransport {
  probe(input: ServiceProbeTransportInput): Promise<ServiceProbeTransportResponse>;
}

export type ServiceProbeOptions = {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
};

export type HttpServiceProbeTransportOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: MetadataResolverOptions["lookup"];
  /** Test-only escape hatch. Production callers must leave this false. */
  readonly allowPrivateAddresses?: boolean;
  /** Test/local-only escape hatch; production service probes require HTTPS. */
  readonly allowInsecureHttp?: boolean;
  readonly maxRedirects?: number;
};

export type ServiceProbeBatchOptions = {
  /** Maximum in-flight requests. Defaults to two to isolate upstream services. */
  readonly maxConcurrency?: number;
  /** Minimum delay between request starts, across all workers. */
  readonly minIntervalMs?: number;
  /** Maximum number of services to attempt in this run. */
  readonly maxServices?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
};

const jsonContentType = /^(?:application\/json|application\/ld\+json|text\/json|application\/[^;]+\+json)$/iu;
const sseContentType = /^text\/event-stream$/iu;
const controlPattern = /[\u0000-\u001f\u007f]/u;
const credentialQueryKey = /(?:api[_-]?key|access[_-]?token|authorization|credential|password|private[_-]?key|secret|token)/iu;
const serviceUrlLength = 2_048;
const safeSummaryArrayLimit = 32;

function normalizedContentType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function publicString(value: unknown, maximum = 256): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    ? value.trim()
    : null;
}

function publicStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) => publicString(entry, 128));
  if (normalized.length > safeSummaryArrayLimit || normalized.some((entry) => entry === null)) return null;
  return [...new Set(normalized.filter((entry): entry is string => entry !== null))];
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function protocolError(
  code: IngestionErrorCode,
  message: string,
  nextAction: string,
  retriable = false
): AppError {
  return ingestionError(code, message, nextAction, undefined, retriable);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return "SERVICE_TRANSPORT_FAILED";
}

function normalizeNetworkError(error: unknown): AppError {
  if (error instanceof AppError) {
    if (error.code === "METADATA_URI_INVALID") {
      return ingestionError("SERVICE_URL_INVALID", "The advertised service URL is invalid.", "review_service", error);
    }
    if (error.code === "METADATA_SSRF_BLOCKED") {
      return ingestionError("SERVICE_SSRF_BLOCKED", "The advertised service target is not a public network address.", "review_service_host", error);
    }
    if (error.code === "METADATA_FETCH_FAILED") {
      return ingestionError("SERVICE_DNS_LOOKUP_FAILED", "The advertised service host could not be resolved safely.", "retry_probe", error, true);
    }
    return error;
  }
  return ingestionError("SERVICE_DNS_LOOKUP_FAILED", "The advertised service host could not be resolved safely.", "retry_probe", error, true);
}

function sameAddressSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((address, index) => address === right[index]);
}

async function resolveServiceTarget(
  value: string,
  options: {
    readonly lookup?: MetadataResolverOptions["lookup"];
    readonly allowPrivateAddresses: boolean;
    readonly allowInsecureHttp: boolean;
  },
  timeoutMs: number
): Promise<Awaited<ReturnType<typeof resolveSafePublicNetworkTarget>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookupPromise = resolveSafePublicNetworkTarget(value, {
      ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
      allowPrivateAddresses: options.allowPrivateAddresses
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(protocolError("SERVICE_PROBE_TIMEOUT", "The service DNS check timed out.", "retry_probe", true)), timeoutMs);
    });
    const target = await Promise.race([lookupPromise, timeoutPromise]);
    if (target.url.protocol !== "https:" && !(options.allowInsecureHttp && target.url.protocol === "http:")) {
      throw protocolError("SERVICE_HTTPS_REQUIRED", "The advertised service must use HTTPS for live probing.", "review_service_transport");
    }
    return target;
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "SERVICE_PROBE_TIMEOUT" || error.code === "SERVICE_HTTPS_REQUIRED") throw error;
      throw normalizeNetworkError(error);
    }
    throw normalizeNetworkError(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response body is untrusted and cancellation is best effort only.
  }
}

async function readBoundedBody(response: Response, maxResponseBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/u.test(contentLength)) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service response length is invalid.", "repair_service_response");
    }
    if (Number(contentLength) > maxResponseBytes) {
      throw protocolError("SERVICE_RESPONSE_TOO_LARGE", "The service probe response exceeds the configured size limit.", "reduce_probe_response");
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value === undefined) continue;
      const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
      total += chunk.byteLength;
      if (total > maxResponseBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw protocolError("SERVICE_RESPONSE_TOO_LARGE", "The service probe response exceeds the configured size limit.", "reduce_probe_response");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw protocolError("SERVICE_PROBE_FAILED", "The service probe response could not be read.", "retry_probe", true);
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readJsonObject(
  response: Response,
  maxResponseBytes: number,
  invalidCode: IngestionErrorCode
): Promise<Record<string, unknown>> {
  const contentType = normalizedContentType(response.headers.get("content-type"));
  if (!jsonContentType.test(contentType)) {
    throw protocolError("SERVICE_MIME_UNSUPPORTED", "The service response MIME type is not approved JSON.", "serve_protocol_json");
  }
  const bytes = await readBoundedBody(response, maxResponseBytes);
  if (bytes.byteLength === 0) throw protocolError(invalidCode, "The service returned no protocol evidence.", "repair_service_contract");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw protocolError(invalidCode, "The service returned invalid JSON protocol evidence.", "repair_service_contract");
  }
  try {
    assertSafePublicValue(body, "serviceProbe");
  } catch {
    throw protocolError(invalidCode, "The service protocol evidence is too large or contains unsafe fields.", "repair_service_contract");
  }
  const object = plainObject(body);
  if (object === null) throw protocolError(invalidCode, "The service protocol evidence must be a JSON object.", "repair_service_contract");
  return object;
}

function assertEmbeddedServiceUrl(value: unknown, allowInsecureHttp: boolean, code: IngestionErrorCode): URL {
  const text = publicString(value, serviceUrlLength);
  if (text === null) throw protocolError(code, "The protocol card contains an invalid service URL.", "repair_service_contract");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw protocolError(code, "The protocol card contains an invalid service URL.", "repair_service_contract");
  }
  if ((url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) || url.username !== "" || url.password !== "" || url.hash !== "" || controlPattern.test(text)) {
    throw protocolError(code, "The protocol card contains an unsafe service URL.", "repair_service_contract");
  }
  for (const key of url.searchParams.keys()) {
    if (credentialQueryKey.test(key)) throw protocolError(code, "The protocol card contains a credential-bearing service URL.", "repair_service_contract");
  }
  return url;
}

function validateA2AAgentCard(
  body: Record<string, unknown>,
  service: ServiceProbeTransportInput,
  allowInsecureHttp: boolean
): Readonly<Record<string, unknown>> {
  const name = publicString(body.name, 160);
  const description = publicString(body.description, 2_000);
  const version = publicString(body.version, 128);
  if (name === null || description === null || version === null) {
    throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A response is missing required Agent Card identity fields.", "repair_agent_card");
  }

  const interfaces = body.supportedInterfaces;
  let interfaceCount = 0;
  let interfaceProtocolVersion: string | null = null;
  const invocationUrls: string[] = [];
  if (interfaces !== undefined) {
    if (!Array.isArray(interfaces) || interfaces.length === 0 || interfaces.length > safeSummaryArrayLimit) {
      throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card has no valid supported interface.", "repair_agent_card");
    }
    for (const entry of interfaces) {
      const value = plainObject(entry);
      if (value === null) throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card interface is invalid.", "repair_agent_card");
      const invocationUrl = assertEmbeddedServiceUrl(value.url, allowInsecureHttp, "SERVICE_A2A_AGENT_CARD_INVALID");
      invocationUrls.push(invocationUrl.toString());
      if (publicString(value.protocolBinding, 128) === null || publicString(value.protocolVersion, 64) === null) {
        throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card interface is missing its protocol binding or version.", "repair_agent_card");
      }
      interfaceCount += 1;
      interfaceProtocolVersion ??= publicString(value.protocolVersion, 64);
    }
  } else {
    // A2A 0.3 cards used `url`/`preferredTransport`; accept this documented
    // legacy shape but keep the compatibility fact in the safe summary.
    const invocationUrl = assertEmbeddedServiceUrl(body.url, allowInsecureHttp, "SERVICE_A2A_AGENT_CARD_INVALID");
    invocationUrls.push(invocationUrl.toString());
    if (publicString(body.preferredTransport, 128) === null && publicString(service.protocolVersion, 64) === null) {
      throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The legacy A2A Agent Card has no transport declaration.", "repair_agent_card");
    }
    interfaceCount = 1;
  }

  if (plainObject(body.capabilities) === null || !Array.isArray(body.skills)) {
    throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card is missing capabilities or skills.", "repair_agent_card");
  }
  if (body.skills.length > safeSummaryArrayLimit) {
    throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card has too many skills.", "reduce_agent_card");
  }
  const skillSummaries: Readonly<Record<string, unknown>>[] = [];
  for (const skill of body.skills) {
    const value = plainObject(skill);
    const rawTags = value?.tags;
    const rawKeywords = value?.keywords;
    if (
      value === null ||
      publicString(value.id, 160) === null ||
      publicString(value.name, 160) === null ||
      publicString(value.description, 2_000) === null ||
      !Array.isArray(rawTags) ||
      (rawKeywords !== undefined && !Array.isArray(rawKeywords))
    ) {
      throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card contains an invalid skill.", "repair_agent_card");
    }
    const tags = publicStringList(rawTags);
    const keywords = rawKeywords === undefined ? [] : publicStringList(rawKeywords);
    if (tags === null || keywords === null || tags.length + keywords.length > safeSummaryArrayLimit) {
      throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card contains invalid skill tags.", "repair_agent_card");
    }
    const inputModes = Array.isArray(value.inputModes) ? value.inputModes.map((mode) => publicString(mode, 128)) : [];
    const outputModes = Array.isArray(value.outputModes) ? value.outputModes.map((mode) => publicString(mode, 128)) : [];
    if (inputModes.length > safeSummaryArrayLimit || outputModes.length > safeSummaryArrayLimit || inputModes.some((mode) => mode === null) || outputModes.some((mode) => mode === null)) {
      throw protocolError("SERVICE_A2A_AGENT_CARD_INVALID", "The A2A Agent Card contains invalid skill modes.", "repair_agent_card");
    }
    skillSummaries.push({
      id: publicString(value.id, 160)!,
      name: publicString(value.name, 160)!,
      description: publicString(value.description, 2_000)!,
      tags,
      ...(rawKeywords === undefined ? {} : { keywords }),
      inputModes,
      outputModes
    });
  }

  const securitySchemes = plainObject(body.securitySchemes);
  const securityRequirements = Array.isArray(body.securityRequirements) ? body.securityRequirements : null;
  const securityRequired =
    (securityRequirements !== null && securityRequirements.length > 0) ||
    (securitySchemes !== null && Object.keys(securitySchemes).length > 0);
  const signatures = Array.isArray(body.signatures) ? body.signatures.length : 0;
  const protocolVersion = publicString(body.protocolVersion, 64) ?? interfaceProtocolVersion ?? publicString(service.protocolVersion, 64) ?? "unknown";
  return {
    protocol: "a2a",
    contract: "agent-card",
    valid: true,
    cardUrl: service.url,
    invocationUrls: [...new Set(invocationUrls)].slice(0, safeSummaryArrayLimit),
    capabilityEvidence: "advertised-only",
    agentCardDigest: canonicalSha256Hex(body),
    agentName: name,
    agentVersion: version,
    protocolVersion,
    interfaceCount,
    skillCount: body.skills.length,
    skills: skillSummaries,
    authenticationRequired: securityRequired,
    signatureCount: signatures,
    signatureValidation: signatures > 0 ? "not-performed" : "not-present"
  };
}

async function validateA2AInvocationTargets(
  summary: Readonly<Record<string, unknown>>,
  options: {
    readonly lookup?: MetadataResolverOptions["lookup"];
    readonly allowPrivateAddresses: boolean;
  }
): Promise<void> {
  const urls = Array.isArray(summary.invocationUrls)
    ? summary.invocationUrls.filter((value): value is string => typeof value === "string")
    : [];
  try {
    for (const url of urls) {
      await resolveSafePublicNetworkTarget(url, {
        ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
        allowPrivateAddresses: options.allowPrivateAddresses
      });
    }
  } catch (_cause) {
    throw protocolError(
      "SERVICE_A2A_AGENT_CARD_INVALID",
      "The A2A Agent Card contains a private or unsafe invocation target.",
      "repair_agent_card",
      false
    );
  }
}

function validateReadiness(
  body: Record<string, unknown>
): { readonly summary: Readonly<Record<string, unknown>>; readonly contractStatus?: ProbeValidationStatus; readonly errorCode?: IngestionErrorCode } {
  const rawStatus = publicString(body.status, 64)?.toLowerCase() ?? null;
  const rawReady = typeof body.ready === "boolean" ? body.ready : typeof body.readyz === "boolean" ? body.readyz : typeof body.ok === "boolean" ? body.ok : typeof body.healthy === "boolean" ? body.healthy : null;
  const positiveStatuses = new Set(["ok", "ready", "healthy", "live", "up", "running", "pass", "passing"]);
  const negativeStatuses = new Set(["not_ready", "not-ready", "unhealthy", "degraded", "down", "failed", "fail", "failing"]);
  const ready = rawReady ?? (rawStatus === null ? null : positiveStatuses.has(rawStatus) ? true : negativeStatuses.has(rawStatus) ? false : null);
  if (ready === null) {
    throw protocolError("SERVICE_READINESS_INVALID", "The readiness response does not expose a recognized ready status.", "repair_readiness_contract");
  }
  const summary: Readonly<Record<string, unknown>> = {
    protocol: "readiness",
    contract: "bnbera-reference-readiness-v1",
    valid: true,
    ready,
    ...(rawStatus === null ? {} : { status: rawStatus })
  };
  if (!ready) return { summary, contractStatus: "unhealthy", errorCode: "SERVICE_READINESS_NOT_READY" };
  return { summary };
}

function validateAdapter(body: Record<string, unknown>): Readonly<Record<string, unknown>> {
  // A marker-only object is not useful service evidence: arbitrary JSON often
  // contains one of these keys. Accept a vendor-neutral, reviewed shape with
  // an explicit protocol and structured advertised capabilities, without
  // requiring agents to invent a BNBEra-specific manifest.
  const protocol = publicString(body.protocol, 128);
  const capabilities = body.capabilities;
  if (protocol === null || !Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > safeSummaryArrayLimit) {
    throw protocolError("SERVICE_ADAPTER_CONTRACT_INVALID", "The reviewed adapter response must expose a protocol and structured advertised capabilities.", "repair_service_contract");
  }
  const capabilityIds: string[] = [];
  for (const capability of capabilities) {
    const value = plainObject(capability);
    const id = publicString(value?.id ?? value?.name, 160);
    const description = publicString(value?.description, 2_000);
    if (value === null || id === null || description === null) {
      throw protocolError("SERVICE_ADAPTER_CONTRACT_INVALID", "The reviewed adapter capabilities must include an id or name and description.", "repair_service_contract");
    }
    capabilityIds.push(id);
  }
  return {
    protocol: "adapter",
    contract: "reviewed-adapter-json-v1",
    valid: true,
    advertisedProtocol: protocol,
    capabilityEvidence: "advertised-only",
    capabilityCount: capabilityIds.length,
    capabilityIds,
    bodyDigest: canonicalSha256Hex(body)
  };
}

function decodeBase64Json(value: string, maxResponseBytes: number): unknown {
  const encoded = value.trim();
  if (encoded.length === 0 || encoded.length > Math.min(maxResponseBytes, 64 * 1024) || !/^[a-z0-9+/]*={0,2}$/iu.test(encoded) || encoded.replace(/=/gu, "").length % 4 === 1) {
    throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge encoding is invalid.", "repair_x402_challenge");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge encoding is invalid.", "repair_x402_challenge");
  }
  if (bytes.byteLength > maxResponseBytes) throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge exceeds the configured size limit.", "reduce_x402_challenge");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge is not valid JSON.", "repair_x402_challenge");
  }
}

function validateX402Challenge(
  body: Record<string, unknown> | null,
  paymentRequiredHeader: string | null,
  maxResponseBytes: number
): Readonly<Record<string, unknown>> {
  const headerValue = paymentRequiredHeader === null ? null : decodeBase64Json(paymentRequiredHeader, maxResponseBytes);
  const candidate = headerValue ?? body;
  const object = plainObject(candidate);
  if (object === null) throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 response has no payment requirements object.", "repair_x402_challenge");
  try { assertSafePublicValue(object, "x402Challenge"); } catch { throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge contains unsafe fields.", "repair_x402_challenge"); }
  const version = object.x402Version;
  const accepts = object.accepts;
  if ((version !== 1 && version !== 2) || !Array.isArray(accepts) || accepts.length === 0 || accepts.length > safeSummaryArrayLimit) {
    throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment challenge does not match its public contract.", "repair_x402_challenge");
  }
  const networks = new Set<string>();
  for (const requirement of accepts) {
    const value = plainObject(requirement);
    if (value === null || publicString(value.scheme, 64) === null || publicString(value.network, 128) === null || publicString(value.amount ?? value.maxAmountRequired ?? value.maxAmount, 128) === null) {
      throw protocolError("SERVICE_X402_CHALLENGE_INVALID", "The x402 payment requirement is incomplete.", "repair_x402_challenge");
    }
    networks.add(publicString(value.network, 128)!);
  }
  return {
    protocol: "x402",
    contract: "payment-required-v1-or-v2",
    valid: true,
    challengeSource: headerValue === null ? "json-body" : "payment-required-header",
    x402Version: version,
    acceptedMethods: accepts.length,
    networks: [...networks].sort().slice(0, safeSummaryArrayLimit)
  };
}

function httpFailureCode(statusCode: number): IngestionErrorCode {
  if (statusCode === 401 || statusCode === 403) return "SERVICE_AUTH_REQUIRED";
  if (statusCode === 404) return "SERVICE_ENDPOINT_NOT_FOUND";
  if (statusCode === 408 || statusCode === 504) return "SERVICE_PROBE_TIMEOUT";
  if (statusCode === 429) return "SERVICE_RATE_LIMITED";
  if (statusCode >= 500) return "SERVICE_UPSTREAM_UNAVAILABLE";
  return "SERVICE_STATUS_NOT_HEALTHY";
}

function validateTransportInput(input: ServiceProbeTransportInput): void {
  if (typeof input.url !== "string" || input.url.length === 0 || input.url.length > serviceUrlLength || controlPattern.test(input.url)) {
    throw protocolError("SERVICE_URL_INVALID", "The advertised service URL is invalid.", "review_service");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 30_000) {
    throw protocolError("SERVICE_PROBE_FAILED", "The service probe timeout is invalid.", "fix_probe_policy");
  }
  if (!Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes <= 0 || input.maxResponseBytes > 1_048_576) {
    throw protocolError("SERVICE_PROBE_FAILED", "The service probe response limit is invalid.", "fix_probe_policy");
  }
}

/**
 * Safe GET transport for advertised services. It probes the URL as supplied,
 * follows only explicitly bounded HTTPS redirects, validates each protocol's
 * read-only contract, and never sends JSON-RPC, payment, or tool messages.
 */
export class HttpServiceProbeTransport implements ServiceProbeTransport {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly lookup: HttpServiceProbeTransportOptions["lookup"];
  private readonly allowPrivateAddresses: boolean;
  private readonly allowInsecureHttp: boolean;
  private readonly maxRedirects: number;

  public constructor(options: HttpServiceProbeTransportOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.lookup = options.lookup;
    this.allowPrivateAddresses = options.allowPrivateAddresses === true;
    this.allowInsecureHttp = options.allowInsecureHttp === true;
    this.maxRedirects = options.maxRedirects ?? 0;
    if (!Number.isSafeInteger(this.maxRedirects) || this.maxRedirects < 0 || this.maxRedirects > 3) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service probe redirect limit is invalid.", "fix_probe_policy");
    }
  }

  public async probe(input: ServiceProbeTransportInput): Promise<ServiceProbeTransportResponse> {
    validateTransportInput(input);
    const kind = input.kind ?? "adapter";
    if (kind === "mpp") {
      throw protocolError("SERVICE_PROTOCOL_UNSUPPORTED", "MPP probing is disabled until a reviewed read-only contract is pinned.", "review_service_protocol");
    }
    const targetOptions = {
      lookup: this.lookup,
      allowPrivateAddresses: this.allowPrivateAddresses,
      allowInsecureHttp: this.allowInsecureHttp
    } as const;
    let target = await resolveServiceTarget(input.url, targetOptions, input.timeoutMs);
    let current = target.url;
    let redirects = 0;
    while (true) {
      if (input.signal?.aborted === true) throw protocolError("SERVICE_PROBE_CANCELLED", "The service probe was cancelled.", "resume_probe");
      const controller = new AbortController();
      const abortFromExternal = (): void => controller.abort();
      if (input.signal !== undefined) input.signal.addEventListener("abort", abortFromExternal, { once: true });
      const started = Date.now();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      let response: Response;
      try {
        const accept = kind === "mcp"
          ? "text/event-stream"
          : kind === "a2a"
            ? "application/a2a+json, application/json;q=0.9"
            : "application/json";
        response = await this.fetcher(current.toString(), {
          method: "GET",
          headers: { accept, "accept-encoding": "identity" },
          redirect: "manual",
          signal: controller.signal
        });
      } catch (cause) {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abortFromExternal);
        const timeout = cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
        throw ingestionError(timeout ? "SERVICE_PROBE_TIMEOUT" : "SERVICE_PROBE_FAILED", timeout ? "The service probe timed out." : "The advertised service could not be reached.", "retry_probe", cause, true);
      }
      const latencyMs = Math.max(0, Date.now() - started);
      try {
        // Fetch may resolve DNS independently of the preflight lookup. A
        // second lookup catches private-target rebinding and address-set
        // changes before any response is accepted as service evidence.
        const afterTarget = await resolveServiceTarget(current.toString(), targetOptions, input.timeoutMs);
        if (current.hostname.toLowerCase() === afterTarget.url.hostname.toLowerCase() && !sameAddressSet(target.addresses, afterTarget.addresses)) {
          throw protocolError("SERVICE_DNS_REBINDING", "The service DNS answer changed during the probe.", "review_service_dns");
        }

        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400) {
          await cancelBody(response);
          if (location === null || redirects >= this.maxRedirects) {
            return { statusCode: response.status, latencyMs, redirected: true, errorCode: "SERVICE_REDIRECT_BLOCKED", contractStatus: "rejected" };
          }
          let next: URL;
          try {
            next = new URL(location, current);
          } catch (cause) {
            throw ingestionError("SERVICE_REDIRECT_BLOCKED", "The service redirect target is invalid.", "review_service_redirect", cause);
          }
          if (next.protocol !== current.protocol || next.username !== "" || next.password !== "" || next.hash !== "") {
            throw protocolError("SERVICE_REDIRECT_BLOCKED", "The service redirect target is not allowed.", "review_service_redirect");
          }
          target = await resolveServiceTarget(next.toString(), targetOptions, input.timeoutMs);
          current = target.url;
          redirects += 1;
          continue;
        }

        const contentType = normalizedContentType(response.headers.get("content-type"));
        const contentEncoding = response.headers.get("content-encoding");
        if (contentEncoding !== null && contentEncoding.trim() !== "" && contentEncoding.toLowerCase() !== "identity") {
          await cancelBody(response);
          throw protocolError("SERVICE_RESPONSE_TOO_LARGE", "Compressed service responses are not accepted by the bounded probe.", "serve_uncompressed_response");
        }

        if (kind === "mcp" && response.status === 405) {
          await cancelBody(response);
          return {
            statusCode: response.status,
            latencyMs,
            contentType: contentType || null,
            contractStatus: "healthy",
            safeCapabilityProbe: {
              protocol: "mcp",
              transport: "streamable-http",
              contract: "safe-get-405",
              capabilityValidation: "transport-only"
            }
          };
        }

        if (kind === "x402" && response.status === 402) {
          const body = contentType === "" || jsonContentType.test(contentType)
            ? await readJsonObject(response, input.maxResponseBytes, "SERVICE_X402_CHALLENGE_INVALID").catch((error) => {
              if (response.headers.get("payment-required") !== null) return null;
              throw error;
            })
            : null;
          const summary = validateX402Challenge(body, response.headers.get("payment-required"), input.maxResponseBytes);
          return { statusCode: response.status, latencyMs, contentType: contentType || null, contractStatus: "healthy", safeCapabilityProbe: summary };
        }

        if (response.status === 401 || response.status === 403) {
          await cancelBody(response);
          return { statusCode: response.status, latencyMs, contentType: contentType || null, errorCode: "SERVICE_AUTH_REQUIRED", contractStatus: "unhealthy" };
        }
        if (response.status === 429) {
          await cancelBody(response);
          return { statusCode: response.status, latencyMs, contentType: contentType || null, errorCode: "SERVICE_RATE_LIMITED", contractStatus: "unhealthy" };
        }
        if (!response.ok) {
          await cancelBody(response);
          const errorCode = httpFailureCode(response.status);
          return { statusCode: response.status, latencyMs, contentType: contentType || null, errorCode, contractStatus: "unhealthy" };
        }

        if (kind === "mcp") {
          await cancelBody(response);
          if (!sseContentType.test(contentType)) throw protocolError("SERVICE_MCP_CONTRACT_INVALID", "The MCP GET endpoint must return text/event-stream or HTTP 405.", "repair_mcp_transport");
          const contentLength = response.headers.get("content-length");
          if (contentLength !== null && /^[0-9]+$/u.test(contentLength) && Number(contentLength) > input.maxResponseBytes) throw protocolError("SERVICE_RESPONSE_TOO_LARGE", "The MCP stream exceeds the configured size limit.", "reduce_probe_response");
          return {
            statusCode: response.status,
            latencyMs,
            contentType,
            contractStatus: "healthy",
            safeCapabilityProbe: {
              protocol: "mcp",
              transport: "streamable-http",
              contract: "safe-get-sse",
              capabilityValidation: "transport-only"
            }
          };
        }

        const invalidCode = kind === "a2a"
          ? "SERVICE_A2A_AGENT_CARD_INVALID"
          : kind === "readiness"
            ? "SERVICE_READINESS_INVALID"
            : kind === "adapter"
              ? "SERVICE_ADAPTER_CONTRACT_INVALID"
              : "SERVICE_PROBE_FAILED";
        const body = await readJsonObject(response, input.maxResponseBytes, invalidCode);
        if (kind === "a2a") {
          const safeCapabilityProbe = validateA2AAgentCard(body, input, this.allowInsecureHttp);
          await validateA2AInvocationTargets(safeCapabilityProbe, {
            lookup: this.lookup,
            allowPrivateAddresses: this.allowPrivateAddresses
          });
          return { statusCode: response.status, latencyMs, contentType, contractStatus: "healthy", safeCapabilityProbe };
        }
        if (kind === "readiness") {
          const readiness = validateReadiness(body);
          return { statusCode: response.status, latencyMs, contentType, contractStatus: readiness.contractStatus ?? "healthy", errorCode: readiness.errorCode ?? null, safeCapabilityProbe: readiness.summary };
        }
        if (kind === "adapter") {
          return { statusCode: response.status, latencyMs, contentType, contractStatus: "healthy", safeCapabilityProbe: validateAdapter(body) };
        }
        // x402 and MPP must not be treated as generic JSON services. A 2xx
        // response without a read-only protocol challenge is not evidence.
        throw protocolError(kind === "x402" ? "SERVICE_X402_CHALLENGE_REQUIRED" : "SERVICE_PROTOCOL_UNSUPPORTED", "The advertised service did not expose its reviewed protocol contract.", "repair_service_contract");
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abortFromExternal);
      }
    }
  }
}

export type ServiceProbeResult = ServiceProbeRecord;

export class BoundedServiceProbe {
  public constructor(
    private readonly transport: ServiceProbeTransport,
    private readonly options: ServiceProbeOptions = {}
  ) {}

  public async probe(service: ServiceObservation): Promise<ServiceProbeResult> {
    const now = this.options.now?.() ?? new Date();
    const timeoutMs = this.options.timeoutMs ?? 5_000;
    const maxResponseBytes = this.options.maxResponseBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service probe timeout is invalid.", "fix_probe_policy");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 || maxResponseBytes > 1_048_576) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service probe response limit is invalid.", "fix_probe_policy");
    }
    try {
      this.assertUrl(service.url);
      const response = await this.transport.probe({
        url: service.url,
        kind: service.kind,
        protocolVersion: service.protocolVersion,
        timeoutMs,
        maxResponseBytes,
        ...(this.options.signal === undefined ? {} : { signal: this.options.signal })
      });
      return this.normalizeResponse(service, response, now);
    } catch (error) {
      return this.errorResult(service, now, error);
    }
  }

  /**
   * Probe a bounded batch with isolated results. One failing endpoint never
   * aborts the remaining services, and request starts are globally rate
   * limited even when multiple workers are in flight.
   */
  public async probeMany(
    services: readonly ServiceObservation[],
    options: ServiceProbeBatchOptions = {}
  ): Promise<readonly ServiceProbeResult[]> {
    const maxConcurrency = options.maxConcurrency ?? 2;
    const minIntervalMs = options.minIntervalMs ?? 250;
    const maxServices = options.maxServices ?? 32;
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 16 || !Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 60_000 || !Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 256) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service probe batch policy is invalid.", "fix_probe_policy");
    }
    const selected = services.slice(0, maxServices);
    const results: ServiceProbeResult[] = new Array(selected.length);
    let nextIndex = 0;
    let lastStartedAt: number | null = null;
    let rateTail: Promise<void> = Promise.resolve();
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const runRateLimited = async <T>(work: () => Promise<T>): Promise<T> => {
      let release!: () => void;
      const previous = rateTail;
      rateTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const waitMs = lastStartedAt === null ? 0 : minIntervalMs - (now() - lastStartedAt);
        if (waitMs > 0) await sleep(waitMs);
        lastStartedAt = now();
        // Invoke the transport while the rate slot is still owned. This makes
        // the request start itself, rather than a later continuation, the
        // event paced by the global interval.
        return work();
      } finally {
        release();
      }
    };
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        const service = selected[index];
        if (service === undefined) return;
        try {
          if (options.signal?.aborted === true) {
            results[index] = this.errorResult(service, this.options.now?.() ?? new Date(), protocolError("SERVICE_PROBE_CANCELLED", "The service probe was cancelled.", "resume_probe"));
            continue;
          }
          results[index] = await runRateLimited(() => this.probe(service));
        } catch (error) {
          results[index] = this.errorResult(service, this.options.now?.() ?? new Date(), error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrency, selected.length) }, () => worker()));
    return results;
  }

  public async probeAndPersist(
    repository: IngestionRepository,
    service: ServiceObservation
  ): Promise<ServiceProbeResult> {
    const result = await this.probe(service);
    await repository.appendProbeResult(result);
    await repository.upsertService({
      ...service,
      validationStatus: result.validationStatus,
      observedAt: result.observedAt.toISOString(),
      latencyMs: result.latencyMs,
      safeCapabilityProbe: result.safeCapabilityProbe
    });
    return result;
  }

  public async probeManyAndPersist(
    repository: IngestionRepository,
    services: readonly ServiceObservation[],
    options: ServiceProbeBatchOptions = {}
  ): Promise<readonly ServiceProbeResult[]> {
    const results = await this.probeMany(services, options);
    for (const result of results) {
      await repository.appendProbeResult(result);
      const service = services.find((candidate) => candidate.identityKey === result.identityKey && candidate.kind === result.kind && candidate.url === result.url);
      if (service === undefined) continue;
      await repository.upsertService({
        ...service,
        validationStatus: result.validationStatus,
        observedAt: result.observedAt.toISOString(),
        latencyMs: result.latencyMs,
        safeCapabilityProbe: result.safeCapabilityProbe
      });
    }
    return results;
  }

  private normalizeResponse(
    service: ServiceObservation,
    response: ServiceProbeTransportResponse,
    observedAt: Date
  ): ServiceProbeResult {
    if (!Number.isSafeInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599 || !Number.isSafeInteger(response.latencyMs) || response.latencyMs < 0 || response.latencyMs > 300_000) {
      throw protocolError("SERVICE_PROBE_FAILED", "The service probe returned invalid telemetry.", "retry_probe");
    }
    if (response.safeCapabilityProbe !== undefined) assertSafePublicValue(response.safeCapabilityProbe, "serviceProbe");
    const validationStatus: ProbeValidationStatus = response.contractStatus ?? (
      response.redirected === true
        ? "rejected"
        : response.statusCode >= 200 && response.statusCode < 300
          ? "healthy"
          : response.statusCode >= 300 && response.statusCode < 400
            ? "rejected"
            : "unhealthy"
    );
    serviceValidationStatusSchema.parse(validationStatus);
    return {
      identityKey: service.identityKey,
      kind: service.kind,
      url: service.url,
      validationStatus,
      statusCode: response.statusCode,
      latencyMs: response.latencyMs,
      safeCapabilityProbe: response.safeCapabilityProbe ?? null,
      errorCode: response.errorCode ?? (validationStatus === "healthy" ? null : "SERVICE_STATUS_NOT_HEALTHY"),
      observedAt
    };
  }

  private errorResult(service: ServiceObservation, observedAt: Date, error: unknown): ServiceProbeResult {
    const code = errorCodeOf(error);
    const rejected = new Set([
      "SERVICE_URL_INVALID",
      "SERVICE_HTTPS_REQUIRED",
      "SERVICE_SSRF_BLOCKED",
      "SERVICE_DNS_REBINDING",
      "SERVICE_REDIRECT_BLOCKED",
      "SERVICE_MIME_UNSUPPORTED",
      "SERVICE_A2A_AGENT_CARD_INVALID",
      "SERVICE_MCP_CONTRACT_INVALID",
      "SERVICE_READINESS_INVALID",
      "SERVICE_X402_CHALLENGE_INVALID",
      "SERVICE_X402_CHALLENGE_REQUIRED",
      "SERVICE_ADAPTER_CONTRACT_INVALID",
      "SERVICE_PROTOCOL_UNSUPPORTED"
    ]).has(code);
    return {
      identityKey: service.identityKey,
      kind: service.kind,
      url: service.url,
      validationStatus: rejected ? "rejected" : "unhealthy",
      statusCode: null,
      latencyMs: null,
      safeCapabilityProbe: null,
      errorCode: code,
      observedAt
    };
  }

  private assertUrl(value: string): void {
    if (typeof value !== "string" || value.length === 0 || value.length > serviceUrlLength || controlPattern.test(value)) {
      throw protocolError("SERVICE_URL_INVALID", "The advertised service URL cannot be probed safely.", "review_service");
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch (cause) {
      throw ingestionError("SERVICE_URL_INVALID", "The advertised service URL cannot be probed safely.", "review_service", cause);
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "" || url.hash !== "") {
      throw protocolError("SERVICE_URL_INVALID", "The advertised service URL cannot be probed safely.", "review_service");
    }
    for (const key of url.searchParams.keys()) {
      if (credentialQueryKey.test(key)) {
        throw protocolError("SERVICE_URL_INVALID", "The advertised service URL cannot be probed safely.", "remove_service_credentials");
      }
    }
  }
}
