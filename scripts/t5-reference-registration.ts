/**
 * Owner-authorized ERC-8004 reference-agent registration/update harness.
 *
 * This command is a deliberately narrow operator tool. It uses only the
 * standards-locked chain-97 Identity Registry and the checked-in official
 * ABI. The default mode produces a sanitized plan and cannot resolve a key,
 * create a wallet client, estimate gas, or broadcast a transaction.
 *
 * A write requires all three independent acknowledgements:
 *   --write --broadcast and T5_REFERENCE_REGISTRATION_GO=true
 *
 * The command has no database dependency. If a broadcast outcome is unknown,
 * it reports the transaction hash (when one was returned) and stops. A later
 * --reconcile=<hash> read can recover the Registered event; it never retries
 * the registration. An explicit --agent-id is required to update an existing
 * registration, which prevents a second registration on a later deployment.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const CHAIN_ID = 97 as const;
const DEFAULT_DEADLINE_SECONDS = 240;
const MAX_DEADLINE_SECONDS = 300;
const MAX_GAS_LIMIT = 500_000n;
const MAX_GAS_PRICE_WEI = 20_000_000_000n;
const MAX_NATIVE_EXPOSURE_WEI = 5_000_000_000_000_000n;
const MAX_RECEIPT_WAIT_MS = 120_000;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/iu;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/iu;
const DECIMAL_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-f]{64}$/iu;
const URI_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const SECRET_REFERENCE_PATTERN = /^(?:secret:\/\/|vault:\/\/|env:\/\/|arn:aws:secretsmanager:)/u;
const OFFICIAL_IDENTITY_ABI_SHA256 = "6d5974b564d266507a53f65951adcd0ab288904d5a716a354ea237176ece8f83";

const AGENT_WALLET_TYPES = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" }
  ]
} as const;

type WriteFunction = "register" | "setAgentURI" | "setAgentWallet";

export type RegistrationMode = "plan" | "read-only" | "write" | "reconcile";

export type RegistrationFlags = {
  readonly mode: RegistrationMode;
  readonly chainId: 97;
  readonly broadcast: boolean;
  readonly agentId: string | null;
  readonly reconcileTxHash: Hex | null;
  readonly help: boolean;
};

export type RegistrationConfig = {
  readonly chainId: 97;
  readonly identityRegistry: Address;
  readonly identityAbiSha256: string;
  readonly rpcUrl: string | null;
  readonly agentUri: string | null;
  readonly existingAgentId: string | null;
  readonly ownerAddress: Address | null;
  readonly providerAddress: Address | null;
  readonly reconcileTxHash: Hex | null;
};

export type RegistrationPlan = {
  readonly status: "planned" | "blocked";
  readonly mode: "plan";
  readonly chainId: 97;
  readonly identityRegistry: Address;
  readonly broadcast: false;
  readonly writesBroadcast: false;
  readonly agentUri: string | null;
  readonly existingAgentId: string | null;
  readonly ownerAddress: Address | null;
  readonly providerAddress: Address | null;
  readonly rpcConfigured: boolean;
  readonly requiredActions: readonly ["register_agent_uri", "set_agent_wallet"];
  readonly guards: {
    readonly goEnvironment: boolean;
    readonly writeFlag: false;
    readonly broadcastFlag: false;
  };
  readonly diagnostics: readonly string[];
};

export type RegistrationLog = {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
};

export type RegistrationReceipt = {
  readonly status: "success" | "reverted";
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly logs: readonly RegistrationLog[];
};

export type RegistrationWriteInput = {
  readonly functionName: WriteFunction;
  readonly args: readonly unknown[];
  readonly sender: Address;
  readonly gas: bigint;
  readonly gasPrice: bigint;
};

/**
 * Narrow chain boundary. Tests can provide a deterministic mock without
 * weakening the production writer, which is the only implementation that
 * constructs a viem wallet client.
 */
export type RegistrationChain = {
  readonly getChainId: () => Promise<number>;
  readonly ownerOf: (agentId: bigint) => Promise<Address>;
  readonly tokenURI: (agentId: bigint) => Promise<string>;
  readonly getAgentWallet: (agentId: bigint) => Promise<Address>;
  readonly estimateGas: (input: Omit<RegistrationWriteInput, "gas" | "gasPrice">) => Promise<bigint>;
  readonly gasPrice: () => Promise<bigint>;
  readonly send: (input: RegistrationWriteInput) => Promise<Hex>;
  readonly waitForReceipt: (transactionHash: Hex) => Promise<RegistrationReceipt | null>;
  readonly getReceipt: (transactionHash: Hex) => Promise<RegistrationReceipt | null>;
};

export type RegistrationSigner = {
  readonly address: Address;
  readonly signTypedData: (input: {
    readonly identityRegistry: Address;
    readonly agentId: bigint;
    readonly newWallet: Address;
    readonly owner: Address;
    readonly deadline: bigint;
  }) => Promise<Hex>;
};

export type AgentWalletTypedData = {
  readonly domain: {
    readonly name: "ERC8004IdentityRegistry";
    readonly version: "1";
    readonly chainId: 97;
    readonly verifyingContract: Address;
  };
  readonly types: typeof AGENT_WALLET_TYPES;
  readonly primaryType: "AgentWalletSet";
  readonly message: {
    readonly agentId: bigint;
    readonly newWallet: Address;
    readonly owner: Address;
    readonly deadline: bigint;
  };
};

export type RegistrationActor = {
  readonly address: Address;
  readonly signer: RegistrationSigner;
};

