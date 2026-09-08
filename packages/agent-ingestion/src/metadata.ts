import { type LookupAddress } from "node:dns";
import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Buffer } from "node:buffer";
import { canonicalSha256Hex, sha256Hex } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { assertSafePublicValue } from "./normalize.js";

/** The ERC-8004 registration type used by the current metadata guidance. */
export const erc8004RegistrationType = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;
export const metadataParserVersion = "erc8004-registration-v1" as const;

type Lookup = (hostname: string, options: { readonly all: true; readonly verbatim: true }) => Promise<readonly LookupAddress[]>;
type FetchLike = typeof globalThis.fetch;

export type MetadataResolverOptions = {
  readonly fetch?: FetchLike;
  readonly lookup?: Lookup;
  readonly timeoutMs?: number;
  /** Maximum decoded response bytes, not merely the Content-Length header. */
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonKeys?: number;
  /** IPFS gateways are explicit runtime configuration; none is guessed. */
  readonly ipfsGateways?: readonly string[];
  readonly now?: () => number;
  /** Test-only escape hatch. Production callers must leave this false. */
  readonly allowPrivateAddresses?: boolean;
};

export type MetadataResolution = {
  readonly requestedUri: string;
  readonly finalUri: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly digestMatches: boolean | null;
  readonly document: unknown;
  readonly parserVersion: typeof metadataParserVersion;
};

export type RegistrationMetadata = {
  readonly type: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly image: string | null;
  readonly services: readonly unknown[];
  readonly registrations: readonly unknown[];
  readonly protocols: readonly string[];
  readonly skills: readonly string[];
  readonly domains: readonly string[];
  readonly warnings: readonly string[];
  readonly parserVersion: typeof metadataParserVersion;
  readonly sourceDigest: string;
};

type ResolverPolicy = {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
  readonly maxJsonDepth: number;
  readonly maxJsonKeys: number;
};

const jsonContentType = /^(?:application\/json|application\/ld\+json|text\/json|application\/[^;]+\+json)$/iu;
const hostNamePattern = /^[a-z0-9.-]+$/iu;
const controlPattern = /[\u0000-\u001f\u007f]/u;
const metadataHostNames = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.internal.",
  "instance-data.ec2.internal",
  "instance-data.ec2.internal."
]);

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw ingestionError("METADATA_URI_INVALID", `The metadata ${field} is outside its safe bound.`, "fix_metadata_policy");
  }
  return result;
}

function normalizeExpectedDigest(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/iu.test(normalized)) throw ingestionError("METADATA_URI_INVALID", "The expected metadata digest is invalid.", "repair_metadata_digest");
  return normalized.toLowerCase();
}

function normalizedContentType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function parseHost(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  const family = isIP(host);
  if (host.length === 0 || host.length > 253 || controlPattern.test(host) || (family === 0 && !hostNamePattern.test(host)) || (family !== 0 && family !== 4 && family !== 6)) {
    throw ingestionError("METADATA_URI_INVALID", "The metadata host is invalid.", "review_metadata_uri");
  }
  return host;
}

function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return null;
  return (((octets[0] ?? 0) * 256 + (octets[1] ?? 0)) * 256 + (octets[2] ?? 0)) * 256 + (octets[3] ?? 0);
}

function inIpv4Range(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}

function ipv6Words(value: string): readonly number[] | null {
  const normalized = value.toLowerCase();
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const words: number[] = [];
    for (const part of half.split(":")) {
      if (part.includes(".")) {
        const ipv4 = ipv4Number(part);
        if (ipv4 === null) return null;
        words.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else if (/^[0-9a-f]{1,4}$/u.test(part)) {
        words.push(Number.parseInt(part, 16));
      } else {
        return null;
      }
    }
    return words;
  };
  const left = parseHalf(halves[0] ?? "");
  const right = halves.length === 2 ? parseHalf(halves[1] ?? "") : [];
  if (left === null || right === null || (halves.length === 1 && left.length !== 8) || (halves.length === 2 && left.length + right.length >= 8)) return null;
  const zeroes = halves.length === 2 ? 8 - left.length - right.length : 0;
  return [...left, ...Array.from({ length: zeroes }, () => 0), ...right];
}

function isBlockedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  const family = isIP(normalized);
  if (family === 4) {
    const value = ipv4Number(normalized);
    if (value === null) return true;
    return (
      inIpv4Range(value, 0x00000000, 0x00ffffff) || // unspecified/current network
      inIpv4Range(value, 0x0a000000, 0x0affffff) || // RFC1918
      inIpv4Range(value, 0x64400000, 0x647fffff) || // shared address space
      inIpv4Range(value, 0x7f000000, 0x7fffffff) || // loopback
      inIpv4Range(value, 0xa9fe0000, 0xa9feffff) || // link-local/metadata
      inIpv4Range(value, 0xac100000, 0xac1fffff) || // RFC1918
      inIpv4Range(value, 0xc0000000, 0xc00000ff) || // IETF protocol assignments
      inIpv4Range(value, 0xc0a80000, 0xc0a8ffff) || // RFC1918
      inIpv4Range(value, 0xc6120000, 0xc613ffff) || // benchmarking
      inIpv4Range(value, 0xe0000000, 0xffffffff) // multicast/reserved
    );
  }
  if (family === 6) {
    const words = ipv6Words(normalized);
    if (words === null || words.length !== 8) return true;
    const first = words[0] ?? 0;
    // IPv4-compatible and IPv4-mapped forms must receive the same private,
    // loopback, link-local, and metadata checks as a dotted-quad address.
    const embeddedIpv4 = words.slice(0, 5).every((word) => word === 0) && ((words[5] ?? 0) === 0 || (words[5] ?? 0) === 0xffff)
      ? (((words[6] ?? 0) * 0x10000) + (words[7] ?? 0)) >>> 0
      : null;
    if (embeddedIpv4 !== null) return isBlockedAddress(`${(embeddedIpv4 >>> 24) & 0xff}.${(embeddedIpv4 >>> 16) & 0xff}.${(embeddedIpv4 >>> 8) & 0xff}.${embeddedIpv4 & 0xff}`);
    if (first === 0 || (first & 0xff00) === 0xff00 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
    return false;
  }
  return true;
}

function assertUrl(value: string, scheme: "https:" | "ipfs:" | "data:"): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || controlPattern.test(value)) {
    throw ingestionError("METADATA_URI_INVALID", "The agent metadata URI is invalid.", "review_metadata_uri");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw ingestionError("METADATA_URI_INVALID", "The agent metadata URI is invalid.", "review_metadata_uri", cause);
  }
  if (url.protocol !== scheme || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw ingestionError("METADATA_URI_INVALID", "The agent metadata URI uses an unsafe form.", "review_metadata_uri");
  }
  return url;
}

function assertPublicHttpsUrl(value: string, allowPrivateAddresses: boolean): URL {
  const url = assertUrl(value, "https:");
  const hostname = parseHost(url.hostname);
  if (!allowPrivateAddresses && (metadataHostNames.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".localhost"))) {
    throw ingestionError("METADATA_SSRF_BLOCKED", "The metadata host is not a public network target.", "review_metadata_host");
  }
  return url;
}

async function resolvePublicHost(url: URL, lookup: Lookup, allowPrivateAddresses: boolean): Promise<readonly string[]> {
  const hostname = parseHost(url.hostname);
  if (allowPrivateAddresses) return [];
  if (metadataHostNames.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw ingestionError("METADATA_SSRF_BLOCKED", "The metadata host is not a public network target.", "review_metadata_host");
  }
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) throw ingestionError("METADATA_SSRF_BLOCKED", "The metadata target resolves to a private network address.", "review_metadata_host");
    return [hostname];
  }
  let addresses: readonly LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw ingestionError("METADATA_FETCH_FAILED", "The metadata host could not be resolved.", "retry_metadata", cause, true);
  }
  if (addresses.length === 0 || addresses.some((entry) => typeof entry.address !== "string" || isBlockedAddress(entry.address))) {
    throw ingestionError("METADATA_SSRF_BLOCKED", "The metadata target resolves to a private network address.", "review_metadata_host");
  }
  return [...new Set(addresses.map((entry) => entry.address.trim().toLowerCase()))].sort();
}

