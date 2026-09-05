import { normalizeEvmAddress } from "@bnbera/domain";
import { ingestionError } from "./errors.js";

/** The small lock projection consumed by the direct registry sync seam. */
export type Erc8004RegistrySyncConfig = {
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly abiSha256: string;
  readonly confirmationThreshold: number;
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
 * an environment variable or a code default can never supply finality. The
 * current lock intentionally has no confirmationThreshold, so production
 * direct sync remains disabled until A0 resolves that entry.
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
  const thresholdValue = erc8004.confirmationThreshold ?? finality?.confirmationThreshold;
  if (thresholdValue === undefined) {
    unresolved("The standards lock has no ERC-8004 confirmation threshold.");
  }
  if (typeof thresholdValue !== "number" || !Number.isSafeInteger(thresholdValue) || thresholdValue < 0) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The standards-locked confirmation threshold is invalid.", "repair_registry_lock");
  }

  return {
    chainId,
    identityRegistry,
    abiSha256: abiSha256.toLowerCase(),
    confirmationThreshold: thresholdValue
  };
}
