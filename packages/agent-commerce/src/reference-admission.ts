import { canonicalSha256Hex } from "@bnbera/domain";
import { CommerceError } from "./errors.js";
import type { Erc8183OperationQueryPool } from "./operations.js";

/** This authorization is deliberately not configurable into another deployment. */
export const REFERENCE_ALLOWANCE = {
  id: "reference-2293-after-1171-v1", chainId: 97, agentId: "2293",
  registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
  versionId: "a394ad86-02de-5d21-8602-96f954fc679b", version: 4,
  owner: "0x230072625f8090d5271c5f882748ce11134ac2ba",
  provider: "0x23bb79742b18fe2af238dde9ef97f355721c9122",
  commerce: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de",
  router: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
  policy: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea",
  token: "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565",
  card: "https://consultation-refugees-proc-encountered.trycloudflare.com/api/reference-provider/agent-card",
  service: "https://consultation-refugees-proc-encountered.trycloudflare.com/api/reference-provider/health-factor",
  price: "1000000000000000", maxJobs: 3, gasLimit: "400000", gasPrice: "250000000",
  gasReservation: "100000000000000", gasBudget: "300000000000000", baselineJob: "1171"
} as const;
export const REFERENCE_ALLOWANCE_DIGEST = canonicalSha256Hex(REFERENCE_ALLOWANCE);
type Query = Pick<Erc8183OperationQueryPool, "query">;
export type ReferenceCapacity = { ready: boolean; remaining: number; admitted: number; submitted: number; completed: number; reason: string; checkedAt: string | null };
const unavailable = (reason: string): ReferenceCapacity => ({ready:false,remaining:0,admitted:0,submitted:0,completed:0,reason,checkedAt:null});
export async function readReferenceCapacity(db: Query): Promise<ReferenceCapacity> {
  const result=await db.query<{config_digest:string;enabled:boolean;healthy:boolean;heartbeat:Date|null;reason:string;admitted:string;submitted:string;completed:string;reserved:string}>(`
    SELECT a.*, (SELECT count(*) FROM reference_provider_slots) admitted,
      (SELECT count(*) FROM reference_provider_slots WHERE transaction_hash IS NOT NULL) submitted,
      (SELECT count(*) FROM reference_provider_slots s JOIN erc8183_jobs j ON j.commerce_job_id=s.commerce_job_id WHERE j.state='completed') completed,
      (SELECT coalesce(sum(gas_reserved),0)::text FROM reference_provider_slots) reserved
    FROM reference_provider_allowance a WHERE id=$1`,[REFERENCE_ALLOWANCE.id]);
  const row=result.rows[0];
  if(!row || row.config_digest!==REFERENCE_ALLOWANCE_DIGEST)return unavailable("CONFIGURATION_MISMATCH");
  const admitted=Number(row.admitted), remaining=Math.max(0,3-admitted);
  const age=row.heartbeat===null?Infinity:Date.now()-new Date(row.heartbeat).getTime();
  const reason=!row.enabled?"ADMISSION_DISABLED":!row.healthy?row.reason:age<0||age>20_000?"WORKER_STALE":remaining===0?"CAPACITY_EXHAUSTED":BigInt(row.reserved)+BigInt(REFERENCE_ALLOWANCE.gasReservation)>BigInt(REFERENCE_ALLOWANCE.gasBudget)?"GAS_BUDGET_EXHAUSTED":"READY";
  return {ready:reason==="READY",remaining,admitted,submitted:Number(row.submitted),completed:Number(row.completed),reason,checkedAt:row.heartbeat===null?null:new Date(row.heartbeat).toISOString()};
}

/** Caller holds the quote transaction. Slots are never recycled, even on abandonment. */
export async function reserveReferenceCapacity(db: Query, quote: Record<string, unknown>): Promise<void> {
  const p=REFERENCE_ALLOWANCE, identity=quote.identity as Record<string,unknown>, service=quote.service as Record<string,unknown>;
  if(identity.namespace!=="eip155"||identity.chainId!==97||identity.agentId!==p.agentId||String(identity.identityRegistry).toLowerCase()!==p.registry||
    quote.chainId!==97||quote.agentVersionId!==p.versionId||quote.agentVersion!==p.version||String(quote.providerAddress).toLowerCase()!==p.provider||
    String(quote.commerceContract).toLowerCase()!==p.commerce||String(quote.paymentToken).toLowerCase()!==p.token||quote.paymentDecimals!==18||quote.priceAtomic!==p.price||service.url!==p.card)
    throw new CommerceError({code:"COMMERCE_DISABLED",message:"The bounded reference offer does not match its exact authorization.",nextAction:"reload_listing"});
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[p.id]);
  const capacity=await readReferenceCapacity(db);
  if(!capacity.ready)throw new CommerceError({code:"COMMERCE_DISABLED",message:`Reference provider cannot admit a new task (${capacity.reason}). Existing reservations remain available.`,nextAction:"view_existing_hires"});
  await db.query("INSERT INTO reference_provider_slots(slot,commerce_job_id,gas_reserved) VALUES($1,$2,$3)",[capacity.admitted+1,quote.quoteId,p.gasReservation]);
}