export type RegistrationEvidence = {
  readonly status: "planned" | "read_only" | "already_configured" | "updated" | "registered" | "reconciled" | "blocked";
  readonly mode: RegistrationMode;
  readonly chainId: 97;
  readonly identityRegistry: Address;
  readonly broadcast: boolean;
  readonly owner: Address | null;
  readonly provider: Address | null;
  readonly agentId: string | null;
  readonly agentUri: string | null;
  readonly txHashes: readonly Hex[];
  readonly blocks: readonly number[];
  readonly diagnostics: readonly string[];
};

class RegistrationError extends Error {
  public constructor(public readonly code: string, public readonly transactionHash?: Hex) {
    super(code);
    this.name = "RegistrationError";
  }
}

function errorCode(error: unknown): string {
  if (error instanceof RegistrationError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  return "REGISTRATION_FAILED";
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

function normalizeAddress(value: string, code: string): Address {
  if (!ADDRESS_PATTERN.test(value)) throw new RegistrationError(code);
  return value.toLowerCase() as Address;
}

function normalizeHash(value: string, code: string): Hex {
  if (!HASH_PATTERN.test(value)) throw new RegistrationError(code);
  return value.toLowerCase() as Hex;
}

function normalizeAgentId(value: string | null, code = "AGENT_ID_INVALID"): string | null {
  if (value === null) return null;
  if (!DECIMAL_UINT_PATTERN.test(value)) throw new RegistrationError(code);
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > (1n << 256n) - 1n) throw new Error("range");
    return parsed.toString(10);
  } catch {
    throw new RegistrationError(code);
  }
}

function normalizeUri(value: string | null): string | null {
  if (value === null || value.length === 0 || URI_CONTROL_PATTERN.test(value)) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") return null;
  return parsed.toString();
}

function assertHex(value: unknown, code: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) throw new RegistrationError(code);
  return value.toLowerCase() as Hex;
}

function assertBlockNumber(value: unknown, code: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RegistrationError(code);
  return value;
}

function numberBlock(value: bigint): number {
  const checked = assertBlockNumber(value, "RECEIPT_BLOCK_INVALID");
  return Number(checked);
}

function canonicalAbiHash(parsed: unknown): string {
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

function readOfficialIdentityAbi(expectedHash: string): Abi {
  if (!/^[0-9a-f]{64}$/iu.test(expectedHash)) throw new RegistrationError("IDENTITY_ABI_LOCK_INVALID");
  const abiUrl = new URL("../packages/agent-ingestion/abi/erc8004/IdentityRegistry.json", import.meta.url);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(abiUrl, "utf8")) as unknown; } catch { throw new RegistrationError("IDENTITY_ABI_UNAVAILABLE"); }
  if (!Array.isArray(parsed)) throw new RegistrationError("IDENTITY_ABI_INVALID");
  const actualHash = canonicalAbiHash(parsed);
  if (actualHash !== expectedHash.toLowerCase() || actualHash !== OFFICIAL_IDENTITY_ABI_SHA256) throw new RegistrationError("IDENTITY_ABI_MISMATCH");
  const functions = new Set(parsed.filter((entry) => typeof entry === "object" && entry !== null && (entry as { readonly type?: unknown }).type === "function").map((entry) => (entry as { readonly name?: unknown }).name));
  for (const required of ["ownerOf", "tokenURI", "getAgentWallet", "register", "setAgentURI", "setAgentWallet"]) {
    if (!functions.has(required)) throw new RegistrationError("IDENTITY_ABI_FUNCTION_MISSING");
  }
  return parsed as Abi;
}

type StandardsLock = {
  readonly networks?: Record<string, {
    readonly erc8004?: {
      readonly identityRegistry?: unknown;
      readonly abiHashes?: { readonly identityRegistry?: unknown };
    };
  }>;
};

function readStandardsLock(): { readonly identityRegistry: Address; readonly abiSha256: string } {
  const lockUrl = new URL("../config/standards.lock.json", import.meta.url);
  let parsed: StandardsLock;
  try { parsed = JSON.parse(readFileSync(lockUrl, "utf8")) as StandardsLock; } catch { throw new RegistrationError("STANDARDS_LOCK_UNAVAILABLE"); }
  const network = parsed.networks?.[String(CHAIN_ID)]?.erc8004;
  if (network === undefined || typeof network.identityRegistry !== "string" || typeof network.abiHashes?.identityRegistry !== "string") throw new RegistrationError("CHAIN_97_IDENTITY_LOCK_MISSING");
  const identityRegistry = normalizeAddress(network.identityRegistry, "CHAIN_97_IDENTITY_REGISTRY_INVALID");
  const abiSha256 = network.abiHashes.identityRegistry.toLowerCase();
  if (abiSha256 !== OFFICIAL_IDENTITY_ABI_SHA256) throw new RegistrationError("CHAIN_97_IDENTITY_ABI_LOCK_MISMATCH");
  readOfficialIdentityAbi(abiSha256);
  return { identityRegistry, abiSha256 };
}

function privateKeyValue(value: string, code: string): Hex {
  const normalized = /^0x/iu.test(value) ? value : `0x${value}`;
  if (!PRIVATE_KEY_PATTERN.test(normalized)) throw new RegistrationError(code);
  return normalized.toLowerCase() as Hex;
}

