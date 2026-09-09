"use client";

import { Callout, StatusBadge } from "@bnbera/ui";
import { formatUnits, parseUnits, type WalletClient } from "viem";
import { resumedOperationMatches } from "@/lib/hired-presentation";
import { useToast } from "./toast-provider";
import { bsc, bscTestnet } from "viem/chains";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
  useWalletClient,
  usePublicClient
} from "wagmi";
import type {
  CommerceActionResponse,
  CommerceBrowserDispatch,
  CommerceOperationStatusResponse
} from "@/lib/commerce-contract";
import { commerceQuoteSnapshotSchema, type CommerceQuoteResponse, type CommerceQuoteSnapshot } from "@/lib/commerce-quote-contract";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { isEoaDispatchGenerationCurrent, shouldInvalidateEoaAuthority, EOA_BUYER_CHAIN_ID, type EoaWalletSnapshot } from "@/lib/eoa-wallet";
import { formatSiweMessage } from "@/lib/siwe-message";
import { WalletConnectorChoices } from "./wallet-connector-choices";
import { CommerceResultSummary } from "./commerce-result-summary";
import { referenceBuyerTaskSchema } from "@bnbera/agent-commerce/browser";
import { CommerceQuoteDetails } from "./commerce-quote-details";
import { mainnetSellerProfile } from "@/lib/mainnet-seller-catalog";

type BrowserAuthority = { readonly address: string; readonly chainId: number; readonly walletClient: WalletClient };
type JourneyProps = {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly targetChainId?: 56 | 97;
  /** Canonical ERC-8004 identity key; slugs remain presentation-only. */
  readonly identityKey: string;
  readonly resumeOperationId?: string | null;
  readonly expectedProtocolJobId?: string | null;
  readonly walletOnly?: boolean;
  readonly onAuthenticated?: () => void;
  /** A server-created parent quote/reservation. Never generated client-side. */
  readonly commerceJobId?: string | null;
  /** Detail-read evidence, bound to the same persisted commerce job. */
  readonly runBundle?: MarketplaceAgentReadModel["evidence"]["runBundle"] | undefined;
};

const POLL_INTERVAL_MS = 4_000;

type EoaSiweChallengeResponse = {
  readonly address: string;
  readonly chainId: 56 | 97;
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

function isUserRejected(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const value = cause as { readonly code?: unknown; readonly name?: unknown };
  return value.code === 4001 || value.name === "UserRejectedRequestError" || (cause instanceof Error && /user rejected|rejected the request|request denied/iu.test(cause.message));
}

function operationStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed" || status === "reconciled") return "success";
  if (status === "unknown" || status === "manual_review") return "warning";
  if (status === "reverted") return "danger";
  return "neutral";
}

