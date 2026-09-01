import {
  advertisedServiceSchema,
  capabilityManifestSchema,
  canonicalSha256Hex,
  erc8004IdentityKey,
  erc8004IdentitySchema,
  normalizeErc8004Identity,
  normalizeEvmAddress,
  serviceKindSchema,
  serviceValidationStatusSchema,
  type AdvertisedService,
  type CapabilityManifest
} from "@bnbera/domain";
import { z } from "zod";
import { ingestionError } from "./errors.js";
import { directIdentityFields } from "./types.js";
import type {
  CapabilityObservation,
  ChainObservation,
  IdentityCandidate,
  IdentityKey,
  IngestionSource,
  RegistryEvent,
  ServiceObservation,
  DirectIdentityField
} from "./types.js";

const digestSchema = z.string().regex(/^[0-9a-fA-F]{64}$/);
const safeReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Reference contains control characters");

const publicObjectSchema = z.record(z.string(), z.unknown());

const sensitiveKey = /(private[_-]?key|secret|password|mnemonic|seed phrase|access[_-]?token|api[_-]?key|authorization|credential)/iu;

/**
 * Metadata arrives from untrusted registry documents and provider APIs. Keep
 * the accepted shape bounded and reject obvious credential material before it
 * reaches a repository, log, embedding job, or evidence publisher.
 */
export function assertSafePublicValue(value: unknown, path = "metadata", depth = 0, budget = { nodes: 0 }): void {
  if (depth > 8 || budget.nodes++ > 2_048) {
    throw ingestionError(
      "INGESTION_INPUT_INVALID",
      "The public metadata is too deeply nested or large.",
      "reduce_metadata"
    );
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The public metadata contains an invalid number.", "fix_metadata");
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 10_000) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The public metadata contains an oversized string.", "reduce_metadata");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The public metadata contains too many array items.", "reduce_metadata");
    }
    value.forEach((item, index) => assertSafePublicValue(item, `${path}[${index}]`, depth + 1, budget));
    return;
  }
  if (typeof value !== "object") {
    throw ingestionError("INGESTION_INPUT_INVALID", "The public metadata contains an unsupported value.", "fix_metadata");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The public metadata must contain plain JSON values.", "fix_metadata");
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw ingestionError(
        "INGESTION_INPUT_INVALID",
        "Credential-bearing fields are not accepted as public agent metadata.",
        "remove_sensitive_fields"
      );
    }
    assertSafePublicValue(child, `${path}.${key}`, depth + 1, budget);
  }
}

export function normalizeSourceReference(value: unknown): string {
  const result = safeReferenceSchema.safeParse(value);
  if (!result.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", "A stable source reference is required.", "provide_source_reference", result.error);
  }
  return result.data;
}

export function normalizeDigest(value: unknown, fieldName = "digest"): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const result = digestSchema.safeParse(value);
  if (!result.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", `The ${fieldName} must be a SHA-256 digest.`, "fix_digest", result.error);
  }
  return result.data.toLowerCase();
}

export function normalizeIdentity(value: unknown) {
  const parsed = erc8004IdentitySchema.safeParse(value);
  if (!parsed.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The ERC-8004 identity is invalid.", "fix_identity", parsed.error);
  }
  return normalizeErc8004Identity(parsed.data);
}

export function normalizeCandidate(input: IdentityCandidate): IdentityCandidate {
  const identity = normalizeIdentity(input.identity);
  const sourceReference = normalizeSourceReference(input.sourceReference);
  if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The discovery timestamp is invalid.", "fix_timestamp");
  }
  if (input.metadata !== undefined) {
    publicObjectSchema.parse(input.metadata);
    assertSafePublicValue(input.metadata);
  }
  if (input.services !== undefined) {
    assertSafePublicValue(input.services, "services");
  }
  if (input.capabilityManifest !== undefined) {
    assertSafePublicValue(input.capabilityManifest, "capabilityManifest");
  }
  const rawResponseDigest = normalizeDigest(input.rawResponseDigest, "raw response digest");
  const normalizedIngestionVersion = input.normalizedIngestionVersion.trim();
  if (normalizedIngestionVersion.length === 0 || normalizedIngestionVersion.length > 64) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The ingestion version is invalid.", "fix_ingestion_version");
  }
  return {
    identity,
    source: input.source,
    sourceReference,
    observedAt: input.observedAt,
    normalizedIngestionVersion,
    ...(rawResponseDigest === null ? {} : { rawResponseDigest }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.services === undefined ? {} : { services: input.services }),
    ...(input.capabilityManifest === undefined ? {} : { capabilityManifest: input.capabilityManifest })
  };
}

