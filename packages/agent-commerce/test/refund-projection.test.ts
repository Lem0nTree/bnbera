import { describe, expect, it } from "vitest";
import {
  PostgresErc8183JobRepository,
  createErc8183JobEvent,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  persistMarketplaceRefundProjection,
  type Erc8183JobEvent,
  type Erc8183JobRecord,
  type Erc8183OperationQueryClient,
  type Erc8183OperationQueryPool
} from "../src/index.js";

const COMMERCE = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const CLIENT = "0x3333333333333333333333333333333333333333";
const PROVIDER = "0x4444444444444444444444444444444444444444";
const EVALUATOR = "0x5555555555555555555555555555555555555555";
const PARENT_ID = "00000000-0000-4000-8000-000000000101";
const JOB_RECORD_ID = "00000000-0000-4000-8000-000000000102";
const REFUND_HASH = `0x${"a".repeat(64)}`;
const OTHER_HASH = `0x${"b".repeat(64)}`;
const BLOCK_HASH = `0x${"c".repeat(64)}`;

const PIN = {
  enabled: true as const,
  chainId: 97 as const,
  specRevision: "apex-v1",
  commerceContract: COMMERCE,
  paymentToken: TOKEN,
  paymentDecimals: 18,
  abiHash: "d".repeat(64),
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 1,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "100000000000000000"
};

function expiredJob(refundTransactionHash: string | null = REFUND_HASH): Erc8183JobRecord {
  return erc8183JobRecordSchema.parse({
    jobKey: { chainId: 97, commerceContract: COMMERCE, jobId: "1101" },
    terms: {
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18,
      clientAddress: CLIENT,
      providerAddress: PROVIDER,
      evaluatorAddress: EVALUATOR,
      hookAddress: null,
      budgetAtomic: "1000",
      descriptionDigest: "e".repeat(64),
      expiresAtUnix: 2_000_600
    },
    deploymentPin: PIN,
    deploymentPinDigest: erc8183DeploymentPinDigest(PIN),
    state: "expired",
    createdAtUnix: 2_000_000,
    updatedAtUnix: 2_000_700,
    deliverableDigest: null,
    providerBinding: null,
    buyerApproval: null,
    fundingTransactionHash: `0x${"f".repeat(64)}`,
    submissionTransactionHash: null,
    completionTransactionHash: null,
    rejectionTransactionHash: null,
    refundTransactionHash,
    lastObservedBlock: "101",
    lastObservedBlockHash: BLOCK_HASH,
    lastObservedAtUnix: 2_000_700
  });
}

function refundEvent(job: Erc8183JobRecord, previousState: "funded" | "submitted", overrides: Partial<Parameters<typeof createErc8183JobEvent>[0]> = {}): Erc8183JobEvent {
  return createErc8183JobEvent({
    eventKey: `refund:${previousState}:${job.jobKey.jobId}`,
    jobKey: job.jobKey,
    eventType: "job_expired",
    previousState,
    nextState: "expired",
    actorAddress: CLIENT,
    transactionHash: REFUND_HASH,
    blockNumber: "101",
    blockHash: BLOCK_HASH,
    logIndex: 0,
    payload: { refund: true },
    correlationId: `refund-correlation:${previousState}`,
    observedAtUnix: 2_000_700,
    ...overrides
  });
}

type ParentStatus = "draft" | "funded" | "submitted" | "cancelled";

class ParentProjectionClient implements Erc8183OperationQueryClient {
  public updateCount = 0;
  public status: ParentStatus;
  public protocolJobId: string;

  public constructor(status: ParentStatus = "funded", protocolJobId = `draft:${PARENT_ID}`) {
    this.status = status;
    this.protocolJobId = protocolJobId;
  }