/** Resolve a key only from the existing T4 actor env names or env:// references. */
function resolvePrivateKey(env: NodeJS.ProcessEnv, directName: "WALLET_PRIVATE_KEY" | "WALLET2_PRIVATE_KEY", referenceNames: readonly string[], code: string): Hex {
  const direct = optionalEnv(env, directName);
  if (direct !== null) return privateKeyValue(direct, code);
  for (const referenceName of referenceNames) {
    const reference = optionalEnv(env, referenceName);
    if (reference === null) continue;
    if (!SECRET_REFERENCE_PATTERN.test(reference)) throw new RegistrationError("SECRET_REFERENCE_INVALID");
    if (!reference.startsWith("env://")) throw new RegistrationError("SECRET_REFERENCE_UNRESOLVED");
    const envName = reference.slice("env://".length);
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(envName)) throw new RegistrationError("SECRET_REFERENCE_INVALID");
    const resolved = optionalEnv(env, envName);
    if (resolved === null) throw new RegistrationError("SECRET_REFERENCE_UNRESOLVED");
    return privateKeyValue(resolved, code);
  }
  throw new RegistrationError(`${code}_MISSING`);
}

function readProviderAddress(env: NodeJS.ProcessEnv): Address | null {
  const configured = optionalEnv(env, "T5_REFERENCE_PROVIDER_ADDRESS") ?? optionalEnv(env, "WALLET2_ADDRESS");
  return configured === null ? null : normalizeAddress(configured, "PROVIDER_ADDRESS_INVALID");
}

function readOwnerAddress(env: NodeJS.ProcessEnv): Address | null {
  const configured = optionalEnv(env, "WALLET_ADDRESS");
  return configured === null ? null : normalizeAddress(configured, "OWNER_ADDRESS_INVALID");
}

function readRpcUrl(env: NodeJS.ProcessEnv): string | null {
  const value = optionalEnv(env, "BSC_TESTNET_RPC_URL");
  if (value === null) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new RegistrationError("RPC_URL_INVALID"); }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") throw new RegistrationError("RPC_URL_INVALID");
  return parsed.toString();
}

export function parseRegistrationArgs(args: readonly string[]): RegistrationFlags {
  let mode: RegistrationMode = "plan";
  let explicitMode: RegistrationMode | null = null;
  let broadcast = false;
  let agentId: string | null = null;
  let reconcileTxHash: Hex | null = null;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined || arg === "--") continue;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--plan" || arg === "--read-only" || arg === "--write") {
      const selected = arg === "--plan" ? "plan" : arg === "--read-only" ? "read-only" : "write";
      if (explicitMode !== null && explicitMode !== selected) throw new RegistrationError("REGISTRATION_MODE_CONFLICT");
      explicitMode = selected;
      mode = selected;
      continue;
    }
    if (arg === "--broadcast") { broadcast = true; continue; }
    if (arg === "--network=97") continue;
    if (arg.startsWith("--network=")) throw new RegistrationError("EXPLICIT_CHAIN_97_REQUIRED");
    if (arg.startsWith("--agent-id=")) { agentId = normalizeAgentId(arg.slice("--agent-id=".length)); continue; }
    if (arg === "--agent-id") {
      const value = args[index + 1];
      if (value === undefined) throw new RegistrationError("AGENT_ID_REQUIRED");
      agentId = normalizeAgentId(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--reconcile=")) {
      if (explicitMode !== null && explicitMode !== "reconcile") throw new RegistrationError("REGISTRATION_MODE_CONFLICT");
      explicitMode = "reconcile";
      reconcileTxHash = normalizeHash(arg.slice("--reconcile=".length), "RECONCILE_TX_HASH_INVALID");
      mode = "reconcile";
      continue;
    }
    if (arg === "--reconcile") {
      const value = args[index + 1];
      if (value === undefined) throw new RegistrationError("RECONCILE_TX_HASH_REQUIRED");
      if (explicitMode !== null && explicitMode !== "reconcile") throw new RegistrationError("REGISTRATION_MODE_CONFLICT");
      explicitMode = "reconcile";
      reconcileTxHash = normalizeHash(value, "RECONCILE_TX_HASH_INVALID");
      mode = "reconcile";
      index += 1;
      continue;
    }
    throw new RegistrationError("UNKNOWN_REGISTRATION_FLAG");
  }
  if (broadcast && mode !== "write") throw new RegistrationError("BROADCAST_REQUIRES_WRITE");
  if (mode === "write" && !broadcast) throw new RegistrationError("EXPLICIT_BROADCAST_REQUIRED");
  return { mode, chainId: CHAIN_ID, broadcast, agentId, reconcileTxHash, help };
}

export function registrationConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env, flags: Pick<RegistrationFlags, "agentId" | "reconcileTxHash"> = { agentId: null, reconcileTxHash: null }): RegistrationConfig {
  const locked = readStandardsLock();
  const agentId = normalizeAgentId(flags.agentId ?? optionalEnv(env, "T5_REFERENCE_PROVIDER_AGENT_ID"));
  const reconcileValue = flags.reconcileTxHash ?? optionalEnv(env, "T5_REFERENCE_REGISTRATION_TX_HASH");
  const reconcileTxHash = reconcileValue === null ? null : normalizeHash(reconcileValue, "RECONCILE_TX_HASH_INVALID");
  const baseUrl = optionalEnv(env, "T5_REFERENCE_PROVIDER_PUBLIC_BASE_URL") ?? optionalEnv(env, "APP_URL");
  const cardUrl = optionalEnv(env, "T5_REFERENCE_PROVIDER_CARD_URL") ?? (baseUrl === null ? null : `${baseUrl.replace(/\/$/u, "")}/api/reference-provider/agent-card`);
  const agentUri = cardUrl === null ? null : normalizeUri(cardUrl);
  if (cardUrl !== null && agentUri === null) throw new RegistrationError("AGENT_URI_INVALID");
  return {
    chainId: CHAIN_ID,
    identityRegistry: locked.identityRegistry,
    identityAbiSha256: locked.abiSha256,
    rpcUrl: readRpcUrl(env),
    agentUri,
    existingAgentId: agentId,
    ownerAddress: readOwnerAddress(env),
    providerAddress: readProviderAddress(env),
    reconcileTxHash
  };
}