function safeVerifiedEvidenceLink(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function CommerceJourney(props: JourneyProps) {
  return <CommerceJourneyInner {...props} />;
}

function ExternalSellerResult({ text }: { text: string }) {
  try {
    const manifest: unknown = JSON.parse(text);
    if (!manifest || typeof manifest !== "object" || !("response" in manifest)) return null;
    const response = manifest.response;
    if (!response || typeof response !== "object" || !("content" in response) || typeof response.content !== "string") return null;
    return <section><p className="eyebrow">Agent's delivered report</p><pre className="commerce-journey__manifest">{response.content}</pre></section>;
  } catch { return null; }
}

function CommerceJourneyInner({ activation, targetChainId, identityKey, commerceJobId = null, runBundle = undefined, resumeOperationId = null, expectedProtocolJobId = null, walletOnly = false, onAuthenticated }: JourneyProps) {
  const buyerChainId = targetChainId ?? activation.chainId ?? EOA_BUYER_CHAIN_ID;
  const buyerChain = buyerChainId === 56 ? bsc : bscTestnet;
  const buyerChainLabel = buyerChainId === 56 ? "BNB mainnet" : "BNB testnet";
  const { notify } = useToast();
  const storageKey = useMemo(() => publicStorageKey(identityKey), [identityKey]);
  const quoteKey = useMemo(() => quoteStorageKey(identityKey), [identityKey]);
  const [authority, setAuthority] = useState<BrowserAuthority | null>(null);
  const [walletAuthenticated, setWalletAuthenticated] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<CommerceActionResponse["operation"]>(null);
  const [job, setJob] = useState<CommerceActionResponse["job"]>(null);
  const [dispatch, setDispatch] = useState<CommerceBrowserDispatch | null>(null);
  const [task, setTask] = useState("");
  const [collateral, setCollateral] = useState("");
  const [debt, setDebt] = useState("");
  const [threshold, setThreshold] = useState("");
  const referenceTask = activation.taskKind === "health_factor_monitor";
  const [quote, setQuote] = useState<CommerceQuoteSnapshot | null>(null);
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [warningThreshold, setWarningThreshold] = useState("10");
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const sellerProfile = useMemo(() => {
    const [namespace, network, identityRegistry, agentId] = identityKey.split(":");
    return namespace && identityRegistry && agentId ? mainnetSellerProfile({ namespace, chainId: Number(network), identityRegistry, agentId }) : undefined;
  }, [identityKey]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewScore, setReviewScore] = useState("5");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [transactionHashDraft, setTransactionHashDraft] = useState("");
  const [providerSubmissionHash, setProviderSubmissionHash] = useState("");
  const [terminalReceiptHash, setTerminalReceiptHash] = useState("");
  const [externalDeliveryStatus, setExternalDeliveryStatus] = useState<string | null>(null);
  const [resultReviewed, setResultReviewed] = useState(false);
  const [walletRequest, setWalletRequest] = useState<"connect" | "switch" | null>(null);
  const previousWallet = useRef<EoaWalletSnapshot | null>(null);
  const previousJobState = useRef<string | null>(null);
  const previousOperationState = useRef<string | null>(null);
  const logoutInFlight = useRef(false);
  const { address, chainId, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { signMessageAsync, isPending: signPending } = useSignMessage();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: buyerChainId });
  const liveWalletRef = useRef<{ readonly address: string | undefined; readonly chainId: number | undefined; readonly connected: boolean; readonly authenticated: boolean; readonly walletClient: WalletClient | undefined }>({
    address,
    chainId,
    connected: isConnected,
    authenticated: walletAuthenticated,
    walletClient
  });
  const publicClientRef = useRef(publicClient);
  const walletGenerationRef = useRef(0);
  const walletGenerationKeyRef = useRef<string | null>(null);
  const walletGenerationKey = `${buyerChainId}:${isConnected ? "1" : "0"}:${address?.toLowerCase() ?? ""}:${chainId ?? ""}:${walletAuthenticated ? "1" : "0"}`;
  if (walletGenerationKeyRef.current !== walletGenerationKey) {
    walletGenerationKeyRef.current = walletGenerationKey;
    walletGenerationRef.current += 1;
  }
  liveWalletRef.current = { address, chainId, connected: isConnected, authenticated: walletAuthenticated, walletClient };
  publicClientRef.current = publicClient;

  const walletSnapshot = useMemo<EoaWalletSnapshot>(() => ({
    connected: isConnected,
    address,
    chainId
  }), [address, chainId, isConnected]);
  useEffect(() => { if (walletAuthenticated) onAuthenticated?.(); }, [walletAuthenticated, onAuthenticated]);

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

  const signInWithWallet = useCallback(async () => {
    if (!isConnected || address === undefined) throw new Error("Connect a wallet before signing in.");
    if (chainId !== buyerChainId) throw new Error(`Switch your wallet to ${buyerChainLabel} before signing in.`);
    if (walletClient === undefined) throw new Error("The connected wallet is not ready to sign yet. Try again.");
    const startedGeneration = walletGenerationRef.current;
    const assertSignInWallet = () => {
      if (!isEoaDispatchGenerationCurrent(startedGeneration, walletGenerationRef.current, liveWalletRef.current, address, buyerChainId)) {
        throw new Error("The account or network changed during sign-in. Sign in again with your current wallet.");
      }
    };

    const challengeResponse = await fetch("/api/auth/siwe/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ address, chainId: buyerChainId })
    });
    const challenge = await parseResponse<EoaSiweChallengeResponse>(challengeResponse);
    if (challenge.chainId !== buyerChainId || challenge.address.toLowerCase() !== address.toLowerCase()) {
      throw new Error("The sign-in challenge does not match your selected account and network.");
    }
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
    assertSignInWallet();
    notify({ id: "wallet", tone: "info", title: "Sign in with your wallet", description: "This signature proves ownership. It is not a payment." });
    const signature = await signMessageAsync({ message });
    assertSignInWallet();
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
    try { assertSignInWallet(); } catch (cause) { await logoutBrowserSession(); throw cause; }
    setAuthority({ address, chainId: buyerChainId, walletClient });
    setWalletAuthenticated(true);
    notify({ id: "wallet", tone: "success", title: "Wallet sign-in confirmed" });
  }, [address, chainId, isConnected, signMessageAsync, walletClient, notify, logoutBrowserSession, buyerChainId, buyerChainLabel]);

  const switchToBuyerChain = useCallback(async () => {
    setWalletRequest("switch");
    notify({ id: "wallet", tone: "info", title: `Confirm ${buyerChainLabel} in your wallet` });
    await switchChainAsync({ chainId: buyerChainId });
  }, [switchChainAsync, notify, buyerChainId, buyerChainLabel]);

  const disconnectWallet = useCallback(() => {
    clearBrowserAuthority();
    void logoutBrowserSession();
    disconnect();
  }, [clearBrowserAuthority, disconnect, logoutBrowserSession]);

  const loadOperation = useCallback(async (id: string) => {
    const localHash = resumeOperationId === null ? window.localStorage.getItem(`${storageKey}:tx:${id}`) : null;
    if (localHash !== null && /^0x[0-9a-f]{64}$/iu.test(localHash)) {
      try {
        const recovery = await fetch("/api/commerce/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId: id, transactionHash: localHash })
        });
        const recovered = await parseResponse<CommerceActionResponse>(recovery);
        applyAction(recovered);
        if (recovered.operation?.status !== "unknown" && recovered.operation?.status !== "submitted" && recovered.operation?.status !== "awaiting_signature") window.localStorage.removeItem(`${storageKey}:tx:${id}`);
        return;
      } catch {
        // The actor-bound status read below remains the source of truth when
        // the recovery request is temporarily unavailable.
      }
    }
    const response = await fetch(`/api/commerce/operation/${encodeURIComponent(id)}`, { cache: "no-store" });
    if(response.status===401){clearBrowserAuthority();throw new Error("Your sign-in expired. Sign in again to resume this same saved job; no transaction will be resent.");}
    const body = await parseResponse<CommerceOperationStatusResponse>(response);
    if (resumeOperationId !== null && !resumedOperationMatches(body, id, expectedProtocolJobId, identityKey)) throw new Error("The saved operation does not match this hired job. Return to Hired agents.");
    setOperation(body.operation);
    setJob(body.job);
    setDispatch(body.dispatch);
  }, [applyAction, clearBrowserAuthority, storageKey, resumeOperationId, expectedProtocolJobId, identityKey]);

  useEffect(() => {
    if (walletOnly) return;
    if (resumeOperationId !== null) {
      setOperationId(resumeOperationId);
      void loadOperation(resumeOperationId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The hired job could not be loaded."));
      return;
    }
    const storedQuote = window.localStorage.getItem(quoteKey);
    if (storedQuote !== null) {
      try {
        const parsed = commerceQuoteSnapshotSchema.safeParse(JSON.parse(storedQuote) as unknown);
        if (parsed.success && parsed.data.chainId === buyerChainId && parsed.data.identity.chainId === buyerChainId) {
          setQuote(parsed.data);
          setTask(parsed.data.externalSeller?.requestedTask ?? parsed.data.task);
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
  }, [loadOperation, quoteKey, storageKey, resumeOperationId, walletOnly, buyerChainId]);

  useEffect(() => {
    if (walletRequest === "connect" && isConnected) { notify({ id: "wallet", tone: "success", title: "Wallet connected", description: chainId === buyerChainId ? "Sign in to continue." : `Switch to ${buyerChainLabel} to continue.` }); setWalletRequest(null); }
    if (walletRequest === "switch" && chainId === buyerChainId) { notify({ id: "wallet", tone: "success", title: `${buyerChainLabel} confirmed` }); setWalletRequest(null); }
  }, [walletRequest, isConnected, chainId, notify, buyerChainId, buyerChainLabel]);

  useEffect(() => {
    if (error) notify({ id: "commerce-error", tone: /cancel|reject|denied/iu.test(error) ? "neutral" : "warning", title: /cancel|reject|denied/iu.test(error) ? "Wallet request canceled" : "Action needs attention", description: error });
  }, [error, notify]);

  useEffect(() => {
    const state = job?.job.state ?? null;
    if (previousJobState.current !== null && state !== previousJobState.current) {
      if (state === "submitted") notify({ id: "job-result", tone: "info", title: "Your result is ready", description: "Inspect the exact evidence before deciding." });
      if (state === "completed") notify({ id: "job-result", tone: "success", title: "Settlement confirmed" });
      if (state === "funded") notify({ id: "job-result", tone: "success", title: "Escrow funded", description: "Awaiting the agent's result." });
    }
    previousJobState.current = state;
    const operationState = operation ? `${operation.operationId}:${operation.status}` : null;
    if (!busy && previousOperationState.current !== null && previousOperationState.current !== operationState && operation && ["unknown", "manual_review", "reverted"].includes(operation.status)) notify({ id: operation.operationId, tone: operation.status === "reverted" ? "danger" : "warning", title: operation.status === "reverted" ? "Transaction failed" : "Outcome unknown. Do not resend.", description: "Reload status and reconcile the public transaction evidence." });
    previousOperationState.current = operationState;
  }, [job, operation, notify, busy]);

  useEffect(() => {
    if (operationId === null || !walletAuthenticated || job?.job.state === "completed") return undefined;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling) return;
      polling=true;
      try { await loadOperation(operationId); } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "The commerce operation could not be reloaded.");
      } finally {polling=false;}
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [loadOperation, operationId, walletAuthenticated, job?.job.state]);

  useEffect(() => {
    const previous = previousWallet.current;
    if ((authority !== null && authority.chainId !== buyerChainId) || shouldInvalidateEoaAuthority(previous, walletSnapshot, authority)) {
      clearBrowserAuthority();
      void logoutBrowserSession();
      setError("The connected account or network changed. Sign in again before continuing.");
    }
    previousWallet.current = walletSnapshot;
  }, [authority, clearBrowserAuthority, logoutBrowserSession, walletSnapshot, buyerChainId]);

  useEffect(() => {
    if (!isConnected || address === undefined || chainId !== buyerChainId || walletClient === undefined || walletAuthenticated) return undefined;
    let stopped = false;
    void fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => parseResponse<{ readonly authenticated?: boolean; readonly walletAddress?: string; readonly chainId?: number }>(response))
      .then((session) => {
        if (stopped || session.authenticated !== true) return;
        if (session.walletAddress?.toLowerCase() !== address.toLowerCase() || session.chainId !== buyerChainId) {
          // Do not leave a cookie for a previous account active when a
          // restored WalletConnect session belongs to another EOA.
          void logoutBrowserSession();
          return;
        }
        setAuthority({ address, chainId: buyerChainId, walletClient });
        setWalletAuthenticated(true);
      })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [address, chainId, isConnected, logoutBrowserSession, walletAuthenticated, walletClient, buyerChainId]);

  const requestQuote = async () => {
    if (!walletAuthenticated) { setError("Connect and sign in with the buyer wallet before requesting a quote."); return; }
    if (!referenceTask && task.trim() === "") { setError("Describe the result you need before requesting a quote."); return; }
    setBusy(true);
    setError(null);
    try {
      const quotedTask = referenceTask ? JSON.stringify(referenceBuyerTaskSchema.parse({
        schemaVersion: "bnbera.reference.health-factor.user-task/v1", collateralValueUsd: collateral,
        debtValueUsd: debt, liquidationThresholdBps: Math.round(Number(threshold) * 100), observedAtUnix: Math.floor(Date.now() / 1000)
      })) : task.trim();
      const response = await fetch("/api/commerce/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIdentifier: identityKey, task: quotedTask })
      });
      const body = await parseResponse<CommerceQuoteResponse>(response);
      const parsed = commerceQuoteSnapshotSchema.parse(body.quote);
      if (parsed.chainId !== buyerChainId || parsed.identity.chainId !== buyerChainId) throw new Error("The quote network does not match this agent. Request a fresh quote for the intended network.");
      setQuote(parsed);
      setTask(parsed.externalSeller?.requestedTask ?? parsed.task);
      setQuoteConfirmed(false);
      setRiskConfirmed(false);
      window.localStorage.setItem(quoteKey, JSON.stringify(parsed));
      notify({ id: "quote", tone: "success", title: "Quote ready", description: "Review the task, price, provider, and expiry." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The server quote could not be prepared.");
    } finally { setBusy(false); }
  };

  const prepareHire = async () => {
    if (!walletAuthenticated) { setError("Connect and sign in with the buyer wallet before preparing funding."); return; }
    if (quote && (!quoteConfirmed || (quote.externalSeller && !riskConfirmed))) { setError("Confirm the exact offer and disclosed risks before preparing wallet transactions."); return; }
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
    const startGeneration = walletGenerationRef.current;
    const initialWallet = liveWalletRef.current;
    if (!initialWallet.authenticated || !isEoaDispatchGenerationCurrent(startGeneration, walletGenerationRef.current, { connected: initialWallet.connected, address: initialWallet.address, chainId: initialWallet.chainId }, nextDispatch.actorAddress, buyerChainId)) { setError("Connect and sign in with the buyer wallet before signing this action."); return; }
    if (nextDispatch.chainId !== buyerChainId) { setError("The persisted operation network does not match this hire."); return; }
    if (initialWallet.address === undefined || initialWallet.address.toLowerCase() !== nextDispatch.actorAddress.toLowerCase()) {
      setError("The connected wallet does not match the authenticated operation actor; no call was sent.");
      return;
    }
    if (initialWallet.walletClient === undefined || nextDispatch.to === undefined || nextDispatch.data === undefined || nextDispatch.valueAtomic === undefined) {
      setError("The server did not return a complete pinned EOA call; no transaction was sent.");
      return;
    }
    const liveWalletFor = (candidate: CommerceBrowserDispatch): { readonly address: string; readonly walletClient: WalletClient } => {
      const live = liveWalletRef.current;
      if (candidate.chainId !== buyerChainId) throw new Error("The returned wallet call is on a different network; no call was sent.");
      if (!live.authenticated || live.walletClient === undefined || !isEoaDispatchGenerationCurrent(startGeneration, walletGenerationRef.current, { connected: live.connected, address: live.address, chainId: live.chainId }, candidate.actorAddress, buyerChainId)) throw new Error("The connected wallet or network changed; no further call was sent.");
      if (live.address === undefined) throw new Error("The connected wallet account is unavailable; no further call was sent.");
      return { address: live.address, walletClient: live.walletClient };
    };
    setBusy(true);
    setError(null);
    let inFlight: { readonly operationId: string; readonly transactionHash?: string } | null = null;
    try {
      let current: CommerceBrowserDispatch | null = nextDispatch;
      while (current !== null) {
        if (current.chainId !== buyerChainId || current.to === undefined || current.data === undefined || current.valueAtomic === undefined) throw new Error("The persisted EOA step is incomplete or on the wrong network.");
        inFlight = { operationId: current.operationId };
        liveWalletFor(current);
        const claimResponse = await fetch("/api/commerce/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId: current.operationId, claim: true })
        });
        const claimed: CommerceActionResponse = await parseResponse<CommerceActionResponse>(claimResponse);
        applyAction(claimed);
        if (claimed.dispatch === null) throw new Error("This wallet step is already in flight or unknown; it will not be resent.");
        current = claimed.dispatch;
        const live = liveWalletFor(current);
        let transactionHash: string;
        try {
          notify({ id: current.operationId, tone: "info", title: `Confirm ${statusLabel(current.step ?? current.action)} in your wallet` });
          transactionHash = await live.walletClient.sendTransaction({
            account: live.address as `0x${string}`,
            to: current.to as `0x${string}`,
            data: current.data as `0x${string}`,
            value: BigInt(current.valueAtomic as string),
            chain: buyerChain
          });
        } catch (cause) {
          // Only an explicit wallet rejection may release the pre-send CAS.
          // Every other wallet failure leaves the claimed operation unknown.
          if (isUserRejected(cause)) {
            try {
              const rejection = await fetch("/api/commerce/dispatch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operationId: current.operationId, walletRejected: true })
              });
              applyAction(await parseResponse<CommerceActionResponse>(rejection));
              inFlight = null;
            } catch {
              // Keep the durable unknown claim; a failed release must not
              // create another fundable dispatch.
            }
          }
          throw cause;
        }
        inFlight = { operationId: current.operationId, transactionHash };
        window.localStorage.setItem(`${storageKey}:tx:${current.operationId}`, transactionHash);
        notify({ id: current.operationId, tone: "info", title: "Transaction submitted", description: "Waiting for network confirmation." });
        const livePublicClient = publicClientRef.current;
        if (livePublicClient !== undefined) { await livePublicClient.waitForTransactionReceipt({ hash: transactionHash as `0x${string}` }); notify({ id: current.operationId, tone: "info", title: "Verifying transaction", description: "The server is checking the exact operation." }); }
        const response: Response = await fetch("/api/commerce/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId: current.operationId, transactionHash })
        });
        const result: CommerceActionResponse = await parseResponse<CommerceActionResponse>(response);
        applyAction(result);
        const confirmedStep = result.job?.operations.find((entry) => entry.operationId === current?.operationId) ?? (result.operation?.operationId === current.operationId ? result.operation : null);
        if (confirmedStep && ["confirmed", "reconciled"].includes(confirmedStep.status)) notify({ id: current.operationId, tone: "success", title: `${statusLabel(current.step ?? current.action)} confirmed` });
        window.localStorage.removeItem(`${storageKey}:tx:${current.operationId}`);
        inFlight = null;
        current = result.dispatch;
      }
    } catch (cause) {
      if (inFlight !== null && !isUserRejected(cause)) {
        try {
          const recovery = await fetch("/api/commerce/dispatch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operationId: inFlight.operationId, ...(inFlight.transactionHash === undefined ? {} : { transactionHash: inFlight.transactionHash }) })
          });
          applyAction(await parseResponse<CommerceActionResponse>(recovery));
          if (inFlight.transactionHash !== undefined) window.localStorage.removeItem(`${storageKey}:tx:${inFlight.operationId}`);
        } catch {
          // Keep the local public hash so a reload can attach it without a
          // second wallet send.
        }
      }
      setError(cause instanceof Error ? cause.message : "The wallet transaction could not be completed. Do not resend an unknown transaction; reload to reconcile it.");
    } finally { setBusy(false); }
  };

  const attachTransactionHash = async () => {
    if (operation === null) {
      setError("No persisted commerce operation is available for transaction recovery.");
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
        body: JSON.stringify({ operationId: operation.operationId, transactionHash, ...(operation.callsId === null ? {} : { callsId: operation.callsId }) })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
      setTransactionHashDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The public transaction hash could not be attached safely.");
    } finally { setBusy(false); }
  };

  const externalDelivery = async (action: "deliver" | "refresh-result" | "reconcile-terminal") => {
    if (!walletAuthenticated || chainId !== 56 || !job || buyerChainId !== 56) { setError("Connect and sign in with this job's BNB mainnet buyer wallet."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/commerce/${encodeURIComponent(job.job.jobKey.jobId)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "reconcile-terminal" ? { transactionHash: terminalReceiptHash.trim() } : action === "refresh-result" && providerSubmissionHash.trim() ? { transactionHash: providerSubmissionHash.trim() } : {}) });
      const result = await parseResponse<{ status: string; replayed?: boolean }>(response);
      setExternalDeliveryStatus(["completed", "rejected", "expired"].includes(result.status) ? `Finalized onchain outcome reconciled: ${result.status}. No buyer approval was invented.` : result.status === "result_verified" ? "Result retrieved and matched to the provider's on-chain submission." : result.status === "awaiting_provider" ? "The provider has not submitted a result yet." : result.status === "notified" ? "The provider acknowledged this funded job. Check for its result below." : "A delivery request was already saved. Check for the result; the request will not be sent again.");
      if (operationId) await loadOperation(operationId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The provider action could not be confirmed."); }
    finally { setBusy(false); }
  };

  const decide = async (action: "approve" | "dispute") => {
    if (action === "approve" && !resultReviewed) { setError("Review and acknowledge the exact result before approving settlement."); return; }
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

  const claimRefund = async () => {
    if (!walletAuthenticated || job === null) {
      setError("Connect and sign in with the buyer wallet before claiming a refund.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commerce/${encodeURIComponent(job.job.jobKey.jobId)}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: makeIdempotencyKey("refund") })
      });
      applyAction(await parseResponse<CommerceActionResponse>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The refund call could not be prepared.");
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
      notify({ id: "review", tone: "success", title: "Verified-purchase review saved" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verified-purchase review could not be saved.");
    } finally { setBusy(false); }
  };

  if (!activation.enabled && resumeOperationId === null && operationId === null && quote === null && !walletOnly) return <p className="activation-panel__footnote">New tasks are paused. Existing reserved jobs can still be resumed from My hires.</p>;

  const canDispatch = dispatch !== null && operation?.status === "awaiting_signature";
  const pending = operation !== null && ["awaiting_signature", "submitted", "unknown", "manual_review"].includes(operation.status);
  const completed = job?.job.state === "completed";
  const submission = job?.submission ?? null;
  const submitted = job !== null && job.job.state === "submitted" && submission !== null;
  const refundable = job !== null && (job.job.state === "funded" || job.job.state === "submitted") && job.job.terms.expiresAtUnix <= Math.floor(Date.now() / 1_000);
  const currentRunBundle = completed && commerceJobId !== null && runBundle?.jobId === commerceJobId
    ? runBundle
    : null;

  return (
    <div className="commerce-journey" data-testid="commerce-journey">
      <div className="commerce-journey__header"><strong>{walletOnly ? "Buyer wallet" : "Hire this agent"}</strong><StatusBadge value={`${buyerChainLabel} · ${buyerChainId}`} tone="info" />{operation !== null && <StatusBadge value={statusLabel(operation.status)} tone={operationStatusTone(operation.status)} />}</div>
      {!walletOnly && <ol className="journey-steps">{["Task", "Quote", "Fund escrow", "Review result", "Complete"].map((label, index) => <li key={label} aria-current={index === (completed ? 4 : submitted ? 3 : operationId ? 2 : quote ? 1 : 0) ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>}
      <div className="commerce-journey__authority">
        <p className="detail-section__lede">Choose a browser wallet or WalletConnect, then sign in to prove wallet ownership. Sign-in is gasless and does not approve a payment.</p>
        {!isConnected && <WalletConnectorChoices chainId={buyerChainId} disabled={busy} />}
        {isConnected && chainId !== buyerChainId && <>
          <p className="muted-label">Connected on chain {chainId ?? "unknown"}. This hire requires {buyerChainLabel} ({buyerChainId}).</p>
          <button className="button button--primary" type="button" disabled={busy || switchPending} onClick={() => {
            setBusy(true);
            setError(null);
            void switchToBuyerChain().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The wallet network could not be changed.")).finally(() => setBusy(false));
          }}>Switch to {buyerChainLabel}</button>
        </>}
        {isConnected && chainId === buyerChainId && !walletAuthenticated && <button className="button button--primary" type="button" disabled={busy || signPending} onClick={() => {
          setBusy(true);
          setError(null);
          void signInWithWallet().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The wallet sign-in could not be completed.")).finally(() => setBusy(false));
        }}>Sign in with wallet</button>}
        {isConnected && chainId === buyerChainId && walletAuthenticated && <div className="detail-actions">
          <p className="muted-label">Buyer wallet ready · {authority?.address ?? address}</p>
          <button className="button button--ghost button--small" type="button" disabled={busy} onClick={disconnectWallet}>Disconnect wallet</button>
        </div>}
      </div>
      {error !== null && <Callout title="Commerce action stopped" tone="warning" icon="!">{error}</Callout>}
      {!walletOnly && <>
      {job && <div className="detail-kv"><span>Job {job.job.jobKey.jobId}</span><strong>{job.job.state === "funded" ? "Escrow funded · awaiting the agent" : job.job.state === "submitted" ? "Your result is ready" : statusLabel(job.job.state)}</strong></div>}
      {operationId === null && quote === null && <div className="commerce-journey__quote">
        {referenceTask ? <fieldset className="reference-task-inputs"><legend>Your lending snapshot</legend><p>Enter your own values. The agent calculates collateral × liquidation threshold ÷ debt and explains the result. These values are buyer-attested; no on-chain position is fetched.</p><label>Collateral value · USD<input inputMode="decimal" value={collateral} onChange={event=>setCollateral(event.target.value)} placeholder="e.g. 2000" /></label><label>Debt value · USD<input inputMode="decimal" value={debt} onChange={event=>setDebt(event.target.value)} placeholder="e.g. 1000" /></label><label>Liquidation threshold · %<input inputMode="decimal" value={threshold} onChange={event=>setThreshold(event.target.value)} placeholder="e.g. 80" /></label></fieldset> : <>
        <label htmlFor={`${identityKey}-task`}>Task</label>
        {sellerProfile && <><p>Read-only task · {sellerProfile.inputKind === "text" ? "Describe your requested report." : "Use the seller's structured JSON input. Values below are hypothetical examples, not current market data."}</p><button type="button" className="button button--ghost button--small" onClick={() => setTask(sellerProfile.exampleTask)}>Use editable example</button><a href={sellerProfile.card} target="_blank" rel="noreferrer">Published input contract</a></>}
        <textarea id={`${identityKey}-task`} value={task} maxLength={4_096} onChange={(event) => setTask(event.target.value)} placeholder="Describe the result you need" />
        </>}
        <p className="muted-label">Price, provider, identity and payment terms are resolved from the current published listing on the server.</p>
        <button className="button button--primary" type="button" disabled={busy || (referenceTask ? !collateral || !debt || !threshold : task.trim() === "")} onClick={() => void requestQuote()}>Request server quote</button>
      </div>}
      {operationId === null && quote !== null && <div className="commerce-journey__quote">
        <CommerceQuoteDetails quote={quote} />
        {quote.externalSeller && <>
          <label>Optional price warning ({quote.tokenSymbol ?? "tokens"})<input inputMode="decimal" value={warningThreshold} onChange={event => setWarningThreshold(event.target.value)} placeholder="Blank disables warnings" /></label>
          {(() => { try { return warningThreshold.trim() && BigInt(quote.priceAtomic) > parseUnits(warningThreshold, quote.paymentDecimals) ? <p role="status">This offer exceeds your warning threshold. It is still available at the exact displayed price.</p> : null; } catch { return <p role="status">Enter a decimal warning threshold or leave it blank. This setting never changes or rejects the seller price.</p>; } })()}
          <label><input type="checkbox" checked={riskConfirmed} onChange={event => setRiskConfirmed(event.target.checked)} /> I accept this seller's delivery risk, the seven-day permissionless settlement policy and token issuer controls.</label>
        </>}
        <label className="detail-actions"><input type="checkbox" checked={quoteConfirmed} onChange={(event) => setQuoteConfirmed(event.target.checked)} /> I confirm {formatUnits(BigInt(quote.priceAtomic), quote.paymentDecimals)} {quote.tokenSymbol ?? "tokens"}, {quote.paymentDecimals} decimals, token {quote.paymentToken}, chain {quote.chainId}, and this exact task. Gas is additional.</label>
        <button className="button button--primary" type="button" disabled={busy || !quoteConfirmed || (!!quote.externalSeller && !riskConfirmed)} onClick={() => void prepareHire()}>Prepare explicit funding</button>
        <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => { setQuote(null); setQuoteConfirmed(false); window.localStorage.removeItem(quoteKey); }}>Request a fresh quote</button>
      </div>}
      {operationId && <><p>Funding uses five separate wallet confirmations. Each confirmed step is retained.</p><ol className="funding-steps">{["create", "register", "set_budget", "approve", "fund"].map((step) => { const record = job?.operations.findLast((entry) => entry.kind === step); return <li key={step}>{statusLabel(step)} · {record ? statusLabel(record.status) : dispatch?.step === step ? "Awaiting wallet" : "Not observed"}{record?.transactionHash && <details><summary>Transaction receipt</summary><code>{record.transactionHash}</code></details>}</li>; })}</ol></>}
      {canDispatch && <><div className="detail-kv"><span>Next wallet call</span><strong>{statusLabel(dispatch.step ?? dispatch.action)}</strong></div><p>Recipient: <code>{dispatch.to}</code> · value {dispatch.valueAtomic} wei · chain {dispatch.chainId}</p><details><summary>Exact transaction data</summary><code>{dispatch.data}</code></details><button className="button button--primary" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== buyerChainId} onClick={() => void dispatchBrowser(dispatch)}>Review and sign {statusLabel(dispatch.step ?? dispatch.action)}</button></>}
      {operationId && <button className="button button--ghost" type="button" onClick={() => void loadOperation(operationId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Status unavailable"))}>Reload status</button>}
      {buyerChainId === 56 && operationId && (!job || !["funded", "submitted", "completed", "rejected", "expired"].includes(job.job.state)) && <p className="directory-footnote">Allowance safety: approval is for the exact offer, never unlimited. Funding consumes it. If you stop after approving, closing this page does not revoke it; use your wallet's token-permissions controls to set the chain-56 U allowance for the displayed Commerce contract to zero. Do not approve a different spender or token.</p>}
      {buyerChainId === 56 && job && !completed && ["funded", "submitted"].includes(job.job.state) && <div className="commerce-journey__delivery">
        <p className="eyebrow">Provider delivery</p><p>Once escrow is funded, ask the agent to begin. Its result is verified against the submission receipt before you can approve it.</p>
        {job.job.state === "funded" && <button className="button button--primary" type="button" disabled={busy || !walletAuthenticated || chainId !== 56} onClick={() => void externalDelivery("deliver")}>Request delivery</button>}
        <button className="button button--ghost" type="button" disabled={busy || !walletAuthenticated || chainId !== 56} onClick={() => void externalDelivery("refresh-result")}>Check for result</button>
        {externalDeliveryStatus && <p role="status">{externalDeliveryStatus}</p>}
        <details><summary>Recover a provider submission</summary><label>Provider submission transaction hash<input value={providerSubmissionHash} onChange={event => setProviderSubmissionHash(event.target.value)} placeholder="0x…" autoComplete="off" /></label><p>Optional: use the public submission receipt if the agent completed a long-running job.</p></details>
        <details><summary>Recover an onchain settlement or refund</summary><p>APEX settlement and expiry refunds are permissionless. If another account already finalized this job, supply its public transaction receipt. Completed jobs require the result above to be retrieved and verified first.</p><label>Settlement or refund transaction hash<input value={terminalReceiptHash} onChange={event => setTerminalReceiptHash(event.target.value)} placeholder="0x…" autoComplete="off" /></label><button className="button button--ghost" type="button" disabled={busy || !walletAuthenticated || !/^0x[0-9a-f]{64}$/iu.test(terminalReceiptHash.trim())} onClick={() => void externalDelivery("reconcile-terminal")}>Verify public outcome · no transaction</button></details>
      </div>}
      {pending && operation?.status !== "awaiting_signature" && <p className="muted-label">{busy?"Confirm the current request in your wallet. Each confirmed step is retained; no transaction is automatically resent.":"This operation is pending or ambiguous. It will not be resent. Reload or attach the same public transaction hash when available."}</p>}
      {pending && operation?.status !== "awaiting_signature" && <div className="commerce-journey__recovery">
        <label htmlFor={`${identityKey}-transaction-hash`}>Public transaction hash (optional recovery)</label>
        <input id={`${identityKey}-transaction-hash`} value={transactionHashDraft} onChange={(event) => setTransactionHashDraft(event.target.value)} placeholder="0x…" inputMode="text" autoComplete="off" />
        <button className="button button--ghost button--small" type="button" disabled={busy || transactionHashDraft.trim() === ""} onClick={() => void attachTransactionHash()}>Attach and reconcile</button>
      </div>}
      {submission !== null && <div className="commerce-journey__result">
        {submission.result !== null && <CommerceResultSummary result={submission.result} />}
        {buyerChainId === 56 && submission.manifestText && <ExternalSellerResult text={submission.manifestText} />}
        <p className="eyebrow">Exact result evidence</p>
        <div className="detail-kv"><span>Protocol job</span><code>{job?.job.jobKey.jobId ?? "Not observed"}</code></div>
        <div className="detail-kv"><span>Local SHA-256</span><code>{submission.localSha256}</code></div>
        <div className="detail-kv"><span>On-chain Keccak</span><code>{submission.chainKeccak}</code></div>
        <div className="detail-kv"><span>Submission receipt</span><code>{submission.transactionHash}</code></div>
        {job?.job.completionTransactionHash !== null && job?.job.completionTransactionHash !== undefined && <div className="detail-kv"><span>Settlement receipt</span><code>{job.job.completionTransactionHash}</code></div>}
        {currentRunBundle !== null && <div className="detail-kv"><span>Greenfield run_bundle</span><span><StatusBadge value={statusLabel(currentRunBundle.status)} tone={currentRunBundle.status === "verified" ? "success" : currentRunBundle.status === "failed" ? "danger" : currentRunBundle.status === "pending" ? "warning" : "neutral"} />{currentRunBundle.status === "verified" && safeVerifiedEvidenceLink(currentRunBundle.readUrl) !== null ? <a href={safeVerifiedEvidenceLink(currentRunBundle.readUrl) ?? undefined} target="_blank" rel="noreferrer">Open verified JSON</a> : currentRunBundle.reason ?? "No verified Greenfield publication is available."}</span></div>}
        {submission.result !== null && <details><summary>Raw result evidence</summary><pre className="commerce-journey__manifest">{JSON.stringify(submission.result, null, 2)}</pre></details>}
        {submission.manifestText !== null && <details><summary>Exact result manifest</summary><pre className="commerce-journey__manifest">{submission.manifestText}</pre></details>}
      </div>}
      {submitted && <div className="commerce-journey__decision">
        {job?.settlementGate?.status==="waiting"&&<p role="status">Dispute window · Settlement can be requested after {new Date(job.settlementGate.notBeforeUnix!*1000).toLocaleString()}. {buyerChainId === 56 ? "Anyone can settle then; disputes need sufficient rejection votes. This app does not automatically send wallet transactions." : "Inspect the result now; this app does not automatically send wallet transactions."}</p>}
        {job?.settlementGate?.status==="unavailable"&&<p role="status">The settlement policy check is unavailable. Reload status before approving.</p>}
        <p className="detail-section__lede">Inspect the exact bytes and digest, then choose one buyer decision.</p>
        <label><input type="checkbox" checked={resultReviewed} onChange={(event) => setResultReviewed(event.target.checked)} /> I reviewed this result and its exact evidence.</label>
        <div className="detail-actions"><button className="button button--primary" type="button" disabled={busy || !resultReviewed || authority === null || !walletAuthenticated || chainId !== buyerChainId || (job?.settlementGate!==undefined&&job.settlementGate.status!=="ready")} onClick={() => void decide("approve")}>Approve and settle</button><button className="button button--ghost button--small" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== buyerChainId} onClick={() => void decide("dispute")}>Dispute result</button></div>
      </div>}
      {refundable && <div className="commerce-journey__decision"><p className="detail-section__lede">This funded job has expired without a completed result.</p><button className="button button--ghost button--small" type="button" disabled={busy || !walletAuthenticated || chainId !== buyerChainId} onClick={() => void claimRefund()}>Claim refund</button></div>}
      {completed && !reviewSent && <div className="commerce-journey__review">
        <p className="eyebrow">Verified-purchase review</p>
        <select value={reviewScore} onChange={(event) => setReviewScore(event.target.value)} aria-label="Review score"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Mixed</option><option value="2">2 · Poor</option><option value="1">1 · Failed</option></select>
        <textarea value={reviewComment} maxLength={2_000} onChange={(event) => setReviewComment(event.target.value)} placeholder="Optional buyer note" aria-label="Review comment" />
        <button className="button button--ghost button--small" type="button" disabled={busy || !walletAuthenticated || (quote?.quoteId ?? commerceJobId) === null || (quote?.quoteId ?? commerceJobId) === undefined} onClick={() => void createReview()}>Save verified review</button>
      </div>}
      {completed && reviewSent && <p className="muted-label">Verified-purchase review saved for this completed job.</p>}
      {completed && resumeOperationId===null && <button className="button button--ghost button--small" type="button" disabled={busy||!activation.enabled} onClick={()=>{
        window.localStorage.removeItem(storageKey);window.localStorage.removeItem(quoteKey);
        setOperationId(null);setOperation(null);setJob(null);setDispatch(null);setQuote(null);setQuoteConfirmed(false);
        setResultReviewed(false);setReviewSent(false);setReviewComment("");setTransactionHashDraft("");setError(null);
        previousJobState.current=null;previousOperationState.current=null;
      }}>Start another task</button>}
      </>}
    </div>
  );
}
