import { healthFactorResultOutputSchema } from "@bnbera/agent-commerce";
import React from "react";

/** Only the existing supported result contract gets an interpreted presentation. */
export function CommerceResultSummary({ result }: { readonly result: unknown }) {
  const payload = typeof result === "object" && result !== null && "schemaVersion" in result && result.schemaVersion === "bnbera.erc8183.result/v1" && "result" in result ? result.result : result;
  const parsed = healthFactorResultOutputSchema.safeParse(payload);
  if (!parsed.success) return <p>Result evidence is available. Open the raw result below to inspect its contents.</p>;
  const value = parsed.data;
  const observed = new Date(value.observedAtUnix * 1000);
  return <section aria-label="Health-factor result summary">
    <h3>Health-factor report</h3>
    <p><strong>{value.fixture ? value.healthFactor : value.healthFactorExact} {value.unit}</strong> · Reported assessment: {value.interpretation}</p>
    <p>{value.protocol} · Chain {value.chainId} · {Number.isNaN(observed.getTime()) ? "Observation time unavailable" : observed.toISOString()}</p>
    <p>Account: <code>{value.account}</code></p>
    {value.fixture ? <p>Fixture result · illustrative data, not a live account measurement.</p> : <>
      <div className="detail-kv"><span>Collateral value</span><span>{value.collateralValueUsd} USD</span></div>
      <div className="detail-kv"><span>Debt value</span><span>{value.debtValueUsd} USD</span></div>
      <div className="detail-kv"><span>Liquidation threshold</span><span>{value.liquidationThresholdBps / 100}%</span></div>
      <p>Source: {value.provenance.sourceKind === "caller_attested" ? "Caller-attested snapshot" : "Protocol snapshot"}. This report describes the supplied observation, not current execution readiness.</p>
      <details><summary>Snapshot source</summary><p>{value.provenance.sourceReference}</p>{value.provenance.observedBlock !== undefined && <p>Block {value.provenance.observedBlock}</p>}</details>
    </>}
  </section>;
}
