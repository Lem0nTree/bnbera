import { encodeFunctionData } from "viem";
import { AltanaBoundaryError } from "./errors.ts";
import type { ActionRequest, Address, ScopedPolicy } from "./types.ts";

export const PANCAKESWAP_V2_TESTNET = {
  router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  factory: "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
  wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  cake: "0x8d008B313C1d6C7fE2982F62d32Da7507cF43551",
  pair: "0xd08759B57BBd0158fEAC17457Ce5871B45e85bD9",
  selector: "0x7ff36ab5",
  exactValueWei: 1_000_000_000_000_000n,
  releaseEnabled: false,
} as const;
export const PANCAKESWAP_V2_MAINNET = { router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73", wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", cake: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", pair: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", selector: "0x7ff36ab5", exactValueWei: 1_000_000_000_000_000n, releaseEnabled: false, verificationBlock: 120598699 } as const;
export function pancakeSwapProfile(chainId: 56 | 97) { return chainId === 97 ? PANCAKESWAP_V2_TESTNET : PANCAKESWAP_V2_MAINNET; }

const routerAbi = [{ type: "function", name: "swapExactETHForTokens", stateMutability: "payable", inputs: [{ name: "amountOutMin", type: "uint256" }, { name: "path", type: "address[]" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amounts", type: "uint256[]" }] }] as const;

/** Application checks bind dynamic arguments; Altana enforces target/selector/spend onchain. */
export function buildBoundedPancakeSwap(input: { readonly policy: ScopedPolicy; readonly wallet: Address; readonly quotedOut: bigint; readonly quotedAtUnix: number; readonly quoteBlock: bigint; readonly nowUnix: number; readonly deadlineUnix: number }): { readonly request: ActionRequest; readonly calldata: `0x${string}`; readonly minOut: bigint } {
  const profile = pancakeSwapProfile(input.policy.chainId);
  if (input.policy.chainId === 56 || profile.releaseEnabled === false && input.policy.chainId === 56) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Mainnet swap execution is release-disabled.");
  if (input.wallet.toLowerCase() !== input.policy.walletAddress.toLowerCase() || input.quoteBlock < 0n || input.quotedAtUnix > input.nowUnix || input.nowUnix - input.quotedAtUnix > 60 || input.quotedOut <= 0n || input.deadlineUnix <= input.nowUnix || input.deadlineUnix - input.nowUnix > 120) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Swap quote or deadline is invalid.");
  const allowed = input.policy.calls.some(c => c.target.toLowerCase() === profile.router.toLowerCase() && c.selectors.map(String).includes(profile.selector) && c.maxNativeValueWei === profile.exactValueWei);
  if (!allowed) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Authority does not allow the pinned PancakeSwap swap selector.");
  const minOut = input.quotedOut * 995n / 1000n;
  if (minOut === 0n) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Swap minimum output rounds to zero.");
  return { minOut, calldata: encodeFunctionData({ abi: routerAbi, functionName: "swapExactETHForTokens", args: [minOut, [profile.wbnb, profile.cake], input.wallet, BigInt(input.deadlineUnix)] }), request: { target: profile.router, selector: profile.selector, valueWei: profile.exactValueWei, spends: [{ token: "native", amountAtomic: profile.exactValueWei, period: "hour" }] } };
}