  public async query<T = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> {
    if (!text.includes("UPDATE commerce_jobs")) throw new Error(`Unhandled SQL: ${text}`);
    const parentId = values[0];
    const protocolJobId = values[1];
    const eligibleStatus = this.status === "funded" || this.status === "submitted" || this.status === "cancelled" && this.protocolJobId === protocolJobId;
    const eligibleBinding = this.protocolJobId === protocolJobId || this.protocolJobId.startsWith("draft:") || this.protocolJobId.startsWith("intent:");
    if (parentId !== PARENT_ID || !eligibleStatus || !eligibleBinding) return { rows: [] };
    this.status = "cancelled";
    this.protocolJobId = String(protocolJobId);
    this.updateCount += 1;
    return { rows: [{ id: PARENT_ID } as T] };
  }
}

function persistedJobRow(job: Erc8183JobRecord): Record<string, unknown> {
  return {
    id: JOB_RECORD_ID,
    commerce_job_id: PARENT_ID,
    chain_id: job.jobKey.chainId,
    commerce_contract: job.jobKey.commerceContract,
    erc8183_job_id: job.jobKey.jobId,
    spec_revision: PIN.specRevision,
    abi_hash: PIN.abiHash,
    evaluator_profile: PIN.evaluatorProfile,
    confirmation_threshold: PIN.confirmationThreshold,
    min_expiry_lead_seconds: PIN.minExpiryLeadSeconds,
    max_expiry_horizon_seconds: PIN.maxExpiryHorizonSeconds,
    min_budget_atomic: PIN.minBudgetAtomic,
    max_budget_atomic: PIN.maxBudgetAtomic,
    deployment_pin_digest: job.deploymentPinDigest,
    payment_token: TOKEN,
    payment_decimals: 18,
    client_address: CLIENT,
    provider_address: PROVIDER,
    evaluator_address: EVALUATOR,
    hook_address: null,
    budget_atomic: "1000",
    description_digest: "e".repeat(64),
    expires_at: new Date(2_000_600 * 1_000),
    state: "expired",
    deliverable_digest: null,
    provider_binding: null,
    buyer_approval_address: null,
    buyer_approval_result_digest: null,
    buyer_approved_at: null,
    funding_transaction_hash: `0x${"f".repeat(64)}`,
    submission_transaction_hash: null,
    completion_transaction_hash: null,
    rejection_transaction_hash: null,
    refund_transaction_hash: job.refundTransactionHash,
    last_observed_block: "101",
    last_observed_block_hash: BLOCK_HASH,
    last_observed_at: new Date(2_000_700 * 1_000),
    created_at: new Date(2_000_000 * 1_000),
    updated_at: new Date(2_000_700 * 1_000)
  };
}

function persistedEventRow(event: Erc8183JobEvent): Record<string, unknown> {
  return {
    chain_id: event.jobKey.chainId,
    commerce_contract: event.jobKey.commerceContract,
    erc8183_job_id: event.jobKey.jobId,
    event_id: event.eventId,
    event_key: event.eventKey,
    event_type: event.eventType,
    previous_state: event.previousState,
    next_state: event.nextState,
    actor_address: event.actorAddress,
    transaction_hash: event.transactionHash,
    block_number: event.blockNumber,
    block_hash: event.blockHash,
    log_index: event.logIndex,
    confirmation_state: event.confirmationState,
    payload_digest: event.payloadDigest,
    payload: event.payload,
    correlation_id: event.correlationId,
    observed_at: new Date(event.observedAtUnix * 1_000)
  };
}

class RefundRepairPool implements Erc8183OperationQueryPool {
  public readonly parent: ParentProjectionClient;
  public readonly jobRow: Record<string, unknown>;
  public readonly eventRow: Record<string, unknown> | null;
  public commitCount = 0;
  public rollbackCount = 0;
  public insertedEventCount = 0;
  public transitionMode = false;

  public constructor(job: Erc8183JobRecord, event: Erc8183JobEvent | null, parentStatus: ParentStatus = "funded") {
    this.parent = new ParentProjectionClient(parentStatus);
    this.jobRow = persistedJobRow(job);
    this.eventRow = event === null ? null : persistedEventRow(event);
  }

