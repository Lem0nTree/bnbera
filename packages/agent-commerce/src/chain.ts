import { createHash } from "node:crypto";
import {
  BNB_TESTNET,
  buildClaimRefundCall,
  erc8183Addresses,
  getErc8183Job,
  hireErc8183Agent,
  settleErc8183Job,
  submitErc8183Deliverable,
  encodeErc8183Manifest,
  erc8183ManifestHash,
  verifyErc8183ManifestText,
  createClient,
  type Erc8183DeliverableManifest,
  type Erc8183Job as AltanaErc8183Job,
  type HireAgentParams,
  type NetworkConfig,
  type Session,
  type Signer,
  type SubmitDeliverableParams,
  type Wallet,
  type ExecuteResult,
  type Call
} from "@altananetwork/sdk";
import { createPublicClient, decodeEventLog, http, type Abi, type Address, type Hex } from "viem";
import { CommerceError } from "./errors.js";
import { assertPublicPayloadSafe, normalizeAddress, parseAtomic, parseEnabledDeploymentPin } from "./validation.js";
import type { EnabledErc8183DeploymentPin } from "./types.js";
import type { Erc8183ProviderResult, Erc8183ProviderTask } from "./provider.js";
import { assertProviderResultMatchesTask } from "./provider.js";
import type { Erc8183OperationKind, Erc8183OperationExpectation, Erc8183RpcLog, Erc8183RpcReceipt } from "./operations.js";
import {
  buildErc8183EoaCall,
  ERC8183_EOA_CONTRACTS,
  type Erc8183EoaStep
} from "./eoa.js";

export type Erc8183AltanaAuthority =
  | { readonly wallet: Wallet; readonly signer: Signer }
  | { readonly session: Session };

export interface Erc8183ReceiptReader {
  getTransactionReceipt(input: { readonly hash: Hex }): Promise<Erc8183RpcReceipt | null>;
}

/** Public transaction fields used to prove that a browser sent the exact call. */
export interface Erc8183TransactionReader {
  getTransaction(input: { readonly hash: Hex }): Promise<{
    readonly hash: Hex;
    readonly from: Address;
    readonly to: Address | null;
    readonly input: Hex;
    readonly value: bigint;
  } | null>;
}

/** Public EIP-5792 relay status, reduced to the safe recovery states BNBEra uses. */
export type Erc8183RelayCallStatus = "PENDING" | "CONFIRMED" | "FAILED";

export interface Erc8183RelayStatus {
  readonly status: Erc8183RelayCallStatus;
  /** Raw EIP-5792 status code when the relay returned one. */
  readonly statusCode: number | null;
  /** The first public transaction hash reported by the relay, if any. */
  readonly transactionHash: Hex | null;
}

export interface Erc8183RelayStatusReader {
  getCallsStatus(input: { readonly callsId: Hex }): Promise<Erc8183RelayStatus>;
}

/** Read-only seam for the standards-lock deployment gate. */
export interface Erc8183DeploymentReader {
  getBytecode(input: { readonly address: Address }): Promise<Hex | undefined>;
  getStorageAt(input: { readonly address: Address; readonly slot: Hex }): Promise<Hex | undefined>;
  readContract(input: { readonly address: Address; readonly abi: Abi; readonly functionName: string; readonly args?: readonly unknown[] }): Promise<unknown>;
  getChainId?: () => Promise<number>;
}

/** Runtime observations pinned alongside the four ERC-8183 deployment addresses. */
export interface Erc8183DeploymentVerification {
  readonly commerceProxy: Address;
  readonly routerProxy: Address;
  readonly policy: Address;
  readonly paymentToken: Address;
  readonly paymentDecimals: number;
  readonly commerceImplementation: Address;
  readonly routerImplementation: Address;
  readonly paymentTokenImplementation: Address;
  readonly commerceProxyRuntimeSha256: string;
  readonly routerProxyRuntimeSha256: string;
  readonly policyRuntimeSha256: string;
  readonly paymentTokenRuntimeSha256: string;
  readonly commerceImplementationRuntimeSha256: string;
  readonly routerImplementationRuntimeSha256: string;
  /** The current standards lock records the token implementation address but
   * does not yet record its runtime hash. Do not invent one at composition
   * time; a future lock may add this field before it is enforced. */
  readonly paymentTokenImplementationRuntimeSha256?: string;
  readonly paymentTokenSymbol?: string;
  readonly paymentTokenName?: string;
  readonly implementationSlot?: Hex;
}

export interface Erc8183DeploymentLockConfig {
  readonly chainId: 97;
  readonly enabled: boolean;
  readonly releaseEnabled: boolean;
  readonly verification: Erc8183DeploymentVerification;
}

export type Erc8183RuntimeEnvironment = "development" | "test" | "production";

function lockRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label} record.`, nextAction: "verify_standards_lock" });
  }
  return value as Readonly<Record<string, unknown>>;
}

function lockString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label}.`, nextAction: "verify_standards_lock" });
  }
  return value;
}

function lockBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has no valid ${label} flag.`, nextAction: "verify_standards_lock" });
  }
  return value;
}

function lockAddress(value: unknown, label: string): Address {
  try { return normalizeAddress(lockString(value, label), label) as Address; } catch (cause) {
    if (cause instanceof CommerceError && cause.code === "COMMERCE_DISABLED") throw cause;
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has an invalid ${label} address.`, nextAction: "verify_standards_lock", cause });
  }
}

