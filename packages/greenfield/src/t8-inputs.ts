import { canonicalSha256Hex, normalizeErc8004Identity, type Erc8004Identity } from "@bnbera/domain";
import {
  buildAgentProfileArtifact,
  buildRunBundleArtifact,
  type FrozenAgentProfileRows,
  type FrozenRunBundleRows
} from "./artifacts.js";

type QueryRow = Record<string, unknown>;

export interface T8QueryResult<T extends QueryRow = QueryRow> {
  readonly rows: readonly T[];
  readonly rowCount?: number | null;
}

export interface T8QueryExecutor {
  readonly query: <T extends QueryRow = QueryRow>(text: string, values?: readonly unknown[]) => Promise<T8QueryResult<T>>;
}

export type T8EvidenceEnvironment = FrozenAgentProfileRows["environment"];

export class T8GreenfieldInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "T8GreenfieldInputError";
    this.code = code;
  }
}

interface T8CommerceFactRow extends QueryRow {
  readonly commerce_job_id: unknown;
  readonly commerce_parent_protocol_job_id: unknown;
  readonly provider_agent_id: unknown;
  readonly buyer_user_id: unknown;
  readonly quote: unknown;
  readonly price_atomic: unknown;
  readonly task_input_digest: unknown;
  readonly commerce_status: unknown;
  readonly parent_funding_transaction_hash: unknown;
  readonly parent_fulfillment_transaction_hash: unknown;
  readonly parent_settlement_transaction_hash: unknown;
  readonly commerce_created_at: unknown;
  readonly erc8183_job_record_id: unknown;
  readonly chain_id: unknown;
  readonly commerce_contract: unknown;
  readonly protocol_job_id: unknown;
  readonly spec_revision: unknown;
  readonly payment_token: unknown;
  readonly payment_decimals: unknown;
  readonly client_address: unknown;
  readonly provider_address: unknown;
  readonly evaluator_address: unknown;
  readonly budget_atomic: unknown;
  readonly description_digest: unknown;
  readonly expires_at: unknown;
  readonly protocol_state: unknown;
  readonly deliverable_digest: unknown;
  readonly protocol_provider_binding: unknown;
  readonly protocol_funding_transaction_hash: unknown;
  readonly protocol_submission_transaction_hash: unknown;
  readonly protocol_completion_transaction_hash: unknown;
  readonly protocol_last_observed_block: unknown;
  readonly protocol_last_observed_at: unknown;
  readonly agent_id: unknown;
  readonly identity_id: unknown;
  readonly agent_category: unknown;
  readonly agent_version_id: unknown;
  readonly agent_version: unknown;
  readonly agent_version_created_at: unknown;
  readonly public_metadata: unknown;
  readonly capability_manifest: unknown;
  readonly pricing_manifest: unknown;
  readonly identity_namespace: unknown;
  readonly identity_chain_id: unknown;
  readonly identity_registry: unknown;
  readonly identity_agent_id: unknown;
  readonly result_id: unknown;
  readonly result_buyer_user_id: unknown;
  readonly result_buyer_address: unknown;
  readonly result_identity_namespace: unknown;
  readonly result_identity_chain_id: unknown;
  readonly result_identity_registry: unknown;
  readonly result_identity_agent_id: unknown;
  readonly result_agent_version_id: unknown;
  readonly result_agent_version: unknown;
  readonly result_provider_address: unknown;
  readonly result_provider_binding: unknown;
  readonly result_sha256: unknown;
  readonly result_keccak: unknown;
  readonly result_payload: unknown;
  readonly result_submission_transaction_hash: unknown;
  readonly result_submission_block_number: unknown;
  readonly result_submission_block_hash: unknown;
  readonly result_submission_log_index: unknown;
  readonly result_submitted_at: unknown;
  readonly result_state: unknown;
  readonly result_settlement_transaction_hash: unknown;
  readonly result_settlement_block_number: unknown;
  readonly result_settlement_block_hash: unknown;
  readonly result_settlement_log_index: unknown;
  readonly result_settled_at: unknown;
}

interface T8ServiceFactRow extends QueryRow {
  readonly id: unknown;
  readonly kind: unknown;
  readonly url: unknown;
  readonly protocol_version: unknown;
  readonly discovery_source: unknown;
  readonly validation_status: unknown;
  readonly observed_at: unknown;
}

export interface T8SettledCommerceFacts {
  readonly row: T8CommerceFactRow;
  readonly services: readonly T8ServiceFactRow[];
}

