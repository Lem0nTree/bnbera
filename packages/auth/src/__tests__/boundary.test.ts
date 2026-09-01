import { describe, expect, it } from "vitest";
import {
  assertSessionUsable,
  assertWalletOwnership,
  validateSiweRequest,
  verifySiweRequest
} from "../boundary.js";

const context = { domain: "localhost:3000", chainId: 97 };

describe("SIWE and session boundary", () => {
  it("validates application domain and chain before cryptographic verification", () => {
    expect(() =>
      validateSiweRequest(
        {
          address: "0x0000000000000000000000000000000000000001",
          chainId: 56,
          domain: context.domain,
          uri: "http://localhost:3000",
          nonce: "nonce-123456",
          issuedAt: "2026-09-01T10:00:00.000Z"
        },
        context
      )
    ).toThrow(/context/);
  });

  it("checks the verified address and chain against the signed message", async () => {
    const verifier = {
      verify: async () => ({
        address: "0x0000000000000000000000000000000000000001",
        chainId: 97,
        issuedAt: new Date("2026-09-01T10:00:00.000Z")
      })
    };

    const proof = await verifySiweRequest(
      verifier,
      {
        address: "0x0000000000000000000000000000000000000001",
        chainId: 97,
        domain: context.domain,
        uri: "http://localhost:3000",
        nonce: "nonce-123456",
        issuedAt: "2026-09-01T10:00:00.000Z"
      },
      context
    );
    expect(proof.address).toBe("0x0000000000000000000000000000000000000001");
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
