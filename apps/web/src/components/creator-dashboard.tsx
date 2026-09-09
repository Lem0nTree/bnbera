"use client";

import { useCallback, useEffect, useState } from "react";
import {
  registerCreatorErc8004Agent,
  authenticateCreatorPasskey,
  recoverCreatorPasskeyWallet,
  revokeCreatorSession,
} from "@/lib/creator-browser-grant";

type Draft = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly deploymentId: string | null;
  readonly deploymentState: string | null;
  readonly currentStep: string | null;
  readonly authorityId: string | null;
  readonly configurationDigest?: string;
  readonly configuration?: { tradingPair?: "tbnb-cake" | "tbnb-busd"; inputAmountWei?: string; slippageBps?: number; quoteMaxAgeSeconds?: number; deadlineSeconds?: number };
  readonly authorityStatus?: "none" | "active" | "expired" | "revoked" | null;
  readonly authorityWallet?: string | null;
  readonly authoritySessionPublicKey?: string | null;
  readonly authorityPolicyDigest?: string | null;
  readonly authorityExpiresAtUnix?: number | null;
  readonly authorityGrantTransactionHash?: string | null;
};

type ApiError = { readonly error?: { readonly safeMessage?: string; readonly message?: string } };

function pairLabel(pair: "tbnb-cake" | "tbnb-busd" | undefined): string {
  return pair === "tbnb-busd" ? "tBNB → BUSD" : pair === "tbnb-cake" ? "tBNB → CAKE" : "unknown pair";
}

function amountLabel(amountWei: string | undefined): string {
  const labels: Record<string, string> = {
    "100000000000000": "0.0001 tBNB",
    "500000000000000": "0.0005 tBNB",
    "1000000000000000": "0.001 tBNB",
  };
  return amountWei === undefined ? "unknown amount" : labels[amountWei] ?? `${amountWei} wei`;
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json() as ApiError;
  return body.error?.safeMessage ?? body.error?.message ?? `Request failed (${response.status}).`;
}