export function planRegistration(config: RegistrationConfig, env: NodeJS.ProcessEnv = process.env): RegistrationPlan {
  const diagnostics: string[] = [];
  if (config.agentUri === null) diagnostics.push("AGENT_URI_REQUIRED");
  if (config.existingAgentId === null && config.reconcileTxHash === null) diagnostics.push("NEW_REGISTRATION_AGENT_ID_WILL_BE_READ_FROM_REGISTERED_EVENT");
  if (config.existingAgentId !== null) diagnostics.push("EXPLICIT_AGENT_ID_REQUIRES_ON_CHAIN_OWNER_VERIFICATION_BEFORE_ANY_UPDATE");
  if (config.rpcUrl === null) diagnostics.push("BSC_TESTNET_RPC_URL_REQUIRED_FOR_READS_OR_WRITES");
  diagnostics.push("NO_DATABASE_OR_COMMERCE_WRITE_IS_USED");
  return {
    status: config.agentUri === null ? "blocked" : "planned",
    mode: "plan",
    chainId: CHAIN_ID,
    identityRegistry: config.identityRegistry,
    broadcast: false,
    writesBroadcast: false,
    agentUri: config.agentUri,
    existingAgentId: config.existingAgentId,
    ownerAddress: config.ownerAddress,
    providerAddress: config.providerAddress,
    rpcConfigured: config.rpcUrl !== null,
    requiredActions: ["register_agent_uri", "set_agent_wallet"],
    guards: {
      goEnvironment: env.T5_REFERENCE_REGISTRATION_GO === "true",
      writeFlag: false,
      broadcastFlag: false
    },
    diagnostics
  };
}

/** Build the exact provider EIP-712 payload required by IdentityRegistry. */
export function agentWalletTypedData(
  identityRegistry: Address,
  input: { readonly agentId: bigint; readonly newWallet: Address; readonly owner: Address; readonly deadline: bigint }
): AgentWalletTypedData {
  return {
    domain: {
      name: "ERC8004IdentityRegistry",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: identityRegistry
    },
    types: AGENT_WALLET_TYPES,
    primaryType: "AgentWalletSet",
    message: input
  };
}

function makeSigner(account: Account, identityRegistry: Address): RegistrationSigner {
  if (account.signTypedData === undefined) throw new RegistrationError("PROVIDER_TYPED_DATA_UNSUPPORTED");
  const signTypedData = account.signTypedData.bind(account);
  return {
    address: account.address.toLowerCase() as Address,
    signTypedData: async (input) => {
      if (input.identityRegistry !== identityRegistry) throw new RegistrationError("WALLET_SIGNATURE_REGISTRY_MISMATCH");
      return signTypedData(agentWalletTypedData(identityRegistry, input));
    }
  };
}

function resolveActors(env: NodeJS.ProcessEnv, identityRegistry: Address): { readonly owner: RegistrationActor; readonly provider: RegistrationActor } {
  const ownerAddress = readOwnerAddress(env);
  const providerAddress = readProviderAddress(env);
  if (ownerAddress === null) throw new RegistrationError("OWNER_ADDRESS_REQUIRED");
  if (providerAddress === null) throw new RegistrationError("PROVIDER_ADDRESS_REQUIRED");
  const ownerKey = resolvePrivateKey(env, "WALLET_PRIVATE_KEY", ["T5_REFERENCE_OWNER_SECRET_REFERENCE"], "OWNER_PRIVATE_KEY_INVALID");
  const providerKey = resolvePrivateKey(env, "WALLET2_PRIVATE_KEY", ["T5_REFERENCE_PROVIDER_SECRET_REFERENCE"], "PROVIDER_PRIVATE_KEY_INVALID");
  let ownerAccount: ReturnType<typeof privateKeyToAccount>;
  let providerAccount: ReturnType<typeof privateKeyToAccount>;
  try { ownerAccount = privateKeyToAccount(ownerKey); } catch { throw new RegistrationError("OWNER_PRIVATE_KEY_INVALID"); }
  try { providerAccount = privateKeyToAccount(providerKey); } catch { throw new RegistrationError("PROVIDER_PRIVATE_KEY_INVALID"); }
  const derivedOwner = ownerAccount.address.toLowerCase() as Address;
  const derivedProvider = providerAccount.address.toLowerCase() as Address;
  if (derivedOwner !== ownerAddress) throw new RegistrationError("OWNER_EOA_ADDRESS_MISMATCH");
  if (derivedProvider !== providerAddress) throw new RegistrationError("PROVIDER_EOA_ADDRESS_MISMATCH");
  if (derivedOwner === derivedProvider) throw new RegistrationError("OWNER_PROVIDER_MUST_BE_DISTINCT");
  return {
    owner: { address: derivedOwner, signer: makeSigner(ownerAccount, identityRegistry) },
    provider: { address: derivedProvider, signer: makeSigner(providerAccount, identityRegistry) }
  };
}

