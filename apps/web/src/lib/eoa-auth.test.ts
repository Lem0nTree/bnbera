import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { NonceStore } from "@bnbera/auth";
import { formatSiweMessage } from "./siwe-message";
import { verifyEoaSiweRequest } from "./commerce-auth";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const now = new Date("2026-09-07T12:00:00.000Z");
const context = {
  domain: "localhost:3000",
  uri: "http://localhost:3000",
  chainId: 97,
  now
} as const;

function nonceStore(consumed = true): NonceStore {
  return {
    issue: vi.fn(async () => ({ nonce: "nonce-123456", expiresAt: new Date(now.getTime() + 60_000) })),
    consume: vi.fn(async () => consumed)
  };
}

async function signedRequest(overrides: Record<string, unknown> = {}) {
  const fields = {
    address: account.address,
    chainId: 97,
    domain: context.domain,
    uri: context.uri,
    nonce: "nonce-123456",
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
    statement: "Sign in to BNBEra commerce.",
    ...overrides
  };
  const message = formatSiweMessage(fields);
  return {
    ...fields,
    message,
    signature: await account.signMessage({ message })
  };
}

describe("EOA SIWE authentication", () => {
  it("verifies an EOA signature and consumes the address-bound nonce", async () => {
    const store = nonceStore();
    const proof = await verifyEoaSiweRequest(await signedRequest(), context, store);

    expect(proof.address).toBe(account.address.toLowerCase());
    expect(store.consume).toHaveBeenCalledWith({
      domain: context.domain,
      chainId: 97,
      nonce: "nonce-123456",
      walletAddress: account.address.toLowerCase()
    });
  });

  it("rejects a wrong origin before consuming the nonce", async () => {
    const store = nonceStore();
    await expect(verifyEoaSiweRequest(await signedRequest({ uri: "https://evil.example" }), context, store)).rejects.toThrow(/audience|context/i);
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("rejects a wrong chain before consuming the nonce", async () => {
    const store = nonceStore();
    await expect(verifyEoaSiweRequest(await signedRequest({ chainId: 56 }), context, store)).rejects.toThrow(/context|chain/i);
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("rejects a signature from a different account", async () => {
    const store = nonceStore();
    const request = await signedRequest();
    const message = formatSiweMessage({ ...request, address: otherAccount.address });
    await expect(verifyEoaSiweRequest({ ...request, address: otherAccount.address, message }, context, store)).rejects.toThrow(/verified|signature/i);
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("rejects replay when the persistent nonce has already been consumed", async () => {
    const store = nonceStore(false);
    await expect(verifyEoaSiweRequest(await signedRequest(), context, store)).rejects.toThrow(/accepted|nonce/i);
    expect(store.consume).toHaveBeenCalledOnce();
  });

  it("rejects a message whose bytes do not match the signed fields", async () => {
    const store = nonceStore();
    const request = await signedRequest();
    await expect(verifyEoaSiweRequest({ ...request, message: `${request.message}\n` }, context, store)).rejects.toThrow(/verified|message/i);
    expect(store.consume).not.toHaveBeenCalled();
  });
});
