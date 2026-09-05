import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Validation output for the checked-in release evidence directory.
 *
 * This validator is intentionally independent of runtime configuration. It
 * never loads `.env`, resolves a secret reference, calls a provider, or
 * rewrites evidence. It only checks the sanitized files already present in a
 * checkout.
 */
export type ReleaseEvidenceIssue = {
  readonly file: string;
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

export type ReleaseEvidenceReport = {
  readonly valid: boolean;
  readonly checkedAt: string;
  readonly jsonFiles: readonly string[];
  readonly pngFiles: readonly string[];
  readonly issues: readonly ReleaseEvidenceIssue[];
};

type JsonRecord = Record<string, unknown>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/iu;
const BLOCK_HASH_PATTERN = /^0x[0-9a-f]{64}$/iu;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

// These patterns intentionally target credential-shaped values rather than
// ordinary prose that mentions a secret, tokenURI, or authentication method.
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [^-]*PRIVATE KEY-----/iu,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:ASIA|AIDA)[0-9A-Z]{16}\b/u,
  /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/u,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/iu,
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u
];

const SENSITIVE_KEY_PATTERN = /(?:private.?key|mnemonic|seed.?phrase|password|passwd|secret|api.?key|authorization|cookie|session.?token|access.?token|refresh.?token)/iu;
const SECRET_REFERENCE_KEY_PATTERN = /(?:secret|credential|token).*(?:reference|name)|(?:reference|name).*(?:secret|credential|token)/iu;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  issues: ReleaseEvidenceIssue[],
  file: string,
  path: string,
  code: string,
  message: string
): void {
  issues.push({ file, path, code, message });
}

function visitValues(value: unknown, file: string, path: string, issues: ReleaseEvidenceIssue[]): void {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      issue(issues, file, path, "SECRET_VALUE", "Credential-shaped value is not publishable evidence.");
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitValues(entry, file, `${path}[${index}]`, issues));
    return;
  }

  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      if (typeof child === "string" && !SECRET_REFERENCE_KEY_PATTERN.test(key)) {
        issue(issues, file, childPath, "SENSITIVE_FIELD", "Sensitive field contains a string; store only a reference or boolean.");
      } else if (Array.isArray(child)) {
        issue(issues, file, childPath, "SENSITIVE_FIELD", "Sensitive field contains an array and is not publishable evidence.");
      }
    }
    visitValues(child, file, childPath, issues);
  }
}