function lockHash(value: unknown, label: string): string {
  try { return assertSha256(lockString(value, label), label); } catch (cause) {
    if (cause instanceof CommerceError) throw cause;
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has an invalid ${label} runtime hash.`, nextAction: "verify_standards_lock", cause });
  }
}

/**
 * Compose the runtime deployment observations from the checked-in standards
 * lock. The resolver intentionally preserves the lock's disabled/release
 * flags; callers cannot enable commerce by passing this projection alone.
 * Runtime bytecode, proxy slots, token metadata and router/policy links are
 * still read by `verifyNetwork` immediately before any SDK write.
 */
export function resolveErc8183DeploymentVerification(lock: unknown, chainId = 97): Erc8183DeploymentLockConfig {
  if (chainId !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "The ERC-8183 standards lock only defines the BSC testnet deployment." });
  const root = lockRecord(lock, "root");
  const networks = lockRecord(root.networks, "networks");
  const network = lockRecord(networks[String(chainId)], `network ${chainId}`);
  const deployment = lockRecord(network.erc8183, `network ${chainId} ERC-8183 deployment`);
  const runtime = lockRecord(deployment.runtimeSha256, "ERC-8183 runtime hash");
  const abiHashes = lockRecord(deployment.abiHashes, "ERC-8183 ABI hash");
  const commerceAbi = lockString(abiHashes.commerce, "commerce ABI hash");
  if (!/^[0-9a-f]{64}$/iu.test(commerceAbi) || commerceAbi.toLowerCase() !== REVIEWED_APEX_COMMERCE_ABI_SHA256) {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The standards-locked commerce ABI is not the reviewed APEX v1 ABI.", nextAction: "verify_standards_lock" });
  }
  const verification: Erc8183DeploymentVerification = {
    commerceProxy: lockAddress(deployment.commerceProxy, "commerce proxy"),
    routerProxy: lockAddress(deployment.routerProxy, "router proxy"),
    policy: lockAddress(deployment.policy, "policy"),
    paymentToken: lockAddress(deployment.paymentToken, "payment token"),
    paymentDecimals: (() => {
      const value = deployment.paymentDecimals;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 255) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The standards lock has invalid payment-token decimals.", nextAction: "verify_standards_lock" });
      return value;
    })(),
    commerceImplementation: lockAddress(deployment.commerceImplementation, "commerce implementation"),
    routerImplementation: lockAddress(deployment.routerImplementation, "router implementation"),
    paymentTokenImplementation: lockAddress(deployment.paymentTokenImplementation, "payment token implementation"),
    commerceProxyRuntimeSha256: lockHash(runtime.commerceProxy, "commerce proxy"),
    routerProxyRuntimeSha256: lockHash(runtime.routerProxy, "router proxy"),
    policyRuntimeSha256: lockHash(runtime.policy, "policy"),
    paymentTokenRuntimeSha256: lockHash(runtime.paymentToken, "payment token"),
    commerceImplementationRuntimeSha256: lockHash(runtime.commerceImplementation, "commerce implementation"),
    routerImplementationRuntimeSha256: lockHash(runtime.routerImplementation, "router implementation"),
    ...(deployment.paymentTokenSymbol === undefined ? {} : { paymentTokenSymbol: lockString(deployment.paymentTokenSymbol, "payment token symbol") }),
    ...(deployment.paymentTokenName === undefined ? {} : { paymentTokenName: lockString(deployment.paymentTokenName, "payment token name") })
  };
  return {
    chainId: 97,
    enabled: lockBoolean(deployment.enabled, "enabled"),
    releaseEnabled: lockBoolean(deployment.releaseEnabled, "releaseEnabled"),
    verification
  };
}

export interface Erc8183AltanaSdk {
  readonly hire: typeof hireErc8183Agent;
  readonly submit: typeof submitErc8183Deliverable;
  readonly settle: typeof settleErc8183Job;
  /** Client.execute is the SDK's public generic writer, used only for refund. */
  readonly execute: Erc8183SdkExecute;
  readonly getJob: typeof getErc8183Job;
}

export type Erc8183SdkExecute = (authority: Erc8183AltanaAuthority, calls: Call | readonly Call[], opts: { readonly network: NetworkConfig; readonly noWait?: boolean; readonly feeToken?: Address }) => Promise<ExecuteResult>;

export interface Erc8183AltanaAdapterOptions {
  readonly pin: unknown;
  readonly network?: NetworkConfig;
  /** Injected only for deterministic tests or a platform-owned read client. */
  readonly receiptReader?: Erc8183ReceiptReader;
  /** Injected only for deterministic tests; production reads the public RPC. */
  readonly transactionReader?: Erc8183TransactionReader;
  /** Injected only for deterministic tests; production uses the pinned public relay RPC. */
  readonly relayStatusReader?: Erc8183RelayStatusReader;
  readonly deploymentReader?: Erc8183DeploymentReader;
  /** The checked-in lock is the only supported source for runtime pins in
   * production composition. Explicit verification remains available to
   * deterministic tests and a platform-owned composition layer. */
  readonly standardsLock?: unknown;
  readonly deploymentVerification?: Erc8183DeploymentVerification;
  /** Explicit process-level canary opt-in; never accepted in a request. */
  readonly developmentCanaryEnabled?: boolean;
  /** The process configuration in which the canary is composed. */
  readonly runtimeEnvironment?: Erc8183RuntimeEnvironment;
  readonly sdk?: Partial<Erc8183AltanaSdk>;
}

export type Erc8183OnchainStatus = "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";

export interface Erc8183OnchainJob {
  readonly id: string;
  readonly client: Address;
  readonly provider: Address;
  readonly evaluator: Address;
  readonly hook: Address;
  readonly description: string;
  readonly budgetAtomic: string;
  readonly expiredAtUnix: number;
  readonly submittedAtUnix: number;
  readonly status: Erc8183OnchainStatus;
  /** APEX/ERC-8183 Keccak deliverable, not BNBEra's local SHA-256 result digest. */
  readonly chainDeliverable: Hex;
}

export interface Erc8183NetworkEvidence {
  readonly chainId: 97;
  readonly commerceContract: Address;
  readonly routerContract: Address;
  readonly policyContract: Address;
  readonly paymentToken: Address;
  readonly sdkAddressesMatch: true;
}

export interface Erc8183HireInput {
  readonly providerAddress: string;
  readonly task: string;
  readonly budgetAtomic: string;
  readonly deadlineSeconds?: number;
  readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address };
}

export interface Erc8183HireResult {
  readonly callsId: Hex;
  readonly status: ExecuteResult["status"];
  readonly statusCode?: number;
  readonly transactionHash: Hex | null;
  readonly jobId: string;
  readonly budgetAtomic: string;
  readonly expiredAtUnix: number;
  readonly job: Erc8183OnchainJob | null;
  readonly receipt: Erc8183RpcReceipt | null;
}

export interface Erc8183SubmitInput {
  readonly jobId: string;
  readonly authority: Erc8183AltanaAuthority;
  readonly manifest?: Erc8183DeliverableManifest;
  readonly deliverableUrl?: string;
  readonly chainDeliverable?: Hex;
  readonly optParams?: Hex;
  /** BNBEra SHA-256 result identity. It is never used as the on-chain hash. */
  readonly resultDigest: string;
  readonly task?: Erc8183ProviderTask;
  readonly result?: Erc8183ProviderResult;
  readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address };
}

export interface Erc8183SubmitResult {
  readonly callsId: Hex;
  readonly status: ExecuteResult["status"];
  readonly statusCode?: number;
  readonly transactionHash: Hex | null;
  readonly jobId: string;
  readonly resultDigest: string;
  readonly chainDeliverable: Hex;
  readonly job: Erc8183OnchainJob | null;
  readonly receipt: Erc8183RpcReceipt | null;
  readonly manifestText?: string;
}

export interface Erc8183SettleResult {
  readonly callsId: Hex;
  readonly status: ExecuteResult["status"];
  readonly statusCode?: number;
  readonly transactionHash: Hex | null;
  readonly jobId: string;
  readonly action: "approve" | "dispute";
  readonly job: Erc8183OnchainJob | null;
  readonly receipt: Erc8183RpcReceipt | null;
}

export interface Erc8183ClaimRefundResult {
  readonly callsId: Hex;
  readonly status: ExecuteResult["status"];
  readonly statusCode?: number;
  readonly transactionHash: Hex | null;
  readonly jobId: string;
  readonly job: Erc8183OnchainJob | null;
  readonly receipt: Erc8183RpcReceipt | null;
}

const SDK_DEFAULTS: Erc8183AltanaSdk = {
  hire: hireErc8183Agent,
  submit: submitErc8183Deliverable,
  settle: settleErc8183Job,
  execute: async () => {
    throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The Altana SDK execute client has not been configured for this adapter.", nextAction: "configure_altana_sdk" });
  },
  getJob: getErc8183Job
};

const REVIEWED_APEX_COMMERCE_ABI_SHA256 = "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede";

/** Read-only event fragments from the pinned APEX v1 contracts. */
export const ERC8183_COMMERCE_EVENTS_ABI = [{
  type: "event",
  name: "JobCreated",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "client", type: "address" },
    { indexed: true, name: "provider", type: "address" },
    { indexed: false, name: "evaluator", type: "address" },
    { indexed: false, name: "expiredAt", type: "uint256" },
    { indexed: false, name: "hook", type: "address" }
  ]
}, {
  type: "event",
  name: "JobFunded",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "client", type: "address" },
    { indexed: true, name: "provider", type: "address" },
    { indexed: false, name: "amount", type: "uint256" }
  ]
}, {
  type: "event",
  name: "JobSubmitted",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "provider", type: "address" },
    { indexed: false, name: "deliverable", type: "bytes32" }
  ]
}, {
  type: "event",
  name: "JobCompleted",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "evaluator", type: "address" },
    { indexed: false, name: "reason", type: "bytes32" }
  ]
}, {
  type: "event",
  name: "JobExpired",
  anonymous: false,
  inputs: [{ indexed: true, name: "jobId", type: "uint256" }]
}, {
  type: "event",
  name: "Refunded",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "client", type: "address" },
    { indexed: false, name: "amount", type: "uint256" }
  ]
}] as const;

export const ERC8183_ROUTER_EVENTS_ABI = [{
  type: "event",
  name: "JobRegistered",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "policy", type: "address" },
    { indexed: true, name: "client", type: "address" }
  ]
}, {
  type: "event",
  name: "JobSettled",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "policy", type: "address" },
    { indexed: true, name: "verdict", type: "uint8" },
    { indexed: false, name: "reason", type: "bytes32" }
  ]
}, {
  type: "event",
  name: "JobFinalised",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "status", type: "uint8" }
  ]
}] as const;

export const ERC8183_POLICY_EVENTS_ABI = [{
  type: "event",
  name: "Disputed",
  anonymous: false,
  inputs: [
    { indexed: true, name: "jobId", type: "uint256" },
    { indexed: true, name: "client", type: "address" }
  ]
}] as const;

/** ERC-20 allowance evidence for the exact commerce spender and amount. */
export const ERC20_APPROVAL_EVENTS_ABI = [{
  type: "event",
  name: "Approval",
  anonymous: false,
  inputs: [
    { indexed: true, name: "owner", type: "address" },
    { indexed: true, name: "spender", type: "address" },
    { indexed: false, name: "value", type: "uint256" }
  ]
}] as const;

const ERC8183_COMMERCE_LINK_ABI = [{ type: "function", name: "paymentToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] }] as const;
const ERC8183_ROUTER_LINK_ABI = [
  { type: "function", name: "commerce", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "policyWhitelist", stateMutability: "view", inputs: [{ name: "policy", type: "address" }], outputs: [{ name: "", type: "bool" }] }
] as const;
const ERC8183_POLICY_LINK_ABI = [
  { type: "function", name: "commerce", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "disputeWindow", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] }
] as const;
const ERC20_METADATA_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] }
] as const;

const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

/** Backward-compatible alias used by restart recovery helpers. */
const JOB_CREATED_EVENT_ABI = ERC8183_COMMERCE_EVENTS_ABI;

function errorField(value: unknown, field: "transactionHash" | "callsId" | "relayCallsId"): Hex | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[field];
  if (typeof candidate !== "string" || !/^0x[0-9a-f]{64}$/iu.test(candidate)) return undefined;
  return candidate.toLowerCase() as Hex;
}

function sdkCallError(action: string, cause: unknown): CommerceError {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  const providerFailure = /network|rpc|relay|wallet|sign|provider|address|chain|status|job/.test(message);
  const transactionHash = errorField(cause, "transactionHash");
  const relayCallsId = errorField(cause, "relayCallsId") ?? errorField(cause, "callsId");
  return new CommerceError({
    code: providerFailure ? "CHAIN_PROVIDER_INVALID" : "TRANSACTION_UNKNOWN",
    message: providerFailure ? `Altana SDK ${action} could not be completed by the configured provider.` : `Altana SDK ${action} returned an unknown outcome; reconcile before retrying.`,
    retriable: false,
    nextAction: "reconcile_transaction",
    ...(transactionHash === undefined ? {} : { transactionHash }),
    ...(relayCallsId === undefined ? {} : { relayCallsId }),
    cause
  });
}

function asHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The SDK returned an invalid ${label}.` });
  return value.toLowerCase() as Hex;
}

