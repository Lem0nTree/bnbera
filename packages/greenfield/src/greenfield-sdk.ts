import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import {
  PublicationProviderError,
  type GreenfieldCreateReceipt,
  type GreenfieldCreateReconciliation,
  type GreenfieldInspectReceipt,
  type GreenfieldPublisher,
  type GreenfieldSealReceipt,
  type GreenfieldUploadReceipt,
  type PublicationUploadInput
} from "./types.js";

/** The network and SDK chain id are pinned by the active standards lock. */
export const GREENFIELD_TESTNET_NETWORK = "greenfield_5600-1" as const;
export const GREENFIELD_TESTNET_CHAIN_ID = "5600" as const;
export const GREENFIELD_SDK_PACKAGE = "@bnb-chain/greenfield-js-sdk" as const;
export const GREENFIELD_SDK_VERSION = "2.2.0" as const;
export const GREENFIELD_REED_SOLOMON_PACKAGE = "@bnb-chain/reed-solomon" as const;
export const GREENFIELD_REED_SOLOMON_VERSION = "1.1.4" as const;
/** Zero additional charged read quota keeps the one-off public canary bounded. */
export const GREENFIELD_CANARY_CHARGED_READ_QUOTA = "0" as const;

export interface GreenfieldStorageProviderPin {
  readonly providerLabel: string;
  readonly endpoint: string;
  /** Standards-lock SP operator address used in the bucket create message. */
  readonly operatorAddress: string;
  readonly publicReadBaseUrls?: readonly string[];
}

/** Standards-lock projection consumed by the runtime adapter. The coordinator
 * supplies the concrete package/provider pins; an empty provider list keeps
 * this implementation disabled until that lock is updated. */
export interface GreenfieldStandardsPins {
  readonly networkId: string;
  readonly sdkChainId: string;
  readonly sdkPackage: string;
  readonly sdkVersion: string;
  readonly storageProviders: readonly GreenfieldStorageProviderPin[];
  readonly publicReadBaseUrls: readonly string[];
}

export const GREENFIELD_CANDIDATE_STANDARDS_PINS: GreenfieldStandardsPins = {
  networkId: GREENFIELD_TESTNET_NETWORK,
  sdkChainId: GREENFIELD_TESTNET_CHAIN_ID,
  sdkPackage: GREENFIELD_SDK_PACKAGE,
  sdkVersion: GREENFIELD_SDK_VERSION,
  storageProviders: [],
  publicReadBaseUrls: []
};

const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/;
const bucketPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const objectNamePattern = /^[^\\\u0000-\u001f\u007f]+$/;

type UnknownRecord = Record<string, unknown>;

interface GreenfieldSdkTxResponse {
  readonly simulate?: (options: UnknownRecord) => Promise<UnknownRecord>;
  readonly broadcast: (options: UnknownRecord) => Promise<UnknownRecord>;
}

interface GreenfieldSdkObjectApi {
  readonly createObject: (message: UnknownRecord) => Promise<GreenfieldSdkTxResponse>;
  readonly uploadObject: (params: UnknownRecord, auth: UnknownRecord) => Promise<UnknownRecord>;
  readonly getObject: (params: UnknownRecord, auth: UnknownRecord) => Promise<UnknownRecord>;
  readonly getObjectMeta: (params: UnknownRecord) => Promise<UnknownRecord>;
  readonly headObject?: (bucketName: string, objectName: string) => Promise<UnknownRecord>;
}

interface GreenfieldSdkBucketApi {
  /** Official SDK shape: createBucket returns a simulate/broadcast tx object. */
  readonly createBucket?: (message: UnknownRecord) => Promise<GreenfieldSdkTxResponse>;
  /** Official SDK query shape: headBucket receives the bucket name directly. */
  readonly headBucket: (bucketName: string) => Promise<UnknownRecord>;
  /** SP metadata includes the operator address used to bind a bucket to its SP. */
  readonly getBucketMeta?: (params: UnknownRecord) => Promise<UnknownRecord>;
}

interface GreenfieldSdkVirtualGroupApi {
  readonly getGlobalVirtualGroupFamily?: (request: UnknownRecord) => Promise<unknown>;
}

interface GreenfieldSdkSpApi {
  readonly getSPUrlByBucket?: (bucketName: string) => Promise<string>;
  readonly getStorageProviders?: () => Promise<unknown>;
}

interface GreenfieldSdkClient {
  readonly object: GreenfieldSdkObjectApi;
  readonly bucket?: GreenfieldSdkBucketApi;
  readonly sp?: GreenfieldSdkSpApi;
  readonly virtualGroup?: GreenfieldSdkVirtualGroupApi;
}

interface GreenfieldSdkModule {
  readonly Client?: { readonly create: (rpcUrl: string, chainId: string) => GreenfieldSdkClient };
  readonly Long?: { readonly fromNumber?: (value: number) => unknown; readonly fromString?: (value: string) => unknown };
  readonly VisibilityType?: UnknownRecord;
  readonly RedundancyType?: UnknownRecord;
}

interface ReedSolomonInstance {
  readonly encode: (bytes: Uint8Array) => readonly string[];
}

interface ReedSolomonModule {
  readonly ReedSolomon?: new (...args: number[]) => ReedSolomonInstance;
  readonly default?: new (...args: number[]) => ReedSolomonInstance;
}

export interface GreenfieldSecretLoader {
  (reference: string): Promise<string> | string;
}

export interface GreenfieldSdkPublisherOptions {
  /** Must remain `greenfield_5600-1` until the standards lock is updated. */
  readonly network: string;
  /** SDK chain id (`5600` for Greenfield testnet). */
  readonly chainId?: string;
  readonly rpcUrl: string;
  readonly bucket: string;
  /** Address authorized to create objects in the configured bucket. */
  readonly creator: string;
  /** Secret-manager/env reference, never the private-key value itself. */
  readonly keyReference: string;
  readonly loadSecret: GreenfieldSecretLoader;
  readonly standardsPins: GreenfieldStandardsPins;
  readonly providerLabel?: string;
  /** Explicit SP endpoint is preferred for a pinned canary. */
  readonly spEndpoint?: string;
  /** Public HTTPS is informational and never used as the internal locator. */
  readonly publicBaseUrl?: string;
  readonly sdkModule?: GreenfieldSdkModule;
  readonly sdkClient?: GreenfieldSdkClient;
  readonly reedSolomonModule?: ReedSolomonModule;
  readonly transaction?: {
    readonly denom: string;
    readonly gasLimit?: number;
    readonly gasPrice?: string;
    readonly granter?: string;
  };
  readonly uploadDurationMs?: number;
}

export interface GreenfieldPublicUriOptions {
  readonly baseUrl: string;
  readonly bucket: string;
  readonly objectName: string;
}

