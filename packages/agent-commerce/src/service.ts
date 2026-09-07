import { CommerceError } from "./errors.js";
import {
  Erc8183AltanaAdapter,
  type Erc8183AltanaAuthority,
  type Erc8183ClaimRefundResult,
  type Erc8183HireInput,
  type Erc8183HireResult,
  type Erc8183SettleResult,
  type Erc8183SubmitInput,
  type Erc8183SubmitResult
} from "./chain.js";
import { buildErc8183EoaCall, type Erc8183EoaStep } from "./eoa.js";
import { createErc8183JobEvent } from "./events.js";
import { canonicalSha256Hex } from "@bnbera/domain";
import {
  PostgresErc8183OperationRepository,
  type Erc8183OperationRecord,
  type Erc8183OperationExpectation,
  type Erc8183PreparedOperation,
  type Erc8183OperationKind,
  type Erc8183ChainRole,
  type Erc8183ConfirmedOperation,
  type Erc8183RpcReceipt
} from "./operations.js";
import { assertBudgetMatchesPin, normalizeAddress } from "./validation.js";
import {
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  erc8183ProviderBindingSchema,
  type Erc8183JobRecord,
  type Erc8183JobState,
  type Erc8183ProviderBinding
} from "./types.js";
import type { PersistentErc8183JobCreateInput, PersistentErc8183JobTransitionInput } from "./postgres-jobs.js";
import { encodeErc8183Manifest, erc8183ManifestHash } from "@altananetwork/sdk";
import { erc8183ProviderResultSchema } from "./provider.js";

export interface Erc8183BuyerApprovalReader {
  assertBuyerApproval(input: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<void>;
}

export interface Erc8183BuyerApprovalStore extends Erc8183BuyerApprovalReader {
  approveResult(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }; readonly actorAddress: string; readonly resultDigest: string; readonly nowUnix: number }): Promise<{ readonly job: unknown; readonly replayed: boolean }>;
}

/** Durable canonical ERC-8183 projection. Kept structural so restart tests can
 * use an in-memory implementation while production uses the PostgreSQL
 * repository without adding another persistence system. */
export interface Erc8183CanonicalJobStore {
  get(jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<Erc8183JobRecord | null>;
  create(input: PersistentErc8183JobCreateInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }>;
  transition(input: PersistentErc8183JobTransitionInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }>;
  /** Optional restart repair for canonical expiry rows written before parent projection was added. */
  repairExpiredMarketplaceProjection?(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string } }): Promise<{ readonly repaired: boolean }>;
}

type AdapterExecution = {
  readonly callsId: `0x${string}`;
  readonly status: "PENDING" | "CONFIRMED" | "FAILED";
  readonly statusCode?: number;
  readonly transactionHash: `0x${string}` | null;
  readonly jobId: string;
  readonly receipt: Erc8183RpcReceipt | null;
  readonly job: unknown;
};

export interface Erc8183OperationCoordinatorResult<T = AdapterExecution | null> {
  readonly operation: Erc8183OperationRecord;
  readonly result: T;
  readonly replayed: boolean;
}

function authorityAddress(authority: Erc8183AltanaAuthority): `0x${string}` {
  return normalizeAddress(("session" in authority ? authority.session.walletAddress : authority.wallet.address), "signer address");
}

function assertAuthenticatedRequester(requesterAddress: string | undefined, authority: Erc8183AltanaAuthority): `0x${string}` {
  const execution = authorityAddress(authority);
  if (requesterAddress !== undefined && normalizeAddress(requesterAddress, "authenticated requester") !== execution) {
    throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the execution wallet.", nextAction: "authenticate_actor" });
  }
  return execution;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1_000);
}

function contextValue(parameters: Readonly<Record<string, unknown>> | undefined, key: string): unknown {
  return parameters === undefined ? undefined : parameters[key];
}

function operationContext(input: {
  readonly signerAddress: string;
  readonly action: "hire" | "submit" | "settle" | "dispute" | "claim_refund";
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expectation?: Erc8183OperationExpectation | null;
}): NonNullable<Erc8183PreparedOperation["context"]> {
  return {
    signerAddress: normalizeAddress(input.signerAddress, "signer address"),
    sdkAction: input.action,
    parameters: input.parameters,
    expectation: input.expectation ?? null
  };
}

function preparedOperation(input: {
  readonly kind: Erc8183OperationKind;
  readonly signerRole: Erc8183ChainRole;
  readonly chainId: 56 | 97;
  readonly commerceContract: `0x${string}`;
  readonly jobId: string | null;
  readonly requestDigest: string;
  readonly context: NonNullable<Erc8183PreparedOperation["context"]>;
  readonly expectation?: Erc8183OperationExpectation | null;
}): Erc8183PreparedOperation {
  return {
    kind: input.kind,
    signerRole: input.signerRole,
    chainId: input.chainId,
    commerceContract: input.commerceContract,
    jobId: input.jobId,
    requestDigest: input.requestDigest,
    expectation: input.expectation ?? null,
    value: 0n,
    context: input.context
  };
}

/**
 * Coordinates the Altana SDK boundary with the durable operation row. It
 * reserves idempotency before invoking the SDK, records calls/transaction IDs,
 * and never retries an unknown outcome.
 */
export class Erc8183OperationCoordinator {
  public constructor(
    private readonly adapter: Erc8183AltanaAdapter,
    private readonly operations: PostgresErc8183OperationRepository,
    private readonly approvals?: Erc8183BuyerApprovalReader,
    private readonly jobs?: Erc8183CanonicalJobStore
  ) {}

