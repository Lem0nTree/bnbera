import React from "react";
import { priceDisplayLabel } from "@/lib/presentation";
import { Callout } from "@bnbera/ui";
import { parseReferenceBuyerTask } from "@bnbera/agent-commerce/browser";
import { formatUnits } from "viem";
import { z } from "zod";
import type { CommerceQuoteSnapshot } from "@/lib/commerce-quote-contract";

function QuoteTask({ task }: { readonly task: string }) {
  try {
    const value = parseReferenceBuyerTask(task);
    return <span>Calculate lending risk · {value.collateralValueUsd} USD collateral · {value.debtValueUsd} USD debt · {value.liquidationThresholdBps / 100}% liquidation threshold. Buyer-attested snapshot.</span>;
  } catch { return <span>{task}</span>; }
}

const displayedTermsSchema = z.object({ terms: z.object({
  deliverables: z.string().min(1).max(1200),
  quality_standards: z.string().min(1).max(1200),
  success_criteria: z.array(z.string().min(1).max(300)).max(8).optional()
}) });

function SellerTerms({ task }: { readonly task: string }) {
  // Display the exact contract task, not today's catalog defaults. Signature
  // verification and payment authorization remain server responsibilities.
  let terms;
  try { terms = displayedTermsSchema.parse(JSON.parse(task)).terms; }
  catch { return <p>Seller terms could not be summarized. Inspect the exact signed contract task below before funding.</p>; }
  return <>
    <div className="detail-kv"><span>Deliverables</span><span>{terms.deliverables}</span></div>
    <div className="detail-kv"><span>Quality requirements</span><span>{terms.quality_standards}</span></div>
    {!!terms.success_criteria?.length && <div className="detail-kv"><span>Success criteria</span><ul>{terms.success_criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></div>}
  </>;
}

/** Presentation only: never interprets a signed offer as execution evidence. */
export function CommerceQuoteDetails({ quote }: { readonly quote: CommerceQuoteSnapshot }) {
  return <>
    <p className="eyebrow">{quote.externalSeller ? "Provider-signed mainnet offer" : "Server quote"}</p>
    {quote.externalSeller && <Callout title={quote.externalSeller.executionStatus === "historical_result_verified" ? "Historical result observed · new delivery not guaranteed" : "Protocol ready · delivery history unverified"} tone="warning" icon="!">
      <p>The seller signed these exact terms. {quote.externalSeller.historicalJobId ? `A useful historical result for job ${quote.externalSeller.historicalJobId} was retrieved and matched its on-chain digest during the September 9 review. That is not a guarantee of this task.` : "No useful historical result has been verified for this seller. You may explicitly choose that risk."} This hire uses real funds on BNB mainnet.</p>
      <p>This offer uses APEX OptimisticPolicy with a seven-day dispute window starting at on-chain submission. You can read and review the delivery immediately. Approving it in BNBEra cannot release the seller's payment early.</p>
      <p>Anyone can settle after that window; without sufficient rejection votes, the policy approves even a disputed result. A buyer dispute and enough authorized rejection votes can reject the job earlier. Your app approval is not an on-chain veto. A settlement transaction is still required.</p>
      <p>The verified United Dollars token can be paused or accounts frozen by its issuer. That can prevent funding, settlement or refunds. BNBEra never automatically sends your wallet transactions.</p>
    </Callout>}
    <div className="detail-kv"><span>Task</span>{quote.externalSeller ? <span>{quote.externalSeller.requestedTask}</span> : <QuoteTask task={quote.task} />}</div>
    {quote.externalSeller && <SellerTerms task={quote.task} />}
    <div className="detail-kv"><span>Price</span><span>{formatUnits(BigInt(quote.priceAtomic), quote.paymentDecimals)} {priceDisplayLabel(quote.tokenSymbol ?? "tokens")} · gas paid separately</span></div>
    <div className="detail-kv"><span>Network / token</span><span>{quote.chainId === 56 ? "BNB Smart Chain mainnet" : "BNB testnet"} · chain {quote.chainId} · {quote.paymentDecimals} decimals<br /><code>{quote.paymentToken}</code></span></div>
    <div className="detail-kv"><span>Provider</span><code>{quote.providerAddress}</code></div>
    <div className="detail-kv"><span>Offer expires before funding</span><span>{new Date(quote.expiresAt).toLocaleString()}</span></div>
    <details><summary>Exact quote details</summary><p>Chain {quote.chainId} · agent version {quote.agentVersion}</p><p>Service: {quote.service.url}</p><p>Token: <code>{quote.paymentToken}</code></p><p>Amount: {quote.priceAtomic} atomic units</p><p>Task digest: <code>{quote.taskDigest}</code></p>
      {quote.externalSeller && <><p>Exact signed contract task</p><pre className="commerce-journey__manifest">{quote.task}</pre></>}
    </details>
  </>;
}
