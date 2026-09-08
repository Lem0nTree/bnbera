import express, { type Express } from "express";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  BNB_TESTNET,
  createClient,
  signerFromPrivateKey,
  type Call,
  type Erc8183Job,
  type ExecuteResult,
  type Session,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import {
  configuration as generatedConfiguration,
  configurationDigest,
} from "./bnbera-public-config.js";
export const EXECUTE_ACTION = "execute_swap" as const;
const JOB_ACTION = "execute_paid_swap" as const;
const TEMPLATE_ID = "pancakeswap-one-shot@1.1.0" as const;
const CHAIN_ID = 97;
const BUDGET = 1_000_000_000_000_000n;
const MAX_NATIVE_PER_HOUR = 2_000_000_000_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const SWAP_SIGNATURE = "swapExactETHForTokens(uint256,address[],address,uint256)";
const SUBMIT_SIGNATURE = "submit(uint256,bytes32,bytes)";
export const PINNED_ERC8183 = {
  commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
  router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25" as Address,
  policy: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA" as Address,
  paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address,
} as const;
export const PINNED_PANCAKESWAP = {
  router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1" as Address,
  factory: "0x6725F303b657a9451d8BA641348b6761A6CC7a17" as Address,
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as Address,
  pairs: {
    "tbnb-cake": { token: "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551" as Address, pair: "0xd08759B57BBd0158fEAC17457Ce5871B45e85bD9" as Address },
    "tbnb-busd": { token: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7" as Address, pair: "0x85eCdCDD01EbE0bfd0aBa74B81cA6D7F4A53582b" as Address },
  },
  selector: "0x7ff36ab5" as Hex,
} as const;
export type PublicConfig = {
  protocol: "pancakeswap-v2";
  tradingPair: "tbnb-cake" | "tbnb-busd";
  inputAmountWei: "100000000000000" | "500000000000000" | "1000000000000000";
  slippageBps: 10 | 25 | 50;
  quoteMaxAgeSeconds: 30 | 60;
  deadlineSeconds: 60 | 120;
};
type StoredSession = { walletAddress: Address; publicKey: Hex; expiry: number; permissions: { calls?: readonly ({ signature: string; to: Address } | { signature: string } | { to: Address })[]; spend?: readonly { limit: string; period: "minute" | "hour" | "day" | "week" | "month" | "year"; token?: Address }[] } };
type DeliverableManifest = { version: 1; job_id: number; chain_id: number; contracts: { commerce: Address; router: Address; policy: Address }; response: { content: string; content_type: string }; metadata: Record<string, unknown> };
export type BoundedExecutionRequest = { action: typeof EXECUTE_ACTION; jobId: string };
type JsonRpcId = string | number;
export type A2ARequest = { id: JsonRpcId; jobId: string; contextId?: string; taskId?: string };
type ErrorCode =
  | "INVALID_COMPILED_CONFIGURATION" | "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST"
  | "ALTANA_SESSION_REQUIRED" | "ALTANA_SESSION_INVALID" | "ALTANA_SESSION_EXPIRED"
  | "ALTANA_SESSION_UNAUTHORIZED" | "SDK_PIN_MISMATCH"
  | "WRONG_CHAIN" | "JOB_READ_FAILED" | "JOB_NOT_FUNDED" | "JOB_PROVIDER_MISMATCH"
  | "JOB_BUDGET_MISMATCH" | "JOB_CONTRACT_MISMATCH" | "JOB_DESCRIPTION_MISMATCH" | "JOB_EXPIRED"
  | "PAYMENT_ASSET_MISMATCH" | "PAIR_MISMATCH" | "QUOTE_READ_FAILED" | "QUOTE_INVALID";
export class BoundedRuntimeError extends Error {
  public constructor(public readonly code: ErrorCode) { super(code); this.name = "BoundedRuntimeError"; }
}
const commerceAbi = [
  { type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" },
    { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" },
    { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" },
    { name: "submittedAt", type: "uint256" }, { name: "deliverable", type: "bytes32" },
  ] }] },
] as const;
const factoryAbi = [{ type: "function", name: "getPair", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] }] as const;
const quoteAbi = [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }] as const;
const routerAbi = [
  { type: "function", name: "policyWhitelist", stateMutability: "view", inputs: [{ name: "policy", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "jobPolicy", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const swapAbi = [{ type: "function", name: "swapExactETHForTokens", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256[]" }] }] as const;
const submitAbi = [{ type: "function", name: "submit", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "bytes32" }, { type: "bytes" }], outputs: [] }] as const;
const publicClient = createPublicClient({ chain: BNB_TESTNET.chain as unknown as Chain, transport: http(BNB_TESTNET.publicRpcUrl) });
const altanaClient = createClient({ chains: [BNB_TESTNET], defaultChainId: CHAIN_ID });
const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const hex = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
const same = (left: unknown, right: Address): boolean => address(left) && left.toLowerCase() === right.toLowerCase();
const fail = (code: ErrorCode): never => { throw new BoundedRuntimeError(code); };
function buildSubmitCallLocal(job: bigint, deliverable: Hex, optParams: Hex): Call {
  return { to: PINNED_ERC8183.commerce, data: encodeFunctionData({ abi: submitAbi, functionName: "submit", args: [job, deliverable, optParams] }) };
}

function jobId(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 78) return null;
  try { const n = BigInt(value); return n > 0n && n <= MAX_UINT256 ? value : null; } catch { return null; }
}
export function parseExecutionRequest(value: unknown): BoundedExecutionRequest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  const id = jobId(body.jobId);
  return keys.length === 2 && keys[0] === "action" && keys[1] === "jobId" && body.action === EXECUTE_ACTION && id !== null ? { action: EXECUTE_ACTION, jobId: id } : null;
}

/** Parse the only supported A2A operation: message/send with one exact DataPart. */
function validRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.length > 0 && value.length <= 256;
}
export function parseA2ARequest(value: unknown): A2ARequest | null {
  if (!record(value) || value.jsonrpc !== "2.0" || value.method !== "message/send" ||
      !validRpcId(value.id)) return null;
  const params = record(value.params) ? value.params : undefined;
  const message = params && record(params.message) ? params.message : undefined;
  if (!message || (message.kind !== undefined && message.kind !== "message") || message.role !== "user" || typeof message.messageId !== "string" || !Array.isArray(message.parts)) return null;
  if ((message.contextId !== undefined && typeof message.contextId !== "string") || (message.taskId !== undefined && typeof message.taskId !== "string")) return null;
  const part = message.parts.find((item) => record(item) && item.kind === "data" && record(item.data));
  if (part === undefined) return null;
  const request = parseExecutionRequest(part.data);
  return request === null ? null : { id: value.id, jobId: request.jobId, ...(message.contextId === undefined ? {} : { contextId: message.contextId }), ...(message.taskId === undefined ? {} : { taskId: message.taskId }) };
}

export function readCompiledConfiguration(): PublicConfig {
  try {
    const value = generatedConfiguration as unknown as Record<string, unknown>;
    const valid = Object.keys(value).length === 6 && value.protocol === "pancakeswap-v2" &&
      (value.tradingPair === "tbnb-cake" || value.tradingPair === "tbnb-busd") &&
      (value.inputAmountWei === "100000000000000" || value.inputAmountWei === "500000000000000" || value.inputAmountWei === "1000000000000000") &&
      (value.slippageBps === 10 || value.slippageBps === 25 || value.slippageBps === 50) &&
      (value.quoteMaxAgeSeconds === 30 || value.quoteMaxAgeSeconds === 60) && (value.deadlineSeconds === 60 || value.deadlineSeconds === 120);
    if (!valid || typeof configurationDigest !== "string" || createHash("sha256").update(JSON.stringify(value)).digest("hex") !== configurationDigest) fail("INVALID_COMPILED_CONFIGURATION");
    return value as PublicConfig;
  } catch (error) { if (error instanceof BoundedRuntimeError) throw error; return fail("INVALID_COMPILED_CONFIGURATION"); }
}

/** The paid job description is the immutable binding to this deployed template. */
export function parseJobDescription(value: unknown, config: PublicConfig = readCompiledConfiguration()): boolean {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!record(parsed)) return false;
    const keys = Object.keys(parsed).sort();
    return keys.length === 5 && keys[0] === "action" && keys[1] === "configurationDigest" && keys[2] === "inputAmountWei" && keys[3] === "template" && keys[4] === "tradingPair" &&
      parsed.action === JOB_ACTION && parsed.template === TEMPLATE_ID && parsed.configurationDigest === configurationDigest && parsed.tradingPair === config.tradingPair && parsed.inputAmountWei === config.inputAmountWei;
  } catch { return false; }
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function decimal(value: unknown): value is string { return typeof value === "string" && /^\d+$/.test(value); }
function restoreSessionJson(raw: string): { stored: StoredSession; key: Hex } {
  const parsed = JSON.parse(raw, (_key, value: unknown) => record(value) && Object.keys(value).length === 1 && typeof value.$bigint === "string" && /^\d+$/.test(value.$bigint) ? value.$bigint : value) as unknown;
  if (!record(parsed)) throw new Error("session");
  if (parsed.version !== undefined && parsed.version !== 1) throw new Error("session");
  const root = record(parsed.session) ? parsed.session : record(parsed.serializedSession) ? parsed.serializedSession : parsed;
  if (root.version !== undefined && root.version !== 1) throw new Error("session");
  const signer = record(parsed.signer) ? parsed.signer : record(root.signer) ? root.signer : undefined;
  const key = signer?.privateKey ?? parsed.privateKey ?? parsed.sessionPrivateKey ?? parsed.signerPrivateKey;
  const expiry = root.expiry;
  if ((signer?.type !== undefined && signer.type !== "privateKey") || typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key) || !address(root.walletAddress) || !hex(root.publicKey) || typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry <= 0 || !record(root.permissions)) throw new Error("session");
  const calls = root.permissions.calls;
  if (calls !== undefined && (!Array.isArray(calls) || calls.some((call) => !record(call) || typeof call.signature !== "string" || (call.to !== undefined && !address(call.to))))) throw new Error("session");
  const spend = root.permissions.spend;
  const periods = new Set(["minute", "hour", "day", "week", "month", "year"]);
  if (spend !== undefined && (!Array.isArray(spend) || spend.some((item) => !record(item) || !decimal(item.limit) || typeof item.period !== "string" || !periods.has(item.period) || (item.token !== undefined && !address(item.token))))) throw new Error("session");
  return { key: key as Hex, stored: { walletAddress: root.walletAddress, publicKey: root.publicKey, expiry, permissions: { ...(calls === undefined ? {} : { calls: calls as StoredSession["permissions"]["calls"] }), ...(spend === undefined ? {} : { spend: spend as StoredSession["permissions"]["spend"] }) } } };
}
export async function deserializeStudioSession(raw: string): Promise<Session> {
  try {
    const { stored, key } = restoreSessionJson(raw);
    const signer = signerFromPrivateKey(key);
    // SDK 0.7.1 keeps its raw key on an enumerable `_privateKey` property.
    // Keep that internal capability for signing/EIP-7702, but make ordinary
    // serialization of the in-memory session incapable of exposing it.
    Object.defineProperty(signer, "_privateKey", { enumerable: false });
    if (signer.publicKey.toLowerCase() !== stored.publicKey.toLowerCase()) throw new Error("session signer mismatch");
    return {
      walletAddress: stored.walletAddress,
      signer,
      publicKey: signer.publicKey,
      permissions: {
        ...(stored.permissions.calls === undefined ? {} : { calls: stored.permissions.calls.map((call) => ({ ...call })) }),
        ...(stored.permissions.spend === undefined ? {} : { spend: stored.permissions.spend.map((spend) => ({ limit: BigInt(spend.limit), period: spend.period, ...(spend.token === undefined ? {} : { token: spend.token }) })) }),
      },
      expiry: stored.expiry,
    };
  }
  catch { return fail("ALTANA_SESSION_INVALID"); }
}
async function loadSession(source: string): Promise<Session> {
  try { const value = source.trim(); return await deserializeStudioSession(value.startsWith("{") ? value : await readFile(value, "utf8")); }
  catch (error) { if (error instanceof BoundedRuntimeError) throw error; return fail("ALTANA_SESSION_INVALID"); }
}

