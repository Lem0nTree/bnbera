import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { verifyAltanaPasskeyAssertion, type AltanaAdminKey } from "../webauthn.js";
import type { NonceStore } from "../boundary.js";

const walletAddress = "0x1111111111111111111111111111111111111111";
const context = {
  domain: "localhost",
  origin: "http://localhost:3000",
  rpId: "localhost",
  chainId: 97,
  now: new Date("2026-09-07T12:00:00.000Z")
} as const;

function b64(value: Uint8Array | string): string {
  return Buffer.from(value).toString("base64url");
}

function assertion(challenge: string, privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], flags = 0x05) {
  const clientDataJson = Buffer.from(JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: context.origin,
    crossOrigin: false
  }));
  const rpIdHash = createHash("sha256").update(context.rpId, "utf8").digest();
  const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags, 0, 0, 0, 1])]);
  const clientDataHash = createHash("sha256").update(clientDataJson).digest();
  const signature = createSign("SHA256").update(Buffer.concat([authenticatorData, clientDataHash])).sign(privateKey);
  return {
    id: "credential-1",
    rawId: "credential-1",
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(clientDataJson),
      authenticatorData: b64(authenticatorData),
      signature: b64(signature),
      userHandle: b64(Buffer.from(walletAddress.slice(2), "hex"))
    }
  };
}

describe("Altana WebAuthn crypto verification", () => {
  it("accepts a real ES256 assertion only with UP and UV flags", async () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = pair.publicKey.export({ format: "jwk" });
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("missing P-256 coordinates");
    const publicKey = `0x${Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex")}` as `0x${string}`;
    const key: AltanaAdminKey = {
      keyId: keccak256(publicKey),
      publicKey,
      isRoot: true,
      revoked: false,
      expiry: 0n
    };
    let consumed = false;
    const store: NonceStore = {
      issue: async () => ({ nonce: "challenge-123456", expiresAt: new Date("2026-09-07T12:00:30.000Z") }),
      consume: async ({ nonce }) => {
        if (nonce !== "challenge-123456" || consumed) return false;
        consumed = true;
        return true;
      }
    };
    const result = await verifyAltanaPasskeyAssertion(
      { read: async () => [key] },
      store,
      { walletAddress, chainId: 97, response: assertion("challenge-123456", pair.privateKey) },
      context
    );
    expect(result.walletAddress).toBe(walletAddress);
    expect(consumed).toBe(true);
  });

  it("rejects an assertion without the user-verification flag", async () => {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = pair.publicKey.export({ format: "jwk" });
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("missing P-256 coordinates");
    const publicKey = `0x${Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("hex")}` as `0x${string}`;
    const key: AltanaAdminKey = { keyId: keccak256(publicKey), publicKey, isRoot: true, revoked: false, expiry: 0n };
    const store: NonceStore = {
      issue: async () => ({ nonce: "challenge-123456", expiresAt: new Date("2026-09-07T12:00:30.000Z") }),
      consume: async () => true
    };
    await expect(verifyAltanaPasskeyAssertion(
      { read: async () => [key] },
      store,
      { walletAddress, chainId: 97, response: assertion("challenge-123456", pair.privateKey, 0x01) },
      context
    )).rejects.toThrow(/could not be verified/);
  });
});
