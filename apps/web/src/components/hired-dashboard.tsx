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
  return <section className="section-block">
    {authRequired && <Callout title="Sign in to view your hires" tone="info">Connect the buyer wallet you used to hire agents, then sign in to load your history.</Callout>}
    <CommerceJourney activation={activation} targetChainId={hiredWalletTargetChain(defaultChainId, chainId)} identityKey="hired-wallet" walletOnly onAuthenticated={authenticated} />
    <button className="button button--ghost" disabled={busy} onClick={() => void load()} type="button">{busy ? "Loading history…" : "Reload history"}</button>
    {error && <Callout title="History unavailable" tone="warning">{error}</Callout>}
    {!jobs && busy && <LoadingState label="Loading your buyer-owned jobs" />}
    {jobs && visibleJobs && <>{buyerAddress && <p>Signed-in buyer: <code>{buyerAddress}</code></p>}<div className="hired-filters" aria-label="Filter hired jobs">{["All", "Needs attention", "In progress", "Completed"].map((label) => <button className="button button--ghost" key={label} type="button" aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}</div><p className="muted-label">{visibleJobs.length} loaded jobs · filters apply to loaded history.</p>
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
