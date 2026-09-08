import { BNB_TESTNET } from "@altananetwork/sdk";
import { altanaKeyStoreAbi } from "@bnbera/auth";
import { createPublicClient, http, keccak256, type Address, type Chain, type Hex } from "viem";
import type { CreatorAuthorityGateway, RuntimeSessionDescriptor, SessionStateObservation } from "@bnbera/altana";

export type CreatorKeyStoreReader = {
  readonly getChainId: () => Promise<number>;
  readonly getBlockNumber: () => Promise<bigint>;
  readonly getBlock: (input: { readonly blockNumber: bigint }) => Promise<{ readonly timestamp: bigint }>;
  readonly readKey: (input: { readonly wallet: Address; readonly keyId: Hex; readonly blockNumber: bigint }) => Promise<unknown>;
  readonly readIsValidKey: (input: { readonly wallet: Address; readonly keyId: Hex; readonly blockNumber: bigint }) => Promise<boolean>;
};

const chainId = 97;
const keyStore = BNB_TESTNET.keyStore as Address;

function defaultReader(): CreatorKeyStoreReader {
  const client = createPublicClient({ chain: BNB_TESTNET.chain as unknown as Chain, transport: http(BNB_TESTNET.publicRpcUrl) });
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    getBlock: ({ blockNumber }) => client.getBlock({ blockNumber }),
    readKey: ({ wallet, keyId, blockNumber }) => client.readContract({
      address: keyStore,
      abi: altanaKeyStoreAbi,
      functionName: "getKey",
      args: [wallet, keyId],
      blockNumber,
    }),
    async readIsValidKey({ wallet, keyId, blockNumber }) {
      const value = await client.readContract({
        address: keyStore,
        abi: altanaKeyStoreAbi,
        functionName: "isValidKey",
        args: [wallet, keyId],
        blockNumber,
      });
      if (typeof value !== "boolean") throw new Error("Altana KeyStore returned an invalid validity result.");
      return value;
    },
  };
}

function unixTimestamp(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Altana block timestamp is invalid.");
  return Number(value);
}

type KeyRecord = { readonly validator: Address; readonly publicKey: Hex; readonly revoked: boolean; readonly expiry: bigint; readonly isRoot: boolean };
const zeroAddress = "0x0000000000000000000000000000000000000000";

function decodeKey(value: unknown): KeyRecord {
  const fields = Array.isArray(value)
    ? { validator: value[0], publicKey: value[1], revoked: value[5], expiry: value[6], isRoot: value[7] }
    : value;
  if (fields === null || typeof fields !== "object") throw new Error("Altana KeyStore returned no key.");
  const candidate = fields as Record<string, unknown>;
  const expiry = typeof candidate.expiry === "bigint"
    ? candidate.expiry
    : typeof candidate.expiry === "number" && Number.isSafeInteger(candidate.expiry) && candidate.expiry >= 0
      ? BigInt(candidate.expiry)
      : null;
  if (typeof candidate.validator !== "string" || !/^0x[0-9a-f]{40}$/iu.test(candidate.validator) || typeof candidate.publicKey !== "string" || !/^0x[0-9a-f]*$/iu.test(candidate.publicKey) || typeof candidate.revoked !== "boolean" || expiry === null || typeof candidate.isRoot !== "boolean") throw new Error("Altana KeyStore returned an invalid key.");
  return { validator: candidate.validator as Address, publicKey: candidate.publicKey as Hex, revoked: candidate.revoked, expiry, isRoot: candidate.isRoot };
}

/**
 * The only production authority read used by Creator. The RPC URL, chain,
 * KeyStore address, and method are all SDK-pinned; tests inject the narrow
 * reader rather than touching a live provider.
 */
export function createAltanaChainAuthorityGateway(options: {
  readonly reader?: CreatorKeyStoreReader;
  readonly nowUnix?: () => number;
} = {}): CreatorAuthorityGateway {
  const reader = options.reader ?? defaultReader();
  const now = options.nowUnix ?? (() => Math.floor(Date.now() / 1000));

  const read = async (descriptor: RuntimeSessionDescriptor): Promise<SessionStateObservation> => {
    const publicKey = descriptor.policy.sessionPublicKey;
    if (publicKey === undefined) throw new Error("Creator authority has no registered session public key.");
    if (descriptor.policy.chainId !== chainId) throw new Error("Creator authority chain does not match the pinned testnet.");
    const wallet = descriptor.policy.walletAddress as Address;
    const keyId = keccak256(publicKey as Hex);
    const observedChainId = await reader.getChainId();
    if (observedChainId !== chainId) throw new Error("Altana authority provider returned the wrong chain.");
    const observedBlockNumber = await reader.getBlockNumber();
    if (observedBlockNumber <= 0n) throw new Error("Altana authority provider returned no usable block.");
    const block = await reader.getBlock({ blockNumber: observedBlockNumber });
    const blockUnix = unixTimestamp(block.timestamp);
    const nowUnix = now();
    if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0) throw new Error("Creator authority clock is invalid.");
    const observedAtUnix = Math.min(nowUnix, blockUnix);
    const key = decodeKey(await reader.readKey({ wallet, keyId, blockNumber: observedBlockNumber }));
    if (key.publicKey.toLowerCase() !== publicKey.toLowerCase() || keccak256(key.publicKey) !== keyId || key.validator.toLowerCase() !== zeroAddress || key.isRoot || key.expiry !== BigInt(descriptor.policy.expiresAtUnix)) throw new Error("Altana KeyStore key is not bound to the Creator session.");
    const valid = await reader.readIsValidKey({ wallet, keyId, blockNumber: observedBlockNumber });
    const status = nowUnix >= descriptor.policy.expiresAtUnix
      ? "expired"
      : key.revoked || !valid
        ? "revoked"
        : key.expiry <= BigInt(blockUnix)
          ? "expired"
          : valid
        ? "active"
        : "unknown";
    return {
      sessionId: descriptor.sessionId,
      policyDigest: descriptor.policyDigest,
      status,
      observedAtUnix,
      observedBlockNumber,
      source: "chain-read",
      reasonCode: status === "active" ? null : status === "expired" ? "AUTHORITY_EXPIRED" : "KEYSTORE_KEY_INVALID",
    };
  };

  return {
    read,
    // The browser/passkey owns the revoke transaction. A server-side revoke
    // route therefore performs the same fresh read and never pretends a
    // mutation was submitted without admin material.
    revoke: read,
  };
}
