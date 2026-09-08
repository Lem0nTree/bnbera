import express, { type Express } from "express";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  BNB_TESTNET,
  buildSubmitCall,
  createClient,
  deserializeSession,
  encodeErc8183Manifest,
  erc8183Addresses,
  erc8183ManifestHash,
  erc8183SubmitPermissions,
  getErc8183Job,
  signerFromPrivateKey,
  type Call,
  type Erc8183DeliverableManifest,
  type Erc8183Job,
  type ExecuteResult,
  type SerializedSession,
  type Session,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  encodeFunctionData,
  http,
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
export type BoundedExecutionRequest = { action: typeof EXECUTE_ACTION; jobId: string };
type ErrorCode =
  | "INVALID_COMPILED_CONFIGURATION" | "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST"
  | "ALTANA_SESSION_REQUIRED" | "ALTANA_SESSION_INVALID" | "ALTANA_SESSION_EXPIRED"
  | "ALTANA_SESSION_UNAUTHORIZED" | "SDK_PIN_MISMATCH" | "CHAIN_READ_FAILED"
  | "WRONG_CHAIN" | "JOB_READ_FAILED" | "JOB_NOT_FUNDED" | "JOB_PROVIDER_MISMATCH"
  | "JOB_BUDGET_MISMATCH" | "JOB_CONTRACT_MISMATCH" | "JOB_DESCRIPTION_MISMATCH" | "JOB_EXPIRED"
  | "PAYMENT_ASSET_MISMATCH" | "PAIR_MISMATCH" | "QUOTE_READ_FAILED" | "QUOTE_INVALID";
export class BoundedRuntimeError extends Error {
  public constructor(public readonly code: ErrorCode) { super(code); this.name = "BoundedRuntimeError"; }
}

const commerceAbi = [{ type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const factoryAbi = [{ type: "function", name: "getPair", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] }] as const;
const quoteAbi = [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }] as const;
const swapAbi = [{ type: "function", name: "swapExactETHForTokens", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256[]" }] }] as const;
// The workspace has two independently pinned viem type trees (Studio and the
// root packages); the runtime value is the SDK's chain object in either case.
const publicClient = createPublicClient({ chain: BNB_TESTNET.chain as unknown as Chain, transport: http(BNB_TESTNET.publicRpcUrl) });
const altanaClient = createClient({ chains: [BNB_TESTNET], defaultChainId: CHAIN_ID });
const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const hex = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
const same = (left: unknown, right: Address): boolean => address(left) && left.toLowerCase() === right.toLowerCase();
const fail = (code: ErrorCode): never => { throw new BoundedRuntimeError(code); };

function jobId(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value) || value.length > 78) return null;
  try { const n = BigInt(value); return n > 0n && n <= MAX_UINT256 ? value : null; } catch { return null; }
}
/** The HTTP body is deliberately the complete, exact two-field request. */
export function parseExecutionRequest(value: unknown): BoundedExecutionRequest | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  const id = jobId(body.jobId);
  return keys.length === 2 && keys[0] === "action" && keys[1] === "jobId" && body.action === EXECUTE_ACTION && id !== null ? { action: EXECUTE_ACTION, jobId: id } : null;
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
function restoreSessionJson(raw: string): { stored: SerializedSession; key: Hex } {
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
  return { key: key as Hex, stored: { walletAddress: root.walletAddress, publicKey: root.publicKey, expiry, permissions: { ...(calls === undefined ? {} : { calls: calls as SerializedSession["permissions"]["calls"] }), ...(spend === undefined ? {} : { spend: spend as SerializedSession["permissions"]["spend"] }) } } };
}
/** Studio stores a v1 envelope, bigint wrappers, and its private-key signer. */
export async function deserializeStudioSession(raw: string): Promise<Session> {
  try { const { stored, key } = restoreSessionJson(raw); return deserializeSession(stored, signerFromPrivateKey(key)); }
  catch { return fail("ALTANA_SESSION_INVALID"); }
}
async function loadSession(source: string): Promise<Session> {
  try { const value = source.trim(); return await deserializeStudioSession(value.startsWith("{") ? value : await readFile(value, "utf8")); }
  catch (error) { if (error instanceof BoundedRuntimeError) throw error; return fail("ALTANA_SESSION_INVALID"); }
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
  readFactoryPair?: (token: Address, blockNumber: bigint) => Promise<Address>; readAmountsOut?: (amount: bigint, path: readonly [Address, Address], blockNumber: bigint) => Promise<readonly bigint[]>;
  execute?: (session: Session, calls: readonly Call[]) => Promise<ExecuteResult>; nowUnix?: () => number;
};
export type RuntimeDependencies = RuntimeDeps;