async function assertPublicHost(url: URL, lookup: Lookup, allowPrivateAddresses: boolean): Promise<void> {
  await resolvePublicHost(url, lookup, allowPrivateAddresses);
}

/** Shared SSRF guard for HTTP(S) service probes and metadata fetches. */
export async function assertSafePublicNetworkTarget(
  value: string,
  options: { readonly lookup?: Lookup; readonly allowPrivateAddresses?: boolean } = {}
): Promise<URL> {
  return (await resolveSafePublicNetworkTarget(value, options)).url;
}

/**
 * Resolve and validate a public service target while retaining the address
 * set observed for this lookup. Callers that make a network request can run
 * the same check after the request and fail closed if DNS changed in the
 * meantime (a DNS-rebinding/TOCTOU guard).
 */
export async function resolveSafePublicNetworkTarget(
  value: string,
  options: { readonly lookup?: Lookup; readonly allowPrivateAddresses?: boolean } = {}
): Promise<{ readonly url: URL; readonly addresses: readonly string[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw ingestionError("METADATA_URI_INVALID", "The network target URL is invalid.", "review_network_target", cause);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw ingestionError("METADATA_URI_INVALID", "The network target URL uses an unsafe form.", "review_network_target");
  }
  const addresses = await resolvePublicHost(
    url,
    options.lookup ?? (defaultLookup as unknown as Lookup),
    options.allowPrivateAddresses === true
  );
  return { url, addresses };
}

function assertBodySize(response: Response, bytes: ArrayBuffer, maxBytes: number): void {
  const length = response.headers.get("content-length");
  if (length !== null && /^[0-9]+$/u.test(length) && Number(length) > maxBytes) {
    throw ingestionError("METADATA_TOO_LARGE", "The metadata response exceeds the configured size limit.", "reduce_metadata_size");
  }
  if (bytes.byteLength > maxBytes) {
    throw ingestionError("METADATA_TOO_LARGE", "The metadata response exceeds the configured size limit.", "reduce_metadata_size");
  }
}