export interface GreenfieldBucketEnsureReceipt {
  readonly status: "reused" | "created" | "unknown";
  readonly bucketName: string;
  readonly owner: string;
  readonly primarySpAddress: string;
  readonly visibility: "public-read";
  readonly creationTransactionHash: string | null;
}

export interface GreenfieldBucketReconcileReceipt {
  readonly status: "present" | "missing" | "unknown";
  readonly bucketName: string;
  readonly owner: string | null;
  readonly primarySpAddress: string | null;
  readonly visibility: "public-read" | null;
  readonly creationTransactionHash: string | null;
}

/**
 * Build the operator-facing public URL separately from the durable internal
 * locator. The publisher persists `greenfield://bucket/object`; this helper
 * is only for a UI/API projection that explicitly opts into HTTPS.
 */
export function greenfieldPublicHttpsUri(input: GreenfieldPublicUriOptions): string {
  const base = new URL(input.baseUrl);
  if (base.protocol !== "https:") {
    throw new Error("Greenfield public URL must use HTTPS");
  }
  if (!bucketPattern.test(input.bucket) || !objectNamePattern.test(input.objectName) || input.objectName.startsWith("/")) {
    throw new Error("Invalid Greenfield public URI target");
  }
  const prefix = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return new URL(`${encodeURIComponent(input.bucket)}/${input.objectName.split("/").map(encodeURIComponent).join("/")}`, prefix).href;
}

/**
 * An explicit environment mapping for a canary. `WALLET_PRIVATE_KEY` is only
 * usable when an operator sets `GREENFIELD_PUBLISHER_PRIVATE_KEY_REF` to that
 * exact reference; there is no silent fallback to a general wallet secret.
 */
export function greenfieldPublisherSecretReference(env: NodeJS.ProcessEnv = process.env): string | null {
  const reference = env.GREENFIELD_PUBLISHER_PRIVATE_KEY_REF?.trim();
  return reference === undefined || reference.length === 0 ? null : reference;
}

/** Load a key by reference from explicitly supplied process configuration. */
export function createGreenfieldEnvironmentSecretLoader(
  env: NodeJS.ProcessEnv = process.env
): GreenfieldSecretLoader {
  return (reference: string): string => {
    const normalized = reference.trim();
    if (normalized.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield secret reference is invalid", false);
    }
    const value = env[normalized]?.trim();
    if (value === undefined || value.length === 0) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield publisher secret reference is unavailable", false);
    }
    return value;
  };
}

/** Deterministic provider reference used in the durable publication graph. */
export function greenfieldObjectReference(bucket: string, objectName: string): string {
  validateBucket(bucket);
  validateObjectName(objectName);
  return `${bucket}/${objectName}`;
}

function validateBucket(bucket: string): void {
  if (!bucketPattern.test(bucket)) {
    throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket configuration is invalid", false);
  }
}

function canonicalHttpsUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PublicationProviderError("UNSUPPORTED_PROVIDER", `Greenfield ${field} is not a valid URL`, false);
  }
  if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
    throw new PublicationProviderError("UNSUPPORTED_PROVIDER", `Greenfield ${field} must be an HTTPS URL without credentials`, false);
  }
  return parsed.href.endsWith("/") ? parsed.href.slice(0, -1) : parsed.href;
}

function validateStandardsPins(options: GreenfieldSdkPublisherOptions): readonly GreenfieldStorageProviderPin[] {
  const pins = options.standardsPins;
  if (
    pins.networkId !== GREENFIELD_TESTNET_NETWORK ||
    pins.sdkChainId !== GREENFIELD_TESTNET_CHAIN_ID ||
    pins.sdkPackage !== GREENFIELD_SDK_PACKAGE ||
    pins.sdkVersion !== GREENFIELD_SDK_VERSION
  ) {
    throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield runtime does not match standards pins", false);
  }
  const providers = pins.storageProviders.map((provider) => {
    if (provider.providerLabel.trim().length === 0 || !/^0x[0-9a-fA-F]{40}$/.test(provider.operatorAddress.trim())) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield storage provider pin is incomplete", false);
    }
    return {
      ...provider,
      providerLabel: provider.providerLabel.trim(),
      endpoint: canonicalHttpsUrl(provider.endpoint, "storage provider endpoint"),
      operatorAddress: provider.operatorAddress.trim().toLowerCase(),
      publicReadBaseUrls: (provider.publicReadBaseUrls ?? []).map((url) => canonicalHttpsUrl(url, "public read URL"))
    };
  });
  const publicReadUrls = pins.publicReadBaseUrls.map((url) => canonicalHttpsUrl(url, "public read URL"));
  const allowedPublic = new Set([...publicReadUrls, ...providers.flatMap((provider) => provider.publicReadBaseUrls ?? [])]);
  if (options.spEndpoint !== undefined) {
    const endpoint = canonicalHttpsUrl(options.spEndpoint, "storage provider endpoint");
    const provider = providers.find((candidate) => candidate.endpoint === endpoint);
    if (provider === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield storage provider is not standards-allowlisted", false);
    }
    if (options.providerLabel !== undefined && options.providerLabel !== provider.providerLabel) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield provider label is not standards-allowlisted", false);
    }
  }
  if (options.publicBaseUrl !== undefined && !allowedPublic.has(canonicalHttpsUrl(options.publicBaseUrl, "public read URL"))) {
    throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield public URL is not standards-allowlisted", false);
  }
  return providers;
}

function validateObjectName(objectName: string): void {
  if (
    !objectNamePattern.test(objectName) ||
    objectName.length === 0 ||
    objectName.length > 1_024 ||
    objectName.startsWith("/") ||
    objectName.endsWith("/") ||
    objectName.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield object name is invalid", false);
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Greenfield provider operation failed";
  return message
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[redacted-secret]")
    .replace(/(?:private[_ -]?key|password|passphrase|secret|token|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, 500) || "Greenfield provider operation failed";
}

/** Normalize the secret only in memory to the 0x-prefixed form expected by
 * the SDK. Neither the raw nor normalized value is persisted or logged. */
function normalizePrivateKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield publisher secret is invalid", false);
  }
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield publisher secret is invalid", false);
  }
  return `0x${hex}`;
}

function providerFailure(error: unknown, code: "CREATE_FAILED" | "UPLOAD_FAILED" | "PROVIDER_FAILED"): PublicationProviderError {
  if (error instanceof PublicationProviderError) {
    return error;
  }
  return new PublicationProviderError(code, safeMessage(error), true);
}