function defaultDeps(): Required<Pick<RuntimeDeps, "loadSession" | "getChainId" | "getBlockNumber" | "readJob" | "readPaymentToken" | "readFactoryPair" | "readAmountsOut" | "execute">> {
  return {
    loadSession, getChainId: () => publicClient.getChainId(), getBlockNumber: () => publicClient.getBlockNumber(), readJob: (id) => getErc8183Job(BNB_TESTNET, id),
    readPaymentToken: (block) => publicClient.readContract({ address: PINNED_ERC8183.commerce, abi: commerceAbi, functionName: "paymentToken", blockNumber: block }) as Promise<Address>,
    readFactoryPair: (token, block) => publicClient.readContract({ address: PINNED_PANCAKESWAP.factory, abi: factoryAbi, functionName: "getPair", args: [PINNED_PANCAKESWAP.wbnb, token], blockNumber: block }) as Promise<Address>,
    readAmountsOut: (amount, path, block) => publicClient.readContract({ address: PINNED_PANCAKESWAP.router, abi: quoteAbi, functionName: "getAmountsOut", args: [amount, path], blockNumber: block }) as Promise<readonly bigint[]>,
    execute: (session, calls) => altanaClient.execute({ session, calls, chainId: CHAIN_ID }),
  };
}
function assertPins(): void {
  try { const sdk = erc8183Addresses(CHAIN_ID); if (BNB_TESTNET.chainId !== CHAIN_ID || BNB_TESTNET.chain.id !== CHAIN_ID || sdk.commerce.toLowerCase() !== PINNED_ERC8183.commerce.toLowerCase() || sdk.router.toLowerCase() !== PINNED_ERC8183.router.toLowerCase() || sdk.policy.toLowerCase() !== PINNED_ERC8183.policy.toLowerCase() || sdk.paymentToken.toLowerCase() !== PINNED_ERC8183.paymentToken.toLowerCase()) fail("SDK_PIN_MISMATCH"); }
  catch (error) { if (error instanceof BoundedRuntimeError) throw error; fail("SDK_PIN_MISMATCH"); }
}
function assertPermissions(session: Session, input: bigint): void {
  const swap = session.permissions.calls?.some((call) => "signature" in call && call.signature === SWAP_SIGNATURE && "to" in call && same(call.to, PINNED_PANCAKESWAP.router));
  const native = session.permissions.spend?.some((spend) => spend.period === "hour" && spend.token === undefined && spend.limit >= input && spend.limit <= MAX_NATIVE_PER_HOUR);
  const submitRule = erc8183SubmitPermissions(CHAIN_ID)[0];
  const submit = submitRule !== undefined && session.permissions.calls?.some((call) => "signature" in call && call.signature === submitRule.signature && "to" in call && same(call.to, submitRule.to));
  if (!address(session.walletAddress) || !hex(session.publicKey) || !swap || !native || !submit) fail("ALTANA_SESSION_UNAUTHORIZED");
}
function safeHash(value: unknown): Hex | undefined { return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as Hex : undefined; }
function manifestDataUrl(text: string): string {
  return `data:application/json;base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

function commonEvidence(job: string, session: Session, config: PublicConfig, pair: Address, block: bigint, quoted: bigint, minimum: bigint, deadline: number, execution: PublicExecutionEvidence["execution"], outcome: PublicExecutionEvidence["outcome"]): ExecutionEvidenceBase {
  return { outcome, retryable: false, chainId: CHAIN_ID, jobId: job, provider: session.walletAddress, budgetAtomic: BUDGET.toString(), paymentToken: PINNED_ERC8183.paymentToken, tradingPair: config.tradingPair, pairAddress: pair, inputAmountWei: config.inputAmountWei, quoteBlock: block.toString(), quotedOutAtomic: quoted.toString(), minimumOutAtomic: minimum.toString(), deadlineUnix: deadline, configDigest: configurationDigest, execution };
}
function manifestFor(evidence: ExecutionEvidenceBase): Erc8183DeliverableManifest {
  const result = { jobId: evidence.jobId, chainId: evidence.chainId, provider: evidence.provider, tradingPair: evidence.tradingPair, pairAddress: evidence.pairAddress, inputAmountWei: evidence.inputAmountWei, quoteBlock: evidence.quoteBlock, quotedOutAtomic: evidence.quotedOutAtomic, minimumOutAtomic: evidence.minimumOutAtomic, deadlineUnix: evidence.deadlineUnix, configDigest: evidence.configDigest };
  return { version: 1, job_id: Number(evidence.jobId), chain_id: CHAIN_ID, contracts: { commerce: PINNED_ERC8183.commerce, router: PINNED_ERC8183.router, policy: PINNED_ERC8183.policy }, response: { content: JSON.stringify(result), content_type: "application/json" }, metadata: { template: "pancakeswap-one-shot", config_digest: configurationDigest, quote_block: evidence.quoteBlock } };
}
function callsEvidence(result: ExecuteResult | undefined): PublicExecutionEvidence["execution"] {
  if (result === undefined || (result.status !== "PENDING" && result.status !== "CONFIRMED" && result.status !== "FAILED")) return { status: "UNKNOWN" };
  const callsId = safeHash(result.callsId), transactionHash = safeHash(result.transactionHash);
  return { status: result.status, ...(callsId === undefined ? {} : { callsId }), ...(transactionHash === undefined ? {} : { transactionHash }) };
}

/** One quote and one Altana batch. Unknown relay results are returned once and never retried here. */
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
  if (!same(job.evaluator, PINNED_ERC8183.router) || !same(job.hook, PINNED_ERC8183.router)) fail("JOB_CONTRACT_MISMATCH");
  if (!parseJobDescription(job.description, config)) fail("JOB_DESCRIPTION_MISMATCH");
  if (typeof job.expiredAt !== "bigint" || (job.statusName === "FUNDED" && BigInt(now) >= job.expiredAt)) fail("JOB_EXPIRED");
  const pair = PINNED_PANCAKESWAP.pairs[config.tradingPair];
  let paymentToken: Address | undefined, actualPair: Address | undefined, amounts: readonly bigint[] | undefined;
  const quoteStarted = injected.nowUnix?.() ?? Math.floor(Date.now() / 1000);
  try { [paymentToken, actualPair] = await Promise.all([deps.readPaymentToken(block), deps.readFactoryPair(pair.token, block)]); amounts = await deps.readAmountsOut(input, [PINNED_PANCAKESWAP.wbnb, pair.token], block); } catch { return fail("QUOTE_READ_FAILED"); }
  if (!same(paymentToken, PINNED_ERC8183.paymentToken)) fail("PAYMENT_ASSET_MISMATCH");
  if (!same(actualPair, pair.pair)) fail("PAIR_MISMATCH");
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
  const manifestText = encodeErc8183Manifest(manifest);
  const deliverable = erc8183ManifestHash(manifest);
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
    buildSubmitCall({ addresses: erc8183Addresses(CHAIN_ID), jobId: BigInt(textId), deliverable, optParams: stringToHex(JSON.stringify({ deliverable_url: deliverableUrl })) }),
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
  app.use(express.json({ limit: "16kb" }));
  app.get("/ping", (_request, response) => response.json({ status: "healthy", template: "pancakeswap-one-shot", version: "1.1.0" }));
  app.get("/.well-known/agent-card.json", (_request, response) => response.json({ name: `BNBEra bounded ${config.tradingPair} one-shot swap`, description: "One bounded PancakeSwap V2 native tBNB swap against a funded ERC-8183 job.", url: process.env.AGENTCORE_RUNTIME_URL ?? "", version: "1.1.0", protocolVersion: "0.3.0", capabilities: {}, skills: [{ id: EXECUTE_ACTION, name: "Execute bounded one-shot swap", description: "Verifies one funded ERC-8183 job, reads a fresh quote, and executes only the persisted swap configuration.", tags: ["erc-8183", "pancakeswap", "one-shot", "execute"], inputModes: ["application/json"], outputModes: ["application/json"] }] }));
  app.post("/", async (request, response) => {
    const parsed = parseExecutionRequest(request.body);
    if (parsed === null) return response.status(400).json({ code: "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST", message: "Submit exactly { action: 'execute_swap', jobId: '<decimal>' }.", retryable: false });
    let work = running.get(parsed.jobId);
    if (work === undefined) { work = executeBoundedSwap(parsed.jobId, options); running.set(parsed.jobId, work); void work.catch(() => { if (running.get(parsed.jobId) === work) running.delete(parsed.jobId); }); }
    try { const evidence = await work; return response.status(evidence.outcome === "confirmed" ? 200 : 202).json(evidence); }
    catch (error) { const code = error instanceof BoundedRuntimeError ? error.code : "JOB_READ_FAILED"; return response.status(code === "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST" ? 400 : 409).json({ code, message: "Bounded execution was not performed.", retryable: false }); }
  });
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(400).json({ code: "INVALID_BOUNDED_SWAP_EXECUTION_REQUEST", message: "Submit exactly { action: 'execute_swap', jobId: '<decimal>' }.", retryable: false }));
  return app;
}
if (process.argv[1]?.endsWith("/unifiedMain.js") || process.argv[1]?.endsWith("/unifiedMain.ts")) createApp().listen(Number(process.env.PORT ?? 9000), "0.0.0.0");
