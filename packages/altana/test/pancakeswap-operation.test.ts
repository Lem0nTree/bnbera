import assert from "node:assert/strict";
import test from "node:test";
import { buildBoundedPancakeSwap, pancakeSwapProfile, PANCAKESWAP_V2_TESTNET, type ScopedPolicy } from "../src/index.ts";

const wallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
function policy(overrides: Partial<ScopedPolicy> = {}): ScopedPolicy { return { chainId: 97, adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", walletAddress: wallet, sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc", calls: [{ target: PANCAKESWAP_V2_TESTNET.router, selectors: [PANCAKESWAP_V2_TESTNET.selector], maxNativeValueWei: PANCAKESWAP_V2_TESTNET.exactValueWei }], spend: [{ token: "native", limitAtomic: 2_000_000_000_000_000n, period: "hour" }], expiresAtUnix: 2_000_000_000, ...overrides }; }

test("builds only the pinned exact PancakeSwap V2 testnet swap", () => {
  const result = buildBoundedPancakeSwap({ policy: policy(), wallet, quotedOut: 1_000n, quotedAtUnix: 1_700_000_000, quoteBlock: 1n, nowUnix: 1_700_000_000, deadlineUnix: 1_700_000_120, configuration: { tradingPair: "tbnb-cake", inputAmountWei: 1_000_000_000_000_000n, slippageBps: 50, quoteMaxAgeSeconds: 60, deadlineSeconds: 120 } });
  assert.equal(result.request.target, PANCAKESWAP_V2_TESTNET.router);
  assert.equal(result.request.selector, "0x7ff36ab5");
  assert.equal(result.request.valueWei, 1_000_000_000_000_000n);
  assert.equal(result.minOut, 995n);
  assert.match(result.calldata, /^0x7ff36ab5/);
});
test("uses distinct chain profiles and leaves mainnet writes disabled", () => {
  assert.equal(pancakeSwapProfile(97).router, PANCAKESWAP_V2_TESTNET.router);
  assert.notEqual(pancakeSwapProfile(56).router.toLowerCase(), PANCAKESWAP_V2_TESTNET.router.toLowerCase());
  assert.equal(pancakeSwapProfile(56).releaseEnabled, false);
});

test("fails closed for stale quotes, excessive deadline, wrong router/selector, or insufficient cap", () => {
  const configuration = { tradingPair: "tbnb-busd" as const, inputAmountWei: 1_000_000_000_000_000n as const, slippageBps: 50 as const, quoteMaxAgeSeconds: 60 as const, deadlineSeconds: 120 as const };
  const input = { wallet, quotedOut: 1_000n, quotedAtUnix: 1_700_000_000, quoteBlock: 1n, nowUnix: 1_700_000_000, deadlineUnix: 1_700_000_121, configuration };
  assert.throws(() => buildBoundedPancakeSwap({ policy: policy(), ...input }));
  assert.throws(() => buildBoundedPancakeSwap({ policy: policy({ calls: [{ ...policy().calls[0], target: wallet }] }), ...input, deadlineUnix: 1_700_000_120 }));
  assert.throws(() => buildBoundedPancakeSwap({ policy: policy({ calls: [{ ...policy().calls[0], selectors: ["0x12345678"] }] }), ...input, deadlineUnix: 1_700_000_120 }));
  assert.throws(() => buildBoundedPancakeSwap({ policy: policy(), ...input, quotedOut: 0n, deadlineUnix: 1_700_000_120 }));
});

test("derives the BUSD path from its curated key and refuses unbounded values", () => {
  const configuration = { tradingPair: "tbnb-busd" as const, inputAmountWei: 500_000_000_000_000n as const, slippageBps: 25 as const, quoteMaxAgeSeconds: 30 as const, deadlineSeconds: 60 as const };
  const result = buildBoundedPancakeSwap({ policy: policy(), wallet, quotedOut: 1_000n, quotedAtUnix: 1_700_000_000, quoteBlock: 1n, nowUnix: 1_700_000_020, deadlineUnix: 1_700_000_060, configuration });
  assert.match(result.calldata, /78867bbeef44f2326bf8ddd1941a4439382ef2a7/i);
  assert.equal(result.request.valueWei, 500_000_000_000_000n);
});