  public async connect(): Promise<Erc8183OperationQueryClient & { readonly release: () => void }> {
    return {
      query: <T = Record<string, unknown>>(text: string, values: readonly unknown[] = []) => this.clientQuery<T>(text, values),
      release: () => undefined
    };
  }

  public async query<T = Record<string, unknown>>(text: string, _values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> {
    if (text.includes("SELECT id FROM erc8183_job_events WHERE event_key")) return { rows: [] };
    if (text.includes("SELECT j.chain_id") && text.includes("JOIN commerce_jobs")) {
      if (this.parent.status !== "funded" && this.parent.status !== "submitted") return { rows: [] };
      return { rows: [{ chain_id: 97, commerce_contract: COMMERCE, erc8183_job_id: "1101" } as T] };
    }
    throw new Error(`Unhandled pool SQL: ${text}`);
  }

  private async clientQuery<T = Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly T[] }> {
    if (text === "BEGIN") return { rows: [] };
    if (text === "COMMIT") {
      this.commitCount += 1;
      return { rows: [] };
    }
    if (text === "ROLLBACK") {
      this.rollbackCount += 1;
      return { rows: [] };
    }
    if (text.includes("UPDATE erc8183_jobs SET")) {
      if (!this.transitionMode) throw new Error("Unexpected canonical transition");
      return { rows: [{ id: JOB_RECORD_ID, commerce_job_id: PARENT_ID } as T] };
    }
    if (text.includes("INSERT INTO erc8183_job_events")) {
      this.insertedEventCount += 1;
      return { rows: [] };
    }
    if (text.includes("FOR UPDATE") && text.includes("FROM erc8183_jobs")) return { rows: [this.jobRow as T] };
    if (text.includes("FROM erc8183_job_events e")) return { rows: this.eventRow === null ? [] : [this.eventRow as T] };
    if (text.includes("UPDATE commerce_jobs")) return this.parent.query<T>(text, values);
    throw new Error(`Unhandled client SQL: ${text}`);
  }
}

