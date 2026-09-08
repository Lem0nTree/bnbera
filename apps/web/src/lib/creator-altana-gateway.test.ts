import { keccak256 } from "viem";
import type { RuntimeSessionDescriptor } from "@bnbera/altana";
import { describe, expect, it } from "vitest";
import { createAltanaChainAuthorityGateway, type CreatorKeyStoreReader } from "./creator-altana-gateway";

const publicKey = `0x04${"11".repeat(64)}` as `0x${string}`;
const descriptor: RuntimeSessionDescriptor = {
  sessionId: "creator-browser:draft:abcd1234",
  policy: {
    chainId: 97,
    adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
    sessionPublicKey: publicKey,
    calls: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", selectors: ["0x12345678"], maxNativeValueWei: 0n }],
    spend: [],
    expiresAtUnix: 1_700_001_000,
  },
  policyDigest: `0x${"22".repeat(32)}`,
  grantTransactionHash: null,
  secretReference: null,
  grantedAtUnix: 1_700_000_000,
};

function reader(valid: boolean, calls: string[], keyOverrides: Partial<{ validator: `0x${string}`; publicKey: `0x${string}`; revoked: boolean; expiry: bigint; isRoot: boolean }> = {}): CreatorKeyStoreReader {
  return {
    async getChainId() { calls.push("chain"); return 97; },
    async getBlockNumber() { calls.push("blockNumber"); return 123n; },
    async getBlock() { calls.push("block"); return { timestamp: 1_700_000_000n }; },
    async readKey() {
      calls.push("key-record");
      return {
        validator: "0x0000000000000000000000000000000000000000",
        publicKey,
        revoked: false,
        expiry: 1_700_001_000n,
        isRoot: false,
        ...keyOverrides,
      };
    },
    async readIsValidKey(input) { calls.push(`key:${input.wallet}:${input.keyId}`); return valid; },
  };
}

describe("Altana Creator authority gateway", () => {
  it("reads isValidKey for the pinned wallet/key hash at one fresh block", async () => {
    const calls: string[] = [];
    const gateway = createAltanaChainAuthorityGateway({ reader: reader(true, calls), nowUnix: () => 1_700_000_001 });
    await expect(gateway.read(descriptor)).resolves.toMatchObject({ status: "active", source: "chain-read", observedBlockNumber: 123n, observedAtUnix: 1_700_000_000 });
    expect(calls).toEqual(["chain", "blockNumber", "block", "key-record", `key:${descriptor.policy.walletAddress}:${keccak256(publicKey)}`]);
  });

  it("reports invalid keys as revoked and refuses a wrong provider chain", async () => {
    const calls: string[] = [];
    const gateway = createAltanaChainAuthorityGateway({ reader: reader(false, calls), nowUnix: () => 1_700_000_001 });
    await expect(gateway.read(descriptor)).resolves.toMatchObject({ status: "revoked", reasonCode: "KEYSTORE_KEY_INVALID" });
    const wrongChain: CreatorKeyStoreReader = { ...reader(true, []), getChainId: async () => 56 };
    await expect(createAltanaChainAuthorityGateway({ reader: wrongChain, nowUnix: () => 1_700_000_001 }).read(descriptor)).rejects.toThrow();
  });

  it("fails closed when the chain record is root, unbounded, or bound to another key", async () => {
    for (const key of [
      { isRoot: true, expiry: 0n },
      { expiry: 1_700_001_001n },
      { publicKey: `0x04${"22".repeat(64)}` as `0x${string}` },
    ]) {
      const calls: string[] = [];
      await expect(createAltanaChainAuthorityGateway({ reader: reader(true, calls, key), nowUnix: () => 1_700_000_001 }).read(descriptor)).rejects.toThrow(/bound/i);
    }
  });
});
