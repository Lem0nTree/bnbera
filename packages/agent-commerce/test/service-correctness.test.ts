import { describe, expect, it } from "vitest";
import {
  Erc8183OperationCoordinator,
  type Erc8183AltanaAdapter,
  type Erc8183AltanaAuthority,
  type Erc8183CanonicalJobStore,
  type Erc8183JobEvent,
  type Erc8183JobRecord,
  type Erc8183OnchainJob,
  type Erc8183OperationRecord,
  type Erc8183PreparedOperation,
  type Erc8183RpcReceipt,
  type PersistentErc8183JobCreateInput,
  type PersistentErc8183JobTransitionInput,
  type PostgresErc8183OperationRepository,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as `0x${string}`;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as `0x${string}`;
const POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as `0x${string}`;
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565" as `0x${string}`;
const CLIENT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const PROVIDER = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const CALLS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const TX = "0x" + "b".repeat(64) as `0x${string}`;
const BLOCK = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;
const LOCAL_DIGEST = "d".repeat(64);
const CHAIN_DELIVERABLE = "0x" + "e".repeat(64) as `0x${string}`;

const PIN = {
  enabled: true as const,
  chainId: 97 as const,
  specRevision: "apex-v1",
  commerceContract: COMMERCE,
  paymentToken: TOKEN,
  paymentDecimals: 18,
  abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 1,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "10000000000000000"
};

function canonicalJob(state: "funded" | "submitted", deliverableDigest: string | null = null): Erc8183JobRecord {
  return erc8183JobRecordSchema.parse({
    jobKey: { chainId: 97, commerceContract: COMMERCE, jobId: "7" },
    terms: {
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18,
      clientAddress: CLIENT,
      providerAddress: PROVIDER,
      evaluatorAddress: ROUTER,
      hookAddress: ROUTER,
      budgetAtomic: "1000",
      descriptionDigest: "b".repeat(64),
      expiresAtUnix: 2_000_600
    },
    deploymentPin: PIN,
    deploymentPinDigest: erc8183DeploymentPinDigest(PIN),
    state,
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_000,
    deliverableDigest,
    providerBinding: null,
    buyerApproval: null,
    fundingTransactionHash: null,
    submissionTransactionHash: null,
    completionTransactionHash: null,
    rejectionTransactionHash: null,
    refundTransactionHash: null,
    lastObservedBlock: null,
    lastObservedBlockHash: null,
    lastObservedAtUnix: null
  });
}

class MemoryOperations {
  public record: Erc8183OperationRecord | null = null;

  public async reserve(input: { readonly idempotencyKey: string; readonly requestDigest: string; readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId?: string | null; readonly kind: Erc8183OperationRecord["kind"]; readonly signerRole: Erc8183OperationRecord["signerRole"]; readonly context?: Erc8183OperationRecord["context"] | null }): Promise<{ readonly operation: Erc8183OperationRecord; readonly replayed: boolean }> {
    if (this.record !== null) return { operation: this.record, replayed: true };
    this.record = {
      operationId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      chainId: input.chainId,
      commerceContract: input.commerceContract as `0x${string}`,
      jobId: input.jobId ?? null,
      kind: input.kind,
      signerRole: input.signerRole,
      status: "awaiting_signature",
      transactionHash: null,
      blockNumber: null,
      blockHash: null,
      logIndex: null,
      failureCode: null,
      context: input.context ?? null,
      createdAtUnix: 2_000_000,
      updatedAtUnix: 2_000_000
    };
    return { operation: this.record, replayed: false };
  }

  public async attachCallsId(input: { readonly operationId: string; readonly callsId: string }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, context: { ...(this.record.context as NonNullable<Erc8183OperationRecord["context"]>), callsId: input.callsId as `0x${string}` } };
    return this.record;
  }

  public async markSubmitted(input: { readonly operationId: string; readonly transactionHash: string }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, status: "submitted", transactionHash: input.transactionHash as `0x${string}` };
    return this.record;
  }

  public async markUnknown(input: { readonly operationId: string; readonly failureCode: string }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, status: "unknown", failureCode: input.failureCode };
    return this.record;
  }

  public async markReceipt(input: { readonly operationId: string; readonly status: "confirmed" | "reverted"; readonly transactionHash: string; readonly blockNumber: string; readonly blockHash: string; readonly failureCode: string | null }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, status: input.status, transactionHash: input.transactionHash as `0x${string}`, blockNumber: input.blockNumber, blockHash: input.blockHash as `0x${string}`, failureCode: input.failureCode };
    return this.record;
  }

  public async reconcile(input: { readonly operationId: string; readonly status: "reconciled" }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, status: input.status };
    return this.record;
  }

  public async markManualReview(input: { readonly operationId: string; readonly failureCode: string }): Promise<Erc8183OperationRecord> {
    if (this.record === null) throw new Error("missing operation");
    this.record = { ...this.record, status: "manual_review", failureCode: input.failureCode };
    return this.record;
  }

  public async get(): Promise<Erc8183OperationRecord | null> {
    return this.record;
  }
}

class MemoryJobs implements Erc8183CanonicalJobStore {
  public createCalls = 0;
  public transitionCalls = 0;
  public failNextTransition = false;
  public lastEvent: Erc8183JobEvent | null = null;

  public constructor(public current: Erc8183JobRecord | null) {}

  public async get(): Promise<Erc8183JobRecord | null> {
    return this.current;
  }

