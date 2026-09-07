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
import { commerceQuoteSnapshotSchema, type CommerceQuoteResponse, type CommerceQuoteSnapshot } from "@/lib/commerce-quote-contract";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";

type BrowserAuthority = { readonly wallet: Wallet; readonly signer: Signer };
type JourneyProps = {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly identifier: string;
  /** A server-created parent quote/reservation. Never generated client-side. */
  readonly commerceJobId?: string | null;
};

const POLL_INTERVAL_MS = 4_000;

type BrowserPasskeySigner = Signer & {
  readonly type: "passkey";
  readonly credential: { readonly id: string };
};

type PasskeyChallengeResponse = {
  readonly challenge: string;
  readonly rpId: string;
  readonly userVerification: "required";
  readonly timeout: number;
};

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function passkeyCredential(signer: Signer): { readonly id: string } {
  if (signer.type !== "passkey") throw new Error("The browser authority is not a passkey signer.");
  const credential = (signer as BrowserPasskeySigner).credential;
  if (credential === undefined || typeof credential.id !== "string" || credential.id.length === 0) {
    throw new Error("The browser passkey credential is unavailable.");
  }
  return credential;
}

/**
 * Establish the server session separately from the SDK signer. The API only
 * receives a WebAuthn assertion and the public wallet address; signer/session
 * authority never crosses the browser/server boundary.
 */
async function authenticateBrowserPasskey(walletAddress: string, signer: Signer): Promise<void> {
  const credential = passkeyCredential(signer);
  const challengeResponse = await fetch("/api/auth/passkey/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ walletAddress, chainId: BNB_TESTNET.chainId })
  });
  const challenge = await parseResponse<PasskeyChallengeResponse>(challengeResponse);
  if (typeof PublicKeyCredential === "undefined" || typeof navigator.credentials?.get !== "function") {
    throw new Error("This browser does not provide the WebAuthn assertion API required for commerce sign-in.");
  }
  const assertionCredential = await navigator.credentials.get({
    publicKey: {
      challenge: decodeBase64Url(challenge.challenge),
      rpId: challenge.rpId,
      allowCredentials: [{ id: decodeBase64Url(credential.id), type: "public-key" }],
      userVerification: challenge.userVerification,
      timeout: challenge.timeout
    }
  });
  if (!(assertionCredential instanceof PublicKeyCredential)) throw new Error("The browser did not return a passkey assertion.");
  if (!(assertionCredential.response instanceof AuthenticatorAssertionResponse)) throw new Error("The browser did not return a WebAuthn assertion.");
  const assertion = assertionCredential.response;
  const rawId = encodeBase64Url(assertionCredential.rawId);
  if (assertionCredential.id !== rawId || assertion.userHandle === null) {
    throw new Error("The browser passkey assertion is missing its wallet binding.");
  }
  const response = await fetch("/api/auth/passkey/assertion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      walletAddress,
      chainId: BNB_TESTNET.chainId,
      response: {
        id: assertionCredential.id,
        rawId,
        type: assertionCredential.type,
        authenticatorAttachment: assertionCredential.authenticatorAttachment ?? undefined,
        clientExtensionResults: assertionCredential.getClientExtensionResults(),
        response: {
          clientDataJSON: encodeBase64Url(assertion.clientDataJSON),
          authenticatorData: encodeBase64Url(assertion.authenticatorData),
          signature: encodeBase64Url(assertion.signature),
          userHandle: encodeBase64Url(assertion.userHandle)
        }
      }
    })
  });
  await parseResponse(response);
}

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

export function CommerceJourney({ activation, identifier, commerceJobId = null }: JourneyProps) {
  const storageKey = useMemo(() => publicStorageKey(identifier), [identifier]);
  const quoteKey = useMemo(() => quoteStorageKey(identifier), [identifier]);
  const [authority, setAuthority] = useState<BrowserAuthority | null>(null);
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

  const connectPasskey = async (recover: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const client = createClient({ chains: [BNB_TESTNET], defaultChainId: BNB_TESTNET.chainId });
      const result = recover
        ? await client.recoverFromPasskey({ chainId: BNB_TESTNET.chainId })
        : await client.createPasskeyWallet({ name: "BNBEra commerce" });
      await authenticateBrowserPasskey(result.address, result.signer);
      setAuthority({ wallet: result, signer: result.signer });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The browser passkey authority could not be prepared.");
    } finally { setBusy(false); }
  };

  const requestQuote = async () => {
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
      {authority === null ? <div className="commerce-journey__authority">
        <p className="detail-section__lede">Signing stays in this browser. BNBEra receives only the operation ID and public relay evidence.</p>
        <div className="detail-actions">
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => void connectPasskey(true)}>Recover passkey wallet</button>
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => void connectPasskey(false)}>Create passkey wallet</button>
        </div>
      </div> : <p className="muted-label">Browser wallet ready · signer remains in memory only</p>}
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
        <button className="button button--ghost button--small" type="button" disabled={busy || (quote?.quoteId ?? commerceJobId) === null || (quote?.quoteId ?? commerceJobId) === undefined} onClick={() => void createReview()}>Save verified review</button>
      </div>}
      {completed && reviewSent && <p className="muted-label">Verified-purchase review saved for this completed job.</p>}
    </div>
  );
}
