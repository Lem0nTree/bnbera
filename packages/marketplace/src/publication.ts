import { createHash } from "node:crypto";
import {
  advertisedServiceSchema,
  agentStateAxesSchema,
  assertStateTransition,
  canonicalSha256Hex,
  capabilityManifestSchema,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  type AdvertisedService,
  type AgentStateAxes,
  type CapabilityManifest,
  type Erc8004Identity
} from "@bnbera/domain";
import {
  marketplaceFreshnessSchema,
  marketplaceListingMetadataSchema,
  marketplacePricingSchema
} from "./types.js";

/**
 * A deliberately small PostgreSQL surface keeps this package independent of
 * the Drizzle client while still allowing the application to pass its
 * existing `pg.Pool`. The structural type is also straightforward to replace
 * with a transaction-scoped client in integration tests.
 */
export type MarketplacePublicationQueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> = {
  readonly rows: readonly TRow[];
  readonly rowCount?: number | null;
};

export interface MarketplacePublicationQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<MarketplacePublicationQueryResult<TRow>>;
}

export interface MarketplacePublicationClient extends MarketplacePublicationQueryable {
  release(): void;
}

export interface MarketplacePublicationPool extends MarketplacePublicationQueryable {
  connect(): Promise<MarketplacePublicationClient>;
}

export const publicationDiagnosticCodes = [
  "IDENTITY_NOT_FOUND",
  "IDENTITY_READ_MISSING",
  "IDENTITY_READ_NOT_FINALIZED",
  "IDENTITY_URI_MISSING",
  "METADATA_INVALID",
  "METADATA_REQUIRED",
  "CAPABILITY_INVALID",
  "CAPABILITY_NOT_PERSISTED",
  "SERVICE_MISSING",
  "SERVICE_INVALID",
  "SERVICE_HEALTH_UNVERIFIED",
  "SERVICE_HEALTH_STALE",
  "VERIFICATION_REJECTED",
  "RUNTIME_PAUSED",
  "LISTING_DELISTED",
  "LISTING_MANUAL_REVIEW",
  "VERSION_NOT_PUBLISHABLE"
] as const;

export type PublicationDiagnosticCode = (typeof publicationDiagnosticCodes)[number];

export type PublicationDiagnostic = {
  readonly code: PublicationDiagnosticCode;
  /** Safe, fixed text. Never interpolate provider errors, URLs, or payloads. */
  readonly message: string;
};

const diagnosticMessages: Readonly<Record<PublicationDiagnosticCode, string>> = {
  IDENTITY_NOT_FOUND: "The ERC-8004 identity is not present in the ingestion projection.",
  IDENTITY_READ_MISSING: "The ERC-8004 identity does not have complete block-bound read provenance.",
  IDENTITY_READ_NOT_FINALIZED: "The ERC-8004 identity read is provisional and is withheld until finality is confirmed.",
  IDENTITY_URI_MISSING: "The ERC-8004 identity has no observed public metadata URI.",
  METADATA_INVALID: "The resolved public metadata is not an allowed marketplace object.",
  METADATA_REQUIRED: "The resolved public metadata is missing a public name or description.",
  CAPABILITY_INVALID: "The capability manifest is invalid or contains unsafe public data.",
  CAPABILITY_NOT_PERSISTED: "The capability manifest has not been persisted as an ingestion observation.",
  SERVICE_MISSING: "No advertised public service is available for this marketplace version.",
  SERVICE_INVALID: "An advertised public service observation is invalid and has been withheld.",
  SERVICE_HEALTH_UNVERIFIED: "No current healthy probe proves that an advertised service is available.",
  SERVICE_HEALTH_STALE: "The latest advertised service probes are stale or unhealthy.",
  VERIFICATION_REJECTED: "The identity was rejected by the verification state machine.",
  RUNTIME_PAUSED: "The agent runtime is paused and requires an explicit operator action.",
  LISTING_DELISTED: "The listing was delisted and cannot be republished automatically.",
  LISTING_MANUAL_REVIEW: "The listing is paused or suspended and requires explicit review.",
  VERSION_NOT_PUBLISHABLE: "The observed version was retained but did not satisfy publication policy."
};

export const marketplacePublicationStatus = ["published", "withheld"] as const;
export type MarketplacePublicationStatus = (typeof marketplacePublicationStatus)[number];

export type MarketplacePublicationResult = {
  readonly status: MarketplacePublicationStatus;
  readonly identityKey: string | null;
  readonly agentId: string | null;
  readonly versionId: string | null;
  readonly version: number | null;
  readonly contentDigest: string | null;
  readonly versionCreated: boolean;
  readonly versionReused: boolean;
  readonly currentVersionUpdated: boolean;
  readonly state: AgentStateAxes | null;
  readonly diagnostics: readonly PublicationDiagnostic[];
};

export type MarketplacePublicationInput = {
  readonly identity: Erc8004Identity;
  /** Resolved registration data; only the documented public allowlist is stored. */
  readonly publicMetadata: Readonly<Record<string, unknown>>;
  /** Must be the same capability manifest already persisted by ingestion. */
  readonly capabilityManifest: unknown;
  /** Public pricing observation. Missing pricing is represented as unavailable. */
  readonly pricingManifest?: Readonly<Record<string, unknown>>;
};

export type MarketplacePublicationServiceOptions = {
  readonly now?: () => Date;
  /** Current service health evidence expires after this many milliseconds. */
  readonly serviceHealthMaxAgeMs?: number;
};