  public async create(input: PersistentErc8183JobCreateInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    this.createCalls += 1;
    this.current = input.job;
    this.lastEvent = input.event;
    return { job: input.job, replayed: false };
  }

  public async transition(input: PersistentErc8183JobTransitionInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    this.transitionCalls += 1;
    if (this.failNextTransition) {
      this.failNextTransition = false;
      throw new Error("simulated projection crash");
    }
    this.current = input.job;
    this.lastEvent = input.event;
    return { job: input.job, replayed: false };
  }
}

function operation(input: { readonly kind: "create" | "submit"; readonly jobId: string | null; readonly action: "hire" | "submit"; readonly signerAddress: `0x${string}`; readonly parameters: Readonly<Record<string, unknown>>; readonly expectation: Erc8183PreparedOperation["expectation"] }): Erc8183PreparedOperation {
  return {
    kind: input.kind,
    signerRole: input.kind === "create" ? "client" : "provider",
    chainId: 97,
    commerceContract: COMMERCE,
    jobId: input.jobId,
    requestDigest: "a".repeat(64),
    expectation: input.expectation,
    value: 0n,
    context: {
      signerAddress: input.signerAddress,
      sdkAction: input.action,
      parameters: input.parameters,
      expectation: input.expectation
    }
  };
}

function adapterFor(job: Erc8183OnchainJob, receipt: Erc8183RpcReceipt): Erc8183AltanaAdapter {
  return {
    pin: PIN,
    routerContract: ROUTER,
    policyContract: POLICY,
    verifyReceiptForOperation: async () => ({ job, receipt })
  } as unknown as Erc8183AltanaAdapter;
}

const AUTHORITY = { wallet: { address: CLIENT } } as unknown as Erc8183AltanaAuthority;

describe("ERC-8183 canonical projection recovery", () => {
  it("does not create a canonical job from a pending SDK job ID", async () => {
    const operations = new MemoryOperations();
    const jobs = new MemoryJobs(null);
    const coordinator = new Erc8183OperationCoordinator({ pin: PIN } as unknown as Erc8183AltanaAdapter, operations as unknown as PostgresErc8183OperationRepository, undefined, jobs);
    const hire = operation({ kind: "create", jobId: null, action: "hire", signerAddress: CLIENT, parameters: { commerceJobId: "commerce-job-1", taskDigest: "b".repeat(64), providerBinding: null }, expectation: { providerAddress: PROVIDER, amountAtomic: "1000" } });

    await expect(coordinator.executeSdk({
      operation: hire,
      idempotencyKey: "pending-hire-no-projection",
      authority: AUTHORITY,
      run: async () => ({ callsId: CALLS, status: "PENDING" as const, transactionHash: null, jobId: "99", budgetAtomic: "1000", expiredAtUnix: 2_000_600, job: null, receipt: null })
    })).rejects.toMatchObject({ code: "TRANSACTION_UNKNOWN" });
    expect(jobs.createCalls).toBe(0);
    expect(jobs.current).toBeNull();
    expect(operations.record?.jobId).toBeNull();
  });

  it("persists the canonical result before marking reconciliation terminal and retries after a projection crash", async () => {
    const operations = new MemoryOperations();
    const jobs = new MemoryJobs(canonicalJob("funded"));
    jobs.failNextTransition = true;
    const receipt: Erc8183RpcReceipt = { status: "success", blockNumber: 123n, blockHash: BLOCK, transactionHash: TX, logs: [] };
    const onchain: Erc8183OnchainJob = { id: "7", client: CLIENT, provider: PROVIDER, evaluator: ROUTER, hook: ROUTER, description: "task", budgetAtomic: "1000", expiredAtUnix: 2_000_600, submittedAtUnix: 2_000_001, status: "SUBMITTED", chainDeliverable: CHAIN_DELIVERABLE };
    const coordinator = new Erc8183OperationCoordinator(adapterFor(onchain, receipt), operations as unknown as PostgresErc8183OperationRepository, undefined, jobs);
    const submit = operation({ kind: "submit", jobId: "7", action: "submit", signerAddress: PROVIDER, parameters: { resultDigest: LOCAL_DIGEST, chainDeliverable: CHAIN_DELIVERABLE }, expectation: { digest: CHAIN_DELIVERABLE, expectedState: "SUBMITTED" } });
    const reserved = await operations.reserve({ idempotencyKey: "reconcile-projection-order", requestDigest: submit.requestDigest, chainId: 97, commerceContract: COMMERCE, jobId: "7", kind: "submit", signerRole: "provider", context: submit.context });
    await operations.markSubmitted({ operationId: reserved.operation.operationId, transactionHash: TX });
    await operations.markUnknown({ operationId: reserved.operation.operationId, failureCode: "RELAY_TIMEOUT" });

    await expect(coordinator.reconcile(reserved.operation.operationId)).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(operations.record?.status).toBe("manual_review");
    expect(operations.record?.status).not.toBe("reconciled");
    expect(jobs.transitionCalls).toBe(1);

    const retried = await coordinator.reconcile(reserved.operation.operationId);
    expect(retried.operation.status).toBe("reconciled");
    expect(jobs.transitionCalls).toBe(2);
    expect(jobs.current?.state).toBe("submitted");
    expect(jobs.current?.deliverableDigest).toBe(LOCAL_DIGEST);
    expect(jobs.lastEvent?.payload).toMatchObject({ resultDigest: LOCAL_DIGEST, chainDeliverable: CHAIN_DELIVERABLE });
  });
});
