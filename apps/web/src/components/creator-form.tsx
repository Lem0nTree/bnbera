"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "./toast-provider";
import type { GrantSessionResult, Signer } from "@altananetwork/sdk";
import type { CreatorDraftRequest } from "@/lib/creator-contract";
import {
  authenticateCreatorPasskey,
  createCreatorPasskeyWallet,
  createCreatorSessionSigner,
  creatorPublicGrantFromSession,
  grantCreatorSession,
  handoffCreatorSession,
  recoverCreatorPasskeyWallet,
  revokeCreatorSession,
  type CreatorBrowserGrantOptions,
  type CreatorPublicGrant,
  type CreatorBrowserWallet,
} from "@/lib/creator-browser-grant";

type DraftValues = CreatorDraftRequest;

type PendingReview = { readonly values: DraftValues; readonly options: CreatorBrowserGrantOptions; readonly walletAddress: string };
type ApiError = { readonly error?: { readonly safeMessage?: string; readonly message?: string }; readonly reason?: string };

function readDraftValues(form: HTMLFormElement): DraftValues {
  const data = new FormData(form);
  return {
    name: String(data.get("name") ?? ""),
    slug: String(data.get("slug") ?? ""),
    description: String(data.get("description") ?? ""),
    protocol: "pancakeswap-v2",
    tradingPair: data.get("tradingPair") === "tbnb-busd" ? "tbnb-busd" : "tbnb-cake",
    inputAmountWei: String(data.get("inputAmountWei") ?? "1000000000000000") as CreatorDraftRequest["inputAmountWei"],
    slippageBps: Number(data.get("slippageBps") ?? 50) as CreatorDraftRequest["slippageBps"],
    quoteMaxAgeSeconds: Number(data.get("quoteMaxAgeSeconds") ?? 60) as CreatorDraftRequest["quoteMaxAgeSeconds"],
    deadlineSeconds: Number(data.get("deadlineSeconds") ?? 120) as CreatorDraftRequest["deadlineSeconds"],
    publicationConsent: true,
    idempotencyKey: crypto.randomUUID(),
  };
}

async function creatorResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.error?.safeMessage ?? body.error?.message ?? "Creator request failed.");
  return body;
}

function pairLabel(pair: DraftValues["tradingPair"]): string {
  return pair === "tbnb-busd" ? "tBNB → BUSD" : "tBNB → CAKE";
}

function amountLabel(amountWei: string): string {
  const labels: Record<string, string> = {
    "100000000000000": "0.0001 tBNB",
    "500000000000000": "0.0005 tBNB",
    "1000000000000000": "0.001 tBNB",
  };
  return labels[amountWei] ?? `${amountWei} wei`;
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Creator request failed.";
}