export interface T8FrozenInputs {
  readonly profileRows: FrozenAgentProfileRows;
  readonly runRows: FrozenRunBundleRows;
  readonly runId: string;
  readonly commerceJobId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface T8FrozenArtifacts extends T8FrozenInputs {
  readonly profileArtifact: ReturnType<typeof buildAgentProfileArtifact>;
  readonly runArtifact: ReturnType<typeof buildRunBundleArtifact>;
}

export interface T8AgentRunProjection {
  readonly runId: string;
  readonly commerceJobId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly created: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const digestPattern = /^[0-9a-f]{64}$/i;
const transactionPattern = /^0x[0-9a-f]{64}$/i;
const decimalPattern = /^(0|[1-9][0-9]*)$/u;

function fail(code: string, message: string): never {
  throw new T8GreenfieldInputError(code, message);
}

function record(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a persisted object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a plain persisted object`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return record(value, "optional persisted object");
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("PUBLIC_FACT_INVALID", `${fieldName} is required`);
  return value.trim();
}

function boundedString(value: unknown, fieldName: string, max = 4_096): string {
  const result = stringValue(value, fieldName);
  if (result.length > max) fail("PUBLIC_FACT_INVALID", `${fieldName} is too long`);
  return result;
}

function uuid(value: unknown, fieldName: string): string {
  const result = stringValue(value, fieldName).toLowerCase();
  if (!uuidPattern.test(result)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a UUID`);
  return result;
}

function address(value: unknown, fieldName: string): string {
  const result = stringValue(value, fieldName).toLowerCase();
  if (!addressPattern.test(result) || /^0x0{40}$/u.test(result)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a non-zero EVM address`);
  return result;
}

function digest(value: unknown, fieldName: string, allowPrefix = false): string {
  const result = stringValue(value, fieldName).replace(/^0x/u, "").toLowerCase();
  if (!digestPattern.test(result)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a 32-byte digest`);
  return allowPrefix ? `0x${result}` : result;
}

function transaction(value: unknown, fieldName: string): string {
  const result = stringValue(value, fieldName).toLowerCase();
  if (!transactionPattern.test(result)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a transaction hash`);
  return result;
}

function optionalTransaction(value: unknown, fieldName: string): string | null {
  return value === null || value === undefined || value === "" ? null : transaction(value, fieldName);
}

function decimal(value: unknown, fieldName: string): string {
  const result = typeof value === "number" ? String(value) : stringValue(value, fieldName);
  if (!decimalPattern.test(result)) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a canonical decimal integer`);
  return result;
}

function positiveInteger(value: unknown, fieldName: string): number {
  const result = typeof value === "number" ? value : Number(stringValue(value, fieldName));
  if (!Number.isSafeInteger(result) || result <= 0) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a positive integer`);
  return result;
}

function nonNegativeInteger(value: unknown, fieldName: string): number {
  const result = typeof value === "number" ? value : Number(stringValue(value, fieldName));
  if (!Number.isSafeInteger(result) || result < 0) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a non-negative integer`);
  return result;
}

function timestamp(value: unknown, fieldName: string): string {
  const result = value instanceof Date ? new Date(value.valueOf()) : new Date(String(value));
  if (!Number.isFinite(result.valueOf())) fail("PUBLIC_FACT_INVALID", `${fieldName} must be a timestamp`);
  return result.toISOString();
}

function assertEqual(actual: string | number | null, expected: string | number | null, fieldName: string): void {
  if (actual !== expected) fail("PUBLIC_BINDING_MISMATCH", `${fieldName} does not match its persisted parent`);
}

function field(source: Record<string, unknown> | null, ...names: string[]): unknown {
  if (source === null) return undefined;
  for (const name of names) {
    if (source[name] !== undefined) return source[name];
  }
  return undefined;
}

function deterministicUuid(seed: string): string {
  const hex = canonicalSha256Hex(seed).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

function identityFromRow(row: T8CommerceFactRow): Erc8004Identity {
  try {
    return normalizeErc8004Identity({
      namespace: stringValue(row.identity_namespace, "identity namespace"),
      chainId: positiveInteger(row.identity_chain_id, "identity chain id"),
      identityRegistry: address(row.identity_registry, "identity registry"),
      agentId: decimal(row.identity_agent_id, "identity agent id")
    });
  } catch (cause) {
    if (cause instanceof T8GreenfieldInputError) throw cause;
    fail("PUBLIC_FACT_INVALID", `identity tuple is invalid: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
}

function identityFromBinding(value: unknown, fieldName: string): { readonly identity: Erc8004Identity; readonly agentVersionId: string; readonly agentVersion: number } {
  const source = record(value, fieldName);
  const bindingIdentity = record(source.identity, `${fieldName}.identity`);
  let identity: Erc8004Identity;
  try {
    identity = normalizeErc8004Identity({
      namespace: field(bindingIdentity, "namespace"),
      chainId: field(bindingIdentity, "chainId", "chain_id"),
      identityRegistry: field(bindingIdentity, "identityRegistry", "identity_registry"),
      agentId: field(bindingIdentity, "agentId", "agent_id")
    });
  } catch (cause) {
    fail("PUBLIC_BINDING_MISMATCH", `${fieldName}.identity is invalid: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
  return {
    identity,
    agentVersionId: uuid(field(source, "agentVersionId", "agent_version_id"), `${fieldName}.agentVersionId`),
    agentVersion: positiveInteger(field(source, "agentVersion", "agent_version"), `${fieldName}.agentVersion`)
  };
}

function assertIdentityEqual(actual: Erc8004Identity, expected: Erc8004Identity, fieldName: string): void {
  if (
    actual.namespace !== expected.namespace ||
    actual.chainId !== expected.chainId ||
    actual.identityRegistry !== expected.identityRegistry ||
    actual.agentId !== expected.agentId
  ) fail("PUBLIC_BINDING_MISMATCH", `${fieldName} does not match the persisted ERC-8004 identity`);
}

function assertBindingEqual(
  actual: { readonly identity: Erc8004Identity; readonly agentVersionId: string; readonly agentVersion: number },
  expected: { readonly identity: Erc8004Identity; readonly agentVersionId: string; readonly agentVersion: number },
  fieldName: string
): void {
  assertIdentityEqual(actual.identity, expected.identity, `${fieldName} identity`);
  if (actual.agentVersionId !== expected.agentVersionId || actual.agentVersion !== expected.agentVersion) {
    fail("PUBLIC_BINDING_MISMATCH", `${fieldName} does not match the persisted agent version`);
  }
}

function publicString(source: Record<string, unknown>, ...names: string[]): string | undefined {
  const value = field(source, ...names);
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, names[0] ?? "public field");
}

function publicDecimal(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return decimal(value, fieldName);
}

function safePublicServiceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  const privateHost = hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" ||
    hostname.endsWith(".local") || hostname.startsWith("10.") || hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./u.test(hostname) || hostname.startsWith("127.");
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "" || privateHost) return null;
  for (const key of parsed.searchParams.keys()) {
    if (/(?:api[_-]?key|access[_-]?token|authorization|credential|password|private[_-]?key|secret|token)/iu.test(key)) return null;
  }
  return parsed.toString();
}

