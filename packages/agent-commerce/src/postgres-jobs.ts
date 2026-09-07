import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import { approveErc8183Result } from "./lifecycle.js";
import { persistMarketplaceSettlementProjection, persistMarketplaceSubmissionProjection } from "./marketplace-projection.js";
import type { Erc8183OperationQueryClient, Erc8183OperationQueryPool } from "./operations.js";
import {
  erc8183JobEventSchema,
  erc8183JobRecordSchema,
  erc8183ProviderBindingSchema,
  type Erc8183JobEvent,
  type Erc8183JobRecord,
  type Erc8183JobState
} from "./types.js";
import { assertBudgetMatchesPin, assertDeploymentPinSnapshot, assertPinMatchesJob, normalizeAddress, parseEnabledDeploymentPin } from "./validation.js";

export interface PersistentErc8183JobCreateInput {
  readonly commerceJobId: string;
  readonly job: Erc8183JobRecord;
  readonly event: Erc8183JobEvent;
}

export interface PersistentErc8183JobTransitionInput {
  readonly job: Erc8183JobRecord;
  readonly previousState: Erc8183JobState;
  readonly event: Erc8183JobEvent;
}

type JobRow = {
  readonly id: string;
  readonly commerce_job_id: string;
  readonly chain_id: number;
  readonly commerce_contract: string;
  readonly erc8183_job_id: string;
  readonly spec_revision: string;
  readonly abi_hash: string;
  readonly evaluator_profile: string;
  readonly confirmation_threshold: number;
  readonly min_expiry_lead_seconds: number;
  readonly max_expiry_horizon_seconds: number;
  readonly min_budget_atomic: string;
  readonly max_budget_atomic: string;
  readonly deployment_pin_digest: string;
  readonly payment_token: string;
  readonly payment_decimals: number;
  readonly client_address: string;
  readonly provider_address: string | null;
  readonly evaluator_address: string;
  readonly hook_address: string | null;
  readonly budget_atomic: string;
  readonly description_digest: string;
  readonly expires_at: Date | string;
  readonly state: Erc8183JobState;
  readonly deliverable_digest: string | null;
  readonly provider_binding: unknown | null;
  readonly buyer_approval_address: string | null;
  readonly buyer_approval_result_digest: string | null;
  readonly buyer_approved_at: Date | string | null;
  readonly funding_transaction_hash: string | null;
  readonly submission_transaction_hash: string | null;
  readonly completion_transaction_hash: string | null;
  readonly rejection_transaction_hash: string | null;
  readonly refund_transaction_hash: string | null;
  readonly last_observed_block: number | string | null;
  readonly last_observed_block_hash: string | null;
  readonly last_observed_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
};

type JobIdRow = { readonly id: string; readonly commerce_job_id?: string };

type EventRow = {
  readonly chain_id: number;
  readonly commerce_contract: string;
  readonly erc8183_job_id: string;
  readonly event_id: string;
  readonly event_key: string;
  readonly event_type: string;
  readonly previous_state: Erc8183JobState | null;
  readonly next_state: Erc8183JobState | null;
  readonly actor_address: string | null;
  readonly transaction_hash: string | null;
  readonly block_number: number | string | null;
  readonly block_hash: string | null;
  readonly log_index: number | null;
  readonly confirmation_state: "provisional" | "canonical" | "orphaned";
  readonly payload_digest: string;
  readonly payload: unknown;
  readonly correlation_id: string;
  readonly observed_at: Date | string;
};

const jobSelect = `
  SELECT id, commerce_job_id, chain_id, commerce_contract, erc8183_job_id,
    spec_revision, abi_hash, evaluator_profile, confirmation_threshold,
    min_expiry_lead_seconds, max_expiry_horizon_seconds, min_budget_atomic,
    max_budget_atomic, deployment_pin_digest, payment_token, payment_decimals,
    client_address, provider_address, evaluator_address, hook_address,
    budget_atomic, description_digest, expires_at, state, deliverable_digest,
    provider_binding, buyer_approval_address, buyer_approval_result_digest, buyer_approved_at,
    funding_transaction_hash, submission_transaction_hash,
    completion_transaction_hash, rejection_transaction_hash,
    refund_transaction_hash, last_observed_block, last_observed_block_hash,
    last_observed_at, "createdAt" AS created_at, "updatedAt" AS updated_at
  FROM erc8183_jobs
`;

