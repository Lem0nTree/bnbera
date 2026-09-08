import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrantSessionResult, Signer } from "@altananetwork/sdk";
import {
  creatorPublicGrantFromSession,
  handoffCreatorSession,
  prepareCreatorErc8004Registration,
  registerCreatorErc8004Agent,
  type CreatorBrowserRegistrationStatus,
  type CreatorBrowserWallet,
} from "./creator-browser-grant";

const walletAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const sessionAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const sessionPublicKey = `0x04${"11".repeat(64)}` as const;
const sessionPrivateKey = `0x${"22".repeat(32)}` as const;

function registrationStatus(overrides: Partial<CreatorBrowserRegistrationStatus> = {}): CreatorBrowserRegistrationStatus {
  return {
    deploymentId: "00000000-0000-4000-8000-000000000002",
    state: "not_started",
    phase: null,
    canMint: true,
    canSetUri: false,
    mintOutcomeRecorded: false,
    uriOutcomeRecorded: false,
    pendingReason: null,
    operationId: "creator:erc8004:test",
    mintCallsId: null,
    mintTransactionHash: null,
    mintScanStartBlock: null,
    mintScanCursor: null,
    uriCallsId: null,
    uriTransactionHash: null,
    agentId: null,
    ownerAddress: walletAddress,
    agentWallet: sessionAddress,
    endpoint: "https://agent.example/.well-known/agent-card.json",
    name: "Test Creator agent",
    initialUriDigest: "a".repeat(64),
    finalUriDigest: null,
    identity: null,
    tradingPair: "tbnb-busd",
    configurationDigest: "b".repeat(64),
    ...overrides,
  };
}

const browserWallet = {
  address: walletAddress,
  signer: {
    type: "passkey",
    address: walletAddress,
    publicKey: sessionPublicKey,
    credential: { id: "credential-id" },
    async signDigest() { return `0x${"33".repeat(65)}`; },
  },
} as unknown as CreatorBrowserWallet;

const privateSessionSigner: Signer & { readonly type: "privateKey"; readonly _privateKey: `0x${string}` } = {
  type: "privateKey",
  address: sessionAddress,
  publicKey: sessionPublicKey,
  _privateKey: sessionPrivateKey,
  async signDigest() { return `0x${"33".repeat(65)}`; },
};

const session = {
  walletAddress,
  signer: privateSessionSigner,
  publicKey: sessionPublicKey,
  permissions: { calls: [{ to: walletAddress, signature: "test()" }], spend: [{ limit: 1n, period: "hour" as const }] },
  expiry: 1_700_003_600,
  transactionHash: `0x${"44".repeat(32)}`,
} satisfies GrantSessionResult;

describe("Creator browser runtime handoff", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not expose confirmed grant metadata without an SDK grant result", () => {
    expect(creatorPublicGrantFromSession(walletAddress, null, null)).toBeNull();
    expect(creatorPublicGrantFromSession(walletAddress, session, "authority-1")).toEqual({ walletAddress, sessionPublicKey, transactionHash: session.transactionHash, authorityId: "authority-1" });
  });

  it("posts the SDK serialized session and private key exactly once", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { authorityId: string; serializedSession: { publicKey: string; permissions: { spend?: { limit: string }[] } }; sessionPrivateKey: string };
      expect(body.authorityId).toBe("00000000-0000-4000-8000-000000000001");
      expect(body.serializedSession.publicKey).toBe(sessionPublicKey);
      expect(body.serializedSession.permissions.spend).toEqual([{ limit: "1", period: "hour" }]);
      expect(body.sessionPrivateKey).toBe(sessionPrivateKey);
      return new Response(JSON.stringify({ handoff: { accepted: true } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(handoffCreatorSession({ draftId: "00000000-0000-4000-8000-000000000002", authorityId: "00000000-0000-4000-8000-000000000001", session, sessionSigner: privateSessionSigner })).resolves.toMatchObject({ handoff: { accepted: true } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/drafts/00000000-0000-4000-8000-000000000002/authority/handoff");
  });

  it("refuses to send a non-private-key session signer", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const passkeySigner = { ...privateSessionSigner, type: "passkey" as const, _privateKey: undefined } as unknown as Signer;
    await expect(handoffCreatorSession({ draftId: "00000000-0000-4000-8000-000000000002", authorityId: "00000000-0000-4000-8000-000000000001", session, sessionSigner: passkeySigner })).rejects.toThrow("private-key session signer");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("prepares registration with only the deployment id and phase", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({ phase: "mint" });
      expect(body).not.toHaveProperty("walletAddress");
      expect(body).not.toHaveProperty("sessionPrivateKey");
      expect(body).not.toHaveProperty("serializedSession");
      return new Response(JSON.stringify({ registration: { state: "mint_pending" } }), { status: 202 });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(prepareCreatorErc8004Registration("00000000-0000-4000-8000-000000000002")).resolves.toMatchObject({ state: "mint_pending" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not ask the SDK to mint when the atomic server reservation was lost to a competing tab", async () => {
    const initial = registrationStatus();
    const pending = registrationStatus({ state: "mint_pending", canMint: false, phase: "mint", pendingReason: "FINALIZED_REGISTRY_OR_G1_READ_PENDING" });
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      paths.push(path);
      if (path === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, walletAddress, chainId: 97 }), { status: 200 });
      if (path.endsWith("/erc8004/status")) return new Response(JSON.stringify({ registration: initial }), { status: 200 });
      if (path.endsWith("/erc8004/prepare")) return new Response(JSON.stringify({ registration: { ...pending, registrationFile: {}, registrationUri: "data:application/json;base64,e30=", uriDigest: initial.initialUriDigest } }), { status: 202 });
      if (path.endsWith("/erc8004/reconcile")) return new Response(JSON.stringify({ registration: pending }), { status: 200 });
      throw new Error(`unexpected browser request: ${path}`);
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(registerCreatorErc8004Agent({ deploymentId: initial.deploymentId, wallet: browserWallet })).resolves.toMatchObject({ state: "mint_pending" });
    expect(paths.some((path) => path.endsWith("/erc8004/record-result"))).toBe(false);
  });

  it("does not re-sign a URI when the server reports an existing URI reservation", async () => {
    const initial = registrationStatus({ state: "mint_confirmed", phase: "mint", canMint: false, canSetUri: true, agentId: "42" });
    const pending = registrationStatus({ state: "uri_pending", phase: "uri", canMint: false, canSetUri: false, agentId: "42", pendingReason: "FINALIZED_REGISTRY_OR_G1_READ_PENDING" });
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      paths.push(path);
      if (path === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, walletAddress, chainId: 97 }), { status: 200 });
      if (path.endsWith("/erc8004/status")) return new Response(JSON.stringify({ registration: initial }), { status: 200 });
      if (path.endsWith("/erc8004/prepare")) return new Response(JSON.stringify({ registration: { ...pending, registrationFile: {}, registrationUri: "data:application/json;base64,e30=", uriDigest: "c".repeat(64) } }), { status: 202 });
      if (path.endsWith("/erc8004/reconcile")) return new Response(JSON.stringify({ registration: pending }), { status: 200 });
      throw new Error(`unexpected browser request: ${path}`);
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(registerCreatorErc8004Agent({ deploymentId: initial.deploymentId, wallet: browserWallet })).resolves.toMatchObject({ state: "uri_pending" });
    expect(paths.some((path) => path.endsWith("/erc8004/record-result"))).toBe(false);
  });
});
