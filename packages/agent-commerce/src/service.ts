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
import { normalizeAddress } from "./validation.js";
import { erc8183ProviderBindingSchema, type Erc8183ProviderBinding } from "./types.js";

export interface Erc8183BuyerApprovalReader {
  assertBuyerApproval(input: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<void>;
}

export interface Erc8183BuyerApprovalStore extends Erc8183BuyerApprovalReader {
  approveResult(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }; readonly actorAddress: string; readonly resultDigest: string; readonly nowUnix: number }): Promise<{ readonly job: unknown; readonly replayed: boolean }>;
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

function operationContext(input: {
  readonly authority: Erc8183AltanaAuthority;
  readonly action: "hire" | "submit" | "settle" | "dispute" | "claim_refund";
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expectation?: Erc8183OperationExpectation | null;
}): NonNullable<Erc8183PreparedOperation["context"]> {
  return {
    signerAddress: authorityAddress(input.authority),
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
    private readonly approvals?: Erc8183BuyerApprovalReader
  ) {}

  public async executeSdk<T extends AdapterExecution>(input: {
    readonly operation: Erc8183PreparedOperation;
    readonly idempotencyKey: string;
    readonly authority: Erc8183AltanaAuthority;
    readonly run: () => Promise<T>;
  }): Promise<Erc8183OperationCoordinatorResult<T>> {
    if (input.operation.kind === "settle") {
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
      return { operation: operation ?? updated, result, replayed: false };
    } catch (cause) {
      await this.recordFailure(reservation.operation.operationId, cause);
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
      try { await this.operations.markManualReview({ operationId, failureCode: "RECONCILIATION_CONTEXT_MISSING" }); } catch { /* preserve original action */ }
      throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The operation has no persisted transaction hash; manual review is required and no retry is safe.", nextAction: "manual_review" });
    }
    try {
      const checked = await this.adapter.verifyReceiptForOperation({
        transactionHash: existing.transactionHash,
        kind: existing.kind,
        jobId: existing.jobId,
        ...(existing.context?.expectation === undefined ? {} : { expectation: existing.context.expectation })
      });
      await this.operations.markReceipt({ operationId, status: "confirmed", transactionHash: checked.receipt.transactionHash, blockNumber: checked.receipt.blockNumber.toString(10), blockHash: checked.receipt.blockHash, failureCode: null });
      if (existing.jobId === null && checked.job !== null) await this.operations.attachJobId({ operationId, jobId: checked.job.id });
      const reconciled = await this.operations.reconcile({ operationId, status: "reconciled" });
      return { operation: reconciled, result: { operation: this.operationFromRecord(existing), transactionHash: checked.receipt.transactionHash, receipt: checked.receipt, jobId: checked.job?.id ?? existing.jobId }, replayed: false };
    } catch (cause) {
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
}

export interface Erc8183HireServiceInput extends Erc8183HireInput {
  readonly idempotencyKey: string;
  readonly authority: Erc8183AltanaAuthority;
  readonly providerBinding: Erc8183ProviderBinding;
}

export interface Erc8183SubmitServiceInput extends Erc8183SubmitInput {
  readonly idempotencyKey: string;
  readonly providerBinding?: Erc8183ProviderBinding;
}

/** Minimal API-facing contract consumed by the T5 hire flow. */
export class Erc8183CommerceService {
  private readonly coordinator: Erc8183OperationCoordinator;
  public constructor(private readonly options: Erc8183CommerceServiceOptions) {
    this.coordinator = new Erc8183OperationCoordinator(options.adapter, options.operations, options.approvals);
  }

  public async hire(input: Erc8183HireServiceInput): Promise<Erc8183OperationCoordinatorResult<Erc8183HireResult>> {
    const binding = erc8183ProviderBindingSchema.parse(input.providerBinding);
    if (binding.identity.chainId !== this.options.adapter.pin.chainId) throw new CommerceError({ code: "INVALID_CHAIN", message: "Provider identity chain must match the pinned ERC-8183 chain." });
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "hire", providerAddress: input.providerAddress.toLowerCase(), taskDigest: PostgresErc8183OperationRepository.requestDigest(input.task), budgetAtomic: input.budgetAtomic, providerBinding: binding });
    const expectation: Erc8183OperationExpectation = { providerAddress: normalizeAddress(input.providerAddress), amountAtomic: input.budgetAtomic, expectedState: "FUNDED" };
    const operation = preparedOperation({ kind: "create", signerRole: "client", chainId: this.options.adapter.pin.chainId, commerceContract: normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract"), jobId: null, requestDigest, context: operationContext({ authority: input.authority, action: "hire", parameters: { taskDigest: PostgresErc8183OperationRepository.requestDigest(input.task), providerBinding: binding, budgetAtomic: input.budgetAtomic }, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.hire(input.authority, input) });
  }

  public async submit(input: Erc8183SubmitServiceInput): Promise<Erc8183OperationCoordinatorResult<Erc8183SubmitResult>> {
    if (input.result !== undefined && input.result.resultDigest.toLowerCase() !== input.resultDigest.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The submitted local result digest does not match the provider result payload." });
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "submit", jobId: input.jobId, resultDigest: input.resultDigest.toLowerCase(), chainDeliverable: input.chainDeliverable?.toLowerCase() ?? null, providerBinding: input.providerBinding ?? null });
    const expectation: Erc8183OperationExpectation = { digest: `0x${input.resultDigest.toLowerCase()}` as `0x${string}`, expectedState: "SUBMITTED" };
    const operation = preparedOperation({ kind: "submit", signerRole: "provider", chainId: this.options.adapter.pin.chainId, commerceContract: normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract"), jobId: input.jobId, requestDigest, context: operationContext({ authority: input.authority, action: "submit", parameters: { resultDigest: input.resultDigest.toLowerCase(), chainDeliverable: input.chainDeliverable?.toLowerCase() ?? null, providerBinding: input.providerBinding ?? null }, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.submit(input) });
  }

  public async approveResult(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }; readonly actorAddress: string; readonly resultDigest: string; readonly nowUnix: number }): Promise<unknown> {
    if (this.options.approvals === undefined) throw new CommerceError({ code: "COMMERCE_DISABLED", message: "Buyer approval persistence is not configured.", nextAction: "configure_job_repository" });
    return this.options.approvals.approveResult(input);
  }

  public async settle(input: { readonly idempotencyKey: string; readonly authority: Erc8183AltanaAuthority; readonly jobId: string; readonly action?: "approve" | "dispute"; readonly executeOptions?: { readonly noWait?: boolean } }): Promise<Erc8183OperationCoordinatorResult<Erc8183SettleResult>> {
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "settle", jobId: input.jobId, action: input.action ?? "approve" });
    const expectation: Erc8183OperationExpectation = input.action === "dispute" ? {} : { expectedState: "COMPLETED" };
    const operation = preparedOperation({ kind: "settle", signerRole: "client", chainId: this.options.adapter.pin.chainId, commerceContract: normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract"), jobId: input.jobId, requestDigest, context: operationContext({ authority: input.authority, action: input.action === "dispute" ? "dispute" : "settle", parameters: { action: input.action ?? "approve" }, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.settle(input.authority, input) });
  }

  public async claimRefund(input: { readonly idempotencyKey: string; readonly authority: Erc8183AltanaAuthority; readonly jobId: string; readonly executeOptions?: { readonly noWait?: boolean } }): Promise<Erc8183OperationCoordinatorResult<Erc8183ClaimRefundResult>> {
    const requestDigest = PostgresErc8183OperationRepository.requestDigest({ operation: "claim_refund", jobId: input.jobId });
    const expectation: Erc8183OperationExpectation = { expectedState: "EXPIRED" };
    const operation = preparedOperation({ kind: "claim_refund", signerRole: "client", chainId: this.options.adapter.pin.chainId, commerceContract: normalizeAddress(this.options.adapter.pin.commerceContract, "commerce contract"), jobId: input.jobId, requestDigest, context: operationContext({ authority: input.authority, action: "claim_refund", parameters: {}, expectation }), expectation });
    return this.coordinator.executeSdk({ operation, idempotencyKey: input.idempotencyKey, authority: input.authority, run: () => this.options.adapter.claimRefund(input.authority, input) });
  }

  public reconcile(operationId: string): Promise<Erc8183OperationCoordinatorResult<Erc8183ConfirmedOperation | null>> {
    return this.coordinator.reconcile(operationId);
  }
}
