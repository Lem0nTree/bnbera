import { describe, expect, it, vi } from "vitest";
import { keccak256, type PublicClient } from "viem";
import { createAltanaAdminKeyReader } from "../altana-keystore.js";

const account = "0x1111111111111111111111111111111111111111" as const;
const keyStore = "0x2222222222222222222222222222222222222222" as const;
const publicKey = `0x${"11".repeat(64)}` as `0x${string}`;
const rootId = keccak256(publicKey);
const sessionId = `0x${"22".repeat(32)}` as `0x${string}`;

const network = {
  chainId: 97,
  keyStore,
  publicRpcUrl: "https://rpc.example.test",
  chain: { id: 97, name: "test", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.example.test"] }, public: { http: ["https://rpc.example.test"] } } }
} as const;

describe("Altana KeyStore root-key reader", () => {
  it("reads only valid non-revoked root keys and excludes session keys", async () => {
    const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "getKeys") return [rootId, sessionId];
      if (functionName === "getKey" && args?.[1] === rootId) {
        return { validator: account, publicKey, metadata: "0x", nonce: 0n, lastUpdated: 0n, revoked: false, expiry: 0n, isRoot: true };
      }
      if (functionName === "getKey") {
        return { validator: account, publicKey: `0x${"22".repeat(64)}`, metadata: "0x", nonce: 0n, lastUpdated: 0n, revoked: false, expiry: 1n, isRoot: false };
      }
      return true;
    });
    const reader = createAltanaAdminKeyReader(network, {
      publicClient: {
        getChainId: vi.fn(async () => 97),
        readContract
      } as unknown as Pick<PublicClient, "getChainId" | "readContract">
    });

    await expect(reader.read({ walletAddress: account, chainId: 97 })).resolves.toEqual([{
      keyId: rootId,
      publicKey,
      isRoot: true,
      revoked: false,
      expiry: 0n
    }]);
    expect(readContract).toHaveBeenCalled();
  });

  it("fails closed when the RPC is on a different chain", async () => {
    const reader = createAltanaAdminKeyReader(network, {
      publicClient: {
        getChainId: vi.fn(async () => 56),
        readContract: vi.fn()
      } as unknown as Pick<PublicClient, "getChainId" | "readContract">
    });
    await expect(reader.read({ walletAddress: account, chainId: 97 })).rejects.toThrow(/on-chain/);
  });
});