export function CreatorForm() {
  const { notify } = useToast();
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const walletRef = useRef<CreatorBrowserWallet | null>(null);
  const sessionSignerRef = useRef<Signer | null>(null);
  const sessionRef = useRef<GrantSessionResult | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const authorityIdRef = useRef<string | null>(null);
  const handoffAttemptedRef = useRef(false);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [grant, setGrant] = useState<CreatorPublicGrant | null>(null);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [completion, setCompletion] = useState<{ readonly draftId: string; readonly authorityId: string; readonly deployment: string } | null>(null);
  useEffect(() => {
    const heading = formRef.current?.querySelector<HTMLElement>(`[data-step-heading="${step}"]`);
    heading?.focus();
  }, [step]);

  async function prepareAuthority(recover: boolean): Promise<void> {
    if (handoffAttemptedRef.current) {
      setMessage(handoffFailed ? "The existing browser authority must be revoked before starting a new grant." : "A browser authority has already been handed off; check its deployment status or revoke it before starting a new grant.");
      return;
    }
    const form = formRef.current;
    if (form === null || !form.reportValidity()) return;
    // Snapshot user input before `busy` disables the controls. Disabled form
    // controls are omitted by FormData, so reading after the passkey awaits
    // would silently replace the reviewed values with empty/default fields.
    const values = readDraftValues(form);
    setBusy(true);
    setMessage(null);
    setCompletion(null);
    setGrant(null);
    handoffAttemptedRef.current = false;
    setHandoffFailed(false);
    try {
      const wallet = recover ? await recoverCreatorPasskeyWallet() : await createCreatorPasskeyWallet();
      const sessionSigner = createCreatorSessionSigner();
      const response = await fetch("/api/creator/authority/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ walletAddress: wallet.address, sessionPublicAddress: sessionSigner.address, sessionPublicKey: sessionSigner.publicKey }),
      });
      const options = await creatorResponse<CreatorBrowserGrantOptions>(response);
      if (options.chainId !== 97 || options.policy.walletAddress.toLowerCase() !== wallet.address.toLowerCase() || options.policy.adminAddress.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("The server returned a Creator policy for a different wallet or chain.");
      walletRef.current = wallet;
      sessionSignerRef.current = sessionSigner;
      sessionRef.current = null;
      draftIdRef.current = null;
      authorityIdRef.current = null;
      setApproved(false);
      setPending({ values, options, walletAddress: wallet.address });
      notify({ id: "creator", tone: "info", title: "Creator passkey ready", description: "Review the exact permissions before approving." });
      setMessage("Passkey wallet ready. Review the exact authority below before approving the on-chain grant.");
    } catch (cause) {
      walletRef.current = null;
      sessionSignerRef.current = null;
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function approveAuthority(): Promise<void> {
    const review = pending;
    const wallet = walletRef.current;
    const sessionSigner = sessionSignerRef.current;
    if (review === null || wallet === null || sessionSigner === null || !approved) return;
    setBusy(true);
    setMessage(null);
    let handoffCompleted = false;
    try {
      if (handoffAttemptedRef.current && handoffFailed) throw new Error("The previous runtime handoff failed; revoke the browser authority before retrying.");
      const session = sessionRef.current ?? await grantCreatorSession({ wallet, sessionSigner, options: review.options });
      if (session.walletAddress.toLowerCase() !== wallet.address.toLowerCase() || session.publicKey.toLowerCase() !== sessionSigner.publicKey.toLowerCase()) throw new Error("The Altana SDK returned a session key that does not match the reviewed public key.");
      sessionRef.current = session;
      setGrant(creatorPublicGrantFromSession(wallet.address, session, authorityIdRef.current));
      notify({ id: "creator", tone: "success", title: "Creator authority granted" });

      await authenticateCreatorPasskey(wallet.address, wallet.signer);
      let draftId = draftIdRef.current;
      if (draftId === null) {
        const draftResponse = await fetch("/api/creator/drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify(review.values),
        });
        const draftData = await creatorResponse<{ readonly draft: { readonly id: string } }>(draftResponse);
        draftId = draftData.draft.id;
        draftIdRef.current = draftId;
      }
      let authorityId = authorityIdRef.current;
      if (authorityId === null) {
        const authorityResponse = await fetch(`/api/creator/drafts/${encodeURIComponent(draftId)}/authority`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            walletAddress: wallet.address,
            sessionPublicAddress: sessionSigner.address,
            sessionPublicKey: session.publicKey,
            policyDigest: review.options.policyDigest,
            grantIssuedAtUnix: review.options.grantIssuedAtUnix,
            expiresAtUnix: review.options.expiresAtUnix,
            grantTransactionHash: session.transactionHash ?? null,
          }),
        });
        const authorityData = await creatorResponse<{ readonly authority: { readonly authorityId: string } }>(authorityResponse);
        authorityId = authorityData.authority.authorityId;
        authorityIdRef.current = authorityId;
        setGrant(creatorPublicGrantFromSession(wallet.address, session, authorityId));
      }

      // This is the only point where the memory-only signer material may cross
      // the authenticated boundary. The helper posts exactly once; clear both
      // raw references immediately after it settles, including failures.
      if (!handoffAttemptedRef.current) {
        handoffAttemptedRef.current = true;
        try {
          await handoffCreatorSession({ draftId, authorityId, session, sessionSigner });
          handoffCompleted = true;
        } finally {
          sessionRef.current = null;
          sessionSignerRef.current = null;
        }
      } else {
        throw new Error("The Creator runtime handoff was already attempted; revoke before retrying.");
      }

      let deployment = "not queued: secure runtime secret handoff is pending";
      const deployResponse = await fetch(`/api/creator/drafts/${encodeURIComponent(draftId)}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ authorityId }),
      });
      if (deployResponse.ok) deployment = "queued";
      else {
        const deployData = await deployResponse.json() as ApiError;
        deployment = `not queued: ${deployData.error?.safeMessage ?? deployData.reason ?? "runtime handoff is unavailable"}`;
      }
      setCompletion({ draftId, authorityId, deployment });
      setStep(3);
      notify({ id: "creator", tone: deployment === "queued" ? "info" : "warning", title: deployment === "queued" ? "Deployment queued" : "Deployment needs attention", description: "Check My agents for persisted progress." });
      setPending(null);
      setMessage(deployment === "queued" ? "Authority persisted and deployment queued." : `Authority persisted. Deployment ${deployment}.`);
    } catch (cause) {
      if (handoffAttemptedRef.current && !handoffCompleted && authorityIdRef.current !== null) {
        setPending(null);
        setHandoffFailed(true);
        setMessage(`Authority ${authorityIdRef.current} exists, but the one-time runtime handoff failed: ${errorMessage(cause)} Revoke this browser authority, then start a fresh reviewed grant.`);
      } else if (handoffAttemptedRef.current && handoffCompleted && authorityIdRef.current !== null) {
        setPending(null);
        setMessage(`Authority ${authorityIdRef.current} was handed off; deployment queue status is unknown: ${errorMessage(cause)} Check the Creator dashboard. No new grant was created.`);
      } else {
        const confirmedGrant = creatorPublicGrantFromSession(wallet.address, sessionRef.current, authorityIdRef.current);
        if (confirmedGrant === null) {
          setGrant(null);
          setMessage(`${errorMessage(cause)} Browser grant was not confirmed; no authority was created. Review the exact policy and try again.`);
        } else {
          setGrant((previous) => previous ?? confirmedGrant);
          setMessage(`${errorMessage(cause)} The browser grant signer remains memory-only; use Revoke browser grant before closing this tab if the grant was confirmed.`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function revokeCurrentGrant(): Promise<void> {
    const wallet = walletRef.current;
    const currentGrant = grant;
    if (wallet === null || currentGrant === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const revoked = await revokeCreatorSession({ wallet, sessionPublicKey: currentGrant.sessionPublicKey });
      if (currentGrant.authorityId !== null) {
        const response = await fetch(`/api/creator/authorities/${encodeURIComponent(currentGrant.authorityId)}/browser-revoke`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ sessionPublicKey: currentGrant.sessionPublicKey, transactionHash: revoked.transactionHash }),
        });
        await creatorResponse(response);
      }
      sessionRef.current = null;
      sessionSignerRef.current = null;
      handoffAttemptedRef.current = false;
      setHandoffFailed(false);
      setGrant(null);
      setMessage("Execution authority revoked. Previously submitted transactions and agent history remain unchanged.");
      notify({ id: "creator", tone: "success", title: "Execution authority revoked" });
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function submitForReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (step < 2) advance(); else void prepareAuthority(false);
  }

  function advance(): void {
    const fields = formRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`fieldset[data-step="${step}"] input, fieldset[data-step="${step}"] textarea, fieldset[data-step="${step}"] select`);
    for (const field of fields ?? []) if (!field.reportValidity()) return;
    setStep((current) => Math.min(2, current + 1));
  }

  const controlsDisabled = busy || pending !== null || completion !== null;
  return <form ref={formRef} onSubmit={submitForReview} className="activation-panel creator-wizard" noValidate>
    <ol className="journey-steps">{["Describe", "Configure", "Review permissions", "Deploy & publish"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>
    <fieldset data-step="0" hidden={step !== 0}><legend data-step-heading="0" tabIndex={-1}>Describe your agent</legend><p>This name and description become public. Keep private information out.</p>
    <label>Name<input name="name" required minLength={3} maxLength={80} disabled={controlsDisabled} /></label>
    <label>Public slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} disabled={controlsDisabled} /></label>
    <label>Description<textarea name="description" required minLength={20} maxLength={500} disabled={controlsDisabled} /></label>
    <label><input name="publicationConsent" type="checkbox" required disabled={controlsDisabled} /> I consent to publish this fixed-template agent after verification.</label>
    </fieldset><fieldset data-step="1" hidden={step !== 1}><legend data-step-heading="1" tabIndex={-1}>Configure one-shot swap</legend><p>BNB Smart Chain testnet · Choose the pair and maximum size for one bounded swap.</p>
    <label>Trading pair<select name="tradingPair" defaultValue="tbnb-cake" disabled={controlsDisabled}><option value="tbnb-cake">tBNB → CAKE</option><option value="tbnb-busd">tBNB → BUSD</option></select></label>
    <label>Input amount<select name="inputAmountWei" defaultValue="1000000000000000" disabled={controlsDisabled}><option value="100000000000000">0.0001 tBNB</option><option value="500000000000000">0.0005 tBNB</option><option value="1000000000000000">0.001 tBNB (maximum)</option></select></label>
    <label>Maximum slippage<select name="slippageBps" defaultValue="50" disabled={controlsDisabled}><option value="10">0.10%</option><option value="25">0.25%</option><option value="50">0.50% (maximum)</option></select></label>
    <details><summary>Advanced timing</summary><label>Quote freshness<select name="quoteMaxAgeSeconds" defaultValue="60" disabled={controlsDisabled}><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label>
    <label>Swap deadline<select name="deadlineSeconds" defaultValue="120" disabled={controlsDisabled}><option value="60">60 seconds</option><option value="120">120 seconds</option></select></label>
    </details></fieldset>
    {step < 2 && <div className="detail-actions">{step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}<button type="button" onClick={advance}>Continue</button></div>}
    <div hidden={step !== 2}>
    <h2 data-step-heading="2" tabIndex={-1}>Review execution permissions</h2><p>Create or recover your Creator passkey to see the exact allowed calls, spend limit, and expiry before granting authority.</p>
    <p><small>Only the reviewed pairs and bounded values above are available. Router, token addresses, recipient, selectors, and calldata are derived server-side and cannot be supplied here.</small></p>
    <div className="detail-actions">
      <button type="button" disabled={controlsDisabled} onClick={() => setStep(1)}>Back to configuration</button>
      <button type="submit" disabled={controlsDisabled}>Prepare with a new passkey</button>
      <button type="button" disabled={controlsDisabled} onClick={() => void prepareAuthority(true)}>Recover an existing passkey</button>
    </div>
    </div>

    {pending === null ? null : <fieldset>
      <legend>Exact authority review before the on-chain grant</legend>
      <p><strong>Draft configuration:</strong> {pairLabel(pending.values.tradingPair)} · {amountLabel(pending.values.inputAmountWei)} · {pending.values.slippageBps / 100}% maximum slippage · quote ≤ {pending.values.quoteMaxAgeSeconds}s · deadline {pending.values.deadlineSeconds}s.</p>
      <p><strong>Fixed authority:</strong> BNB Smart Chain testnet (chain 97), wallet <code>{short(pending.walletAddress)}</code>, exactly {pending.options.policy.calls.length} calls:</p>
      <ul>{pending.options.policy.calls.map((call) => <li key={`${call.target}:${call.selectors[0]}`}><code>{call.target} {call.selectors[0]}</code>, max value {call.maxNativeValueWei} wei</li>)}</ul>
      <p>Spend cap: {pending.options.policy.spend.map((entry) => `${entry.limitAtomic} ${entry.token === "native" ? "native units" : entry.token} per ${entry.period}`).join(", ")}; expires at Unix {pending.options.expiresAtUnix} ({new Date(pending.options.expiresAtUnix * 1000).toLocaleString()}).</p>
      <p><small>Policy digest: <code>{pending.options.policyDigest}</code>. The SDK grant and every later revoke require this passkey. The generated session signer remains memory-only in the browser and is handed off once through the authenticated runtime boundary; it is never stored in application data or browser storage, logged, or returned to the UI. Deployment is attempted only after that handoff settles.</small></p>
      <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} disabled={busy} /> I approve this exact pair/configuration and fixed call, spend, and expiry policy.</label>
      <div className="detail-actions"><button type="button" disabled={!approved || busy} onClick={() => void approveAuthority()}>Approve authority and save draft</button><button type="button" disabled={busy} onClick={() => { setPending(null); setApproved(false); }}>Cancel review</button></div>
    </fieldset>}

    {grant === null ? null : <p role="status"><small>Browser grant confirmed for wallet <code>{short(grant.walletAddress)}</code>; session public key <code>{short(grant.sessionPublicKey)}</code>. {grant.authorityId === null ? "Draft persistence is still pending." : "Public authority metadata is persisted; the one-time runtime handoff is not displayed here; deployment state below is the source of truth."}</small><br /><button type="button" disabled={busy} onClick={() => void revokeCurrentGrant()}>Revoke browser grant</button></p>}
    {completion === null ? null : <p role="status">Draft <code>{completion.draftId}</code> and authority <code>{completion.authorityId}</code> are persisted. Deployment: {completion.deployment}. <a href="/creator">View Creator dashboard</a></p>}
    {message === null ? null : <p role="status">{message}</p>}
  </form>;
}