export function normalizeManualImport(input: {
  readonly identity: unknown;
  readonly importReference: unknown;
  readonly importedAt?: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly services?: readonly unknown[];
  readonly capabilityManifest?: unknown;
}): IdentityCandidate {
  return normalizeCandidate({
    identity: normalizeIdentity(input.identity),
    source: "manual",
    sourceReference: normalizeSourceReference(input.importReference),
    observedAt: input.importedAt ?? new Date(),
    normalizedIngestionVersion: "manual-v1",
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.services === undefined ? {} : { services: input.services }),
    ...(input.capabilityManifest === undefined ? {} : { capabilityManifest: input.capabilityManifest })
  });
}

export function normalizeRegistryEvent(input: RegistryEvent): {
  readonly identity: ReturnType<typeof normalizeIdentity>;
  readonly eventType: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly ownerAddress: string | null;
  readonly agentUri: string | null;
  readonly agentWallet: string | null;
  readonly contentDigest: string | null;
  readonly observedFields: readonly DirectIdentityField[];
  readonly observedAt: Date;
  readonly payloadDigest: string | null;
} {
  const identity = normalizeIdentity(input.identity);
  const hashResult = z.string().regex(/^0x[0-9a-fA-F]{64}$/u).safeParse(input.transactionHash);
  const blockHashResult = z.string().regex(/^0x[0-9a-fA-F]{64}$/u).safeParse(input.blockHash);
  if (!hashResult.success || !blockHashResult.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry event hashes are invalid.", "fix_chain_event");
  }
  if (!Number.isSafeInteger(input.logIndex) || input.logIndex < 0 || !Number.isSafeInteger(input.blockNumber) || input.blockNumber < 0) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry event position is invalid.", "fix_chain_event");
  }
  const eventType = input.eventType.trim();
  if (eventType.length === 0 || eventType.length > 128) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry event type is invalid.", "fix_chain_event");
  }
  if (input.payload !== undefined) {
    assertSafePublicValue(input.payload, "event.payload");
  }
  const observedFields = input.changedFields === undefined
    ? directIdentityFields.filter((field) => Object.prototype.hasOwnProperty.call(input, field))
    : [...input.changedFields];
  if (new Set(observedFields).size !== observedFields.length || observedFields.some((field) => !directIdentityFields.includes(field))) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry event changed-field list is invalid.", "fix_chain_event");
  }
  const observedAt = input.observedAt ?? new Date();
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The registry observation timestamp is invalid.", "fix_timestamp");
  }
  return {
    identity,
    eventType,
    transactionHash: hashResult.data.toLowerCase(),
    logIndex: input.logIndex,
    blockNumber: input.blockNumber,
    blockHash: blockHashResult.data.toLowerCase(),
    ownerAddress: normalizeNullableAddress(input.ownerAddress),
    agentUri: normalizeNullableUri(input.agentUri),
    agentWallet: normalizeNullableAddress(input.agentWallet),
    contentDigest: normalizeDigest(input.contentDigest, "content digest"),
    observedFields,
    observedAt,
    payloadDigest: input.payload === undefined ? null : canonicalSha256Hex(input.payload)
  };
}

export type ServiceInput = {
  readonly kind: unknown;
  readonly url: unknown;
  readonly protocolVersion: unknown;
  readonly validationStatus?: unknown;
  readonly observedAt?: Date;
  readonly latencyMs?: unknown;
  readonly safeCapabilityProbe?: unknown;
};

