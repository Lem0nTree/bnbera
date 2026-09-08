import {
  agentCategories,
  canonicalSha256Hex,
  normalizeErc8004Identity,
  type Erc8004Identity
} from "@bnbera/domain";
import {
  normalizeArtifact,
  type CanonicalArtifact,
  type EvidenceReference,
  type PublicJsonValue
} from "@bnbera/evidence";

type FrozenRow = Readonly<Record<string, unknown>>;

export interface FrozenAgentProfileRows {
  readonly environment: "development" | "preview" | "hackathon" | "production";
  readonly identity?: FrozenRow;
  readonly identityRow?: FrozenRow;
  readonly agent?: FrozenRow;
  readonly agentRow?: FrozenRow;
  readonly version?: FrozenRow;
  readonly versionRow?: FrozenRow;
  readonly services?: readonly FrozenRow[];
  readonly serviceRows?: readonly FrozenRow[];
  readonly capabilityObservation?: FrozenRow | null;
  readonly capabilityRow?: FrozenRow | null;
  readonly authority?: FrozenRow | null;
  readonly authorityRow?: FrozenRow | null;
  readonly template?: FrozenRow | null;
  readonly templateRow?: FrozenRow | null;
  readonly evidenceReferences?: readonly EvidenceReference[];
  readonly artifactId?: string;
  readonly versionNumber?: number;
  readonly createdAt?: string | Date;
  readonly [key: string]: unknown;
}

export interface FrozenRunBundleRows {
  readonly environment: "development" | "preview" | "hackathon" | "production";
  readonly run: FrozenRow;
  readonly agent?: FrozenRow;
  readonly agentRow?: FrozenRow;
  readonly identity?: FrozenRow;
  readonly identityRow?: FrozenRow;
  readonly version?: FrozenRow;
  readonly versionRow?: FrozenRow;
  readonly dataSources?: readonly FrozenRow[];
  readonly dataSourceRows?: readonly FrozenRow[];
  readonly candidateActions?: readonly FrozenRow[];
  readonly rejectedActions?: readonly FrozenRow[];
  readonly selectedAction?: FrozenRow | null;
  readonly job?: FrozenRow | null;
  readonly jobRow?: FrozenRow | null;
  readonly settledResult?: FrozenRow | null;
  readonly resultRow?: FrozenRow | null;
  readonly simulationOutput?: unknown;
  readonly riskValidations?: unknown;
  readonly policyValidation?: unknown;
  readonly quote?: unknown;
  readonly receiptSummary?: unknown;
  readonly ipfsDeliverable?: EvidenceReference | null;
  readonly artifactId?: string;
  readonly versionNumber?: number;
  readonly observedAt?: string | Date;
  readonly finalStatus?: "simulated" | "submitted" | "confirmed" | "rejected" | "failed";
  readonly [key: string]: unknown;
}

/** Internal ownership bindings used by the PostgreSQL evidence-object
 * factory. These UUIDs are persisted only in existing FK-capable columns;
 * they are never emitted in the public artifact payload unless the schema
 * already calls for them. */
export interface GreenfieldArtifactBinding {
  readonly artifactType: "agent_profile" | "run_bundle";
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly runId: string | null;
  readonly jobId: string | null;
  /** `agentVersionId` for profiles, `jobId` for run bundles. */
  readonly resourceId: string;
  readonly identity: Erc8004Identity;
}

export class GreenfieldArtifactBuilderError extends Error {
  readonly code = "INVALID_ARTIFACT" as const;

  constructor(message: string) {
    super(message);
    this.name = "GreenfieldArtifactBuilderError";
  }
}

function row(value: unknown, field: string): FrozenRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GreenfieldArtifactBuilderError(`${field} persisted row is required`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GreenfieldArtifactBuilderError(`${field} persisted row must be a plain object`);
  }
  return value as FrozenRow;
}

function optionalRow(value: unknown): FrozenRow | null {
  return value === null || value === undefined ? null : row(value, "optional");
}