describe("ERC-8183 refund marketplace projection", () => {
  it.each(["funded", "submitted"] as const)("cancels a %s parent only after the canonical expiry proof", async (previousState) => {
    const job = expiredJob();
    const event = refundEvent(job, previousState);
    const client = new ParentProjectionClient(previousState);

    await persistMarketplaceRefundProjection(client, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job, event });

    expect(client.status).toBe("cancelled");
    expect(client.protocolJobId).toBe(job.jobKey.jobId);
    expect(client.updateCount).toBe(1);
  });

  it("rejects missing, mismatched, or incorrectly bound refund evidence without touching the parent", async () => {
    const job = expiredJob();
    const cases: readonly Erc8183JobEvent[] = [
      refundEvent(job, "funded", { transactionHash: OTHER_HASH }),
      refundEvent(job, "funded", { blockHash: null }),
      refundEvent(job, "funded", { actorAddress: PROVIDER }),
      refundEvent(job, "funded", { jobKey: { ...job.jobKey, jobId: "1102" } })
    ];

    for (const event of cases) {
      const client = new ParentProjectionClient("funded");
      await expect(persistMarketplaceRefundProjection(client, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job, event })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH", nextAction: "manual_review" });
      expect(client.updateCount).toBe(0);
      expect(client.status).toBe("funded");
    }

    const missingHashClient = new ParentProjectionClient("funded");
    await expect(persistMarketplaceRefundProjection(missingHashClient, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job: expiredJob(null), event: refundEvent(job, "funded") })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(missingHashClient.updateCount).toBe(0);
  });

  it("is idempotent for the same cancelled protocol job and denies an ineligible parent", async () => {
    const job = expiredJob();
    const event = refundEvent(job, "submitted");
    const client = new ParentProjectionClient("submitted");
    await persistMarketplaceRefundProjection(client, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job, event });
    await persistMarketplaceRefundProjection(client, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job, event });
    expect(client.status).toBe("cancelled");
    expect(client.updateCount).toBe(2);

    const ineligible = new ParentProjectionClient("draft");
    await expect(persistMarketplaceRefundProjection(ineligible, { jobRecordId: JOB_RECORD_ID, commerceJobId: PARENT_ID, job, event })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH", nextAction: "manual_review" });
    expect(ineligible.status).toBe("draft");
  });

  it.each(["funded", "submitted"] as const)("projects parent cancellation atomically during a %s -> expired repository transition", async (previousState) => {
    const job = expiredJob();
    const event = refundEvent(job, previousState);
    const pool = new RefundRepairPool(job, event, previousState);
    pool.transitionMode = true;

    const result = await new PostgresErc8183JobRepository(pool).transition({ job, previousState, event });

    expect(result.replayed).toBe(false);
    expect(pool.parent.status).toBe("cancelled");
    expect(pool.insertedEventCount).toBe(1);
    expect(pool.commitCount).toBe(1);
    expect(pool.rollbackCount).toBe(0);
  });

  it("repairs canonical expired rows in a bounded batch after restart without appending an event", async () => {
    const job = expiredJob();
    const event = refundEvent(job, "funded");
    const pool = new RefundRepairPool(job, event, "funded");
    const repository = new PostgresErc8183JobRepository(pool);

    const first = await repository.repairExpiredMarketplaceProjections({ limit: 1 });
    expect(first).toEqual({ scanned: 1, repaired: 1, skipped: 0 });
    expect(pool.parent.status).toBe("cancelled");
    expect(pool.insertedEventCount).toBe(0);

    const restarted = await new PostgresErc8183JobRepository(pool).repairExpiredMarketplaceProjection({ jobKey: job.jobKey });
    expect(restarted).toEqual({ repaired: true });
    expect(pool.parent.status).toBe("cancelled");
    expect(pool.insertedEventCount).toBe(0);
    expect(pool.commitCount).toBe(2);

    const replayBatch = await repository.repairExpiredMarketplaceProjections({ limit: 1 });
    expect(replayBatch).toEqual({ scanned: 0, repaired: 0, skipped: 0 });
  });

  it("denies replay repair when the canonical event or matching refund hash is absent", async () => {
    const job = expiredJob();
    const missingEventPool = new RefundRepairPool(job, null, "funded");
    await expect(new PostgresErc8183JobRepository(missingEventPool).repairExpiredMarketplaceProjection({ jobKey: job.jobKey })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH", nextAction: "manual_review" });
    expect(missingEventPool.parent.status).toBe("funded");
    expect(missingEventPool.rollbackCount).toBe(1);

    const mismatchedEvent = refundEvent(job, "funded", { transactionHash: OTHER_HASH });
    const mismatchPool = new RefundRepairPool(job, mismatchedEvent, "funded");
    await expect(new PostgresErc8183JobRepository(mismatchPool).repairExpiredMarketplaceProjection({ jobKey: job.jobKey })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH", nextAction: "manual_review" });
    expect(mismatchPool.parent.status).toBe("funded");
    expect(mismatchPool.rollbackCount).toBe(1);

    const missingHashPool = new RefundRepairPool(expiredJob(null), refundEvent(job, "funded"), "funded");
    await expect(new PostgresErc8183JobRepository(missingHashPool).repairExpiredMarketplaceProjection({ jobKey: job.jobKey })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH", nextAction: "manual_review" });
    expect(missingHashPool.parent.status).toBe("funded");
    expect(missingHashPool.rollbackCount).toBe(1);
  });

  it("bounds repair work and validates the limit", async () => {
    const job = expiredJob();
    const pool = new RefundRepairPool(job, refundEvent(job, "funded"));
    const repository = new PostgresErc8183JobRepository(pool);
    await expect(repository.repairExpiredMarketplaceProjections({ limit: 0 })).rejects.toMatchObject({ code: "INVALID_JOB" });
    await expect(repository.repairExpiredMarketplaceProjections({ limit: 1.5 })).rejects.toMatchObject({ code: "INVALID_JOB" });
    const result = await repository.repairExpiredMarketplaceProjections({ limit: 1_000 });
    expect(result.scanned).toBe(1);
  });

});