export function normalizeService(
  identityKey: IdentityKey,
  source: IngestionSource,
  input: ServiceInput,
  capabilityManifestDigest: string | null = null,
  observedAt = new Date()
): ServiceObservation {
  const kind = serviceKindSchema.safeParse(input.kind);
  const protocolVersion = typeof input.protocolVersion === "string" ? input.protocolVersion.trim() : "";
  if (!kind.success || protocolVersion.length === 0 || protocolVersion.length > 128) {
    throw ingestionError("SERVICE_INVALID", "The advertised service descriptor is invalid.", "review_service");
  }
  const url = normalizeServiceUrl(input.url);
  const validationStatus = serviceValidationStatusSchema.safeParse(input.validationStatus ?? "pending");
  if (!validationStatus.success) {
    throw ingestionError("SERVICE_INVALID", "The advertised service validation state is invalid.", "review_service");
  }
  const latencyMs = input.latencyMs === undefined || input.latencyMs === null ? null : Number(input.latencyMs);
  if (latencyMs !== null && (!Number.isSafeInteger(latencyMs) || latencyMs < 0 || latencyMs > 300_000)) {
    throw ingestionError("SERVICE_INVALID", "The advertised service latency is invalid.", "review_service");
  }
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) {
    throw ingestionError("SERVICE_INVALID", "The service observation timestamp is invalid.", "fix_timestamp");
  }
  let safeCapabilityProbe: Record<string, unknown> | null = null;
  if (input.safeCapabilityProbe !== undefined && input.safeCapabilityProbe !== null) {
    publicObjectSchema.parse(input.safeCapabilityProbe);
    assertSafePublicValue(input.safeCapabilityProbe, "service.safeCapabilityProbe");
    safeCapabilityProbe = input.safeCapabilityProbe as Record<string, unknown>;
  }
  const service: AdvertisedService = {
    kind: kind.data,
    url,
    protocolVersion,
    discoverySource: source,
    validationStatus: validationStatus.data,
    observedAt: observedAt.toISOString(),
    ...(latencyMs === null ? { latencyMs: null } : { latencyMs }),
    ...(safeCapabilityProbe === null ? { safeCapabilityProbe: null } : { safeCapabilityProbe })
  };
  advertisedServiceSchema.parse(service);
  return { ...service, identityKey, capabilityManifestDigest };
}

export type ServiceDiscoveryResult = {
  readonly accepted: readonly ServiceObservation[];
  readonly rejected: readonly { readonly input: unknown; readonly reason: string }[];
};

export function normalizeServices(
  identityKey: IdentityKey,
  source: IngestionSource,
  inputs: readonly unknown[],
  capabilityManifestDigest: string | null = null,
  observedAt = new Date()
): ServiceDiscoveryResult {
  const accepted = new Map<string, ServiceObservation>();
  const rejected: { input: unknown; reason: string }[] = [];
  for (const input of inputs) {
    try {
      const service = normalizeService(
        identityKey,
        source,
        input as ServiceInput,
        capabilityManifestDigest,
        observedAt
      );
      accepted.set(`${service.kind}:${service.url}`, service);
    } catch (error) {
      rejected.push({ input, reason: error instanceof Error ? error.message : "invalid service" });
    }
  }
  return { accepted: [...accepted.values()], rejected };
}

export function normalizeCapabilityManifest(
  identityKey: IdentityKey,
  source: IngestionSource,
  input: unknown,
  observedAt = new Date()
): CapabilityObservation {
  assertSafePublicValue(input, "capabilityManifest");
  const parsed = capabilityManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The capability manifest is invalid.", "fix_capabilities", parsed.error);
  }
  const manifest: CapabilityManifest = parsed.data;
  return {
    identityKey,
    source,
    schemaVersion: manifest.schemaVersion,
    capabilityManifest: manifest,
    manifestDigest: canonicalSha256Hex(manifest),
    observedAt
  };
}

export function registryEventToObservation(input: RegistryEvent): ChainObservation {
  const normalized = normalizeRegistryEvent(input);
  const identityKey = erc8004IdentityKey(normalized.identity);
  return {
    identityKey,
    identity: normalized.identity,
    eventType: normalized.eventType,
    transactionHash: normalized.transactionHash,
    logIndex: normalized.logIndex,
    blockNumber: normalized.blockNumber,
    blockHash: normalized.blockHash,
    confirmationState: "provisional",
    ownerAddress: normalized.ownerAddress,
    agentUri: normalized.agentUri,
    agentWallet: normalized.agentWallet,
    contentDigest: normalized.contentDigest,
    observedFields: normalized.observedFields,
    firstObservedAt: normalized.observedAt,
    canonicalizedAt: null,
    orphanedAt: null,
    payloadDigest: normalized.payloadDigest
  };
}

function normalizeNullableAddress(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return normalizeEvmAddress(value);
  } catch (cause) {
    throw ingestionError("INGESTION_INPUT_INVALID", "An onchain address is invalid.", "fix_chain_event", cause);
  }
}

function normalizeNullableUri(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = z.string().url().safeParse(value);
  if (!parsed.success) {
    throw ingestionError("INGESTION_INPUT_INVALID", "The agent URI is invalid.", "fix_chain_event", parsed.error);
  }
  return parsed.data;
}

function normalizeServiceUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw ingestionError("SERVICE_INVALID", "The advertised service URL is invalid.", "review_service");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw ingestionError("SERVICE_INVALID", "The advertised service URL is invalid.", "review_service", cause);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw ingestionError(
      "SERVICE_INVALID",
      "Service URLs must be HTTP(S) URLs without credentials or fragments.",
      "review_service"
    );
  }
  return parsed.toString();
}