function asHash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The SDK returned an invalid ${label}.` });
  return value.toLowerCase() as Hex;
}

function asAddress(value: unknown, label: string): Address {
  return normalizeAddress(String(value), label) as Address;
}

function asUnix(value: unknown, label: string): number {
  let parsed: bigint;
  try { parsed = BigInt(value as bigint | number | string); } catch (cause) { throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The SDK returned an invalid ${label}.`, cause }); }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number <= 0) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The SDK returned an invalid ${label}.` });
  return number;
}

function asStatus(value: unknown): Erc8183OnchainStatus {
  if (value === "OPEN" || value === "FUNDED" || value === "SUBMITTED" || value === "COMPLETED" || value === "REJECTED" || value === "EXPIRED") return value;
  throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK returned an unknown ERC-8183 job status." });
}

function toOnchainJob(value: AltanaErc8183Job): Erc8183OnchainJob {
  const status = asStatus(value.statusName);
  const budget = BigInt(value.budget);
  if (budget < 0n) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK returned a negative job budget." });
  return {
    id: value.id.toString(10),
    client: asAddress(value.client, "job client"),
    provider: asAddress(value.provider, "job provider"),
    evaluator: asAddress(value.evaluator, "job evaluator"),
    hook: asAddress(value.hook, "job hook"),
    description: value.description,
    budgetAtomic: budget.toString(10),
    expiredAtUnix: asUnix(value.expiredAt, "job expiry"),
    submittedAtUnix: value.submittedAt === 0n ? 0 : asUnix(value.submittedAt, "job submission time"),
    status,
    chainDeliverable: asHex(value.deliverable, "chain deliverable")
  };
}

function sdkExecution(value: ExecuteResult): { readonly callsId: Hex; readonly status: ExecuteResult["status"]; readonly statusCode?: number; readonly transactionHash: Hex | null } {
  const callsId = asHash(value.callsId, "relay calls ID");
  const transactionHash = value.transactionHash === undefined ? null : asHash(value.transactionHash, "transaction hash");
  return { callsId, status: value.status, ...(value.statusCode === undefined ? {} : { statusCode: value.statusCode }), transactionHash };
}

function assertConfirmedHash(execution: ReturnType<typeof sdkExecution>, action: string): Hex {
  if (execution.status === "FAILED") {
    if (execution.transactionHash !== null) throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: `Altana SDK ${action} failed after returning a transaction hash; reconcile before retrying.`, nextAction: "reconcile_transaction", transactionHash: execution.transactionHash, relayCallsId: execution.callsId });
    throw new CommerceError({ code: "TRANSACTION_REVERTED", message: `Altana SDK ${action} was rejected before confirmation.`, nextAction: "inspect_transaction", relayCallsId: execution.callsId });
  }
  if (execution.status === "PENDING") throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: `Altana SDK ${action} is pending; do not resend until the persisted calls ID or transaction is reconciled.`, nextAction: "reconcile_transaction", relayCallsId: execution.callsId, ...(execution.transactionHash === null ? {} : { transactionHash: execution.transactionHash }) });
  if (execution.transactionHash === null) throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: `Altana SDK ${action} confirmed without a transaction hash; reconcile the calls ID before changing local state.`, nextAction: "reconcile_transaction", relayCallsId: execution.callsId });
  return execution.transactionHash;
}

function normalizeReceipt(value: Erc8183RpcReceipt): Erc8183RpcReceipt {
  return {
    status: value.status,
    blockNumber: BigInt(value.blockNumber),
    blockHash: asHash(value.blockHash, "receipt block hash"),
    transactionHash: asHash(value.transactionHash, "receipt transaction hash"),
    logs: value.logs ?? []
  };
}

function assertReceipt(receipt: Erc8183RpcReceipt, transactionHash: Hex, action: string): Erc8183RpcReceipt {
  const parsed = normalizeReceipt(receipt);
  if (parsed.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${action} receipt hash does not match the persisted transaction.`, transactionHash, nextAction: "reconcile_transaction" });
  if (parsed.status === "reverted") throw new CommerceError({ code: "TRANSACTION_REVERTED", message: `The confirmed ${action} transaction reverted.`, transactionHash, nextAction: "inspect_transaction" });
  return parsed;
}

type DecodedReceiptEvent = {
  readonly eventName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly logIndex: number;
};

function eventFromReceipt(receipt: Erc8183RpcReceipt, abi: Abi, eventName: string, expectedAddress: Address): DecodedReceiptEvent | null {
  for (const [position, log] of (receipt.logs ?? []).entries()) {
    if (log.address.toLowerCase() !== expectedAddress.toLowerCase()) continue;
    if (log.transactionHash !== undefined && log.transactionHash.toLowerCase() !== receipt.transactionHash.toLowerCase()) continue;
    if (log.blockHash !== undefined && log.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) continue;
    if (log.blockNumber !== undefined && log.blockNumber !== receipt.blockNumber) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: false } as never) as unknown as { readonly eventName?: string; readonly args?: unknown };
      if (decoded.eventName !== eventName || typeof decoded.args !== "object" || decoded.args === null || Array.isArray(decoded.args)) continue;
      return { eventName, args: decoded.args as Readonly<Record<string, unknown>>, logIndex: log.logIndex ?? position };
    } catch {
      // Receipts include unrelated ERC-20 and hook logs. Keep looking for the
      // operation-specific event on the pinned contract.
    }
  }
  return null;
}

function requireReceiptEvent(receipt: Erc8183RpcReceipt, abi: Abi, eventName: string, expectedAddress: Address, action: string): DecodedReceiptEvent {
  const event = eventFromReceipt(receipt, abi, eventName, expectedAddress);
  if (event === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The successful ${action} receipt is missing ${eventName} on the pinned contract.`, transactionHash: receipt.transactionHash, nextAction: "reconcile_transaction" });
  return event;
}

function eventBigInt(args: Readonly<Record<string, unknown>>, name: string, action: string, transactionHash: Hex): bigint {
  const value = args[name];
  try {
    if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") return BigInt(value);
  } catch {
    // Fall through to the stable boundary error.
  }
  throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${action} receipt has an invalid ${name} event argument.`, transactionHash, nextAction: "reconcile_transaction" });
}

function eventAddress(args: Readonly<Record<string, unknown>>, name: string, action: string, transactionHash: Hex): Address {
  const value = args[name];
  if (typeof value !== "string") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${action} receipt has an invalid ${name} event argument.`, transactionHash, nextAction: "reconcile_transaction" });
  try { return asAddress(value, `event ${name}`); } catch (cause) { throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${action} receipt has an invalid ${name} event argument.`, transactionHash, nextAction: "reconcile_transaction", cause }); }
}

function eventHash(args: Readonly<Record<string, unknown>>, name: string, action: string, transactionHash: Hex): Hex {
  const value = args[name];
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/iu.test(value)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${action} receipt has an invalid ${name} event argument.`, transactionHash, nextAction: "reconcile_transaction" });
  return value.toLowerCase() as Hex;
}

function assertEventBigInt(actual: bigint, expected: bigint, label: string, transactionHash: Hex): void {
  if (actual !== expected) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The confirmed event ${label} does not match the requested value.`, transactionHash, nextAction: "reconcile_transaction" });
}

function assertEventAddress(actual: Address, expected: Address, label: string, transactionHash: Hex): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The confirmed event ${label} does not match the requested actor or contract.`, transactionHash, nextAction: "reconcile_transaction" });
}

function assertActor(actual: Address | null, expected: Address, role: string, transactionHash?: Hex): void {
  if (actual === null || actual.toLowerCase() !== expected.toLowerCase()) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: `The authenticated ${role} does not match the persisted protocol actor.`, ...(transactionHash === undefined ? {} : { transactionHash }), nextAction: transactionHash === undefined ? "authenticate_actor" : "manual_review" });
}

function assertSha256(value: string, label: string): string {
  if (!/^[0-9a-f]{64}$/iu.test(value)) throw new CommerceError({ code: "COMMERCE_DISABLED", message: `The standards lock has an invalid ${label} runtime hash.`, nextAction: "verify_standards_lock" });
  return value.toLowerCase();
}

function runtimeSha256(bytecode: Hex, label: string): string {
  if (!/^0x[0-9a-f]*$/iu.test(bytecode)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The RPC returned invalid ${label} bytecode.`, nextAction: "verify_standards_lock" });
  return createHash("sha256").update(bytecode.slice(2), "hex").digest("hex");
}

function assertRuntimeHash(actual: Hex | undefined, expected: string, label: string): void {
  if (actual === undefined || runtimeSha256(actual, label) !== assertSha256(expected, label)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The pinned ${label} runtime bytecode does not match the standards lock.`, nextAction: "verify_standards_lock" });
}

function assertImplementationSlot(value: Hex | undefined, expected: Address, label: string): void {
  if (value === undefined || !/^0x[0-9a-f]{64}$/iu.test(value) || `0x${value.slice(-40)}`.toLowerCase() !== expected.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The pinned ${label} proxy does not link to the standards-locked implementation.`, nextAction: "verify_standards_lock" });
}

function requireOperationJobId(jobId: string | null, transactionHash: Hex): string {
  if (jobId === null || !/^(0|[1-9][0-9]*)$/u.test(jobId)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted ERC-8183 operation has no valid protocol job ID.", transactionHash, nextAction: "manual_review" });
  return jobId;
}

function recoverCreatedJobId(receipt: Erc8183RpcReceipt, commerceContract: Address): string | null {
  const event = eventFromReceipt(receipt, JOB_CREATED_EVENT_ABI, "JobCreated", commerceContract);
  if (event === null) return null;
  try { return eventBigInt(event.args, "jobId", "hire", receipt.transactionHash).toString(10); } catch { return null; }
}

const ACCEPTED_LATER_STATES: Readonly<Record<Erc8183OnchainStatus, readonly Erc8183OnchainStatus[]>> = {
  OPEN: ["OPEN"],
  FUNDED: ["FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"],
  SUBMITTED: ["SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"],
  COMPLETED: ["COMPLETED"],
  REJECTED: ["REJECTED"],
  EXPIRED: ["EXPIRED"]
};

/**
 * State advancement is operation-specific. In particular, terminal states
 * are not ordered numerically: REJECTED and EXPIRED are valid observations
 * after a submit, but neither is "later than" COMPLETED for every action.
 */
function acceptsState(actual: Erc8183OnchainStatus, expected: Erc8183OnchainStatus): boolean {
  return ACCEPTED_LATER_STATES[expected].includes(actual);
}

function withExecutionContext(cause: unknown, execution: { readonly callsId: Hex; readonly transactionHash: Hex | null }, action: string): CommerceError {
  if (cause instanceof CommerceError) {
    return new CommerceError({
      code: cause.code,
      message: cause.message,
      retriable: cause.retriable,
      nextAction: cause.nextAction,
      ...((cause.transactionHash ?? execution.transactionHash) === undefined ? {} : { transactionHash: cause.transactionHash ?? execution.transactionHash as Hex }),
      relayCallsId: cause.relayCallsId ?? execution.callsId,
      cause: cause.causeValue
    });
  }
  return new CommerceError({
    code: "ONCHAIN_MISMATCH",
    message: `The confirmed ${action} outcome could not be verified; reconcile before retrying.`,
    nextAction: "reconcile_transaction",
    ...(execution.transactionHash === null ? {} : { transactionHash: execution.transactionHash }),
    relayCallsId: execution.callsId,
    cause
  });
}

function authorityAddress(authority: Erc8183AltanaAuthority): Address {
  return normalizeAddress("session" in authority ? authority.session.walletAddress : authority.wallet.address, "signer address") as Address;
}

function relayStatusCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  if (/^0x[0-9a-f]+$/iu.test(value)) {
    const parsed = Number.parseInt(value.slice(2), 16);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (/^[0-9]+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function relayStatusFromRaw(value: unknown): Erc8183RelayCallStatus {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "CONFIRMED" || normalized === "SUCCESS") return "CONFIRMED";
    if (normalized === "FAILED" || normalized === "REVERTED") return "FAILED";
    if (normalized === "PENDING" || normalized === "SUBMITTED") return "PENDING";
  }
  const code = relayStatusCode(value);
  if (code !== null) {
    if (code >= 200 && code < 300) return "CONFIRMED";
    if (code >= 300 && code <= 699) return "FAILED";
    // 1xx is in-flight. Unknown bands intentionally remain pending so an
    // unrecognized relay response can never trigger a duplicate send.
    return "PENDING";
  }
  return "PENDING";
}

function createRelayStatusReader(network: NetworkConfig): Erc8183RelayStatusReader {
  return {
    getCallsStatus: async ({ callsId }) => {
      if (network.relayUrl === undefined || network.relayUrl.trim() === "") {
        throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The pinned Altana network has no public relay status endpoint.", nextAction: "configure_altana_sdk" });
      }
      const relay = createPublicClient({ chain: network.chain, transport: http(network.relayUrl) });
      const raw = await relay.request({ method: "wallet_getCallsStatus", params: [callsId] } as never) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The Altana relay returned an invalid calls status response.", relayCallsId: callsId, nextAction: "reconcile_transaction" });
      }
      const response = raw as Record<string, unknown>;
      const receipts = Array.isArray(response.receipts) ? response.receipts : [];
      const firstReceipt = receipts[0];
      const transactionHash = typeof firstReceipt === "object" && firstReceipt !== null && !Array.isArray(firstReceipt)
        && typeof (firstReceipt as Record<string, unknown>).transactionHash === "string"
        && /^0x[0-9a-f]{64}$/iu.test((firstReceipt as Record<string, unknown>).transactionHash as string)
        ? ((firstReceipt as Record<string, unknown>).transactionHash as string).toLowerCase() as Hex
        : null;
      return {
        status: relayStatusFromRaw(response.status),
        statusCode: relayStatusCode(response.status),
        transactionHash
      };
    }
  };
}

