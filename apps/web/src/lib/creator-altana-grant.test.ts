import { describe, expect, it } from "vitest";
import { creatorAuthorityGrant, creatorSdkGrantRequest } from "./creator-altana-grant";

const admin = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const wallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const session = "0xcccccccccccccccccccccccccccccccccccccccc" as const;
const key = `0x04${"11".repeat(64)}` as `0x${string}`;

describe("Creator Altana grant payload", () => {
  it("derives fixed chain-97 calls, cap and expiry without browser policy input", () => {
    const grant = creatorAuthorityGrant({ adminAddress: admin, walletAddress: wallet, sessionPublicAddress: session, sessionPublicKey: key, nowUnix: 1_700_000_000 });
    expect(grant.policy.chainId).toBe(97);
    expect(grant.policy.expiresAtUnix).toBe(1_700_003_600);
    expect(grant.policy.spend).toEqual([{ token: "native", limitAtomic: 2_000_000_000_000_000n, period: "hour" }]);
    expect(grant.sdk).toMatchObject({ expiry: 1_700_003_600, register: true });
    expect(JSON.stringify({ policyDigest: grant.policyDigest, sdk: { expiry: grant.sdk.expiry, register: grant.sdk.register } })).not.toMatch(/private|secret|credential|sessionSigner/iu);
  });

  it("requires an explicit session signer and does not substitute an admin", () => {
    const grant = creatorAuthorityGrant({ adminAddress: admin, walletAddress: wallet, sessionPublicAddress: session, sessionPublicKey: key, nowUnix: 1_700_000_000 });
    const adminSigner = { type: "passkey" as const, address: "0x0000000000000000000000000000000000000000" as const, publicKey: key, async signDigest() { return `0x${"22".repeat(65)}` as `0x${string}`; } };
    const sessionSigner = { type: "privateKey" as const, address: session, publicKey: `0x04${"22".repeat(64)}` as `0x${string}`, async signDigest() { return `0x${"33".repeat(65)}` as `0x${string}`; } };
    const request = creatorSdkGrantRequest({ wallet: { address: wallet }, adminSigner, sessionSigner, grant });
    expect(request.signer).toBe(adminSigner);
    expect(request.sessionSigner).toBe(sessionSigner);
    expect(request.chainId).toBe(97);
  });
});
