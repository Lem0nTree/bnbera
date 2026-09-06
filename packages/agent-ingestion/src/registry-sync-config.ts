import { normalizeEvmAddress } from "@bnbera/domain";
import { ingestionError } from "./errors.js";

/** The small lock projection consumed by the direct registry sync seam. */
export type Erc8004RegistrySyncConfig = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly abiSha256: string;
  readonly finalityMode: "rpc-finalized-tag" | "confirmations";
  readonly finalityBlockTag: "finalized" | null;
  readonly confirmationThreshold: number;
};

export type Erc8004ReputationSyncConfig = Erc8004RegistrySyncConfig & {
  readonly reputationRegistry: string;
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function unresolved(message: string): never {
  throw ingestionError("REGISTRY_FINALITY_UNRESOLVED", message, "resolve_registry_finality_lock");
}

/**
 * Resolve direct-sync authority only from the standards lock. In particular,
 * an environment variable or a code default can never supply finality. BSC's
 * current official policy is the provider's `finalized` block tag; numeric
 * confirmation mode remains supported only for an explicitly locked legacy
 * network policy.
 */
export function resolveErc8004RegistrySyncConfig(
  lock: unknown,
  chainId: number,
  expectedAbiSha256: string
): Erc8004RegistrySyncConfig {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The registry sync chain ID is invalid.", "fix_registry_sync_configuration");
  }
  if (typeof expectedAbiSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(expectedAbiSha256)) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The official registry ABI hash is invalid.", "fix_registry_sync_configuration");
  }

  const root = record(lock);
  const networks = record(root?.networks);
  const network = record(networks?.[String(chainId)]);
  const erc8004 = record(network?.erc8004);
  if (erc8004 === null) {
    unresolved("The standards lock has no ERC-8004 configuration for this network.");
  }
  if (erc8004.verificationStatus !== "verified-read-only-bytecode-and-abi") {
    unresolved("The standards lock has not verified the read-only ERC-8004 registry.");
  }

  const registryValue = erc8004.identityRegistry;
  let identityRegistry: string;
  try {
    if (typeof registryValue !== "string") throw new Error("missing");
    identityRegistry = normalizeEvmAddress(registryValue);
  } catch {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked identity registry address is invalid.", "repair_registry_lock");
  }

  const abiHashes = record(erc8004.abiHashes);
  const abiSha256 = abiHashes?.identityRegistry;
  if (typeof abiSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(abiSha256) || abiSha256.toLowerCase() !== expectedAbiSha256.toLowerCase()) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked identity registry ABI hash is unresolved or mismatched.", "repair_registry_lock");
  }

  const finality = record(erc8004.finality);
  const finalityMode = finality?.mode;
  if (finalityMode === "rpc-finalized-tag") {
    if (finality === null) unresolved("The standards lock has no finalized-tag policy details.");
    const finalityPolicy = finality;
    if (finalityPolicy.blockTag !== "finalized" || finalityPolicy.fallback !== "disabled") {
      unresolved("The standards lock has an invalid finalized-tag fallback policy.");
    }
    if (typeof finalityPolicy.source !== "string" || !/^https?:\/\//iu.test(finalityPolicy.source) ||
      typeof finalityPolicy.version !== "string" || finalityPolicy.version.trim().length === 0 ||
      typeof finalityPolicy.retrievedAt !== "string" || Number.isNaN(Date.parse(finalityPolicy.retrievedAt))) {
      unresolved("The standards lock has incomplete BSC finality source/version/date evidence.");
    }
    return {
      chainId,
      identityRegistry,
      abiSha256: abiSha256.toLowerCase(),
      finalityMode: "rpc-finalized-tag",
      finalityBlockTag: "finalized",
      // The database checkpoint column predates tag-based finality. Zero is a
      // compatibility marker; indexerVersion identifies the policy mode.
      confirmationThreshold: 0
    };
  }

  const thresholdValue = erc8004.confirmationThreshold ?? finality?.confirmationThreshold;
  if (thresholdValue === undefined) unresolved("The standards lock has no ERC-8004 finality policy.");
  if (typeof thresholdValue !== "number" || !Number.isSafeInteger(thresholdValue) || thresholdValue < 0) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked confirmation threshold is invalid.", "repair_registry_lock");
  }

  return {
    chainId,
    identityRegistry,
    abiSha256: abiSha256.toLowerCase(),
    finalityMode: "confirmations",
    finalityBlockTag: null,
    confirmationThreshold: thresholdValue
  };
}

/** Resolve the separate Reputation Registry stream from the same standards lock. */
export function resolveErc8004ReputationSyncConfig(
  lock: unknown,
  chainId: number,
  expectedAbiSha256: string
): Erc8004ReputationSyncConfig {
  const root = record(lock);
  const networks = record(root?.networks);
  const network = record(networks?.[String(chainId)]);
  const erc8004 = record(network?.erc8004);
  const abiHashes = record(erc8004?.abiHashes);
  const identityAbiSha256 = abiHashes?.identityRegistry;
  if (typeof identityAbiSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(identityAbiSha256)) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked identity registry ABI hash is unresolved.", "repair_registry_lock");
  }
  const base = resolveErc8004RegistrySyncConfig(lock, chainId, identityAbiSha256);
  const reputationValue = erc8004?.reputationRegistry;
  let reputationRegistry: string;
  try {
    if (typeof reputationValue !== "string") throw new Error("missing");
    reputationRegistry = normalizeEvmAddress(reputationValue);
  } catch {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked reputation registry address is invalid.", "repair_registry_lock");
  }
  const abiSha256 = abiHashes?.reputationRegistry;
  if (typeof abiSha256 !== "string" || !/^[0-9a-f]{64}$/iu.test(abiSha256) || abiSha256.toLowerCase() !== expectedAbiSha256.toLowerCase()) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked reputation registry ABI hash is unresolved or mismatched.", "repair_registry_lock");
  }
  return { ...base, reputationRegistry, abiSha256: abiSha256.toLowerCase() };
}