function publicService(row: T8ServiceFactRow): Record<string, unknown> | null {
  const url = safePublicServiceUrl(row.url);
  if (url === null) return null;
  return {
    kind: boundedString(row.kind, "service kind", 128),
    url,
    protocol_version: boundedString(row.protocol_version, "service protocol version", 128),
    discovery_source: boundedString(row.discovery_source, "service discovery source", 128),
    validation_status: boundedString(row.validation_status, "service validation status", 64),
    observed_at: timestamp(row.observed_at, "service observed_at")
  };
}

const publicPricingKeys = ["currency", "unit", "asset", "network", "quoteType", "quote_type", "expiresAt", "expires_at", "amount", "amountAtomic", "amount_atomic"] as const;

function publicPricing(value: unknown): Record<string, unknown> {
  const source = optionalRecord(value);
  if (source === null) return {};
  const output: Record<string, unknown> = {};
  for (const key of publicPricingKeys) {
    const valueAtKey = source[key];
    if (valueAtKey === undefined || valueAtKey === null || valueAtKey === "") continue;
    const canonical = key === "quote_type" ? "quoteType" : key === "expires_at" ? "expiresAt" : key === "amount_atomic" ? "amountAtomic" : key;
    if (canonical === "amount" || canonical === "amountAtomic") {
      output[canonical] = publicDecimal(valueAtKey, `pricing ${canonical}`);
    } else if (canonical === "expiresAt") {
      output[canonical] = timestamp(valueAtKey, "pricing expiresAt");
    } else if (canonical === "network" && typeof valueAtKey === "number") {
      if (!Number.isSafeInteger(valueAtKey) || valueAtKey < 0) fail("PUBLIC_FACT_INVALID", "pricing network must be a non-negative integer");
      output[canonical] = valueAtKey;
    } else {
      output[canonical] = boundedString(valueAtKey, `pricing ${canonical}`, 128);
    }
  }
  return output;
}

const publicResultKeys = [
  "status", "summary", "reasonCode", "reason_code", "value", "unit", "amount", "amountAtomic", "amount_atomic", "currency", "asset", "network",
  "quoteType", "quote_type", "expiresAt", "expires_at", "stateDigest", "state_digest", "changed", "valid", "gasEstimateAtomic", "gas_estimate_atomic",
  "slippageBps", "slippage_bps", "checks", "warnings", "violations", "metricName", "metric_name"
] as const;

function publicResult(value: unknown): Record<string, unknown> {
  const source = optionalRecord(value);
  if (source === null) return { status: "unknown" };
  const output: Record<string, unknown> = {};
  for (const key of publicResultKeys) {
    const valueAtKey = source[key];
    if (valueAtKey === undefined || valueAtKey === null) continue;
    const canonical = key === "reason_code" ? "reasonCode" : key === "amount_atomic" ? "amountAtomic" : key === "quote_type" ? "quoteType" : key === "expires_at" ? "expiresAt" : key === "state_digest" ? "stateDigest" : key === "gas_estimate_atomic" ? "gasEstimateAtomic" : key === "slippage_bps" ? "slippageBps" : key === "metric_name" ? "metricName" : key;
    if (["checks", "warnings", "violations"].includes(canonical)) {
      if (!Array.isArray(valueAtKey)) continue;
      output[canonical] = valueAtKey.slice(0, 32).map((entry, index) => boundedString(entry, `result ${canonical}[${index}]`, 512));
    } else if (["amount", "amountAtomic", "gasEstimateAtomic", "slippageBps"].includes(canonical)) {
      output[canonical] = publicDecimal(valueAtKey, `result ${canonical}`);
    } else if (["expiresAt"].includes(canonical)) {
      output[canonical] = timestamp(valueAtKey, `result ${canonical}`);
    } else if (canonical === "stateDigest") {
      output[canonical] = digest(valueAtKey, "result stateDigest");
    } else if (canonical === "network" && typeof valueAtKey === "number") {
      if (!Number.isSafeInteger(valueAtKey) || valueAtKey < 0) fail("PUBLIC_FACT_INVALID", "result network must be a non-negative integer");
      output[canonical] = String(valueAtKey);
    } else if (typeof valueAtKey === "string") {
      output[canonical] = boundedString(valueAtKey, `result ${canonical}`, 4_096);
    } else if (typeof valueAtKey === "number" || typeof valueAtKey === "boolean") {
      if (typeof valueAtKey === "number" && !Number.isFinite(valueAtKey)) continue;
      output[canonical] = valueAtKey;
    }
  }
  return Object.keys(output).length === 0 ? { status: "unknown" } : output;
}