function checkUrls(value: unknown, file: string, path: string, issues: ReleaseEvidenceIssue[]): void {
  if (typeof value === "string") {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (parsed.username !== "" || parsed.password !== "") {
      issue(issues, file, path, "URL_CREDENTIALS", "Evidence URL contains a username or password.");
    }
    for (const key of parsed.searchParams.keys()) {
      if (/(?:key|token|secret|password|passwd|signature|sig|auth|credential)/iu.test(key)) {
        issue(issues, file, path, "URL_SECRET_QUERY", "Evidence URL contains a credential-shaped query parameter.");
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkUrls(entry, file, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    checkUrls(child, file, childPath, issues);
  }
}

function parseJsonRecord(content: string, file: string, issues: ReleaseEvidenceIssue[]): JsonRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    issue(issues, file, "$", "JSON_INVALID", "Evidence file is not valid JSON.");
    return null;
  }
  if (!isRecord(parsed)) {
    issue(issues, file, "$", "JSON_ROOT_INVALID", "Evidence JSON must have an object root.");
    return null;
  }
  visitValues(parsed, file, "$", issues);
  checkUrls(parsed, file, "$", issues);
  return parsed;
}

function stringAt(value: unknown, path: string): string | null {
  const current = valueAt(value, path);
  return typeof current === "string" ? current : null;
}

function recordAt(value: unknown, path: string): JsonRecord | null {
  const current = valueAt(value, path);
  return isRecord(current) ? current : null;
}

function arrayAt(value: unknown, path: string): readonly unknown[] | null {
  const current = valueAt(value, path);
  return Array.isArray(current) ? current : null;
}

function valueAt(value: unknown, path: string): unknown {
  let current: unknown = value;
  const segments = path.match(/[^.[\]]+|\[(\d+)\]/gu) ?? [];
  for (const rawSegment of segments) {
    const segment = rawSegment.startsWith("[") ? Number(rawSegment.slice(1, -1)) : rawSegment;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

function requireString(
  value: unknown,
  file: string,
  path: string,
  issues: ReleaseEvidenceIssue[],
  pattern?: RegExp
): string | null {
  const result = stringAt(value, path);
  if (result === null || (pattern !== undefined && !pattern.test(result))) {
    issue(issues, file, `$.${path}`, "FIELD_INVALID", "Required string field is missing or malformed.");
    return null;
  }
  return result;
}

function requireBoolean(value: unknown, file: string, path: string, issues: ReleaseEvidenceIssue[]): boolean | null {
  const current = valueAt(value, path);
  if (typeof current !== "boolean") {
    issue(issues, file, `$.${path}`, "FIELD_INVALID", "Required boolean field is missing or malformed.");
    return null;
  }
  return current;
}

function requireArray(value: unknown, file: string, path: string, issues: ReleaseEvidenceIssue[]): readonly unknown[] {
  const result = arrayAt(value, path);
  if (result === null) {
    issue(issues, file, `$.${path}`, "FIELD_INVALID", "Required array field is missing.");
    return [];
  }
  return result;
}

function checkIsoTimestamp(value: unknown, file: string, path: string, issues: ReleaseEvidenceIssue[], allowDateOnly = false): Date | null {
  const text = stringAt(value, path);
  if (text === null || (!allowDateOnly && !/^\d{4}-\d{2}-\d{2}T/u.test(text))) {
    issue(issues, file, `$.${path}`, "TIMESTAMP_INVALID", "Timestamp must be an ISO-8601 timestamp.");
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.valueOf())) {
    issue(issues, file, `$.${path}`, "TIMESTAMP_INVALID", "Timestamp is not parseable.");
    return null;
  }
  return date;
}

function validateContractReview(value: JsonRecord, file: string, issues: ReleaseEvidenceIssue[]): void {
  if (stringAt(value, "evidenceType") !== "contract-only") {
    issue(issues, file, "$.evidenceType", "EVIDENCE_LEVEL_INVALID", "8004scan contract review must remain contract-only.");
  }
  if (stringAt(value, "status") !== "not-a-live-canary") {
    issue(issues, file, "$.status", "LIVE_CLAIM", "Contract review must not be labelled as a live canary.");
  }
  requireString(value, file, "openApiUrl", issues, /^https:\/\//u);
  requireString(value, file, "baseUrl", issues, /^https:\/\//u);
  const limitations = requireArray(value, file, "limitations", issues);
  if (!limitations.some((entry) => typeof entry === "string" && /disabled|unaccepted|prerequisite|not-a-live|not.*canary/iu.test(entry))) {
    issue(issues, file, "$.limitations", "LIMITATIONS_MISSING", "Contract-only evidence must state its release limitations.");
  }
  if (stringAt(value, "openApiCanonicalSha256") !== null) requireString(value, file, "openApiCanonicalSha256", issues, SHA256_PATTERN);
  if (stringAt(value, "openApiResponseSha256") !== null) requireString(value, file, "openApiResponseSha256", issues, SHA256_PATTERN);
}

type LockNetwork = {
  readonly name?: unknown;
  readonly environment?: unknown;
  readonly erc8004?: JsonRecord;
};

function lockNetwork(value: JsonRecord, networkId: string): LockNetwork | null {
  const networks = value.networks;
  if (!isRecord(networks) || !isRecord(networks[networkId])) return null;
  return networks[networkId] as LockNetwork;
}

function lowerString(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function validateRegistryVerification(
  value: JsonRecord,
  file: string,
  issues: ReleaseEvidenceIssue[],
  lock: JsonRecord | null,
  abiFiles: Readonly<Record<string, string>>
): void {
  if (stringAt(value, "evidenceType") !== "live-read-only") {
    issue(issues, file, "$.evidenceType", "EVIDENCE_LEVEL_INVALID", "Registry verification must be labelled live-read-only.");
  }
  checkIsoTimestamp(value, file, "checkedAt", issues);
  const networks = requireArray(value, file, "networks", issues);
  const observedNetworkIds = new Set<number>();
  for (const [index, rawNetwork] of networks.entries()) {
    const path = `$.networks[${index}]`;
    if (!isRecord(rawNetwork)) {
      issue(issues, file, path, "NETWORK_INVALID", "Network verification entry must be an object.");
      continue;
    }
    const networkId = rawNetwork.networkId;
    const observedChainId = rawNetwork.observedChainId;
    if (typeof networkId !== "number" || !Number.isSafeInteger(networkId) || (networkId !== 56 && networkId !== 97)) {
      issue(issues, file, `${path}.networkId`, "NETWORK_INVALID", "Only BSC chain IDs 56 and 97 are valid here.");
      continue;
    }
    observedNetworkIds.add(networkId);
    if (observedChainId !== networkId) {
      issue(issues, file, `${path}.observedChainId`, "CHAIN_MISMATCH", "Observed chain ID does not equal the claimed network.");
    }
    if (typeof rawNetwork.latestBlock !== "number" || !Number.isSafeInteger(rawNetwork.latestBlock) || rawNetwork.latestBlock < 0) {
      issue(issues, file, `${path}.latestBlock`, "BLOCK_INVALID", "Latest block must be a non-negative safe integer.");
    }
    if (typeof rawNetwork.latestBlockHash !== "string" || !BLOCK_HASH_PATTERN.test(rawNetwork.latestBlockHash)) {
      issue(issues, file, `${path}.latestBlockHash`, "BLOCK_HASH_INVALID", "Latest block hash is missing or malformed.");
    }
    const identityRead = recordAt(rawNetwork, "identityRead");
    if (identityRead === null || typeof identityRead.owner !== "string" || !ADDRESS_PATTERN.test(identityRead.owner) || typeof identityRead.agentWallet !== "string" || !ADDRESS_PATTERN.test(identityRead.agentWallet)) {
      issue(issues, file, `${path}.identityRead`, "IDENTITY_READ_INVALID", "Owner and agentWallet must be public EVM addresses.");
    }
    if (typeof identityRead?.tokenUriScheme !== "string" || !/^(?:https?|ipfs|data)$/u.test(identityRead.tokenUriScheme)) {
      issue(issues, file, `${path}.identityRead.tokenUriScheme`, "URI_SCHEME_INVALID", "Identity URI scheme is not an approved public scheme.");
    }
    if (typeof identityRead?.tokenUriSha256 !== "string" || !SHA256_PATTERN.test(identityRead.tokenUriSha256)) {
      issue(issues, file, `${path}.identityRead.tokenUriSha256`, "DIGEST_INVALID", "Identity URI digest is missing or malformed.");
    }
    const contracts = Array.isArray(rawNetwork.contracts) ? rawNetwork.contracts : [];
    if (contracts.length < 2) issue(issues, file, `${path}.contracts`, "CONTRACTS_INCOMPLETE", "Identity and reputation contract observations are required.");
    for (const [contractIndex, rawContract] of contracts.entries()) {
      const contractPath = `${path}.contracts[${contractIndex}]`;
      if (!isRecord(rawContract)) {
        issue(issues, file, contractPath, "CONTRACT_INVALID", "Contract observation must be an object.");
        continue;
      }
      for (const field of ["address", "implementation"] as const) {
        if (typeof rawContract[field] !== "string" || !ADDRESS_PATTERN.test(rawContract[field])) {
          issue(issues, file, `${contractPath}.${field}`, "ADDRESS_INVALID", "Contract address is missing or malformed.");
        }
      }
      for (const field of ["proxySha256", "implementationSha256"] as const) {
        if (typeof rawContract[field] !== "string" || !SHA256_PATTERN.test(rawContract[field])) {
          issue(issues, file, `${contractPath}.${field}`, "DIGEST_INVALID", "Bytecode digest is missing or malformed.");
        }
      }
    }
    const comparison = recordAt(rawNetwork, "providerComparison");
    if (comparison === null || comparison.sameChainAndBytecode !== true || !Array.isArray(comparison.providers) || comparison.providers.length < 2) {
      issue(issues, file, `${path}.providerComparison`, "PROVIDER_COMPARISON_INVALID", "Two-provider chain/bytecode agreement is required.");
    }
    if (lock !== null) {
      const locked = lockNetwork(lock, String(networkId));
      const lockedErc = locked?.erc8004;
      if (lockedErc === undefined) {
        issue(issues, file, path, "LOCK_NETWORK_MISSING", "Network is absent from the standards lock.");
      } else {
        const identityAddress = lowerString(lockedErc.identityRegistry);
        const reputationAddress = lowerString(lockedErc.reputationRegistry);
        const lockHashes = isRecord(lockedErc.abiHashes) ? lockedErc.abiHashes : null;
        const artifactAbi = recordAt(value, "abi.canonicalSha256");
        if (artifactAbi !== null && lowerString(artifactAbi.identityRegistry) !== lowerString(lockHashes?.identityRegistry)) {
          issue(issues, file, `${path}.abi`, "ABI_LOCK_MISMATCH", "Identity ABI digest differs from the standards lock.");
        }
        if (artifactAbi !== null && lowerString(artifactAbi.reputationRegistry) !== lowerString(lockHashes?.reputationRegistry)) {
          issue(issues, file, `${path}.abi`, "ABI_LOCK_MISMATCH", "Reputation ABI digest differs from the standards lock.");
        }
        for (const rawContract of contracts) {
          if (!isRecord(rawContract)) continue;
          const name = rawContract.name === "identityRegistry" ? "identityRegistry" : rawContract.name === "reputationRegistry" ? "reputationRegistry" : null;
          if (name === null) continue;
          const expectedAddress = name === "identityRegistry" ? identityAddress : reputationAddress;
          const expectedImplementation = isRecord(lockedErc.implementationAddresses) ? lowerString(lockedErc.implementationAddresses[name]) : null;
          const expectedProxyHash = lowerString(lockedErc.proxyRuntimeSha256);
          const expectedImplementationHash = isRecord(lockedErc.implementationRuntimeSha256) ? lowerString(lockedErc.implementationRuntimeSha256[name]) : null;
          if (lowerString(rawContract.address) !== expectedAddress || lowerString(rawContract.implementation) !== expectedImplementation || lowerString(rawContract.proxySha256) !== expectedProxyHash || lowerString(rawContract.implementationSha256) !== expectedImplementationHash) {
            issue(issues, file, `${path}.contracts`, "BYTECODE_LOCK_MISMATCH", `${name} observation differs from the standards lock.`);
          }
        }
      }
    }
  }
  for (const expected of [56, 97]) {
    if (!observedNetworkIds.has(expected)) issue(issues, file, "$.networks", "NETWORK_MISSING", `BSC chain ${expected} verification is missing.`);
  }
  const abi = recordAt(value, "abi");
  if (abi === null || !isRecord(abi.functionSelectors) || !isRecord(abi.eventTopics)) {
    issue(issues, file, "$.abi", "ABI_EVIDENCE_MISSING", "ABI selectors and event topics are required.");
  }
  for (const [name, path] of Object.entries(abiFiles)) {
    const bytes = path;
    if (!bytes) continue;
    // The caller supplies the canonical JSON bytes as a string in this map.
    const expectedDigest = name === "identityRegistry"
      ? lowerString(recordAt(value, "abi.canonicalSha256")?.identityRegistry)
      : lowerString(recordAt(value, "abi.canonicalSha256")?.reputationRegistry);
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (expectedDigest !== actualDigest) issue(issues, file, "$.abi.canonicalSha256", "ABI_ARTIFACT_MISMATCH", `${name} checked-in ABI does not match the evidence digest.`);
  }
}

function validateE2E(value: JsonRecord, file: string, issues: ReleaseEvidenceIssue[]): void {
  if (stringAt(value, "schemaVersion") !== "bnbera.erc8004-e2e/v1") issue(issues, file, "$.schemaVersion", "SCHEMA_VERSION_INVALID", "Unexpected ERC-8004 E2E evidence schema.");
  const started = checkIsoTimestamp(value, file, "startedAt", issues);
  const completed = checkIsoTimestamp(value, file, "completedAt", issues);
  if (started !== null && completed !== null && completed < started) issue(issues, file, "$.completedAt", "TIMESTAMP_ORDER", "E2E completion precedes start.");
  if (requireBoolean(value, file, "noSecretsWritten", issues) !== true) issue(issues, file, "$.noSecretsWritten", "SAFETY_FAILED", "E2E evidence must affirm that no secret was written.");
  for (const path of [
    "safety.readOnlyRpcMethodsOnly",
    "safety.noWalletsOrSignatures",
    "safety.noOnchainWrites",
    "safety.noPaymentsOrDeployments"
  ]) {
    if (requireBoolean(value, file, path, issues) !== true) issue(issues, file, `$.${path}`, "SAFETY_FAILED", "E2E safety boundary is not affirmed.");
  }
  const checks = requireArray(value, file, "checks", issues);
  const rowsRolledBack = requireBoolean(value, file, "safety.databaseRowsRolledBack", issues);
  const rollbackCheck = checks.find((entry) => isRecord(entry) && entry.name === "postgres_pgvector_transaction_idempotency_similarity_rollback");
  if (rowsRolledBack === false && (!isRecord(rollbackCheck) || (rollbackCheck.status !== "blocked" && rollbackCheck.status !== "skipped"))) {
    issue(issues, file, "$.safety.databaseRowsRolledBack", "SAFETY_INCONSISTENT", "A false rollback assertion requires the database check to be explicitly blocked or skipped.");
  }
  if (rowsRolledBack === true && isRecord(rollbackCheck) && rollbackCheck.status !== "pass") {
    issue(issues, file, "$.safety.databaseRowsRolledBack", "SAFETY_INCONSISTENT", "A true rollback assertion requires a passing database check.");
  }
  let previousCheckAt: Date | null = null;
  let allPass = checks.length > 0;
  for (const [index, rawCheck] of checks.entries()) {
    const path = `checks[${index}]`;
    if (!isRecord(rawCheck)) {
      issue(issues, file, `$.${path}`, "CHECK_INVALID", "Evidence check must be an object.");
      allPass = false;
      continue;
    }
    const status = rawCheck.status;
    const level = rawCheck.evidenceLevel;
    if (!["pass", "fail", "blocked", "skipped"].includes(String(status))) issue(issues, file, `$.${path}.status`, "CHECK_STATUS_INVALID", "Unknown evidence check status.");
    if (!["deterministic", "contract", "live-read-only", "blocked", "skipped"].includes(String(level))) issue(issues, file, `$.${path}.evidenceLevel`, "EVIDENCE_LEVEL_INVALID", "Unknown evidence level.");
    if (status === "skipped" && level !== "skipped") issue(issues, file, `$.${path}.evidenceLevel`, "EVIDENCE_LEVEL_MISMATCH", "Skipped checks must have skipped evidence level.");
    if (level === "skipped" && status !== "skipped") issue(issues, file, `$.${path}.status`, "EVIDENCE_LEVEL_MISMATCH", "Skipped evidence level must have skipped status.");
    if (status !== "pass") allPass = false;
    const checkedAt = checkIsoTimestamp(rawCheck, file, "checkedAt", issues);
    if (checkedAt !== null && previousCheckAt !== null && checkedAt < previousCheckAt) issue(issues, file, `$.${path}.checkedAt`, "TIMESTAMP_ORDER", "E2E checks must be chronological.");
    if (checkedAt !== null && started !== null && checkedAt < started) issue(issues, file, `$.${path}.checkedAt`, "TIMESTAMP_RANGE", "Check precedes E2E start.");
    if (checkedAt !== null && completed !== null && checkedAt > completed) issue(issues, file, `$.${path}.checkedAt`, "TIMESTAMP_RANGE", "Check follows E2E completion.");
    previousCheckAt = checkedAt ?? previousCheckAt;
  }
  if (value.pipelineComplete !== allPass) issue(issues, file, "$.pipelineComplete", "COMPLETION_MISMATCH", "pipelineComplete must equal the all-checks-pass result.");
  const configuration = recordAt(value, "configurationPresence");
  if (configuration !== null) {
    for (const [key, child] of Object.entries(configuration)) {
      if (key.toLowerCase().includes("key") && typeof child !== "boolean" && child !== null) issue(issues, file, `$.configurationPresence.${key}`, "CONFIG_SECRET_VALUE", "Configuration presence may contain only a boolean for credential fields.");
      if (typeof child !== "boolean" && typeof child !== "string" && child !== null) issue(issues, file, `$.configurationPresence.${key}`, "CONFIG_VALUE_INVALID", "Configuration presence must not contain raw configuration values.");
    }
  }
}

function validateBrowser(value: JsonRecord, file: string, issues: ReleaseEvidenceIssue[], names: ReadonlySet<string>): void {
  if (stringAt(value, "environment.marketplaceDataMode") !== "fixture") issue(issues, file, "$.environment.marketplaceDataMode", "LIVE_CLAIM", "Browser evidence must identify fixture data.");
  const label = stringAt(value, "environment.fixtureLabel") ?? "";
  if (!/not live|not discovered|fixture/iu.test(label)) issue(issues, file, "$.environment.fixtureLabel", "FIXTURE_LABEL_MISSING", "Fixture browser evidence needs an explicit non-live label.");
  if (stringAt(value, "environment.optionalIntegrations") !== "disabled") issue(issues, file, "$.environment.optionalIntegrations", "OPTIONAL_GATE_INVALID", "Optional integrations must be disabled in fixture evidence.");
  const checks = requireArray(value, file, "browserChecks", issues);
  for (const [index, rawCheck] of checks.entries()) {
    if (!isRecord(rawCheck)) continue;
    const refs = typeof rawCheck.evidence === "string" ? [rawCheck.evidence] : Array.isArray(rawCheck.evidence) ? rawCheck.evidence : [];
    for (const ref of refs) {
      if (typeof ref === "string" && !names.has(ref)) issue(issues, file, `$.browserChecks[${index}].evidence`, "EVIDENCE_REFERENCE_MISSING", `Referenced screenshot ${ref} is not present.`);
    }
  }
  const liveProbe = recordAt(value, "liveModeProbe");
  if (liveProbe !== null && (liveProbe.listStatus !== 503 || liveProbe.detailStatus !== 503 || liveProbe.configuration !== undefined && typeof liveProbe.configuration !== "string")) {
    issue(issues, file, "$.liveModeProbe", "FAIL_CLOSED_INVALID", "Live-mode fixture probe must remain a fail-closed 503 observation.");
  }
}

function validateSmokeText(content: string, file: string, issues: ReleaseEvidenceIssue[]): void {
  const requiredPhrases = [
    "expected = actual",
    "transaction rollback",
    "replay idempotency",
    "synthetic registry",
    "not a network health claim",
    "disabled"
  ];
  for (const phrase of requiredPhrases) {
    if (!content.toLowerCase().includes(phrase.toLowerCase())) issue(issues, file, "$", "LIMITATION_MISSING", `Smoke handoff is missing the required limitation/result phrase: ${phrase}.`);
  }
  if (/postgres(?:ql)?:\/\/[^\s`"']*:[^\s`"']*@/iu.test(content)) issue(issues, file, "$", "URL_CREDENTIALS", "Smoke handoff contains a credential-bearing database URL.");
}

async function readAbiCanonicalBytes(rootDir: string, relativePath: string, file: string, issues: ReleaseEvidenceIssue[]): Promise<string> {
  try {
    const raw = await readFile(join(rootDir, relativePath), "utf8");
    return JSON.stringify(JSON.parse(raw) as unknown);
  } catch {
    issue(issues, file, "$.abi", "ABI_SOURCE_UNAVAILABLE", `Checked-in ABI ${relativePath} could not be read or parsed.`);
    return "";
  }
}

/** Validate all checked-in release evidence without accessing runtime secrets. */
export async function validateReleaseEvidenceDirectory(rootDir: string): Promise<ReleaseEvidenceReport> {
  const evidenceDir = join(rootDir, "docs", "release-evidence");
  const issues: ReleaseEvidenceIssue[] = [];
  let entries: string[];
  try {
    entries = (await readdir(evidenceDir)).sort();
  } catch {
    issue(issues, "docs/release-evidence", "$", "DIRECTORY_UNAVAILABLE", "Release evidence directory could not be read.");
    return { valid: false, checkedAt: new Date().toISOString(), jsonFiles: [], pngFiles: [], issues };
  }
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
  const pngFiles = entries.filter((entry) => entry.endsWith(".png"));
  const names = new Set(entries);
  const parsed = new Map<string, JsonRecord>();
  for (const entry of jsonFiles) {
    const filePath = join(evidenceDir, entry);
    try {
      const content = await readFile(filePath, "utf8");
      const value = parseJsonRecord(content, `docs/release-evidence/${entry}`, issues);
      if (value !== null) parsed.set(entry, value);
    } catch {
      issue(issues, `docs/release-evidence/${entry}`, "$", "FILE_UNREADABLE", "Evidence file could not be read.");
    }
  }
  for (const entry of pngFiles) {
    const filePath = join(evidenceDir, entry);
    try {
      const info = await stat(filePath);
      if (info.size <= PNG_SIGNATURE.byteLength) issue(issues, `docs/release-evidence/${entry}`, "$", "PNG_EMPTY", "Screenshot is empty.");
      const bytes = new Uint8Array(await readFile(filePath));
      if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) issue(issues, `docs/release-evidence/${entry}`, "$", "PNG_INVALID", "Screenshot does not have a PNG signature.");
    } catch {
      issue(issues, `docs/release-evidence/${entry}`, "$", "FILE_UNREADABLE", "Screenshot could not be read.");
    }
  }
  const lockPath = join(rootDir, "config", "standards.lock.json");
  let lock: JsonRecord | null = null;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8")) as JsonRecord;
  } catch {
    issue(issues, "config/standards.lock.json", "$", "LOCK_UNAVAILABLE", "Standards lock could not be read or parsed.");
  }
  const abiFiles = {
    identityRegistry: await readAbiCanonicalBytes(rootDir, "packages/agent-ingestion/abi/erc8004/IdentityRegistry.json", "docs/release-evidence/erc8004-registry-verification.json", issues),
    reputationRegistry: await readAbiCanonicalBytes(rootDir, "packages/agent-ingestion/abi/erc8004/ReputationRegistry.json", "docs/release-evidence/erc8004-registry-verification.json", issues)
  } as const;
  for (const [entry, value] of parsed) {
    const file = `docs/release-evidence/${entry}`;
    if (entry === "8004scan-contract-review.json") validateContractReview(value, file, issues);
    else if (entry === "erc8004-registry-verification.json") validateRegistryVerification(value, file, issues, lock, abiFiles);
    else if (entry === "erc8004-e2e.json") validateE2E(value, file, issues);
    else if (entry === "task10-browser-verification-2026-09-04.json") validateBrowser(value, file, issues, names);
  }
  try {
    const smokeEntry = entries.find((entry) => /^ingestion-postgres-smoke-\d{4}-\d{2}-\d{2}\.md$/u.test(entry));
    if (smokeEntry !== undefined) validateSmokeText(await readFile(join(evidenceDir, smokeEntry), "utf8"), `docs/release-evidence/${smokeEntry}`, issues);
    else issue(issues, "docs/release-evidence", "$", "SMOKE_EVIDENCE_MISSING", "PostgreSQL ingestion smoke handoff is missing.");
  } catch {
    issue(issues, "docs/release-evidence", "$", "FILE_UNREADABLE", "PostgreSQL ingestion smoke handoff could not be read.");
  }
  return {
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    jsonFiles,
    pngFiles,
    issues
  };
}