function field(source: FrozenRow | null | undefined, ...names: string[]): unknown {
  if (source === undefined || source === null) return undefined;
  for (const name of names) {
    if (source[name] !== undefined) return source[name];
  }
  return undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GreenfieldArtifactBuilderError(`${name} is required in frozen persisted rows`);
  }
  return value.trim();
}

function safeId(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(result)) {
    throw new GreenfieldArtifactBuilderError(`${name} is not a canonical artifact identifier`);
  }
  return result;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function internalUuid(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!uuidPattern.test(result)) throw new GreenfieldArtifactBuilderError(`${name} must be an internal UUID`);
  return result.toLowerCase();
}

function positiveInteger(value: unknown, name: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new GreenfieldArtifactBuilderError(`${name} must be a positive integer`);
  }
  return result;
}

function timestamp(value: unknown, name: string): string {
  const result = value instanceof Date ? new Date(value.valueOf()) : new Date(String(value));
  if (!Number.isFinite(result.valueOf())) throw new GreenfieldArtifactBuilderError(`${name} must be a timestamp`);
  return result.toISOString();
}

function nullableDigest(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const digest = requiredString(value, name).replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new GreenfieldArtifactBuilderError(`${name} must be a 32-byte digest`);
  return digest;
}

function identityFrom(source: FrozenRow | undefined, fallback?: FrozenRow): Erc8004Identity {
  const value = source ?? fallback;
  const parsed = normalizeErc8004Identity({
    namespace: field(value, "namespace", "identityNamespace", "identity_namespace"),
    chainId: field(value, "chainId", "identityChainId", "chain_id", "identity_chain_id"),
    identityRegistry: field(value, "identityRegistry", "identityRegistryAddress", "identity_registry"),
    // Run/agent rows use `agent_id` for an internal UUID FK while persisted
    // identity tuples use `identity_agent_id` for the ERC-8004 uint256. When
    // both are present, the explicit identity alias must win.
    agentId: String(field(value, "identityAgentId", "identity_agent_id", "agentId", "agent_id") ?? "")
  });
  return parsed;
}

function assertIdentityEqual(actual: Erc8004Identity, expected: Erc8004Identity, name: string): void {
  if (
    actual.namespace !== expected.namespace ||
    actual.chainId !== expected.chainId ||
    actual.identityRegistry !== expected.identityRegistry ||
    actual.agentId !== expected.agentId
  ) {
    throw new GreenfieldArtifactBuilderError(`${name} identity does not match the persisted identity tuple`);
  }
}

function plainRecord(value: unknown): FrozenRow | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as FrozenRow) : null;
}

function asDecimalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new GreenfieldArtifactBuilderError(`${name} must be a non-negative integer string`);
    return String(value);
  }
  const result = requiredString(value, name);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) throw new GreenfieldArtifactBuilderError(`${name} must be a non-negative integer string`);
  return result;
}

function supportedProtocols(metadata: FrozenRow, services: readonly FrozenRow[]): string[] {
  const supplied = field(metadata, "supportedProtocols", "supported_protocols");
  if (Array.isArray(supplied)) {
    return supplied.map((value, index) => requiredString(value, `supportedProtocols[${index}]`));
  }
  return [...new Set(services.map((service) => requiredString(field(service, "kind"), "service kind")))];
}

function serviceRows(input: FrozenAgentProfileRows): readonly FrozenRow[] {
  const values = input.services ?? input.serviceRows ?? [];
  return values.map((value) => row(value, "service"));
}

function publicService(service: FrozenRow): FrozenRow {
  return {
    kind: requiredString(field(service, "kind"), "service kind"),
    url: requiredString(field(service, "url"), "service URL"),
    protocolVersion: requiredString(field(service, "protocolVersion", "protocol_version"), "service protocol version"),
    discoverySource: requiredString(field(service, "discoverySource", "discovery_source"), "service discovery source"),
    validationStatus: requiredString(field(service, "validationStatus", "validation_status"), "service validation status"),
    observedAt: timestamp(field(service, "observedAt", "observed_at"), "service observedAt")
  };
}