function asReceipt(value: unknown): RegistrationReceipt {
  if (typeof value !== "object" || value === null) throw new RegistrationError("RECEIPT_INVALID");
  const candidate = value as Partial<RegistrationReceipt>;
  if (candidate.status !== "success" && candidate.status !== "reverted") throw new RegistrationError("RECEIPT_STATUS_INVALID");
  const transactionHash = normalizeHash(String(candidate.transactionHash ?? ""), "RECEIPT_TX_HASH_INVALID");
  const blockNumber = assertBlockNumber(candidate.blockNumber, "RECEIPT_BLOCK_INVALID");
  const blockHash = assertHex(candidate.blockHash, "RECEIPT_BLOCK_HASH_INVALID");
  if (!HASH_PATTERN.test(blockHash)) throw new RegistrationError("RECEIPT_BLOCK_HASH_INVALID");
  if (!Array.isArray(candidate.logs)) throw new RegistrationError("RECEIPT_LOGS_INVALID");
  const logs = candidate.logs.map((raw) => {
    if (typeof raw !== "object" || raw === null) throw new RegistrationError("RECEIPT_LOG_INVALID");
    const log = raw as Partial<RegistrationLog>;
    return {
      address: normalizeAddress(String(log.address ?? ""), "RECEIPT_LOG_ADDRESS_INVALID"),
      topics: Array.isArray(log.topics) ? log.topics.map((topic) => assertHex(topic, "RECEIPT_LOG_TOPIC_INVALID")) : (() => { throw new RegistrationError("RECEIPT_LOG_TOPICS_INVALID"); })(),
      data: assertHex(log.data, "RECEIPT_LOG_DATA_INVALID")
    };
  });
  return { status: candidate.status, transactionHash, blockNumber, blockHash, logs };
}

export function parseRegisteredReceipt(input: {
  readonly receipt: RegistrationReceipt;
  readonly identityRegistry: Address;
  readonly expectedOwner: Address;
  readonly expectedUri: string;
  readonly abi?: Abi;
}): { readonly agentId: string; readonly transactionHash: Hex; readonly blockNumber: number; readonly blockHash: Hex } {
  if (input.receipt.status !== "success") throw new RegistrationError("REGISTER_TX_REVERTED");
  const abi = input.abi ?? readOfficialIdentityAbi(OFFICIAL_IDENTITY_ABI_SHA256);
  const topic = encodeEventTopics({ abi, eventName: "Registered" } as never)[0];
  if (typeof topic !== "string") throw new RegistrationError("REGISTERED_EVENT_TOPIC_INVALID");
  const matches: { readonly agentId: string }[] = [];
  for (const log of input.receipt.logs) {
    if (log.address !== input.identityRegistry || log.topics[0]?.toLowerCase() !== topic.toLowerCase()) continue;
    let decoded: unknown;
    try { decoded = decodeEventLog({ abi, eventName: "Registered", topics: log.topics, data: log.data, strict: true } as never); } catch { throw new RegistrationError("REGISTERED_EVENT_DECODE_FAILED"); }
    if (typeof decoded !== "object" || decoded === null) throw new RegistrationError("REGISTERED_EVENT_ARGS_INVALID");
    const args = (decoded as { readonly args?: unknown }).args;
    if (typeof args !== "object" || args === null || Array.isArray(args)) throw new RegistrationError("REGISTERED_EVENT_ARGS_INVALID");
    const record = args as Record<string, unknown>;
    const rawId = record.agentId;
    const rawUri = record.agentURI;
    const rawOwner = record.owner;
    const agentId = typeof rawId === "bigint" ? rawId.toString(10) : normalizeAgentId(typeof rawId === "string" ? rawId : null, "REGISTERED_AGENT_ID_INVALID");
    if (agentId === null || typeof rawUri !== "string" || rawUri !== input.expectedUri || typeof rawOwner !== "string" || normalizeAddress(rawOwner, "REGISTERED_OWNER_INVALID") !== input.expectedOwner) throw new RegistrationError("REGISTERED_EVENT_MISMATCH");
    matches.push({ agentId });
  }
  if (matches.length !== 1) throw new RegistrationError(matches.length === 0 ? "REGISTERED_EVENT_MISSING" : "REGISTERED_EVENT_AMBIGUOUS");
  return { agentId: matches[0].agentId, transactionHash: input.receipt.transactionHash, blockNumber: numberBlock(input.receipt.blockNumber), blockHash: input.receipt.blockHash };
}

async function confirmedReceipt(chain: RegistrationChain, transactionHash: Hex, operation: string): Promise<RegistrationReceipt> {
  let receipt: RegistrationReceipt | null = null;
  try { receipt = await chain.waitForReceipt(transactionHash); } catch {
    receipt = null;
  }
  if (receipt === null) {
    try { receipt = await chain.getReceipt(transactionHash); } catch { receipt = null; }
  }
  if (receipt === null) throw new RegistrationError(`${operation}_TX_OUTCOME_UNKNOWN`, transactionHash);
  const checked = asReceipt(receipt);
  if (checked.transactionHash !== transactionHash) throw new RegistrationError(`${operation}_RECEIPT_HASH_MISMATCH`, transactionHash);
  if (checked.status !== "success") throw new RegistrationError(`${operation}_TX_REVERTED`, transactionHash);
  return checked;
}

