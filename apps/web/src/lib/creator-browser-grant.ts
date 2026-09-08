"use client";

import {
  BNB_TESTNET,
  createClient,
  createPrivateKeySigner,
  encodeErc8004AgentUri,
  registerErc8004Agent,
  serializeSession,
  setErc8004AgentUri,
  type GrantSessionResult,
  type Erc8004RegistrationFile,
  type PasskeySigner,
  type Signer,
  type Wallet,
  withErc8004Registration,
} from "@altananetwork/sdk";

export const CREATOR_BROWSER_CHAIN_ID = 97 as const;

export type CreatorBrowserGrantOptions = {
  readonly chainId: 97;
  readonly grantIssuedAtUnix: number;
  readonly expiresAtUnix: number;
  readonly policyDigest: `0x${string}` | string;
  readonly policy: {
    readonly chainId: 97;
    readonly adminAddress: string;
    readonly walletAddress: string;
    readonly sessionPublicAddress: string;
    readonly calls: readonly { readonly target: string; readonly selectors: readonly string[]; readonly maxNativeValueWei: string }[];
    readonly spend: readonly { readonly token: string; readonly limitAtomic: string; readonly period: string }[];
    readonly expiresAtUnix: number;
  };
  readonly sdk: {
    readonly permissions: {
      readonly calls: readonly { readonly to: string; readonly signature: string }[];
      readonly spend: readonly { readonly token?: string; readonly limit: string; readonly period: "minute" | "hour" | "day" | "week" | "month" | "year" }[];
    };
    readonly expiry: number;
    readonly register: true;
  };
};

export type CreatorBrowserWallet = Wallet & { readonly signer: PasskeySigner };
export type CreatorPublicGrant = { readonly walletAddress: string; readonly sessionPublicKey: string; readonly transactionHash: string | null; readonly authorityId: string | null };
type ApiError = { readonly error?: { readonly safeMessage?: string; readonly message?: string } };

/** UI metadata is available only after the SDK returned a grant result. */
export function creatorPublicGrantFromSession(walletAddress: string, session: GrantSessionResult | null, authorityId: string | null): CreatorPublicGrant | null {
  if (session === null) return null;
  return { walletAddress, sessionPublicKey: session.publicKey, transactionHash: session.transactionHash ?? null, authorityId };
}

type PrivateKeySessionSigner = Signer & { readonly type: "privateKey"; readonly _privateKey: `0x${string}` };

function privateKeySessionSigner(signer: Signer): PrivateKeySessionSigner {
  if (signer.type !== "privateKey") throw new Error("Creator runtime handoff requires the generated private-key session signer.");
  const candidate = signer as Partial<PrivateKeySessionSigner>;
  if (typeof candidate._privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(candidate._privateKey)) throw new Error("Creator runtime handoff signer material is unavailable.");
  return candidate as PrivateKeySessionSigner;
}

function client() {
  return createClient({ chains: [BNB_TESTNET], defaultChainId: CREATOR_BROWSER_CHAIN_ID });
}

export async function createCreatorPasskeyWallet(): Promise<CreatorBrowserWallet> {
  return client().createPasskeyWallet({ name: "BNBEra Creator" });
}

export async function recoverCreatorPasskeyWallet(): Promise<CreatorBrowserWallet> {
  return client().recoverFromPasskey({ chainId: CREATOR_BROWSER_CHAIN_ID });
}

/**
 * A session key is generated only in this tab's memory. After the SDK grant
 * confirms, its private material is sent exactly once to the authenticated
 * runtime-handoff endpoint; it is never placed in browser storage or normal
 * application data.
 */
export function createCreatorSessionSigner(): Signer {
  return createPrivateKeySigner();
}

function sdkGrantOptions(options: CreatorBrowserGrantOptions) {
  return {
    permissions: {
      calls: options.sdk.permissions.calls.map((call) => ({ to: call.to as `0x${string}`, signature: call.signature })),
      spend: options.sdk.permissions.spend.map((entry) => ({
        ...(entry.token === undefined ? {} : { token: entry.token as `0x${string}` }),
        limit: BigInt(entry.limit),
        period: entry.period,
      })),
    },
    expiry: options.sdk.expiry,
    register: true as const,
  };
}