function publicPricing(metadata: FrozenRow, version?: FrozenRow): FrozenRow {
  const source =
    plainRecord(field(metadata, "pricing", "pricingManifest", "pricing_manifest")) ??
    plainRecord(field(version, "pricingManifest", "pricing_manifest")) ??
    {};
  const output: Record<string, unknown> = {};
  for (const key of ["currency", "unit", "asset", "network", "quoteType", "expiresAt"]) {
    const value = field(source, key, key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`));
    if (value !== undefined && value !== null) {
      output[key] = key === "expiresAt" ? timestamp(value, "pricing expiresAt") : requiredString(value, `pricing ${key}`);
    }
  }
  const amount = asDecimalString(field(source, "amount"), "pricing amount");
  const amountAtomic = asDecimalString(field(source, "amountAtomic", "amount_atomic"), "pricing amountAtomic");
  if (amount !== undefined) output.amount = amount;
  if (amountAtomic !== undefined) output.amountAtomic = amountAtomic;
  return output;
}

function authoritySummary(source: FrozenRow | null): FrozenRow | null {
  if (source === null) return null;
  const walletAddress = field(source, "executionWallet", "execution_wallet", "adminWallet", "admin_wallet", "walletAddress", "wallet_address");
  const session = field(source, "sessionPublicAddress", "session_public_address");
  const expiresAt = field(source, "expiresAt", "expires_at");
  const status = field(source, "status");
  const grant = field(source, "keystoreRegistrationTx", "keystore_registration_tx", "grantTransactionHash", "grant_transaction_hash");
  const calls = plainRecord(field(source, "callsAllowlist", "calls_allowlist"));
  const spend = plainRecord(field(source, "spendLimits", "spend_limits"));
  return {
    ...(walletAddress === undefined ? {} : { walletAddress: requiredString(walletAddress, "authority wallet address") }),
    ...(session === undefined || session === null ? { sessionPublicAddress: null } : { sessionPublicAddress: requiredString(session, "authority session address") }),
    ...(expiresAt === undefined ? {} : { expiresAt: timestamp(expiresAt, "authority expiry") }),
    ...(status === undefined ? {} : { status: requiredString(status, "authority status") }),
    spendLimitSummary: spend === null ? "not disclosed" : `${Object.keys(spend).length} configured spend limit(s)`,
    callsAllowlistSummary: calls === null ? "not disclosed" : `${Object.keys(calls).length} configured call permission group(s)`,
    ...(grant === undefined || grant === null ? { grantTransactionHash: null } : { grantTransactionHash: requiredString(grant, "authority grant transaction") })
  };
}

function templateSummary(source: FrozenRow | null, version: FrozenRow): FrozenRow | null {
  if (source === null) return null;
  const slug = field(source, "slug");
  const semanticVersion = field(source, "semanticVersion", "semantic_version", "version") ?? field(version, "templateVersion", "template_version");
  const digest = field(source, "artifactDigest", "artifact_digest", "digest") ?? field(version, "templateDigest", "template_digest");
  if (slug === undefined && semanticVersion === undefined && digest === undefined) return null;
  return {
    slug: safeId(slug, "template slug"),
    version: requiredString(semanticVersion, "template version"),
    digest: nullableDigest(digest, "template digest") ?? (() => { throw new GreenfieldArtifactBuilderError("template digest is required"); })()
  };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeAndFreeze<T extends CanonicalArtifact>(value: unknown): T {
  return freeze(normalizeArtifact(value) as T);
}

interface AgentProfileContext {
  readonly identityRow: FrozenRow;
  readonly agent: FrozenRow;
  readonly version: FrozenRow;
  readonly metadata: FrozenRow;
  readonly identity: Erc8004Identity;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly createdAt: string;
  readonly binding: GreenfieldArtifactBinding;
}

function profileContext(input: FrozenAgentProfileRows): AgentProfileContext {
  const identityRow = row(input.identity ?? input.identityRow, "identity");
  const agent = row(input.agent ?? input.agentRow, "agent");
  const version = row(input.version ?? input.versionRow, "agent version");
  const metadata = plainRecord(field(version, "publicMetadata", "public_metadata"));
  if (metadata === null) throw new GreenfieldArtifactBuilderError("agent version public metadata is required");
  const identity = identityFrom(identityRow);
  const identityRowId = internalUuid(field(identityRow, "id"), "identity id");
  const agentId = internalUuid(field(agent, "id"), "agent id");
  const agentIdentityId = internalUuid(field(agent, "identityId", "identity_id"), "agent identity id");
  if (agentIdentityId !== identityRowId) throw new GreenfieldArtifactBuilderError("agent does not own the persisted identity row");
  const versionId = internalUuid(field(version, "id"), "agent version id");
  const versionAgentId = internalUuid(field(version, "agentId", "agent_id"), "agent version owner id");
  if (versionAgentId !== agentId) throw new GreenfieldArtifactBuilderError("agent version is not owned by the persisted agent");
  if (field(agent, "namespace", "identityNamespace", "identity_namespace") !== undefined) {
    assertIdentityEqual(identityFrom(agent), identity, "agent");
  }
  if (field(version, "namespace", "identityNamespace", "identity_namespace") !== undefined) {
    assertIdentityEqual(identityFrom(version), identity, "agent version");
  }
  const artifactId = safeId(input.artifactId ?? field(agent, "artifactId", "artifact_id") ?? `agent-${identity.agentId}`, "artifactId");
  const artifactVersion = positiveInteger(input.versionNumber ?? field(version, "version"), "artifact version");
  const persistedVersion = positiveInteger(field(version, "version"), "persisted agent version");
  if (persistedVersion !== artifactVersion) throw new GreenfieldArtifactBuilderError("artifact version does not match persisted agent version");
  const createdAt = timestamp(input.createdAt ?? field(version, "createdAt", "created_at"), "artifact createdAt");
  return {
    identityRow,
    agent,
    version,
    metadata,
    identity,
    artifactId,
    artifactVersion,
    createdAt,
    binding: {
      artifactType: "agent_profile",
      artifactId,
      artifactVersion,
      agentId,
      agentVersionId: versionId,
      runId: null,
      jobId: null,
      resourceId: versionId,
      identity
    }
  };
}

export function agentProfileArtifactBinding(input: FrozenAgentProfileRows): GreenfieldArtifactBinding {
  return profileContext(input).binding;
}

export function buildAgentProfileArtifact(input: FrozenAgentProfileRows): Extract<CanonicalArtifact, { readonly artifactType: "agent_profile" }> {
  const context = profileContext(input);
  const { agent, version, metadata, identity, artifactId, artifactVersion, createdAt } = context;
  const services = serviceRows(input);
  const category = requiredString(field(metadata, "category") ?? field(agent, "category"), "agent category");
  if (!agentCategories.includes(category as (typeof agentCategories)[number])) throw new GreenfieldArtifactBuilderError("agent category is not canonical");
  const capabilityRow = optionalRow(input.capabilityObservation ?? input.capabilityRow);
  const manifest = field(version, "capabilityManifest", "capability_manifest") ?? field(capabilityRow, "capabilityManifest", "capability_manifest");
  const capabilityManifestHash =
    nullableDigest(
      field(version, "capabilityManifestDigest", "capability_manifest_digest", "manifestDigest", "manifest_digest") ??
        field(capabilityRow, "manifestDigest", "manifest_digest"),
      "capability manifest digest"
    ) ?? (manifest === undefined ? null : canonicalSha256Hex(manifest));
  const artifact = {
    schemaVersion: "bnbera.evidence/v1",
    artifactType: "agent_profile",
    artifactId,
    version: artifactVersion,
    environment: input.environment,
    createdAt,
    payload: {
      identity,
      name: requiredString(field(metadata, "name"), "agent name"),
      description: requiredString(field(metadata, "description"), "agent description"),
      category,
      services: services.map(publicService),
      supportedProtocols: supportedProtocols(metadata, services),
      capabilityManifestHash,
      template: templateSummary(optionalRow(input.template ?? input.templateRow) ?? optionalRow(field(version, "template")), version),
      pricing: publicPricing(metadata, version),
      authoritySummary: authoritySummary(optionalRow(input.authority ?? input.authorityRow)),
      evidenceReferences: [...(input.evidenceReferences ?? [])]
    }
  };
  return normalizeAndFreeze(artifact);
}

function publicAction(value: unknown, name: string): FrozenRow | null {
  const source = plainRecord(value);
  if (source === null) return null;
  const output: Record<string, unknown> = {};
  const fields: readonly [string, string][] = [
    ["actionClass", "action_class"],
    ["target", "target"],
    ["selector", "selector"],
    ["valueWei", "value_wei"],
    ["amountAtomic", "amount_atomic"],
    ["asset", "asset"],
    ["protocol", "protocol"],
    ["reasonCode", "reason_code"],
    ["summary", "summary"]
  ];
  for (const [canonical, persisted] of fields) {
    const valueAtKey = field(source, canonical, persisted);
    if (valueAtKey !== undefined && valueAtKey !== null) {
      output[canonical] = ["valueWei", "amountAtomic"].includes(canonical) ? asDecimalString(valueAtKey, `${name}.${canonical}`) : requiredString(valueAtKey, `${name}.${canonical}`);
    }
  }
  return output;
}

function publicResult(value: unknown): PublicJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  const source = plainRecord(value);
  if (source === null) return { status: "unknown" };
  const output: Record<string, unknown> = {};
  const keys = [
    "status", "summary", "reasonCode", "value", "unit", "amount", "amountAtomic", "currency", "asset", "network",
    "quoteType", "expiresAt", "stateDigest", "changed", "valid", "gasEstimateAtomic", "slippageBps", "checks", "warnings",
    "violations", "metricName"
  ] as const;
  for (const key of keys) {
    const valueAtKey = field(source, key, key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`));
    if (valueAtKey === undefined || valueAtKey === null) continue;
    if (["amount", "amountAtomic", "gasEstimateAtomic", "slippageBps"].includes(key)) {
      const decimal = asDecimalString(valueAtKey, `result.${key}`);
      if (decimal !== undefined) output[key] = decimal;
    } else if (key === "expiresAt") {
      output[key] = timestamp(valueAtKey, "result expiresAt");
    } else if (["checks", "warnings", "violations"].includes(key)) {
      if (!Array.isArray(valueAtKey)) throw new GreenfieldArtifactBuilderError(`result ${key} must be an array`);
      output[key] = valueAtKey.map((entry, index) => requiredString(entry, `result ${key}[${index}]`));
    } else {
      output[key] = valueAtKey;
    }
  }
  return Object.keys(output).length === 0 ? { status: "unknown" } : output as PublicJsonValue;
}