async function boundedSend(chain: RegistrationChain, input: Omit<RegistrationWriteInput, "gas" | "gasPrice">, operation: string): Promise<{ readonly transactionHash: Hex; readonly receipt: RegistrationReceipt }> {
  if (await chain.getChainId() !== CHAIN_ID) throw new RegistrationError("CHAIN_ID_MISMATCH");
  const estimated = await chain.estimateGas(input);
  if (estimated <= 0n || estimated > MAX_GAS_LIMIT) throw new RegistrationError(`${operation}_GAS_ESTIMATE_EXCEEDS_CAP`);
  const gas = estimated + estimated / 5n + 1n;
  if (gas > MAX_GAS_LIMIT) throw new RegistrationError(`${operation}_GAS_LIMIT_EXCEEDS_CAP`);
  const gasPrice = await chain.gasPrice();
  if (gasPrice <= 0n || gasPrice > MAX_GAS_PRICE_WEI || gas * gasPrice > MAX_NATIVE_EXPOSURE_WEI) throw new RegistrationError(`${operation}_NATIVE_EXPOSURE_EXCEEDS_CAP`);
  let transactionHash: Hex;
  if (await chain.getChainId() !== CHAIN_ID) throw new RegistrationError("CHAIN_ID_MISMATCH");
  try { transactionHash = normalizeHash(await chain.send({ ...input, gas, gasPrice }), `${operation}_TX_HASH_INVALID`); } catch { throw new RegistrationError(`${operation}_BROADCAST_UNKNOWN`); }
  const receipt = await confirmedReceipt(chain, transactionHash, operation);
  return { transactionHash, receipt };
}

async function prepareWalletSignature(provider: RegistrationActor, identityRegistry: Address, agentId: string, owner: Address): Promise<{ readonly deadline: bigint; readonly signature: Hex }> {
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const deadline = now + BigInt(DEFAULT_DEADLINE_SECONDS);
  if (deadline <= now || deadline > now + BigInt(MAX_DEADLINE_SECONDS)) throw new RegistrationError("WALLET_SIGNATURE_DEADLINE_INVALID");
  const signature = await provider.signer.signTypedData({ identityRegistry, agentId: BigInt(agentId), newWallet: provider.address, owner, deadline });
  if (!/^0x[0-9a-f]+$/iu.test(signature) || signature.length % 2 !== 0) throw new RegistrationError("WALLET_SIGNATURE_INVALID");
  // Keep the registry argument in this function's contract even though the
  // signer implementation already closes over it. This prevents a future
  // caller from silently signing for another registry.
  void identityRegistry;
  return { deadline, signature };
}

async function updateExisting(input: {
  readonly chain: RegistrationChain;
  readonly config: RegistrationConfig;
  readonly owner: RegistrationActor;
  readonly provider: RegistrationActor;
  readonly abi?: Abi;
}): Promise<RegistrationEvidence> {
  if (input.config.existingAgentId === null) throw new RegistrationError("AGENT_ID_REQUIRED_FOR_UPDATE");
  if (input.config.agentUri === null) throw new RegistrationError("AGENT_URI_REQUIRED");
  const agentId = BigInt(input.config.existingAgentId);
  const currentOwner = (await input.chain.ownerOf(agentId)).toLowerCase() as Address;
  if (currentOwner !== input.owner.address) throw new RegistrationError("EXISTING_AGENT_OWNER_MISMATCH");
  const txHashes: Hex[] = [];
  const blocks: number[] = [];
  const currentUri = await input.chain.tokenURI(agentId);
  let uriChanged = false;
  if (currentUri !== input.config.agentUri) {
    const sent = await boundedSend(input.chain, { functionName: "setAgentURI", args: [agentId, input.config.agentUri], sender: input.owner.address }, "URI_UPDATE");
    txHashes.push(sent.transactionHash); blocks.push(numberBlock(sent.receipt.blockNumber)); uriChanged = true;
    if (await input.chain.tokenURI(agentId) !== input.config.agentUri) throw new RegistrationError("URI_UPDATE_VERIFICATION_FAILED");
  }
  const currentWallet = (await input.chain.getAgentWallet(agentId)).toLowerCase() as Address;
  let walletChanged = false;
  if (currentWallet !== input.provider.address) {
    const signed = await prepareWalletSignature(input.provider, input.config.identityRegistry, input.config.existingAgentId, input.owner.address);
    const sent = await boundedSend(input.chain, { functionName: "setAgentWallet", args: [agentId, input.provider.address, signed.deadline, signed.signature], sender: input.owner.address }, "WALLET_UPDATE");
    txHashes.push(sent.transactionHash); blocks.push(numberBlock(sent.receipt.blockNumber)); walletChanged = true;
    if ((await input.chain.getAgentWallet(agentId)).toLowerCase() !== input.provider.address) throw new RegistrationError("WALLET_UPDATE_VERIFICATION_FAILED");
  }
  return {
    status: uriChanged || walletChanged ? "updated" : "already_configured",
    mode: "write",
    chainId: CHAIN_ID,
    identityRegistry: input.config.identityRegistry,
    broadcast: txHashes.length > 0,
    owner: input.owner.address,
    provider: input.provider.address,
    agentId: input.config.existingAgentId,
    agentUri: input.config.agentUri,
    txHashes,
    blocks,
    diagnostics: txHashes.length === 0 ? ["ON_CHAIN_URI_AND_AGENT_WALLET_ALREADY_MATCH"] : []
  };
}

