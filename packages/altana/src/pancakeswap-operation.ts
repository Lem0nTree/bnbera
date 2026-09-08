import { encodeFunctionData } from "viem";
import { AltanaBoundaryError } from "./errors.ts";
import type { ActionRequest, Address, ScopedPolicy } from "./types.ts";

export const PANCAKESWAP_V2_TESTNET = {
  router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  factory: "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  pairs: {
    "tbnb-cake": { token: "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551", pair: "0xd08759B57BBd0158fEAC17457Ce5871B45e85bD9" },
    "tbnb-busd": { token: "0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7", pair: "0x85eCdCDD01EbE0bfd0aBa74B81cA6D7F4A53582b" },
  },
  selector: "0x7ff36ab5",
  exactValueWei: 1_000_000_000_000_000n,
  releaseEnabled: false,
} as const;
export const PANCAKESWAP_V2_MAINNET = { router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", cake: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", pair: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", selector: "0x7ff36ab5", exactValueWei: 1_000_000_000_000_000n, releaseEnabled: false, verificationBlock: 120598699 } as const;
export function pancakeSwapProfile(chainId: 56 | 97) { return chainId === 97 ? PANCAKESWAP_V2_TESTNET : PANCAKESWAP_V2_MAINNET; }

const routerAbi = [{ type: "function", name: "swapExactETHForTokens", stateMutability: "payable", inputs: [{ name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amounts", type: "uint256[]" }] }] as const;

/** Application checks bind dynamic arguments; Altana enforces target/selector/spend onchain. */
export type PancakeTestnetPair = keyof typeof PANCAKESWAP_V2_TESTNET.pairs;
export type BoundedPancakeConfiguration = {
  readonly tradingPair: PancakeTestnetPair;
  readonly inputAmountWei: 100_000_000_000_000n | 500_000_000_000_000n | 1_000_000_000_000_000n;
  readonly slippageBps: 10 | 25 | 50;
  readonly quoteMaxAgeSeconds: 30 | 60;
  readonly deadlineSeconds: 60 | 120;
};

const allowedInputs = new Set<bigint>([100_000_000_000_000n, 500_000_000_000_000n, 1_000_000_000_000_000n]);
const allowedSlippage = new Set<number>([10, 25, 50]);
const allowedQuoteAge = new Set<number>([30, 60]);
const allowedDeadline = new Set<number>([60, 120]);

/** Routes and calldata are derived only from the curated pair key and bounded enums. */
export function buildBoundedPancakeSwap(input: { readonly policy: ScopedPolicy; readonly wallet: Address; readonly quotedOut: bigint; readonly quotedAtUnix: number; readonly quoteBlock: bigint; readonly nowUnix: number; readonly deadlineUnix: number; readonly configuration: BoundedPancakeConfiguration }): { readonly request: ActionRequest; readonly calldata: `0x${string}`; readonly minOut: bigint } {
  const profile = pancakeSwapProfile(input.policy.chainId);
  if (input.policy.chainId === 56) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Mainnet swap execution is release-disabled.");
  const pair = input.policy.chainId === 97 ? PANCAKESWAP_V2_TESTNET.pairs[input.configuration.tradingPair] : undefined;
  if (pair === undefined || !allowedInputs.has(input.configuration.inputAmountWei) || !allowedSlippage.has(input.configuration.slippageBps) || !allowedQuoteAge.has(input.configuration.quoteMaxAgeSeconds) || !allowedDeadline.has(input.configuration.deadlineSeconds) || input.wallet.toLowerCase() !== input.policy.walletAddress.toLowerCase() || input.quoteBlock < 0n || input.quotedAtUnix > input.nowUnix || input.nowUnix - input.quotedAtUnix > input.configuration.quoteMaxAgeSeconds || input.quotedOut <= 0n || input.deadlineUnix <= input.nowUnix || input.deadlineUnix - input.nowUnix > input.configuration.deadlineSeconds) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Swap quote, pair, or bounded configuration is invalid.");
  const allowed = input.policy.calls.some(c => c.target.toLowerCase() === profile.router.toLowerCase() && c.selectors.map(String).includes(profile.selector) && c.maxNativeValueWei >= input.configuration.inputAmountWei);
  if (!allowed) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Authority does not allow the pinned PancakeSwap swap selector.");
  const minOut = input.quotedOut * BigInt(10_000 - input.configuration.slippageBps) / 10_000n;
  if (minOut === 0n) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Swap minimum output rounds to zero.");
  return { minOut, calldata: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens", args: [minOut, [profile.wbnb, pair.token], input.wallet, BigInt(input.deadlineUnix)] }), request: { target: profile.router, selector: profile.selector, valueWei: input.configuration.inputAmountWei, spends: [{ token: "native", amountAtomic: input.configuration.inputAmountWei, period: "hour" }] } };
}