type IdentityAgentRow = {
  identity_id: string;
  agent_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  agent_id_key: string;
  owner_address: string | null;
  agent_uri: string | null;
  observed_block: number | string | null;
  observed_block_hash: string | null;
  read_consistency: string | null;
  current_version_id: string | null;
  origin_type: string;
  claim_status: string;
  verification_status: string;
  runtime_status: string;
  authority_status: string;
  listing_status: string;
};

type VersionRow = {
  id: string;
  version: number;
  public_metadata: unknown;
  capability_manifest: unknown;
  pricing_manifest: unknown;
};

type CapabilityRow = {
  capability_manifest: unknown;
  manifest_digest: string;
};

type ServiceRow = {
  id: string;
  kind: string;
  url: string;
  protocol_version: string;
  discovery_source: string;
  validation_status: string;
  observed_at: Date | string;
  latency_ms: number | null;
  safe_capability_probe: Record<string, unknown> | null;
};

type ProbeRow = {
  id: string;
  kind: string;
  url: string;
  validation_status: string;
  observed_at: Date | string;
};

type NormalizedPublicationInput = {
  readonly identity: Erc8004Identity;
  readonly identityKey: string;
  readonly publicMetadata: Readonly<Record<string, unknown>>;
  readonly capabilityManifest: CapabilityManifest;
  readonly pricingManifest: Readonly<Record<string, unknown>>;
};

type PreparedInputResult = {
  readonly input: NormalizedPublicationInput | null;
  readonly diagnostic: PublicationDiagnostic;
};

type NormalizedService = {
  readonly row: ServiceRow;
  readonly advertised: AdvertisedService;
  readonly stableDescriptor: Readonly<Record<string, string>>;
};

type PublicationPreparation = {
  readonly input: NormalizedPublicationInput;
  readonly services: readonly NormalizedService[];
  readonly latestProbes: ReadonlyMap<string, ProbeRow>;
  readonly healthyServiceCount: number;
  readonly hasFreshProbe: boolean;
};

type VersionSelection = {
  readonly id: string;
  readonly version: number;
  readonly contentDigest: string;
  readonly created: boolean;
};

const safeUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const controlPattern = /[\u0000-\u001f\u007f]/u;
const sensitiveKeyPattern = /(private[_-]?key|secret|password|mnemonic|seed phrase|access[_-]?token|api[_-]?key|authorization|credential)/iu;
const defaultServiceHealthMaxAgeMs = 60_000;

function diagnostic(code: PublicationDiagnosticCode): PublicationDiagnostic {
  return { code, message: diagnosticMessages[code] };
}

function withheld(
  identityKey: string | null,
  diagnostics: readonly PublicationDiagnostic[],
  details: Partial<Pick<MarketplacePublicationResult, "agentId" | "versionId" | "version" | "contentDigest" | "versionCreated" | "versionReused" | "currentVersionUpdated" | "state">> = {}
): MarketplacePublicationResult {
  return {
    status: "withheld",
    identityKey,
    agentId: details.agentId ?? null,
    versionId: details.versionId ?? null,
    version: details.version ?? null,
    contentDigest: details.contentDigest ?? null,
    versionCreated: details.versionCreated ?? false,
    versionReused: details.versionReused ?? false,
    currentVersionUpdated: details.currentVersionUpdated ?? false,
    state: details.state ?? null,
    diagnostics
  };
}

function published(
  input: {
    readonly identityKey: string;
    readonly agentId: string;
    readonly version: VersionSelection;
    readonly state: AgentStateAxes;
    readonly currentVersionUpdated: boolean;
  }
): MarketplacePublicationResult {
  return {
    status: "published",
    identityKey: input.identityKey,
    agentId: input.agentId,
    versionId: input.version.id,
    version: input.version.version,
    contentDigest: input.version.contentDigest,
    versionCreated: input.version.created,
    versionReused: !input.version.created,
    currentVersionUpdated: input.currentVersionUpdated,
    state: input.state,
    diagnostics: []
  };
}

function safeDate(value: unknown): Date | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (date === null) return null;
  return Number.isFinite(date.valueOf()) ? date : null;
}

function safeString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || controlPattern.test(normalized)) return null;
  return normalized;
}

/**
 * Keep this package's publication boundary free of the ingestion barrel. The
 * barrel includes provider/database adapters, while this validator is needed
 * without pulling those adapters into the marketplace export graph. It mirrors the
 * ingestion public-value limits and rejects credential-bearing keys before a
 * value can reach JSONB or a read model.
 */