function snapshot(value: unknown): FrozenRow {
  const source = plainRecord(value) ?? {};
  const output: Record<string, unknown> = {};
  const stateDigest = nullableDigest(field(source, "stateDigest", "state_digest"), "snapshot state digest");
  const blockNumber = asDecimalString(field(source, "blockNumber", "block_number"), "snapshot block number");
  if (stateDigest !== null) output.stateDigest = stateDigest;
  if (blockNumber !== undefined) output.blockNumber = blockNumber;
  for (const key of ["status", "value", "summary"]) {
    const valueAtKey = field(source, key);
    if (valueAtKey !== undefined && valueAtKey !== null) output[key] = valueAtKey;
  }
  const changed = field(source, "changed");
  if (changed !== undefined) output.changed = Boolean(changed);
  return output;
}

function dataSource(source: FrozenRow): FrozenRow {
  const provider = safeId(field(source, "provider"), "data source provider");
  const version = requiredString(field(source, "version", "sourceVersion", "source_version", "observationType", "observation_type") ?? "unknown", "data source version");
  const observedAt = timestamp(field(source, "observedAt", "observed_at", "sourceTimestamp", "source_timestamp", "createdAt", "created_at"), "data source observedAt");
  const observedBlock = asDecimalString(field(source, "observedBlock", "observed_block", "sourceBlock", "source_block"), "data source observedBlock");
  const payloadDigest = nullableDigest(field(source, "payloadDigest", "payload_digest"), "data source payload digest");
  if (payloadDigest === null) throw new GreenfieldArtifactBuilderError("data source payload digest is required");
  const freshnessValue = requiredString(field(source, "freshness") ?? "unknown", "data source freshness");
  const freshness = ["fresh", "stale", "unknown"].includes(freshnessValue) ? freshnessValue : "unknown";
  return { provider, version, observedAt, observedBlock: observedBlock ?? null, payloadDigest, freshness };
}