function invokeHire(fn: typeof hireErc8183Agent, authority: Erc8183AltanaAuthority, params: HireAgentParams, opts: { readonly network: NetworkConfig; readonly noWait?: boolean; readonly feeToken?: Address }): ReturnType<typeof hireErc8183Agent> {
  return "session" in authority
    ? fn(authority.session, params, opts)
    : fn(authority.wallet, authority.signer, params, opts);
}

function invokeSubmit(fn: typeof submitErc8183Deliverable, authority: Erc8183AltanaAuthority, params: SubmitDeliverableParams, opts: { readonly network: NetworkConfig; readonly noWait?: boolean; readonly feeToken?: Address }): ReturnType<typeof submitErc8183Deliverable> {
  return "session" in authority
    ? fn(authority.session, params, opts)
    : fn(authority.wallet, authority.signer, params, opts);
}

function invokeSettle(fn: typeof settleErc8183Job, authority: Erc8183AltanaAuthority, params: { readonly jobId: bigint; readonly action?: "approve" | "dispute" }, opts: { readonly network: NetworkConfig; readonly noWait?: boolean; readonly feeToken?: Address }): ReturnType<typeof settleErc8183Job> {
  return "session" in authority
    ? fn(authority.session, params, opts)
    : fn(authority.wallet, authority.signer, params, opts);
}

function invokeExecute(fn: Erc8183SdkExecute, authority: Erc8183AltanaAuthority, calls: Call | readonly Call[], opts: { readonly network: NetworkConfig; readonly noWait?: boolean; readonly feeToken?: Address }): ReturnType<Erc8183SdkExecute> {
  return fn(authority, calls, opts);
}

/** Check that an enabled pin exactly names the Altana SDK's APEX deployment. */
export function assertSdkDeploymentMatchesPin(pin: unknown): EnabledErc8183DeploymentPin {
  const enabled = parseEnabledDeploymentPin(pin);
  if (enabled.chainId !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "The T4 Altana paid-hire adapter only permits BSC testnet chain 97." });
  if (enabled.abiHash.toLowerCase() !== REVIEWED_APEX_COMMERCE_ABI_SHA256) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The enabled ERC-8183 ABI is not the reviewed APEX v1 commerce ABI.", nextAction: "verify_standards_lock" });
  let sdk;
  try { sdk = erc8183Addresses(enabled.chainId); } catch (cause) { throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The configured chain has no Altana ERC-8183 deployment.", nextAction: "verify_standards_lock", cause }); }
  if (enabled.commerceContract.toLowerCase() !== sdk.commerce.toLowerCase()) throw new CommerceError({ code: "INVALID_CONTRACT", message: "The standards-lock commerce address does not match @altananetwork/sdk@0.9.0." });
  if (enabled.paymentToken.toLowerCase() !== sdk.paymentToken.toLowerCase()) throw new CommerceError({ code: "INVALID_TOKEN", message: "The standards-lock payment token does not match @altananetwork/sdk@0.9.0." });
  return enabled;
}

/**
 * Thin application boundary over @altananetwork/sdk. The SDK owns all APEX
 * calldata construction and transaction submission. BNBEra only validates the
 * immutable pin, persists operation state, reads receipts, and verifies the
 * resulting job state.
 */
export class Erc8183AltanaAdapter {
  public readonly pin: EnabledErc8183DeploymentPin;
  public readonly network: NetworkConfig;
  public readonly routerContract: Address;
  public readonly policyContract: Address;
  public readonly paymentToken: Address;
  private readonly sdk: Erc8183AltanaSdk;
  private readonly receiptReader: Erc8183ReceiptReader;
  private readonly transactionReader: Erc8183TransactionReader;
  private readonly relayStatusReader: Erc8183RelayStatusReader;
  private readonly deploymentReader: Erc8183DeploymentReader;
  private readonly deploymentVerification: Erc8183DeploymentVerification | undefined;
  private readonly standardsLockEnabled: boolean | undefined;
  private readonly standardsLockReleaseEnabled: boolean | undefined;
  private readonly developmentCanaryEnabled: boolean;
  private readonly runtimeEnvironment: Erc8183RuntimeEnvironment;

