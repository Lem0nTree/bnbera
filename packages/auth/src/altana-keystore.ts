import { AppError } from "@bnbera/config";
import { evmAddressSchema, normalizeEvmAddress } from "@bnbera/domain";
import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient
} from "viem";
import type { AltanaAdminKey, AltanaAdminKeyReader } from "./webauthn.js";

/**
 * Read-only ABI for the deployed Altana KeyStore. The public SDK exposes
 * `getKeys`/`getPublicKey`, but not the root/session discriminator, so this
 * adapter uses the deployed `getKey` view directly. No transaction method is
 * present here by design.
 */
export const altanaKeyStoreAbi = [
  {
    type: "function",
    name: "getKeys",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "keyIds", type: "bytes32[]" }]
  },
  {
    type: "function",
    name: "getKey",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyId", type: "bytes32" }
    ],
    outputs: [{
      name: "key",
      type: "tuple",
      components: [
        { name: "validator", type: "address" },
        { name: "publicKey", type: "bytes" },
        { name: "metadata", type: "bytes" },
        { name: "nonce", type: "uint64" },
        { name: "lastUpdated", type: "uint64" },
        { name: "revoked", type: "bool" },
        { name: "expiry", type: "uint40" },
        { name: "isRoot", type: "bool" }
      ]
    }]
  },
  {
    type: "function",
    name: "isValidKey",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "keyId", type: "bytes32" }
    ],
    outputs: [{ name: "valid", type: "bool" }]
  }
] as const;

export type AltanaReadNetwork = {
  readonly chainId: number;
  readonly keyStore: Address;
  readonly publicRpcUrl: string;
  readonly chain: Chain;
};

type KeyTuple = {
  readonly validator: Address;
  readonly publicKey: Hex;
  readonly metadata: Hex;
  readonly nonce: bigint;
  readonly lastUpdated: bigint;
  readonly revoked: boolean;
  readonly expiry: bigint;
  readonly isRoot: boolean;
};

type RawKeyTuple = Omit<KeyTuple, "expiry"> & { readonly expiry: bigint | number };

const uint40Max = (1n << 40n) - 1n;

type AltanaKeyStoreClient = Pick<PublicClient, "getChainId" | "readContract">;

function unavailable(cause?: unknown): AppError {
  return new AppError({
    code: "ALTANA_ADMIN_KEY_UNAVAILABLE",
    safeMessage: "Wallet ownership could not be verified on-chain.",
    requestId: "auth-altana-keystore",
    retriable: true,
    nextAction: "try_again",
    cause
  });
}

function assertNetwork(network: AltanaReadNetwork): void {
  if (
    !Number.isSafeInteger(network.chainId) || network.chainId <= 0 ||
    !evmAddressSchema.safeParse(network.keyStore).success ||
    !/^https?:\/\/[^\s]+$/u.test(network.publicRpcUrl) ||
    network.chain === undefined
  ) {
    throw unavailable(new Error("Altana network configuration is incomplete"));
  }
}

function keyTuple(value: unknown): KeyTuple {
  if (Array.isArray(value)) {
    const [validator, publicKey, metadata, nonce, lastUpdated, revoked, expiry, isRoot] = value;
    value = { validator, publicKey, metadata, nonce, lastUpdated, revoked, expiry, isRoot };
  }
  if (typeof value !== "object" || value === null) throw new Error("Altana KeyStore returned no key");
  const candidate = value as Partial<RawKeyTuple>;
  if (
    typeof candidate.validator !== "string" ||
    typeof candidate.publicKey !== "string" ||
    typeof candidate.metadata !== "string" ||
    typeof candidate.nonce !== "bigint" ||
    typeof candidate.lastUpdated !== "bigint" ||
    typeof candidate.revoked !== "boolean" ||
    (typeof candidate.expiry !== "bigint" && typeof candidate.expiry !== "number") ||
    typeof candidate.isRoot !== "boolean"
  ) {
    throw new Error("Altana KeyStore returned an invalid key");
  }
  const expiry = typeof candidate.expiry === "bigint"
    ? candidate.expiry
    : Number.isSafeInteger(candidate.expiry) && candidate.expiry >= 0
      ? BigInt(candidate.expiry)
      : null;
  if (expiry === null || expiry < 0n || expiry > uint40Max) {
    throw new Error("Altana KeyStore returned an invalid uint40 expiry");
  }
  return { ...candidate, expiry } as KeyTuple;
}

function createDefaultClient(network: AltanaReadNetwork): AltanaKeyStoreClient {
  return createPublicClient({ chain: network.chain, transport: http(network.publicRpcUrl) });
}

/**
 * Build the current root-key reader. Every read checks the configured chain
 * and validates `isValidKey`, `revoked`, `expiry`, and `isRoot`; expired or
 * delegated/session keys therefore cannot be used as account ownership.
 */
export function createAltanaAdminKeyReader(
  network: AltanaReadNetwork,
  options?: { readonly publicClient?: AltanaKeyStoreClient; readonly maxKeys?: number }
): AltanaAdminKeyReader {
  assertNetwork(network);
  const client = options?.publicClient ?? createDefaultClient(network);
  const maxKeys = options?.maxKeys ?? 32;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 128) {
    throw unavailable(new Error("Altana KeyStore key bound is invalid"));
  }

  return {
    async read(input): Promise<readonly AltanaAdminKey[]> {
      const walletAddress = normalizeEvmAddress(evmAddressSchema.parse(input.walletAddress)) as Address;
      if (input.chainId !== network.chainId) {
        throw unavailable(new Error("Altana KeyStore chain mismatch"));
      }

      try {
        const observedChainId = await client.getChainId();
        if (observedChainId !== network.chainId) throw new Error("Altana RPC chain mismatch");

        const keyIds = await client.readContract({
          address: network.keyStore,
          abi: altanaKeyStoreAbi,
          functionName: "getKeys",
          args: [walletAddress]
        });
        if (keyIds.length > maxKeys) throw new Error("Altana KeyStore key count exceeds bound");

        const roots: AltanaAdminKey[] = [];
        for (const keyId of keyIds) {
          const key = keyTuple(await client.readContract({
            address: network.keyStore,
            abi: altanaKeyStoreAbi,
            functionName: "getKey",
            args: [walletAddress, keyId]
          }));
          if (!key.isRoot || key.revoked || key.expiry !== 0n) continue;
          const valid = await client.readContract({
            address: network.keyStore,
            abi: altanaKeyStoreAbi,
            functionName: "isValidKey",
            args: [walletAddress, keyId]
          });
          if (!valid) continue;
          roots.push({
            keyId,
            publicKey: key.publicKey,
            isRoot: key.isRoot,
            revoked: key.revoked,
            expiry: key.expiry
          });
        }
        return roots;
      } catch (cause) {
        if (cause instanceof AppError) throw cause;
        throw unavailable(cause);
      }
    }
  };
}
