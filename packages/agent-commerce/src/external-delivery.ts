import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import type { Erc8183OperationQueryPool } from "./operations.js";
import { ExternalErc8183SellerAdapter, type ExternalSellerQuote } from "./external-seller.js";

export type ExternalDeliveryState = { status: "claimed" | "notified" | "unknown" | "result_verified"; quoteDigest: string; protocolJobId: string };
export interface ExternalDeliveryStore {
  claim(input: { commerceJobId: string; buyerUserId: string; protocolJobId: string; quoteDigest: string }): Promise<{ claimed: boolean; state: ExternalDeliveryState }>;
  finish(input: { commerceJobId: string; buyerUserId: string; quoteDigest: string; status: "notified" | "unknown"; responseDigest: string | null }): Promise<void>;
}
export class PostgresExternalDeliveryStore implements ExternalDeliveryStore {
  constructor(private readonly db: Pick<Erc8183OperationQueryPool, "query">) {}
  async claim(input: { commerceJobId: string; buyerUserId: string; protocolJobId: string; quoteDigest: string }) {
    const inserted = await this.db.query(`INSERT INTO external_seller_deliveries(commerce_job_id,buyer_user_id,protocol_job_id,quote_digest,status)
      VALUES($1,$2,$3,$4,'claimed') ON CONFLICT(commerce_job_id) DO NOTHING RETURNING commerce_job_id`, [input.commerceJobId, input.buyerUserId, input.protocolJobId, input.quoteDigest]);
    const rows = await this.db.query<{ status: ExternalDeliveryState["status"]; quote_digest: string; protocol_job_id: string }>(`SELECT status,quote_digest,protocol_job_id FROM external_seller_deliveries WHERE commerce_job_id=$1 AND buyer_user_id=$2`, [input.commerceJobId, input.buyerUserId]);
    const row = rows.rows[0];
    if (!row || row.quote_digest !== input.quoteDigest || row.protocol_job_id !== input.protocolJobId) throw new CommerceError({ code: "IDEMPOTENCY_CONFLICT", message: "The durable seller delivery claim belongs to different immutable job terms." });
    return { claimed: inserted.rows.length === 1, state: { status: row.status, quoteDigest: row.quote_digest, protocolJobId: row.protocol_job_id } };
  }
  async finish(input: { commerceJobId: string; buyerUserId: string; quoteDigest: string; status: "notified" | "unknown"; responseDigest: string | null }): Promise<void> {
    const result = await this.db.query(`UPDATE external_seller_deliveries SET status=$4,response_digest=$5,"updatedAt"=now()
      WHERE commerce_job_id=$1 AND buyer_user_id=$2 AND quote_digest=$3 AND status='claimed' RETURNING commerce_job_id`, [input.commerceJobId, input.buyerUserId, input.quoteDigest, input.status, input.responseDigest]);
    if (result.rows.length !== 1) throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The seller notification requires reconciliation of its durable claim." });
  }
}

/** Only called by an explicit, server-authenticated buyer action. A crash after
 * claim or POST is never interpreted as permission to repeat execution. */
export async function notifyExternalSellerOnce(input: { adapter: ExternalErc8183SellerAdapter; store: ExternalDeliveryStore; commerceJobId: string; buyerUserId: string; buyerAddress: string; jobId: string; quote: ExternalSellerQuote }): Promise<{ status: ExternalDeliveryState["status"]; replayed: boolean }> {
  await input.adapter.assertJob(input.quote, input.jobId, input.buyerAddress, ["FUNDED", "SUBMITTED", "COMPLETED"]);
  const quoteDigest = canonicalSha256Hex(input.quote);
  const claim = await input.store.claim({ commerceJobId: input.commerceJobId, buyerUserId: input.buyerUserId, protocolJobId: input.jobId, quoteDigest });
  if (!claim.claimed) return { status: claim.state.status, replayed: true };
  try {
    const notified = await input.adapter.notifyFunded({ quote: input.quote, jobId: input.jobId, buyerAddress: input.buyerAddress });
    await input.store.finish({ commerceJobId: input.commerceJobId, buyerUserId: input.buyerUserId, quoteDigest, status: "notified", responseDigest: notified.responseDigest });
    return { status: "notified", replayed: false };
  } catch (cause) {
    await input.store.finish({ commerceJobId: input.commerceJobId, buyerUserId: input.buyerUserId, quoteDigest, status: "unknown", responseDigest: null });
    throw new CommerceError({ code: "RECONCILIATION_REQUIRED", message: "The seller delivery outcome is unknown. The saved claim prevents duplicate work; refresh the job and result.", nextAction: "reconcile_job", cause });
  }
}
