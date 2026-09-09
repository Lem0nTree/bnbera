import { describe, expect, it } from "vitest";
import {
  EOA_BUYER_CHAIN_ID,
  isEoaDispatchGenerationCurrent,
  isEoaAuthorityCurrent,
  shouldInvalidateEoaAuthority,
  type EoaWalletSnapshot
} from "./eoa-wallet";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const authority = { address: ADDRESS, chainId: EOA_BUYER_CHAIN_ID };

function snapshot(overrides: Partial<EoaWalletSnapshot> = {}): EoaWalletSnapshot {
  return { connected: true, address: ADDRESS, chainId: EOA_BUYER_CHAIN_ID, ...overrides };
}

describe("EOA buyer authority binding", () => {
  it("accepts only the connected address on the pinned chain", () => {
    expect(isEoaAuthorityCurrent(snapshot(), authority)).toBe(true);
    expect(isEoaAuthorityCurrent(snapshot({ address: OTHER_ADDRESS }), authority)).toBe(false);
    expect(isEoaAuthorityCurrent(snapshot({ chainId: 56 }), authority)).toBe(false);
    expect(isEoaAuthorityCurrent(snapshot({ connected: false }), authority)).toBe(false);
  });

  it("invalidates UI authority when the account changes", () => {
    const previous = snapshot();
    expect(shouldInvalidateEoaAuthority(previous, snapshot({ address: OTHER_ADDRESS }), authority)).toBe(true);
    expect(shouldInvalidateEoaAuthority(previous, snapshot({ chainId: 56 }), authority)).toBe(true);
    expect(shouldInvalidateEoaAuthority(previous, snapshot({ connected: false, address: undefined, chainId: undefined }), authority)).toBe(true);
    expect(shouldInvalidateEoaAuthority(previous, snapshot(), authority)).toBe(false);
  });

  it("cancels a sequential send when the live account or chain generation changes", () => {
    expect(isEoaDispatchGenerationCurrent(4, 4, snapshot(), ADDRESS)).toBe(true);
    expect(isEoaDispatchGenerationCurrent(4, 5, snapshot(), ADDRESS)).toBe(false);
    expect(isEoaDispatchGenerationCurrent(4, 4, snapshot({ address: OTHER_ADDRESS }), ADDRESS)).toBe(false);
    expect(isEoaDispatchGenerationCurrent(4, 4, snapshot({ chainId: 56 }), ADDRESS)).toBe(false);
  });

  it("requires the exact mainnet operation chain without changing the testnet default", () => {
    const mainnet = snapshot({ chainId: 56 });
    expect(isEoaDispatchGenerationCurrent(4, 4, mainnet, ADDRESS, 56)).toBe(true);
    expect(isEoaDispatchGenerationCurrent(4, 4, snapshot(), ADDRESS, 56)).toBe(false);
    expect(isEoaDispatchGenerationCurrent(4, 5, mainnet, ADDRESS, 56)).toBe(false);
    expect(isEoaDispatchGenerationCurrent(4, 4, mainnet, OTHER_ADDRESS, 56)).toBe(false);
    expect(isEoaDispatchGenerationCurrent(4, 4, mainnet, ADDRESS)).toBe(false);
  });
});
