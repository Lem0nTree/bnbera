import { describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: {
      credentialID: "credential-1",
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "http://localhost:3000",
      rpID: "localhost"
    }
  }))
}));

import {
  issueWebAuthnChallenge,
  verifyAltanaPasskeyAssertion,
  type AltanaAdminKey,
  type NonceStore
} from "../index.js";

const context = {
  domain: "localhost",
  origin: "http://localhost:3000",
  rpId: "localhost",
  chainId: 97,
  now: new Date("2026-09-07T12:00:00.000Z")
} as const;

const walletAddress = "0x1111111111111111111111111111111111111111";
const publicKey = `0x${"11".repeat(64)}` as `0x${string}`;
const keyId = keccak256(publicKey);

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function assertion(challenge: string) {
  return {
    id: "credential-1",
    rawId: "credential-1",
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64Url(JSON.stringify({ type: "webauthn.get", challenge, origin: context.origin })),
      authenticatorData: base64Url("authenticator-data"),
      signature: base64Url("signature"),
      userHandle: Buffer.from(walletAddress.slice(2), "hex").toString("base64url")
    }
  };
}

function nonceStore(challenge = "challenge-123456") {
  let consumed = false;
  const store: NonceStore = {
    issue: vi.fn(async () => ({
      nonce: challenge,
      expiresAt: new Date("2026-09-07T12:00:30.000Z")
    })),
    consume: vi.fn(async () => {
      if (consumed) return false;
      consumed = true;
      return true;
    })
  };
  return store;
}

function rootKey(overrides: Partial<AltanaAdminKey> = {}): AltanaAdminKey {
  return {
    keyId,
    publicKey,
    isRoot: true,
    revoked: false,
    expiry: 0n,
    ...overrides
  };
}

describe("Altana WebAuthn authentication boundary", () => {
  it("issues a bounded challenge with the application RP/origin", async () => {
    const store = nonceStore();
    const challenge = await issueWebAuthnChallenge(store, context);
    expect(challenge.challenge).toBe("challenge-123456");
    expect(challenge.rpId).toBe("localhost");
    expect(challenge.origin).toBe("http://localhost:3000");
    expect(challenge.userVerification).toBe("required");
    expect(store.issue).toHaveBeenCalledWith({ domain: "localhost", chainId: 97 });
  });

  it("requires a current root key and atomically consumes the signed challenge", async () => {
    const store = nonceStore();
    const proof = await verifyAltanaPasskeyAssertion(
      { read: vi.fn(async () => [rootKey()]) },
      store,
      { walletAddress, chainId: 97, response: assertion("challenge-123456") },
      context
    );
    expect(proof.walletAddress).toBe(walletAddress);
    expect(proof.chainId).toBe(97);
    expect(store.consume).toHaveBeenCalledWith({
      domain: "localhost",
      chainId: 97,
      nonce: "challenge-123456"
    });
  });

  it("rejects session keys even when their public key matches", async () => {
    const store = nonceStore();
    await expect(verifyAltanaPasskeyAssertion(
      { read: vi.fn(async () => [rootKey({ isRoot: false, expiry: 1n })]) },
      store,
      { walletAddress, chainId: 97, response: assertion("challenge-123456") },
      context
    )).rejects.toThrow(/could not be verified/);
    expect(store.consume).not.toHaveBeenCalled();
  });

  it("rejects replay after the nonce store consumes the challenge", async () => {
    const store = nonceStore();
    const reader = { read: vi.fn(async () => [rootKey()]) };
    const input = { walletAddress, chainId: 97, response: assertion("challenge-123456") };
    await verifyAltanaPasskeyAssertion(reader, store, input, context);
    await expect(verifyAltanaPasskeyAssertion(reader, store, input, context)).rejects.toThrow(/accepted/);
  });
});
