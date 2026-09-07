import { evmAddressSchema, normalizeEvmAddress } from "@bnbera/domain";

export const EOA_BUYER_CHAIN_ID = 97 as const;

export type EoaWalletSnapshot = {
  readonly connected: boolean;
  readonly address: string | undefined;
  readonly chainId: number | undefined;
};

/** Compare the current WalletConnect account/network with a bound authority. */
export function isEoaAuthorityCurrent(
  snapshot: EoaWalletSnapshot,
  authority: { readonly address: string; readonly chainId: number }
): boolean {
  if (!snapshot.connected || snapshot.address === undefined || snapshot.chainId === undefined) return false;
  if (!evmAddressSchema.safeParse(snapshot.address).success || !evmAddressSchema.safeParse(authority.address).success) return false;
  return normalizeEvmAddress(snapshot.address) === normalizeEvmAddress(authority.address) && snapshot.chainId === authority.chainId;
}

/** A connected-account or chain change must invalidate UI signing authority. */
export function shouldInvalidateEoaAuthority(
  previous: EoaWalletSnapshot | null,
  current: EoaWalletSnapshot,
  authority: { readonly address: string; readonly chainId: number } | null
): boolean {
  if (authority === null) return false;
  if (!isEoaAuthorityCurrent(current, authority)) return true;
  if (previous === null) return false;
  return previous.address?.toLowerCase() !== current.address?.toLowerCase() || previous.chainId !== current.chainId;
}

/** A sequential writer must stop when its live wallet generation changes. */
export function isEoaDispatchGenerationCurrent(
  startedGeneration: number,
  currentGeneration: number,
  snapshot: EoaWalletSnapshot,
  actorAddress: string
): boolean {
  return startedGeneration === currentGeneration && isEoaAuthorityCurrent(snapshot, { address: actorAddress, chainId: EOA_BUYER_CHAIN_ID });
}