function requireSdkModule(override: GreenfieldSdkModule | undefined): GreenfieldSdkModule {
  if (override !== undefined) {
    return override;
  }
  try {
    const require = createRequire(import.meta.url);
    return require(GREENFIELD_SDK_PACKAGE) as GreenfieldSdkModule;
  } catch {
    throw new PublicationProviderError(
      "UNSUPPORTED_PROVIDER",
      `Official ${GREENFIELD_SDK_PACKAGE}@${GREENFIELD_SDK_VERSION} is not installed`,
      false
    );
  }
}

function requireReedSolomonModule(override: ReedSolomonModule | undefined): ReedSolomonModule {
  if (override !== undefined) {
    return override;
  }
  try {
    const require = createRequire(import.meta.url);
    return require(GREENFIELD_REED_SOLOMON_PACKAGE) as ReedSolomonModule;
  } catch {
    throw new PublicationProviderError(
      "UNSUPPORTED_PROVIDER",
      `Official ${GREENFIELD_REED_SOLOMON_PACKAGE}@${GREENFIELD_REED_SOLOMON_VERSION} is not installed`,
      false
    );
  }
}

function canonicalLong(sdk: GreenfieldSdkModule, value: number): unknown {
  const constructor = sdk.Long;
  const fromNumber = constructor?.fromNumber;
  if (fromNumber !== undefined) {
    return fromNumber(value);
  }
  const fromString = constructor?.fromString;
  if (fromString !== undefined) {
    return fromString(String(value));
  }
  // The official SDK exports Long. This fallback is only useful for narrow
  // structural test doubles and is intentionally not used to guess a SDK API.
  return { toNumber: () => value, toString: () => String(value), low: value, high: 0, unsigned: true };
}

function canonicalLongString(sdk: GreenfieldSdkModule, value: string): unknown {
  const fromString = sdk.Long?.fromString;
  if (fromString !== undefined) return fromString(value);
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) && numeric >= 0) return canonicalLong(sdk, numeric);
  throw new PublicationProviderError("CREATE_FAILED", "Greenfield bucket quota is not representable", false);
}

function enumValue(values: UnknownRecord | undefined, name: string, fallback: number): number {
  const value = values?.[name];
  return typeof value === "number" ? value : fallback;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return new Uint8Array();
  }
}

function checksumsFor(
  moduleOverride: ReedSolomonModule | undefined,
  canonicalBytes: Uint8Array | undefined,
  expectedChecksums: readonly Uint8Array[] | undefined
): readonly Uint8Array[] {
  if (expectedChecksums !== undefined) {
    if (expectedChecksums.length === 0 || expectedChecksums.some((value) => value.byteLength === 0)) {
      throw new PublicationProviderError("CREATE_FAILED", "Greenfield Reed-Solomon checksums are empty", false);
    }
    const supplied = expectedChecksums.map((value) => Uint8Array.from(value));
    if (canonicalBytes !== undefined) {
      const computed = checksumsFor(moduleOverride, canonicalBytes, undefined);
      if (computed.length !== supplied.length || computed.some((value, index) => !bytesEqual(value, supplied[index] ?? new Uint8Array()))) {
        throw new PublicationProviderError("CREATE_FAILED", "Greenfield checksums do not match canonical bytes", false);
      }
    }
    return supplied;
  }
  if (canonicalBytes === undefined || canonicalBytes.byteLength === 0) {
    throw new PublicationProviderError(
      "CREATE_FAILED",
      "Greenfield create requires canonical bytes or precomputed Reed-Solomon checksums",
      false
    );
  }
  const module = requireReedSolomonModule(moduleOverride);
  const Constructor = module.ReedSolomon ?? module.default;
  if (Constructor === undefined) {
    throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Reed-Solomon module has no constructor", false);
  }
  let encoded: readonly string[];
  try {
    encoded = new Constructor().encode(Uint8Array.from(canonicalBytes));
  } catch (error) {
    throw new PublicationProviderError("CREATE_FAILED", safeMessage(error), true);
  }
  if (encoded.length === 0 || encoded.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new PublicationProviderError("CREATE_FAILED", "Greenfield Reed-Solomon encoding returned no checksums", false);
  }
  return encoded.map(base64ToBytes);
}

function responseCode(response: UnknownRecord): number {
  const value = response.code;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return Number(value);
  return 0;
}

function responseStatus(response: UnknownRecord): number | null {
  return numericField(response.statusCode);
}

function hashOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!transactionHashPattern.test(normalized)) return null;
  // Greenfield uses the all-zero seal hash to represent an unset transaction
  // hash. ObjectStatus remains the source of truth for whether the object is
  // sealed.
  return /^0x0{64}$/.test(normalized) ? null : normalized;
}

function transactionHashFromResponse(response: UnknownRecord): string | null {
  return hashOrNull(response.txhash ?? response.txHash ?? response.transactionHash);
}

function firstField(source: UnknownRecord | null, ...names: string[]): unknown {
  if (source === null) return undefined;
  for (const name of names) {
    if (source[name] !== undefined) return source[name];
  }
  return undefined;
}

function recordValue(value: unknown): UnknownRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function notFoundError(error: unknown): boolean {
  const source = recordValue(error);
  const response = recordValue(source?.response);
  const status = numericField(
    source?.statusCode ?? source?.status ?? source?.code ?? response?.statusCode ?? response?.status ?? response?.code
  );
  if (status === 404) return true;
  const message = error instanceof Error ? error.message : typeof source?.message === "string" ? source.message : "";
  return /(?:\b404\b|not[ -]?found|does not exist|\bno such bucket\b)/i.test(message);
}

function officialMissingObjectError(error: unknown): boolean {
  const source = recordValue(error);
  return source?.statusCode === 404 && source.code === "90010";
}

function publicReadVisibility(value: unknown): boolean {
  if (numericField(value) === 1 || value === "VISIBILITY_TYPE_PUBLIC_READ" || value === "PUBLIC_READ" || value === "public-read") {
    return true;
  }
  return false;
}

function createdBucketStatus(value: unknown): boolean {
  const numeric = numericField(value);
  if (numeric !== null) return numeric === 0;
  return typeof value === "string" && /^(?:BUCKET_STATUS_)?CREATED$/i.test(value.trim());
}

function metadataObject(response: UnknownRecord): UnknownRecord | null {
  const body = response.body;
  if (body === null || typeof body !== "object") return null;
  const envelope = (body as UnknownRecord).GfSpGetObjectMetaResponse;
  if (envelope === null || typeof envelope !== "object") return null;
  const object = (envelope as UnknownRecord).Object;
  if (object === null || typeof object !== "object") return null;
  const objectInfo = (object as UnknownRecord).ObjectInfo;
  if (objectInfo === null || typeof objectInfo !== "object") return null;
  return object as UnknownRecord;
}