  public constructor(options: Erc8183AltanaAdapterOptions) {
    this.pin = assertSdkDeploymentMatchesPin(options.pin);
    this.network = options.network ?? BNB_TESTNET;
    if (this.network.chainId !== this.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "Altana SDK network does not match the pinned chain." });
    const addresses = erc8183Addresses(this.pin.chainId);
    this.routerContract = addresses.router;
    this.policyContract = addresses.policy;
    this.paymentToken = addresses.paymentToken;
    const client = createClient({ chains: [this.network], defaultChainId: this.network.chainId });
    const publicClient = createPublicClient({ chain: this.network.chain, transport: http(this.network.publicRpcUrl) });
    const defaultExecute: Erc8183SdkExecute = async (authority, calls, opts) => "session" in authority
      ? client.execute({ session: authority.session, calls, chainId: opts.network.chainId, ...(opts.noWait === undefined ? {} : { noWait: opts.noWait }), ...(opts.feeToken === undefined ? {} : { feeToken: opts.feeToken }) })
      : client.execute({ wallet: authority.wallet, signer: authority.signer, calls, chainId: opts.network.chainId, ...(opts.noWait === undefined ? {} : { noWait: opts.noWait }), ...(opts.feeToken === undefined ? {} : { feeToken: opts.feeToken }) });
    this.sdk = { ...SDK_DEFAULTS, execute: defaultExecute, ...(options.sdk ?? {}) };
    this.receiptReader = options.receiptReader ?? createReceiptReader(this.network);
    this.transactionReader = options.transactionReader ?? createTransactionReader(this.network);
    this.relayStatusReader = options.relayStatusReader ?? createRelayStatusReader(this.network);
    this.deploymentReader = options.deploymentReader ?? (publicClient as unknown as Erc8183DeploymentReader);
    const lockConfig = options.standardsLock === undefined ? undefined : resolveErc8183DeploymentVerification(options.standardsLock, this.pin.chainId);
    this.deploymentVerification = lockConfig?.verification ?? options.deploymentVerification;
    this.standardsLockEnabled = lockConfig?.enabled;
    this.standardsLockReleaseEnabled = lockConfig?.releaseEnabled;
    const runtimeEnvironment = options.runtimeEnvironment ?? "production";
    if (runtimeEnvironment !== "development" && runtimeEnvironment !== "test" && runtimeEnvironment !== "production") throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The ERC-8183 runtime environment is invalid for the commerce canary.", nextAction: "verify_standards_lock" });
    this.runtimeEnvironment = runtimeEnvironment;
    this.developmentCanaryEnabled = options.developmentCanaryEnabled ?? false;
    if (this.developmentCanaryEnabled && (this.pin.chainId !== 97 || (this.runtimeEnvironment !== "development" && this.runtimeEnvironment !== "test"))) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "The ERC-8183 development canary is only allowed on chain 97 in development or test configuration.", nextAction: "verify_standards_lock" });
  }

  public async verifyNetwork(): Promise<Erc8183NetworkEvidence> {
    if (this.network.chainId !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "Only BSC testnet is enabled for the T4 paid-hire canary." });
    await this.verifyPinnedDeployment();
    return {
      chainId: 97,
      commerceContract: this.pin.commerceContract as Address,
      routerContract: this.routerContract,
      policyContract: this.policyContract,
      paymentToken: this.paymentToken,
      sdkAddressesMatch: true
    };
  }

  private async verifyPinnedDeployment(): Promise<void> {
    const expected = this.deploymentVerification;
    if (expected === undefined) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "ERC-8183 writes require standards-locked runtime bytecode and proxy-linkage observations.", nextAction: "verify_standards_lock" });
    const addresses = erc8183Addresses(this.pin.chainId);
    for (const [actual, locked, label] of [
      [this.pin.commerceContract, expected.commerceProxy, "commerce proxy"],
      [this.routerContract, expected.routerProxy, "router proxy"],
      [this.policyContract, expected.policy, "policy"],
      [this.paymentToken, expected.paymentToken, "payment token"]
    ] as const) {
      if (actual.toLowerCase() !== locked.toLowerCase()) throw new CommerceError({ code: "INVALID_CONTRACT", message: `The standards-locked ${label} address does not match the configured deployment.`, nextAction: "verify_standards_lock" });
    }
    if (expected.commerceProxy.toLowerCase() !== addresses.commerce.toLowerCase() || expected.routerProxy.toLowerCase() !== addresses.router.toLowerCase() || expected.policy.toLowerCase() !== addresses.policy.toLowerCase() || expected.paymentToken.toLowerCase() !== addresses.paymentToken.toLowerCase()) throw new CommerceError({ code: "INVALID_CONTRACT", message: "The standards-locked ERC-8183 addresses do not match @altananetwork/sdk@0.9.0.", nextAction: "verify_standards_lock" });
    if (this.deploymentReader.getChainId !== undefined && await this.deploymentReader.getChainId() !== this.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "The connected RPC is not the standards-locked BSC testnet network.", nextAction: "verify_standards_lock" });
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.commerceProxy }), expected.commerceProxyRuntimeSha256, "commerce proxy");
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.routerProxy }), expected.routerProxyRuntimeSha256, "router proxy");
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.policy }), expected.policyRuntimeSha256, "policy");
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.paymentToken }), expected.paymentTokenRuntimeSha256, "payment token");
    const slot = expected.implementationSlot ?? EIP1967_IMPLEMENTATION_SLOT;
    assertImplementationSlot(await this.deploymentReader.getStorageAt({ address: expected.commerceProxy, slot }), expected.commerceImplementation, "commerce");
    assertImplementationSlot(await this.deploymentReader.getStorageAt({ address: expected.routerProxy, slot }), expected.routerImplementation, "router");
    assertImplementationSlot(await this.deploymentReader.getStorageAt({ address: expected.paymentToken, slot }), expected.paymentTokenImplementation, "payment token");
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.commerceImplementation }), expected.commerceImplementationRuntimeSha256, "commerce implementation");
    assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.routerImplementation }), expected.routerImplementationRuntimeSha256, "router implementation");
    if (expected.paymentTokenImplementationRuntimeSha256 !== undefined) {
      assertRuntimeHash(await this.deploymentReader.getBytecode({ address: expected.paymentTokenImplementation }), expected.paymentTokenImplementationRuntimeSha256, "payment token implementation");
    }
    const paymentToken = asAddress(await this.deploymentReader.readContract({ address: expected.commerceProxy, abi: ERC8183_COMMERCE_LINK_ABI as unknown as Abi, functionName: "paymentToken" }), "commerce payment token");
    if (paymentToken.toLowerCase() !== expected.paymentToken.toLowerCase()) throw new CommerceError({ code: "INVALID_TOKEN", message: "The commerce proxy paymentToken does not match the standards-locked token.", nextAction: "verify_standards_lock" });
    const decimalsValue = await this.deploymentReader.readContract({ address: expected.paymentToken, abi: ERC20_METADATA_ABI as unknown as Abi, functionName: "decimals" });
    let decimals: bigint;
    try { decimals = BigInt(decimalsValue as bigint | number | string); } catch (cause) { throw new CommerceError({ code: "INVALID_TOKEN", message: "The standards-locked payment token returned an invalid decimals value.", nextAction: "verify_standards_lock", cause }); }
    if (decimals !== BigInt(expected.paymentDecimals) || decimals !== BigInt(this.pin.paymentDecimals)) throw new CommerceError({ code: "INVALID_TOKEN", message: "The payment-token decimals do not match the standards lock.", nextAction: "verify_standards_lock" });
    if (expected.paymentTokenSymbol !== undefined) {
      const symbol = await this.deploymentReader.readContract({ address: expected.paymentToken, abi: ERC20_METADATA_ABI as unknown as Abi, functionName: "symbol" });
      if (symbol !== expected.paymentTokenSymbol) throw new CommerceError({ code: "INVALID_TOKEN", message: "The payment-token symbol does not match the standards lock.", nextAction: "verify_standards_lock" });
    }
    if (expected.paymentTokenName !== undefined) {
      const name = await this.deploymentReader.readContract({ address: expected.paymentToken, abi: ERC20_METADATA_ABI as unknown as Abi, functionName: "name" });
      if (name !== expected.paymentTokenName) throw new CommerceError({ code: "INVALID_TOKEN", message: "The payment-token name does not match the standards lock.", nextAction: "verify_standards_lock" });
    }
    const routerCommerce = asAddress(await this.deploymentReader.readContract({ address: expected.routerProxy, abi: ERC8183_ROUTER_LINK_ABI as unknown as Abi, functionName: "commerce" }), "router commerce");
    if (routerCommerce.toLowerCase() !== expected.commerceProxy.toLowerCase()) throw new CommerceError({ code: "INVALID_CONTRACT", message: "The router is not linked to the standards-locked commerce proxy.", nextAction: "verify_standards_lock" });
    const whitelisted = await this.deploymentReader.readContract({ address: expected.routerProxy, abi: ERC8183_ROUTER_LINK_ABI as unknown as Abi, functionName: "policyWhitelist", args: [expected.policy] });
    if (whitelisted !== true) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The standards-locked policy is not whitelisted by the router.", nextAction: "verify_standards_lock" });
    const policyCommerce = asAddress(await this.deploymentReader.readContract({ address: expected.policy, abi: ERC8183_POLICY_LINK_ABI as unknown as Abi, functionName: "commerce" }), "policy commerce");
    const policyRouter = asAddress(await this.deploymentReader.readContract({ address: expected.policy, abi: ERC8183_POLICY_LINK_ABI as unknown as Abi, functionName: "router" }), "policy router");
    if (policyCommerce.toLowerCase() !== expected.commerceProxy.toLowerCase() || policyRouter.toLowerCase() !== expected.routerProxy.toLowerCase()) throw new CommerceError({ code: "INVALID_CONTRACT", message: "The standards-locked policy is not linked to the commerce/router pair.", nextAction: "verify_standards_lock" });
  }

  private async ensureNetworkVerified(): Promise<void> {
    try { await this.verifyNetwork(); } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "CHAIN_PROVIDER_INVALID", message: "The standards-lock deployment could not be verified by the configured RPC.", nextAction: "verify_standards_lock", cause });
    }
    if (this.standardsLockEnabled !== true || (this.standardsLockReleaseEnabled !== true && !this.developmentCanaryEnabled)) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "ERC-8183 writes remain disabled by the standards lock until the authorized canary or release gate is accepted.", nextAction: "verify_standards_lock" });
  }

  public async readJob(jobId: string | bigint): Promise<Erc8183OnchainJob> {
    let numeric: bigint;
    try { numeric = typeof jobId === "bigint" ? jobId : BigInt(jobId); } catch (cause) { throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 job ID must be a decimal integer.", cause }); }
    if (numeric < 0n) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 job ID must be non-negative." });
    try { return toOnchainJob(await this.sdk.getJob(this.network, numeric)); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("job read", cause); }
  }

  public async getTransactionReceipt(hash: Hex): Promise<Erc8183RpcReceipt | null> {
    try { return await this.receiptReader.getTransactionReceipt({ hash }); } catch (cause) { throw sdkCallError("receipt read", cause); }
  }

  public async getTransaction(hash: Hex): Promise<Awaited<ReturnType<Erc8183TransactionReader["getTransaction"]>>> {
    try { return await this.transactionReader.getTransaction({ hash }); } catch (cause) { throw sdkCallError("transaction read", cause); }
  }

  /** Read the pinned policy window used to make a create expiry valid. */
  public async readDisputeWindow(): Promise<number> {
    try {
      const value = await this.deploymentReader.readContract({
        address: this.policyContract,
        abi: ERC8183_POLICY_LINK_ABI as unknown as Abi,
        functionName: "disputeWindow"
      });
      return asUnix(value, "dispute window");
    } catch (cause) {
      if (cause instanceof CommerceError) throw cause;
      throw sdkCallError("dispute window read", cause);
    }
  }

  /**
   * Read one bounded relay status sample. The caller may invoke this again on
   * a later reload, but this method never waits or resubmits a calls bundle.
   */
  public async getCallsStatus(callsId: Hex): Promise<Erc8183RelayStatus> {
    try {
      return await this.relayStatusReader.getCallsStatus({ callsId });
    } catch (cause) {
      if (cause instanceof CommerceError && cause.code === "TRANSACTION_UNKNOWN") throw cause;
      throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: "The Altana relay status is temporarily unavailable; do not resend the operation.", retriable: true, nextAction: "reconcile_transaction", relayCallsId: callsId, cause });
    }
  }

  public async hire(authority: Erc8183AltanaAuthority, input: Erc8183HireInput): Promise<Erc8183HireResult> {
    const provider = normalizeAddress(input.providerAddress, "provider address") as Address;
    const budget = parseAtomic(input.budgetAtomic, "Job budget");
    if (budget > 10_000_000_000_000_000n) throw new CommerceError({ code: "INVALID_AMOUNT", message: "Job budget exceeds the reviewed MVP cap of 0.01 U.", nextAction: "verify_standards_lock" });
    assertPublicPayloadSafe(input.task, "hire.task");
    if (utf8ByteLength(input.task) > 4096) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 task description exceeds the protocol limit." });
    await this.ensureNetworkVerified();
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof hireErc8183Agent>>;
    try { raw = await invokeHire(this.sdk.hire, authority, { provider, task: input.task, budget, ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds }) }, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("hire", cause); }
    const execution = sdkExecution(raw);
    let jobId: string;
    let expiredAtUnix: number;
    try {
      jobId = raw.jobId.toString(10);
      expiredAtUnix = asUnix(raw.expiredAt, "job expiry");
    } catch (cause) {
      throw withExecutionContext(cause, execution, "hire");
    }
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, budgetAtomic: budget.toString(10), expiredAtUnix, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "hire");
    try {
      const receipt = assertReceipt(await this.requireReceipt(transactionHash, "hire"), transactionHash, "hire");
      this.assertHireReceipt(receipt, jobId, authorityAddress(authority), provider, budget, expiredAtUnix);
      const job = await this.readJob(jobId);
      this.assertHiredJob(job, authorityAddress(authority), provider, budget, expiredAtUnix);
      return { ...execution, transactionHash, jobId, budgetAtomic: budget.toString(10), expiredAtUnix, job, receipt };
    } catch (cause) {
      throw withExecutionContext(cause, execution, "hire");
    }
  }

  public async submit(input: Erc8183SubmitInput): Promise<Erc8183SubmitResult> {
    const jobId = assertDecimalJobId(input.jobId);
    if (!/^[0-9a-f]{64}$/iu.test(input.resultDigest)) throw new CommerceError({ code: "INVALID_JOB", message: "The local result digest must be a 32-byte SHA-256 digest." });
    if (input.task !== undefined && input.result !== undefined) assertProviderResultMatchesTask(input.task, input.result);
    if (input.deliverableUrl !== undefined && input.result?.deliverableUrl !== undefined && input.result.deliverableUrl !== null && input.deliverableUrl !== input.result.deliverableUrl) throw new CommerceError({ code: "INVALID_JOB", message: "The submitted deliverable URL does not match the provider result." });
    const deliverableUrl = input.deliverableUrl ?? input.result?.deliverableUrl ?? "";
    const manifestChainDeliverable = input.manifest === undefined ? null : erc8183ManifestHash(input.manifest);
    const suppliedChainDeliverable = (input.chainDeliverable ?? input.result?.chainDeliverable ?? null) as Hex | null;
    if (input.manifest !== undefined && input.manifest.job_id !== Number(jobId)) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 manifest job_id does not match the target job." });
    if (manifestChainDeliverable !== null && suppliedChainDeliverable !== null && manifestChainDeliverable.toLowerCase() !== suppliedChainDeliverable.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The manifest Keccak digest does not match the supplied chain deliverable." });
    const requestedChainDeliverable = manifestChainDeliverable ?? suppliedChainDeliverable;
    if (requestedChainDeliverable === null || !/^0x[0-9a-f]{64}$/iu.test(requestedChainDeliverable)) throw new CommerceError({ code: "INVALID_JOB", message: "Submission requires a 32-byte Keccak chain deliverable; the local SHA-256 result digest is not sufficient." });
    const sdkParams: SubmitDeliverableParams = input.manifest !== undefined
      ? { jobId: BigInt(jobId), manifest: input.manifest, deliverableUrl }
      : { jobId: BigInt(jobId), deliverable: requestedChainDeliverable, ...(input.optParams === undefined ? {} : { optParams: input.optParams }) };
    if ("deliverable" in sdkParams && !/^0x[0-9a-f]{64}$/iu.test(sdkParams.deliverable)) throw new CommerceError({ code: "INVALID_JOB", message: "An APEX deliverable must be a 32-byte Keccak hash." });
    const beforeSubmit = await this.readJob(jobId);
    assertActor(authorityAddress(input.authority), beforeSubmit.provider, "provider");
    await this.ensureNetworkVerified();
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof submitErc8183Deliverable>>;
    try { raw = await invokeSubmit(this.sdk.submit, input.authority, sdkParams, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("submit", cause); }
    const execution = sdkExecution(raw);
    let chainDeliverable: Hex;
    try {
      chainDeliverable = asHash(raw.deliverable, "chain deliverable");
    } catch (cause) {
      throw withExecutionContext(cause, execution, "submit");
    }
    if (requestedChainDeliverable.toLowerCase() !== chainDeliverable.toLowerCase()) throw withExecutionContext(new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK returned a chain deliverable different from the requested provider result.", nextAction: "reconcile_transaction" }), execution, "submit");
    if (input.manifest !== undefined && raw.manifestText === undefined) throw withExecutionContext(new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK did not return the canonical manifest bytes required for the deliverable URL.", nextAction: "reconcile_transaction" }), execution, "submit");
    if (raw.manifestText !== undefined && !verifyErc8183ManifestText(raw.manifestText, chainDeliverable)) throw withExecutionContext(new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK manifest bytes do not hash to the submitted on-chain deliverable.", nextAction: "reconcile_transaction" }), execution, "submit");
    if (input.manifest !== undefined && raw.manifestText !== undefined && raw.manifestText !== encodeErc8183Manifest(input.manifest)) throw withExecutionContext(new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK returned manifest bytes that are not the canonical manifest requested by the provider.", nextAction: "reconcile_transaction" }), execution, "submit");
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable, job: null, receipt: null, ...(raw.manifestText === undefined ? {} : { manifestText: raw.manifestText }) };
    const transactionHash = assertConfirmedHash(execution, "submit");
    try {
      const receipt = assertReceipt(await this.requireReceipt(transactionHash, "submit"), transactionHash, "submit");
      this.assertSubmitReceipt(receipt, jobId, authorityAddress(input.authority), chainDeliverable);
      const job = await this.readJob(jobId);
      if (!acceptsState(job.status, "SUBMITTED") || job.chainDeliverable.toLowerCase() !== chainDeliverable.toLowerCase() || job.provider.toLowerCase() !== authorityAddress(input.authority).toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed submit did not produce the requested provider, deliverable, and valid post-submit state.", transactionHash, nextAction: "reconcile_transaction" });
      return { ...execution, transactionHash, jobId, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable, job, receipt, ...(raw.manifestText === undefined ? {} : { manifestText: raw.manifestText }) };
    } catch (cause) {
      throw withExecutionContext(cause, execution, "submit");
    }
  }

  public async settle(authority: Erc8183AltanaAuthority, input: { readonly jobId: string; readonly action?: "approve" | "dispute"; readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address } }): Promise<Erc8183SettleResult> {
    const jobId = assertDecimalJobId(input.jobId);
    const action = input.action ?? "approve";
    const beforeSettle = await this.readJob(jobId);
    assertActor(authorityAddress(authority), beforeSettle.client, "client");
    await this.ensureNetworkVerified();
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof settleErc8183Job>>;
    try { raw = await invokeSettle(this.sdk.settle, authority, { jobId: BigInt(jobId), action }, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("settle", cause); }
    const execution = sdkExecution(raw);
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, action, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "settle");
    try {
      const receipt = assertReceipt(await this.requireReceipt(transactionHash, "settle"), transactionHash, "settle");
      const job = await this.readJob(jobId);
      this.assertSettleReceipt(receipt, jobId, action, authorityAddress(authority), job);
      if (action === "approve" && job.status !== "COMPLETED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed approval did not produce COMPLETED protocol state.", transactionHash, nextAction: "reconcile_transaction" });
      if (action === "dispute" && !acceptsState(job.status, "SUBMITTED")) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed dispute did not leave the job in a valid post-submit state.", transactionHash, nextAction: "reconcile_transaction" });
      return { ...execution, transactionHash, jobId, action, job, receipt };
    } catch (cause) {
      throw withExecutionContext(cause, execution, "settle");
    }
  }

  public async claimRefund(authority: Erc8183AltanaAuthority, input: { readonly jobId: string; readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address } }): Promise<Erc8183ClaimRefundResult> {
    const jobId = assertDecimalJobId(input.jobId);
    const beforeRefund = await this.readJob(jobId);
    assertActor(authorityAddress(authority), beforeRefund.client, "client");
    await this.ensureNetworkVerified();
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<Erc8183SdkExecute>>;
    try { raw = await invokeExecute(this.sdk.execute, authority, buildClaimRefundCall(this.pin.chainId, BigInt(jobId)), options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("claim refund", cause); }
    const execution = sdkExecution(raw);
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "claim refund");
    try {
      const receipt = assertReceipt(await this.requireReceipt(transactionHash, "claim refund"), transactionHash, "claim refund");
      const job = await this.readJob(jobId);
      this.assertRefundReceipt(receipt, jobId, authorityAddress(authority), job);
      if (job.status !== "EXPIRED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed refund did not produce EXPIRED protocol state.", transactionHash, nextAction: "reconcile_transaction" });
      return { ...execution, transactionHash, jobId, job, receipt };
    } catch (cause) {
      throw withExecutionContext(cause, execution, "claim refund");
    }
  }

  /** Verify a previously persisted transaction without submitting anything. */
  public async verifyReceiptForOperation(input: {
    readonly transactionHash: Hex;
    readonly kind: Erc8183OperationKind;
    readonly jobId: string | null;
    readonly signerAddress?: string | null;
    readonly action?: "approve" | "dispute";
    readonly expectation?: Erc8183OperationExpectation | null;
  }): Promise<{ readonly receipt: Erc8183RpcReceipt; readonly job: Erc8183OnchainJob | null }> {
    const receipt = assertReceipt(await this.requireReceipt(input.transactionHash, "reconciliation"), input.transactionHash, "reconciliation");
    const signer = input.signerAddress === undefined || input.signerAddress === null ? null : normalizeAddress(input.signerAddress, "operation signer") as Address;
    const recoveredJobId = input.jobId ?? (input.kind === "create" ? recoverCreatedJobId(receipt, this.pin.commerceContract as Address) : null);
    if (input.kind === "create" && recoveredJobId === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed hire receipt has no recoverable JobCreated identity.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    const job = recoveredJobId === null ? null : await this.readJob(recoveredJobId);
    if (input.kind === "create") {
      const id = recoveredJobId as string;
      const created = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCreated", this.pin.commerceContract as Address, "hire");
      const funded = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobFunded", this.pin.commerceContract as Address, "hire");
      this.assertHireEvents(created, funded, id, signer, input.expectation, input.transactionHash);
      if (job !== null) this.assertHireState(job, input.expectation, input.transactionHash);
    } else if (input.kind === "submit") {
      const id = requireOperationJobId(input.jobId, input.transactionHash);
      const event = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobSubmitted", this.pin.commerceContract as Address, "submit");
      this.assertSubmitEvent(event, id, signer, input.expectation?.digest, input.transactionHash);
      if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled submit has no readable protocol job.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      if (!acceptsState(job.status, "SUBMITTED")) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled submit job has not reached SUBMITTED or a later state.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      if (input.expectation?.digest !== undefined && job.chainDeliverable.toLowerCase() !== input.expectation.digest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled job deliverable does not match the committed Keccak digest.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    } else if (input.kind === "settle") {
      const id = requireOperationJobId(input.jobId, input.transactionHash);
      if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled settlement has no readable protocol job.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      assertActor(signer, job.client, "client", input.transactionHash);
      const action = input.action ?? "approve";
      if (action === "approve") {
        const settled = requireReceiptEvent(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobSettled", this.routerContract, "settle");
        const finalised = requireReceiptEvent(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobFinalised", this.routerContract, "settle");
        const completed = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCompleted", this.pin.commerceContract as Address, "settle");
        assertEventBigInt(eventBigInt(settled.args, "jobId", "settle", input.transactionHash), BigInt(id), "settled job ID", input.transactionHash);
        assertEventAddress(eventAddress(settled.args, "policy", "settle", input.transactionHash), this.policyContract, "settlement policy", input.transactionHash);
        if (eventBigInt(settled.args, "verdict", "settle", input.transactionHash) !== 1n) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The settlement receipt did not contain an approval verdict.", transactionHash: input.transactionHash, nextAction: "manual_review" });
        assertEventBigInt(eventBigInt(finalised.args, "jobId", "settle", input.transactionHash), BigInt(id), "finalised job ID", input.transactionHash);
        if (eventBigInt(finalised.args, "status", "settle", input.transactionHash) !== 3n) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The settlement receipt did not finalise the job as completed.", transactionHash: input.transactionHash, nextAction: "manual_review" });
        assertEventBigInt(eventBigInt(completed.args, "jobId", "settle", input.transactionHash), BigInt(id), "completed job ID", input.transactionHash);
        assertEventAddress(eventAddress(completed.args, "evaluator", "settle", input.transactionHash), job.evaluator, "completion evaluator", input.transactionHash);
        if (job.status !== "COMPLETED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled approval job is not COMPLETED.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      } else {
        const disputed = requireReceiptEvent(receipt, ERC8183_POLICY_EVENTS_ABI, "Disputed", this.policyContract, "dispute");
        assertEventBigInt(eventBigInt(disputed.args, "jobId", "dispute", input.transactionHash), BigInt(id), "dispute job ID", input.transactionHash);
        assertEventAddress(eventAddress(disputed.args, "client", "dispute", input.transactionHash), signer ?? job.client, "dispute client", input.transactionHash);
        if (!acceptsState(job.status, "SUBMITTED")) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled dispute job is not in a valid post-submit state.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      }
    } else if (input.kind === "claim_refund") {
      const id = requireOperationJobId(input.jobId, input.transactionHash);
      if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled refund has no readable protocol job.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      assertActor(signer, job.client, "client", input.transactionHash);
      this.assertRefundReceipt(receipt, id, signer ?? job.client, job);
    } else {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `Receipt verification is not implemented for ${input.kind}; manual review is required.`, transactionHash: input.transactionHash, nextAction: "manual_review" });
    }
    if (job !== null && input.expectation !== undefined && input.expectation !== null) {
      if (input.expectation.providerAddress !== undefined && job.provider.toLowerCase() !== input.expectation.providerAddress.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Reconciled provider does not match the operation expectation.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      if (input.expectation.amountAtomic !== undefined && job.budgetAtomic !== input.expectation.amountAtomic) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Reconciled budget does not match the operation expectation.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    }
    return { receipt, job };
  }

  /**
   * Verify one browser-owned EOA transaction. The transaction envelope is
   * checked in addition to the receipt so a valid event from a different call
   * cannot advance the persisted sequence. `create` deliberately derives its
   * job ID only from JobCreated in this receipt.
   */
  public async verifyEoaReceipt(input: {
    readonly transactionHash: Hex;
    readonly step: Erc8183EoaStep;
    readonly actorAddress: string;
    readonly jobId?: string | null;
    readonly providerAddress?: string;
    readonly task?: string;
    readonly budgetAtomic?: string;
    readonly expiredAtUnix?: number;
  }): Promise<{
    readonly receipt: Erc8183RpcReceipt;
    readonly job: Erc8183OnchainJob;
    readonly jobId: string;
    readonly logIndex: number | null;
  }> {
    const actor = normalizeAddress(input.actorAddress, "operation signer") as Address;
    const call = buildErc8183EoaCall({
      chainId: this.pin.chainId,
      contracts: {
        commerceContract: this.pin.commerceContract,
        routerContract: ERC8183_EOA_CONTRACTS.routerContract,
        policyContract: ERC8183_EOA_CONTRACTS.policyContract,
        paymentToken: this.pin.paymentToken
      },
      step: input.step,
      ...(input.providerAddress === undefined ? {} : { providerAddress: input.providerAddress }),
      ...(input.task === undefined ? {} : { task: input.task }),
      ...(input.expiredAtUnix === undefined ? {} : { expiredAtUnix: input.expiredAtUnix }),
      ...(input.budgetAtomic === undefined ? {} : { budgetAtomic: input.budgetAtomic }),
      ...(input.step === "create" || input.jobId === undefined || input.jobId === null ? {} : { jobId: input.jobId })
    });
    const transaction = await this.getTransaction(input.transactionHash);
    if (transaction === null) throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: "The browser transaction is not readable yet; do not resend it.", transactionHash: input.transactionHash, nextAction: "reconcile_transaction" });
    if (transaction.hash.toLowerCase() !== input.transactionHash.toLowerCase() || transaction.from.toLowerCase() !== actor.toLowerCase() || transaction.to === null || transaction.to.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== call.data.toLowerCase() || transaction.value !== 0n) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The browser transaction envelope does not match the persisted actor and exact APEX call.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    }
    const receipt = assertReceipt(await this.requireReceipt(input.transactionHash, `EOA ${input.step}`), input.transactionHash, `EOA ${input.step}`);
    if (input.step === "create") {
      const created = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCreated", this.pin.commerceContract as Address, "create");
      if (eventFromReceipt(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobFunded", this.pin.commerceContract as Address) !== null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A create transaction unexpectedly contains funding evidence.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      const actualJobId = eventBigInt(created.args, "jobId", "create", input.transactionHash).toString(10);
      if (input.jobId !== undefined && input.jobId !== null && input.jobId !== actualJobId) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted created job ID does not match the JobCreated event.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      assertEventAddress(eventAddress(created.args, "client", "create", input.transactionHash), actor, "created client", input.transactionHash);
      if (input.providerAddress !== undefined) assertEventAddress(eventAddress(created.args, "provider", "create", input.transactionHash), normalizeAddress(input.providerAddress, "provider address") as Address, "created provider", input.transactionHash);
      assertEventAddress(eventAddress(created.args, "evaluator", "create", input.transactionHash), this.routerContract, "created evaluator", input.transactionHash);
      assertEventAddress(eventAddress(created.args, "hook", "create", input.transactionHash), this.routerContract, "created hook", input.transactionHash);
      if (input.expiredAtUnix !== undefined) assertEventBigInt(eventBigInt(created.args, "expiredAt", "create", input.transactionHash), BigInt(input.expiredAtUnix), "job expiry", input.transactionHash);
      const job = await this.readJob(actualJobId);
      if (job.id !== actualJobId || job.client.toLowerCase() !== actor.toLowerCase() || (input.providerAddress !== undefined && job.provider.toLowerCase() !== input.providerAddress.toLowerCase()) || job.evaluator.toLowerCase() !== this.routerContract.toLowerCase() || job.hook.toLowerCase() !== this.routerContract.toLowerCase() || (input.task !== undefined && job.description !== input.task) || (input.expiredAtUnix !== undefined && job.expiredAtUnix !== input.expiredAtUnix) || job.status !== "OPEN") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The create receipt and readable job do not match the persisted quote, actor, or open state.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      return { receipt, job, jobId: actualJobId, logIndex: eventFromReceipt(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCreated", this.pin.commerceContract as Address)?.logIndex ?? null };
    }

    const id = requireOperationJobId(input.jobId ?? null, input.transactionHash);
    let logIndex: number | null = null;
    if (input.step === "register") {
      const event = requireReceiptEvent(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobRegistered", this.routerContract, "register");
      logIndex = event.logIndex;
      assertEventBigInt(eventBigInt(event.args, "jobId", "register", input.transactionHash), BigInt(id), "registered job ID", input.transactionHash);
      assertEventAddress(eventAddress(event.args, "policy", "register", input.transactionHash), this.policyContract, "registered policy", input.transactionHash);
      assertEventAddress(eventAddress(event.args, "client", "register", input.transactionHash), actor, "registered client", input.transactionHash);
    } else if (input.step === "set_budget") {
      if (input.budgetAtomic === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The set-budget operation has no persisted amount.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    } else if (input.step === "approve") {
      if (input.budgetAtomic === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The approve operation has no persisted amount.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      const approval = requireReceiptEvent(receipt, ERC20_APPROVAL_EVENTS_ABI, "Approval", this.paymentToken, "approve");
      logIndex = approval.logIndex;
      assertEventAddress(eventAddress(approval.args, "owner", "approve", input.transactionHash), actor, "approval owner", input.transactionHash);
      assertEventAddress(eventAddress(approval.args, "spender", "approve", input.transactionHash), this.pin.commerceContract as Address, "approval spender", input.transactionHash);
      assertEventBigInt(eventBigInt(approval.args, "value", "approve", input.transactionHash), BigInt(input.budgetAtomic), "approval amount", input.transactionHash);
    } else if (input.step === "fund") {
      if (input.budgetAtomic === undefined || input.providerAddress === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The fund operation has incomplete persisted terms.", transactionHash: input.transactionHash, nextAction: "manual_review" });
      const funded = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobFunded", this.pin.commerceContract as Address, "fund");
      logIndex = funded.logIndex;
      assertEventBigInt(eventBigInt(funded.args, "jobId", "fund", input.transactionHash), BigInt(id), "funded job ID", input.transactionHash);
      assertEventAddress(eventAddress(funded.args, "client", "fund", input.transactionHash), actor, "funded client", input.transactionHash);
      assertEventAddress(eventAddress(funded.args, "provider", "fund", input.transactionHash), normalizeAddress(input.providerAddress, "provider address") as Address, "funded provider", input.transactionHash);
      assertEventBigInt(eventBigInt(funded.args, "amount", "fund", input.transactionHash), BigInt(input.budgetAtomic), "funding amount", input.transactionHash);
    }

    let checked: { readonly receipt: Erc8183RpcReceipt; readonly job: Erc8183OnchainJob | null };
    if (input.step === "settle" || input.step === "dispute" || input.step === "claim_refund") {
      checked = await this.verifyReceiptForOperation({
        transactionHash: input.transactionHash,
        kind: input.step === "claim_refund" ? "claim_refund" : "settle",
        jobId: id,
        signerAddress: actor,
        ...(input.step === "dispute" ? { action: "dispute" as const } : input.step === "settle" ? { action: "approve" as const } : {})
      });
      logIndex = input.step === "dispute"
        ? eventFromReceipt(receipt, ERC8183_POLICY_EVENTS_ABI, "Disputed", this.policyContract)?.logIndex ?? null
        : input.step === "claim_refund"
          ? eventFromReceipt(receipt, ERC8183_COMMERCE_EVENTS_ABI, "Refunded", this.pin.commerceContract as Address)?.logIndex ?? null
          : eventFromReceipt(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobFinalised", this.routerContract)?.logIndex ?? null;
    } else {
      checked = { receipt, job: await this.readJob(id) };
    }
    if (checked.job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed browser operation has no readable protocol job.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    const job = checked.job;
    if (input.step === "register" || input.step === "set_budget") {
      if (job.client.toLowerCase() !== actor.toLowerCase() || job.status !== "OPEN") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The ${input.step} receipt did not leave the buyer job open for the next sequential step.`, transactionHash: input.transactionHash, nextAction: "manual_review" });
      if (input.step === "set_budget" && input.budgetAtomic !== undefined && job.budgetAtomic !== input.budgetAtomic) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The readable budget does not match the persisted exact amount.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    }
    if (input.step === "fund") {
      if (job.client.toLowerCase() !== actor.toLowerCase() || input.budgetAtomic === undefined || job.budgetAtomic !== input.budgetAtomic || !acceptsState(job.status, "FUNDED")) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The funding receipt did not prove the exact amount and funded-or-later job state.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    }
    if (input.step === "claim_refund" && job.status !== "EXPIRED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The refund receipt did not produce EXPIRED protocol state.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    return { receipt: checked.receipt, job, jobId: id, logIndex };
  }

  private async requireReceipt(hash: Hex, action: string): Promise<Erc8183RpcReceipt> {
    const receipt = await this.getTransactionReceipt(hash);
    if (receipt === null) throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: `The ${action} transaction has no receipt yet; do not resend.`, transactionHash: hash, nextAction: "reconcile_transaction" });
    return receipt;
  }

  private assertHireReceipt(receipt: Erc8183RpcReceipt, jobId: string, client: Address, provider: Address, budget: bigint, expiredAtUnix: number): void {
    const created = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCreated", this.pin.commerceContract as Address, "hire");
    const funded = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobFunded", this.pin.commerceContract as Address, "hire");
    this.assertHireEvents(created, funded, jobId, client, { providerAddress: provider, amountAtomic: budget.toString(10) }, receipt.transactionHash);
    const createdExpiry = eventBigInt(created.args, "expiredAt", "hire", receipt.transactionHash);
    assertEventBigInt(createdExpiry, BigInt(expiredAtUnix), "job expiry", receipt.transactionHash);
  }

  private assertHireEvents(created: DecodedReceiptEvent, funded: DecodedReceiptEvent, jobId: string, client: Address | null, expectation: Erc8183OperationExpectation | null | undefined, transactionHash: Hex): void {
    assertEventBigInt(eventBigInt(created.args, "jobId", "hire", transactionHash), BigInt(jobId), "created job ID", transactionHash);
    assertEventBigInt(eventBigInt(funded.args, "jobId", "hire", transactionHash), BigInt(jobId), "funded job ID", transactionHash);
    if (client !== null) assertEventAddress(eventAddress(created.args, "client", "hire", transactionHash), client, "created client", transactionHash);
    const createdProvider = eventAddress(created.args, "provider", "hire", transactionHash);
    const fundedProvider = eventAddress(funded.args, "provider", "hire", transactionHash);
    assertEventAddress(fundedProvider, createdProvider, "funded provider", transactionHash);
    if (expectation?.providerAddress !== undefined) assertEventAddress(createdProvider, expectation.providerAddress, "provider", transactionHash);
    assertEventAddress(eventAddress(created.args, "evaluator", "hire", transactionHash), this.routerContract, "evaluator", transactionHash);
    assertEventAddress(eventAddress(created.args, "hook", "hire", transactionHash), this.routerContract, "hook", transactionHash);
    if (expectation?.amountAtomic !== undefined) assertEventBigInt(eventBigInt(funded.args, "amount", "hire", transactionHash), BigInt(expectation.amountAtomic), "funding amount", transactionHash);
    if (client !== null) assertEventAddress(eventAddress(funded.args, "client", "hire", transactionHash), client, "funded client", transactionHash);
  }

  private assertHireState(job: Erc8183OnchainJob, expectation: Erc8183OperationExpectation | null | undefined, transactionHash: Hex): void {
    if (!acceptsState(job.status, "FUNDED")) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled hire job has not reached FUNDED or a later valid state.", transactionHash, nextAction: "manual_review" });
    if (expectation?.providerAddress !== undefined) assertEventAddress(job.provider, expectation.providerAddress, "job provider", transactionHash);
    if (expectation?.amountAtomic !== undefined && job.budgetAtomic !== expectation.amountAtomic) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled hire budget does not match the operation expectation.", transactionHash, nextAction: "manual_review" });
  }

  private assertSubmitReceipt(receipt: Erc8183RpcReceipt, jobId: string, provider: Address, digest: Hex): void {
    const event = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobSubmitted", this.pin.commerceContract as Address, "submit");
    this.assertSubmitEvent(event, jobId, provider, digest, receipt.transactionHash);
  }

  private assertSubmitEvent(event: DecodedReceiptEvent, jobId: string, provider: Address | null, digest: Hex | undefined, transactionHash: Hex): void {
    assertEventBigInt(eventBigInt(event.args, "jobId", "submit", transactionHash), BigInt(jobId), "submitted job ID", transactionHash);
    if (provider !== null) assertEventAddress(eventAddress(event.args, "provider", "submit", transactionHash), provider, "provider", transactionHash);
    if (digest !== undefined && eventHash(event.args, "deliverable", "submit", transactionHash).toLowerCase() !== digest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The submitted deliverable event does not match the committed Keccak digest.", transactionHash, nextAction: "reconcile_transaction" });
  }

  private assertSettleReceipt(receipt: Erc8183RpcReceipt, jobId: string, action: "approve" | "dispute", client: Address, job: Erc8183OnchainJob): void {
    if (action === "approve") {
      const settled = requireReceiptEvent(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobSettled", this.routerContract, "settle");
      const finalised = requireReceiptEvent(receipt, ERC8183_ROUTER_EVENTS_ABI, "JobFinalised", this.routerContract, "settle");
      const completed = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobCompleted", this.pin.commerceContract as Address, "settle");
      assertEventBigInt(eventBigInt(settled.args, "jobId", "settle", receipt.transactionHash), BigInt(jobId), "settled job ID", receipt.transactionHash);
      assertEventAddress(eventAddress(settled.args, "policy", "settle", receipt.transactionHash), this.policyContract, "settlement policy", receipt.transactionHash);
      if (eventBigInt(settled.args, "verdict", "settle", receipt.transactionHash) !== 1n) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The settlement receipt did not contain an approval verdict.", transactionHash: receipt.transactionHash, nextAction: "reconcile_transaction" });
      assertEventBigInt(eventBigInt(finalised.args, "jobId", "settle", receipt.transactionHash), BigInt(jobId), "finalised job ID", receipt.transactionHash);
      if (eventBigInt(finalised.args, "status", "settle", receipt.transactionHash) !== 3n) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The settlement receipt did not finalise the job as completed.", transactionHash: receipt.transactionHash, nextAction: "reconcile_transaction" });
      assertEventBigInt(eventBigInt(completed.args, "jobId", "settle", receipt.transactionHash), BigInt(jobId), "completed job ID", receipt.transactionHash);
      assertEventAddress(eventAddress(completed.args, "evaluator", "settle", receipt.transactionHash), job.evaluator, "completion evaluator", receipt.transactionHash);
    } else {
      const disputed = requireReceiptEvent(receipt, ERC8183_POLICY_EVENTS_ABI, "Disputed", this.policyContract, "dispute");
      assertEventBigInt(eventBigInt(disputed.args, "jobId", "dispute", receipt.transactionHash), BigInt(jobId), "dispute job ID", receipt.transactionHash);
      assertEventAddress(eventAddress(disputed.args, "client", "dispute", receipt.transactionHash), client, "dispute client", receipt.transactionHash);
    }
  }

  private assertRefundReceipt(receipt: Erc8183RpcReceipt, jobId: string, client: Address, job: Erc8183OnchainJob): void {
    const refunded = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "Refunded", this.pin.commerceContract as Address, "claim refund");
    const expired = requireReceiptEvent(receipt, ERC8183_COMMERCE_EVENTS_ABI, "JobExpired", this.pin.commerceContract as Address, "claim refund");
    assertEventBigInt(eventBigInt(refunded.args, "jobId", "claim refund", receipt.transactionHash), BigInt(jobId), "refund job ID", receipt.transactionHash);
    assertEventAddress(eventAddress(refunded.args, "client", "claim refund", receipt.transactionHash), client, "refund client", receipt.transactionHash);
    assertEventBigInt(eventBigInt(refunded.args, "amount", "claim refund", receipt.transactionHash), BigInt(job.budgetAtomic), "refund amount", receipt.transactionHash);
    assertEventBigInt(eventBigInt(expired.args, "jobId", "claim refund", receipt.transactionHash), BigInt(jobId), "expired job ID", receipt.transactionHash);
  }

  private assertHiredJob(job: Erc8183OnchainJob, client: Address, provider: Address, budget: bigint, expiredAtUnix: number): void {
    if (!acceptsState(job.status, "FUNDED") || job.client.toLowerCase() !== client.toLowerCase() || job.provider.toLowerCase() !== provider.toLowerCase() || job.evaluator.toLowerCase() !== this.routerContract.toLowerCase() || job.hook.toLowerCase() !== this.routerContract.toLowerCase() || job.budgetAtomic !== budget.toString(10) || job.expiredAtUnix !== expiredAtUnix) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed hire did not match the requested client, provider, evaluator, hook, budget, expiry, and valid funded-or-later state.", nextAction: "reconcile_transaction" });
  }
}

function utf8ByteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}|./giu, "x").length;
}

function assertDecimalJobId(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 job ID must be a decimal integer." });
  return value;
}

function createReceiptReader(network: NetworkConfig): Erc8183ReceiptReader {
  const client = createPublicClient({ chain: network.chain, transport: http(network.publicRpcUrl) });
  return {
    async getTransactionReceipt({ hash }) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        return {
          status: receipt.status === "success" ? "success" : "reverted",
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          transactionHash: receipt.transactionHash,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics,
            data: log.data,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            transactionHash: log.transactionHash,
            logIndex: log.logIndex === null ? undefined : log.logIndex
          })) as readonly Erc8183RpcLog[]
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message.toLowerCase() : "";
        if (message.includes("could not be found") || message.includes("not found")) return null;
        throw cause;
      }
    }
  };
}

function createTransactionReader(network: NetworkConfig): Erc8183TransactionReader {
  const client = createPublicClient({ chain: network.chain, transport: http(network.publicRpcUrl) });
  return {
    async getTransaction({ hash }) {
      try {
        const transaction = await client.getTransaction({ hash });
        return {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          input: transaction.input,
          value: transaction.value
        };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message.toLowerCase() : "";
        if (/not found|unknown transaction|does not exist|transaction hash/i.test(message)) return null;
        throw cause;
      }
    }
  };
}

/** Compatibility export for callers that used the old name; it has no direct writer. */
export const Erc8183ChainAdapter = Erc8183AltanaAdapter;
