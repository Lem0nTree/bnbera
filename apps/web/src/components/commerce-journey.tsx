"use client";

import {
  BNB_TESTNET,
  createClient,
  hireErc8183Agent,
  settleErc8183Job,
  type Signer,
  type Wallet
} from "@bnbera/agent-commerce/browser";
import { Callout, StatusBadge } from "@bnbera/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CommerceActionResponse,
  CommerceBrowserDispatch,
  CommerceOperationStatusResponse
} from "@/lib/commerce-contract";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";

type BrowserAuthority = { readonly wallet: Wallet; readonly signer: Signer };
type JourneyProps = {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly identifier: string;
  /** A server-created parent quote/reservation. Never generated client-side. */
  readonly commerceJobId?: string | null;
  readonly budgetAtomic?: string | null;
};

const POLL_INTERVAL_MS = 4_000;

function publicStorageKey(identifier: string): string {
  return `bnbera:commerce:operation:${identifier}`;
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as { readonly status?: string; readonly error?: { readonly message?: string } } & T;
  if (!response.ok || body.status === "error") throw new Error(body.error?.message ?? "The commerce request could not be completed.");
  return body as T;
}

function operationStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed" || status === "reconciled") return "success";
  if (status === "unknown" || status === "manual_review") return "warning";
  if (status === "reverted") return "danger";
  return "neutral";
}

