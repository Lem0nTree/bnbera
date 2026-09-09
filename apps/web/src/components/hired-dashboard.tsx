"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { priceDisplayLabel } from "@/lib/presentation";
import { erc8004IdentityKey } from "@bnbera/domain";
import { Callout, EmptyState, LoadingState, StatusBadge } from "@bnbera/ui";
import type { BuyerJobSummary, CommerceJobsResponse } from "@/lib/commerce-job-list";
import { CommerceJourney } from "./commerce-journey";
import { buyerHistoryResponseCurrent, buyerSessionKey, hiredJobMatches, hiredWalletTargetChain } from "@/lib/hired-presentation";
const activation = { enabled: false, availability: "unavailable", method: "erc8183", title: "Persisted hire", reason: "Resume an existing buyer-owned job.", nextAction: "Inspect persisted status" } as const;
export function HiredDashboard({ defaultChainId = 97 }: { defaultChainId?: 56 | 97 }) {
  return <HiredDashboardInner defaultChainId={defaultChainId} />;
}
function HiredDashboardInner({ defaultChainId }: { defaultChainId: 56 | 97 }) {
  const { address, chainId, isConnected } = useAccount();
  const walletKey = `${isConnected}:${address?.toLowerCase() ?? ""}:${chainId ?? ""}`;
  const walletKeyRef = useRef(walletKey);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const sessionKeyRef = useRef<string | null>(null);
  const [historyWalletKey, setHistoryWalletKey] = useState<string | null>(null);
  if (walletKeyRef.current !== walletKey) { walletKeyRef.current = walletKey; generation.current += 1; }
  const [jobs, setJobs] = useState<BuyerJobSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BuyerJobSummary | null>(null);
  const [buyerAddress, setBuyerAddress] = useState<string | null>(null);
  const clearHistory = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    sessionKeyRef.current = null;
    setJobs(null); setSelected(null); setCursor(null); setBuyerAddress(null); setHistoryWalletKey(null); setAuthRequired(true); setBusy(false);
  }, []);
  const readSessionKey = useCallback(async (signal?: AbortSignal) => {
    if (!isConnected) return null;
    const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", ...(signal ? { signal } : {}) });
    if (!response.ok) return null;
    return buyerSessionKey(await response.json() as { authenticated?: boolean; walletAddress?: string; chainId?: number; expiresAt?: string }, address, chainId);
  }, [address, chainId, isConnected]);
  const load = useCallback(async (nextCursor: string | null = null) => {
    if (!isConnected || !address || (chainId !== 97 && chainId !== 56)) { clearHistory(); return; }
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const requestGeneration = ++generation.current;
    setBusy(true); setError(null);
    try {
      const before = await readSessionKey(requestController.signal);
      if (requestGeneration !== generation.current) return;
      if (before === null || (nextCursor !== null && before !== sessionKeyRef.current)) { clearHistory(); return; }
      const response = await fetch(`/api/commerce/jobs?limit=20${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: requestController.signal });
      if (requestGeneration !== generation.current) return;
      if (response.status === 401 || response.status === 403) { clearHistory(); return; }
      if (!response.ok) throw new Error("Your job history could not be loaded. Try reloading it.");
      const body = await response.json() as CommerceJobsResponse;
      if (body.status !== "ready" || !Array.isArray(body.jobs)) throw new Error("Your job history response was unavailable.");
      const after = await readSessionKey(requestController.signal);
      if (!buyerHistoryResponseCurrent(requestGeneration, generation.current, before, after)) { if (requestGeneration === generation.current) clearHistory(); return; }
      if (sessionKeyRef.current !== before) setSelected(null);
      sessionKeyRef.current = before;
      setAuthRequired(false);
      setBuyerAddress(address);
      setHistoryWalletKey(walletKey);
      setJobs((previous) => nextCursor ? [...(previous ?? []), ...body.jobs.filter((job) => !previous?.some((entry) => entry.commerceJobId === job.commerceJobId))] : body.jobs);
      setCursor(body.nextCursor);
    } catch (cause) { if (requestGeneration === generation.current && !requestController.signal.aborted) setError(cause instanceof Error ? cause.message : "Job history unavailable."); }
    finally { if (requestGeneration === generation.current) setBusy(false); }
  }, [address, chainId, clearHistory, isConnected, readSessionKey, walletKey]);
  useEffect(() => { clearHistory(); void load(); return () => { controller.current?.abort(); }; }, [clearHistory, load]);
  useEffect(() => {
    const check = async () => {
      const expectedGeneration = generation.current;
      try { const key = await readSessionKey(); if (expectedGeneration === generation.current && sessionKeyRef.current !== null && key !== sessionKeyRef.current) clearHistory(); }
      catch { if (expectedGeneration === generation.current && sessionKeyRef.current !== null) clearHistory(); }
    };
    const timer = window.setInterval(() => void check(), 4000);
    window.addEventListener("focus", check);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [clearHistory, readSessionKey]);
  const authenticated = useCallback(() => { void load(); }, [load]);
  const visibleJobs = historyWalletKey === walletKey ? jobs : null;
  const visibleSelected = historyWalletKey === walletKey ? selected : null;
  return <section className="section-block hired-dashboard">
    {authRequired && <div className="hired-signin">
    <CommerceJourney activation={activation} targetChainId={hiredWalletTargetChain(defaultChainId, chainId)} identityKey="hired-wallet" walletOnly onAuthenticated={authenticated} /></div>}
    {!authRequired && visibleJobs && buyerAddress && <div className="hired-toolbar">
      <div className="hired-buyer">
        <span className="hired-buyer__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7"/><path d="M20 12h-4v4h4"/></svg></span>
        <div className="hired-buyer__identity"><span>Buyer account</span><a href={`${chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com"}/address/${buyerAddress}`} target="_blank" rel="noreferrer" title={buyerAddress} aria-label={`View buyer account ${buyerAddress} on BscScan`}>{buyerAddress.slice(0, 6)}…{buyerAddress.slice(-4)} <span aria-hidden="true">↗</span></a><small><i aria-hidden="true" />Signed in · BNB {chainId === 56 ? "mainnet" : "testnet"}</small></div>
      </div>
      <button className="button hired-toolbar__refresh" disabled={busy} onClick={() => void load()} type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17"/></svg>{busy ? "Refreshing…" : "Refresh"}</button>
    </div>}
    {error && <Callout title="History unavailable" tone="warning">{error}</Callout>}
    {!jobs && busy && <LoadingState label="Loading your buyer-owned jobs" />}
    {jobs && visibleJobs && <><div className="hired-filters" aria-label="Filter hired jobs">{["All", "Needs attention", "In progress", "Completed"].map((label) => <button className="button button--ghost" key={label} type="button" aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div><p className="muted-label">{visibleJobs.length} loaded jobs · filters apply to loaded history.</p>
      {jobs.length === 0 ? <EmptyState title="No hired jobs yet">Your signed-in buyer account has no jobs. <Link href="/marketplace">Explore agents →</Link></EmptyState> : <ul className="hired-list">{jobs.filter((job) => hiredJobMatches(job, filter)).map((job) => <li className="hired-card" key={job.commerceJobId}>
        <div className="detail-actions"><h2>{job.agent.name ?? `Agent ${job.agent.identity.agentId}`}</h2><StatusBadge value={job.lifecycle.canonicalState ?? job.lifecycle.status} tone={job.lifecycle.canonicalState === "completed" ? "success" : "neutral"} /></div>
        <p>Job {job.protocolJobId ?? "awaiting creation"} · version {job.agent.version} · {job.price.chainId === 97 ? "BNB testnet" : job.price.chainId === 56 ? "BNB mainnet" : "Network unavailable"}</p>
        <p>{job.price.decimals === null ? `${job.price.amountAtomic} atomic units` : formatUnits(BigInt(job.price.amountAtomic), job.price.decimals)} {priceDisplayLabel(job.price.tokenSymbol ?? "tokens")} · updated {new Date(job.updatedAt).toLocaleString()}</p>
        <p>Next: {job.nextAction.replaceAll("_", " ")}</p>
        {job.latestOperation && <p>{job.latestOperation.step.replaceAll("_", " ")} · {job.latestOperation.status.replaceAll("_", " ")}</p>}
        <div className="detail-actions">{job.latestOperation && <button className="button button--primary" type="button" onClick={() => setSelected(job)}>Open job</button>}{job.agent.slug && <Link className="button button--ghost" href={`/agents/${encodeURIComponent(job.agent.slug)}#hire`}>View current agent</Link>}</div>
        <details><summary>Hired identity & evidence</summary><code>{erc8004IdentityKey(job.agent.identity)}</code><p>Reservation: {job.commerceJobId}</p><p>Result {job.resultAvailable ? "available" : "not available"} · settlement {job.settlementAvailable ? "available" : "not available"} · review {job.hasReview ? "saved" : "not saved"}</p>{job.latestOperation?.transactionHash && <code>{job.latestOperation.transactionHash}</code>}</details>
      </li>)}</ul>}
      {jobs.length > 0 && !jobs.some((job) => hiredJobMatches(job, filter)) && <EmptyState title="No loaded jobs match this filter">Choose another filter or load more history.</EmptyState>}
      {cursor && <button className="button button--ghost" disabled={busy} type="button" onClick={() => void load(cursor)}>Load more jobs</button>}
    </>}
    {visibleSelected?.latestOperation && <section className="section-block"><h2>{visibleSelected.agent.name ?? "Hired agent"} · job {visibleSelected.protocolJobId ?? "pending"}</h2><p>This is the persisted hire for version {visibleSelected.agent.version}. Its current marketplace listing may have changed.</p><CommerceJourney key={visibleSelected.commerceJobId} activation={activation} targetChainId={visibleSelected.price.chainId === 56 ? 56 : 97} identityKey={erc8004IdentityKey(visibleSelected.agent.identity)} commerceJobId={visibleSelected.commerceJobId} resumeOperationId={visibleSelected.latestOperation.operationId} expectedProtocolJobId={visibleSelected.protocolJobId} /></section>}
  </section>;
}
