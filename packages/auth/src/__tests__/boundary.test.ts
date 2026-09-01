import { describe, expect, it, vi } from "vitest";
import {
  assertSessionUsable,
  assertWalletOwnership,
  validateSiweRequest,
  verifySiweRequest
} from "../boundary.js";
import type { NonceStore, SiweVerifier } from "../boundary.js";

const now = new Date("2026-09-01T12:00:00.000Z");
const context = {
  domain: "localhost:3000",
  uri: "http://localhost:3000",
  chainId: 97,
  now
};

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    address: "0x0000000000000000000000000000000000000001",
    chainId: 97,
    domain: context.domain,
    uri: context.uri,
    nonce: "nonce-123456",
    issuedAt: "2026-09-01T11:58:00.000Z",
    expirationTime: "2026-09-01T12:05:00.000Z",
    ...overrides
  };
}

function verifierFor(request: {
  address: string;
  chainId: number;
  issuedAt: Date;
  expirationTime: Date;
}) {
  return {
    verify: vi.fn(async () => ({
      address: request.address,
      chainId: request.chainId,
      issuedAt: request.issuedAt,
      expirationTime: request.expirationTime
    }))
  };
}

function oneTimeNonceStore() {
  const consumed = new Set<string>();
  return {
    issue: vi.fn(async () => ({
      nonce: "nonce-123456",
      expiresAt: new Date("2026-09-01T12:05:00.000Z")
    })),
    consume: vi.fn(async ({ nonce }: { nonce: string }) => {
      if (consumed.has(nonce)) {
        return false;
      }
      consumed.add(nonce);
      return true;
    })
  };
}

describe("SIWE and session boundary", () => {
  it("validates application domain, URI audience, chain, and required expiry", () => {
    expect(() => validateSiweRequest(validRequest({ chainId: 56 }), context)).toThrow(/context/);
    expect(() => validateSiweRequest(validRequest({ uri: "http://phishing.test" }), context)).toThrow(/audience/);
    expect(() => validateSiweRequest(validRequest({ expirationTime: undefined }), context)).toThrow(/invalid/);
  });

  it("rejects stale, expired, and future-issued requests before verification", () => {
    expect(() =>
      validateSiweRequest(
        validRequest({ issuedAt: "2020-01-01T00:00:00.000Z", expirationTime: "2020-01-01T00:05:00.000Z" }),
        context
      )
    ).toThrow(/old/);
    expect(() =>
      validateSiweRequest(
        validRequest({ expirationTime: "2026-09-01T11:59:00.000Z" }),
        context
      )
    ).toThrow(/expired/);
    expect(() =>
      validateSiweRequest(
        validRequest({ issuedAt: "2026-09-01T12:01:00.000Z" }),
        context
      )
    ).toThrow(/issued-at/);
  });

  it("checks the verified address, chain, and signed times against the request", async () => {
    const request = validRequest();
    const parsed = validateSiweRequest(request, context);
    const verifier = verifierFor(parsed);
    const nonceStore = oneTimeNonceStore();

    const proof = await verifySiweRequest(verifier, nonceStore, request, context);

    expect(proof.address).toBe("0x0000000000000000000000000000000000000001");
    expect(nonceStore.consume).toHaveBeenCalledOnce();
  });

  it("consumes a nonce once and rejects replay or nonce-store failure", async () => {
    const request = validRequest();
    const parsed = validateSiweRequest(request, context);
    const verifier = verifierFor(parsed);
    const nonceStore = oneTimeNonceStore();

    await verifySiweRequest(verifier, nonceStore, request, context);
    await expect(verifySiweRequest(verifier, nonceStore, request, context)).rejects.toThrow(/accepted/);
    expect(nonceStore.consume).toHaveBeenCalledTimes(2);

    const unavailable: NonceStore = {
      issue: vi.fn(async () => ({
        nonce: "nonce-123456",
        expiresAt: new Date("2026-09-01T12:05:00.000Z")
      })),
      consume: vi.fn(async () => { throw new Error("database down"); })
    };
    await expect(verifySiweRequest(verifier, unavailable, request, context)).rejects.toThrow(/accepted/);
  });

  it("fails closed when the verifier omits or changes signed expiry", async () => {
    const request = validRequest();
    const nonceStore = oneTimeNonceStore();
    const missingExpiry = {
      verify: vi.fn(async () => ({
        address: request.address,
        chainId: request.chainId,
        issuedAt: new Date(request.issuedAt as string)
      }))
    } as unknown as SiweVerifier;
    await expect(verifySiweRequest(missingExpiry, nonceStore, request, context)).rejects.toThrow(/verified/);
    expect(nonceStore.consume).not.toHaveBeenCalled();

    const changedExpiry = {
      verify: vi.fn(async () => ({
        address: request.address,
        chainId: request.chainId,
        issuedAt: new Date(request.issuedAt as string),
        expirationTime: new Date("2026-09-01T12:04:00.000Z")
      }))
    } as unknown as SiweVerifier;
    await expect(verifySiweRequest(changedExpiry, nonceStore, request, context)).rejects.toThrow(/verified/);
    expect(nonceStore.consume).not.toHaveBeenCalled();
  });

  it("does not allow an expired session or a different owner wallet", () => {
    const session = {
      sessionId: "session-1",
      userId: "user-1",
      walletAddress: "0x0000000000000000000000000000000000000001",
      chainId: 97,
      issuedAt: new Date("2026-09-01T10:00:00.000Z"),
      expiresAt: new Date("2026-09-01T11:00:00.000Z")
    };

    expect(() => assertSessionUsable(session, new Date("2026-09-01T12:00:00.000Z"))).toThrow(/expired/);
    expect(() =>
      assertWalletOwnership(session, "0x0000000000000000000000000000000000000002")
    ).toThrow(/own/);
  });
});
