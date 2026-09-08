"use client";

import { Callout, StatusBadge } from "@bnbera/ui";
import type { WalletClient } from "viem";
import { bscTestnet } from "viem/chains";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
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
import { EoaWalletProvider, walletConnectProjectConfigured } from "./eoa-wallet-provider";

type BrowserAuthority = { readonly address: string; readonly chainId: number; readonly walletClient: WalletClient };
type JourneyProps = {
  readonly activation: MarketplaceAgentReadModel["activation"];
  /** Canonical ERC-8004 identity key; slugs remain presentation-only. */
  readonly identityKey: string;
  /** A server-created parent quote/reservation. Never generated client-side. */
  readonly commerceJobId?: string | null;
  /** Detail-read evidence, bound to the same persisted commerce job. */
  readonly runBundle?: MarketplaceAgentReadModel["evidence"]["runBundle"] | undefined;
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
  return (
    <EoaWalletProvider>
      <CommerceJourneyInner {...props} />
    </EoaWalletProvider>
  );
}

function CommerceJourneyInner({ activation, identityKey, commerceJobId = null, runBundle = undefined }: JourneyProps) {
  const storageKey = useMemo(() => publicStorageKey(identityKey), [identityKey]);
  const quoteKey = useMemo(() => quoteStorageKey(identityKey), [identityKey]);
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
  const publicClient = usePublicClient();
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
  const walletGenerationKey = `${isConnected ? "1" : "0"}:${address?.toLowerCase() ?? ""}:${chainId ?? ""}:${walletAuthenticated ? "1" : "0"}`;
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
    const localHash = window.localStorage.getItem(`${storageKey}:tx:${id}`);
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
    const body = await parseResponse<CommerceOperationStatusResponse>(response);
    setOperation(body.operation);
    setJob(body.job);
    setDispatch(body.dispatch);
  }, [applyAction, storageKey]);

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
        body: JSON.stringify({ agentIdentifier: identityKey, task: task.trim() })
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
    const startGeneration = walletGenerationRef.current;
    const initialWallet = liveWalletRef.current;
    if (!initialWallet.authenticated || !isEoaDispatchGenerationCurrent(startGeneration, walletGenerationRef.current, { connected: initialWallet.connected, address: initialWallet.address, chainId: initialWallet.chainId }, nextDispatch.actorAddress)) { setError("Connect and sign in with the buyer wallet before signing this action."); return; }
    if (nextDispatch.chainId !== EOA_BUYER_CHAIN_ID) { setError("The persisted operation network is not BNB Smart Chain testnet."); return; }
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
      if (!live.authenticated || live.walletClient === undefined || !isEoaDispatchGenerationCurrent(startGeneration, walletGenerationRef.current, { connected: live.connected, address: live.address, chainId: live.chainId }, candidate.actorAddress)) throw new Error("The connected wallet or network changed; no further call was sent.");
      if (live.address === undefined) throw new Error("The connected wallet account is unavailable; no further call was sent.");
      return { address: live.address, walletClient: live.walletClient };
    };
    setBusy(true);
    setError(null);
    let inFlight: { readonly operationId: string; readonly transactionHash?: string } | null = null;
    try {
      let current: CommerceBrowserDispatch | null = nextDispatch;
      while (current !== null) {
        if (current.chainId !== EOA_BUYER_CHAIN_ID || current.to === undefined || current.data === undefined || current.valueAtomic === undefined) throw new Error("The persisted EOA step is incomplete or on the wrong network.");
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
          transactionHash = await live.walletClient.sendTransaction({
            account: live.address as `0x${string}`,
            to: current.to as `0x${string}`,
            data: current.data as `0x${string}`,
            value: BigInt(current.valueAtomic as string),
            chain: bscTestnet
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
        const livePublicClient = publicClientRef.current;
        if (livePublicClient !== undefined) await livePublicClient.waitForTransactionReceipt({ hash: transactionHash as `0x${string}` });
        const response: Response = await fetch("/api/commerce/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationId: current.operationId, transactionHash })
        });
        const result: CommerceActionResponse = await parseResponse<CommerceActionResponse>(response);
        applyAction(result);
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
      setError(cause instanceof Error ? cause.message : "The WalletConnect transaction could not be completed. Do not resend an unknown transaction; reload to reconcile it.");
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
  const refundable = job !== null && (job.job.state === "funded" || job.job.state === "submitted") && job.job.terms.expiresAtUnix <= Math.floor(Date.now() / 1_000);
  const currentRunBundle = completed && commerceJobId !== null && runBundle?.jobId === commerceJobId
    ? runBundle
    : null;

  return (
    <div className="commerce-journey" data-testid="commerce-journey">
      <div className="commerce-journey__header"><strong>ERC-8183 paid task</strong>{operation !== null && <StatusBadge value={statusLabel(operation.status)} tone={operationStatusTone(operation.status)} />}</div>
      <div className="commerce-journey__authority">
        <p className="detail-section__lede">Connect your EOA through WalletConnect. It handles compatible browser and mobile wallets; BNBEra receives only the signed SIWE proof and public operation evidence.</p>
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
        <label htmlFor={`${identityKey}-task`}>Task</label>
        <textarea id={`${identityKey}-task`} value={task} maxLength={4_096} onChange={(event) => setTask(event.target.value)} placeholder="Describe the result you need" />
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
      {pending && operation?.status !== "awaiting_signature" && <div className="commerce-journey__recovery">
        <label htmlFor={`${identityKey}-transaction-hash`}>Public transaction hash (optional recovery)</label>
        <input id={`${identityKey}-transaction-hash`} value={transactionHashDraft} onChange={(event) => setTransactionHashDraft(event.target.value)} placeholder="0x…" inputMode="text" autoComplete="off" />
        <button className="button button--ghost button--small" type="button" disabled={busy || transactionHashDraft.trim() === ""} onClick={() => void attachTransactionHash()}>Attach and reconcile</button>
      </div>}
      {submission !== null && <div className="commerce-journey__result">
        <p className="eyebrow">Exact result evidence</p>
        <div className="detail-kv"><span>Protocol job</span><code>{job?.job.jobKey.jobId ?? "Not observed"}</code></div>
        <div className="detail-kv"><span>Local SHA-256</span><code>{submission.localSha256}</code></div>
        <div className="detail-kv"><span>On-chain Keccak</span><code>{submission.chainKeccak}</code></div>
        <div className="detail-kv"><span>Submission receipt</span><code>{submission.transactionHash}</code></div>
        {job?.job.completionTransactionHash !== null && job?.job.completionTransactionHash !== undefined && <div className="detail-kv"><span>Settlement receipt</span><code>{job.job.completionTransactionHash}</code></div>}
        {currentRunBundle !== null && <div className="detail-kv"><span>Greenfield run_bundle</span><span><StatusBadge value={statusLabel(currentRunBundle.status)} tone={currentRunBundle.status === "verified" ? "success" : currentRunBundle.status === "failed" ? "danger" : currentRunBundle.status === "pending" ? "warning" : "neutral"} />{currentRunBundle.status === "verified" && safeVerifiedEvidenceLink(currentRunBundle.readUrl) !== null ? <a href={safeVerifiedEvidenceLink(currentRunBundle.readUrl) ?? undefined} target="_blank" rel="noreferrer">Open verified JSON</a> : currentRunBundle.reason ?? "No verified Greenfield publication is available."}</span></div>}
        {submission.manifestText !== null && <pre className="commerce-journey__manifest">{submission.manifestText}</pre>}
      </div>}
      {submitted && <div className="commerce-journey__decision">
        <p className="detail-section__lede">Inspect the exact bytes and digest, then choose one buyer decision.</p>
        <div className="detail-actions"><button className="button button--primary" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void decide("approve")}>Approve and settle</button><button className="button button--ghost button--small" type="button" disabled={busy || authority === null || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void decide("dispute")}>Dispute result</button></div>
      </div>}
      {refundable && <div className="commerce-journey__decision"><p className="detail-section__lede">This funded job has expired without a completed result.</p><button className="button button--ghost button--small" type="button" disabled={busy || !walletAuthenticated || chainId !== EOA_BUYER_CHAIN_ID} onClick={() => void claimRefund()}>Claim refund</button></div>}
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