function numericField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function checksumList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function bucketInfoFromResponse(response: UnknownRecord): UnknownRecord | null {
  const direct = recordValue(firstField(response, "bucketInfo", "BucketInfo", "bucket_info"));
  if (direct !== null) return direct;
  const body = recordValue(response.body);
  const bodyInfo = recordValue(firstField(body, "bucketInfo", "BucketInfo", "bucket_info"));
  if (bodyInfo !== null) return bodyInfo;
  const bodyEnvelope = recordValue(firstField(body, "QueryHeadBucketResponse", "queryHeadBucketResponse"));
  const envelopeInfo = recordValue(firstField(bodyEnvelope, "bucketInfo", "BucketInfo", "bucket_info"));
  if (envelopeInfo !== null) return envelopeInfo;
  // Structural test doubles may return BucketInfo directly. Only accept it
  // when a canonical field is present; an empty HTTP-200 response is malformed.
  if (firstField(response, "owner", "Owner", "bucketName", "BucketName", "bucket_name") !== undefined) return response;
  if (body !== null && firstField(body, "owner", "Owner", "bucketName", "BucketName", "bucket_name") !== undefined) return body;
  return null;
}

function virtualGroupFamilyFromResponse(response: UnknownRecord): UnknownRecord | null {
  const direct = recordValue(firstField(response, "globalVirtualGroupFamily", "GlobalVirtualGroupFamily", "global_virtual_group_family"));
  if (direct !== null) return direct;
  const body = recordValue(response.body);
  const bodyFamily = recordValue(firstField(body, "globalVirtualGroupFamily", "GlobalVirtualGroupFamily", "global_virtual_group_family"));
  if (bodyFamily !== null) return bodyFamily;
  return firstField(response, "primarySpId", "PrimarySpId", "primary_sp_id") === undefined ? null : response;
}

function storageProvidersFromResponse(response: unknown): readonly UnknownRecord[] | null {
  const source = Array.isArray(response)
    ? response
    : (() => {
        const record = recordValue(response);
        const body = recordValue(record?.body);
        return firstField(record, "sps", "Sps", "storageProviders", "StorageProviders") ??
          firstField(body, "sps", "Sps", "storageProviders", "StorageProviders");
      })();
  if (!Array.isArray(source)) return null;
  const records = source.map(recordValue);
  return records.every((entry): entry is UnknownRecord => entry !== null) ? records : null;
}

function bucketMetaFromResponse(response: UnknownRecord): UnknownRecord | null {
  const body = recordValue(response.body);
  if (body === null) return null;
  const envelope = recordValue(firstField(body, "GfSpGetBucketMetaResponse", "gfSpGetBucketMetaResponse"));
  const envelopeBucket = recordValue(firstField(envelope, "Bucket", "bucket", "BucketMeta", "bucketMeta"));
  if (envelopeBucket !== null) return envelopeBucket;
  const nested = recordValue(firstField(body, "Bucket", "bucket", "BucketMeta", "bucketMeta"));
  return nested ?? body;
}

interface GreenfieldBucketInspection {
  readonly status: "missing" | "present" | "unknown";
  readonly creationTransactionHash: string | null;
}

/**
 * Real Node adapter for the official Greenfield JS SDK. SDK and Reed-Solomon
 * packages are loaded dynamically so the provider remains disabled when the
 * standards lock has not yet pinned/installed them.
 */
export class GreenfieldSdkPublisher implements GreenfieldPublisher {
  private readonly sdk: GreenfieldSdkModule;
  private readonly client: GreenfieldSdkClient;
  private readonly providerPins: readonly GreenfieldStorageProviderPin[];
  private readonly options: GreenfieldSdkPublisherOptions;
  /** An unknown broadcast is retry-disabled for this adapter instance until
   * a later reconciliation observes the exact bucket. */
  private canaryBucketUnknown = false;