type SecretReader = (secretId: string) => Promise<string>;
async function readManagedSecret(secretId: string): Promise<string> {
  const result = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  if (typeof result.SecretString !== "string" || result.SecretString.length === 0) throw new Error("runtime secret unavailable");
  return result.SecretString;
}
/** Load the managed JSON environment bundle before the execution socket opens. */
export async function loadManagedSecrets(readSecret: SecretReader = readManagedSecret): Promise<void> {
  const secretId = process.env.BNBAGENT_RUNTIME_SECRET_ID?.trim();
  if (!secretId) return;
  let bundle: unknown;
  try { bundle = JSON.parse(await readSecret(secretId)); } catch { throw new Error("runtime secret unavailable"); }
  if (!record(bundle)) throw new Error("runtime secret unavailable");
  for (const [key, value] of Object.entries(bundle)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) throw new Error("runtime secret unavailable");
    process.env[key] = String(value);
  }
  if (typeof process.env.ALTANA_SESSION !== "string" || process.env.ALTANA_SESSION.trim().length === 0) throw new Error("ALTANA_SESSION missing from runtime secret");
}

export type PublicExecutionEvidence = {
  outcome: "confirmed" | "failed" | "unknown"; retryable: false; chainId: 97; jobId: string; provider: Address; budgetAtomic: string; paymentToken: Address;
  tradingPair: PublicConfig["tradingPair"]; pairAddress: Address; inputAmountWei: string; quoteBlock: string; quotedOutAtomic: string; minimumOutAtomic: string; deadlineUnix: number; configDigest: string;
  execution: { status: ExecuteResult["status"] | "UNKNOWN"; callsId?: Hex; transactionHash?: Hex };
  resultSubmission: { status: "confirmed" | "failed" | "unknown"; deliverable: Hex; deliverableUrl?: string; reasonCode?: string };
};
type ExecutionEvidenceBase = Omit<PublicExecutionEvidence, "resultSubmission">;
export type RuntimeDeps = {
  loadSession?: (serialized: string) => Promise<Session>; getChainId?: () => Promise<number>; getBlockNumber?: () => Promise<bigint>;
  readJob?: (jobId: bigint, blockNumber: bigint) => Promise<Erc8183Job>; readPaymentToken?: (blockNumber: bigint) => Promise<Address>;
  readRouterPolicy?: (blockNumber: bigint) => Promise<boolean>;
  readJobPolicy?: (jobId: bigint, blockNumber: bigint) => Promise<Address>;
  readFactoryPair?: (token: Address, blockNumber: bigint) => Promise<Address>; readAmountsOut?: (amount: bigint, path: readonly [Address, Address], blockNumber: bigint) => Promise<readonly bigint[]>;
  execute?: (session: Session, calls: readonly Call[]) => Promise<ExecuteResult>; nowUnix?: () => number;
};
export type RuntimeDependencies = RuntimeDeps;

