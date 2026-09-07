import { describe, expect, it } from "vitest";
import {
  EOA_BUYER_CHAIN_ID,
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
});