function assertSafePublicValue(value: unknown, path = "metadata", depth = 0, budget = { nodes: 0 }): void {
  if (depth > 8 || budget.nodes++ > 2_048) throw new Error(`Unsafe public value at ${path}`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Unsafe public value at ${path}`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 10_000 || controlPattern.test(value)) throw new Error(`Unsafe public value at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error(`Unsafe public value at ${path}`);
    value.forEach((entry, index) => assertSafePublicValue(entry, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (typeof value !== "object") throw new Error(`Unsafe public value at ${path}`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Unsafe public value at ${path}`);
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) throw new Error(`Unsafe public value at ${path}.${key}`);
    assertSafePublicValue(child, `${path}.${key}`, depth + 1, budget);
  }
}

function safePublicObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Readonly<Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

function safeStringList(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const values = value
    .map((entry) => safeString(entry, 128))
    .filter((entry): entry is string => entry !== null);
  return values.length === value.length ? [...new Set(values)] : null;
}

function deterministicUuid(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  // UUIDv5-shaped values are deterministic and remain valid PostgreSQL UUIDs.
  const versioned = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${digest.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20, 32)}`;
}

function parseIdentity(input: unknown): { readonly identity: Erc8004Identity; readonly identityKey: string } | null {
  try {
    // Normalize the registry address before it is used in SQL. The database
    // ingestion boundary stores canonical lowercase addresses, while a
    // caller may still provide the checksummed form from an RPC response.
    const identity = normalizeErc8004Identity(input);
    return { identity, identityKey: erc8004IdentityKey(identity) };
  } catch {
    return null;
  }
}

function safeInteger(value: unknown, minimum: number, maximum: number): number | null {
  const candidate = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(candidate) && candidate >= minimum && candidate <= maximum ? candidate : null;
}

function safeAtomic(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value.toString(10) : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^(0|[1-9][0-9]*)$/u.test(normalized) ? normalized : null;
}

function safeAddress(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value.trim())) return null;
  return value.trim().toLowerCase();
}

function unavailablePricing(chainId: number): Readonly<Record<string, unknown>> {
  return {
    model: "unavailable",
    network: chainId,
    tokenAddress: null,
    tokenSymbol: null,
    decimals: 18,
    minAtomic: null,
    maxAtomic: null,
    observedAt: null
  };
}

/**
 * Normalize pricing at the publication boundary. Price data is useful when
 * it is complete, but an unknown or malformed observation must become the
 * existing `unavailable` representation rather than blocking a listing or
 * persisting arbitrary provider fields.
 */
function normalizePricingManifest(
  input: unknown,
  chainId: number
): Readonly<Record<string, unknown>> {
  const pricing = safePublicObject(input);
  if (pricing === null) return unavailablePricing(chainId);

  const modelValue = safeString(pricing.model, 32);
  const model = modelValue === "free" || modelValue === "fixed" || modelValue === "range" ||
    modelValue === "quote" || modelValue === "unavailable"
    ? modelValue
    : "unavailable";
  const observedAt = safeDate(pricing.observedAt)?.toISOString() ?? null;
  const tokenAddress = safeAddress(pricing.tokenAddress);
  const tokenSymbol = safeString(pricing.tokenSymbol, 32);
  const decimals = safeInteger(pricing.decimals, 0, 255) ?? 18;
  const inputAmount = pricing.amountAtomic;
  const minAtomic = model === "free" || model === "unavailable"
    ? null
    : safeAtomic(pricing.minAtomic ?? inputAmount);
  const maxAtomic = model === "free" || model === "unavailable"
    ? null
    : safeAtomic(pricing.maxAtomic ?? inputAmount);
  const candidate = {
    model,
    // Never trust a provider-supplied network field to cross an identity
    // boundary. The version's pricing network is the ERC-8004 chain.
    network: chainId,
    tokenAddress,
    tokenSymbol,
    decimals,
    minAtomic,
    maxAtomic,
    observedAt
  };
  const parsed = marketplacePricingSchema.safeParse(candidate);
  if (!parsed.success) return unavailablePricing(chainId);
  return parsed.data;
}

function normalizeFreshness(input: unknown): Readonly<Record<string, unknown>> {
  const freshness = safePublicObject(input);
  if (freshness === null) {
    return marketplaceFreshnessSchema.parse({
      status: "unknown",
      observedAt: null,
      source: null,
      maxAgeSeconds: null
    });
  }
  const rawStatus = safeString(freshness.status, 16);
  const requestedStatus = rawStatus === "fresh" || rawStatus === "stale" || rawStatus === "unknown"
    ? rawStatus
    : "unknown";
  const observedAt = safeDate(freshness.observedAt)?.toISOString() ?? null;
  const status = requestedStatus === "fresh" && observedAt === null ? "unknown" : requestedStatus;
  return marketplaceFreshnessSchema.parse({
    status,
    observedAt,
    source: safeString(freshness.source, 160),
    maxAgeSeconds: safeInteger(freshness.maxAgeSeconds, 1, 31_536_000)
  });
}

function normalizePublicMetadata(
  input: unknown,
  services: readonly NormalizedService[],
  pricingManifest: Readonly<Record<string, unknown>>,
  chainId: number
): { readonly value: Readonly<Record<string, unknown>>; readonly diagnostic: PublicationDiagnostic | null } {
  const metadata = safePublicObject(input);
  if (metadata === null) return { value: {}, diagnostic: diagnostic("METADATA_INVALID") };
  try {
    // Validate the complete untrusted object before applying the allowlist so
    // a sensitive key hidden under an ignored field is still rejected.
    assertSafePublicValue(metadata, "marketplace.publicMetadata");
  } catch {
    return { value: {}, diagnostic: diagnostic("METADATA_INVALID") };
  }
  if (metadata.fixture !== undefined || metadata.isFixture !== undefined) {
    return { value: {}, diagnostic: diagnostic("METADATA_INVALID") };
  }
  const name = safeString(metadata.name, 160);
  const description = safeString(metadata.description, 2_000);
  if (name === null || description === null) return { value: {}, diagnostic: diagnostic("METADATA_REQUIRED") };

  const result: Record<string, unknown> = {
    name,
    description,
    // Keep the projection's canonical unavailable/observed representation in
    // both version manifests. Raw provider price fields are never retained.
    pricing: pricingManifest
  };
  const slug = safeString(metadata.slug, 160);
  if (slug !== null && marketplaceListingMetadataSchema.shape.slug.safeParse(slug).success) {
    result.slug = slug;
  }

  // `supportedProtocols` and the legacy `protocols` spelling describe one
  // set. Merge and sort them so harmless provider ordering/spelling changes
  // do not create a new immutable version.
  const protocols = [
    ...(safeStringList(metadata.supportedProtocols, 64) ?? []),
    ...(safeStringList(metadata.protocols, 64) ?? [])
  ];
  if (protocols.length > 0) result.supportedProtocols = [...new Set(protocols)].sort();

  const freshnessInput = metadata.dataFreshness ?? metadata.freshness;
  if (freshnessInput !== undefined) {
    result.dataFreshness = normalizeFreshness(freshnessInput);
  }

  // Keep the argument explicit even though pricing already carries the
  // identity network. This assertion protects future callers from silently
  // introducing a cross-network pricing manifest.
  if (pricingManifest.network !== chainId) {
    return { value: {}, diagnostic: diagnostic("METADATA_INVALID") };
  }
  // Service descriptors are observations, not caller claims. Reconstruct a
  // stable descriptor from the persisted observation and exclude probe time,
  // status and response payloads from immutable content.
  result.services = services.map((service) => service.stableDescriptor);
  return { value: result, diagnostic: null };
}

function metadataWithServices(
  metadata: Readonly<Record<string, unknown>>,
  services: readonly NormalizedService[]
): Readonly<Record<string, unknown>> {
  return {
    ...metadata,
    services: services.map((service) => service.stableDescriptor)
  };
}

function serviceKey(kind: string, url: string): string {
  return `${kind}\u0000${url}`;
}

function safeServiceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || controlPattern.test(value)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }
  for (const key of parsed.searchParams.keys()) {
    if (/(?:api[_-]?key|access[_-]?token|authorization|credential|password|private[_-]?key|secret|token)/iu.test(key)) {
      return null;
    }
  }
  return parsed.toString();
}

