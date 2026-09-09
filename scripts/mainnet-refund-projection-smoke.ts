/** Local SQL-only smoke. All fixture inserts/updates are rolled back, with no
 * protocol writes, real user changes, paid work or lasting test rows. */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createErc8183JobEvent, erc8183DeploymentPinDigest, erc8183JobRecordSchema, persistMarketplaceRefundProjection } from "../packages/agent-commerce/src/index.ts";
import { readFile } from "node:fs/promises";
import { commercePinFromStandardsLock } from "../apps/web/src/lib/commerce-server.ts";
async function main() {
  if (process.env.MAINNET_REFUND_SQL_SMOKE_ENABLED !== "true") throw new Error("EXPLICIT_SMOKE_GATE_REQUIRED");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const ids: string[] = [];
  try {
    const pin = commercePinFromStandardsLock(JSON.parse(await readFile(new URL("../config/standards.lock.json", import.meta.url), "utf8")), 56);
    const seller = (await client.query(`SELECT a.id,i.agent_wallet FROM agents a JOIN erc8004_identities i ON i.id=a.identity_id WHERE i.chain_id=56 AND i.agent_id='303779' LIMIT 1`)).rows[0];
    if (!seller) throw new Error("RETAINED_SELLER_REQUIRED");
    await client.query("BEGIN");
    for (const state of ["expired", "rejected"] as const) {
      const parentId = randomUUID(); ids.push(parentId);
      const protocolId = state === "expired" ? "999999999999999991" : "999999999999999992";
      const tx = `0x${"a".repeat(64)}` as const; const blockHash = `0x${"b".repeat(64)}` as const;
      const buyer = "0x1111111111111111111111111111111111111111";
      await client.query(`INSERT INTO commerce_jobs(id,erc8183_job_id,provider_agent_id,quote,price,task_input_digest,status) VALUES($1,$2,$3,'{"fixture":"rollback-only"}',1000,$4,'funded')`, [parentId, protocolId, seller.id, "c".repeat(64)]);
      const job = erc8183JobRecordSchema.parse({ jobKey: { chainId: 56, commerceContract: pin.commerceContract, jobId: protocolId }, deploymentPin: pin, deploymentPinDigest: erc8183DeploymentPinDigest(pin), state,
        terms: { chainId: 56, commerceContract: pin.commerceContract, paymentToken: pin.paymentToken, paymentDecimals: 18, clientAddress: buyer, providerAddress: seller.agent_wallet, evaluatorAddress: "0x51895229E12F9876011789B04f8698af06cCD6DA", hookAddress: "0x51895229E12F9876011789B04f8698af06cCD6DA", budgetAtomic: "1000", descriptionDigest: "c".repeat(64), expiresAtUnix: 2000000000 },
        createdAtUnix: 1, updatedAtUnix: 2, deliverableDigest: null, providerBinding: null, buyerApproval: null, fundingTransactionHash: tx, submissionTransactionHash: null, completionTransactionHash: null, rejectionTransactionHash: state === "rejected" ? tx : null, refundTransactionHash: tx, lastObservedBlock: "1", lastObservedBlockHash: blockHash, lastObservedAtUnix: 2 });
      const event = createErc8183JobEvent({ eventKey: `rollback-smoke:${parentId}`, jobKey: job.jobKey, eventType: state === "rejected" ? "job_rejected" : "job_expired", previousState: "funded", nextState: state, actorAddress: buyer, transactionHash: tx, blockNumber: "1", blockHash, correlationId: randomUUID(), observedAtUnix: 2, payload: { fixture: "rollback-only" } });
      await persistMarketplaceRefundProjection(client, { jobRecordId: randomUUID(), commerceJobId: parentId, job, event });
      await persistMarketplaceRefundProjection(client, { jobRecordId: randomUUID(), commerceJobId: parentId, job, event });
      if ((await client.query("SELECT status FROM commerce_jobs WHERE id=$1", [parentId])).rows[0]?.status !== "cancelled") throw new Error("REFUND_PROJECTION_FAILED");
      let rejected = false;
      try { await persistMarketplaceRefundProjection(client, { jobRecordId: randomUUID(), commerceJobId: parentId, job, event: { ...event, transactionHash: `0x${"d".repeat(64)}` } }); } catch { rejected = true; }
      if (!rejected) throw new Error("MISMATCHED_REFUND_ACCEPTED");
    }
    await client.query("ROLLBACK");
    if ((await client.query("SELECT count(*)::int AS count FROM commerce_jobs WHERE id=ANY($1::uuid[])", [ids])).rows[0]?.count !== 0) throw new Error("SMOKE_ROWS_REMAIN");
    console.log(JSON.stringify({ status: "passed", outcomes: ["expired", "rejected"], replayVerified: true, mismatchDenied: true, rollbackVerified: true, persistedRows: 0, chainWrites: false }));
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
}
main().catch(() => { console.error("MAINNET_REFUND_SQL_SMOKE_FAILED"); process.exitCode = 1; });