  constructor(options: GreenfieldSdkPublisherOptions) {
    if (options.network !== GREENFIELD_TESTNET_NETWORK) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield network is not standards-locked", false);
    }
    if (options.chainId !== undefined && options.chainId !== GREENFIELD_TESTNET_CHAIN_ID) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield SDK chain id is not standards-locked", false);
    }
    if (options.rpcUrl.trim().length === 0) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield RPC URL is required", false);
    }
    validateBucket(options.bucket);
    validateObjectName("placeholder");
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.creator.trim())) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield creator address is required", false);
    }
    if (options.keyReference.trim().length === 0) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield key reference is required", false);
    }
    const providerPins = validateStandardsPins(options);
    if (options.spEndpoint !== undefined) {
      try {
        const endpoint = new URL(options.spEndpoint);
        if (!/^https?:$/.test(endpoint.protocol)) throw new Error("unsupported endpoint protocol");
      } catch {
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield SP endpoint is invalid", false);
      }
    }
    if (options.publicBaseUrl !== undefined) {
      try {
        if (new URL(options.publicBaseUrl).protocol !== "https:") throw new Error("public URL must be HTTPS");
      } catch {
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield public base URL is invalid", false);
      }
    }
    this.options = options;
    this.providerPins = providerPins;
    this.sdk = requireSdkModule(options.sdkModule);
    const Client = this.sdk.Client;
    const client = options.sdkClient ?? (Client === undefined ? null : Client.create(options.rpcUrl, options.chainId ?? GREENFIELD_TESTNET_CHAIN_ID));
    if (client === null || client.object === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Official Greenfield SDK client is unavailable", false);
    }
    this.client = client;
  }

  get providerLabel(): string | undefined {
    return this.options.providerLabel;
  }

  /** Resolve an operator-facing HTTPS URL without changing the internal URI. */
  publicHttpsUri(objectName: string): string | null {
    const baseUrl = this.options.publicBaseUrl;
    return baseUrl === undefined ? null : greenfieldPublicHttpsUri({ baseUrl, bucket: this.options.bucket, objectName });
  }

  /**
   * Ensure the one configured public-read canary bucket exists. This is the
   * only bucket mutation exposed by the adapter; all other bucket management
   * remains outside the T8 boundary.
   */
  async ensureCanaryBucket(): Promise<GreenfieldBucketEnsureReceipt> {
    const provider = this.bucketProviderPin();
    const inspected = await this.inspectCanaryBucket(provider);
    if (inspected.status === "present") {
      this.canaryBucketUnknown = false;
      return this.bucketReceipt("reused", inspected.creationTransactionHash, provider);
    }
    // A query failure is not proof that a previous create failed. Do not
    // create while the chain/SP state is indeterminate, and never rebroadcast
    // in the same invocation after an unknown broadcast.
    if (inspected.status === "unknown") {
      return this.bucketReceipt("unknown", null, provider);
    }
    if (this.canaryBucketUnknown) {
      return this.bucketReceipt("unknown", null, provider);
    }

    const bucketApi = this.client.bucket;
    if (bucketApi?.createBucket === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Official Greenfield bucket API is unavailable", false);
    }
    const message: UnknownRecord = {
      bucketName: this.options.bucket,
      creator: this.options.creator,
      visibility: enumValue(this.sdk.VisibilityType, "VISIBILITY_TYPE_PUBLIC_READ", 1),
      chargedReadQuota: canonicalLongString(this.sdk, GREENFIELD_CANARY_CHARGED_READ_QUOTA),
      primarySpAddress: provider.operatorAddress,
      paymentAddress: this.options.creator
    };

    let tx: GreenfieldSdkTxResponse;
    try {
      tx = await bucketApi.createBucket.call(bucketApi, message);
    } catch (error) {
      throw providerFailure(error, "CREATE_FAILED");
    }
    if (tx.simulate === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield bucket transaction cannot be simulated", false);
    }
    let simulation: UnknownRecord;
    try {
      simulation = await tx.simulate({ denom: this.options.transaction?.denom ?? "BNB" });
    } catch (error) {
      throw providerFailure(error, "CREATE_FAILED");
    }
    let broadcastOptions: UnknownRecord;
    try {
      broadcastOptions = await this.broadcastOptions(simulation);
    } catch (error) {
      throw providerFailure(error, "CREATE_FAILED");
    }

    let result: UnknownRecord;
    try {
      result = await tx.broadcast(broadcastOptions);
    } catch {
      this.canaryBucketUnknown = true;
      return this.reconcileCanaryBucketAfterUnknown(provider);
    }
    if (responseCode(result) !== 0) {
      throw new PublicationProviderError("CREATE_FAILED", "Greenfield bucket creation transaction was rejected", false);
    }
    const creationTransactionHash = transactionHashFromResponse(result);
    if (creationTransactionHash === null) {
      this.canaryBucketUnknown = true;
      return this.reconcileCanaryBucketAfterUnknown(provider);
    }
    this.canaryBucketUnknown = false;
    return this.bucketReceipt("created", creationTransactionHash, provider);
  }

  private bucketProviderPin(): GreenfieldStorageProviderPin {
    if (this.providerPins.length === 0) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield storage provider pins are unavailable", false);
    }
    const endpoint = this.options.spEndpoint === undefined
      ? null
      : canonicalHttpsUrl(this.options.spEndpoint, "storage provider endpoint");
    const label = this.options.providerLabel?.trim() ?? null;
    const candidates = this.providerPins.filter((provider) =>
      (endpoint === null || provider.endpoint === endpoint) && (label === null || provider.providerLabel === label)
    );
    if (candidates.length !== 1) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield canary storage provider selection is ambiguous", false);
    }
    return candidates[0] as GreenfieldStorageProviderPin;
  }

  private bucketReceipt(
    status: GreenfieldBucketEnsureReceipt["status"],
    creationTransactionHash: string | null,
    provider: GreenfieldStorageProviderPin
  ): GreenfieldBucketEnsureReceipt {
    return {
      status,
      bucketName: this.options.bucket,
      owner: this.options.creator,
      primarySpAddress: provider.operatorAddress,
      visibility: "public-read",
      creationTransactionHash
    };
  }

  async reconcileCanaryBucket(): Promise<GreenfieldBucketReconcileReceipt> {
    const provider = this.bucketProviderPin();
    const inspected = await this.inspectCanaryBucket(provider);
    if (inspected.status === "present") {
      return {
        status: "present",
        bucketName: this.options.bucket,
        owner: this.options.creator,
        primarySpAddress: provider.operatorAddress,
        visibility: "public-read",
        creationTransactionHash: inspected.creationTransactionHash
      };
    }
    return {
      status: inspected.status,
      bucketName: this.options.bucket,
      owner: null,
      primarySpAddress: null,
      visibility: null,
      creationTransactionHash: null
    };
  }

  private async reconcileCanaryBucketAfterUnknown(provider: GreenfieldStorageProviderPin): Promise<GreenfieldBucketEnsureReceipt> {
    const inspected = await this.inspectCanaryBucket(provider);
    if (inspected.status === "present") {
      this.canaryBucketUnknown = false;
      return this.bucketReceipt("reused", inspected.creationTransactionHash, provider);
    }
    // Missing/unknown after a broadcast is durable UNKNOWN for this adapter
    // instance. A caller may reconcile again, but this method never retries
    // the mutation without observing the matching bucket first.
    return this.bucketReceipt("unknown", null, provider);
  }

  private async inspectCanaryBucket(provider: GreenfieldStorageProviderPin): Promise<GreenfieldBucketInspection> {
    const bucketApi = this.client.bucket;
    if (bucketApi?.headBucket === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Official Greenfield bucket query API is unavailable", false);
    }

    let response: UnknownRecord;
    try {
      response = await bucketApi.headBucket.call(bucketApi, this.options.bucket);
    } catch (error) {
      if (notFoundError(error)) return { status: "missing", creationTransactionHash: null };
      return { status: "unknown", creationTransactionHash: null };
    }
    const status = responseStatus(response);
    const code = responseCode(response);
    if (status === 404 || code === 404) return { status: "missing", creationTransactionHash: null };
    if (status !== null && status >= 400 || code !== 0) return { status: "unknown", creationTransactionHash: null };
    const info = bucketInfoFromResponse(response);
    if (info === null) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket metadata response was malformed", false);
    }
    const bucketName = stringField(firstField(info, "bucketName", "BucketName", "bucket_name"));
    const owner = stringField(firstField(info, "owner", "Owner", "creator", "Creator"));
    const visibility = firstField(info, "visibility", "Visibility", "bucketVisibility", "bucket_visibility");
    if (bucketName === null || owner === null || visibility === undefined) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket metadata response was incomplete", false);
    }
    if (bucketName !== this.options.bucket) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield bucket name does not match the configured canary", false);
    }
    if (owner.toLowerCase() !== this.options.creator.toLowerCase()) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield canary bucket belongs to a different owner", false);
    }
    if (!publicReadVisibility(visibility)) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield canary bucket is not public-read", false);
    }
    const bucketStatus = firstField(info, "bucketStatus", "BucketStatus", "bucket_status", "status");
    if (bucketStatus !== undefined && !createdBucketStatus(bucketStatus)) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield canary bucket is not in the created state", false);
    }
    const paymentAddress = stringField(firstField(info, "paymentAddress", "PaymentAddress", "payment_address"));
    if (paymentAddress !== null && paymentAddress.toLowerCase() !== this.options.creator.toLowerCase()) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield canary bucket payment address differs", false);
    }

    const familyId = numericField(firstField(info, "globalVirtualGroupFamilyId", "GlobalVirtualGroupFamilyId", "global_virtual_group_family_id"));
    if (familyId === null || !Number.isSafeInteger(familyId) || familyId < 0) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket virtual-group family metadata was malformed", false);
    }
    const virtualGroup = this.client.virtualGroup;
    if (virtualGroup?.getGlobalVirtualGroupFamily === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield virtual-group query API is unavailable", false);
    }
    let familyResponse: unknown;
    try {
      familyResponse = await virtualGroup.getGlobalVirtualGroupFamily.call(virtualGroup, { familyId });
    } catch {
      // A chain query failure does not prove that the bucket is absent.
      return { status: "unknown", creationTransactionHash: null };
    }
    const familyRecord = recordValue(familyResponse);
    if (familyRecord !== null && responseCode(familyRecord) !== 0) {
      return { status: "unknown", creationTransactionHash: null };
    }
    const family = familyRecord === null ? null : virtualGroupFamilyFromResponse(familyRecord);
    const primarySpId = numericField(firstField(family, "primarySpId", "PrimarySpId", "primary_sp_id"));
    if (primarySpId === null || !Number.isSafeInteger(primarySpId) || primarySpId < 0) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield virtual-group primary SP metadata was malformed", false);
    }
    const sp = this.client.sp;
    if (sp?.getStorageProviders === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield storage-provider query API is unavailable", false);
    }
    let storageProvidersResponse: unknown;
    try {
      storageProvidersResponse = await sp.getStorageProviders.call(sp);
    } catch {
      return { status: "unknown", creationTransactionHash: null };
    }
    const storageProviders = storageProvidersFromResponse(storageProvidersResponse);
    if (storageProviders === null) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield storage-provider metadata response was malformed", false);
    }
    const storageProvider = storageProviders.find((candidate) =>
      numericField(firstField(candidate, "id", "Id", "spId", "SpId", "sp_id")) === primarySpId
    );
    if (storageProvider === undefined) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield bucket primary SP is not in the provider set", false);
    }
    const operator = stringField(firstField(storageProvider, "operatorAddress", "OperatorAddress", "operator_address"));
    const endpoint = stringField(firstField(storageProvider, "endpoint", "Endpoint"));
    if (operator === null || endpoint === null || !/^0x[0-9a-fA-F]{40}$/.test(operator)) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield storage-provider metadata was malformed", false);
    }
    let normalizedEndpoint: string;
    try {
      normalizedEndpoint = canonicalHttpsUrl(endpoint, "storage provider endpoint");
    } catch {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield storage-provider endpoint was malformed", false);
    }
    if (operator.toLowerCase() !== provider.operatorAddress.toLowerCase() || normalizedEndpoint !== provider.endpoint) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield canary bucket SP differs from the pinned provider", false);
    }

    const getBucketMeta = bucketApi.getBucketMeta;
    if (getBucketMeta === undefined) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield SP bucket metadata API is unavailable", false);
    }
    let metaResponse: UnknownRecord;
    try {
      metaResponse = await getBucketMeta.call(bucketApi, {
        bucketName: this.options.bucket,
        endpoint: provider.endpoint
      });
    } catch {
      // An SP 404 or transient error does not prove the chain bucket is
      // absent; keep creation blocked until a later reconciliation.
      return { status: "unknown", creationTransactionHash: null };
    }
    const metaStatus = responseStatus(metaResponse);
    const metaCode = responseCode(metaResponse);
    if (metaStatus === 404 || metaCode === 404 || (metaStatus !== null && metaStatus >= 400) || metaCode !== 0) {
      return { status: "unknown", creationTransactionHash: null };
    }
    const metadata = bucketMetaFromResponse(metaResponse);
    if (metadata === null) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket metadata response was malformed", false);
    }
    const createValue = firstField(metadata, "createTxHash", "CreateTxHash", "create_tx_hash");
    if (createValue === undefined || createValue === "") {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket create transaction hash metadata was missing", false);
    }
    const creationTransactionHash = hashOrNull(createValue);
    if (creationTransactionHash === null) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield bucket create transaction hash was malformed", false);
    }
    return { status: "present", creationTransactionHash };
  }

  async inspectObject(input: {
    readonly objectName: string;
    readonly sizeBytes?: number;
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }): Promise<GreenfieldInspectReceipt> {
    validateObjectName(input.objectName);
    const expectedChecksums = input.expectedChecksums ?? (input.canonicalBytes === undefined
      ? undefined
      : checksumsFor(this.options.reedSolomonModule, input.canonicalBytes, undefined));
    const metadata = await this.fetchMetadata(input.objectName);
    if (metadata === null) {
      return {
        status: "missing",
        objectReference: null,
        creationTransactionHash: null,
        sealTransactionHash: null
      };
    }
    const objectInfo = metadata.ObjectInfo as UnknownRecord;
    const metadataName = stringField(objectInfo.ObjectName);
    if (metadataName === null || metadataName !== input.objectName) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield metadata object name does not match", false);
    }
    const owner = stringField(objectInfo.Owner) ?? stringField(objectInfo.Creator);
    if (owner === null || owner.toLowerCase() !== this.options.creator.toLowerCase()) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield object belongs to a different creator", false);
    }
    if (input.sizeBytes !== undefined) {
      const payloadSize = numericField(objectInfo.PayloadSize);
      if (payloadSize === null || payloadSize !== input.sizeBytes) {
        throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield object size differs from canonical bytes", false);
      }
    }
    if (expectedChecksums !== undefined) {
      const storedChecksums = checksumList(objectInfo.Checksums).map(base64ToBytes);
      if (storedChecksums.length !== expectedChecksums.length ||
          storedChecksums.some((checksum, index) => !bytesEqual(checksum, expectedChecksums[index] ?? new Uint8Array()))) {
        throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield object checksums differ from canonical bytes", false);
      }
    }
    const status = numericField(objectInfo.ObjectStatus);
    if (status === null) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield metadata object status was malformed", false);
    }
    if (status === 2) {
      throw new PublicationProviderError("DURABLE_GRAPH_INVALID", "Greenfield object is discontinued", false);
    }
    const objectReference = greenfieldObjectReference(this.options.bucket, input.objectName);
    const creationTransactionHash = hashOrNull(metadata.CreateTxHash);
    const sealTransactionHash = hashOrNull(metadata.SealTxHash);
    return {
      status: status === 1 ? "sealed" : "created",
      objectReference,
      creationTransactionHash,
      // A non-sealed object must not carry a seal claim even if a provider
      // returns a stale SealTxHash field.
      sealTransactionHash: status === 1 ? sealTransactionHash : null
    };
  }

  async reconcileCreate(input: {
    readonly objectName: string;
    readonly sizeBytes: number;
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }): Promise<GreenfieldCreateReconciliation> {
    validateObjectName(input.objectName);
    const expectedChecksums = checksumsFor(this.options.reedSolomonModule, input.canonicalBytes, input.expectedChecksums);
    const chainStatus = await this.chainObjectStatus(input.objectName);
    let inspected: GreenfieldInspectReceipt;
    try {
      inspected = await this.inspectObject({
        objectName: input.objectName,
        sizeBytes: input.sizeBytes,
        expectedChecksums
      });
    } catch (error) {
      // A storage-provider failure is not proof that an unknown transaction
      // failed. Keep the durable attempt blocked until a later reconciliation.
      if (error instanceof PublicationProviderError && error.code === "PROVIDER_FAILED") return {
        status: "unknown",
        objectReference: null,
        creationTransactionHash: null,
        sealTransactionHash: null
      };
      throw error;
    }
    if (inspected.status !== "missing") {
      return {
        status: "present",
        objectReference: inspected.objectReference,
        creationTransactionHash: inspected.creationTransactionHash,
        sealTransactionHash: inspected.sealTransactionHash
      };
    }
    if (chainStatus === "missing") {
      return {
        status: "missing",
        objectReference: null,
        creationTransactionHash: null,
        sealTransactionHash: null
      };
    }
    return {
      status: "unknown",
      objectReference: null,
      creationTransactionHash: null,
      sealTransactionHash: null
    };
  }

  async createObject(input: {
    readonly objectName: string;
    readonly sizeBytes: number;
    readonly mimeType: "application/json";
    readonly canonicalBytes?: Uint8Array;
    readonly expectedChecksums?: readonly Uint8Array[];
  }): Promise<GreenfieldCreateReceipt> {
    validateObjectName(input.objectName);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new PublicationProviderError("CREATE_FAILED", "Greenfield object size is invalid", false);
    }
    const checksums = checksumsFor(this.options.reedSolomonModule, input.canonicalBytes, input.expectedChecksums);
    let inspected: GreenfieldInspectReceipt;
    try {
      inspected = await this.inspectObject({
        objectName: input.objectName,
        sizeBytes: input.sizeBytes,
        expectedChecksums: checksums
      });
    } catch (error) {
      throw providerFailure(error, "CREATE_FAILED");
    }
    if (inspected.status !== "missing") {
      if (inspected.objectReference === null || inspected.creationTransactionHash === null) {
        throw new PublicationProviderError("CREATE_FAILED", "Existing Greenfield object has no canonical create transaction", false);
      }
      return {
        objectReference: inspected.objectReference,
        creationTransactionHash: inspected.creationTransactionHash,
        status: "confirmed"
      };
    }

    const message: UnknownRecord = {
      creator: this.options.creator,
      bucketName: this.options.bucket,
      objectName: input.objectName,
      payloadSize: canonicalLong(this.sdk, input.sizeBytes),
      contentType: input.mimeType,
      expectChecksums: checksums,
      redundancyType: enumValue(this.sdk.RedundancyType, "REDUNDANCY_EC_TYPE", 0),
      visibility: enumValue(this.sdk.VisibilityType, "VISIBILITY_TYPE_PUBLIC_READ", 1)
    };
    try {
      const tx = await this.client.object.createObject(message);
      const simulation = tx.simulate === undefined ? null : await tx.simulate({ denom: this.options.transaction?.denom ?? "BNB" });
      const broadcastOptions = await this.broadcastOptions(simulation);
      const result = await tx.broadcast(broadcastOptions);
      if (responseCode(result) !== 0) {
        throw new PublicationProviderError("CREATE_FAILED", "Greenfield create transaction was rejected", true);
      }
      const creationTransactionHash = hashOrNull(result.txhash);
      if (creationTransactionHash === null) {
        throw new PublicationProviderError("MALFORMED_TRANSACTION", "Greenfield create returned no canonical transaction hash", false);
      }
      return {
        objectReference: greenfieldObjectReference(this.options.bucket, input.objectName),
        creationTransactionHash,
        status: "confirmed"
      };
    } catch {
      // The transaction may have been accepted even if broadcast/readback
      // failed. Reconcile against chain state and object metadata before
      // returning. An unresolved result is durable UNKNOWN, not a retryable
      // create failure; a later worker must reconcile before any rebroadcast.
      try {
        const recovered = await this.reconcileCreate({
          objectName: input.objectName,
          sizeBytes: input.sizeBytes,
          expectedChecksums: checksums,
          ...(input.canonicalBytes === undefined ? {} : { canonicalBytes: input.canonicalBytes })
        });
        if (recovered.status === "present" && recovered.objectReference !== null && recovered.creationTransactionHash !== null) {
          return {
            objectReference: recovered.objectReference,
            creationTransactionHash: recovered.creationTransactionHash,
            status: "confirmed"
          };
        }
      } catch {
        // Preserve the unknown outcome. A retry will reconcile chain/object
        // state before any future create call, and no duplicate is submitted.
      }
      throw new PublicationProviderError("CREATE_UNKNOWN", "Greenfield create outcome requires reconciliation", false);
    }
  }

  async uploadObject(
    input: PublicationUploadInput & { readonly objectReference: string; readonly creationTransactionHash?: string | null }
  ): Promise<GreenfieldUploadReceipt> {
    const objectName = this.objectNameFromReference(input.objectReference);
    if (objectName !== input.objectName) {
      throw new PublicationProviderError("UPLOAD_FAILED", "Greenfield object reference does not match object name", false);
    }
    if (input.bytes.byteLength !== input.sizeBytes) {
      throw new PublicationProviderError("UPLOAD_FAILED", "Greenfield upload size differs from canonical bytes", false);
    }
    const endpoint = await this.resolveEndpoint();
    let privateKey: string;
    try {
      privateKey = normalizePrivateKey(await this.options.loadSecret(this.options.keyReference));
    } catch (error) {
      throw providerFailure(error, "PROVIDER_FAILED");
    }
    try {
      const uploadParams: UnknownRecord = {
          endpoint,
          bucketName: this.options.bucket,
          objectName,
          duration: this.options.uploadDurationMs ?? 30_000,
          resumableOpts: { disableResumable: true },
          body: {
            name: objectName,
            type: input.mimeType,
            size: input.bytes.byteLength,
            content: Buffer.from(input.bytes)
          }
      };
      if (input.creationTransactionHash !== undefined && input.creationTransactionHash !== null) {
        uploadParams.txnHash = input.creationTransactionHash;
      }
      const result = await this.client.object.uploadObject(
        uploadParams,
        { type: "ECDSA", privateKey }
      );
      if (responseCode(result) !== 0) {
        throw new PublicationProviderError("UPLOAD_FAILED", "Greenfield storage provider rejected the upload", true);
      }
      return {
        uri: `greenfield://${this.options.bucket}/${objectName}`,
        network: this.options.network,
        bucket: this.options.bucket,
        providerReference: input.objectReference
      };
    } catch (error) {
      throw providerFailure(error, "UPLOAD_FAILED");
    }
  }

  async waitForSeal(input: { readonly objectReference: string; readonly attempt: number }): Promise<GreenfieldSealReceipt> {
    const objectName = this.objectNameFromReference(input.objectReference);
    const inspected = await this.inspectObject({ objectName });
    if (inspected.status === "missing") {
      return { status: "missing", sealTransactionHash: null };
    }
    if (inspected.status === "sealed") {
      return { status: "sealed", sealTransactionHash: inspected.sealTransactionHash };
    }
    return { status: "pending", sealTransactionHash: null };
  }

  async readObject(input: { readonly objectReference: string }): Promise<Uint8Array> {
    const objectName = this.objectNameFromReference(input.objectReference);
    const endpoint = await this.resolveEndpoint();
    let privateKey: string;
    try {
      privateKey = normalizePrivateKey(await this.options.loadSecret(this.options.keyReference));
    } catch (error) {
      throw providerFailure(error, "PROVIDER_FAILED");
    }
    try {
      const response = await this.client.object.getObject(
        { endpoint, bucketName: this.options.bucket, objectName },
        { type: "ECDSA", privateKey }
      );
      if (responseCode(response) !== 0 || response.body === undefined) {
        const status = responseStatus(response);
        if (status === 404) {
          throw new PublicationProviderError("MISSING_OBJECT", "Greenfield object is not available", false);
        }
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield readback request failed", true);
      }
      const body = response.body;
      if (body instanceof Uint8Array) {
        return Uint8Array.from(body);
      }
      if (typeof (body as { readonly arrayBuffer?: unknown }).arrayBuffer !== "function") {
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield readback returned no byte body", true);
      }
      return new Uint8Array(await (body as Blob).arrayBuffer());
    } catch (error) {
      throw providerFailure(error, "PROVIDER_FAILED");
    }
  }

  private objectNameFromReference(reference: string): string {
    const prefix = `${this.options.bucket}/`;
    if (!reference.startsWith(prefix)) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield object reference is outside the configured bucket", false);
    }
    const objectName = reference.slice(prefix.length);
    validateObjectName(objectName);
    return objectName;
  }

  private async resolveEndpoint(): Promise<string> {
    if (this.options.spEndpoint !== undefined) {
      return this.assertAllowlistedEndpoint(this.options.spEndpoint);
    }
    const resolver = this.client.sp?.getSPUrlByBucket;
    if (resolver === undefined) {
      throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield SDK cannot resolve a storage provider", false);
    }
    try {
      const endpoint = await resolver.call(this.client.sp, this.options.bucket);
      if (typeof endpoint !== "string" || endpoint.length === 0) {
        throw new Error("storage provider returned no endpoint");
      }
      return this.assertAllowlistedEndpoint(endpoint);
    } catch (error) {
      throw providerFailure(error, "PROVIDER_FAILED");
    }
  }

  private assertAllowlistedEndpoint(endpoint: string): string {
    const normalized = canonicalHttpsUrl(endpoint, "storage provider endpoint");
    if (!this.providerPins.some((provider) => provider.endpoint === normalized)) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Greenfield storage provider is not standards-allowlisted", false);
    }
    return normalized;
  }

  private async chainObjectStatus(objectName: string): Promise<"missing" | "present" | "unknown"> {
    const headObject = this.client.object.headObject;
    if (headObject === undefined) return "unknown";
    try {
      const response = await headObject.call(this.client.object, this.options.bucket, objectName);
      const candidate = response.objectInfo ?? response.ObjectInfo;
      if (candidate !== null && typeof candidate === "object") return "present";
      if (candidate === null || response.exists === false || response.found === false) return "missing";
      return "unknown";
    } catch {
      // SDK query errors do not establish that a broadcast failed. A later
      // reconciliation can observe the chain once indexing/RPC recovers.
      return "unknown";
    }
  }

  private async fetchMetadata(objectName: string): Promise<UnknownRecord | null> {
    const endpoint = await this.resolveEndpoint();
    try {
      const response = await this.client.object.getObjectMeta({
        endpoint,
        bucketName: this.options.bucket,
        objectName
      });
      if (responseCode(response) !== 0) {
        const status = responseStatus(response);
        if (status === 404) return null;
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield metadata request failed", true);
      }
      const object = metadataObject(response);
      const status = responseStatus(response);
      if (object === null && status !== null && status >= 400) {
        if (status === 404) return null;
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield metadata request failed", true);
      }
      if (object === null) {
        throw new PublicationProviderError("PROVIDER_FAILED", "Greenfield metadata response was malformed", false);
      }
      return object;
    } catch (error) {
      if (error instanceof PublicationProviderError) throw error;
      if (officialMissingObjectError(error)) return null;
      throw providerFailure(error, "PROVIDER_FAILED");
    }
  }

  private async broadcastOptions(simulation: UnknownRecord | null): Promise<UnknownRecord> {
    const configured = this.options.transaction;
    const simulatedGasLimit = numericField(simulation?.gasLimit);
    const simulatedGasPrice = stringField(simulation?.gasPrice);
    const gasLimit = configured?.gasLimit ?? simulatedGasLimit;
    const gasPrice = configured?.gasPrice ?? simulatedGasPrice;
    if (gasLimit === null || gasLimit === undefined || !Number.isSafeInteger(gasLimit) || gasLimit <= 0) {
      throw new PublicationProviderError("CREATE_FAILED", "Greenfield transaction gas limit is unavailable", false);
    }
    if (gasPrice === null || gasPrice === undefined || gasPrice.length === 0) {
      throw new PublicationProviderError("CREATE_FAILED", "Greenfield transaction gas price is unavailable", false);
    }
    let privateKey: string;
    try {
      privateKey = normalizePrivateKey(await this.options.loadSecret(this.options.keyReference));
    } catch (error) {
      throw providerFailure(error, "PROVIDER_FAILED");
    }
    return {
      denom: configured?.denom ?? "BNB",
      gasLimit,
      gasPrice,
      payer: this.options.creator,
      granter: configured?.granter ?? "",
      privateKey
    };
  }
}

/** A stable digest useful for pinning canary configuration in operator logs. */
export function greenfieldConfigurationDigest(input: {
  readonly network: string;
  readonly chainId: string;
  readonly bucket: string;
  readonly creator: string;
  readonly spEndpoint?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...input, creator: input.creator.toLowerCase() }))
    .digest("hex");
}