function asUnix(value: Date | string | null, label: string): number | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  const unix = Math.floor(date.getTime() / 1_000);
  if (!Number.isSafeInteger(unix) || unix <= 0) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} timestamp is invalid.` });
  return unix;
}

function asHash(value: string | null, label: string): `0x${string}` | null {
  if (value === null) return null;
  if (!/^0x[0-9a-f]{64}$/iu.test(value)) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: `The persisted ${label} is invalid.` });
  return value.toLowerCase() as `0x${string}`;
}

function rowToJob(row: JobRow): Erc8183JobRecord {
  if (row.chain_id !== 56 && row.chain_id !== 97) throw new CommerceError({ code: "INVALID_CHAIN", message: "The persisted job uses an unsupported chain." });
  const deploymentPin = parseEnabledDeploymentPin({
    enabled: true,
    chainId: row.chain_id,
    specRevision: row.spec_revision,
    commerceContract: row.commerce_contract,
    paymentToken: row.payment_token,
    paymentDecimals: row.payment_decimals,
    abiHash: row.abi_hash,
    evaluatorProfile: row.evaluator_profile,
    confirmationThreshold: row.confirmation_threshold,
    minExpiryLeadSeconds: row.min_expiry_lead_seconds,
    maxExpiryHorizonSeconds: row.max_expiry_horizon_seconds,
    minBudgetAtomic: row.min_budget_atomic,
    maxBudgetAtomic: row.max_budget_atomic
  });
  const createdAtUnix = asUnix(row.created_at, "created") ?? 0;
  const updatedAtUnix = asUnix(row.updated_at, "updated") ?? createdAtUnix;
  const expiresAtUnix = asUnix(row.expires_at, "expiry") ?? 0;
  const lastObservedAtUnix = asUnix(row.last_observed_at, "last observed");
  let providerBinding = null;
  if (row.provider_binding !== null) {
    try { providerBinding = erc8183ProviderBindingSchema.parse(row.provider_binding); } catch (cause) { throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted provider identity binding is invalid.", cause }); }
  }
  return erc8183JobRecordSchema.parse({
    jobKey: { chainId: row.chain_id, commerceContract: row.commerce_contract, jobId: row.erc8183_job_id },
    terms: {
      chainId: row.chain_id,
      commerceContract: row.commerce_contract,
      paymentToken: row.payment_token,
      paymentDecimals: row.payment_decimals,
      clientAddress: row.client_address,
      providerAddress: row.provider_address,
      evaluatorAddress: row.evaluator_address,
      hookAddress: row.hook_address,
      budgetAtomic: row.budget_atomic,
      descriptionDigest: row.description_digest,
      expiresAtUnix
    },
    deploymentPin,
    deploymentPinDigest: row.deployment_pin_digest,
    state: row.state,
    createdAtUnix,
    updatedAtUnix,
    deliverableDigest: row.deliverable_digest,
    providerBinding,
    buyerApproval: row.buyer_approval_address === null || row.buyer_approval_result_digest === null || row.buyer_approved_at === null ? null : {
      buyerAddress: row.buyer_approval_address,
      resultDigest: row.buyer_approval_result_digest,
      approvedAtUnix: asUnix(row.buyer_approved_at, "buyer approval") ?? 0
    },
    fundingTransactionHash: asHash(row.funding_transaction_hash, "funding transaction hash"),
    submissionTransactionHash: asHash(row.submission_transaction_hash, "submission transaction hash"),
    completionTransactionHash: asHash(row.completion_transaction_hash, "completion transaction hash"),
    rejectionTransactionHash: asHash(row.rejection_transaction_hash, "rejection transaction hash"),
    refundTransactionHash: asHash(row.refund_transaction_hash, "refund transaction hash"),
    lastObservedBlock: row.last_observed_block === null ? null : String(row.last_observed_block),
    lastObservedBlockHash: asHash(row.last_observed_block_hash, "last observed block hash"),
    lastObservedAtUnix
  });
}

function rowToEvent(row: EventRow): Erc8183JobEvent {
  const observedAtUnix = asUnix(row.observed_at, "event observed") ?? 0;
  return erc8183JobEventSchema.parse({
    eventId: row.event_id,
    eventKey: row.event_key,
    jobKey: {
      chainId: row.chain_id,
      commerceContract: row.commerce_contract,
      jobId: row.erc8183_job_id
    },
    eventType: row.event_type,
    previousState: row.previous_state,
    nextState: row.next_state,
    actorAddress: row.actor_address,
    transactionHash: row.transaction_hash,
    blockNumber: row.block_number === null ? null : String(row.block_number),
    blockHash: row.block_hash,
    logIndex: row.log_index,
    confirmationState: row.confirmation_state,
    payloadDigest: row.payload_digest,
    payload: row.payload,
    correlationId: row.correlation_id,
    observedAtUnix
  });
}

function jsonPayload(value: unknown): string {
  try { return JSON.stringify(value ?? {}) ?? "{}"; } catch (cause) { throw new CommerceError({ code: "INVALID_JOB", message: "The commerce event payload is not serializable.", cause }); }
}

function eventValues(event: Erc8183JobEvent, jobRowId: string): readonly unknown[] {
  const parsed = erc8183JobEventSchema.parse(event);
  return [jobRowId, parsed.eventKey, parsed.eventType, parsed.previousState, parsed.nextState, parsed.actorAddress, parsed.transactionHash, parsed.blockNumber, parsed.blockHash, parsed.logIndex, parsed.confirmationState, parsed.payloadDigest, jsonPayload(parsed.payload), parsed.correlationId, new Date(parsed.observedAtUnix * 1_000)];
}

function assertEventMatchesJob(event: Erc8183JobEvent, job: Erc8183JobRecord, previousState?: Erc8183JobState): void {
  if (canonicalSha256Hex(event.jobKey) !== canonicalSha256Hex(job.jobKey)) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 event belongs to a different protocol job." });
  if (previousState !== undefined && event.previousState !== previousState) throw new CommerceError({ code: "STALE_JOB", message: "The ERC-8183 event previous state does not match the expected state.", retriable: true, nextAction: "reconcile_job" });
  if (event.nextState !== job.state) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 event next state does not match the persisted job." });
}

function jobValues(input: PersistentErc8183JobCreateInput | PersistentErc8183JobTransitionInput): readonly unknown[] {
  const job = input.job;
  const pin = parseEnabledDeploymentPin(job.deploymentPin);
  assertDeploymentPinSnapshot(job.deploymentPin, job.deploymentPinDigest, pin);
  assertPinMatchesJob(job.terms, pin);
  assertBudgetMatchesPin(job.terms.budgetAtomic, pin);
  return [
    ...("commerceJobId" in input ? [input.commerceJobId] : []),
    job.jobKey.chainId,
    job.jobKey.commerceContract,
    job.jobKey.jobId,
    pin.specRevision,
    pin.abiHash,
    pin.evaluatorProfile,
    pin.confirmationThreshold,
    pin.minExpiryLeadSeconds,
    pin.maxExpiryHorizonSeconds,
    pin.minBudgetAtomic,
    pin.maxBudgetAtomic,
    job.deploymentPinDigest,
    job.terms.paymentToken,
    job.terms.paymentDecimals,
    job.terms.clientAddress,
    job.terms.providerAddress,
    job.terms.evaluatorAddress,
    job.terms.hookAddress,
    job.terms.budgetAtomic,
    job.terms.descriptionDigest,
    new Date(job.terms.expiresAtUnix * 1_000),
    job.state,
    job.deliverableDigest,
    job.providerBinding ?? null,
    job.buyerApproval?.buyerAddress ?? null,
    job.buyerApproval?.resultDigest ?? null,
    job.buyerApproval === null ? null : new Date(job.buyerApproval.approvedAtUnix * 1_000),
    job.fundingTransactionHash,
    job.submissionTransactionHash,
    job.completionTransactionHash,
    job.rejectionTransactionHash,
    job.refundTransactionHash,
    job.lastObservedBlock,
    job.lastObservedBlockHash,
    job.lastObservedAtUnix === null ? null : new Date(job.lastObservedAtUnix * 1_000),
    new Date(job.createdAtUnix * 1_000),
    new Date(job.updatedAtUnix * 1_000)
  ];
}

/** PostgreSQL projection for canonical ERC-8183 jobs and append-only events. */
export class PostgresErc8183JobRepository {
  public constructor(private readonly pool: Erc8183OperationQueryPool) {}

  /** Keep the buyer-facing parent bound to the same confirmed funding proof. */
  private async syncMarketplaceFunding(
    client: Erc8183OperationQueryClient,
    input: PersistentErc8183JobCreateInput,
    job: Erc8183JobRecord
  ): Promise<void> {
    if (job.state === "open" || job.fundingTransactionHash === null) return;
    const result = await client.query<{ readonly id: string }>(`
      UPDATE commerce_jobs
      SET erc8183_job_id = $2,
          status = CASE WHEN status IN ('draft', 'negotiating') THEN 'funded' ELSE status END,
          funding_transaction_hash = COALESCE(funding_transaction_hash, $3),
          "updatedAt" = now()
      WHERE id = $1
        AND (funding_transaction_hash IS NULL OR funding_transaction_hash = $3)
        AND (erc8183_job_id = $2 OR erc8183_job_id LIKE 'draft:%' OR erc8183_job_id LIKE 'intent:%')
      RETURNING id
    `, [input.commerceJobId, job.jobKey.jobId, job.fundingTransactionHash]);
    if (result.rows[0] === undefined) {
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The confirmed funding proof could not be bound to its parent commerce reservation.", transactionHash: job.fundingTransactionHash as `0x${string}`, nextAction: "manual_review" });
    }
  }

  public async get(jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<Erc8183JobRecord | null> {
    const result = await this.pool.query<JobRow>(`${jobSelect} WHERE chain_id = $1 AND commerce_contract = $2 AND erc8183_job_id = $3`, [jobKey.chainId, normalizeAddress(jobKey.commerceContract, "commerce contract"), jobKey.jobId]);
    return result.rows[0] === undefined ? null : rowToJob(result.rows[0]);
  }

  /**
   * Return only the canonical, receipt-backed submission event for a job.
   * Submission events are written after the Altana SDK receipt and protocol
   * state have been verified, so this query is safe for the reload/status API.
   */
  public async getConfirmedSubmissionEvent(jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<Erc8183JobEvent | null> {
    const result = await this.pool.query<EventRow>(`
      SELECT
        j.chain_id,
        j.commerce_contract,
        j.erc8183_job_id,
        e.id AS event_id,
        e.event_key,
        e.event_type,
        e.previous_state,
        e.next_state,
        e.actor_address,
        e.transaction_hash,
        e.block_number,
        e.block_hash,
        e.log_index,
        e.confirmation_state,
        e.payload_digest,
        e.payload,
        e.correlation_id,
        e.observed_at
      FROM erc8183_job_events e
      JOIN erc8183_jobs j ON j.id = e.erc8183_job_id
      WHERE j.chain_id = $1
        AND j.commerce_contract = $2
        AND j.erc8183_job_id = $3
        AND e.event_type = 'job_submitted'
        AND e.confirmation_state = 'canonical'
        AND e.transaction_hash IS NOT NULL
        AND e.block_number IS NOT NULL
        AND e.block_hash IS NOT NULL
      ORDER BY e.observed_at DESC, e.id DESC
      LIMIT 1
    `, [jobKey.chainId, normalizeAddress(jobKey.commerceContract, "commerce contract"), jobKey.jobId]);
    return result.rows[0] === undefined ? null : rowToEvent(result.rows[0]);
  }

  public async create(input: PersistentErc8183JobCreateInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    const job = erc8183JobRecordSchema.parse(input.job);
    const event = erc8183JobEventSchema.parse(input.event);
    assertEventMatchesJob(event, job);
    const existing = await this.get(job.jobKey);
    if (existing !== null) {
      if (canonicalSha256Hex(existing) !== canonicalSha256Hex(job)) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "An ERC-8183 protocol job already exists with different terms." });
      if (existing.fundingTransactionHash !== null) await this.syncMarketplaceFunding(this.pool, input, existing);
      return { job: existing, replayed: true };
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<JobIdRow>(`
        INSERT INTO erc8183_jobs (
          commerce_job_id, chain_id, commerce_contract, erc8183_job_id,
          spec_revision, abi_hash, evaluator_profile, confirmation_threshold,
          min_expiry_lead_seconds, max_expiry_horizon_seconds, min_budget_atomic,
          max_budget_atomic, deployment_pin_digest, payment_token, payment_decimals,
          client_address, provider_address, evaluator_address, hook_address,
          budget_atomic, description_digest, expires_at, state, deliverable_digest,
          provider_binding, buyer_approval_address, buyer_approval_result_digest, buyer_approved_at,
          funding_transaction_hash, submission_transaction_hash, completion_transaction_hash,
          rejection_transaction_hash, refund_transaction_hash, last_observed_block,
          last_observed_block_hash, last_observed_at, "createdAt", "updatedAt"
        ) VALUES (${Array.from({ length: 38 }, (_, index) => `$${index + 1}`).join(", ")}) RETURNING id
      `, jobValues(input));
      const protocolRow = inserted.rows[0];
      if (protocolRow === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted ERC-8183 job insert returned no row." });
      await client.query(`
        INSERT INTO erc8183_job_events (
          erc8183_job_id, event_key, event_type, previous_state, next_state,
          actor_address, transaction_hash, block_number, block_hash, log_index,
          confirmation_state, payload_digest, payload, correlation_id, observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
      `, eventValues(event, protocolRow.id));
      await this.syncMarketplaceFunding(client, input, job);
      await client.query("COMMIT");
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* retain original error */ }
      if (isUniqueViolation(cause)) {
        const replay = await this.get(job.jobKey);
        if (replay !== null && canonicalSha256Hex(replay) === canonicalSha256Hex(job)) return { job: replay, replayed: true };
      }
      if (cause instanceof CommerceError) throw cause;
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The ERC-8183 job could not be persisted.", cause });
    } finally { client.release(); }
    return { job, replayed: false };
  }

  public async approveResult(input: { readonly jobKey: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }; readonly actorAddress: string; readonly resultDigest: string; readonly nowUnix: number }): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    const current = await this.get(input.jobKey);
    if (current === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The ERC-8183 job does not exist." });
    const next = approveErc8183Result({ job: current, actorAddress: input.actorAddress, resultDigest: input.resultDigest, nowUnix: input.nowUnix });
    if (current.buyerApproval !== null) return { job: current, replayed: true };
    const updated = await this.pool.query<{ readonly id: string }>(`
      UPDATE erc8183_jobs SET buyer_approval_address = $4, buyer_approval_result_digest = $5,
        buyer_approved_at = $6, "updatedAt" = $7
      WHERE chain_id = $1 AND commerce_contract = $2 AND erc8183_job_id = $3
        AND state = 'submitted' AND buyer_approval_address IS NULL RETURNING id
    `, [input.jobKey.chainId, normalizeAddress(input.jobKey.commerceContract, "commerce contract"), input.jobKey.jobId, next.buyerApproval?.buyerAddress ?? null, next.buyerApproval?.resultDigest ?? null, new Date(input.nowUnix * 1_000), new Date(input.nowUnix * 1_000)]);
    const persisted = await this.get(input.jobKey);
    if (persisted === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The buyer approval disappeared during persistence." });
    if (updated.rowCount === 0 && persisted.buyerApproval === null) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "Another buyer approval won the concurrent update." });
    if (persisted.buyerApproval === null) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The buyer approval was not persisted." });
    return { job: persisted, replayed: updated.rowCount === 0 };
  }

  public async assertBuyerApproval(input: { readonly chainId: 56 | 97; readonly commerceContract: string; readonly jobId: string }): Promise<void> {
    const job = await this.get(input);
    if (job === null) throw new CommerceError({ code: "UNKNOWN_JOB", message: "The ERC-8183 job does not exist." });
    if (job.buyerApproval === null || job.deliverableDigest === null || job.buyerApproval.resultDigest.toLowerCase() !== job.deliverableDigest.toLowerCase() || job.buyerApproval.buyerAddress.toLowerCase() !== job.terms.clientAddress.toLowerCase()) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "Settlement requires persisted buyer approval for the exact submitted result.", nextAction: "approve_result" });
  }

  public async transition(input: PersistentErc8183JobTransitionInput): Promise<{ readonly job: Erc8183JobRecord; readonly replayed: boolean }> {
    const job = erc8183JobRecordSchema.parse(input.job);
    const event = erc8183JobEventSchema.parse(input.event);
    assertEventMatchesJob(event, job, input.previousState);
    const existingEvent = await this.pool.query<{ readonly id: string }>("SELECT id FROM erc8183_job_events WHERE event_key = $1", [event.eventKey]);
    if (existingEvent.rows[0] !== undefined) {
      const current = await this.get(job.jobKey);
      if (current !== null && canonicalSha256Hex(current) === canonicalSha256Hex(job)) return { job: current, replayed: true };
      throw new CommerceError({ code: "EVENT_CONFLICT", message: "The ERC-8183 event key was reused for different state." });
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<JobIdRow>(`
        UPDATE erc8183_jobs SET provider_address = $4, budget_atomic = $5, state = $6,
          deliverable_digest = $7, provider_binding = $8, buyer_approval_address = $9,
          buyer_approval_result_digest = $10, buyer_approved_at = $11,
          funding_transaction_hash = $12, submission_transaction_hash = $13,
          completion_transaction_hash = $14, rejection_transaction_hash = $15,
          refund_transaction_hash = $16, last_observed_block = $17,
          last_observed_block_hash = $18, last_observed_at = $19, "updatedAt" = $20
        WHERE chain_id = $1 AND commerce_contract = $2 AND erc8183_job_id = $3 AND state = $21 RETURNING id, commerce_job_id
      `, [job.jobKey.chainId, job.jobKey.commerceContract, job.jobKey.jobId, job.terms.providerAddress, job.terms.budgetAtomic, job.state, job.deliverableDigest, job.providerBinding ?? null, job.buyerApproval?.buyerAddress ?? null, job.buyerApproval?.resultDigest ?? null, job.buyerApproval === null ? null : new Date(job.buyerApproval.approvedAtUnix * 1_000), job.fundingTransactionHash, job.submissionTransactionHash, job.completionTransactionHash, job.rejectionTransactionHash, job.refundTransactionHash, job.lastObservedBlock, job.lastObservedBlockHash, job.lastObservedAtUnix === null ? null : new Date(job.lastObservedAtUnix * 1_000), new Date(job.updatedAtUnix * 1_000), input.previousState]);
      const protocolRow = updated.rows[0];
      if (protocolRow === undefined) throw new CommerceError({ code: "STALE_JOB", message: "The persisted ERC-8183 job is not in the expected state.", retriable: true, nextAction: "reconcile_job" });
      await client.query(`
        INSERT INTO erc8183_job_events (
          erc8183_job_id, event_key, event_type, previous_state, next_state,
          actor_address, transaction_hash, block_number, block_hash, log_index,
          confirmation_state, payload_digest, payload, correlation_id, observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
        `, eventValues(event, protocolRow.id));
      if (event.eventType === "job_submitted") {
        if (protocolRow.commerce_job_id === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted ERC-8183 job has no BNBEra commerce job binding." });
        await persistMarketplaceSubmissionProjection(client, { jobRecordId: protocolRow.id, commerceJobId: protocolRow.commerce_job_id, job, event });
      } else if (event.eventType === "job_completed") {
        if (protocolRow.commerce_job_id === undefined) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The persisted ERC-8183 job has no BNBEra commerce job binding." });
        await persistMarketplaceSettlementProjection(client, { jobRecordId: protocolRow.id, commerceJobId: protocolRow.commerce_job_id, job, event });
      }
      await client.query("COMMIT");
    } catch (cause) {
      try { await client.query("ROLLBACK"); } catch { /* retain original error */ }
      if (cause instanceof CommerceError) throw cause;
      if (isUniqueViolation(cause)) {
        const current = await this.get(job.jobKey);
        if (current !== null && canonicalSha256Hex(current) === canonicalSha256Hex(job)) return { job: current, replayed: true };
      }
      throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The ERC-8183 job transition could not be persisted.", cause });
    } finally { client.release(); }
    return { job, replayed: false };
  }
}

function isUniqueViolation(value: unknown): boolean {
  return typeof value === "object" && value !== null && "code" in value && (value as { readonly code?: unknown }).code === "23505";
}
