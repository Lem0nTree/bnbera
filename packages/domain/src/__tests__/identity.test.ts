import { describe, expect, it } from "vitest";
import {
  erc8004IdentityKey,
  normalizeErc8004Identity,
  normalizeEvmAddress
} from "../identity.js";

const identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
  agentId: "340282366920938463463374607431768211456"
};

describe("ERC-8004 identity", () => {
  it("normalizes registry addresses without changing the decimal agent id", () => {
    const normalized = normalizeErc8004Identity(identity);
    expect(normalized.identityRegistry).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(normalized.agentId).toBe(identity.agentId);
  });

  it("keys identities by namespace, chain, registry, and agent id", () => {
    expect(erc8004IdentityKey(identity)).toBe(
      "eip155:97:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd:340282366920938463463374607431768211456"
    );
  });

  it("rejects shortened wallet or token identifiers", () => {
    expect(() => normalizeEvmAddress("0x1234")).toThrow();
    expect(() => normalizeErc8004Identity({ ...identity, agentId: "1.0" })).toThrow();
  });

  it("rejects agent ids outside the ERC-8004 uint256 range", () => {
    expect(() => normalizeErc8004Identity({ ...identity, agentId: `${2n ** 256n}` })).toThrow();
  });
});