async function registerNew(input: {
  readonly chain: RegistrationChain;
  readonly config: RegistrationConfig;
  readonly owner: RegistrationActor;
  readonly provider: RegistrationActor;
}): Promise<RegistrationEvidence> {
  if (input.config.agentUri === null) throw new RegistrationError("AGENT_URI_REQUIRED");
  if (input.config.existingAgentId !== null) throw new RegistrationError("REGISTER_NEW_REQUIRES_NO_AGENT_ID");
  const registered = await boundedSend(input.chain, { functionName: "register", args: [input.config.agentUri], sender: input.owner.address }, "REGISTER");
  const parsed = parseRegisteredReceipt({ receipt: registered.receipt, identityRegistry: input.config.identityRegistry, expectedOwner: input.owner.address, expectedUri: input.config.agentUri });
  const agentId = BigInt(parsed.agentId);
  if ((await input.chain.ownerOf(agentId)).toLowerCase() !== input.owner.address) throw new RegistrationError("REGISTER_OWNER_VERIFICATION_FAILED");
  const signed = await prepareWalletSignature(input.provider, input.config.identityRegistry, parsed.agentId, input.owner.address);
  const wallet = await boundedSend(input.chain, { functionName: "setAgentWallet", args: [agentId, input.provider.address, signed.deadline, signed.signature], sender: input.owner.address }, "WALLET_UPDATE");
  if ((await input.chain.getAgentWallet(agentId)).toLowerCase() !== input.provider.address) throw new RegistrationError("WALLET_UPDATE_VERIFICATION_FAILED");
  return {
    status: "registered",
    mode: "write",
    chainId: CHAIN_ID,
    identityRegistry: input.config.identityRegistry,
    broadcast: true,
    owner: input.owner.address,
    provider: input.provider.address,
    agentId: parsed.agentId,
    agentUri: input.config.agentUri,
    txHashes: [registered.transactionHash, wallet.transactionHash],
    blocks: [parsed.blockNumber, numberBlock(wallet.receipt.blockNumber)],
    diagnostics: []
  };
}

export async function reconcileRegistration(input: {
  readonly chain: RegistrationChain;
  readonly config: RegistrationConfig;
  readonly transactionHash: Hex;
}): Promise<RegistrationEvidence> {
  if (input.config.agentUri === null) throw new RegistrationError("AGENT_URI_REQUIRED");
  if (input.config.ownerAddress === null) throw new RegistrationError("OWNER_ADDRESS_REQUIRED");
  const receipt = await confirmedReceipt(input.chain, input.transactionHash, "REGISTER");
  const parsed = parseRegisteredReceipt({ receipt, identityRegistry: input.config.identityRegistry, expectedOwner: input.config.ownerAddress, expectedUri: input.config.agentUri });
  return {
    status: "reconciled",
    mode: "reconcile",
    chainId: CHAIN_ID,
    identityRegistry: input.config.identityRegistry,
    broadcast: false,
    owner: input.config.ownerAddress,
    provider: input.config.providerAddress,
    agentId: parsed.agentId,
    agentUri: input.config.agentUri,
    txHashes: [parsed.transactionHash],
    blocks: [parsed.blockNumber],
    diagnostics: ["REGISTRATION_RECONCILED_NO_REBROADCAST", "RERUN_WITH_EXPLICIT_AGENT_ID_TO_ASSIGN_OR_UPDATE_AGENT_WALLET"]
  };
}

export async function runRegistrationWrite(input: {
  readonly chain: RegistrationChain;
  readonly config: RegistrationConfig;
  readonly actors: { readonly owner: RegistrationActor; readonly provider: RegistrationActor };
}): Promise<RegistrationEvidence> {
  if (await input.chain.getChainId() !== CHAIN_ID) throw new RegistrationError("CHAIN_NETWORK_MISMATCH");
  if (input.config.identityRegistry !== readStandardsLock().identityRegistry) throw new RegistrationError("IDENTITY_REGISTRY_NOT_LOCKED");
  if (input.config.ownerAddress !== null && input.config.ownerAddress !== input.actors.owner.address) throw new RegistrationError("OWNER_EOA_ADDRESS_MISMATCH");
  if (input.config.providerAddress !== null && input.config.providerAddress !== input.actors.provider.address) throw new RegistrationError("PROVIDER_EOA_ADDRESS_MISMATCH");
  if (input.actors.owner.address === input.actors.provider.address) throw new RegistrationError("OWNER_PROVIDER_MUST_BE_DISTINCT");
  if (input.config.existingAgentId !== null) return updateExisting({ ...input, owner: input.actors.owner, provider: input.actors.provider });
  return registerNew({ ...input, owner: input.actors.owner, provider: input.actors.provider });
}

function viemChainAdapter(input: { readonly rpcUrl: string; readonly identityRegistry: Address; readonly abi: Abi; readonly ownerAccount?: Account }): RegistrationChain {
  const transport = http(input.rpcUrl, { timeout: MAX_RECEIPT_WAIT_MS });
  const chain = bscTestnet as Chain;
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = input.ownerAccount === undefined ? null : createWalletClient({ account: input.ownerAccount, chain, transport });
  const read = async <T>(functionName: string, args: readonly unknown[]): Promise<T> => publicClient.readContract({ address: input.identityRegistry, abi: input.abi, functionName, args } as never) as Promise<T>;
  return {
    getChainId: () => publicClient.getChainId(),
    ownerOf: (agentId) => read<Address>("ownerOf", [agentId]),
    tokenURI: (agentId) => read<string>("tokenURI", [agentId]),
    getAgentWallet: (agentId) => read<Address>("getAgentWallet", [agentId]),
    estimateGas: async (request) => {
      if (walletClient === null) throw new RegistrationError("OWNER_WALLET_REQUIRED");
      return publicClient.estimateContractGas({ address: input.identityRegistry, abi: input.abi, functionName: request.functionName, args: request.args, account: request.sender } as never);
    },
    gasPrice: () => publicClient.getGasPrice(),
    send: async (request) => {
      if (walletClient === null) throw new RegistrationError("OWNER_WALLET_REQUIRED");
      return walletClient.writeContract({ address: input.identityRegistry, abi: input.abi, functionName: request.functionName, args: request.args, account: input.ownerAccount, chain, gas: request.gas, gasPrice: request.gasPrice } as never);
    },
    waitForReceipt: async (transactionHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, timeout: MAX_RECEIPT_WAIT_MS });
      return {
        status: receipt.status === "success" ? "success" : "reverted",
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data }))
      };
    },
    getReceipt: async (transactionHash) => {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
        return {
          status: receipt.status === "success" ? "success" : "reverted",
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data }))
        };
      } catch {
        return null;
      }
    }
  };
}

