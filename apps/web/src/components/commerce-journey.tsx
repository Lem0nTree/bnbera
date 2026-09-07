"use client";

import { Callout, StatusBadge } from "@bnbera/ui";
import type { WalletClient } from "viem";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
  useWalletClient
} from "wagmi";
import type {
  CommerceActionResponse,
  CommerceBrowserDispatch,
  CommerceOperationStatusResponse
} from "@/lib/commerce-contract";
import { commerceQuoteSnapshotSchema, type CommerceQuoteResponse, type CommerceQuoteSnapshot } from "@/lib/commerce-quote-contract";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { isEoaAuthorityCurrent, shouldInvalidateEoaAuthority, EOA_BUYER_CHAIN_ID, type EoaWalletSnapshot } from "@/lib/eoa-wallet";
import { formatSiweMessage } from "@/lib/siwe-message";
import { EoaWalletProvider, walletConnectProjectConfigured } from "./eoa-wallet-provider";

type BrowserAuthority = { readonly address: string; readonly chainId: number; readonly walletClient: WalletClient };
type JourneyProps = {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly identifier: string;
  /** A server-created parent quote/reservation. Never generated client-side. */
  readonly commerceJobId?: string | null;
};

const POLL_INTERVAL_MS = 4_000;

type EoaSiweChallengeResponse = {
  readonly address: string;
  readonly chainId: 97;
  readonly domain: string;
  readonly uri: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
  readonly expiresAt: string;
  readonly statement: string;
  readonly message: string;
};

function publicStorageKey(identifier: string): string {
  return `bnbera:commerce:operation:${identifier}`;
}