function parseJsonBytes(bytes: ArrayBuffer, maxJsonDepth: number, maxJsonKeys: number): unknown {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw ingestionError("METADATA_PARSE_FAILED", "The metadata response is not valid JSON.", "repair_metadata", cause);
  }
  let keys = 0;
  const visit = (input: unknown, depth: number): void => {
    if (depth > maxJsonDepth) throw ingestionError("METADATA_PARSE_FAILED", "The metadata JSON is too deeply nested.", "reduce_metadata_depth");
    if (input !== null && typeof input === "object") {
      const entries = Array.isArray(input) ? input.entries() : Object.entries(input);
      for (const [key, child] of entries) {
        if (++keys > maxJsonKeys) throw ingestionError("METADATA_PARSE_FAILED", "The metadata JSON has too many fields.", "reduce_metadata_fields");
        if (typeof key === "string" && controlPattern.test(key)) throw ingestionError("METADATA_PARSE_FAILED", "The metadata JSON contains a control character.", "repair_metadata");
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  assertSafePublicValue(value, "agentMetadata");
  return value;
}

function decodeDataUri(uri: string, maxBytes: number): { readonly contentType: string; readonly bytes: ArrayBuffer } {
  if (uri.length > Math.ceil(maxBytes * 1.5) + 256) throw ingestionError("METADATA_TOO_LARGE", "The data metadata URI exceeds the configured size limit.", "reduce_metadata_size");
  const match = /^data:([^;,\s]+)?((?:;[^,]*)?),(.*)$/isu.exec(uri);
  if (match === null) throw ingestionError("METADATA_URI_INVALID", "The data metadata URI is malformed.", "repair_metadata_uri");
  const contentType = (match[1] ?? "text/plain").toLowerCase();
  if (!jsonContentType.test(contentType)) throw ingestionError("METADATA_MIME_UNSUPPORTED", "The metadata MIME type is not JSON.", "use_json_metadata");
  const attributes = match[2] ?? "";
  const encoded = match[3] ?? "";
  let bytes: Buffer;
  try {
    if (attributes.split(";").some((attribute) => attribute.toLowerCase() === "base64")) {
      if (!/^[a-z0-9+/\s]*={0,2}$/iu.test(encoded) || encoded.replace(/\s/gu, "").length % 4 === 1) throw new Error("invalid base64");
      bytes = Buffer.from(encoded, "base64");
    } else {
      bytes = Buffer.from(decodeURIComponent(encoded), "utf8");
    }
  } catch (cause) {
    throw ingestionError("METADATA_PARSE_FAILED", "The data metadata URI could not be decoded.", "repair_metadata_uri", cause);
  }
  if (bytes.byteLength > maxBytes) throw ingestionError("METADATA_TOO_LARGE", "The data metadata URI exceeds the configured size limit.", "reduce_metadata_size");
  // Copy into an owned Uint8Array so the public contract is always an
  // ArrayBuffer, even when Node's Buffer is backed by a shared pool.
  return { contentType, bytes: Uint8Array.from(bytes).buffer };
}

function ipfsGatewayUrl(gateway: string, cidPath: string): string {
  const template = gateway.includes("{cid}") ? gateway : `${gateway.replace(/\/+$/u, "")}/{cid}`;
  let base: URL;
  try {
    base = new URL(template.replace("{cid}", cidPath));
  } catch (cause) {
    throw ingestionError("METADATA_URI_INVALID", "An IPFS gateway configuration is invalid.", "fix_metadata_gateway", cause);
  }
  if (base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.hash !== "" || base.search !== "") {
    throw ingestionError("METADATA_URI_INVALID", "IPFS gateways must be HTTPS URLs without credentials.", "fix_metadata_gateway");
  }
  return base.toString();
}

/**
 * Bounded resolver for registration metadata. It never follows redirects
 * implicitly: each Location target is validated against the same SSRF policy.
 */
export class BoundedMetadataResolver {
  private readonly fetcher: FetchLike;
  private readonly lookup: Lookup;
  private readonly policy: ResolverPolicy;
  private readonly ipfsGateways: readonly string[];
  private readonly now: () => number;
  private readonly allowPrivateAddresses: boolean;

  public constructor(options: MetadataResolverOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.lookup = options.lookup ?? (defaultLookup as unknown as Lookup);
    this.policy = {
      timeoutMs: boundedInteger(options.timeoutMs, 8_000, 250, 120_000, "timeout"),
      maxBytes: boundedInteger(options.maxBytes, 512 * 1024, 256, 8 * 1024 * 1024, "response size"),
      maxRedirects: boundedInteger(options.maxRedirects, 3, 0, 8, "redirect count"),
      maxJsonDepth: boundedInteger(options.maxJsonDepth, 12, 1, 32, "JSON depth"),
      maxJsonKeys: boundedInteger(options.maxJsonKeys, 4_096, 1, 20_000, "JSON field count")
    };
    this.ipfsGateways = options.ipfsGateways ?? [];
    this.now = options.now ?? Date.now;
    this.allowPrivateAddresses = options.allowPrivateAddresses === true;
    for (const gateway of this.ipfsGateways) ipfsGatewayUrl(gateway, "bafy-placeholder");
  }

  public async resolve(uri: string, expectedDigest: string | null = null): Promise<MetadataResolution> {
    const normalizedExpectedDigest = normalizeExpectedDigest(expectedDigest);
    const scheme = (() => {
      try { return new URL(uri).protocol; } catch { return ""; }
    })();
    if (scheme === "data:") {
      const decoded = decodeDataUri(uri, this.policy.maxBytes);
      const document = parseJsonBytes(decoded.bytes, this.policy.maxJsonDepth, this.policy.maxJsonKeys);
      const digest = sha256Hex(new Uint8Array(decoded.bytes));
      return {
        requestedUri: uri,
        finalUri: uri,
        contentType: decoded.contentType,
        byteLength: decoded.bytes.byteLength,
        contentDigest: digest,
        digestMatches: normalizedExpectedDigest === null ? null : digest.toLowerCase() === normalizedExpectedDigest,
        document,
        parserVersion: metadataParserVersion
      };
    }
    if (scheme === "ipfs:") {
      const ipfs = assertUrl(uri, "ipfs:");
      const pathSegments = ipfs.pathname.split("/").filter((segment) => segment.length > 0);
      if (pathSegments.some((segment) => segment === "." || segment === ".." || segment.includes("%2f") || segment.includes("%5c"))) throw ingestionError("METADATA_URI_INVALID", "The IPFS metadata path contains traversal syntax.", "review_metadata_uri");
      const cidPath = [ipfs.hostname, ...pathSegments].join("/");
      if (cidPath.length < 4 || cidPath.length > 2_048 || !/^[a-z0-9][a-z0-9./_-]*$/iu.test(cidPath)) throw ingestionError("METADATA_URI_INVALID", "The IPFS metadata URI is invalid.", "review_metadata_uri");
      if (this.ipfsGateways.length === 0) throw ingestionError("METADATA_FETCH_FAILED", "No approved IPFS gateway is configured.", "configure_metadata_gateway");
      let lastError: unknown;
      for (const gateway of this.ipfsGateways) {
        try { return await this.resolveHttp(ipfsGatewayUrl(gateway, cidPath), uri, normalizedExpectedDigest); } catch (error) { lastError = error; }
      }
      throw ingestionError("METADATA_FETCH_FAILED", "The metadata could not be fetched from an approved IPFS gateway.", "retry_metadata", lastError, true);
    }
    if (scheme !== "https:") throw ingestionError("METADATA_URI_INVALID", "Only HTTPS, IPFS, and bounded data metadata URIs are accepted.", "review_metadata_uri");
    return this.resolveHttp(uri, uri, normalizedExpectedDigest);
  }

  public parseRegistration(resolution: MetadataResolution): RegistrationMetadata {
    return parseAgentRegistrationMetadata(resolution.document, resolution.contentDigest);
  }

  private async resolveHttp(initialUri: string, requestedUri: string, expectedDigest: string | null): Promise<MetadataResolution> {
    let current = assertPublicHttpsUrl(initialUri, this.allowPrivateAddresses);
    let redirects = 0;
    while (true) {
      await assertPublicHost(current, this.lookup, this.allowPrivateAddresses);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.policy.timeoutMs);
      let response: Response;
      try {
        response = await this.fetcher(current.toString(), {
          method: "GET",
          headers: { accept: "application/json", "accept-encoding": "identity" },
          redirect: "manual",
          signal: controller.signal
        });
      } catch (cause) {
        const timeout = cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
        clearTimeout(timer);
        throw ingestionError(timeout ? "METADATA_FETCH_FAILED" : "METADATA_FETCH_FAILED", timeout ? "The metadata request timed out." : "The metadata request failed.", "retry_metadata", cause, true);
      }
      try {
        const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location !== null) {
        if (redirects++ >= this.policy.maxRedirects) throw ingestionError("METADATA_FETCH_FAILED", "The metadata redirect limit was exceeded.", "review_metadata_redirects");
        let next: URL;
        try { next = new URL(location, current); } catch (cause) { throw ingestionError("METADATA_URI_INVALID", "The metadata redirect target is invalid.", "review_metadata_redirects", cause); }
        if (next.protocol !== "https:" || next.username !== "" || next.password !== "" || next.hash !== "") throw ingestionError("METADATA_SSRF_BLOCKED", "The metadata redirect target is not allowed.", "review_metadata_redirects");
        current = assertPublicHttpsUrl(next.toString(), this.allowPrivateAddresses);
        continue;
      }
      if (!response.ok) throw ingestionError("METADATA_FETCH_FAILED", "The metadata provider returned an unsuccessful response.", "retry_metadata", undefined, response.status >= 500 || response.status === 429);
      const contentType = normalizedContentType(response.headers.get("content-type"));
      if (!jsonContentType.test(contentType)) throw ingestionError("METADATA_MIME_UNSUPPORTED", "The metadata response MIME type is not JSON.", "use_json_metadata");
      const encoding = response.headers.get("content-encoding");
      if (encoding !== null && encoding.trim() !== "" && encoding.toLowerCase() !== "identity") throw ingestionError("METADATA_TOO_LARGE", "Compressed metadata responses are not accepted by the bounded resolver.", "serve_uncompressed_metadata");
      let bytes: ArrayBuffer;
      try { bytes = await response.arrayBuffer(); } catch (cause) { throw ingestionError("METADATA_FETCH_FAILED", "The metadata response could not be read.", "retry_metadata", cause, true); }
      assertBodySize(response, bytes, this.policy.maxBytes);
      const document = parseJsonBytes(bytes, this.policy.maxJsonDepth, this.policy.maxJsonKeys);
      const digest = sha256Hex(new Uint8Array(bytes));
      return {
        requestedUri,
        finalUri: current.toString(),
        contentType,
        byteLength: bytes.byteLength,
        contentDigest: digest,
        digestMatches: expectedDigest === null ? null : digest.toLowerCase() === expectedDigest.toLowerCase(),
        document,
        parserVersion: metadataParserVersion
      };
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 2_000) : null;
}

function stringArray(value: unknown, limit = 128): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim().slice(0, 256)).slice(0, limit);
}