function publicQuote(value: unknown): Record<string, unknown> {
  return publicResult(value);
}

function receipt(
  transactionHash: string,
  blockNumber: string,
  blockHash: string,
  logIndex: number | null
): Record<string, unknown> {
  return {
    transactionHash,
    blockNumber,
    blockHash,
    ...(logIndex === null ? {} : { logIndex })
  };
}

function capabilityDigest(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const source = record(value, "capability manifest");
  try {
    return canonicalSha256Hex(source);
  } catch (cause) {
    fail("PUBLIC_FACT_INVALID", `capability manifest is not canonical JSON: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
}

function safeMetadata(row: T8CommerceFactRow): Record<string, unknown> {
  const source = record(row.public_metadata, "public metadata");
  const name = publicString(source, "name");
  const description = publicString(source, "description");
  if (name === undefined || description === undefined) fail("PUBLIC_FACT_INCOMPLETE", "persisted public metadata needs name and description");
  const category = publicString(source, "category") ?? boundedString(row.agent_category, "agent category", 128);
  const output: Record<string, unknown> = { name, description, category };
  const protocols = field(source, "supportedProtocols", "supported_protocols");
  if (Array.isArray(protocols)) {
    output.supported_protocols = protocols.slice(0, 32).map((entry, index) => boundedString(entry, `supported protocols[${index}]`, 128));
  }
  return output;
}

function validateFacts(facts: T8SettledCommerceFacts): {
  readonly row: T8CommerceFactRow;
  readonly services: readonly Record<string, unknown>[];
  readonly identity: Erc8004Identity;
  readonly commerceJobId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly agentVersion: number;
  readonly jobRecordId: string;
  readonly resultId: string;
  readonly submittedAt: string;
  readonly settledAt: string;
  readonly resultSha256: string;
  readonly resultKeccak: string;
  readonly submissionTransactionHash: string;
  readonly settlementTransactionHash: string;
  readonly submissionReceipt: Record<string, unknown>;
  readonly settlementReceipt: Record<string, unknown>;
  readonly protocolJobId: string;
} {
  const row = facts.row;
  const commerceJobId = uuid(row.commerce_job_id, "commerce job id");
  const commerceProtocolJobId = decimal(row.commerce_parent_protocol_job_id, "commerce parent protocol job id");
  const protocolJobId = decimal(row.protocol_job_id, "protocol job id");
  if (commerceProtocolJobId !== protocolJobId) fail("PUBLIC_BINDING_MISMATCH", "commerce and protocol job IDs differ");
  const agentId = uuid(row.agent_id, "agent id");
  const providerAgentId = uuid(row.provider_agent_id, "provider agent id");
  assertEqual(providerAgentId, agentId, "commerce provider agent");
  const identityId = uuid(row.identity_id, "identity id");
  const agentIdentityId = uuid(row.identity_id, "agent identity id");
  assertEqual(agentIdentityId, identityId, "agent identity");
  const agentVersionId = uuid(row.agent_version_id, "agent version id");
  const resultAgentVersionId = uuid(row.result_agent_version_id, "result agent version id");
  assertEqual(resultAgentVersionId, agentVersionId, "result agent version");
  const agentVersion = positiveInteger(row.agent_version, "agent version");
  const resultAgentVersion = positiveInteger(row.result_agent_version, "result agent version");
  assertEqual(resultAgentVersion, agentVersion, "result agent version number");
  const resultId = uuid(row.result_id, "result id");
  const jobRecordId = uuid(row.erc8183_job_record_id, "ERC-8183 job record id");
  const chainId = positiveInteger(row.chain_id, "commerce chain id");
  if (chainId !== positiveInteger(row.identity_chain_id, "identity chain id") || chainId !== positiveInteger(row.result_identity_chain_id, "result identity chain id")) {
    fail("PUBLIC_BINDING_MISMATCH", "job and result identity chain IDs differ");
  }
  const identity = identityFromRow(row);
  const resultIdentity = normalizeErc8004Identity({
    namespace: row.result_identity_namespace,
    chainId,
    identityRegistry: row.result_identity_registry,
    agentId: row.result_identity_agent_id
  });
  assertIdentityEqual(resultIdentity, identity, "result identity");
  const registry = address(row.identity_registry, "identity registry");
  if (registry !== address(row.result_identity_registry, "result identity registry")) fail("PUBLIC_BINDING_MISMATCH", "result identity registry differs");
  if (registry !== identity.identityRegistry) fail("PUBLIC_BINDING_MISMATCH", "identity registry normalization differs");
  if (decimal(row.identity_agent_id, "identity agent id") !== identity.agentId) fail("PUBLIC_BINDING_MISMATCH", "identity agent id differs");
  const resultBinding = identityFromBinding(row.result_provider_binding, "result provider binding");
  assertBindingEqual(resultBinding, { identity, agentVersionId, agentVersion }, "result provider binding");
  const protocolBinding = identityFromBinding(row.protocol_provider_binding, "protocol provider binding");
  assertBindingEqual(protocolBinding, resultBinding, "protocol provider binding");
  if (stringValue(row.commerce_status, "commerce status") !== "settled") fail("JOB_NOT_SETTLED", "commerce job is not settled");
  if (stringValue(row.protocol_state, "protocol state") !== "completed") fail("JOB_NOT_SETTLED", "ERC-8183 job is not completed");
  if (stringValue(row.result_state, "result state") !== "settled") fail("JOB_NOT_SETTLED", "marketplace result is not settled");
  const clientAddress = address(row.client_address, "client address");
  if (clientAddress !== address(row.result_buyer_address, "result buyer address")) fail("PUBLIC_BINDING_MISMATCH", "result buyer differs from protocol client");
  const providerAddress = address(row.provider_address, "provider address");
  if (providerAddress !== address(row.result_provider_address, "result provider address")) fail("PUBLIC_BINDING_MISMATCH", "result provider differs from protocol provider");
  const resultSha256 = digest(row.result_sha256, "result sha256");
  const resultKeccak = digest(row.result_keccak, "result keccak", true);
  if (digest(row.deliverable_digest, "deliverable digest") !== resultSha256) fail("PUBLIC_BINDING_MISMATCH", "result digest differs from protocol deliverable digest");
  const submissionTransactionHash = transaction(row.result_submission_transaction_hash, "result submission transaction");
  const settlementTransactionHash = transaction(row.result_settlement_transaction_hash, "result settlement transaction");
  if (optionalTransaction(row.protocol_submission_transaction_hash, "protocol submission transaction") !== submissionTransactionHash) fail("PUBLIC_BINDING_MISMATCH", "submission receipt differs from protocol job");
  if (optionalTransaction(row.protocol_completion_transaction_hash, "protocol completion transaction") !== settlementTransactionHash) fail("PUBLIC_BINDING_MISMATCH", "settlement receipt differs from protocol job");
  if (optionalTransaction(row.parent_settlement_transaction_hash, "parent settlement transaction") !== settlementTransactionHash) fail("PUBLIC_BINDING_MISMATCH", "settlement receipt differs from commerce parent");
  if (optionalTransaction(row.parent_fulfillment_transaction_hash, "parent fulfillment transaction") !== submissionTransactionHash) fail("PUBLIC_BINDING_MISMATCH", "submission receipt differs from commerce parent");
  const parentFunding = optionalTransaction(row.parent_funding_transaction_hash, "parent funding transaction");
  const protocolFunding = optionalTransaction(row.protocol_funding_transaction_hash, "protocol funding transaction");
  if (parentFunding === null || protocolFunding === null || parentFunding !== protocolFunding) fail("PUBLIC_FACT_INCOMPLETE", "settled job is missing matching funding receipt");
  const submittedAt = timestamp(row.result_submitted_at, "result submitted_at");
  const settledAt = timestamp(row.result_settled_at, "result settled_at");
  if (Date.parse(settledAt) <= Date.parse(submittedAt)) fail("PUBLIC_FACT_INVALID", "settlement timestamp must be after submission");
  const submissionBlockNumber = decimal(row.result_submission_block_number, "submission block number");
  const settlementBlockNumber = decimal(row.result_settlement_block_number, "settlement block number");
  const submissionBlockHash = transaction(row.result_submission_block_hash, "submission block hash");
  const settlementBlockHash = transaction(row.result_settlement_block_hash, "settlement block hash");
  const submissionLogIndex = row.result_submission_log_index === null || row.result_submission_log_index === undefined ? null : nonNegativeInteger(row.result_submission_log_index, "submission log index");
  const settlementLogIndex = row.result_settlement_log_index === null || row.result_settlement_log_index === undefined ? null : nonNegativeInteger(row.result_settlement_log_index, "settlement log index");
  const services = facts.services.map(publicService).filter((value): value is Record<string, unknown> => value !== null);
  return {
    row,
    services,
    identity,
    commerceJobId,
    agentId,
    agentVersionId,
    agentVersion,
    jobRecordId,
    resultId,
    submittedAt,
    settledAt,
    resultSha256,
    resultKeccak,
    submissionTransactionHash,
    settlementTransactionHash,
    submissionReceipt: receipt(submissionTransactionHash, submissionBlockNumber, submissionBlockHash, submissionLogIndex),
    settlementReceipt: receipt(settlementTransactionHash, settlementBlockNumber, settlementBlockHash, settlementLogIndex),
    protocolJobId
  };
}

const settledCommerceQuery = `
  SELECT
    c.id AS commerce_job_id,
    c.erc8183_job_id AS commerce_parent_protocol_job_id,
    c.provider_agent_id,
    c.buyer_user_id,
    c.quote,
    c.price::text AS price_atomic,
    c.task_input_digest,
    c.status AS commerce_status,
    c.funding_transaction_hash AS parent_funding_transaction_hash,
    c.fulfillment_transaction_hash AS parent_fulfillment_transaction_hash,
    c.settlement_transaction_hash AS parent_settlement_transaction_hash,
    c."createdAt" AS commerce_created_at,
    j.id AS erc8183_job_record_id,
    j.chain_id,
    j.commerce_contract,
    j.erc8183_job_id AS protocol_job_id,
    j.spec_revision,
    j.payment_token,
    j.payment_decimals,
    j.client_address,
    j.provider_address,
    j.evaluator_address,
    j.budget_atomic::text AS budget_atomic,
    j.description_digest,
    j.expires_at,
    j.state AS protocol_state,
    j.deliverable_digest,
    j.provider_binding AS protocol_provider_binding,
    j.funding_transaction_hash AS protocol_funding_transaction_hash,
    j.submission_transaction_hash AS protocol_submission_transaction_hash,
    j.completion_transaction_hash AS protocol_completion_transaction_hash,
    j.last_observed_block AS protocol_last_observed_block,
    j.last_observed_at AS protocol_last_observed_at,
    a.id AS agent_id,
    a.identity_id,
    a.category AS agent_category,
    v.id AS agent_version_id,
    v.version AS agent_version,
    v."createdAt" AS agent_version_created_at,
    v.public_metadata,
    v.capability_manifest,
    v.pricing_manifest,
    i.namespace AS identity_namespace,
    i.chain_id AS identity_chain_id,
    i.identity_registry,
    i.agent_id AS identity_agent_id,
    r.id AS result_id,
    r.buyer_user_id AS result_buyer_user_id,
    r.buyer_address AS result_buyer_address,
    r.identity_namespace AS result_identity_namespace,
    r.identity_chain_id AS result_identity_chain_id,
    r.identity_registry AS result_identity_registry,
    r.identity_agent_id AS result_identity_agent_id,
    r.agent_version_id AS result_agent_version_id,
    r.agent_version AS result_agent_version,
    r.provider_address AS result_provider_address,
    r.provider_binding AS result_provider_binding,
    r.result_sha256,
    r.result_keccak,
    r.result_payload,
    r.submission_transaction_hash AS result_submission_transaction_hash,
    r.submission_block_number AS result_submission_block_number,
    r.submission_block_hash AS result_submission_block_hash,
    r.submission_log_index AS result_submission_log_index,
    r.submitted_at AS result_submitted_at,
    r.state AS result_state,
    r.settlement_transaction_hash AS result_settlement_transaction_hash,
    r.settlement_block_number AS result_settlement_block_number,
    r.settlement_block_hash AS result_settlement_block_hash,
    r.settlement_log_index AS result_settlement_log_index,
    r.settled_at AS result_settled_at
  FROM commerce_jobs c
  JOIN erc8183_jobs j ON j.commerce_job_id = c.id
  JOIN commerce_job_results r ON r.commerce_job_id = c.id AND r.erc8183_job_record_id = j.id
  JOIN agents a ON a.id = c.provider_agent_id
  JOIN agent_versions v ON v.id = r.agent_version_id AND v.agent_id = a.id
  JOIN erc8004_identities i ON i.id = a.identity_id
  WHERE c.id = $1
  LIMIT 1
`;

const serviceQuery = `
  SELECT id, kind, url, protocol_version, discovery_source, validation_status, observed_at
    FROM agent_services
   WHERE agent_version_id = $1
   ORDER BY observed_at DESC, id DESC
`;

export async function loadT8SettledCommerceFacts(query: T8QueryExecutor, commerceJobId: string): Promise<T8SettledCommerceFacts> {
  const id = uuid(commerceJobId, "commerce job id");
  const result = await query.query<T8CommerceFactRow>(settledCommerceQuery, [id]);
  const row = result.rows[0];
  if (row === undefined) fail("JOB_FACTS_NOT_FOUND", "no complete persisted commerce/result/agent binding was found for this job");
  const agentVersionId = uuid(row.agent_version_id, "agent version id");
  const services = await query.query<T8ServiceFactRow>(serviceQuery, [agentVersionId]);
  // Validate before returning so the CLI cannot accidentally export an
  // incomplete row set. The return keeps raw DB facts private to this module.
  validateFacts({ row, services: services.rows });
  return { row, services: services.rows };
}

export function buildT8FrozenInputs(
  facts: T8SettledCommerceFacts,
  environment: T8EvidenceEnvironment = "hackathon"
): T8FrozenInputs {
  const validated = validateFacts(facts);
  const row = validated.row;
  const metadata = safeMetadata(row);
  const pricing = publicPricing(row.pricing_manifest);
  const capabilityManifestDigest = capabilityDigest(row.capability_manifest);
  const identityRow = {
    id: uuid(row.identity_id, "identity id"),
    namespace: validated.identity.namespace,
    chain_id: validated.identity.chainId,
    identity_registry: validated.identity.identityRegistry,
    agent_id: validated.identity.agentId
  };
  const agentRow = {
    id: validated.agentId,
    identity_id: uuid(row.identity_id, "agent identity id"),
    category: boundedString(row.agent_category, "agent category", 128)
  };
  const versionRow = {
    id: validated.agentVersionId,
    agent_id: validated.agentId,
    version: validated.agentVersion,
    created_at: timestamp(row.agent_version_created_at, "agent version created_at"),
    public_metadata: metadata,
    pricing_manifest: pricing,
    ...(capabilityManifestDigest === undefined ? {} : { capability_manifest_digest: capabilityManifestDigest })
  };
  const profileRows: FrozenAgentProfileRows = {
    environment,
    identityRow,
    agentRow,
    versionRow,
    serviceRows: validated.services
  };
  const runId = deterministicUuid(`bnbera.t8.greenfield.run:${validated.commerceJobId}`);
  const inputSnapshot = {
    commerceJobId: validated.commerceJobId,
    erc8183JobRecordId: validated.jobRecordId,
    protocolJobId: validated.protocolJobId,
    resultId: validated.resultId,
    taskInputDigest: digest(row.task_input_digest, "task input digest"),
    buyerAddress: address(row.result_buyer_address, "buyer address"),
    providerAddress: address(row.result_provider_address, "provider address"),
    budgetAtomic: decimal(row.budget_atomic, "budget atomic"),
    paymentToken: address(row.payment_token, "payment token"),
    paymentDecimals: nonNegativeInteger(row.payment_decimals, "payment decimals"),
    identity: validated.identity,
    agentVersion: validated.agentVersion,
    submittedAt: validated.submittedAt,
    settledAt: validated.settledAt,
    quote: publicQuote(row.quote)
  };
  const decisionSummary = {
    // The artifact builder exposes this allow-listed value as
    // `simulationOutput`; the source is the persisted result payload, never a
    // caller-supplied or fetched deliverable URL.
    simulation_output: publicResult(row.result_payload),
    quote: publicQuote(row.quote),
    settlement: {
      submission: validated.submissionReceipt,
      settlement: validated.settlementReceipt
    }
  };
  const runRows: FrozenRunBundleRows = {
    environment,
    run: {
      id: runId,
      agent_id: validated.agentId,
      job_id: validated.commerceJobId,
      identity_namespace: validated.identity.namespace,
      identity_chain_id: validated.identity.chainId,
      identity_registry: validated.identity.identityRegistry,
      identity_agent_id: validated.identity.agentId,
      agent_version: validated.agentVersion,
      input_snapshot: inputSnapshot,
      decision_summary: decisionSummary,
      selected_action: null,
      before_state: null,
      after_state: null,
      content_sha256: validated.resultSha256,
      content_keccak256: validated.resultKeccak,
      transaction_hash: validated.settlementTransactionHash,
      outcome: "completed",
      started_at: timestamp(row.commerce_created_at, "commerce created_at"),
      finished_at: validated.settledAt
    },
    agentRow,
    identityRow,
    versionRow,
    settledResult: {
      state: "settled",
      commerce_job_id: validated.commerceJobId,
      agent_version_id: validated.agentVersionId,
      agent_version: validated.agentVersion,
      namespace: validated.identity.namespace,
      chain_id: validated.identity.chainId,
      identity_registry: validated.identity.identityRegistry,
      agent_id: validated.identity.agentId,
      result_sha256: validated.resultSha256,
      result_keccak: validated.resultKeccak,
      settlement_transaction_hash: validated.settlementTransactionHash
    }
  };
  // Run the same builders used by publication before returning rows. This
  // enforces the canonical artifact schema and catches any future input drift.
  buildAgentProfileArtifact(profileRows);
  buildRunBundleArtifact(runRows);
  return { profileRows, runRows, runId, commerceJobId: validated.commerceJobId, agentId: validated.agentId, agentVersionId: validated.agentVersionId };
}

export function buildT8FrozenArtifacts(
  facts: T8SettledCommerceFacts,
  environment: T8EvidenceEnvironment = "hackathon"
): T8FrozenArtifacts {
  const inputs = buildT8FrozenInputs(facts, environment);
  return {
    ...inputs,
    profileArtifact: buildAgentProfileArtifact(inputs.profileRows),
    runArtifact: buildRunBundleArtifact(inputs.runRows)
  };
}

interface AgentRunRow extends QueryRow {
  readonly id: unknown;
  readonly agent_id: unknown;
  readonly job_id: unknown;
  readonly template_id: unknown;
  readonly template_version: unknown;
  readonly input_snapshot: unknown;
  readonly decision_summary: unknown;
  readonly selected_action: unknown;
  readonly before_state: unknown;
  readonly after_state: unknown;
  readonly transaction_hash: unknown;
  readonly outcome: unknown;
  readonly started_at: unknown;
  readonly finished_at: unknown;
}

function comparableTimestamp(value: unknown, fieldName: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, fieldName);
}

function projectionValue(row: AgentRunRow): Record<string, unknown> {
  return {
    id: uuid(row.id, "agent run id"),
    agent_id: uuid(row.agent_id, "agent run agent id"),
    job_id: row.job_id === null ? null : uuid(row.job_id, "agent run job id"),
    template_id: row.template_id === null ? null : uuid(row.template_id, "agent run template id"),
    template_version: row.template_version === null ? null : boundedString(row.template_version, "agent run template version", 32),
    input_snapshot: record(row.input_snapshot, "agent run input snapshot"),
    decision_summary: record(row.decision_summary, "agent run decision summary"),
    selected_action: row.selected_action === null ? null : record(row.selected_action, "agent run selected action"),
    before_state: row.before_state === null ? null : record(row.before_state, "agent run before state"),
    after_state: row.after_state === null ? null : record(row.after_state, "agent run after state"),
    transaction_hash: row.transaction_hash === null ? null : transaction(row.transaction_hash, "agent run transaction hash"),
    outcome: boundedString(row.outcome, "agent run outcome", 64),
    started_at: timestamp(row.started_at, "agent run started_at"),
    finished_at: comparableTimestamp(row.finished_at, "agent run finished_at")
  };
}

function expectedProjection(inputs: T8FrozenInputs): Record<string, unknown> {
  const run = record(inputs.runRows.run, "run");
  return {
    id: uuid(run.id, "agent run id"),
    agent_id: uuid(run.agent_id, "agent run agent id"),
    job_id: uuid(run.job_id, "agent run job id"),
    template_id: null,
    template_version: null,
    input_snapshot: record(run.input_snapshot, "input snapshot"),
    decision_summary: record(run.decision_summary, "decision summary"),
    selected_action: null,
    before_state: null,
    after_state: null,
    transaction_hash: transaction(run.transaction_hash, "run transaction hash"),
    outcome: boundedString(run.outcome, "run outcome", 64),
    started_at: timestamp(run.started_at, "run started_at"),
    finished_at: timestamp(run.finished_at, "run finished_at")
  };
}

function projectionDigest(value: Record<string, unknown>): string {
  return canonicalSha256Hex(value);
}

export async function projectT8SettledCommerceJob(
  query: T8QueryExecutor,
  inputs: T8FrozenInputs
): Promise<T8AgentRunProjection> {
  const expected = expectedProjection(inputs);
  const runId = String(expected.id);
  const commerceJobId = String(expected.job_id);
  const agentId = String(expected.agent_id);
  await query.query("BEGIN");
  try {
    const existingResult = await query.query<AgentRunRow>(`
      SELECT id, agent_id, job_id, template_id, template_version,
             input_snapshot, decision_summary, selected_action, before_state,
             after_state, transaction_hash, outcome, started_at, finished_at
        FROM agent_runs
       WHERE id = $1
       FOR UPDATE
    `, [runId]);
    const existing = existingResult.rows[0];
    if (existing !== undefined) {
      const actual = projectionValue(existing);
      if (projectionDigest(actual) !== projectionDigest(expected)) {
        fail("RUN_PROJECTION_CONFLICT", "deterministic agent run ID already belongs to different persisted facts");
      }
      await query.query("COMMIT");
      return { runId, commerceJobId, agentId, agentVersionId: inputs.agentVersionId, created: false };
    }
    await query.query(`
      INSERT INTO agent_runs (
        id, agent_id, job_id, template_id, template_version,
        input_snapshot, decision_summary, selected_action, before_state,
        after_state, transaction_hash, outcome, started_at, finished_at
      ) VALUES ($1, $2, $3, NULL, NULL, $4::jsonb, $5::jsonb, NULL, NULL, NULL, $6, $7, $8, $9)
      ON CONFLICT (id) DO NOTHING
    `, [
      runId,
      agentId,
      commerceJobId,
      JSON.stringify(expected.input_snapshot),
      JSON.stringify(expected.decision_summary),
      expected.transaction_hash,
      expected.outcome,
      expected.started_at,
      expected.finished_at
    ]);
    const afterInsert = await query.query<AgentRunRow>(`
      SELECT id, agent_id, job_id, template_id, template_version,
             input_snapshot, decision_summary, selected_action, before_state,
             after_state, transaction_hash, outcome, started_at, finished_at
        FROM agent_runs
       WHERE id = $1
       FOR UPDATE
    `, [runId]);
    const persisted = afterInsert.rows[0];
    if (persisted === undefined || projectionDigest(projectionValue(persisted)) !== projectionDigest(expected)) {
      fail("RUN_PROJECTION_CONFLICT", "agent run projection could not be verified after insert");
    }
    await query.query("COMMIT");
    return { runId, commerceJobId, agentId, agentVersionId: inputs.agentVersionId, created: true };
  } catch (cause) {
    try {
      await query.query("ROLLBACK");
    } catch {
      // Preserve the original projection failure; the pool will discard a
      // transaction with a failed statement.
    }
    throw cause;
  }
}