function latestByService(rows: readonly ServiceRow[]): readonly ServiceRow[] {
  const latest = new Map<string, ServiceRow>();
  for (const row of rows) {
    const key = serviceKey(row.kind, safeServiceUrl(row.url) ?? row.url);
    const previous = latest.get(key);
    if (previous === undefined) {
      latest.set(key, row);
      continue;
    }
    const previousAt = safeDate(previous.observed_at)?.getTime() ?? -1;
    const currentAt = safeDate(row.observed_at)?.getTime() ?? -1;
    if (currentAt > previousAt || (currentAt === previousAt && row.id > previous.id)) latest.set(key, row);
  }
  return [...latest.values()].sort((left, right) => serviceKey(left.kind, safeServiceUrl(left.url) ?? left.url)
    .localeCompare(serviceKey(right.kind, safeServiceUrl(right.url) ?? right.url)));
}

function latestProbeMap(rows: readonly ProbeRow[]): ReadonlyMap<string, ProbeRow> {
  const latest = new Map<string, ProbeRow>();
  for (const row of rows) {
    const normalizedUrl = safeServiceUrl(row.url);
    if (normalizedUrl === null) continue;
    const key = serviceKey(row.kind, normalizedUrl);
    const previous = latest.get(key);
    if (previous === undefined) {
      latest.set(key, row);
      continue;
    }
    const previousAt = safeDate(previous.observed_at)?.getTime() ?? -1;
    const currentAt = safeDate(row.observed_at)?.getTime() ?? -1;
    if (currentAt > previousAt || (currentAt === previousAt && row.id > previous.id)) latest.set(key, row);
  }
  return latest;
}

function normalizeService(row: ServiceRow): NormalizedService | null {
  if (!safeUuidPattern.test(row.id)) return null;
  const observedAt = safeDate(row.observed_at);
  if (observedAt === null) return null;
  const url = safeServiceUrl(row.url);
  if (url === null) return null;
  if (row.safe_capability_probe !== null && row.safe_capability_probe !== undefined) {
    try {
      assertSafePublicValue(row.safe_capability_probe, "marketplace.serviceProbe");
    } catch {
      return null;
    }
  }
  const parsed = advertisedServiceSchema.safeParse({
    kind: row.kind,
    url,
    protocolVersion: row.protocol_version,
    discoverySource: row.discovery_source,
    validationStatus: row.validation_status,
    observedAt: observedAt.toISOString(),
    latencyMs: row.latency_ms,
    safeCapabilityProbe: row.safe_capability_probe
  });
  if (!parsed.success) return null;
  return {
    row,
    advertised: parsed.data,
    stableDescriptor: {
      kind: parsed.data.kind,
      url: parsed.data.url,
      protocolVersion: parsed.data.protocolVersion,
      discoverySource: parsed.data.discoverySource
    }
  };
}

function persistedIdentityMatches(row: IdentityAgentRow, identity: Erc8004Identity): boolean {
  const parsed = parseIdentity({
    namespace: row.namespace,
    chainId: row.chain_id,
    identityRegistry: row.identity_registry,
    agentId: row.agent_id_key
  });
  return parsed !== null && parsed.identityKey === erc8004IdentityKey(identity);
}

function exactReadIsComplete(row: IdentityAgentRow): boolean {
  const observedBlock = typeof row.observed_block === "string" ? Number(row.observed_block) : row.observed_block;
  return observedBlock !== null && Number.isSafeInteger(observedBlock) && observedBlock >= 0 &&
    typeof row.observed_block_hash === "string" && /^0x[0-9a-f]{64}$/iu.test(row.observed_block_hash) &&
    (row.read_consistency === "finalized" || row.read_consistency === "provisional");
}

function safeVersionRow(row: VersionRow): VersionRow | null {
  if (!safeUuidPattern.test(row.id) || !Number.isSafeInteger(row.version) || row.version < 1) return null;
  if (safePublicObject(row.public_metadata) === null || safePublicObject(row.capability_manifest) === null || safePublicObject(row.pricing_manifest) === null) return null;
  try {
    assertSafePublicValue(row.public_metadata, "marketplace.persistedMetadata");
    assertSafePublicValue(row.capability_manifest, "marketplace.persistedCapabilities");
    assertSafePublicValue(row.pricing_manifest, "marketplace.persistedPricing");
  } catch {
    return null;
  }
  return row;
}