export function CreatorDashboard() {
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    const response = await fetch("/api/creator/drafts", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in with the Creator passkey to view drafts." : "Creator drafts are temporarily unavailable.");
    const data = await response.json() as { readonly drafts: Draft[] };
    setDrafts(data.drafts);
  }, []);

  useEffect(() => {
    void loadDrafts().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Creator drafts are temporarily unavailable."));
  }, [loadDrafts]);

  async function authorityStatus(draft: Draft): Promise<void> {
    if (draft.authorityId === null) return;
    setBusyId(draft.authorityId);
    setMessage("Reading the persisted authority status…");
    try {
      const response = await fetch(`/api/creator/authorities/${encodeURIComponent(draft.authorityId)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const data = await response.json() as { readonly authority?: { readonly status?: string; readonly expiresAtUnix?: number; readonly policyDigest?: string }; readonly runtimeReady?: boolean; };
      setMessage(`Authority ${data.authority?.status ?? "unknown"}${data.authority?.expiresAtUnix === undefined ? "" : `; expires ${new Date(data.authority.expiresAtUnix * 1000).toLocaleString()}`}. ${data.runtimeReady === false ? "Browser grant is recorded, but the secure runtime handoff is still pending." : "Live runtime read is available."}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Authority status is temporarily unavailable.");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAuthority(draft: Draft): Promise<void> {
    const authorityWallet = draft.authorityWallet;
    const sessionPublicKey = draft.authoritySessionPublicKey;
    if (draft.authorityId === null || typeof authorityWallet !== "string" || typeof sessionPublicKey !== "string") {
      setMessage("This draft has no complete public browser-authority record to revoke.");
      return;
    }
    setBusyId(draft.authorityId);
    setMessage("Select the Creator passkey to revoke this authority on BNB Smart Chain testnet…");
    try {
      const wallet = await recoverCreatorPasskeyWallet();
      if (wallet.address.toLowerCase() !== authorityWallet.toLowerCase()) throw new Error("The selected passkey does not control the recorded Creator wallet.");
      const revoked = await revokeCreatorSession({ wallet, sessionPublicKey });
      const response = await fetch(`/api/creator/authorities/${encodeURIComponent(draft.authorityId)}/browser-revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ sessionPublicKey, transactionHash: revoked.transactionHash }),
      });
      if (!response.ok) throw new Error(`On-chain revoke confirmed, but the persisted status update failed: ${await responseMessage(response)}`);
      setMessage("Authority revoked by the Creator passkey; the persisted status is now revoked.");
      await loadDrafts();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Authority revoke failed; no persisted status change was made.");
    } finally {
      setBusyId(null);
    }
  }

  async function queueDeployment(draft: Draft): Promise<void> {
    if (draft.authorityId === null) {
      setMessage("Queueing is blocked until a browser authority is persisted.");
      return;
    }
    setBusyId(draft.authorityId);
    setMessage("Checking Studio readiness and secure runtime handoff…");
    try {
      const response = await fetch(`/api/creator/drafts/${encodeURIComponent(draft.id)}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ authorityId: draft.authorityId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage("Deployment queued; the worker will report persisted progress on this dashboard.");
      await loadDrafts();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Deployment was not queued.");
    } finally {
      setBusyId(null);
    }
  }

  async function registerIdentity(draft: Draft): Promise<void> {
    if (draft.deploymentId === null) {
      setMessage("Queue and confirm the managed Studio deployment before registering an ERC-8004 identity.");
      return;
    }
    setBusyId(draft.id);
    setMessage("Recover the Creator passkey to register this agent on BNB Smart Chain testnet…");
    try {
      const status = await registerCreatorErc8004Agent({ deploymentId: draft.deploymentId });
      if (status.state === "registered") {
        setMessage(`ERC-8004 identity ${status.agentId ?? ""} is registered and its finalized service binding is recorded. Marketplace listing and paid-hire state remain separate.`);
      } else if (status.state === "mint_confirmed" || status.state === "uri_pending") {
        setMessage(`ERC-8004 mint ${status.agentId ?? ""} is finalized; the URI update remains ${status.state === "uri_pending" ? "pending reconciliation" : "ready for the passkey"}.`);
      } else {
        setMessage(`ERC-8004 registration remains pending: ${status.pendingReason ?? status.state}. No duplicate mint was submitted.`);
      }
      await loadDrafts();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "ERC-8004 browser registration failed or remains pending.");
    } finally {
      setBusyId(null);
    }
  }

  if (error !== null) return <div><p role="alert">{error}</p><button className="button button--primary" type="button" onClick={() => { void recoverCreatorPasskeyWallet().then(async (wallet) => { await authenticateCreatorPasskey(wallet.address, wallet.signer); setError(null); await loadDrafts(); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Creator sign-in failed.")); }}>Sign in with Creator passkey</button></div>;
  if (drafts === null) return <p>Loading persisted Creator drafts…</p>;
  if (drafts.length === 0) return <p>No agents created yet. <a href="/create">Create your first agent →</a></p>;
  return <>
    <ul className="creator-list">{drafts.map((draft) => {
      const busy = busyId !== null && (busyId === draft.authorityId || busyId === draft.id);
      return <li key={draft.id}>
        <h2>{draft.name}</h2><div className="detail-kv"><span>Draft</span><span>{draft.status}</span></div><div className="detail-kv"><span>Deployment</span><span>{draft.deploymentState ?? "Not queued"}{draft.currentStep === null ? "" : ` · ${draft.currentStep}`}</span></div><div className="detail-kv"><span>Registration & listing</span><span>Separate verification steps; use registration below to read or reconcile its status.</span></div>
        {draft.configuration === undefined ? null : <small>Bounded configuration: {pairLabel(draft.configuration.tradingPair)} · {amountLabel(draft.configuration.inputAmountWei)} · {draft.configuration.slippageBps ?? "unknown"} bps max slippage · quote ≤ {draft.configuration.quoteMaxAgeSeconds ?? "unknown"} seconds · deadline {draft.configuration.deadlineSeconds ?? "unknown"} seconds.</small>}<br />
        {draft.configurationDigest === undefined ? null : <small>Runtime configuration digest: <code>{draft.configurationDigest}</code></small>}<br />
        {draft.authorityId === null ? <small>No delegated authority is recorded.</small> : <>
          <small>Browser authority: {draft.authorityStatus ?? "unknown"}{draft.authorityWallet === null || draft.authorityWallet === undefined ? "" : ` · wallet ${short(draft.authorityWallet)}`}{draft.authorityExpiresAtUnix === null || draft.authorityExpiresAtUnix === undefined ? "" : ` · expires ${new Date(draft.authorityExpiresAtUnix * 1000).toLocaleString()}`}</small><br />
          {draft.authorityPolicyDigest === null || draft.authorityPolicyDigest === undefined ? null : <small>Authority policy digest: <code>{draft.authorityPolicyDigest}</code></small>}<br />
          <button type="button" disabled={busy} onClick={() => void authorityStatus(draft)}>Authority status</button>{draft.authorityStatus === "revoked" ? null : <button type="button" disabled={busy} onClick={() => void revokeAuthority(draft)}>Revoke with passkey</button>}<button type="button" disabled={busy || draft.deploymentState !== null || draft.authorityStatus !== "active"} onClick={() => void queueDeployment(draft)}>Queue deployment</button>{draft.deploymentId === null ? null : <button type="button" disabled={busy} onClick={() => void registerIdentity(draft)}>Register ERC-8004 identity</button>}
        </>}<br />
        <small>Revoking authority stops future delegated writes. It does not delete the identity or undo transactions already submitted.</small>
      </li>;
    })}</ul>
    {message === null ? null : <p role="status">{message}</p>}
  </>;
}