/** Parse current and legacy registration shapes while retaining warnings. */
export function parseAgentRegistrationMetadata(document: unknown, sourceDigest?: string): RegistrationMetadata {
  assertSafePublicValue(document, "agentMetadata");
  if (typeof document !== "object" || document === null || Array.isArray(document)) throw ingestionError("METADATA_PARSE_FAILED", "The registration metadata must be a JSON object.", "repair_metadata");
  const record = document as Record<string, unknown>;
  const digest = sourceDigest ?? canonicalSha256Hex(record);
  const rawType = record.type;
  const type = Array.isArray(rawType) ? stringOrNull(rawType.find((entry) => typeof entry === "string")) : stringOrNull(rawType);
  const warnings: string[] = [];
  if (type === null) warnings.push("REGISTRATION_TYPE_MISSING");
  else if (type !== erc8004RegistrationType) warnings.push("REGISTRATION_TYPE_LEGACY_OR_UNKNOWN");
  const registrationsValue = record.registrations;
  const registrations = Array.isArray(registrationsValue) ? registrationsValue.slice(0, 128) : [];
  if (registrationsValue !== undefined && !Array.isArray(registrationsValue)) warnings.push("REGISTRATIONS_NOT_ARRAY");
  for (const registration of registrations) {
    if (typeof registration !== "object" || registration === null || Array.isArray(registration)) warnings.push("REGISTRATION_ENTRY_INVALID");
    else {
      const candidate = registration as Record<string, unknown>;
      if (candidate.agentId === undefined && candidate.agent_id === undefined) warnings.push("REGISTRATION_AGENT_ID_MISSING");
      if (candidate.agentRegistry === undefined && candidate.agent_registry === undefined) warnings.push("REGISTRATION_REGISTRY_MISSING");
    }
  }
  const protocols = stringArray(record.supportedProtocols ?? record.supported_protocols ?? record.protocols, 64);
  const services = Array.isArray(record.services) ? record.services.slice(0, 128) : [];
  if (record.services !== undefined && !Array.isArray(record.services)) warnings.push("SERVICES_NOT_ARRAY");
  const oasf = typeof record.oasf === "object" && record.oasf !== null && !Array.isArray(record.oasf)
    ? record.oasf as Record<string, unknown>
    : {};
  return {
    type,
    name: stringOrNull(record.name),
    description: stringOrNull(record.description),
    image: stringOrNull(record.image ?? record.image_url),
    services,
    registrations,
    protocols,
    skills: stringArray(record.skills ?? oasf.skills, 128),
    domains: stringArray(record.domains ?? oasf.domains, 128),
    warnings: [...new Set(warnings)].sort(),
    parserVersion: metadataParserVersion,
    sourceDigest: digest
  };
}
