import {
  BNB_TESTNET,
  buildClaimRefundCall,
  erc8183Addresses,
  getErc8183Job,
  hireErc8183Agent,
  settleErc8183Job,
  submitErc8183Deliverable,
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
import { createPublicClient, decodeEventLog, http, type Address, type Hex } from "viem";
import { CommerceError } from "./errors.js";
import { assertPublicPayloadSafe, normalizeAddress, parseAtomic, parseEnabledDeploymentPin } from "./validation.js";
import type { EnabledErc8183DeploymentPin } from "./types.js";
import type { Erc8183ProviderResult, Erc8183ProviderTask } from "./provider.js";
import { assertProviderResultMatchesTask } from "./provider.js";
import type { Erc8183OperationKind, Erc8183OperationExpectation, Erc8183RpcLog, Erc8183RpcReceipt } from "./operations.js";

export type Erc8183AltanaAuthority =
  | { readonly wallet: Wallet; readonly signer: Signer }
  | { readonly session: Session };

export interface Erc8183ReceiptReader {
  getTransactionReceipt(input: { readonly hash: Hex }): Promise<Erc8183RpcReceipt | null>;
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

/** Read-only event fragment used to recover a created job after a restart. */
const JOB_CREATED_EVENT_ABI = [{
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
}] as const;

function sdkCallError(action: string, cause: unknown): CommerceError {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  const providerFailure = /network|rpc|relay|wallet|sign|provider|address|chain|status|job/.test(message);
  return new CommerceError({
    code: providerFailure ? "CHAIN_PROVIDER_INVALID" : "TRANSACTION_UNKNOWN",
    message: providerFailure ? `Altana SDK ${action} could not be completed by the configured provider.` : `Altana SDK ${action} returned an unknown outcome; reconcile before retrying.`,
    retriable: false,
    nextAction: "reconcile_transaction",
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
    throw new CommerceError({ code: "TRANSACTION_REVERTED", message: `Altana SDK ${action} was rejected before confirmation.`, nextAction: "inspect_transaction" });
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

function recoverCreatedJobId(receipt: Erc8183RpcReceipt, commerceContract: Address): string | null {
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== commerceContract.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: JOB_CREATED_EVENT_ABI, data: log.data, topics: log.topics, strict: false } as never) as unknown as { readonly eventName?: string; readonly args?: unknown };
      if (decoded.eventName !== "JobCreated" || typeof decoded.args !== "object" || decoded.args === null || Array.isArray(decoded.args)) continue;
      const value = (decoded.args as Record<string, unknown>).jobId;
      if (typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string") continue;
      const jobId = BigInt(value);
      if (jobId < 0n) continue;
      return jobId.toString(10);
    } catch {
      // Ignore unrelated or malformed logs; the receipt is rejected below if
      // no canonical JobCreated event can recover the protocol identity.
    }
  }
  return null;
}

function authorityAddress(authority: Erc8183AltanaAuthority): Address {
  return normalizeAddress("session" in authority ? authority.session.walletAddress : authority.wallet.address, "signer address") as Address;
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

  public constructor(options: Erc8183AltanaAdapterOptions) {
    this.pin = assertSdkDeploymentMatchesPin(options.pin);
    this.network = options.network ?? BNB_TESTNET;
    if (this.network.chainId !== this.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "Altana SDK network does not match the pinned chain." });
    const addresses = erc8183Addresses(this.pin.chainId);
    this.routerContract = addresses.router;
    this.policyContract = addresses.policy;
    this.paymentToken = addresses.paymentToken;
    const client = createClient({ chains: [this.network], defaultChainId: this.network.chainId });
    const defaultExecute: Erc8183SdkExecute = async (authority, calls, opts) => "session" in authority
      ? client.execute({ session: authority.session, calls, chainId: opts.network.chainId, ...(opts.noWait === undefined ? {} : { noWait: opts.noWait }), ...(opts.feeToken === undefined ? {} : { feeToken: opts.feeToken }) })
      : client.execute({ wallet: authority.wallet, signer: authority.signer, calls, chainId: opts.network.chainId, ...(opts.noWait === undefined ? {} : { noWait: opts.noWait }), ...(opts.feeToken === undefined ? {} : { feeToken: opts.feeToken }) });
    this.sdk = { ...SDK_DEFAULTS, execute: defaultExecute, ...(options.sdk ?? {}) };
    this.receiptReader = options.receiptReader ?? createReceiptReader(this.network);
  }

  public async verifyNetwork(): Promise<Erc8183NetworkEvidence> {
    if (this.network.chainId !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "Only BSC testnet is enabled for the T4 paid-hire canary." });
    return {
      chainId: 97,
      commerceContract: this.pin.commerceContract as Address,
      routerContract: this.routerContract,
      policyContract: this.policyContract,
      paymentToken: this.paymentToken,
      sdkAddressesMatch: true
    };
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

  public async hire(authority: Erc8183AltanaAuthority, input: Erc8183HireInput): Promise<Erc8183HireResult> {
    const provider = normalizeAddress(input.providerAddress, "provider address") as Address;
    const budget = parseAtomic(input.budgetAtomic, "Job budget");
    if (budget > 10_000_000_000_000_000n) throw new CommerceError({ code: "INVALID_AMOUNT", message: "Job budget exceeds the reviewed MVP cap of 0.01 U.", nextAction: "verify_standards_lock" });
    assertPublicPayloadSafe(input.task, "hire.task");
    if (utf8ByteLength(input.task) > 4096) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 task description exceeds the protocol limit." });
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof hireErc8183Agent>>;
    try { raw = await invokeHire(this.sdk.hire, authority, { provider, task: input.task, budget, ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds }) }, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("hire", cause); }
    const execution = sdkExecution(raw);
    const jobId = raw.jobId.toString(10);
    const expiredAtUnix = asUnix(raw.expiredAt, "job expiry");
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, budgetAtomic: budget.toString(10), expiredAtUnix, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "hire");
    const receipt = assertReceipt(await this.requireReceipt(transactionHash, "hire"), transactionHash, "hire");
    const job = await this.readJob(jobId);
    this.assertHiredJob(job, authorityAddress(authority), provider, budget, expiredAtUnix);
    return { ...execution, transactionHash, jobId, budgetAtomic: budget.toString(10), expiredAtUnix, job, receipt };
  }

  public async submit(input: Erc8183SubmitInput): Promise<Erc8183SubmitResult> {
    const jobId = assertDecimalJobId(input.jobId);
    if (!/^[0-9a-f]{64}$/iu.test(input.resultDigest)) throw new CommerceError({ code: "INVALID_JOB", message: "The local result digest must be a 32-byte SHA-256 digest." });
    if (input.task !== undefined && input.result !== undefined) assertProviderResultMatchesTask(input.task, input.result);
    if (input.deliverableUrl !== undefined && input.result?.deliverableUrl !== undefined && input.result.deliverableUrl !== null && input.deliverableUrl !== input.result.deliverableUrl) throw new CommerceError({ code: "INVALID_JOB", message: "The submitted deliverable URL does not match the provider result." });
    const deliverableUrl = input.deliverableUrl ?? input.result?.deliverableUrl ?? "";
    const requestedChainDeliverable = (input.chainDeliverable ?? input.result?.chainDeliverable ?? null) as Hex | null;
    const sdkParams: SubmitDeliverableParams = input.manifest !== undefined
      ? { jobId: BigInt(jobId), manifest: input.manifest, deliverableUrl }
      : { jobId: BigInt(jobId), deliverable: requestedChainDeliverable ?? "0x", ...(input.optParams === undefined ? {} : { optParams: input.optParams }) };
    if ("deliverable" in sdkParams && !/^0x[0-9a-f]{64}$/iu.test(sdkParams.deliverable)) throw new CommerceError({ code: "INVALID_JOB", message: "An APEX deliverable must be a 32-byte Keccak hash." });
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof submitErc8183Deliverable>>;
    try { raw = await invokeSubmit(this.sdk.submit, input.authority, sdkParams, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("submit", cause); }
    const execution = sdkExecution(raw);
    const chainDeliverable = asHash(raw.deliverable, "chain deliverable");
    if (requestedChainDeliverable !== null && requestedChainDeliverable.toLowerCase() !== chainDeliverable.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The SDK returned a chain deliverable different from the requested provider result.", nextAction: "reconcile_transaction" });
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable, job: null, receipt: null, ...(raw.manifestText === undefined ? {} : { manifestText: raw.manifestText }) };
    const transactionHash = assertConfirmedHash(execution, "submit");
    const receipt = assertReceipt(await this.requireReceipt(transactionHash, "submit"), transactionHash, "submit");
    const job = await this.readJob(jobId);
    if (job.status !== "SUBMITTED" || job.chainDeliverable.toLowerCase() !== chainDeliverable.toLowerCase() || job.provider.toLowerCase() !== authorityAddress(input.authority).toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed submit did not produce the requested provider, deliverable, and SUBMITTED state.", transactionHash, nextAction: "reconcile_transaction" });
    return { ...execution, transactionHash, jobId, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable, job, receipt, ...(raw.manifestText === undefined ? {} : { manifestText: raw.manifestText }) };
  }

  public async settle(authority: Erc8183AltanaAuthority, input: { readonly jobId: string; readonly action?: "approve" | "dispute"; readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address } }): Promise<Erc8183SettleResult> {
    const jobId = assertDecimalJobId(input.jobId);
    const action = input.action ?? "approve";
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<typeof settleErc8183Job>>;
    try { raw = await invokeSettle(this.sdk.settle, authority, { jobId: BigInt(jobId), action }, options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("settle", cause); }
    const execution = sdkExecution(raw);
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, action, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "settle");
    const receipt = assertReceipt(await this.requireReceipt(transactionHash, "settle"), transactionHash, "settle");
    const job = await this.readJob(jobId);
    if (action === "approve" && job.status !== "COMPLETED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed approval did not produce COMPLETED protocol state.", transactionHash, nextAction: "reconcile_transaction" });
    return { ...execution, transactionHash, jobId, action, job, receipt };
  }

  public async claimRefund(authority: Erc8183AltanaAuthority, input: { readonly jobId: string; readonly executeOptions?: { readonly noWait?: boolean; readonly feeToken?: Address } }): Promise<Erc8183ClaimRefundResult> {
    const jobId = assertDecimalJobId(input.jobId);
    const options = { network: this.network, ...(input.executeOptions ?? {}) };
    let raw: Awaited<ReturnType<Erc8183SdkExecute>>;
    try { raw = await invokeExecute(this.sdk.execute, authority, buildClaimRefundCall(this.pin.chainId, BigInt(jobId)), options); } catch (cause) { if (cause instanceof CommerceError) throw cause; throw sdkCallError("claim refund", cause); }
    const execution = sdkExecution(raw);
    if (execution.status !== "CONFIRMED") return { ...execution, jobId, job: null, receipt: null };
    const transactionHash = assertConfirmedHash(execution, "claim refund");
    const receipt = assertReceipt(await this.requireReceipt(transactionHash, "claim refund"), transactionHash, "claim refund");
    const job = await this.readJob(jobId);
    if (job.status !== "EXPIRED") throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed refund did not produce EXPIRED protocol state.", transactionHash, nextAction: "reconcile_transaction" });
    return { ...execution, transactionHash, jobId, job, receipt };
  }

  /** Verify a previously persisted transaction without submitting anything. */
  public async verifyReceiptForOperation(input: { readonly transactionHash: Hex; readonly kind: Erc8183OperationKind; readonly jobId: string | null; readonly expectation?: Erc8183OperationExpectation | null }): Promise<{ readonly receipt: Erc8183RpcReceipt; readonly job: Erc8183OnchainJob | null }> {
    const receipt = assertReceipt(await this.requireReceipt(input.transactionHash, "reconciliation"), input.transactionHash, "reconciliation");
    const recoveredJobId = input.jobId ?? (input.kind === "create" ? recoverCreatedJobId(receipt, this.pin.commerceContract as Address) : null);
    if (input.kind === "create" && recoveredJobId === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed hire receipt has no recoverable JobCreated identity.", transactionHash: input.transactionHash, nextAction: "manual_review" });
    const job = recoveredJobId === null ? null : await this.readJob(recoveredJobId);
    if (job !== null && input.expectation !== undefined && input.expectation !== null) {
      if (input.expectation.providerAddress !== undefined && job.provider.toLowerCase() !== input.expectation.providerAddress.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Reconciled provider does not match the operation expectation.", transactionHash: input.transactionHash });
      if (input.expectation.amountAtomic !== undefined && job.budgetAtomic !== input.expectation.amountAtomic) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Reconciled budget does not match the operation expectation.", transactionHash: input.transactionHash });
      if (input.expectation.expectedState !== undefined && job.status !== input.expectation.expectedState) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "Reconciled job state does not match the operation expectation.", transactionHash: input.transactionHash });
    }
    return { receipt, job };
  }

  private async requireReceipt(hash: Hex, action: string): Promise<Erc8183RpcReceipt> {
    const receipt = await this.getTransactionReceipt(hash);
    if (receipt === null) throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: `The ${action} transaction has no receipt yet; do not resend.`, transactionHash: hash, nextAction: "reconcile_transaction" });
    return receipt;
  }

  private assertHiredJob(job: Erc8183OnchainJob, client: Address, provider: Address, budget: bigint, expiredAtUnix: number): void {
    if (job.status !== "FUNDED" || job.client.toLowerCase() !== client.toLowerCase() || job.provider.toLowerCase() !== provider.toLowerCase() || job.evaluator.toLowerCase() !== this.routerContract.toLowerCase() || job.hook.toLowerCase() !== this.routerContract.toLowerCase() || job.budgetAtomic !== budget.toString(10) || job.expiredAtUnix !== expiredAtUnix) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed hire did not match the requested client, provider, evaluator, hook, budget, expiry, and FUNDED state.", nextAction: "reconcile_transaction" });
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

/** Compatibility export for callers that used the old name; it has no direct writer. */
export const Erc8183ChainAdapter = Erc8183AltanaAdapter;