export function CommerceJourney({ activation, identifier, commerceJobId = null, budgetAtomic = null }: JourneyProps) {
  const storageKey = useMemo(() => publicStorageKey(identifier), [identifier]);
  const [authority, setAuthority] = useState<BrowserAuthority | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<CommerceActionResponse["operation"]>(null);
  const [job, setJob] = useState<CommerceActionResponse["job"]>(null);
  const [dispatch, setDispatch] = useState<CommerceBrowserDispatch | null>(null);
  const [task, setTask] = useState("");
  const [budget, setBudget] = useState(budgetAtomic ?? "");
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState("5");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSent, setReviewSent] = useState(false);

  const rememberOperation = useCallback((nextOperationId: string) => {
    setOperationId(nextOperationId);
    window.localStorage.setItem(storageKey, nextOperationId);
  }, [storageKey]);

  const applyAction = useCallback((response: CommerceActionResponse) => {
    if (response.operationId !== null) rememberOperation(response.operationId);
    setOperation(response.operation);
    setJob(response.job);
    setDispatch(response.dispatch);
    setQuoteConfirmed(true);
  }, [rememberOperation]);

  const loadOperation = useCallback(async (id: string) => {
    const response = await fetch(`/api/commerce/operation/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await parseResponse<CommerceOperationStatusResponse>(response);
    setOperation(body.operation);
    setJob(body.job);
    setDispatch(body.dispatch);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null && stored.length > 0) {
      setOperationId(stored);
      void loadOperation(stored).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The saved commerce operation could not be reloaded."));
    }
  }, [loadOperation, storageKey]);

  useEffect(() => {
    if (operationId === null) return undefined;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try { await loadOperation(operationId); } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "The commerce operation could not be reloaded.");
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadOperation, operationId]);

  const connectPasskey = async (recover: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const client = createClient({ chains: [BNB_TESTNET], defaultChainId: BNB_TESTNET.chainId });
      const result = recover
        ? await client.recoverFromPasskey({ chainId: BNB_TESTNET.chainId })
        : await client.createPasskeyWallet({ name: "BNBEra commerce" });
      setAuthority({ wallet: result, signer: result.signer });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The browser passkey authority could not be prepared.");
    } finally { setBusy(false); }
  };

  const prepareHire = async () => {
    if (commerceJobId === null || commerceJobId === undefined) { setError("No server-created quote is available for this listing."); return; }
    if (task.trim() === "" || budget.trim() === "") { setError("Enter the task and review the quoted budget before funding."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: makeIdempotencyKey("hire"), commerceJobId, task: task.trim(), budgetAtomic: budget.trim() })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The quote could not be prepared.");
    } finally { setBusy(false); }
  };

  const dispatchBrowser = async (nextDispatch: CommerceBrowserDispatch) => {
    if (authority === null) { setError("Connect the browser passkey wallet before signing this action."); return; }
    if (nextDispatch.chainId !== BNB_TESTNET.chainId) { setError("The persisted operation network is not the configured BNB testnet."); return; }
    if (authority.wallet.address.toLowerCase() !== nextDispatch.actorAddress.toLowerCase()) { setError("The connected browser wallet does not match the authenticated operation actor; no call was sent."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = nextDispatch.action === "hire"
        ? await hireErc8183Agent(authority.wallet, authority.signer, {
            provider: nextDispatch.providerAddress as `0x${string}`,
            task: nextDispatch.task as string,
            budget: BigInt(nextDispatch.budgetAtomic as string),
            ...(nextDispatch.deadlineSeconds === null ? {} : { deadlineSeconds: nextDispatch.deadlineSeconds })
          }, { network: BNB_TESTNET, noWait: true })
        : await settleErc8183Job(authority.wallet, authority.signer, {
            jobId: BigInt(nextDispatch.jobId as string),
            action: nextDispatch.action === "dispute" ? "dispute" : "approve"
          }, { network: BNB_TESTNET, noWait: true });
      const response = await fetch("/api/commerce/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: nextDispatch.operationId, callsId: result.callsId, ...(result.transactionHash === undefined ? {} : { transactionHash: result.transactionHash }) })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The browser operation did not complete.");
    } finally { setBusy(false); }
  };

  const decide = async (action: "approve" | "dispute") => {
    if (job === null || job.submission === null) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commerce/${encodeURIComponent(job.job.jobKey.jobId)}/approve-or-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: makeIdempotencyKey(action), action, ...(action === "approve" ? { resultDigest: job.submission.localSha256 } : {}) })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The buyer decision could not be prepared.");
    } finally { setBusy(false); }
  };

  const createReview = async () => {
    if (commerceJobId === null || commerceJobId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commerce/review/${encodeURIComponent(commerceJobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: makeIdempotencyKey("review"), score: Number(reviewScore), comment: reviewComment })
      });
      await parseResponse(response);
      setReviewSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verified-purchase review could not be saved.");
    } finally { setBusy(false); }
  };

  if (!activation.enabled) return <p className="activation-panel__footnote">The paid browser journey is disabled until the authenticated browser authority and callable-result gate pass.</p>;

  const canDispatch = dispatch !== null && operation?.status === "awaiting_signature";
  const pending = operation !== null && ["awaiting_signature", "submitted", "unknown", "manual_review"].includes(operation.status);
  const completed = job?.job.state === "completed";
  const submission = job?.submission ?? null;
  const submitted = job !== null && job.job.state === "submitted" && submission !== null;

  return (
    <div className="commerce-journey" data-testid="commerce-journey">
      <div className="commerce-journey__header"><strong>ERC-8183 paid task</strong>{operation !== null && <StatusBadge value={statusLabel(operation.status)} tone={operationStatusTone(operation.status)} />}</div>
      {authority === null ? <div className="commerce-journey__authority">
        <p className="detail-section__lede">Signing stays in this browser. BNBEra receives only the operation ID and public relay evidence.</p>
        <div className="detail-actions">
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => void connectPasskey(true)}>Recover passkey wallet</button>
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => void connectPasskey(false)}>Create passkey wallet</button>
        </div>
      </div> : <p className="muted-label">Browser wallet ready · signer remains in memory only</p>}
      {error !== null && <Callout title="Commerce action stopped" tone="warning" icon="!">{error}</Callout>}
      {operationId === null && <div className="commerce-journey__quote">
        <label htmlFor={`${identifier}-task`}>Task</label>
        <textarea id={`${identifier}-task`} value={task} maxLength={4_096} onChange={(event) => setTask(event.target.value)} placeholder="Describe the result you need" />
        <label htmlFor={`${identifier}-budget`}>Quoted budget (atomic units)</label>
        <input id={`${identifier}-budget`} inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} />
        {commerceJobId === null || commerceJobId === undefined ? <p className="muted-label">A server-authenticated quote/reservation is required before funding.</p> : <label className="detail-actions"><input type="checkbox" checked={quoteConfirmed} onChange={(event) => setQuoteConfirmed(event.target.checked)} /> I reviewed this exact task and budget.</label>}
        <button className="button button--primary" type="button" disabled={busy || !quoteConfirmed || commerceJobId === null || commerceJobId === undefined} onClick={() => void prepareHire()}>Prepare quote and funding</button>
      </div>}
      {canDispatch && <button className="button button--primary" type="button" disabled={busy || authority === null} onClick={() => void dispatchBrowser(dispatch)}>Explicitly fund / sign</button>}
      {pending && operation?.status !== "awaiting_signature" && <p className="muted-label">This operation is pending or ambiguous. It will not be resent. Reload or attach the same public transaction hash when available.</p>}
      {submission !== null && <div className="commerce-journey__result">
        <p className="eyebrow">Exact result evidence</p>
        <div className="detail-kv"><span>Protocol job</span><code>{job?.job.jobKey.jobId ?? "Not observed"}</code></div>
        <div className="detail-kv"><span>Local SHA-256</span><code>{submission.localSha256}</code></div>
        <div className="detail-kv"><span>On-chain Keccak</span><code>{submission.chainKeccak}</code></div>
        <div className="detail-kv"><span>Submission receipt</span><code>{submission.transactionHash}</code></div>
        {job?.job.completionTransactionHash !== null && job?.job.completionTransactionHash !== undefined && <div className="detail-kv"><span>Settlement receipt</span><code>{job.job.completionTransactionHash}</code></div>}
        {submission.deliverableUrl !== null && <div className="detail-kv"><span>Deliverable</span><a href={submission.deliverableUrl} target="_blank" rel="noreferrer">Open exact manifest bytes</a></div>}
        {submission.manifestText !== null && <pre className="commerce-journey__manifest">{submission.manifestText}</pre>}
      </div>}
      {submitted && <div className="commerce-journey__decision">
        <p className="detail-section__lede">Inspect the exact bytes and digest, then choose one buyer decision.</p>
        <div className="detail-actions"><button className="button button--primary" type="button" disabled={busy || authority === null} onClick={() => void decide("approve")}>Approve and settle</button><button className="button button--ghost button--small" type="button" disabled={busy || authority === null} onClick={() => void decide("dispute")}>Dispute result</button></div>
      </div>}
      {completed && !reviewSent && <div className="commerce-journey__review">
        <p className="eyebrow">Verified-purchase review</p>
        <select value={reviewScore} onChange={(event) => setReviewScore(event.target.value)} aria-label="Review score"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Mixed</option><option value="2">2 · Poor</option><option value="1">1 · Failed</option></select>
        <textarea value={reviewComment} maxLength={2_000} onChange={(event) => setReviewComment(event.target.value)} placeholder="Optional buyer note" aria-label="Review comment" />
        <button className="button button--ghost button--small" type="button" disabled={busy || commerceJobId === null || commerceJobId === undefined} onClick={() => void createReview()}>Save verified review</button>
      </div>}
      {completed && reviewSent && <p className="muted-label">Verified-purchase review saved for this completed job.</p>}
    </div>
  );
}