export async function grantCreatorSession(input: {
  readonly wallet: CreatorBrowserWallet;
  readonly sessionSigner: Signer;
  readonly options: CreatorBrowserGrantOptions;
}): Promise<GrantSessionResult> {
  return client().grantSession({
    wallet: { address: input.wallet.address },
    signer: input.wallet.signer,
    sessionSigner: input.sessionSigner,
    chainId: CREATOR_BROWSER_CHAIN_ID,
    ...sdkGrantOptions(input.options),
  });
}

/**
 * Performs the one-time browser → runtime handoff. `serializeSession` is the
 * SDK's secret-free session half; only the narrowly-guarded generated
 * private-key signer material is sent to the authenticated handoff endpoint.
 * The local variable is cleared in `finally`, and callers must clear their
 * refs as soon as this promise settles.
 */
export async function handoffCreatorSession(input: {
  readonly draftId: string;
  readonly authorityId: string;
  readonly session: GrantSessionResult;
  readonly sessionSigner: Signer;
}): Promise<unknown> {
  let signer: PrivateKeySessionSigner | null = privateKeySessionSigner(input.sessionSigner);
  const serializedSession = serializeSession(input.session);
  let sessionPrivateKey: `0x${string}` | null = signer._privateKey;
  try {
    const response = await fetch(`/api/creator/drafts/${encodeURIComponent(input.draftId)}/authority/handoff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ authorityId: input.authorityId, serializedSession, sessionPrivateKey }),
    });
    const body = await response.json() as { readonly error?: { readonly safeMessage?: string; readonly message?: string } };
    if (!response.ok) throw new Error(body.error?.safeMessage ?? body.error?.message ?? "Creator runtime handoff failed.");
    return body;
  } finally {
    sessionPrivateKey = null;
    signer = null;
  }
}

export async function revokeCreatorSession(input: {
  readonly wallet: CreatorBrowserWallet;
  readonly sessionPublicKey: string;
}): Promise<{ readonly transactionHash: `0x${string}` | null }> {
  const result = await client().revokeSession({
    wallet: { address: input.wallet.address },
    signer: input.wallet.signer,
    session: input.sessionPublicKey as `0x${string}`,
    chainId: CREATOR_BROWSER_CHAIN_ID,
  });
  if (result.status !== "CONFIRMED") throw new Error("The Altana revoke did not confirm; authority state is unknown.");
  return { transactionHash: result.transactionHash ?? null };
}

type BrowserPasskeySigner = Signer & { readonly type: "passkey"; readonly credential: { readonly id: string } };
type PasskeyChallengeResponse = { readonly challenge: string; readonly rpId: string; readonly userVerification: "required"; readonly timeout: number };

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
  if (credential === undefined || typeof credential.id !== "string" || credential.id.length === 0) throw new Error("The browser passkey credential is unavailable.");
  return credential;
}

async function parseAuthResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { readonly error?: { readonly message?: string; readonly safeMessage?: string } };
  if (!response.ok) throw new Error(body.error?.safeMessage ?? body.error?.message ?? "Passkey authentication could not be completed.");
  return body;
}

/** Establishes the normal server cookie using an SDK-owned passkey assertion. */
export async function authenticateCreatorPasskey(walletAddress: string, signer: Signer): Promise<void> {
  const current = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (current.ok) {
    const session = await current.json() as { readonly authenticated?: boolean; readonly walletAddress?: string; readonly chainId?: number };
    if (session.authenticated === true && session.walletAddress?.toLowerCase() === walletAddress.toLowerCase() && session.chainId === CREATOR_BROWSER_CHAIN_ID) return;
  }
  const credential = passkeyCredential(signer);
  if (typeof PublicKeyCredential === "undefined" || typeof navigator.credentials?.get !== "function") throw new Error("This browser does not provide the WebAuthn assertion API required for Creator sign-in.");
  const challengeResponse = await fetch("/api/auth/passkey/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ walletAddress, chainId: CREATOR_BROWSER_CHAIN_ID }),
  });
  const challenge = await parseAuthResponse<PasskeyChallengeResponse>(challengeResponse);
  const assertionCredential = await navigator.credentials.get({
    publicKey: {
      challenge: decodeBase64Url(challenge.challenge),
      rpId: challenge.rpId,
      allowCredentials: [{ id: decodeBase64Url(credential.id), type: "public-key" }],
      userVerification: challenge.userVerification,
      timeout: challenge.timeout,
    },
  });
  if (!(assertionCredential instanceof PublicKeyCredential) || !(assertionCredential.response instanceof AuthenticatorAssertionResponse)) throw new Error("The browser did not return a WebAuthn assertion.");
  const assertion = assertionCredential.response;
  const rawId = encodeBase64Url(assertionCredential.rawId);
  if (assertionCredential.id !== rawId || assertion.userHandle === null) throw new Error("The browser passkey assertion is missing its wallet binding.");
  const response = await fetch("/api/auth/passkey/assertion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({
      walletAddress,
      chainId: CREATOR_BROWSER_CHAIN_ID,
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
          userHandle: encodeBase64Url(assertion.userHandle),
        },
      },
    }),
  });
  await parseAuthResponse(response);
}

/** Public T7 response shape. No authority/session secret is part of it. */
export type CreatorBrowserRegistrationFile = Erc8004RegistrationFile & {
  readonly "x-bnbera": {
    readonly template: string;
    readonly templateDigest: string;
    readonly configurationDigest: string;
    readonly tradingPair: "tbnb-cake" | "tbnb-busd";
  };
};

export type CreatorBrowserRegistrationStatus = {
  readonly deploymentId: string;
  readonly state: "not_started" | "mint_intent" | "mint_pending" | "mint_confirmed" | "uri_intent" | "uri_pending" | "registered" | "failed";
  readonly phase: "mint" | "uri" | null;
  readonly canMint: boolean;
  readonly canSetUri: boolean;
  readonly mintOutcomeRecorded: boolean;
  readonly uriOutcomeRecorded: boolean;
  readonly pendingReason: string | null;
  readonly operationId: string;
  readonly mintCallsId: string | null;
  readonly mintTransactionHash: string | null;
  readonly mintScanStartBlock: string | null;
  readonly mintScanCursor: string | null;
  readonly uriCallsId: string | null;
  readonly uriTransactionHash: string | null;
  readonly agentId: string | null;
  readonly ownerAddress: string;
  readonly agentWallet: string;
  readonly endpoint: string;
  readonly name: string;
  readonly initialUriDigest: string;
  readonly finalUriDigest: string | null;
  readonly identity: {
    readonly namespace: "eip155";
    readonly chainId: 97;
    readonly identityRegistry: string;
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly endpoint: string;
    readonly ownerAddress: string;
    readonly agentWallet: string;
  } | null;
  readonly tradingPair: "tbnb-cake" | "tbnb-busd";
  readonly configurationDigest: string;
};

type CreatorRegistrationPrepare = CreatorBrowserRegistrationStatus & {
  readonly phase: "mint" | "uri";
  readonly registrationFile: CreatorBrowserRegistrationFile;
  readonly registrationUri: string;
  readonly uriDigest: string;
  readonly agentId: string | null;
};

type CreatorRegistrationResult = {
  readonly phase: "mint" | "uri";
  readonly callsId: string | null;
  readonly transactionHash: string | null;
  readonly status: "CONFIRMED" | "PENDING" | "FAILED" | "UNKNOWN";
  readonly agentId: string | null;
  readonly uriDigest: string | null;
};

type CreatorRegistrationApiResponse<T> = { readonly registration: T };

async function creatorRegistrationApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.error?.safeMessage ?? body.error?.message ?? `Creator registration request failed (${response.status}).`);
  return body;
}

export async function getCreatorErc8004RegistrationStatus(deploymentId: string): Promise<CreatorBrowserRegistrationStatus> {
  const body = await creatorRegistrationApi<CreatorRegistrationApiResponse<CreatorBrowserRegistrationStatus>>(`/api/creator/deployments/${encodeURIComponent(deploymentId)}/erc8004/status`, { method: "GET", headers: {} });
  return body.registration;
}

export async function prepareCreatorErc8004Registration(deploymentId: string, phase: "mint" | "uri" = "mint"): Promise<CreatorRegistrationPrepare> {
  const body = await creatorRegistrationApi<CreatorRegistrationApiResponse<CreatorRegistrationPrepare>>(`/api/creator/deployments/${encodeURIComponent(deploymentId)}/erc8004/prepare`, {
    method: "POST",
    body: JSON.stringify({ phase }),
  });
  return body.registration;
}

export async function recordCreatorErc8004RegistrationResult(deploymentId: string, input: CreatorRegistrationResult): Promise<CreatorBrowserRegistrationStatus> {
  const body = await creatorRegistrationApi<CreatorRegistrationApiResponse<CreatorBrowserRegistrationStatus>>(`/api/creator/deployments/${encodeURIComponent(deploymentId)}/erc8004/record-result`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.registration;
}

export async function reconcileCreatorErc8004Registration(deploymentId: string): Promise<CreatorBrowserRegistrationStatus> {
  const body = await creatorRegistrationApi<CreatorRegistrationApiResponse<CreatorBrowserRegistrationStatus>>(`/api/creator/deployments/${encodeURIComponent(deploymentId)}/erc8004/reconcile`, {
    method: "POST",
    body: "{}",
  });
  return body.registration;
}

function publicSdkError(error: unknown): { readonly status: "FAILED" | "UNKNOWN"; readonly callsId: string | null; readonly transactionHash: string | null } {
  const message = error instanceof Error ? error.message : String(error);
  const callsId = message.match(/callsId\s+(0x[0-9a-f]{1,128})/iu)?.[1] ?? null;
  const transactionHash = message.match(/\btx\s+(0x[0-9a-f]{64})/iu)?.[1] ?? null;
  const status = /reverted|rejected the register bundle/iu.test(message) ? "FAILED" : "UNKNOWN";
  return { status, callsId, transactionHash };
}

function sdkPublicResult(result: { readonly callsId: string; readonly transactionHash?: string; readonly status: "PENDING" | "CONFIRMED" | "FAILED" }, phase: "mint" | "uri", agentId: string | null, uriDigest: string | null): CreatorRegistrationResult {
  return {
    phase,
    callsId: result.callsId,
    transactionHash: result.transactionHash ?? null,
    status: result.status,
    agentId,
    uriDigest,
  };
}

/**
 * Runs/resumes the two browser-owned ERC-8004 phases. The passkey signer is
 * used only in this tab; API calls contain public operation results and never
 * private keys, serialized sessions or admin credentials.
 */
export async function registerCreatorErc8004Agent(input: {
  readonly deploymentId: string;
  readonly wallet?: CreatorBrowserWallet;
}): Promise<CreatorBrowserRegistrationStatus> {
  const wallet = input.wallet ?? await recoverCreatorPasskeyWallet();
  await authenticateCreatorPasskey(wallet.address, wallet.signer);
  let status = await getCreatorErc8004RegistrationStatus(input.deploymentId);
  if (status.ownerAddress.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("The selected passkey does not control the server-resolved Creator owner wallet.");
  if (status.state === "registered") return status;

  // A prior PENDING/UNKNOWN result is reconciled before any possibility of a
  // new signature. The server also rejects duplicate result writes by phase.
  if (!status.canMint && status.state !== "mint_confirmed" && status.state !== "uri_pending" && status.state !== "failed") {
    status = await reconcileCreatorErc8004Registration(input.deploymentId);
  }
  if (status.state === "failed") throw new Error("The persisted Creator registration operation failed; inspect its public status before retrying.");

  // A URI intent with any recorded SDK outcome (including UNKNOWN) is also
  // never signed a second time. Reconcile can promote it to registered once
  // the finalized registry/G1 reads catch up.
  if (status.state === "uri_pending" && status.uriOutcomeRecorded) {
    status = await reconcileCreatorErc8004Registration(input.deploymentId);
    return status;
  }

  if (status.canMint) {
    const prepared = await prepareCreatorErc8004Registration(input.deploymentId, "mint");
    if (prepared.ownerAddress.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("The server-resolved Creator owner changed before signing.");
    // `prepare` atomically reserves the mint phase. A competing tab or a
    // reload receives the same public file with canMint=false and must never
    // ask the passkey to sign a second identity; reconciliation owns recovery
    // from that durable reservation.
    if (!prepared.canMint) {
      status = await reconcileCreatorErc8004Registration(input.deploymentId);
      if (status.state !== "mint_confirmed" && status.state !== "uri_pending" && status.state !== "registered") return status;
    } else {
      try {
        const result = await registerErc8004Agent(wallet, wallet.signer, { agentUri: prepared.registrationUri, metadata: [] }, { network: BNB_TESTNET });
        status = await recordCreatorErc8004RegistrationResult(input.deploymentId, sdkPublicResult(result, "mint", result.agentId.toString(10), prepared.uriDigest));
      } catch (error) {
        const outcome = publicSdkError(error);
        status = await recordCreatorErc8004RegistrationResult(input.deploymentId, {
          phase: "mint",
          callsId: outcome.callsId,
          transactionHash: outcome.transactionHash,
          status: outcome.status,
          agentId: null,
          uriDigest: prepared.uriDigest,
        });
      }
      if (status.state !== "mint_confirmed" && status.state !== "uri_pending") {
        status = await reconcileCreatorErc8004Registration(input.deploymentId);
        if (status.state !== "mint_confirmed" && status.state !== "uri_pending") return status;
      }
    }
  } else if (status.state === "mint_pending") {
    status = await reconcileCreatorErc8004Registration(input.deploymentId);
    if (status.state !== "mint_confirmed" && status.state !== "uri_pending") return status;
  }

  if (status.state === "registered") return status;
  if (status.agentId === null) return status;
  const preparedUri = await prepareCreatorErc8004Registration(input.deploymentId, "uri");
  // A URI reservation is phase-specific too. Once a URI intent exists, a
  // lost response/broadcast is reconciled against the exact final URI; it is
  // never signed again from a reload or competing tab.
  if (!preparedUri.canSetUri) {
    status = await reconcileCreatorErc8004Registration(input.deploymentId);
    return status;
  }
  const finalFile = withErc8004Registration(preparedUri.registrationFile, BigInt(status.agentId), CREATOR_BROWSER_CHAIN_ID);
  const finalUri = encodeErc8004AgentUri(finalFile);
  if (finalUri !== preparedUri.registrationUri) throw new Error("The browser and server ERC-8004 registration files differ; no URI update was submitted.");
  let uriResult: CreatorRegistrationResult;
  try {
    const result = await setErc8004AgentUri(wallet, wallet.signer, { agentId: BigInt(status.agentId), agentUri: finalUri }, { network: BNB_TESTNET });
    uriResult = sdkPublicResult(result, "uri", status.agentId, preparedUri.uriDigest);
  } catch (error) {
    const outcome = publicSdkError(error);
    uriResult = { phase: "uri", callsId: outcome.callsId, transactionHash: outcome.transactionHash, status: outcome.status, agentId: status.agentId, uriDigest: preparedUri.uriDigest };
  }
  status = await recordCreatorErc8004RegistrationResult(input.deploymentId, uriResult);
  if (status.state !== "registered") status = await reconcileCreatorErc8004Registration(input.deploymentId);
  return status;
}
