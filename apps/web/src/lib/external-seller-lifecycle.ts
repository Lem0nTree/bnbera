import { randomUUID } from "node:crypto";
import { canonicalSha256Hex, erc8004IdentityKey } from "@bnbera/domain";
import { createPublicClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { CommerceError, ExternalErc8183SellerAdapter, externalSellerQuoteSchema, externalSellerDeliverableUrl, PostgresExternalDeliveryStore, notifyExternalSellerOnce, PostgresErc8183JobRepository, erc8183JobRecordSchema, createErc8183JobEvent,
  type Erc8183AltanaAdapter, type Erc8183CommerceService, type PostgresErc8183OperationRepository, type Erc8183OperationQueryPool } from "@bnbera/agent-commerce";
import { commerceQuoteSnapshotSchema } from "./commerce-quote-contract";
import { createExternalSellerTransport } from "./external-seller-transport";

type Buyer = { userId: string; requesterAddress: string };
type Row = { id: string; quote: unknown; price: string; task_input_digest: string; funding_transaction_hash: string | null };
const submittedEvent = parseAbiItem("event JobSubmitted(uint256 indexed jobId,address indexed provider,bytes32 deliverable)");

/** Mainnet external delivery is buyer-owned. The server can notify a provider
 * once and verify public receipts/results; it has no transaction signer. */
export class ExternalSellerLifecycle {
  constructor(private readonly deps: { pool: Erc8183OperationQueryPool; chain: Erc8183AltanaAdapter; service: Erc8183CommerceService; operations: PostgresErc8183OperationRepository; rpcUrl: string }) {}
  private async bound(jobId: string, buyer: Buyer) {
    const rows = await this.deps.pool.query<Row>(`SELECT c.id,c.quote,c.price,c.task_input_digest,c.funding_transaction_hash FROM commerce_jobs c JOIN erc8183_jobs j ON j.commerce_job_id=c.id
      WHERE c.buyer_user_id=$1 AND j.chain_id=56 AND lower(j.commerce_contract)=lower($2) AND j.erc8183_job_id=$3`, [buyer.userId, this.deps.chain.pin.commerceContract, jobId]);
    if (rows.rows.length !== 1 || this.deps.chain.pin.chainId !== 56) throw new CommerceError({ code: "UNAUTHORIZED_ACTOR", message: "This external job does not belong to the authenticated buyer and deployment." });
    const row = rows.rows[0]!; const snapshot = commerceQuoteSnapshotSchema.parse(row.quote);
    if (!snapshot.externalSeller) throw new CommerceError({ code: "INVALID_QUOTE", message: "This job has no immutable external seller offer." });
    const quote = externalSellerQuoteSchema.parse(JSON.parse(snapshot.externalSeller.signedOffer));
    if (erc8004IdentityKey(snapshot.identity) !== erc8004IdentityKey(quote.identity) || snapshot.chainId !== quote.chainId || snapshot.task !== quote.signedDescription || snapshot.taskDigest !== quote.descriptionDigest || row.task_input_digest !== quote.descriptionDigest || row.price !== quote.priceAtomic || snapshot.priceAtomic !== quote.priceAtomic || snapshot.providerAddress.toLowerCase() !== quote.providerAddress.toLowerCase()) throw new CommerceError({ code: "INVALID_QUOTE", message: "The external job snapshot failed immutable offer verification." });
    const binding = { identity: quote.identity, providerAddress: quote.providerAddress, endpoint: quote.endpoint, resultBaseUrl: quote.resultBaseUrl,
      commerceContract: this.deps.chain.pin.commerceContract, routerContract: this.deps.chain.routerContract, policyContract: this.deps.chain.policyContract, paymentToken: this.deps.chain.paymentToken, maxPriceAtomic: this.deps.chain.pin.maxBudgetAtomic };
    const seller = new ExternalErc8183SellerAdapter(binding, { transport: createExternalSellerTransport(), randomId: randomUUID,
      readIdentity: async () => { throw new CommerceError({ code: "COMMERCE_DISABLED", message: "Delivery cannot negotiate or change an already funded provider." }); },
      readJob: async id => { await this.deps.chain.verifyNetwork(); const job = await this.deps.chain.readJob(id); return { jobId: job.id, chainId: 56, commerceContract: binding.commerceContract, client: job.client, provider: job.provider, paymentToken: binding.paymentToken, budgetAtomic: job.budgetAtomic, description: job.description, state: job.status, deliverable: job.chainDeliverable }; } });
    return { row, quote, seller };
  }
  async notify(jobId: string, buyer: Buyer) {
    const bound = await this.bound(jobId, buyer);
    return notifyExternalSellerOnce({ adapter: bound.seller, store: new PostgresExternalDeliveryStore(this.deps.pool), commerceJobId: bound.row.id, buyerUserId: buyer.userId, buyerAddress: buyer.requesterAddress, jobId, quote: bound.quote });
  }
  /** Observe permissionless settlement/refund; never fabricate a buyer-signed
   * operation or approval. The caller supplies public receipt evidence only. */
  async reconcileTerminal(jobId: string, buyer: Buyer, transactionHash: Hex) {
    const bound = await this.bound(jobId, buyer);
    await bound.seller.assertQuote(bound.quote);
    const checked = await this.deps.chain.verifyPublicTerminalReceipt({ transactionHash, jobId, client: buyer.requesterAddress, provider: bound.quote.providerAddress, budgetAtomic: bound.quote.priceAtomic, description: bound.quote.signedDescription });
    const rpc = createPublicClient({ transport: http(this.deps.rpcUrl, { timeout: 12000, retryCount: 1 }) });
    const [finalized, block, transaction] = await Promise.all([rpc.getBlock({ blockTag: "finalized" }), rpc.getBlock({ blockNumber: checked.receipt.blockNumber }), rpc.getTransaction({ hash: transactionHash })]);
    if (checked.receipt.blockNumber > finalized.number || block.hash !== checked.receipt.blockHash || transaction.blockHash !== checked.receipt.blockHash) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The terminal transaction must have a canonical finalized receipt." });
    const jobs = new PostgresErc8183JobRepository(this.deps.pool);
    const jobKey = { chainId: 56 as const, commerceContract: this.deps.chain.pin.commerceContract, jobId };
    const current = await jobs.get(jobKey);
    if (!current || current.terms.clientAddress.toLowerCase() !== buyer.requesterAddress.toLowerCase() || current.terms.descriptionDigest !== bound.quote.descriptionDigest || current.terms.budgetAtomic !== bound.quote.priceAtomic) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The canonical hire does not match this signed offer." });
    const field = checked.state === "completed" ? "completionTransactionHash" : "refundTransactionHash";
    if (current.state === checked.state) {
      if (current[field]?.toLowerCase() !== transactionHash.toLowerCase()) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "This outcome is already bound to another receipt." });
      return { status: checked.state, replayed: true };
    }
    if (checked.state === "completed" && (current.state !== "submitted" || !current.deliverableDigest)) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "Retrieve and hash-verify the provider result before recording this completed settlement." });
    if (checked.state === "completed") {
      const snapshot = commerceQuoteSnapshotSchema.parse(bound.row.quote);
      const result = await this.deps.pool.query<{ submission_transaction_hash: Hex; submission_block_hash: Hex }>(`SELECT submission_transaction_hash,submission_block_hash FROM commerce_job_results
        WHERE commerce_job_id=$1 AND chain_id=56 AND lower(commerce_contract)=lower($2) AND protocol_job_id=$3 AND buyer_user_id=$4
          AND lower(buyer_address)=lower($5) AND lower(provider_address)=lower($6) AND identity_namespace=$7 AND identity_chain_id=56
          AND lower(identity_registry)=lower($8) AND identity_agent_id=$9 AND agent_version_id=$10 AND agent_version=$11
          AND result_sha256=$12 AND lower(result_keccak)=lower($13) AND state='submitted'`,
      [bound.row.id, jobKey.commerceContract, jobId, buyer.userId, buyer.requesterAddress, bound.quote.providerAddress, snapshot.identity.namespace,
        snapshot.identity.identityRegistry, snapshot.identity.agentId, snapshot.agentVersionId, snapshot.agentVersion, current.deliverableDigest, checked.job.chainDeliverable]);
      if (result.rows.length !== 1 || result.rows[0]!.submission_transaction_hash !== current.submissionTransactionHash) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The locally verified result does not match this canonical settlement's exact deliverable and provider identity." });
      const submission = await this.deps.chain.verifyReceiptForOperation({ transactionHash: result.rows[0]!.submission_transaction_hash, kind: "submit", jobId, signerAddress: bound.quote.providerAddress, expectation: { digest: checked.job.chainDeliverable } });
      const submissionBlock = await rpc.getBlock({ blockNumber: submission.receipt.blockNumber });
      if (submission.receipt.blockNumber > finalized.number || submission.receipt.blockHash !== submissionBlock.hash || submission.receipt.blockHash !== result.rows[0]!.submission_block_hash) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The stored provider submission is not finalized canonical evidence." });
    }
    if (!["funded", "submitted"].includes(current.state)) throw new CommerceError({ code: "STALE_JOB", message: "The local job cannot transition from this state." });
    const observedAtUnix = Math.max(current.updatedAtUnix, Math.floor(Date.now() / 1000));
    const next = erc8183JobRecordSchema.parse({ ...current, state: checked.state, buyerApproval: checked.state === "completed" ? current.buyerApproval : null, [field]: transactionHash,
      ...(checked.state === "rejected" ? { rejectionTransactionHash: transactionHash } : {}), updatedAtUnix: observedAtUnix,
      lastObservedBlock: checked.receipt.blockNumber.toString(), lastObservedBlockHash: checked.receipt.blockHash, lastObservedAtUnix: observedAtUnix });
    const event = createErc8183JobEvent({ eventKey: `public-terminal:${transactionHash}:${jobId}`, jobKey, eventType: checked.state === "completed" ? "job_completed" : checked.state === "rejected" ? "job_rejected" : "job_expired", previousState: current.state, nextState: checked.state,
      actorAddress: checked.state === "completed" ? checked.job.evaluator : checked.job.client, transactionHash, blockNumber: checked.receipt.blockNumber.toString(), blockHash: checked.receipt.blockHash,
      payload: { source: "finalized-public-chain", transactionSender: transaction.from, actorRole: checked.state === "completed" ? "evaluator" : "refund_beneficiary", buyerApprovalRecorded: false }, correlationId: randomUUID(), observedAtUnix });
    await jobs.transition({ job: next, previousState: current.state, event });
    return { status: checked.state, replayed: false };
  }
  async refresh(jobId: string, buyer: Buyer, suppliedTransactionHash?: Hex) {
    const bound = await this.bound(jobId, buyer);
    const chainJob = await bound.seller.assertJob(bound.quote, jobId, buyer.requesterAddress, ["FUNDED", "SUBMITTED", "COMPLETED", "REJECTED"]);
    if (chainJob.state === "FUNDED" || !chainJob.deliverable) return { status: "awaiting_provider" as const };
    const store = new PostgresExternalDeliveryStore(this.deps.pool);
    // Claim before recording a result even when an independently watching
    // provider submitted without the buyer pressing Notify.
    await store.claim({ commerceJobId: bound.row.id, buyerUserId: buyer.userId, protocolJobId: jobId, quoteDigest: canonicalSha256Hex(bound.quote) });
    let transactionHash = suppliedTransactionHash;
    if (!transactionHash) {
      if (!bound.row.funding_transaction_hash) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The funded job receipt must be reconciled before retrieving work." });
      const funded = await this.deps.chain.getTransactionReceipt(bound.row.funding_transaction_hash as Hex);
      if (!funded) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The funding receipt is temporarily unavailable." });
      const rpc = createPublicClient({ transport: http(this.deps.rpcUrl, { timeout: 12000, retryCount: 1 }) });
      const finalized = await rpc.getBlock({ blockTag: "finalized" });
      const cursor = await this.deps.pool.query<{ last_checked_block: string | null }>(`SELECT last_checked_block FROM external_seller_deliveries WHERE commerce_job_id=$1 AND buyer_user_id=$2`, [bound.row.id, buyer.userId]);
      const last = cursor.rows[0]?.last_checked_block;
      const first = last && /^[0-9]+$/u.test(last) ? BigInt(last) + 1n : funded.blockNumber;
      // Persist successful scan windows so seven-day policy jobs do not repeat
      // only their earliest blocks. A failed RPC window never advances cursor.
      for (let from = first, count = 0; from <= finalized.number && count < 10; from += 500n, count++) {
        const to = from + 499n < finalized.number ? from + 499n : finalized.number;
        const logs = await rpc.getLogs({ address: this.deps.chain.pin.commerceContract as Address, event: submittedEvent, args: { jobId: BigInt(jobId), provider: bound.quote.providerAddress as Address }, fromBlock: from, toBlock: to, strict: true });
        const matches = logs.filter(log => log.args.deliverable === chainJob.deliverable && !log.removed);
        if (matches.length > 1) throw new CommerceError({ code: "ONCHAIN_MISMATCH", message: "The job has ambiguous submission receipt evidence." });
        if (matches[0]?.transactionHash) { transactionHash = matches[0].transactionHash; break; }
        await this.deps.pool.query(`UPDATE external_seller_deliveries SET last_checked_block=$3,"updatedAt"=now() WHERE commerce_job_id=$1 AND buyer_user_id=$2`, [bound.row.id, buyer.userId, to.toString()]);
      }
    }
    if (!transactionHash) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "Work matches the onchain digest, but its submission receipt is outside the bounded lookup. Provide the public provider submission transaction hash.", nextAction: "provide_submission_transaction" });
    await this.deps.chain.verifyReceiptForOperation({ transactionHash, kind: "submit", jobId, signerAddress: bound.quote.providerAddress, expectation: { digest: chainJob.deliverable as Hex, expectedState: "SUBMITTED" } });
    const receipt = await this.deps.chain.getTransactionReceipt(transactionHash);
    if (!receipt) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The provider submission receipt is unavailable." });
    const deliverableUrl = externalSellerDeliverableUrl({ policyContract: this.deps.chain.policyContract, jobId, deliverable: chainJob.deliverable, logs: receipt.logs ?? [] });
    const result = await bound.seller.readResult({ quote: bound.quote, jobId, buyerAddress: buyer.requesterAddress, deliverableUrl, submissionTransactionHash: transactionHash });
    const manifest = result.manifest; const resultDigest = canonicalSha256Hex(manifest);
    const context = { signerAddress: bound.quote.providerAddress as Address, sdkAction: "submit" as const, parameters: { resultDigest, chainDeliverable: result.deliverable, manifest, result: null, providerBinding: { identity: bound.quote.identity, agentVersionId: commerceQuoteSnapshotSchema.parse(bound.row.quote).agentVersionId, agentVersion: commerceQuoteSnapshotSchema.parse(bound.row.quote).agentVersion }, deliverableUrl }, expectation: { digest: result.deliverable as Hex, expectedState: "SUBMITTED" as const } };
    const reservation = await this.deps.operations.reserve({ idempotencyKey: `external-result:${bound.row.id}`, requestDigest: canonicalSha256Hex({ jobId, transactionHash, context }), chainId: 56, commerceContract: this.deps.chain.pin.commerceContract, jobId, kind: "submit", signerRole: "provider", context });
    if (reservation.operation.transactionHash && reservation.operation.transactionHash !== transactionHash) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "This result is already bound to another submission transaction." });
    if (reservation.operation.status === "awaiting_signature" || reservation.operation.status === "unknown") await this.deps.operations.markSubmitted({ operationId: reservation.operation.operationId, transactionHash });
    await this.deps.service.reconcile(reservation.operation.operationId);
    await this.deps.pool.query(`UPDATE external_seller_deliveries SET status='result_verified',result_digest=$3,"updatedAt"=now() WHERE commerce_job_id=$1 AND buyer_user_id=$2`, [bound.row.id, buyer.userId, resultDigest]);
    return { status: "result_verified" as const, resultDigest, transactionHash };
  }
}