function quoteStorageKey(identifier: string): string {
  return `bnbera:commerce:quote:${identifier}`;
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

export function CommerceJourney(props: JourneyProps) {
  return (
    <EoaWalletProvider>
      <CommerceJourneyInner {...props} />
    </EoaWalletProvider>
  );
}

function CommerceJourneyInner({ activation, identifier, commerceJobId = null }: JourneyProps) {
  const storageKey = useMemo(() => publicStorageKey(identifier), [identifier]);
  const quoteKey = useMemo(() => quoteStorageKey(identifier), [identifier]);
  const [authority, setAuthority] = useState<BrowserAuthority | null>(null);
  const [walletAuthenticated, setWalletAuthenticated] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<CommerceActionResponse["operation"]>(null);
  const [job, setJob] = useState<CommerceActionResponse["job"]>(null);
  const [dispatch, setDispatch] = useState<CommerceBrowserDispatch | null>(null);
  const [task, setTask] = useState("");
  const [quote, setQuote] = useState<CommerceQuoteSnapshot | null>(null);
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState("5");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [transactionHashDraft, setTransactionHashDraft] = useState("");
  const previousWallet = useRef<EoaWalletSnapshot | null>(null);
  const logoutInFlight = useRef(false);
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: connectionPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { signMessageAsync, isPending: signPending } = useSignMessage();
  const { data: walletClient } = useWalletClient();

  const walletSnapshot = useMemo<EoaWalletSnapshot>(() => ({
    connected: isConnected,
    address,
    chainId
  }), [address, chainId, isConnected]);

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

  const clearBrowserAuthority = useCallback(() => {
    setAuthority(null);
    setWalletAuthenticated(false);
    // A dispatch returned for the previous account must never be sent by the
    // next account, even if the operation itself remains visible on reload.
    setDispatch(null);
  }, []);

  const logoutBrowserSession = useCallback(async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
    } finally {
      logoutInFlight.current = false;
    }
  }, []);

  const connectWallet = useCallback(async () => {
    const connector = connectors[0];
    if (connector === undefined) {
      throw new Error("WalletConnect is not configured for this preview. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and reload.");
    }
    const connected = await connectAsync({ connector, chainId: EOA_BUYER_CHAIN_ID });
    if (connected.chainId !== EOA_BUYER_CHAIN_ID) {
      await switchChainAsync({ chainId: EOA_BUYER_CHAIN_ID });
    }
  }, [connectAsync, connectors, switchChainAsync]);

  const signInWithWallet = useCallback(async () => {
    if (!isConnected || address === undefined) throw new Error("Connect a WalletConnect EOA before signing in.");
    if (chainId !== EOA_BUYER_CHAIN_ID) throw new Error("Switch WalletConnect to BNB Smart Chain testnet before signing in.");
    if (walletClient === undefined) throw new Error("The connected wallet is not ready to sign yet. Try again.");

    const challengeResponse = await fetch("/api/auth/siwe/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ address, chainId: EOA_BUYER_CHAIN_ID })
    });
    const challenge = await parseResponse<EoaSiweChallengeResponse>(challengeResponse);
    const message = formatSiweMessage({
      address: challenge.address,
      chainId: challenge.chainId,
      domain: challenge.domain,
      uri: challenge.uri,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      expirationTime: challenge.expirationTime,
      statement: challenge.statement
    });
    if (message !== challenge.message) throw new Error("The server SIWE challenge was not canonical.");
    const signature = await signMessageAsync({ message });
    await parseResponse(await fetch("/api/auth/siwe/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        address: challenge.address,
        chainId: challenge.chainId,
        domain: challenge.domain,
        uri: challenge.uri,
        nonce: challenge.nonce,
        issuedAt: challenge.issuedAt,
        expirationTime: challenge.expirationTime,
        statement: challenge.statement,
        message,
        signature
      })
    }));
    setAuthority({ address, chainId: EOA_BUYER_CHAIN_ID, walletClient });
    setWalletAuthenticated(true);
  }, [address, chainId, isConnected, signMessageAsync, walletClient]);

  const switchToBuyerChain = useCallback(async () => {
    await switchChainAsync({ chainId: EOA_BUYER_CHAIN_ID });
  }, [switchChainAsync]);

  const disconnectWallet = useCallback(() => {
    clearBrowserAuthority();
    void logoutBrowserSession();
    disconnect();
  }, [clearBrowserAuthority, disconnect, logoutBrowserSession]);

  const loadOperation = useCallback(async (id: string) => {
    const response = await fetch(`/api/commerce/operation/${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await parseResponse<CommerceOperationStatusResponse>(response);
    setOperation(body.operation);
    setJob(body.job);
    setDispatch(body.dispatch);
  }, []);

  useEffect(() => {
    const storedQuote = window.localStorage.getItem(quoteKey);
    if (storedQuote !== null) {
      try {
        const parsed = commerceQuoteSnapshotSchema.safeParse(JSON.parse(storedQuote) as unknown);
        if (parsed.success) {
          setQuote(parsed.data);
          setTask(parsed.data.task);
        } else {
          window.localStorage.removeItem(quoteKey);
        }
      } catch {
        window.localStorage.removeItem(quoteKey);
      }
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null && stored.length > 0) {
      setOperationId(stored);
      void loadOperation(stored).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The saved commerce operation could not be reloaded."));
    }
  }, [loadOperation, quoteKey, storageKey]);

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

  useEffect(() => {
    const previous = previousWallet.current;
    if (shouldInvalidateEoaAuthority(previous, walletSnapshot, authority)) {
      clearBrowserAuthority();
      void logoutBrowserSession();
      setError("The connected account or network changed. Sign in again before continuing.");
    }
    previousWallet.current = walletSnapshot;
  }, [authority, clearBrowserAuthority, logoutBrowserSession, walletSnapshot]);

  useEffect(() => {
    if (!isConnected || address === undefined || chainId !== EOA_BUYER_CHAIN_ID || walletClient === undefined || walletAuthenticated) return undefined;
    let stopped = false;
    void fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => parseResponse<{ readonly authenticated?: boolean; readonly walletAddress?: string; readonly chainId?: number }>(response))
      .then((session) => {
        if (stopped || session.authenticated !== true) return;
        if (session.walletAddress?.toLowerCase() !== address.toLowerCase() || session.chainId !== EOA_BUYER_CHAIN_ID) {
          // Do not leave a cookie for a previous account active when a
          // restored WalletConnect session belongs to another EOA.
          void logoutBrowserSession();
          return;
        }
        setAuthority({ address, chainId: EOA_BUYER_CHAIN_ID, walletClient });
        setWalletAuthenticated(true);
      })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [address, chainId, isConnected, logoutBrowserSession, walletAuthenticated, walletClient]);

  const requestQuote = async () => {
    if (!walletAuthenticated) { setError("Connect and sign in with the buyer wallet before requesting a quote."); return; }
    if (task.trim() === "") { setError("Describe the result you need before requesting a quote."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIdentifier: identifier, task: task.trim() })
      });
      const body = await parseResponse<CommerceQuoteResponse>(response);
      const parsed = commerceQuoteSnapshotSchema.parse(body.quote);
      setQuote(parsed);
      setTask(parsed.task);
      setQuoteConfirmed(false);
      window.localStorage.setItem(quoteKey, JSON.stringify(parsed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The server quote could not be prepared.");
    } finally { setBusy(false); }
  };

  const prepareHire = async () => {
    if (!walletAuthenticated) { setError("Connect and sign in with the buyer wallet before preparing funding."); return; }
    const reservationId = quote?.quoteId ?? commerceJobId;
    if (reservationId === null || reservationId === undefined) { setError("No server-created quote is available for this listing."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: makeIdempotencyKey("hire"), commerceJobId: reservationId })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The funding intent could not be prepared.");
    } finally { setBusy(false); }
  };

  const dispatchBrowser = async (nextDispatch: CommerceBrowserDispatch) => {
    if (authority === null || !walletAuthenticated) { setError("Connect and sign in with the buyer wallet before signing this action."); return; }
    if (nextDispatch.chainId !== EOA_BUYER_CHAIN_ID) { setError("The persisted operation network is not BNB Smart Chain testnet."); return; }
    if (!isEoaAuthorityCurrent(walletSnapshot, { address: authority.address, chainId: EOA_BUYER_CHAIN_ID }) || authority.address.toLowerCase() !== nextDispatch.actorAddress.toLowerCase()) {
      setError("The connected wallet does not match the authenticated operation actor; no call was sent.");
      return;
    }
    // The browser-owned ERC-8183 EOA transaction adapter attaches public
    // calls/receipt evidence in the dependent commerce slice. Keeping this
    // guard here ensures no Altana/passkey writer can be reached meanwhile.
    setError("The EOA commerce transaction adapter is not enabled in this canary yet.");
  };

  const attachTransactionHash = async () => {
    if (operation === null || operation.callsId === null) {
      setError("No persisted public relay calls ID is available for transaction recovery.");
      return;
    }
    const transactionHash = transactionHashDraft.trim();
    if (!/^0x[0-9a-f]{64}$/iu.test(transactionHash)) {
      setError("Enter the public 32-byte transaction hash returned by the relay or explorer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/commerce/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: operation.operationId, callsId: operation.callsId, transactionHash })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
      setTransactionHashDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The public transaction hash could not be attached safely.");
    } finally { setBusy(false); }
  };

  const decide = async (action: "approve" | "dispute") => {
    if (!walletAuthenticated) {
      setError("Connect and sign in with the buyer wallet before deciding this result.");
      return;
    }
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
    if (!walletAuthenticated) {
      setError("Connect and sign in with the buyer wallet before saving a review.");
      return;
    }
    const reservationId = quote?.quoteId ?? commerceJobId;
    if (reservationId === null || reservationId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commerce/review/${encodeURIComponent(reservationId)}`, {
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
      <div className="commerce-journey__authority">
        <p className="detail-section__lede">Connect with WalletConnect to use MetaMask or another EOA wallet. BNBEra receives only the signed SIWE proof and public operation evidence; it never receives wallet keys.</p>
        {!isConnected && <>
          {!walletConnectProjectConfigured && <p className="muted-label">WalletConnect is unavailable in this preview until <code>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code> is configured. Marketplace browsing remains available.</p>}
          <button className="button button--primary" type="button" disabled={busy || connectionPending || !walletConnectProjectConfigured} onClick={() => {
            setBusy(true);
            setError(null);
            void connectWallet().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "WalletConnect could not connect.")).finally(() => setBusy(false));
          }}>{walletConnectProjectConfigured ? "Connect WalletConnect" : "WalletConnect unavailable"}</button>
        </>}
        {isConnected && chainId !== EOA_BUYER_CHAIN_ID && <>
          <p className="muted-label">Connected on chain {chainId ?? "unknown"}. Commerce requires BNB Smart Chain testnet (97).</p>
          <button className="button button--primary" type="button" disabled={busy || switchPending} onClick={() => {
            setBusy(true);
            setError(null);
            void switchToBuyerChain().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The wallet network could not be changed.")).finally(() => setBusy(false));
          }}>Switch to BNB testnet</button>
        </>}
        {isConnected && chainId === EOA_BUYER_CHAIN_ID && !walletAuthenticated && <button className="button button--primary" type="button" disabled={busy || signPending} onClick={() => {
          setBusy(true);
          setError(null);
          void signInWithWallet().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The wallet sign-in could not be completed.")).finally(() => setBusy(false));
        }}>Sign in with wallet</button>}
        {isConnected && chainId === EOA_BUYER_CHAIN_ID && walletAuthenticated && <div className="detail-actions">
          <p className="muted-label">Buyer wallet ready · {authority?.address ?? address}</p>
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={disconnectWallet}>Disconnect wallet</button>
        </div>}
      </div>
      {error !== null && <Callout title="Commerce action stopped" tone="warning" icon="!">{error}</Callout>}
      {operationId === null && quote === null && <div className="commerce-journey__quote">
        <label htmlFor={`${identifier}-task`}>Task</label>
        <textarea id={`${identifier}-task`} value={task} maxLength={4_096} onChange={(event) => setTask(event.target.value)} placeholder="Describe the result you need" />
        <p className="muted-label">Price, provider, identity and payment terms are resolved from the current published listing on the server.</p>
        <button className="button button--primary" type="button" disabled={busy || task.trim() === ""} onClick={() => void requestQuote()}>Request server quote</button>
      </div>}
      {operationId === null && quote !== null && <div className="commerce-journey__quote">
        <p className="eyebrow">Server quote</p>
        <div className="detail-kv"><span>Task</span><span>{quote.task}</span></div>
        <div className="detail-kv"><span>Price</span><span>{quote.priceAtomic} atomic units{quote.tokenSymbol === null ? "" : ` · ${quote.tokenSymbol}`}</span></div>
        <div className="detail-kv"><span>Provider</span><code>{quote.providerAddress}</code></div>
        <div className="detail-kv"><span>Quote expires</span><span>{new Date(quote.expiresAt).toLocaleString()}</span></div>
        <label className="detail-actions"><input type="checkbox" checked={quoteConfirmed} onChange={(event) => setQuoteConfirmed(event.target.checked)} /> I reviewed this exact task and quote.</label>
        <button className="button button--primary" type="button" disabled={busy || !quoteConfirmed} onClick={() => void prepareHire()}>Prepare explicit funding</button>
        <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => { setQuote(null); setQuoteConfirmed(false); window.localStorage.removeItem(quoteKey); }}>Request a fresh quote</button>
      </div>}
      {canDispatch && <button className="button button--primary" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void dispatchBrowser(dispatch)}>Explicitly fund / sign</button>}
      {pending && operation?.status !== "awaiting_signature" && <p className="muted-label">This operation is pending or ambiguous. It will not be resent. Reload or attach the same public transaction hash when available.</p>}
      {pending && operation?.status !== "awaiting_signature" && operation?.callsId !== null && <div className="commerce-journey__recovery">
        <label htmlFor={`${identifier}-transaction-hash`}>Public transaction hash (optional recovery)</label>
        <input id={`${identifier}-transaction-hash`} value={transactionHashDraft} onChange={(event) => setTransactionHashDraft(event.target.value)} placeholder="0x…" inputMode="text" autoComplete="off" />
        <button className="button button--ghost button--small" type="button" disabled={busy || transactionHashDraft.trim() === ""} onClick={() => void attachTransactionHash()}>Attach and reconcile</button>
      </div>}
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
        <div className="detail-actions"><button className="button button--primary" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void decide("approve")}>Approve and settle</button><button className="button button--ghost button--small" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void decide("dispute")}>Dispute result</button></div>
      </div>}
      {completed && !reviewSent && <div className="commerce-journey__review">
        <p className="eyebrow">Verified-purchase review</p>
        <select value={reviewScore} onChange={(event) => setReviewScore(event.target.value)} aria-label="Review score"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Mixed</option><option value="2">2 · Poor</option><option value="1">1 · Failed</option></select>
        <textarea value={reviewComment} maxLength={2_000} onChange={(event) => setReviewComment(event.target.value)} placeholder="Optional buyer note" aria-label="Review comment" />
        <button className="button button--ghost button--small" type="button" disabled={busy || !walletAuthenticated || (quote?.quoteId ?? commerceJobId) === null || (quote?.quoteId ?? commerceJobId) === undefined} onClick={() => void createReview()}>Save verified review</button>
      </div>}
      {completed && reviewSent && <p className="muted-label">Verified-purchase review saved for this completed job.</p>}
    </div>
  );
}