function versionContentDigest(row: Pick<VersionRow, "public_metadata" | "capability_manifest" | "pricing_manifest">): string | null {
  try {
    return canonicalSha256Hex({
      publicMetadata: row.public_metadata,
      capabilityManifest: row.capability_manifest,
      pricingManifest: row.pricing_manifest
    });
  } catch {
    return null;
  }
}

function nextPublishableState(current: AgentStateAxes, canPublish: boolean): { readonly state: AgentStateAxes | null; readonly diagnostic: PublicationDiagnostic | null } {
  if (current.verificationStatus === "rejected") return { state: null, diagnostic: diagnostic("VERIFICATION_REJECTED") };
  if (current.runtimeStatus === "paused") return { state: null, diagnostic: diagnostic("RUNTIME_PAUSED") };
  if (current.listingStatus === "delisted") return { state: null, diagnostic: diagnostic("LISTING_DELISTED") };
  if (current.listingStatus === "paused" || current.listingStatus === "suspended") return { state: null, diagnostic: diagnostic("LISTING_MANUAL_REVIEW") };
  if (!canPublish) return { state: null, diagnostic: diagnostic("VERSION_NOT_PUBLISHABLE") };

  const next: AgentStateAxes = { ...current };
  try {
    if (next.verificationStatus !== "verified") {
      assertStateTransition("verificationStatus", next.verificationStatus, "verified");
      next.verificationStatus = "verified";
    }
    if (next.runtimeStatus !== "live") {
      assertStateTransition("runtimeStatus", next.runtimeStatus, "live");
      next.runtimeStatus = "live";
    }
    if (next.listingStatus !== "published") {
      assertStateTransition("listingStatus", next.listingStatus, "published");
      next.listingStatus = "published";
    }
  } catch {
    return { state: null, diagnostic: diagnostic("VERSION_NOT_PUBLISHABLE") };
  }
  return { state: next, diagnostic: null };
}

function noCapabilityDigestMatches(rows: readonly CapabilityRow[], expectedDigest: string): boolean {
  return !rows.some((row) => {
    if (typeof row.manifest_digest !== "string" || row.manifest_digest.toLowerCase() !== expectedDigest) return false;
    try {
      assertSafePublicValue(row.capability_manifest, "marketplace.persistedCapabilities");
    } catch {
      return false;
    }
    const parsed = capabilityManifestSchema.safeParse(row.capability_manifest);
    if (!parsed.success) return false;
    try {
      return canonicalSha256Hex(parsed.data) === expectedDigest;
    } catch {
      return false;
    }
  });
}

function rowsFromResult<T extends Record<string, unknown>>(result: MarketplacePublicationQueryResult<T>): readonly T[] {
  return Array.isArray(result.rows) ? result.rows : [];
}

/**
 * PostgreSQL publication boundary for the W1 marketplace.
 *
 * Ingestion records identity, capability, service and probe observations first;
 * this service is the only owner of immutable marketplace versions and the
 * listing projection update. It never invents health, authority, price or
 * capability facts and never calls a wallet/provider.
 */
export class PostgresMarketplacePublicationService {
  private readonly now: () => Date;
  private readonly serviceHealthMaxAgeMs: number;

  public constructor(
    private readonly pool: MarketplacePublicationPool,
    options: MarketplacePublicationServiceOptions = {}
  ) {
    // Both resolver forms are designed to be passed directly to the existing
    // category/semantic sinks, so do not make callers remember to bind them.
    this.versionIdForIdentity = this.versionIdForIdentity.bind(this);
    this.versionIdForIdentityKey = this.versionIdForIdentityKey.bind(this);
    this.now = options.now ?? (() => new Date());
    this.serviceHealthMaxAgeMs = options.serviceHealthMaxAgeMs ?? defaultServiceHealthMaxAgeMs;
    if (!Number.isSafeInteger(this.serviceHealthMaxAgeMs) || this.serviceHealthMaxAgeMs <= 0) {
      throw new Error("Marketplace publication service health age must be a positive integer.");
    }
  }

  /**
   * Resolve the newest real version for the complete identity tuple. This
   * method is intended for `PgCategoryPredictionSink`'s version resolver and
   * deliberately includes a retained-but-withheld version: category evidence
   * belongs to the observed immutable profile, while the sink itself only
   * changes the agent category when that version is current.
   */
  public async versionIdForIdentity(identity: Erc8004Identity): Promise<string | null> {
    const parsed = parseIdentity(identity);
    if (parsed === null) return null;
    return this.versionIdForIdentityKey(parsed.identityKey);
  }

  public async versionIdForIdentityKey(identityKey: string): Promise<string | null> {
    const parsed = parseIdentityKey(identityKey);
    if (parsed === null) return null;
    const result = await this.pool.query<{ id: string }>(
      `SELECT av.id
         FROM agent_versions av
         JOIN agents a ON a.id = av.agent_id
         JOIN erc8004_identities i ON i.id = a.identity_id
        WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4
        ORDER BY av.version DESC, av."createdAt" DESC, av.id DESC
        LIMIT 1`,
      [parsed.namespace, parsed.chainId, parsed.identityRegistry, parsed.agentId]
    );
    const id = rowsFromResult(result)[0]?.id;
    return typeof id === "string" && safeUuidPattern.test(id) ? id : null;
  }