function finalStatus(input: FrozenRunBundleRows, run: FrozenRow): FrozenRunBundleRows["finalStatus"] {
  if (input.finalStatus !== undefined) return input.finalStatus;
  const outcome = requiredString(field(run, "outcome", "finalStatus", "final_status"), "run outcome").toLowerCase();
  if (["simulated", "simulation"].includes(outcome)) return "simulated";
  if (["submitted", "pending"].includes(outcome)) return "submitted";
  if (["confirmed", "completed", "settled", "success", "succeeded"].includes(outcome)) return "confirmed";
  if (["rejected", "declined"].includes(outcome)) return "rejected";
  if (["failed", "error", "cancelled", "canceled"].includes(outcome)) return "failed";
  throw new GreenfieldArtifactBuilderError("run outcome has no canonical public status");
}

function transactionHash(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const result = requiredString(value, name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new GreenfieldArtifactBuilderError(`${name} must be a transaction hash`);
  return result.toLowerCase();
}

interface RunBundleContext {
  readonly run: FrozenRow;
  readonly identity: Erc8004Identity;
  readonly version: FrozenRow;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly runId: string;
  readonly jobId: string;
  readonly observedAt: string;
  readonly status: NonNullable<FrozenRunBundleRows["finalStatus"]>;
  readonly decision: FrozenRow;
  readonly transaction: string | null;
  readonly contentSha256: string | null;
  readonly contentKeccak256: string | null;
  readonly binding: GreenfieldArtifactBinding;
}

function assertMatchingUuid(value: unknown, expected: string, name: string): void {
  const actual = internalUuid(value, name);
  if (actual !== expected) throw new GreenfieldArtifactBuilderError(`${name} does not match its owning persisted row`);
}

function runBundleContext(input: FrozenRunBundleRows): RunBundleContext {
  const run = row(input.run, "run");
  const identityRow = row(input.identity ?? input.identityRow, "identity");
  const identity = identityFrom(identityRow);
  const identityRowId = internalUuid(field(identityRow, "id"), "identity id");
  const agent = row(input.agent ?? input.agentRow, "agent");
  const agentId = internalUuid(field(run, "agentId", "agent_id"), "run agent id");
  assertMatchingUuid(field(agent, "id"), agentId, "agent id");
  assertMatchingUuid(field(agent, "identityId", "identity_id"), identityRowId, "agent identity id");
  const version = row(input.version ?? input.versionRow, "agent version");
  const versionId = internalUuid(field(version, "id"), "agent version id");
  assertMatchingUuid(field(version, "agentId", "agent_id"), agentId, "agent version owner id");
  if (field(run, "namespace", "identityNamespace", "identity_namespace") !== undefined) {
    assertIdentityEqual(identityFrom(run), identity, "run");
  }
  if (field(version, "namespace", "identityNamespace", "identity_namespace") !== undefined) {
    assertIdentityEqual(identityFrom(version), identity, "agent version");
  }
  if (field(agent, "namespace", "identityNamespace", "identity_namespace") !== undefined) {
    assertIdentityEqual(identityFrom(agent), identity, "agent");
  }
  const runId = internalUuid(field(run, "id", "runId", "run_id"), "run id");
  const jobId = internalUuid(field(run, "jobId", "job_id"), "run job id");
  const job = optionalRow(input.job ?? input.jobRow);
  if (job !== null) {
    assertMatchingUuid(field(job, "id", "jobId", "job_id"), jobId, "job id");
    const providerAgentId = field(job, "providerAgentId", "provider_agent_id", "agentId", "agent_id");
    if (providerAgentId !== undefined && providerAgentId !== null) assertMatchingUuid(providerAgentId, agentId, "job provider agent id");
  }
  const persistedVersion = positiveInteger(field(version, "version"), "persisted agent version");
  const suppliedRunVersion = field(run, "agentVersion", "agent_version");
  if (suppliedRunVersion !== undefined && positiveInteger(suppliedRunVersion, "run agent version") !== persistedVersion) {
    throw new GreenfieldArtifactBuilderError("run agent version does not match the persisted agent version");
  }
  const artifactVersion = positiveInteger(input.versionNumber ?? persistedVersion, "artifact version");
  if (artifactVersion !== persistedVersion) throw new GreenfieldArtifactBuilderError("artifact version does not match persisted agent version");
  const artifactId = safeId(input.artifactId ?? field(run, "artifactId", "artifact_id") ?? `run-${runId}`, "artifactId");
  const observedAt = timestamp(input.observedAt ?? field(run, "finishedAt", "finished_at", "startedAt", "started_at", "createdAt", "created_at"), "run observedAt");
  const status = finalStatus(input, run);
  if (status === undefined) throw new GreenfieldArtifactBuilderError("run outcome has no canonical public status");
  const result = optionalRow(input.settledResult ?? input.resultRow);
  let contentSha256 = nullableDigest(field(run, "contentSha256", "content_sha256"), "run content sha256");
  let contentKeccak256 = nullableDigest(field(run, "contentKeccak256", "content_keccak256"), "run content keccak256");
  if (status === "confirmed") {
    if (result === null) throw new GreenfieldArtifactBuilderError("a confirmed run requires its persisted settled result row");
    const resultState = requiredString(field(result, "state", "resultState", "result_state"), "settled result state").toLowerCase();
    if (resultState !== "settled") throw new GreenfieldArtifactBuilderError("run result is not settled");
    assertMatchingUuid(field(result, "commerceJobId", "commerce_job_id"), jobId, "settled result job id");
    assertMatchingUuid(field(result, "agentVersionId", "agent_version_id"), versionId, "settled result agent version id");
    const resultVersion = positiveInteger(field(result, "agentVersion", "agent_version"), "settled result agent version");
    if (resultVersion !== persistedVersion) throw new GreenfieldArtifactBuilderError("settled result version does not match the persisted agent version");
    assertIdentityEqual(identityFrom(result), identity, "settled result");
    const resultBinding = plainRecord(field(result, "providerBinding", "provider_binding"));
    if (resultBinding !== null && field(resultBinding, "agentVersionId", "agent_version_id") !== undefined) {
      assertMatchingUuid(field(resultBinding, "agentVersionId", "agent_version_id"), versionId, "settled result provider binding version id");
    }
    const resultSha256 = nullableDigest(field(result, "resultSha256", "result_sha256"), "settled result sha256");
    const resultKeccak256 = nullableDigest(field(result, "resultKeccak", "result_keccak"), "settled result keccak256");
    if (resultSha256 === null || resultKeccak256 === null) throw new GreenfieldArtifactBuilderError("settled result digests are required");
    if (contentSha256 !== null && contentSha256 !== resultSha256) throw new GreenfieldArtifactBuilderError("run content sha256 differs from settled result digest");
    if (contentKeccak256 !== null && contentKeccak256 !== resultKeccak256) throw new GreenfieldArtifactBuilderError("run content keccak256 differs from settled result digest");
    contentSha256 ??= resultSha256;
    contentKeccak256 ??= resultKeccak256;
    if (transactionHash(field(result, "settlementTransactionHash", "settlement_transaction_hash"), "settlement transaction hash") === null) {
      throw new GreenfieldArtifactBuilderError("settled result receipt is required");
    }
  }
  const transaction = transactionHash(field(run, "transactionHash", "transaction_hash"), "run transaction hash");
  const decision = plainRecord(field(run, "decisionSummary", "decision_summary")) ?? {};
  return {
    run,
    identity,
    version,
    artifactId,
    artifactVersion,
    runId,
    jobId,
    observedAt,
    status,
    decision,
    transaction,
    contentSha256,
    contentKeccak256,
    binding: {
      artifactType: "run_bundle",
      artifactId,
      artifactVersion,
      agentId,
      agentVersionId: versionId,
      runId,
      jobId,
      resourceId: jobId,
      identity
    }
  };
}

export function runBundleArtifactBinding(input: FrozenRunBundleRows): GreenfieldArtifactBinding {
  return runBundleContext(input).binding;
}

export function buildRunBundleArtifact(input: FrozenRunBundleRows): Extract<CanonicalArtifact, { readonly artifactType: "run_bundle" }> {
  const context = runBundleContext(input);
  const { run, identity, artifactId, artifactVersion, runId, observedAt, status, decision, transaction, contentSha256, contentKeccak256 } = context;
  const version = context.version;
  const dataSources = (input.dataSources ?? input.dataSourceRows ?? []).map((value) => dataSource(row(value, "data source")));
  const candidates = input.candidateActions ?? (Array.isArray(field(decision, "candidateActions", "candidate_actions")) ? (field(decision, "candidateActions", "candidate_actions") as readonly FrozenRow[]) : []);
  const rejected = input.rejectedActions ?? (Array.isArray(field(decision, "rejectedActions", "rejected_actions")) ? (field(decision, "rejectedActions", "rejected_actions") as readonly FrozenRow[]) : []);
  const candidateActions = candidates.map((value, index) => publicAction(value, `candidateActions[${index}]`)).filter((value): value is FrozenRow => value !== null);
  const rejectedActions = rejected.map((value, index) => publicAction(value, `rejectedActions[${index}]`)).filter((value): value is FrozenRow => value !== null);
  const selected = publicAction(input.selectedAction ?? field(run, "selectedAction", "selected_action"), "selectedAction");
  const before = snapshot(field(run, "beforeState", "before_state"));
  const after = snapshot(field(run, "afterState", "after_state"));
  const artifact = {
    schemaVersion: "bnbera.evidence/v1",
    artifactType: "run_bundle",
    artifactId,
    version: artifactVersion,
    environment: input.environment,
    createdAt: observedAt,
    payload: {
      runId,
      identity,
      agentVersion: String(field(run, "agentVersion", "agent_version") ?? field(version, "version")),
      observedAt,
      observedBlock: asDecimalString(field(run, "observedBlock", "observed_block"), "run observed block") ?? null,
      dataSources,
      candidateActions,
      rejectedActions,
      selectedAction: selected,
      simulationOutput: publicResult(input.simulationOutput ?? field(decision, "simulationOutput", "simulation_output")),
      riskValidations: publicResult(input.riskValidations ?? field(decision, "riskValidations", "risk_validations")),
      policyValidation: publicResult(input.policyValidation ?? field(decision, "policyValidation", "policy_validation")),
      quote: publicResult(input.quote ?? field(run, "quote") ?? field(decision, "quote")),
      transactionHash: transaction,
      receiptSummary: publicResult(input.receiptSummary ?? field(run, "receiptSummary", "receipt_summary")),
      beforeState: before,
      afterState: after,
      ipfsDeliverable: input.ipfsDeliverable ?? null,
      contentSha256,
      contentKeccak256,
      finalStatus: status
    }
  };
  return normalizeAndFreeze(artifact);
}

export const buildAgentProfileArtifactFromRows = buildAgentProfileArtifact;
export const buildRunBundleArtifactFromRows = buildRunBundleArtifact;
