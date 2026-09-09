"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { erc8004IdentityKey } from "@bnbera/domain";
import { Callout, EmptyState, LoadingState, StatusBadge } from "@bnbera/ui";
import type { BuyerJobSummary, CommerceJobsResponse } from "@/lib/commerce-job-list";
import { CommerceJourney } from "./commerce-journey";
import { hiredJobMatches } from "@/lib/hired-presentation";
const activation = { enabled: false, availability: "unavailable", method: "erc8183", title: "Persisted hire", reason: "Resume an existing buyer-owned job.", nextAction: "Inspect persisted status" } as const;
export function HiredDashboard() {
  const [jobs, setJobs] = useState<BuyerJobSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BuyerJobSummary | null>(null);
  const [buyerAddress, setBuyerAddress] = useState<string | null>(null);
  const load = useCallback(async (nextCursor: string | null = null) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/commerce/jobs?limit=20${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) { setJobs(null); setSelected(null); setAuthRequired(true); return; }
      if (!response.ok) throw new Error("Your job history could not be loaded. Try reloading it.");
      const body = await response.json() as CommerceJobsResponse;
      if (body.status !== "ready" || !Array.isArray(body.jobs)) throw new Error("Your job history response was unavailable.");
      setAuthRequired(false);
      const sessionResponse = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
      if (sessionResponse.ok) { const session = await sessionResponse.json() as { walletAddress?: string }; setBuyerAddress(session.walletAddress ?? null); }
      setJobs((previous) => nextCursor ? [...(previous ?? []), ...body.jobs.filter((job) => !previous?.some((entry) => entry.commerceJobId === job.commerceJobId))] : body.jobs);
      setCursor(body.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Job history unavailable."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="section-block">
    {authRequired && <><Callout title="Sign in to view your hires" tone="info">Connect the buyer wallet you used to hire agents, then reload your history.</Callout><CommerceJourney activation={activation} identityKey="hired-wallet" walletOnly /></>}
    <button className="button button--ghost" disabled={busy} onClick={() => void load()} type="button">{busy ? "Loading history…" : "Reload history"}</button>
    {error && <Callout title="History unavailable" tone="warning">{error}</Callout>}
    {!jobs && busy && <LoadingState label="Loading your buyer-owned jobs" />}
    {jobs && <>{buyerAddress && <p>Signed-in buyer: <code>{buyerAddress}</code></p>}<div className="hired-filters" aria-label="Filter hired jobs">{["All", "Needs attention", "In progress", "Completed"].map((label) => <button className="button button--ghost" key={label} type="button" aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div><p className="muted-label">{jobs.length} loaded jobs · filters apply to loaded history.</p>
      {jobs.length === 0 ? <EmptyState title="No hired jobs yet">Your signed-in buyer account has no jobs. <Link href="/marketplace">Explore agents →</Link></EmptyState> : <ul className="hired-list">{jobs.filter((job) => hiredJobMatches(job, filter)).map((job) => <li className="hired-card" key={job.commerceJobId}>
        <div className="detail-actions"><h2>{job.agent.name ?? `Agent ${job.agent.identity.agentId}`}</h2><StatusBadge value={job.lifecycle.canonicalState ?? job.lifecycle.status} tone={job.lifecycle.canonicalState === "completed" ? "success" : "neutral"} /></div>
        <p>Job {job.protocolJobId ?? "awaiting creation"} · version {job.agent.version} · {job.price.chainId === 97 ? "BNB testnet" : job.price.chainId === 56 ? "BNB mainnet" : "Network unavailable"}</p>
        <p>{job.price.decimals === null ? `${job.price.amountAtomic} atomic units` : formatUnits(BigInt(job.price.amountAtomic), job.price.decimals)} {job.price.tokenSymbol ?? "tokens"} · updated {new Date(job.updatedAt).toLocaleString()}</p>
        <p>Next: {job.nextAction.replaceAll("_", " ")}</p>
        {job.latestOperation && <p>{job.latestOperation.step.replaceAll("_", " ")} · {job.latestOperation.status.replaceAll("_", " ")}</p>}
        <div className="detail-actions">{job.latestOperation && <button className="button button--primary" type="button" onClick={() => setSelected(job)}>Open job</button>}{job.agent.slug && <Link className="button button--ghost" href={`/agents/${encodeURIComponent(job.agent.slug)}#hire`}>View current agent</Link>}</div>
        <details><summary>Hired identity & evidence</summary><code>{erc8004IdentityKey(job.agent.identity)}</code><p>Reservation: {job.commerceJobId}</p><p>Result {job.resultAvailable ? "available" : "not available"} · settlement {job.settlementAvailable ? "available" : "not available"} · review {job.hasReview ? "saved" : "not saved"}</p>{job.latestOperation?.transactionHash && <code>{job.latestOperation.transactionHash}</code>}</details>
      </li>)}</ul>}
      {jobs.length > 0 && !jobs.some((job) => hiredJobMatches(job, filter)) && <EmptyState title="No loaded jobs match this filter">Choose another filter or load more history.</EmptyState>}
      {cursor && <button className="button button--ghost" disabled={busy} type="button" onClick={() => void load(cursor)}>Load more jobs</button>}
    </>}
    {selected?.latestOperation && <section className="section-block"><h2>{selected.agent.name ?? "Hired agent"} · job {selected.protocolJobId ?? "pending"}</h2><p>This is the persisted hire for version {selected.agent.version}. Its current marketplace listing may have changed.</p><CommerceJourney key={selected.commerceJobId} activation={activation} identityKey={erc8004IdentityKey(selected.agent.identity)} commerceJobId={selected.commerceJobId} resumeOperationId={selected.latestOperation.operationId} expectedProtocolJobId={selected.protocolJobId} /></section>}
  </section>;
}
