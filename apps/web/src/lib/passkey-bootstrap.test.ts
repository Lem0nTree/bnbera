import { describe, expect, it, vi } from "vitest";
import {
  activateFreshPasskeyWallet,
  createPasskeyBootstrapRelayStatusReader,
  createUnregisteredPasskeyBootstrapRecord,
  parsePasskeyBootstrapRecord,
  reconcilePasskeyBootstrapRecord,
  serializePasskeyBootstrapRecord,
  type PasskeyBootstrapRecord
} from "./passkey-bootstrap";

const WALLET = "0x1111111111111111111111111111111111111111";
const CALLS = `0x${"aa".repeat(32)}` as `0x${string}`;
const RETRY_CALLS = `0x${"bb".repeat(32)}` as `0x${string}`;
const TX = `0x${"cc".repeat(32)}` as `0x${string}`;

function record(overrides: Partial<PasskeyBootstrapRecord> = {}): PasskeyBootstrapRecord {
  return {
    ...createUnregisteredPasskeyBootstrapRecord(WALLET, 1_000),
    ...overrides
  };
}

describe("fresh passkey bootstrap", () => {
  it("confirms the SDK first action and persists only public relay evidence", async () => {
    const persisted: PasskeyBootstrapRecord[] = [];
    const execute = vi.fn(async () => ({ callsId: CALLS, status: "CONFIRMED" as const, transactionHash: TX, statusCode: 200 }));
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: null,
      execute,
      readStatus: vi.fn(),
      persist: (next) => persisted.push(next),
      now: () => 2_000
    });

    expect(outcome.status).toBe("confirmed");
    expect(outcome.shouldAuthenticate).toBe(true);
    expect(outcome.record).toMatchObject({ walletAddress: WALLET.toLowerCase(), callsId: CALLS, transactionHash: TX, status: "confirmed" });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith();
    expect(persisted).toHaveLength(1);
    expect(serializePasskeyBootstrapRecord(persisted[0] as PasskeyBootstrapRecord)).not.toMatch(/signer|credential|private/iu);
    expect(parsePasskeyBootstrapRecord(serializePasskeyBootstrapRecord(persisted[0] as PasskeyBootstrapRecord))).toMatchObject({ callsId: CALLS, transactionHash: TX });
  });

  it("reconciles a saved pending calls ID after reload without resending", async () => {
    const execute = vi.fn(async () => ({ callsId: RETRY_CALLS, status: "CONFIRMED" as const }));
    const readStatus = vi.fn(async () => ({ status: "PENDING" as const, statusCode: 100, transactionHash: null }));
    const persisted: PasskeyBootstrapRecord[] = [];
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: record({ callsId: CALLS, status: "pending", updatedAt: 1_500 }),
      execute,
      readStatus,
      persist: (next) => persisted.push(next),
      now: () => 2_000
    });

    expect(outcome.status).toBe("pending");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(readStatus).toHaveBeenCalledWith(CALLS);
    expect(persisted.at(-1)).toMatchObject({ callsId: CALLS, status: "pending" });
  });

  it("does not retry an unknown saved outcome until it can be reconciled", async () => {
    const execute = vi.fn(async () => ({ callsId: RETRY_CALLS, status: "CONFIRMED" as const }));
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: record({ callsId: CALLS, status: "unknown" }),
      execute,
      readStatus: async () => { throw new Error("relay unavailable"); },
      persist: () => undefined,
      now: () => 2_000
    });

    expect(outcome.status).toBe("unknown");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not rebroadcast after the first execute loses its response", async () => {
    const execute = vi.fn(async () => { throw new Error("relay connection closed after submission"); });
    const persisted: PasskeyBootstrapRecord[] = [];
    const first = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: null,
      execute,
      readStatus: vi.fn(),
      persist: (next) => persisted.push(next),
      now: () => 2_000
    });

    const second = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: first.record,
      execute,
      readStatus: vi.fn(),
      persist: (next) => persisted.push(next),
      now: () => 2_001
    });

    expect(first.status).toBe("unknown");
    expect(second.status).toBe("unknown");
    expect(execute).toHaveBeenCalledOnce();
    expect(second.message).toMatch(/reconcile/iu);
  });

  it("fails closed when an execute result has no valid public calls ID", async () => {
    const execute = vi.fn(async () => ({ callsId: "not-a-calls-id", status: "PENDING" as const }));
    const persisted: PasskeyBootstrapRecord[] = [];
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: null,
      execute: execute as never,
      readStatus: vi.fn(),
      persist: (next) => persisted.push(next),
      now: () => 2_000
    });

    expect(outcome.status).toBe("unknown");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(persisted.at(-1)).toMatchObject({ callsId: null, status: "unknown" });
  });

  it("skips the bootstrap execute for an already-registered wallet", async () => {
    const execute = vi.fn(async () => ({ callsId: CALLS, status: "CONFIRMED" as const }));
    const readStatus = vi.fn();
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "already_registered",
      record: null,
      execute,
      readStatus,
      persist: () => undefined,
      now: () => 2_000
    });

    expect(outcome.status).toBe("already_registered");
    expect(outcome.shouldAuthenticate).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(readStatus).not.toHaveBeenCalled();
  });

  it("reports insufficient gas without attempting server sign-in", async () => {
    const persisted: PasskeyBootstrapRecord[] = [];
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: null,
      execute: async () => { throw new Error("insufficient funds for gas * price + value"); },
      readStatus: vi.fn(),
      persist: (next) => persisted.push(next),
      now: () => 2_000
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(outcome.message).toContain("more BNB testnet gas");
    expect(persisted.at(-1)).toMatchObject({ callsId: null, status: "failed" });
  });

  it("keeps a generic execute error unknown when no calls ID is available", async () => {
    const execute = vi.fn(async () => { throw new Error("relay connection closed after submission"); });
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: null,
      execute,
      readStatus: vi.fn(),
      persist: () => undefined,
      now: () => 2_000
    });

    expect(outcome.status).toBe("unknown");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(outcome.message).toContain("unknown outcome");
    await expect(activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: outcome.record,
      execute,
      readStatus: vi.fn(),
      persist: () => undefined,
      now: () => 2_001
    })).resolves.toMatchObject({ status: "unknown" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reconciles a failed relay before permitting one explicit retry", async () => {
    const execute = vi.fn(async () => ({ callsId: RETRY_CALLS, status: "CONFIRMED" as const, transactionHash: TX }));
    const readStatus = vi.fn(async () => ({ status: "FAILED" as const, statusCode: 500, transactionHash: null }));
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: record({ callsId: CALLS, status: "unknown" }),
      execute,
      readStatus,
      persist: () => undefined,
      now: () => 2_000
    });

    expect(outcome.status).toBe("confirmed");
    expect(execute).toHaveBeenCalledOnce();
    expect(readStatus).toHaveBeenCalledOnce();
  });

  it("does not retry a failed relay response that already has a receipt", async () => {
    const execute = vi.fn(async () => ({ callsId: RETRY_CALLS, status: "CONFIRMED" as const }));
    const outcome = await activateFreshPasskeyWallet({
      walletAddress: WALLET,
      walletState: "new_unregistered",
      record: record({ callsId: CALLS, status: "failed" }),
      execute,
      readStatus: async () => ({ status: "FAILED", statusCode: 500, transactionHash: TX }),
      persist: () => undefined,
      now: () => 2_000
    });

    expect(outcome.status).toBe("unknown");
    expect(outcome.shouldAuthenticate).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reads the SDK-compatible public relay status without exposing response internals", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { status: 200, receipts: [{ transactionHash: TX }] } }), { status: 200 }));
    const readStatus = createPasskeyBootstrapRelayStatusReader("https://relay.example", fetcher);
    await expect(readStatus(CALLS)).resolves.toEqual({ status: "CONFIRMED", statusCode: 200, transactionHash: TX });
    expect(fetcher).toHaveBeenCalledWith("https://relay.example", expect.objectContaining({ method: "POST" }));
  });

  it("accepts EIP-5792 relay status codes encoded as JSON strings", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { status: "0xc8", receipts: [] } }), { status: 200 }));
    const readStatus = createPasskeyBootstrapRelayStatusReader("https://relay.example", fetcher);
    await expect(readStatus(CALLS)).resolves.toEqual({ status: "CONFIRMED", statusCode: 200, transactionHash: null });
  });

  it("reconciles a persisted record without a signer or a write", async () => {
    const persisted: PasskeyBootstrapRecord[] = [];
    const outcome = await reconcilePasskeyBootstrapRecord({
      record: record({ callsId: CALLS, status: "pending" }),
      readStatus: async () => ({ status: "CONFIRMED", statusCode: 200, transactionHash: TX }),
      persist: (next) => persisted.push(next),
      now: () => 3_000
    });
    expect(outcome.status).toBe("confirmed");
    expect(outcome.shouldAuthenticate).toBe(true);
    expect(persisted[0]).toMatchObject({ status: "confirmed", transactionHash: TX });
  });
});