async function readOnlyEvidence(chain: RegistrationChain, config: RegistrationConfig): Promise<RegistrationEvidence> {
  const observedChainId = await chain.getChainId();
  if (observedChainId !== CHAIN_ID) throw new RegistrationError("CHAIN_NETWORK_MISMATCH");
  if (config.existingAgentId === null) return {
    status: "read_only", mode: "read-only", chainId: CHAIN_ID, identityRegistry: config.identityRegistry,
    broadcast: false, owner: config.ownerAddress, provider: config.providerAddress, agentId: null,
    agentUri: config.agentUri, txHashes: [], blocks: [], diagnostics: ["NO_AGENT_ID_SUPPLIED_READ_ONLY_PLAN_ONLY"]
  };
  const agentId = BigInt(config.existingAgentId);
  const owner = (await chain.ownerOf(agentId)).toLowerCase() as Address;
  const wallet = (await chain.getAgentWallet(agentId)).toLowerCase() as Address;
  const uri = await chain.tokenURI(agentId);
  return {
    status: "read_only", mode: "read-only", chainId: CHAIN_ID, identityRegistry: config.identityRegistry,
    broadcast: false, owner, provider: config.providerAddress, agentId: config.existingAgentId,
    agentUri: uri, txHashes: [], blocks: [], diagnostics: [`ON_CHAIN_AGENT_WALLET_${wallet}`, `ON_CHAIN_OWNER_${owner}`]
  };
}

function actorFromEnvironment(env: NodeJS.ProcessEnv, identityRegistry: Address): { readonly owner: RegistrationActor; readonly provider: RegistrationActor } {
  return resolveActors(env, identityRegistry);
}

function usage(): string {
  return [
    "T5 ERC-8004 reference registration (plan/read-only by default)",
    "  pnpm ops:t5-reference-registration -- --network=97 --plan",
    "  pnpm ops:t5-reference-registration -- --network=97 --read-only",
    "  pnpm ops:t5-reference-registration -- --network=97 --write --broadcast",
    "  pnpm ops:t5-reference-registration -- --network=97 --reconcile=<register-tx-hash>",
    "",
    "Writes additionally require T5_REFERENCE_REGISTRATION_GO=true.",
    "Owner: WALLET_PRIVATE_KEY/WALLET_ADDRESS.",
    "Provider: WALLET2_PRIVATE_KEY and T5_REFERENCE_PROVIDER_ADDRESS or WALLET2_ADDRESS.",
    "Approved env:// references: T5_REFERENCE_OWNER_SECRET_REFERENCE and T5_REFERENCE_PROVIDER_SECRET_REFERENCE.",
    "Card URI: T5_REFERENCE_PROVIDER_CARD_URL, or T5_REFERENCE_PROVIDER_PUBLIC_BASE_URL/APP_URL plus /api/reference-provider/agent-card.",
    "Existing updates require T5_REFERENCE_PROVIDER_AGENT_ID or --agent-id=<id>.",
    "No token, commerce, database, or mainnet write is used."
  ].join("\n");
}

async function main(): Promise<void> {
  const flags = parseRegistrationArgs(process.argv.slice(2));
  if (flags.help) { console.log(usage()); return; }
  const config = registrationConfigFromEnvironment(process.env, flags);
  if (flags.mode === "plan") { console.log(JSON.stringify(planRegistration(config), null, 2)); return; }
  if (config.rpcUrl === null) throw new RegistrationError("BSC_TESTNET_RPC_URL_REQUIRED");
  const abi = readOfficialIdentityAbi(config.identityAbiSha256);
  if (flags.mode === "reconcile") {
    const txHash = flags.reconcileTxHash ?? config.reconcileTxHash;
    if (txHash === null) throw new RegistrationError("RECONCILE_TX_HASH_REQUIRED");
    const chain = viemChainAdapter({ rpcUrl: config.rpcUrl, identityRegistry: config.identityRegistry, abi });
    const evidence = await reconcileRegistration({ chain, config, transactionHash: txHash });
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  const readChain = viemChainAdapter({ rpcUrl: config.rpcUrl, identityRegistry: config.identityRegistry, abi });
  if (await readChain.getChainId() !== CHAIN_ID) throw new RegistrationError("CHAIN_NETWORK_MISMATCH");
  if (flags.mode === "read-only") {
    console.log(JSON.stringify(await readOnlyEvidence(readChain, config), null, 2));
    return;
  }
  if (process.env.T5_REFERENCE_REGISTRATION_GO !== "true") throw new RegistrationError("T5_REFERENCE_REGISTRATION_GO_REQUIRED");
  const actors = actorFromEnvironment(process.env, config.identityRegistry);
  const writeChain = viemChainAdapter({ rpcUrl: config.rpcUrl, identityRegistry: config.identityRegistry, abi, ownerAccount: privateKeyToAccount(resolvePrivateKey(process.env, "WALLET_PRIVATE_KEY", ["T5_REFERENCE_OWNER_SECRET_REFERENCE"], "OWNER_PRIVATE_KEY_INVALID")) });
  const evidence = await runRegistrationWrite({ chain: writeChain, config, actors });
  console.log(JSON.stringify(evidence, null, 2));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    const transactionHash = error instanceof RegistrationError ? error.transactionHash : undefined;
    console.error(JSON.stringify({ status: "blocked", broadcast: false, errorCode: errorCode(error), ...(transactionHash === undefined ? {} : { transactionHash }) }));
    process.exitCode = 1;
  }
}