  public async executeSdk<T extends AdapterExecution>(input: {
    readonly operation: Erc8183PreparedOperation;
    readonly idempotencyKey: string;
    readonly authority: Erc8183AltanaAuthority;
    readonly run: () => Promise<T>;
  }): Promise<Erc8183OperationCoordinatorResult<T>> {
    if (input.operation.context !== undefined && authorityAddress(input.authority) !== input.operation.context.signerAddress) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated execution wallet does not match the actor persisted for this operation.", nextAction: "authenticate_actor" });
    if (input.operation.kind === "settle" && input.operation.context?.sdkAction !== "dispute") {
      if (input.operation.jobId === null || this.approvals === undefined) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "Settlement is disabled until persisted buyer approval is available.", nextAction: "approve_result" });
      await this.approvals.assertBuyerApproval({ chainId: input.operation.chainId, commerceContract: this.adapter.pin.commerceContract, jobId: input.operation.jobId });
    }
    const reservation = await this.operations.reserve({
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.operation.requestDigest,
      chainId: input.operation.chainId,
      commerceContract: input.operation.commerceContract,
      jobId: input.operation.jobId,
      kind: input.operation.kind,
      signerRole: input.operation.signerRole,
      context: input.operation.context ?? null
    });
    if (reservation.replayed) {
      if (["confirmed", "reverted", "reconciled"].includes(reservation.operation.status)) return { operation: reservation.operation, result: null as unknown as T, replayed: true };
      throw new CommerceError({
        code: "TRANSACTION_UNKNOWN",
        message: "This idempotency key already has an unresolved chain operation; reconcile it before retrying.",
        retriable: false,
        nextAction: "reconcile_transaction",
        ...(reservation.operation.transactionHash === null ? {} : { transactionHash: reservation.operation.transactionHash }),
        ...(reservation.operation.context?.callsId === undefined || reservation.operation.context.callsId === null ? {} : { relayCallsId: reservation.operation.context.callsId })
      });
    }
    try {
      const result = await input.run();
      await this.operations.attachCallsId({ operationId: reservation.operation.operationId, callsId: result.callsId });
      if (result.status !== "CONFIRMED" || result.transactionHash === null || result.receipt === null) {
        if (result.transactionHash !== null) await this.operations.markSubmitted({ operationId: reservation.operation.operationId, transactionHash: result.transactionHash });
        await this.operations.markUnknown({ operationId: reservation.operation.operationId, failureCode: result.status === "PENDING" ? "RELAY_PENDING" : "CONFIRMATION_HASH_MISSING" });
        throw new CommerceError({ code: "TRANSACTION_UNKNOWN", message: "The Altana operation is not durably confirmed; do not resend before reconciliation.", nextAction: "reconcile_transaction", ...(result.transactionHash === null ? {} : { transactionHash: result.transactionHash }), relayCallsId: result.callsId });
      }
      await this.operations.markSubmitted({ operationId: reservation.operation.operationId, transactionHash: result.transactionHash });
      const receipt = result.receipt;
      const updated = await this.operations.markReceipt({ operationId: reservation.operation.operationId, status: receipt.status === "success" ? "confirmed" : "reverted", transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(10), blockHash: receipt.blockHash, failureCode: receipt.status === "success" ? null : "TRANSACTION_REVERTED" });
      if (result.jobId !== "" && input.operation.jobId === null) await this.operations.attachJobId({ operationId: reservation.operation.operationId, jobId: result.jobId });
      const operation = await this.operations.get(reservation.operation.operationId);
      if (operation === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed operation record could not be reloaded; reconcile before retrying.", transactionHash: result.transactionHash, nextAction: "reconcile_transaction" });
      await this.persistCanonicalConfirmation(operation, result);
      return { operation: operation ?? updated, result, replayed: false };
    } catch (cause) {
      await this.recordFailure(reservation.operation.operationId, cause);
      throw cause;
    }
  }

  /**
   * Reserve a browser-owned SDK intent without executing it on the server.
   * The browser must claim the returned unsigned step immediately before
   * signing; unknown and submitted rows are deliberately never replayed.
   */
  public async reserveExternal(input: {
    readonly operation: Erc8183PreparedOperation;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly operation: Erc8183OperationRecord;
    readonly replayed: boolean;
    readonly dispatchable: boolean;
  }> {
    if (input.operation.kind === "settle" && input.operation.context?.sdkAction !== "dispute") {
      if (input.operation.jobId === null || this.approvals === undefined) {
        throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "Settlement is disabled until persisted buyer approval is available.", nextAction: "approve_result" });
      }
      await this.approvals.assertBuyerApproval({
        chainId: input.operation.chainId,
        commerceContract: this.adapter.pin.commerceContract,
        jobId: input.operation.jobId
      });
    }
    const reservation = await this.operations.reserve({
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.operation.requestDigest,
      chainId: input.operation.chainId,
      commerceContract: input.operation.commerceContract,
      jobId: input.operation.jobId,
      kind: input.operation.kind,
      signerRole: input.operation.signerRole,
      context: input.operation.context ?? null
    });
    return {
      operation: reservation.operation,
      replayed: reservation.replayed,
      dispatchable: !reservation.replayed && reservation.operation.status === "awaiting_signature" && reservation.operation.context?.dispatchClaimed !== true
    };
  }

  /**
   * Attach only public SDK relay evidence reported by the browser. This does
   * not accept a signer/session/authority object and never submits a call.
   * A pending report becomes unknown, while a later transaction hash may be
   * attached to that same operation for bounded receipt recovery.
   */
  public async attachExternalExecution(input: {
    readonly operationId: string;
    readonly callsId: string;
    readonly transactionHash?: string | undefined;
  }): Promise<Erc8183OperationCoordinatorResult<Erc8183ConfirmedOperation | null>> {
    const current = await this.operations.get(input.operationId);
    if (current === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (["confirmed", "reverted", "reconciled"].includes(current.status)) {
      return { operation: current, result: null, replayed: true };
    }

    await this.operations.attachCallsId({ operationId: input.operationId, callsId: input.callsId });
    if (input.transactionHash === undefined) {
      const latest = await this.operations.get(input.operationId);
      if (latest === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The commerce operation disappeared during evidence attachment." });
      if (latest.status === "awaiting_signature" || latest.status === "submitted") {
        await this.operations.markUnknown({ operationId: input.operationId, failureCode: "BROWSER_RELAY_PENDING" });
      }
      try {
        return await this.reconcile(input.operationId);
      } catch (cause) {
        if (!(cause instanceof CommerceError) || cause.code !== "TRANSACTION_UNKNOWN") throw cause;
      }
      const operation = await this.operations.get(input.operationId);
      if (operation === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The commerce operation disappeared during pending-state recording." });
      return { operation, result: null, replayed: false };
    }

    await this.operations.markSubmitted({ operationId: input.operationId, transactionHash: input.transactionHash });
    try {
      return await this.reconcile(input.operationId);
    } catch (cause) {
      if (cause instanceof CommerceError && cause.code === "TRANSACTION_UNKNOWN") {
        const latest = await this.operations.get(input.operationId);
        if (latest !== null && (latest.status === "submitted" || latest.status === "awaiting_signature")) {
          await this.operations.markUnknown({ operationId: input.operationId, failureCode: "RECEIPT_PENDING" });
        }
        const operation = await this.operations.get(input.operationId);
        if (operation === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The commerce operation disappeared during receipt recovery." });
        return { operation, result: null, replayed: false };
      }
      throw cause;
    }
  }

  /** Backward-compatible generic entry point for SDK-backed callers. */
  public async execute<T extends AdapterExecution>(input: {
    readonly operation: Erc8183PreparedOperation;
    readonly idempotencyKey: string;
    readonly account: string;
    readonly run: (authority: Erc8183AltanaAuthority) => Promise<T>;
  }): Promise<Erc8183OperationCoordinatorResult<T>> {
    const address = normalizeAddress(input.account, "signer address");
    const authority: Erc8183AltanaAuthority = { wallet: { address }, signer: { type: "privateKey", address, publicKey: "0x04" as `0x${string}`, signDigest: async () => { throw new CommerceError({ code: "COMMERCE_DISABLED", message: "A signer must be provided by the Altana integration.", nextAction: "configure_altana_sdk" }); } } };
    return this.executeSdk({ ...input, authority, run: () => input.run(authority) });
  }

  public async reconcile(operationId: string): Promise<Erc8183OperationCoordinatorResult<Erc8183ConfirmedOperation | null>> {
    const existing = await this.operations.get(operationId);
    if (existing === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The requested commerce operation does not exist." });
    if (["reverted", "reconciled"].includes(existing.status)) return { operation: existing, result: null, replayed: true };
    if (existing.transactionHash === null) {
      const callsId = existing.context?.callsId;
      if (callsId !== undefined && callsId !== null) {
        const relay = await this.adapter.getCallsStatus(callsId);
        if (relay.status === "CONFIRMED" && relay.transactionHash !== null) {
          await this.operations.markSubmitted({ operationId, transactionHash: relay.transactionHash });
          return this.reconcile(operationId);
        }
        if (relay.status === "FAILED") {
          if (relay.transactionHash !== null) {
            await this.operations.markSubmitted({ operationId, transactionHash: relay.transactionHash });
            return this.reconcile(operationId);
          }
          const failed = await this.operations.markFailed({ operationId, failureCode: relay.statusCode === null ? "RELAY_FAILED" : `RELAY_FAILED_${relay.statusCode}` });
          return { operation: failed, result: null, replayed: false };
        }
        try { await this.operations.markUnknown({ operationId, failureCode: relay.statusCode === null ? "RELAY_PENDING" : `RELAY_PENDING_${relay.statusCode}` }); } catch { /* already unknown */ }
        const pending = await this.operations.get(operationId);
        if (pending === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The commerce operation disappeared during relay status recovery." });
        return { operation: pending, result: null, replayed: false };
      }
      try { await this.operations.markManualReview({ operationId, failureCode: "RECONCILIATION_CONTEXT_MISSING" }); } catch { /* preserve original action */ }
      throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The operation has no persisted transaction hash; manual review is required and no retry is safe.", nextAction: "manual_review" });
    }
    try {
      const checked = await this.adapter.verifyReceiptForOperation({
        transactionHash: existing.transactionHash,
        kind: existing.kind,
        jobId: existing.jobId,
        ...(existing.context?.signerAddress === undefined ? {} : { signerAddress: existing.context.signerAddress }),
        ...(existing.context?.sdkAction === "dispute" ? { action: "dispute" as const } : existing.context?.sdkAction === "settle" ? { action: "approve" as const } : {}),
        ...(existing.context?.expectation === undefined ? {} : { expectation: existing.context.expectation })
      });
      await this.operations.markReceipt({ operationId, status: "confirmed", transactionHash: checked.receipt.transactionHash, blockNumber: checked.receipt.blockNumber.toString(10), blockHash: checked.receipt.blockHash, failureCode: null });
      if (existing.jobId === null && checked.job !== null) await this.operations.attachJobId({ operationId, jobId: checked.job.id });
      // The canonical projection is repaired while the operation is still
      // unresolved. If the process crashes after this point, a later
      // reconciliation retries the idempotent projection instead of seeing a
      // terminal operation and returning early with a missing job/result.
      const afterReceipt = await this.operations.get(operationId);
      if (afterReceipt === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The reconciled operation could not be reloaded before canonical persistence.", transactionHash: checked.receipt.transactionHash, nextAction: "manual_review" });
      await this.persistCanonicalReconciliation(afterReceipt, checked.job, checked.receipt);
      const reconciled = await this.operations.reconcile({ operationId, status: "reconciled" });
      return { operation: reconciled, result: { operation: this.operationFromRecord(reconciled), transactionHash: checked.receipt.transactionHash, receipt: checked.receipt, jobId: checked.job?.id ?? reconciled.jobId }, replayed: false };
    } catch (cause) {
      // A missing receipt is an expected bounded recovery state, not proof of
      // a malformed receipt. Keep the operation unknown so a later browser or
      // reconciler report can attach the same transaction without a re-send.
      if (cause instanceof CommerceError && cause.code === "TRANSACTION_UNKNOWN") {
        try { await this.operations.markUnknown({ operationId, failureCode: "RECEIPT_PENDING" }); } catch { /* preserve original action */ }
        throw cause;
      }
      try { await this.operations.markManualReview({ operationId, failureCode: "RECEIPT_VALIDATION_FAILED" }); } catch { /* preserve original action */ }
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted receipt could not be validated; manual review is required.", transactionHash: existing.transactionHash, nextAction: "manual_review", cause });
    }
  }

  private operationFromRecord(record: Erc8183OperationRecord): Erc8183PreparedOperation {
    return {
      kind: record.kind,
      signerRole: record.signerRole,
      chainId: record.chainId,
      commerceContract: record.commerceContract,
      jobId: record.jobId,
      requestDigest: record.requestDigest,
      expectation: record.context?.expectation ?? null,
      value: BigInt(record.context?.valueAtomic ?? "0"),
      ...(record.context?.to === undefined ? {} : { to: record.context.to }),
      ...(record.context?.data === undefined ? {} : { data: record.context.data }),
      ...(record.context === null ? {} : { context: record.context })
    };
  }

  /** Persist the canonical protocol projection only after the operation row
   * has captured the SDK calls/transaction and receipt. A failed projection is
   * therefore recoverable by `reconcile`, and never causes a second chain send. */
  private async persistCanonicalConfirmation(operation: Erc8183OperationRecord, result: AdapterExecution): Promise<void> {
    if (this.jobs === undefined || result.job === null) return;
    const receipt = result.receipt;
    if (receipt === null || result.transactionHash === null) return;
    const job = result.job as Erc8183HireResult["job"];
    if (job === null) return;
    if (operation.kind === "create") {
      await this.persistCanonicalHire(operation, job, receipt);
    } else if (operation.kind === "submit") {
      const submit = result as unknown as Erc8183SubmitResult;
      await this.persistCanonicalSubmit(operation, job, receipt, submit);
    } else if (operation.kind === "settle" && operation.context?.sdkAction === "settle") {
      await this.persistCanonicalTerminal(operation, job, receipt, "completed", "job_completed", "completionTransactionHash");
    } else if (operation.kind === "claim_refund") {
      await this.persistCanonicalTerminal(operation, job, receipt, "expired", "job_expired", "refundTransactionHash");
    }
  }

  public async persistEoaFunding(operation: Erc8183OperationRecord, job: Erc8183HireResult["job"], receipt: Erc8183RpcReceipt): Promise<void> {
    if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A funded EOA operation has no readable protocol job.", nextAction: "manual_review" });
    await this.persistCanonicalHire(operation, job, receipt);
  }

  public async persistEoaTerminal(operation: Erc8183OperationRecord, job: Erc8183HireResult["job"], receipt: Erc8183RpcReceipt, state: "completed" | "expired"): Promise<void> {
    if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A terminal EOA operation has no readable protocol job.", nextAction: "manual_review" });
    if (state === "completed") await this.persistCanonicalTerminal(operation, job, receipt, "completed", "job_completed", "completionTransactionHash");
    else await this.persistCanonicalTerminal(operation, job, receipt, "expired", "job_expired", "refundTransactionHash");
  }

  private async persistCanonicalReconciliation(operation: Erc8183OperationRecord, job: Erc8183HireResult["job"] | null, receipt: Erc8183RpcReceipt): Promise<void> {
    if (this.jobs === undefined || job === null) return;
    if (operation.kind === "create") {
      await this.persistCanonicalHire(operation, job, receipt);
    } else if (operation.kind === "submit") {
      const manifest = contextValue(operation.context?.parameters, "manifest");
      await this.persistCanonicalSubmit(operation, job, receipt, {
        resultDigest: String(contextValue(operation.context?.parameters, "resultDigest") ?? ""),
        chainDeliverable: job.chainDeliverable,
        ...(manifest === undefined || manifest === null ? {} : { manifestText: encodeErc8183Manifest(manifest as Parameters<typeof encodeErc8183Manifest>[0]) })
      } as unknown as Erc8183SubmitResult);
    } else if (operation.kind === "settle" && operation.context?.sdkAction === "settle") {
      await this.persistCanonicalTerminal(operation, job, receipt, "completed", "job_completed", "completionTransactionHash");
    } else if (operation.kind === "claim_refund") {
      await this.persistCanonicalTerminal(operation, job, receipt, "expired", "job_expired", "refundTransactionHash");
    }
  }

  private async persistCanonicalHire(operation: Erc8183OperationRecord, onchain: NonNullable<Erc8183HireResult["job"]>, receipt: Erc8183RpcReceipt): Promise<void> {
    if (this.jobs === undefined) return;
    const parameters = operation.context?.parameters;
    const commerceJobId = contextValue(parameters, "commerceJobId");
    if (typeof commerceJobId !== "string" || commerceJobId.trim() === "") throw new CommerceError({ code: "INVALID_JOB", message: "A canonical ERC-8183 hire requires the owning commerce job ID before persistence.", nextAction: "configure_job_repository" });
    const descriptionDigest = contextValue(parameters, "taskDigest");
    const providerBinding = contextValue(parameters, "providerBinding");
    if (typeof descriptionDigest !== "string" || !/^[0-9a-f]{64}$/iu.test(descriptionDigest)) throw new CommerceError({ code: "INVALID_JOB", message: "The canonical hire is missing its task SHA-256 digest." });
    const binding = providerBinding === undefined || providerBinding === null ? null : erc8183ProviderBindingSchema.parse(providerBinding);
    const createdAt = Math.max(1, Math.floor(operation.createdAtUnix));
    // The hire operation proves creation and funding. If a provider races the
    // postcheck and advances the chain state, subsequent operation receipts
    // must still advance this canonical projection in order.
    const state: Erc8183JobState = "funded";
    const transactionHash = receipt.transactionHash;
    const canonical = erc8183JobRecordSchema.parse({
      jobKey: { chainId: this.adapter.pin.chainId, commerceContract: this.adapter.pin.commerceContract, jobId: onchain.id },
      terms: {
        chainId: this.adapter.pin.chainId,
        commerceContract: this.adapter.pin.commerceContract,
        paymentToken: this.adapter.pin.paymentToken,
        paymentDecimals: this.adapter.pin.paymentDecimals,
        clientAddress: onchain.client,
        providerAddress: onchain.provider,
        evaluatorAddress: onchain.evaluator,
        hookAddress: onchain.hook,
        budgetAtomic: onchain.budgetAtomic,
        descriptionDigest: descriptionDigest.toLowerCase(),
        expiresAtUnix: onchain.expiredAtUnix
      },
      deploymentPin: this.adapter.pin,
      deploymentPinDigest: erc8183DeploymentPinDigest(this.adapter.pin),
      state,
      createdAtUnix: createdAt,
      updatedAtUnix: Math.max(createdAt, nowUnix()),
      deliverableDigest: null,
      providerBinding: binding,
      buyerApproval: null,
      fundingTransactionHash: transactionHash,
      submissionTransactionHash: null,
      completionTransactionHash: null,
      rejectionTransactionHash: null,
      refundTransactionHash: null,
      lastObservedBlock: receipt.blockNumber.toString(10),
      lastObservedBlockHash: receipt.blockHash,
      lastObservedAtUnix: Math.max(createdAt, nowUnix())
    });
    const event = createErc8183JobEvent({
      eventKey: `operation:${operation.operationId}:hire`,
      jobKey: canonical.jobKey,
      eventType: "job_created",
      previousState: null,
      nextState: state,
      actorAddress: onchain.client,
      transactionHash,
      blockNumber: receipt.blockNumber.toString(10),
      blockHash: receipt.blockHash,
      payload: { operationId: operation.operationId, callsId: operation.context?.callsId ?? null, taskDigest: descriptionDigest.toLowerCase(), providerBinding: binding, budgetAtomic: onchain.budgetAtomic },
      correlationId: operation.operationId,
      observedAtUnix: Math.max(createdAt, nowUnix())
    });
    const existing = await this.jobs.get(canonical.jobKey);
    if (existing === null) {
      await this.jobs.create({ commerceJobId, job: canonical, event });
    } else if (existing.state === "open") {
      const fundedEvent = createErc8183JobEvent({
        eventKey: `operation:${operation.operationId}:hire-funded`,
        jobKey: canonical.jobKey,
        eventType: "job_funded",
        previousState: "open",
        nextState: "funded",
        actorAddress: onchain.client,
        transactionHash,
        blockNumber: receipt.blockNumber.toString(10),
        blockHash: receipt.blockHash,
        payload: { operationId: operation.operationId, callsId: operation.context?.callsId ?? null, taskDigest: descriptionDigest.toLowerCase(), providerBinding: binding, budgetAtomic: onchain.budgetAtomic },
        correlationId: operation.operationId,
        observedAtUnix: Math.max(existing.updatedAtUnix, nowUnix())
      });
      await this.jobs.transition({ job: { ...canonical, createdAtUnix: existing.createdAtUnix }, previousState: "open", event: fundedEvent });
    } else if (existing.terms.clientAddress.toLowerCase() !== canonical.terms.clientAddress.toLowerCase() || existing.terms.providerAddress?.toLowerCase() !== canonical.terms.providerAddress?.toLowerCase() || existing.terms.budgetAtomic !== canonical.terms.budgetAtomic) {
      throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The canonical ERC-8183 hire projection has conflicting terms." });
    } else if (existing.fundingTransactionHash === null) {
      const enriched = erc8183JobRecordSchema.parse({
        ...existing,
        fundingTransactionHash: transactionHash,
        lastObservedBlock: receipt.blockNumber.toString(10),
        lastObservedBlockHash: receipt.blockHash,
        lastObservedAtUnix: Math.max(existing.updatedAtUnix, nowUnix()),
        updatedAtUnix: Math.max(existing.updatedAtUnix, nowUnix())
      });
      const fundedEvent = createErc8183JobEvent({
        eventKey: `operation:${operation.operationId}:hire-funding-reconciled`,
        jobKey: enriched.jobKey,
        eventType: "reconciliation_succeeded",
        previousState: existing.state,
        nextState: existing.state,
        actorAddress: onchain.client,
        transactionHash,
        blockNumber: receipt.blockNumber.toString(10),
        blockHash: receipt.blockHash,
        payload: { operationId: operation.operationId, callsId: operation.context?.callsId ?? null, fundingTransactionHash: transactionHash },
        correlationId: operation.operationId,
        observedAtUnix: enriched.updatedAtUnix
      });
      await this.jobs.transition({ job: enriched, previousState: existing.state, event: fundedEvent });
    }
  }

  private async persistCanonicalSubmit(operation: Erc8183OperationRecord, onchain: NonNullable<Erc8183HireResult["job"]>, receipt: Erc8183RpcReceipt, submit: Pick<Erc8183SubmitResult, "resultDigest" | "chainDeliverable" | "manifestText">): Promise<void> {
    if (this.jobs === undefined) return;
    const current = await this.jobs.get({ chainId: this.adapter.pin.chainId, commerceContract: this.adapter.pin.commerceContract, jobId: onchain.id });
    if (current === null) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The submitted on-chain result has no canonical hired job projection.", nextAction: "reconcile_job" });
    const localResultDigest = submit.resultDigest.toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(localResultDigest)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The canonical submitted job is missing its local SHA-256 result digest." });
    const submittedDigest = submit.chainDeliverable.toLowerCase().replace(/^0x/u, "");
    if (!/^[0-9a-f]{64}$/u.test(submittedDigest)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The canonical submitted job is missing its Keccak deliverable digest." });
    if (current.state !== "funded") {
      if (current.state === "submitted" && current.deliverableDigest?.toLowerCase() === localResultDigest) return;
      throw new CommerceError({ code: "STALE_JOB", message: "The canonical job is not in FUNDED state for submission.", retriable: true, nextAction: "reconcile_job" });
    }
    const updatedAt = Math.max(current.updatedAtUnix, nowUnix());
    const next = erc8183JobRecordSchema.parse({
      ...current,
      state: "submitted",
      updatedAtUnix: updatedAt,
      // The legacy column is the buyer-facing local result identity. The
      // protocol Keccak is retained separately in the durable operation/event
      // JSON below and is the value verified against JobSubmitted.deliverable.
      deliverableDigest: localResultDigest,
      submissionTransactionHash: receipt.transactionHash,
      lastObservedBlock: receipt.blockNumber.toString(10),
      lastObservedBlockHash: receipt.blockHash,
      lastObservedAtUnix: updatedAt
    });
    const event = createErc8183JobEvent({
      eventKey: `operation:${operation.operationId}:submit`,
      jobKey: next.jobKey,
      eventType: "job_submitted",
      previousState: current.state,
      nextState: "submitted",
      actorAddress: onchain.provider,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(10),
      blockHash: receipt.blockHash,
      payload: {
        operationId: operation.operationId,
        callsId: operation.context?.callsId ?? null,
        resultDigest: submit.resultDigest.toLowerCase(),
        chainDeliverable: submit.chainDeliverable.toLowerCase(),
        ...(submit.manifestText === undefined ? {} : { manifestText: submit.manifestText }),
        ...(contextValue(operation.context?.parameters, "manifest") === undefined ? {} : { manifest: contextValue(operation.context?.parameters, "manifest") }),
        ...(contextValue(operation.context?.parameters, "result") === undefined ? {} : { result: contextValue(operation.context?.parameters, "result") }),
        ...(contextValue(operation.context?.parameters, "deliverableUrl") === undefined ? {} : { deliverableUrl: contextValue(operation.context?.parameters, "deliverableUrl") })
      },
      correlationId: operation.operationId,
      observedAtUnix: updatedAt
    });
    await this.jobs.transition({ job: next, previousState: current.state, event });
  }

  private async persistCanonicalTerminal(operation: Erc8183OperationRecord, onchain: NonNullable<Erc8183HireResult["job"]>, receipt: Erc8183RpcReceipt, state: "completed" | "expired", eventType: "job_completed" | "job_expired", txField: "completionTransactionHash" | "refundTransactionHash"): Promise<void> {
    if (this.jobs === undefined) return;
    const current = await this.jobs.get({ chainId: this.adapter.pin.chainId, commerceContract: this.adapter.pin.commerceContract, jobId: onchain.id });
    if (current === null) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The terminal on-chain result has no canonical hired job projection.", nextAction: "reconcile_job" });
    if (current.state === state) {
      if (state === "expired") {
        if (current.refundTransactionHash === null || current.refundTransactionHash.toLowerCase() !== receipt.transactionHash.toLowerCase()) {
          throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed refund does not match the canonical expired job evidence.", transactionHash: receipt.transactionHash, nextAction: "manual_review" });
        }
        const repair = this.jobs.repairExpiredMarketplaceProjection;
        if (repair !== undefined) {
          await repair.call(this.jobs, { jobKey: { chainId: this.adapter.pin.chainId, commerceContract: this.adapter.pin.commerceContract, jobId: onchain.id } });
        }
      }
      return;
    }
    if (state === "completed" && current.state !== "submitted") throw new CommerceError({ code: "STALE_JOB", message: "The canonical job is not SUBMITTED for settlement.", retriable: true, nextAction: "reconcile_job" });
    if (state === "expired" && current.state !== "funded" && current.state !== "submitted") throw new CommerceError({ code: "STALE_JOB", message: "The canonical job is not refundable from its persisted state.", retriable: true, nextAction: "reconcile_job" });
    const updatedAt = Math.max(current.updatedAtUnix, nowUnix());
    const next = erc8183JobRecordSchema.parse({ ...current, state, updatedAtUnix: updatedAt, [txField]: receipt.transactionHash, lastObservedBlock: receipt.blockNumber.toString(10), lastObservedBlockHash: receipt.blockHash, lastObservedAtUnix: updatedAt });
    const event = createErc8183JobEvent({ eventKey: `operation:${operation.operationId}:${state}`, jobKey: next.jobKey, eventType, previousState: current.state, nextState: state, actorAddress: operation.context?.signerAddress ?? onchain.client, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(10), blockHash: receipt.blockHash, payload: { operationId: operation.operationId, callsId: operation.context?.callsId ?? null }, correlationId: operation.operationId, observedAtUnix: updatedAt });
    await this.jobs.transition({ job: next, previousState: current.state, event });
  }

  private async recordFailure(operationId: string, cause: unknown): Promise<void> {
    if (!(cause instanceof CommerceError)) {
      try { await this.operations.markManualReview({ operationId, failureCode: "SDK_FAILURE" }); } catch { /* preserve SDK failure */ }
      return;
    }
    try {
      if (cause.relayCallsId !== undefined) await this.operations.attachCallsId({ operationId, callsId: cause.relayCallsId });
      if (cause.transactionHash !== undefined) {
        const current = await this.operations.get(operationId);
        if (current?.status === "awaiting_signature") await this.operations.markSubmitted({ operationId, transactionHash: cause.transactionHash });
        const latest = await this.operations.get(operationId);
        if (latest?.status === "submitted" && cause.code === "TRANSACTION_UNKNOWN") await this.operations.markUnknown({ operationId, failureCode: "SDK_UNKNOWN" });
        else if (latest !== null && latest !== undefined && !["reverted", "reconciled", "manual_review"].includes(latest.status)) await this.operations.markManualReview({ operationId, failureCode: cause.code });
      } else if (cause.code === "TRANSACTION_UNKNOWN" && cause.relayCallsId !== undefined) {
        const current = await this.operations.get(operationId);
        if (current?.status === "awaiting_signature") await this.operations.markUnknown({ operationId, failureCode: "SDK_UNKNOWN" });
      } else if (!["COMMERCE_DISABLED", "INVALID_AMOUNT", "INVALID_JOB", "INVALID_ADDRESS", "INVALID_CHAIN", "INVALID_CONTRACT", "INVALID_TOKEN"].includes(cause.code)) {
        await this.operations.markManualReview({ operationId, failureCode: cause.code });
      }
    } catch { /* preserve the original safe CommerceError */ }
  }
}

export interface Erc8183CommerceServiceOptions {
  readonly adapter: Erc8183AltanaAdapter;
  readonly operations: PostgresErc8183OperationRepository;
  readonly approvals?: Erc8183BuyerApprovalStore;
  readonly jobs?: Erc8183CanonicalJobStore;
}

export interface Erc8183HireServiceInput extends Erc8183HireInput {
  readonly idempotencyKey: string;
  readonly authority: Erc8183AltanaAuthority;
  readonly providerBinding: Erc8183ProviderBinding;
  /** Owning commerce_jobs UUID used by the canonical ERC-8183 projection. */
  readonly commerceJobId?: string;
  /** API-authenticated requester; when supplied it must equal the execution wallet. */
  readonly requesterAddress?: string;
}

/**
 * Browser-owned hire preparation. The server validates and persists this
 * immutable intent, but deliberately receives no wallet, signer, session or
 * authority object. The browser later executes the matching SDK action.
 */
export interface Erc8183HireIntentInput {
  readonly idempotencyKey: string;
  readonly providerAddress: string;
  readonly task: string;
  readonly budgetAtomic: string;
  readonly providerBinding: Erc8183ProviderBinding;
  readonly commerceJobId?: string;
  readonly deadlineSeconds?: number;
  /** Absolute expiry persisted into the create calldata before signing. */
  readonly expiredAtUnix?: number;
  readonly requesterAddress: string;
}

export interface Erc8183SettleIntentInput {
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly action?: "approve" | "dispute";
  readonly requesterAddress: string;
}

export interface Erc8183EoaStepInput {
  readonly idempotencyKey: string;
  readonly step: Erc8183EoaStep;
  readonly requesterAddress: string;
  readonly jobId?: string | null;
  readonly providerAddress?: string;
  readonly task?: string;
  readonly budgetAtomic?: string;
  readonly expiredAtUnix?: number;
  readonly deadlineSeconds?: number;
  readonly commerceJobId?: string;
  readonly providerBinding?: Erc8183ProviderBinding;
}

export interface Erc8183SubmitServiceInput extends Erc8183SubmitInput {
  readonly idempotencyKey: string;
  readonly providerBinding?: Erc8183ProviderBinding;
  readonly requesterAddress?: string;
}

/** Minimal API-facing contract consumed by the T5 hire flow. */
export class Erc8183CommerceService {
  private readonly coordinator: Erc8183OperationCoordinator;
  public constructor(private readonly options: Erc8183CommerceServiceOptions) {
    this.coordinator = new Erc8183OperationCoordinator(options.adapter, options.operations, options.approvals, options.jobs);
  }

  private async assertPersistedActor(jobId: string, actor: `0x${string}`, role: "client" | "provider"): Promise<Erc8183JobRecord | null> {
    if (this.options.jobs === undefined) return null;
    const persisted = await this.options.jobs.get({ chainId: this.options.adapter.pin.chainId, commerceContract: this.options.adapter.pin.commerceContract, jobId });
    if (persisted === null) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The ERC-8183 protocol job is not present in the canonical projection; reconcile before submitting a write.", nextAction: "reconcile_job" });
    const expected = role === "client" ? persisted.terms.clientAddress : persisted.terms.providerAddress;
    if (expected === null || normalizeAddress(expected, `${role} address`) !== actor) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: `The authenticated ${role} does not match the canonical ERC-8183 job actor.`, nextAction: "authenticate_actor" });
    return persisted;
  }

  private prepareHireOperation(input: {
    readonly providerAddress: string;
    readonly task: string;
    readonly budgetAtomic: string;
    readonly providerBinding: Erc8183ProviderBinding;
    readonly commerceJobId?: string;
    readonly deadlineSeconds?: number;
    readonly expiredAtUnix?: number;
    readonly requesterAddress: string;
  }): Erc8183PreparedOperation {
    const actor = normalizeAddress(input.requesterAddress, "authenticated requester");
    if (this.options.jobs !== undefined && (input.commerceJobId === undefined || input.commerceJobId.trim() === "")) throw new CommerceError({ code: "INVALID_JOB", message: "Canonical ERC-8183 persistence requires the owning commerce job ID.", nextAction: "configure_job_repository" });
    if (input.task.trim() === "" || new TextEncoder().encode(input.task).byteLength > 4_096) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 task must contain between 1 and 4096 UTF-8 bytes." });
    assertBudgetMatchesPin(input.budgetAtomic, this.options.adapter.pin);
    const binding = erc8183ProviderBindingSchema.parse(input.providerBinding);
    if (binding.identity.chainId !== this.options.adapter.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "Provider identity chain must match the pinned ERC-8183 chain." });
    const commerceContract = normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract");
    const providerAddress = normalizeAddress(input.providerAddress, "provider address");
    const taskDigest = PostgresErc8183OperationRepository.requestDigest(input.task);
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "hire", chainId: this.options.adapter.pin.chainId, commerceContract, actorAddress: actor, providerAddress: providerAddress.toLowerCase(), taskDigest, budgetAtomic: input.budgetAtomic, providerBinding: binding, commerceJobId: input.commerceJobId ?? null, deadlineSeconds: input.deadlineSeconds ?? null, expiredAtUnix: input.expiredAtUnix ?? null });
    const expectation: Erc8183OperationExpectation = { providerAddress, amountAtomic: input.budgetAtomic, expectedState: "FUNDED" };
    return preparedOperation({
      kind: "create",
      signerRole: "client",
      chainId: this.options.adapter.pin.chainId,
      commerceContract,
      jobId: null,
      requestDigest,
      context: operationContext({
        signerAddress: actor,
        action: "hire",
        parameters: {
          task: input.task,
          taskDigest,
          providerAddress,
          providerBinding: binding,
          budgetAtomic: input.budgetAtomic,
          commerceJobId: input.commerceJobId ?? null,
          deadlineSeconds: input.deadlineSeconds ?? null,
          expiredAtUnix: input.expiredAtUnix ?? null
        },
        expectation
      }),
      expectation
    });
  }

  private async prepareSettleOperation(input: Erc8183SettleIntentInput): Promise<Erc8183PreparedOperation> {
    const actor = normalizeAddress(input.requesterAddress, "authenticated requester");
    await this.assertPersistedActor(input.jobId, actor, "client");
    const action = input.action ?? "approve";
    if (action === "approve") {
      if (this.options.approvals === undefined) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "Buyer approval persistence is not configured.", nextAction: "configure_job_repository" });
      await this.options.approvals.assertBuyerApproval({ chainId: this.options.adapter.pin.chainId, commerceContract: this.options.adapter.pin.commerceContract, jobId: input.jobId });
    }
    return this.prepareEoaStep({
      idempotencyKey: input.idempotencyKey,
      step: action === "dispute" ? "dispute" : "settle",
      requesterAddress: actor,
      jobId: input.jobId
    });
  }

  /** Prepare and validate an immutable hire intent without invoking the SDK. */
  public prepareHireIntent(input: Erc8183HireIntentInput): Erc8183PreparedOperation {
    const operation = this.prepareHireOperation(input);
    if (input.expiredAtUnix === undefined) return operation;
    return this.prepareEoaStep({
      idempotencyKey: input.idempotencyKey,
      step: "create",
      requesterAddress: input.requesterAddress,
      providerAddress: input.providerAddress,
      task: input.task,
      budgetAtomic: input.budgetAtomic,
      expiredAtUnix: input.expiredAtUnix,
      ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds }),
      ...(input.commerceJobId === undefined ? {} : { commerceJobId: input.commerceJobId }),
      providerBinding: input.providerBinding
    });
  }

  /** Prepare a buyer settlement/dispute intent without invoking the SDK. */
  public prepareSettleIntent(input: Erc8183SettleIntentInput): Promise<Erc8183PreparedOperation> {
    return this.prepareSettleOperation(input);
  }

  /** Build one exact browser EOA step and persistable public context. */
  public prepareEoaStep(input: Erc8183EoaStepInput): Erc8183PreparedOperation {
    const actor = normalizeAddress(input.requesterAddress, "authenticated requester");
    if (input.step === "create" && input.jobId !== undefined && input.jobId !== null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A create operation cannot contain a predicted protocol job ID.", nextAction: "manual_review" });
    if (this.options.jobs !== undefined && (input.step === "create" || input.step === "fund") && (input.commerceJobId === undefined || input.commerceJobId.trim() === "")) throw new CommerceError({ code: "INVALID_JOB", message: `The EOA ${input.step} operation requires the owning commerce job ID.`, nextAction: "configure_job_repository" });
    if (this.options.jobs !== undefined && input.step === "fund" && input.task === undefined) throw new CommerceError({ code: "INVALID_JOB", message: "The EOA fund operation requires the persisted task snapshot.", nextAction: "reconcile_job" });
    const jobId = input.step === "create" ? null : input.jobId ?? null;
    const call = buildErc8183EoaCall({
      chainId: this.options.adapter.pin.chainId,
      contracts: {
        commerceContract: this.options.adapter.pin.commerceContract,
        routerContract: this.options.adapter.routerContract,
        policyContract: this.options.adapter.policyContract,
        paymentToken: this.options.adapter.paymentToken
      },
      step: input.step,
      ...(input.providerAddress === undefined ? {} : { providerAddress: input.providerAddress }),
      ...(input.task === undefined ? {} : { task: input.task }),
      ...(input.budgetAtomic === undefined ? {} : { budgetAtomic: input.budgetAtomic }),
      ...(input.expiredAtUnix === undefined ? {} : { expiredAtUnix: input.expiredAtUnix }),
      ...(jobId === null ? {} : { jobId })
    });
    const kind: Erc8183OperationKind = input.step === "claim_refund" ? "claim_refund" : input.step === "settle" ? "settle" : input.step === "dispute" ? "dispute" : input.step;
    const action: "hire" | "settle" | "dispute" | "claim_refund" = input.step === "settle" ? "settle" : input.step === "dispute" ? "dispute" : input.step === "claim_refund" ? "claim_refund" : "hire";
    const amount = input.budgetAtomic;
    const provider = input.providerAddress;
    if ((input.step === "create" || input.step === "fund") && (amount === undefined || provider === undefined)) throw new CommerceError({ code: "INVALID_JOB", message: `The ${input.step} operation requires the persisted provider and amount.`, nextAction: "manual_review" });
    if ((input.step === "set_budget" || input.step === "approve") && amount === undefined) throw new CommerceError({ code: "INVALID_AMOUNT", message: `The ${input.step} operation requires the persisted amount.`, nextAction: "manual_review" });
    const expectation: Erc8183OperationExpectation = input.step === "fund"
      ? { providerAddress: normalizeAddress(provider as string, "provider address"), amountAtomic: amount as string, expectedState: "FUNDED" }
      : input.step === "settle"
        ? { expectedState: "COMPLETED" }
        : input.step === "claim_refund"
          ? { expectedState: "EXPIRED" }
          : input.step === "create"
            ? { providerAddress: normalizeAddress(provider as string, "provider address"), amountAtomic: amount as string }
            : input.step === "set_budget" || input.step === "approve"
              ? { amountAtomic: amount as string }
              : {};
    const taskDigest = input.task === undefined ? undefined : PostgresErc8183OperationRepository.requestDigest(input.task);
    const parameters: Record<string, unknown> = {
      connector: "walletConnect",
      eoaStep: input.step,
      ...(jobId === null ? {} : { jobId }),
      ...(input.providerAddress === undefined ? {} : { providerAddress: normalizeAddress(input.providerAddress, "provider address") }),
      ...(input.task === undefined ? {} : { task: input.task }),
      ...(taskDigest === undefined ? {} : { taskDigest }),
      ...(input.budgetAtomic === undefined ? {} : { budgetAtomic: input.budgetAtomic }),
      ...(input.expiredAtUnix === undefined ? {} : { expiredAtUnix: input.expiredAtUnix }),
      ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds }),
      ...(input.commerceJobId === undefined ? {} : { commerceJobId: input.commerceJobId }),
      ...(input.providerBinding === undefined ? {} : { providerBinding: erc8183ProviderBindingSchema.parse(input.providerBinding) }),
      to: call.to,
      data: call.data,
      valueAtomic: call.valueAtomic
    };
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "eoa", step: input.step, chainId: this.options.adapter.pin.chainId, commerceContract: this.options.adapter.pin.commerceContract, actorAddress: actor, jobId, parameters });
    const context = operationContext({ signerAddress: actor, action, parameters, expectation });
    return {
      kind,
      signerRole: "client",
      chainId: this.options.adapter.pin.chainId,
      commerceContract: normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract"),
      jobId,
      requestDigest,
      expectation,
      value: 0n,
      to: call.to,
      data: call.data,
      context: { ...context, to: call.to, data: call.data, valueAtomic: call.valueAtomic }
    };
  }

  /** Let the browser adapter reuse the canonical funded-job projection. */
  public async persistEoaFunding(operation: Erc8183OperationRecord, job: Erc8183HireResult["job"], receipt: Erc8183RpcReceipt): Promise<void> {
    if (job === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "A funded EOA operation has no readable protocol job.", nextAction: "manual_review" });
    await this.coordinator.persistEoaFunding(operation, job, receipt);
  }

  public async persistEoaTerminal(operation: Erc8183OperationRecord, job: Erc8183HireResult["job"], receipt: Erc8183RpcReceipt, state: "completed" | "expired"): Promise<void> {
    await this.coordinator.persistEoaTerminal(operation, job, receipt, state);
  }

  public reserveExternal(input: { readonly operation: Erc8183PreparedOperation; readonly idempotencyKey: string }): ReturnType<Erc8183OperationCoordinator["reserveExternal"]> {
    return this.coordinator.reserveExternal(input);
  }

  public attachExternalExecution(input: { readonly operationId: string; readonly callsId: string; readonly transactionHash?: string }): ReturnType<Erc8183OperationCoordinator["attachExternalExecution"]> {
    return this.coordinator.attachExternalExecution(input);
  }

  public async hire(input: Erc8183HireServiceInput): Promise<Erc8183OperationCoordinatorResult<Erc8183HireResult>> {
    const actor = assertAuthenticatedRequester(input.requesterAddress, input.authority);
    const operation = this.prepareHireOperation({
      providerAddress: input.providerAddress,
      task: input.task,
      budgetAtomic: input.budgetAtomic,
      providerBinding: input.providerBinding,
      requesterAddress: actor,
      ...(input.commerceJobId === undefined ? {} : { commerceJobId: input.commerceJobId }),
      ...(input.deadlineSeconds === undefined ? {} : { deadlineSeconds: input.deadlineSeconds })
    });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.hire(input.authority, input) });
  }

  public async submit(input: Erc8183SubmitServiceInput): Promise<Erc8183OperationCoordinatorResult<Erc8183SubmitResult>> {
    const actor = assertAuthenticatedRequester(input.requesterAddress, input.authority);
    const persisted = await this.assertPersistedActor(input.jobId, actor, "provider");
    if (input.result !== undefined) {
      try {
        erc8183ProviderResultSchema.parse(input.result);
      } catch (cause) {
        throw new CommerceError({ code: "INVALID_JOB", message: "The submitted provider result is not a valid public result document.", cause });
      }
    }
    if (input.result !== undefined && input.result.resultDigest.toLowerCase() !== input.resultDigest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The submitted local result digest does not match the provider result payload." });
    const suppliedBinding = input.providerBinding === undefined ? undefined : erc8183ProviderBindingSchema.parse(input.providerBinding);
    if (suppliedBinding !== undefined && persisted !== null && persisted.providerBinding !== null && canonicalSha256Hex(suppliedBinding) !== canonicalSha256Hex(persisted.providerBinding)) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The submitted provider identity/version does not match the canonical hired provider binding.", nextAction: "authenticate_actor" });
    const providerBinding = suppliedBinding ?? persisted?.providerBinding ?? null;
    if (providerBinding !== null && providerBinding.identity.chainId !== this.options.adapter.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "Provider identity chain must match the pinned ERC-8183 chain." });
    const manifestDigest = input.manifest === undefined ? null : erc8183ManifestHash(input.manifest);
    const chainDeliverable = (manifestDigest ?? input.chainDeliverable ?? input.result?.chainDeliverable ?? null) as `0x${string}` | null;
    if (chainDeliverable === null || !/^0x[0-9a-f]{64}$/iu.test(chainDeliverable)) throw new CommerceError({ code: "INVALID_JOB", message: "Submission requires an explicit Keccak chain deliverable in addition to the local SHA-256 result digest." });
    if (input.chainDeliverable !== undefined && manifestDigest !== null && input.chainDeliverable.toLowerCase() !== manifestDigest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The manifest Keccak digest does not match the supplied chain deliverable." });
    if (input.result?.chainDeliverable !== undefined && input.result.chainDeliverable !== null && (manifestDigest !== null || input.chainDeliverable !== undefined) && input.result.chainDeliverable.toLowerCase() !== chainDeliverable.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The provider result Keccak digest does not match the supplied chain deliverable." });
    const commerceContract = normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract");
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "submit", chainId: this.options.adapter.pin.chainId, commerceContract, jobId: input.jobId, actorAddress: actor, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable: chainDeliverable.toLowerCase(), manifest: input.manifest ?? null, deliverableUrl: input.deliverableUrl ?? input.result?.deliverableUrl ?? null, result: input.result ?? null, optParams: input.optParams ?? null, providerBinding });
    const expectation: Erc8183OperationExpectation = { digest: chainDeliverable.toLowerCase() as `0x${string}`, expectedState: "SUBMITTED" };
    const operation = preparedOperation({ kind: "submit", signerRole: "provider", chainId: this.options.adapter.pin.chainId, commerceContract, jobId: input.jobId, requestDigest, context: operationContext({ signerAddress: actor, action: "submit", parameters: { resultDigest: input.resultDigest.toLowerCase(), chainDeliverable: chainDeliverable.toLowerCase(), deliverableUrl: input.deliverableUrl ?? input.result?.deliverableUrl ?? null, manifest: input.manifest ?? null, result: input.result ?? null, providerBinding }, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.submit(input) });
  }

  public async approveResult(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }; readonly actorAddress: string; readonly requesterAddress?: string; readonly resultDigest: string; readonly nowUnix: number }): Promise<unknown> {
    if (this.options.approvals === undefined) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "Buyer approval persistence is not configured.", nextAction: "configure_job_repository" });
    if (input.requesterAddress !== undefined && normalizeAddress(input.requesterAddress, "authenticated requester") !== normalizeAddress(input.actorAddress, "buyer address")) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "The authenticated requester does not match the buyer approval actor.", nextAction: "authenticate_actor" });
    return this.options.approvals.approveResult(input);
  }

  public async settle(input: { readonly idempotencyKey: string; readonly authority: Erc8183AltanaAuthority; readonly requesterAddress?: string; readonly jobId: string; readonly action?: "approve" | "dispute"; readonly executeOptions?: { readonly noWait?: boolean } }): Promise<Erc8183OperationCoordinatorResult<Erc8183SettleResult>> {
    const actor = assertAuthenticatedRequester(input.requesterAddress, input.authority);
    const operation = await this.prepareSettleOperation({ idempotencyKey: input.idempotencyKey, jobId: input.jobId, requesterAddress: actor, ...(input.action === undefined ? {} : { action: input.action }) });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.settle(input.authority, input) });
  }

  public async claimRefund(input: { readonly idempotencyKey: string; readonly authority: Erc8183AltanaAuthority; readonly requesterAddress?: string; readonly jobId: string; readonly executeOptions?: { readonly noWait?: boolean } }): Promise<Erc8183OperationCoordinatorResult<Erc8183ClaimRefundResult>> {
    const actor = assertAuthenticatedRequester(input.requesterAddress, input.authority);
    await this.assertPersistedActor(input.jobId, actor, "client");
    const commerceContract = normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract");
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "claim_refund", chainId: this.options.adapter.pin.chainId, commerceContract, jobId: input.jobId, actorAddress: actor });
    const expectation: Erc8183OperationExpectation = { expectedState: "EXPIRED" };
    const operation = preparedOperation({ kind: "claim_refund", signerRole: "client", chainId: this.options.adapter.pin.chainId, commerceContract, jobId: input.jobId, requestDigest, context: operationContext({ signerAddress: actor, action: "claim_refund", parameters: {}, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.claimRefund(input.authority, input) });
  }

  public reconcile(operationId: string): Promise<Erc8183OperationCoordinatorResult<Erc8183ConfirmedOperation | null>> {
    return this.coordinator.reconcile(operationId);
  }
}