  /**
   * Create/reuse an immutable version and publish it only when all persisted
   * identity, capability and current service-health evidence is sufficient.
   * Expected candidate failures return sanitized diagnostics; database
   * failures throw a generic error whose cause stays server-side.
   */
  public async publish(input: MarketplacePublicationInput): Promise<MarketplacePublicationResult> {
    const identity = parseIdentity(input?.identity);
    if (identity === null) return withheld(null, [diagnostic("IDENTITY_NOT_FOUND")]);

    const preparedInput = this.prepareInput(identity.identity, identity.identityKey, input);
    if (preparedInput.input === null) {
      return withheld(identity.identityKey, [preparedInput.diagnostic]);
    }

    let client: MarketplacePublicationClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new MarketplacePublicationError();
    }
    try {
      await client.query("BEGIN");
      const result = await this.publishInTransaction(client, preparedInput.input);
      await client.query("COMMIT");
      return result;
    } catch {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the generic publication failure; the pool discards a bad client.
      }
      throw new MarketplacePublicationError();
    } finally {
      client.release();
    }
  }

  private prepareInput(
    identity: Erc8004Identity,
    identityKey: string,
    input: MarketplacePublicationInput
  ): PreparedInputResult {
    try {
      // Validate the unparsed object first; Zod intentionally strips unknown
      // fields, and a credential-bearing field must not disappear silently.
      assertSafePublicValue(input?.capabilityManifest, "marketplace.capabilityManifest");
    } catch {
      return { input: null, diagnostic: diagnostic("CAPABILITY_INVALID") };
    }
    const capabilityResult = capabilityManifestSchema.safeParse(input?.capabilityManifest);
    if (!capabilityResult.success) return { input: null, diagnostic: diagnostic("CAPABILITY_INVALID") };
    try {
      assertSafePublicValue(capabilityResult.data, "marketplace.capabilityManifest");
    } catch {
      return { input: null, diagnostic: diagnostic("CAPABILITY_INVALID") };
    }
    const metadata = safePublicObject(input?.publicMetadata);
    if (metadata === null) return { input: null, diagnostic: diagnostic("METADATA_INVALID") };
    try {
      assertSafePublicValue(metadata, "marketplace.publicMetadata");
    } catch {
      return { input: null, diagnostic: diagnostic("METADATA_INVALID") };
    }
    // The explicit pricing argument is the preferred observation. A
    // registration-level `pricing` object is accepted only as a fallback;
    // either way it is reduced to the read-model's known representation.
    const pricing = input?.pricingManifest ?? metadata.pricing;
    if (pricing !== undefined) {
      try {
        assertSafePublicValue(pricing, "marketplace.pricingManifest");
      } catch {
        return { input: null, diagnostic: diagnostic("METADATA_INVALID") };
      }
    }
    const pricingManifest = normalizePricingManifest(pricing, identity.chainId);
    // Metadata is normalized after persisted services are loaded, so retain
    // only the input object here and validate it inside the transaction.
    return {
      input: {
        identity,
        identityKey,
        publicMetadata: metadata,
        capabilityManifest: capabilityResult.data,
        pricingManifest
      },
      diagnostic: diagnostic("METADATA_INVALID")
    };
  }

  private async publishInTransaction(
    client: MarketplacePublicationClient,
    input: NormalizedPublicationInput
  ): Promise<MarketplacePublicationResult> {
    const identityResult = await client.query<IdentityAgentRow>(
      `SELECT i.id AS identity_id, a.id AS agent_id,
              i.namespace, i.chain_id, i.identity_registry, i.agent_id AS agent_id_key,
              i.owner_address, i.agent_uri, i.observed_block, i.observed_block_hash,
              i.read_consistency, a.current_version_id, a.origin_type, a.claim_status,
              a.verification_status, a.runtime_status, a.authority_status, a.listing_status
         FROM erc8004_identities i
         JOIN agents a ON a.identity_id = i.id
        WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4
        FOR UPDATE OF i, a`,
      [input.identity.namespace, input.identity.chainId, input.identity.identityRegistry, input.identity.agentId]
    );
    const identityRow = rowsFromResult(identityResult)[0];
    if (identityRow === undefined || !persistedIdentityMatches(identityRow, input.identity)) {
      return withheld(input.identityKey, [diagnostic("IDENTITY_NOT_FOUND")]);
    }
    const baseState = stateFromRow(identityRow);
    if (baseState === null) return withheld(input.identityKey, [diagnostic("VERSION_NOT_PUBLISHABLE")], { agentId: identityRow.agent_id });
    const readProvenanceDiagnostic = !exactReadIsComplete(identityRow)
      ? diagnostic("IDENTITY_READ_MISSING")
      : identityRow.read_consistency !== "finalized"
        ? diagnostic("IDENTITY_READ_NOT_FINALIZED")
        : identityRow.agent_uri === null || identityRow.agent_uri.trim().length === 0
          ? diagnostic("IDENTITY_URI_MISSING")
          : null;

    const capabilityResult = await client.query<CapabilityRow>(
      `SELECT capability_manifest, manifest_digest
         FROM agent_capability_observations
        WHERE identity_id = $1
        ORDER BY observed_at DESC, id DESC`,
      [identityRow.identity_id]
    );
    const expectedCapabilityDigest = canonicalSha256Hex(input.capabilityManifest);
    if (noCapabilityDigestMatches(rowsFromResult(capabilityResult), expectedCapabilityDigest)) {
      return withheld(input.identityKey, [diagnostic("CAPABILITY_NOT_PERSISTED")], { agentId: identityRow.agent_id, state: baseState });
    }

    const serviceResult = await client.query<ServiceRow>(
      `SELECT id, kind, url, protocol_version, discovery_source, validation_status,
              observed_at, latency_ms, safe_capability_probe
         FROM agent_service_observations
        WHERE identity_id = $1
        ORDER BY kind, url, observed_at DESC, id DESC`,
      [identityRow.identity_id]
    );
    const serviceRows = latestByService(rowsFromResult(serviceResult));
    const services: NormalizedService[] = [];
    for (const row of serviceRows) {
      const normalized = normalizeService(row);
      if (normalized === null) {
        // A malformed observation is never copied into a version. Retain the
        // identity/capability record for the next repair run and report a
        // stable diagnostic rather than leaking the provider payload.
        return withheld(input.identityKey, [diagnostic("SERVICE_INVALID")], { agentId: identityRow.agent_id, state: baseState });
      }
      if (normalized.advertised.validationStatus !== "rejected") services.push(normalized);
    }

    const probeResult = await client.query<ProbeRow>(
      `SELECT id, kind, url, validation_status, observed_at
         FROM agent_service_probe_results
        WHERE identity_id = $1
        ORDER BY kind, url, observed_at DESC, id DESC`,
      [identityRow.identity_id]
    );
    const latestProbes = latestProbeMap(rowsFromResult(probeResult));
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error("invalid publication clock");
    let healthyServiceCount = 0;
    let hasFreshProbe = false;
    let hasStaleOrUnhealthy = false;
    for (const service of services) {
      const probe = latestProbes.get(serviceKey(service.advertised.kind, service.advertised.url));
      if (probe === undefined) continue;
      const observedAt = safeDate(probe.observed_at);
      if (observedAt === null) {
        hasStaleOrUnhealthy = true;
        continue;
      }
      const age = now.getTime() - observedAt.getTime();
      if (age < 0 || age > this.serviceHealthMaxAgeMs || probe.validation_status !== "healthy") {
        hasStaleOrUnhealthy = true;
        continue;
      }
      healthyServiceCount += 1;
      hasFreshProbe = true;
    }
    const metadataResult = normalizePublicMetadata(
      input.publicMetadata,
      services,
      input.pricingManifest,
      input.identity.chainId
    );
    if (metadataResult.diagnostic !== null) {
      return withheld(input.identityKey, [metadataResult.diagnostic], { agentId: identityRow.agent_id, state: baseState });
    }
    const publicMetadata = metadataWithServices(metadataResult.value, services);
    const normalizedInput: NormalizedPublicationInput = { ...input, publicMetadata };
    const preparation: PublicationPreparation = { input: normalizedInput, services, latestProbes, healthyServiceCount, hasFreshProbe };

    const versionResult = await client.query<VersionRow>(
      `SELECT id, version, public_metadata, capability_manifest, pricing_manifest
         FROM agent_versions
        WHERE agent_id = $1
        ORDER BY version ASC, "createdAt" ASC, id ASC
        FOR UPDATE`,
      [identityRow.agent_id]
    );
    const version = await this.selectOrCreateVersion(
      client,
      identityRow.agent_id,
      identityRow.current_version_id,
      preparation,
      rowsFromResult(versionResult)
    );
    // Persist the version's immutable service set even when publication is
    // withheld. Probe freshness is a separate, mutable observation and must
    // not make the advertised service disappear from the audit trail.
    await this.attachServices(client, version.id, preparation.services);

    if (readProvenanceDiagnostic !== null) {
      return withheld(input.identityKey, [readProvenanceDiagnostic], {
        agentId: identityRow.agent_id,
        versionId: version.id,
        version: version.version,
        contentDigest: version.contentDigest,
        versionCreated: version.created,
        versionReused: !version.created,
        state: baseState
      });
    }

    if (preparation.services.length === 0) {
      return withheld(input.identityKey, [diagnostic("SERVICE_MISSING")], {
        agentId: identityRow.agent_id,
        versionId: version.id,
        version: version.version,
        contentDigest: version.contentDigest,
        versionCreated: version.created,
        versionReused: !version.created,
        state: baseState
      });
    }

    if (!preparation.hasFreshProbe) {
      return withheld(input.identityKey, [diagnostic(hasStaleOrUnhealthy ? "SERVICE_HEALTH_STALE" : "SERVICE_HEALTH_UNVERIFIED")], {
        agentId: identityRow.agent_id,
        versionId: version.id,
        version: version.version,
        contentDigest: version.contentDigest,
        versionCreated: version.created,
        versionReused: !version.created,
        state: baseState
      });
    }

    const publishState = nextPublishableState(baseState, healthyServiceCount > 0 && preparation.hasFreshProbe);
    if (publishState.state === null) {
      // Retain a newly observed immutable version for audit/review, but never
      // replace an already published current version with an unpublishable one.
      return withheld(input.identityKey, [publishState.diagnostic ?? diagnostic("VERSION_NOT_PUBLISHABLE")], {
        agentId: identityRow.agent_id,
        versionId: version.id,
        version: version.version,
        contentDigest: version.contentDigest,
        versionCreated: version.created,
        versionReused: !version.created,
        state: baseState
      });
    }

    // Publication owns only the three projection axes it advances. Claim,
    // origin and authority remain independent ingestion/authority concerns;
    // comparing all six axes here would report an update merely because one
    // of those unrelated axes changed between reads.
    const shouldUpdateCurrent = identityRow.current_version_id !== version.id ||
      identityRow.verification_status !== publishState.state.verificationStatus ||
      identityRow.runtime_status !== publishState.state.runtimeStatus ||
      identityRow.listing_status !== publishState.state.listingStatus;
    if (shouldUpdateCurrent) {
      const updated = await client.query(
        `UPDATE agents
            SET current_version_id = $1,
                verification_status = $2,
                runtime_status = $3,
                listing_status = $4,
                "updatedAt" = $5
          WHERE id = $6`,
        [version.id, publishState.state.verificationStatus, publishState.state.runtimeStatus, publishState.state.listingStatus, now, identityRow.agent_id]
      );
      if (updated.rowCount !== undefined && updated.rowCount !== null && updated.rowCount !== 1) throw new Error("publication state update was not applied");
    }
    return published({
      identityKey: input.identityKey,
      agentId: identityRow.agent_id,
      version,
      state: publishState.state,
      currentVersionUpdated: shouldUpdateCurrent
    });
  }

  private async selectOrCreateVersion(
    client: MarketplacePublicationClient,
    agentId: string,
    currentVersionId: string | null,
    preparation: PublicationPreparation,
    existingRows: readonly VersionRow[]
  ): Promise<VersionSelection> {
    const contentDigest = canonicalSha256Hex({
      publicMetadata: preparation.input.publicMetadata,
      capabilityManifest: preparation.input.capabilityManifest,
      pricingManifest: preparation.input.pricingManifest
    });
    const safeRows = existingRows
      .map((row) => safeVersionRow(row))
      .filter((row): row is VersionRow => row !== null)
      .sort((left, right) => left.version - right.version || left.id.localeCompare(right.id));
    const current = currentVersionId === null
      ? null
      : safeRows.find((row) => row.id === currentVersionId) ?? null;
    const latest = safeRows.at(-1) ?? null;

    // A replay of the current version is always idempotent. If a newer
    // profile was retained while publication was withheld, replay that
    // retained profile too. A reversion to content older than the published
    // current version deliberately receives a new immutable version so the
    // observed sequence remains auditable (v1 -> v2 -> v3), rather than
    // moving the pointer backwards to v1.
    if (current !== null && versionContentDigest(current) === contentDigest) {
      return { id: current.id, version: current.version, contentDigest, created: false };
    }
    if (
      current === null && latest !== null && versionContentDigest(latest) === contentDigest
    ) {
      return { id: latest.id, version: latest.version, contentDigest, created: false };
    }
    if (
      current !== null && latest !== null && latest.version > current.version &&
      versionContentDigest(latest) === contentDigest
    ) {
      return { id: latest.id, version: latest.version, contentDigest, created: false };
    }
    const highestVersion = existingRows.reduce((highest, row) => Number.isSafeInteger(row.version) && row.version > highest ? row.version : highest, 0);
    if (highestVersion >= 2_147_483_647) throw new Error("marketplace version number exhausted");
    const version = highestVersion + 1;
    const id = deterministicUuid(`bnbera.marketplace.version:${erc8004IdentityKey(preparation.input.identity)}:${version}:${contentDigest}`);
    const inserted = await client.query<{ id: string; version: number }>(
      `INSERT INTO agent_versions
        (id, agent_id, version, public_metadata, capability_manifest, pricing_manifest)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id, version`,
      [id, agentId, version, JSON.stringify(preparation.input.publicMetadata), JSON.stringify(preparation.input.capabilityManifest), JSON.stringify(preparation.input.pricingManifest)]
    );
    const row = rowsFromResult(inserted)[0];
    if (row !== undefined && row.id === id && row.version === version) return { id, version, contentDigest, created: true };
    const reread = await client.query<VersionRow>(
      `SELECT id, version, public_metadata, capability_manifest, pricing_manifest
         FROM agent_versions
        WHERE agent_id = $1 AND version = $2
        FOR UPDATE`,
      [agentId, version]
    );
    const existing = rowsFromResult(reread).find((candidate) => candidate.id === id) ?? rowsFromResult(reread)[0];
    if (existing === undefined || versionContentDigest(existing) !== contentDigest) {
      throw new Error("deterministic marketplace version conflict");
    }
    return { id: existing.id, version: existing.version, contentDigest, created: false };
  }

  private async attachServices(
    client: MarketplacePublicationClient,
    versionId: string,
    services: readonly NormalizedService[]
  ): Promise<void> {
    for (const service of services) {
      const id = deterministicUuid(`bnbera.marketplace.service:${versionId}:${service.advertised.kind}:${service.advertised.url}`);
      await client.query(
        `INSERT INTO agent_services
          (id, agent_version_id, kind, url, protocol_version, discovery_source,
           validation_status, observed_at, latency_ms, safe_capability_probe)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         ON CONFLICT (agent_version_id, kind, url) DO NOTHING`,
        [id, versionId, service.advertised.kind, service.advertised.url, service.advertised.protocolVersion,
          service.advertised.discoverySource, service.advertised.validationStatus, service.advertised.observedAt,
          service.advertised.latencyMs ?? null, service.advertised.safeCapabilityProbe === null || service.advertised.safeCapabilityProbe === undefined
            ? null
            : JSON.stringify(service.advertised.safeCapabilityProbe)]
      );
    }
  }
}

export class MarketplacePublicationError extends Error {
  public constructor() {
    super("Marketplace publication could not be completed.");
    this.name = "MarketplacePublicationError";
  }
}

function stateFromRow(row: IdentityAgentRow): AgentStateAxes | null {
  const parsed = agentStateAxesSchema.safeParse({
    originType: row.origin_type,
    claimStatus: row.claim_status,
    verificationStatus: row.verification_status,
    runtimeStatus: row.runtime_status,
    authorityStatus: row.authority_status,
    listingStatus: row.listing_status
  });
  return parsed.success ? parsed.data : null;
}

function parseIdentityKey(value: string): Erc8004Identity | null {
  if (typeof value !== "string" || controlPattern.test(value)) return null;
  const parts = value.split(":");
  if (parts.length !== 4) return null;
  if (!/^[1-9][0-9]*$/u.test(parts[1] ?? "")) return null;
  const chainId = Number(parts[1]);
  if (!Number.isSafeInteger(chainId)) return null;
  return parseIdentity({
    namespace: parts[0],
    chainId,
    identityRegistry: parts[2],
    agentId: parts[3]
  })?.identity ?? null;
}