const erc8183JobStatusNames = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

function defaultDeps(): Required<Pick<RuntimeDeps, "loadSession" | "getChainId" | "getBlockNumber" | "readJob" | "readPaymentToken" | "readRouterPolicy" | "readJobPolicy" | "readFactoryPair" | "readAmountsOut" | "execute">> {
  return {
    loadSession, getChainId: () => publicClient.getChainId(), getBlockNumber: () => publicClient.getBlockNumber(),
    readJob: async (id, block) => {
      const job = await publicClient.readContract({ address: PINNED_ERC8183.commerce, abi: commerceAbi, functionName: "getJob", args: [id], blockNumber: block }) as unknown as Erc8183Job;
      return { ...job, statusName: erc8183JobStatusNames[job.status] ?? ("UNKNOWN" as Erc8183Job["statusName"]) };
    },
    readPaymentToken: (block) => publicClient.readContract({ address: PINNED_ERC8183.commerce, abi: commerceAbi, functionName: "paymentToken", blockNumber: block }) as Promise<Address>,
    readRouterPolicy: (block) => publicClient.readContract({ address: PINNED_ERC8183.router, abi: routerAbi, functionName: "policyWhitelist", args: [PINNED_ERC8183.policy], blockNumber: block }) as Promise<boolean>,
    readJobPolicy: (id, block) => publicClient.readContract({ address: PINNED_ERC8183.router, abi: routerAbi, functionName: "jobPolicy", args: [id], blockNumber: block }) as Promise<Address>,
    readFactoryPair: (token, block) => publicClient.readContract({ address: PINNED_PANCAKESWAP.factory, abi: factoryAbi, functionName: "getPair", args: [PINNED_PANCAKESWAP.wbnb, token], blockNumber: block }) as Promise<Address>,
    readAmountsOut: (amount, path, block) => publicClient.readContract({ address: PINNED_PANCAKESWAP.router, abi: quoteAbi, functionName: "getAmountsOut", args: [amount, path], blockNumber: block }) as Promise<readonly bigint[]>,
    execute: (session, calls) => altanaClient.execute({ session, calls, chainId: CHAIN_ID }),
  };
}
function assertPins(): void {
  try {
    // The managed Studio runtime deliberately uses SDK 0.7.1 for its
    // execution client. Its ERC-8183 registry still exposes an obsolete
    // policy address, so all stack addresses remain explicit standards-locked
    // constants and are independently read below.
    if (BNB_TESTNET.chainId !== CHAIN_ID || BNB_TESTNET.chain.id !== CHAIN_ID || !address(PINNED_ERC8183.commerce) || !address(PINNED_ERC8183.router) || !address(PINNED_ERC8183.policy) || !address(PINNED_ERC8183.paymentToken)) fail("SDK_PIN_MISMATCH");
  }
  catch (error) { if (error instanceof BoundedRuntimeError) throw error; fail("SDK_PIN_MISMATCH"); }
}
function assertPermissions(session: Session, input: bigint): void {
  const swap = session.permissions.calls?.some((call) => "signature" in call && call.signature === SWAP_SIGNATURE && "to" in call && same(call.to, PINNED_PANCAKESWAP.router));
  const native = session.permissions.spend?.some((spend) => spend.period === "hour" && spend.token === undefined && spend.limit >= input && spend.limit <= MAX_NATIVE_PER_HOUR);
  const submit = session.permissions.calls?.some((call) => "signature" in call && call.signature === SUBMIT_SIGNATURE && "to" in call && same(call.to, PINNED_ERC8183.commerce));
  if (!address(session.walletAddress) || !hex(session.publicKey) || !swap || !native || !submit) fail("ALTANA_SESSION_UNAUTHORIZED");
}
function safeHash(value: unknown): Hex | undefined { return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as Hex : undefined; }
function manifestDataUrl(text: string): string {
  return `data:application/json;base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

function commonEvidence(job: string, session: Session, config: PublicConfig, pair: Address, block: bigint, quoted: bigint, minimum: bigint, deadline: number, execution: PublicExecutionEvidence["execution"], outcome: PublicExecutionEvidence["outcome"]): ExecutionEvidenceBase {
  return { outcome, retryable: false, chainId: CHAIN_ID, jobId: job, provider: session.walletAddress, budgetAtomic: BUDGET.toString(), paymentToken: PINNED_ERC8183.paymentToken, tradingPair: config.tradingPair, pairAddress: pair, inputAmountWei: config.inputAmountWei, quoteBlock: block.toString(), quotedOutAtomic: quoted.toString(), minimumOutAtomic: minimum.toString(), deadlineUnix: deadline, configDigest: configurationDigest, execution };
}
function manifestFor(evidence: ExecutionEvidenceBase): DeliverableManifest {
  const result = { chainId: evidence.chainId, configDigest: evidence.configDigest, deadlineUnix: evidence.deadlineUnix, inputAmountWei: evidence.inputAmountWei, jobId: evidence.jobId, minimumOutAtomic: evidence.minimumOutAtomic, pairAddress: evidence.pairAddress, provider: evidence.provider, quoteBlock: evidence.quoteBlock, quotedOutAtomic: evidence.quotedOutAtomic, tradingPair: evidence.tradingPair };
  return { chain_id: CHAIN_ID, contracts: { commerce: PINNED_ERC8183.commerce, policy: PINNED_ERC8183.policy, router: PINNED_ERC8183.router }, job_id: Number(evidence.jobId), metadata: { config_digest: configurationDigest, quote_block: evidence.quoteBlock, template: "pancakeswap-one-shot" }, response: { content: JSON.stringify(result), content_type: "application/json" }, version: 1 };
}
function encodeManifestLocal(manifest: DeliverableManifest): string { return JSON.stringify(manifest); }
function manifestHashLocal(text: string): Hex { return keccak256(toHex(text)); }
function callsEvidence(result: ExecuteResult | undefined): PublicExecutionEvidence["execution"] {
  if (result === undefined || (result.status !== "PENDING" && result.status !== "CONFIRMED" && result.status !== "FAILED")) return { status: "UNKNOWN" };
  const callsId = safeHash(result.callsId), transactionHash = safeHash(result.transactionHash);
  return { status: result.status, ...(callsId === undefined ? {} : { callsId }), ...(transactionHash === undefined ? {} : { transactionHash }) };
}

export async function executeBoundedSwap(requestJobId: string, injected: RuntimeDeps = {}): Promise<PublicExecutionEvidence> {
  const textId = jobId(requestJobId); if (textId === null) return fail("INVALID_BOUNDED_SWAP_EXECUTION_REQUEST");
  const config = readCompiledConfiguration();
  assertPins();
  const rawSession = process.env.ALTANA_SESSION?.trim(); if (!rawSession) return fail("ALTANA_SESSION_REQUIRED");
  const deps = { ...defaultDeps(), ...injected };
  let session: Session;
  try { session = await deps.loadSession(rawSession); } catch (error) { if (error instanceof BoundedRuntimeError) throw error; return fail("ALTANA_SESSION_INVALID"); }
  const now = injected.nowUnix?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(session.expiry) || session.expiry <= now) fail("ALTANA_SESSION_EXPIRED");
  const input = BigInt(config.inputAmountWei); assertPermissions(session, input);
  let chain = -1;
  try { chain = await deps.getChainId(); } catch { return fail("JOB_READ_FAILED"); }
  if (chain !== CHAIN_ID) fail("WRONG_CHAIN");
  let block = -1n, job = undefined as Erc8183Job | undefined;
  try { block = await deps.getBlockNumber(); if (block < 0n) return fail("JOB_READ_FAILED"); job = await deps.readJob(BigInt(textId), block); } catch { return fail("JOB_READ_FAILED"); }
  if (job === undefined) fail("JOB_READ_FAILED");
  if (job.id !== BigInt(textId)) fail("JOB_READ_FAILED");
  if (!same(job.provider, session.walletAddress)) fail("JOB_PROVIDER_MISMATCH");
  if (job.budget !== BUDGET) fail("JOB_BUDGET_MISMATCH");
  let policyWhitelisted = false, jobPolicy: Address | undefined;
  try {
    policyWhitelisted = await deps.readRouterPolicy(block);
    jobPolicy = await deps.readJobPolicy(BigInt(textId), block);
  } catch { return fail("JOB_READ_FAILED"); }
  if (!policyWhitelisted || !same(jobPolicy, PINNED_ERC8183.policy) || !same(job.evaluator, PINNED_ERC8183.router) || !same(job.hook, PINNED_ERC8183.router)) fail("JOB_CONTRACT_MISMATCH");
  if (!parseJobDescription(job.description, config)) fail("JOB_DESCRIPTION_MISMATCH");
  if (typeof job.expiredAt !== "bigint" || (job.statusName === "FUNDED" && BigInt(now) >= job.expiredAt)) fail("JOB_EXPIRED");
  const pair = PINNED_PANCAKESWAP.pairs[config.tradingPair];
  let paymentToken: Address | undefined, actualPair: Address | undefined, amounts: readonly bigint[] | undefined;
  const quoteStarted = injected.nowUnix?.() ?? Math.floor(Date.now() / 1000);
  try {
    paymentToken = await deps.readPaymentToken(block); if (!same(paymentToken, PINNED_ERC8183.paymentToken)) fail("PAYMENT_ASSET_MISMATCH");
    actualPair = await deps.readFactoryPair(pair.token, block); if (!same(actualPair, pair.pair)) fail("PAIR_MISMATCH");
    amounts = await deps.readAmountsOut(input, [PINNED_PANCAKESWAP.wbnb, pair.token], block);
  } catch (error) { if (error instanceof BoundedRuntimeError) throw error; return fail("QUOTE_READ_FAILED"); }
  const quoted = Array.isArray(amounts) && amounts.length === 2 ? amounts[1] : undefined;
  const finished = injected.nowUnix?.() ?? Math.floor(Date.now() / 1000);
  if (typeof quoted !== "bigint" || quoted <= 0n || !Number.isSafeInteger(quoteStarted) || !Number.isSafeInteger(finished) || finished < quoteStarted || finished - quoteStarted > config.quoteMaxAgeSeconds) fail("QUOTE_INVALID");
  const deadline = finished + config.deadlineSeconds;
  const minimum = quoted * BigInt(10_000 - config.slippageBps) / 10_000n; if (minimum <= 0n) fail("QUOTE_INVALID");
  let swapData: Hex | undefined;
  try { swapData = encodeFunctionData({ abi: swapAbi, functionName: "swapExactETHForTokens", args: [minimum, [PINNED_PANCAKESWAP.wbnb, pair.token], session.walletAddress, BigInt(deadline)] }); } catch { return fail("QUOTE_INVALID"); }
  if (swapData === undefined) fail("QUOTE_INVALID");
  if (!swapData.startsWith(PINNED_PANCAKESWAP.selector)) fail("QUOTE_INVALID");
  const base = commonEvidence(textId, session, config, pair.pair, block, quoted, minimum, deadline, { status: "UNKNOWN" }, "unknown");
  if (BigInt(textId) > BigInt(Number.MAX_SAFE_INTEGER)) fail("JOB_READ_FAILED");
  const manifest = manifestFor(base);
  const manifestText = encodeManifestLocal(manifest);
  const deliverable = manifestHashLocal(manifestText);
  const deliverableUrl = manifestDataUrl(manifestText);
  if (job.statusName === "SUBMITTED" && job.status === 2) {
    const existing = safeHash(job.deliverable);
    if (existing === undefined) return fail("JOB_READ_FAILED");
    const existingDeliverable: Hex = existing;
    const submission = existingDeliverable.toLowerCase() === deliverable.toLowerCase() ? { status: "confirmed" as const, deliverable: existingDeliverable, deliverableUrl } : { status: "confirmed" as const, deliverable: existingDeliverable };
    return { ...base, execution: { status: "CONFIRMED" }, outcome: "confirmed", resultSubmission: submission };
  }
  if (job.statusName !== "FUNDED" || job.status !== 1) fail("JOB_NOT_FUNDED");
  const calls: Call[] = [
    { to: PINNED_PANCAKESWAP.router, value: input, data: swapData },
    buildSubmitCallLocal(BigInt(textId), deliverable, stringToHex(JSON.stringify({ deliverable_url: deliverableUrl }))),
  ];
  let result: ExecuteResult | undefined;
  try { result = await deps.execute(session, calls); } catch { result = undefined; }
  const execution = callsEvidence(result);
  if (execution.status === "UNKNOWN" || execution.status === "PENDING") {
    try { const afterBlock = await deps.getBlockNumber(); const after = await deps.readJob(BigInt(textId), afterBlock); const afterDeliverable = safeHash(after.deliverable); if (after.statusName === "SUBMITTED" && after.status === 2 && afterDeliverable?.toLowerCase() === deliverable.toLowerCase()) return { ...base, execution, outcome: "confirmed", resultSubmission: { status: "confirmed", deliverable, deliverableUrl } }; } catch { /* keep unknown */ }
    return { ...base, execution, outcome: "unknown", resultSubmission: { status: "unknown", deliverable, deliverableUrl, reasonCode: "SUBMIT_OUTCOME_UNKNOWN" } };
  }
  if (execution.status === "FAILED") return { ...base, execution, outcome: "failed", resultSubmission: { status: "failed", deliverable, deliverableUrl, reasonCode: "SUBMIT_FAILED" } };
  try { const afterBlock = await deps.getBlockNumber(); const after = await deps.readJob(BigInt(textId), afterBlock); const afterDeliverable = safeHash(after.deliverable); if (after.statusName !== "SUBMITTED" || after.status !== 2 || afterDeliverable?.toLowerCase() !== deliverable.toLowerCase()) return { ...base, execution, outcome: "unknown", resultSubmission: { status: "unknown", deliverable, deliverableUrl, reasonCode: "SUBMIT_OUTCOME_UNKNOWN" } }; }
  catch { return { ...base, execution, outcome: "unknown", resultSubmission: { status: "unknown", deliverable, deliverableUrl, reasonCode: "SUBMIT_OUTCOME_UNKNOWN" } }; }
  return { ...base, execution, outcome: "confirmed", resultSubmission: { status: "confirmed", deliverable, deliverableUrl } };
}

export function createApp(options: RuntimeDeps = {}): Express {
  const config = readCompiledConfiguration(); const app = express();
  const running = new Map<string, Promise<PublicExecutionEvidence>>();
  const run = (id: string): Promise<PublicExecutionEvidence> => {
    let work = running.get(id);
    if (work === undefined) {
      work = executeBoundedSwap(id, options); running.set(id, work);
      void work.catch(() => { if (running.get(id) === work) running.delete(id); });
    }
    return work;
  };
  const rpcError = (id: JsonRpcId | null, code: number, message: string, data?: Record<string, unknown>) => ({
    jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) },
  });
  const handleA2A = async (request: express.Request, response: express.Response) => {
    const body = request.body as unknown;
    const id = record(body) && validRpcId(body.id) ? body.id : null;
    if (!record(body) || body.jsonrpc !== "2.0") return response.status(200).json(rpcError(id, -32600, "Invalid Request"));
    if (body.method !== "message/send") return response.status(200).json(rpcError(id, -32601, "Method not found"));
    const parsed = parseA2ARequest(body);
    if (parsed === null) return response.status(200).json(rpcError(id, -32602, "Invalid params"));
    try {
      const evidence = await run(parsed.jobId);
      const result = {
        kind: "message", role: "agent", messageId: randomUUID(),
        parts: [{ kind: "data", data: evidence }],
        ...(parsed.contextId === undefined ? {} : { contextId: parsed.contextId }),
        ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
      };
      return response.status(200).json({ jsonrpc: "2.0", id: parsed.id, result });
    } catch (error) {
      const reasonCode = error instanceof BoundedRuntimeError ? error.code : "JOB_READ_FAILED";
      return response.status(200).json(rpcError(parsed.id, -32000, "Bounded execution was not performed.", { code: reasonCode, retryable: false }));
    }
  };
  const handleDirect = async (request: express.Request, response: express.Response) => {
    const parsed = parseExecutionRequest(request.body);
    if (parsed === null) return response.status(400).json({ code: "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST", message: "Submit exactly { action: 'execute_swap', jobId: '<decimal>' }.", retryable: false });
    try {
      const evidence = await run(parsed.jobId);
      return response.status(evidence.outcome === "confirmed" ? 200 : 202).json(evidence);
    } catch (error) {
      const code = error instanceof BoundedRuntimeError ? error.code : "JOB_READ_FAILED";
      return response.status(code === "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST" ? 400 : 409).json({ code, message: "Bounded execution was not performed.", retryable: false });
    }
  };
  app.use(express.json({ limit: "16kb" }));
  app.get("/ping", (_request, response) => response.json({ status: "healthy", template: "pancakeswap-one-shot", version: "1.1.0" }));
  app.get("/.well-known/agent-card.json", (_request, response) => response.json({
    name: `BNBEra bounded ${config.tradingPair} one-shot swap`,
    description: "One bounded PancakeSwap V2 asset-allocation rebalance from native tBNB against a funded ERC-8183 job.",
    url: process.env.BNBAGENT_PUBLIC_URL?.trim() || process.env.AGENT_PUBLIC_URL?.trim() || process.env.AGENTCORE_RUNTIME_URL?.trim() || `http://${process.env.AGENT_HOST ?? "localhost"}:9000/`,
    version: "1.1.0", protocolVersion: "0.3.0", preferredTransport: "JSONRPC", capabilities: { streaming: false },
    defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    ...(process.env.OAUTH_TOKEN_URL?.trim() && process.env.OAUTH_SCOPE?.trim() ? {
      securitySchemes: { oauth2: { type: "oauth2", flows: { clientCredentials: { tokenUrl: process.env.OAUTH_TOKEN_URL.trim(), scopes: { [process.env.OAUTH_SCOPE.trim()]: "Invoke the bounded execution agent" } } } } },
      security: [{ oauth2: [process.env.OAUTH_SCOPE.trim()] }],
    } : {}),
    skills: [{ id: EXECUTE_ACTION, name: "Execute bounded one-shot rebalance", description: "Verifies one funded ERC-8183 job, reads a fresh quote, and executes only the persisted asset-allocation rebalance.", tags: ["erc-8183", "pancakeswap", "rebalancing", "asset-allocation", "one-shot"], inputModes: ["application/json"], outputModes: ["application/json"] }],
  }));
  app.post("/", async (request, response) => record(request.body) && request.body.jsonrpc !== undefined ? handleA2A(request, response) : handleDirect(request, response));
  app.post("/message/send", handleA2A);
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(400).json({ code: "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST", message: "Submit exactly { action: 'execute_swap', jobId: '<decimal>' }.", retryable: false }));
  return app;
}

/** AgentCore's A2A contract is fixed to 9000; secrets load before the socket opens. */
export async function startServer(): Promise<void> {
  await loadManagedSecrets();
  createApp().listen(9000, "0.0.0.0");
}
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void startServer().catch(() => { console.error("[bounded-runtime] startup failed"); process.exitCode = 1; });
