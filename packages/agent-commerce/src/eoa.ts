import { encodeFunctionData, type Address, type Hex } from "viem";
import { CommerceError } from "./errors.js";
import { normalizeAddress, parseAtomic } from "./validation.js";

/** The only deployment used by the WalletConnect buyer canary. */
export const ERC8183_EOA_CHAIN_ID = 97 as const;
export const ERC8183_EOA_CONTRACTS = {
  commerceContract: "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address,
  routerContract: "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address,
  policyContract: "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address,
  paymentToken: "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565" as Address
} as const;
export const ERC8183_EOA_MAX_BUDGET_ATOMIC = "10000000000000000" as const;

export const erc8183EoaSteps = [
  "create",
  "register",
  "set_budget",
  "approve",
  "fund",
  "settle",
  "dispute",
  "claim_refund"
] as const;
export type Erc8183EoaStep = (typeof erc8183EoaSteps)[number];

const COMMERCE_ABI = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [
    { name: "provider", type: "address" },
    { name: "evaluator", type: "address" },
    { name: "expiredAt", type: "uint256" },
    { name: "description", type: "string" },
    { name: "hook", type: "address" }
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "optParams", type: "bytes" }
  ], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" },
    { name: "expectedBudget", type: "uint256" },
    { name: "optParams", type: "bytes" }
  ], outputs: [] },
  { type: "function", name: "claimRefund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] }
] as const;

const ROUTER_ABI = [
  { type: "function", name: "registerJob", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" },
    { name: "policy", type: "address" }
  ], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [
    { name: "jobId", type: "uint256" },
    { name: "evidence", type: "bytes" }
  ], outputs: [] }
] as const;

const POLICY_ABI = [
  { type: "function", name: "dispute", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] }
] as const;

const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" }
  ], outputs: [{ type: "bool" }] }
] as const;

export interface Erc8183EoaContracts {
  readonly commerceContract: string;
  readonly routerContract: string;
  readonly policyContract: string;
  readonly paymentToken: string;
}

export interface Erc8183EoaCall {
  readonly step: Erc8183EoaStep;
  readonly to: Address;
  readonly data: Hex;
  readonly valueAtomic: "0";
}

export interface Erc8183EoaCallInput {
  readonly chainId: number;
  readonly contracts: Erc8183EoaContracts;
  readonly step: Erc8183EoaStep;
  readonly providerAddress?: string;
  readonly task?: string;
  readonly expiredAtUnix?: number;
  readonly budgetAtomic?: string;
  readonly jobId?: string;
}

function fail(message: string): never {
  throw new CommerceError({ code: "ONCHAIN_MISMATCH", message, nextAction: "manual_review" });
}

function decimal(value: string | undefined, label: string): bigint {
  if (value === undefined) fail(`${label} is required for the persisted ERC-8183 call.`);
  return parseAtomic(value, label);
}

function budget(value: string | undefined, label: string): bigint {
  const amount = decimal(value, label);
  if (amount < 1n || amount > BigInt(ERC8183_EOA_MAX_BUDGET_ATOMIC)) throw new CommerceError({ code: "INVALID_AMOUNT", message: `${label} is outside the standards-locked EOA budget bounds.`, nextAction: "reload_quote" });
  return amount;
}

function jobId(value: string | undefined): bigint {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/u.test(value)) fail("A confirmed ERC-8183 job ID is required for this call.");
  try { return BigInt(value); } catch (cause) { throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 job ID is outside the uint256 range.", cause }); }
}

function contracts(value: Erc8183EoaContracts): {
  readonly commerce: Address;
  readonly router: Address;
  readonly policy: Address;
  readonly token: Address;
} {
  const actual = {
    commerce: normalizeAddress(value.commerceContract, "commerce contract") as Address,
    router: normalizeAddress(value.routerContract, "router contract") as Address,
    policy: normalizeAddress(value.policyContract, "policy contract") as Address,
    token: normalizeAddress(value.paymentToken, "payment token") as Address
  };
  const expected = ERC8183_EOA_CONTRACTS;
  if (actual.commerce.toLowerCase() !== expected.commerceContract.toLowerCase() ||
      actual.router.toLowerCase() !== expected.routerContract.toLowerCase() ||
      actual.policy.toLowerCase() !== expected.policyContract.toLowerCase() ||
      actual.token.toLowerCase() !== expected.paymentToken.toLowerCase()) {
    throw new CommerceError({ code: "INVALID_CONTRACT", message: "The EOA call deployment does not match the standards-locked APEX ERC-8183 contracts.", nextAction: "verify_standards_lock" });
  }
  return actual;
}

function data(input: Parameters<typeof encodeFunctionData>[0]): Hex {
  return encodeFunctionData(input) as Hex;
}

/** Build one exact, bounded EOA transaction. No job ID is ever predicted. */
export function buildErc8183EoaCall(input: Erc8183EoaCallInput): Erc8183EoaCall {
  if (input.chainId !== ERC8183_EOA_CHAIN_ID) throw new CommerceError({ code: "INVALID_CHAIN", message: "WalletConnect EOA commerce is pinned to BSC testnet (97)." });
  const a = contracts(input.contracts);
  let to: Address;
  let calldata: Hex;
  switch (input.step) {
    case "create": {
      if (input.jobId !== undefined) fail("A create call cannot contain a predicted protocol job ID.");
      if (input.budgetAtomic !== undefined) budget(input.budgetAtomic, "Job budget");
      if (input.providerAddress === undefined || input.task === undefined || input.task.trim() === "") fail("The create call requires the persisted provider and task.");
      if (new TextEncoder().encode(input.task).byteLength > 4_096) throw new CommerceError({ code: "INVALID_JOB", message: "The ERC-8183 task exceeds 4096 UTF-8 bytes." });
      if (input.expiredAtUnix === undefined || !Number.isSafeInteger(input.expiredAtUnix) || input.expiredAtUnix <= 0) fail("The create call requires a valid persisted expiry.");
      to = a.commerce;
      calldata = data({ abi: COMMERCE_ABI, functionName: "createJob", args: [
        normalizeAddress(input.providerAddress, "provider address") as Address,
        a.router,
        BigInt(input.expiredAtUnix),
        input.task,
        a.router
      ] });
      break;
    }
    case "register":
      to = a.router;
      calldata = data({ abi: ROUTER_ABI, functionName: "registerJob", args: [jobId(input.jobId), a.policy] });
      break;
    case "set_budget":
      to = a.commerce;
      calldata = data({ abi: COMMERCE_ABI, functionName: "setBudget", args: [jobId(input.jobId), budget(input.budgetAtomic, "Job budget"), "0x"] });
      break;
    case "approve":
      to = a.token;
      calldata = data({ abi: ERC20_ABI, functionName: "approve", args: [a.commerce, budget(input.budgetAtomic, "Approval amount")] });
      break;
    case "fund":
      to = a.commerce;
      calldata = data({ abi: COMMERCE_ABI, functionName: "fund", args: [jobId(input.jobId), budget(input.budgetAtomic, "Funding amount"), "0x"] });
      break;
    case "settle":
      to = a.router;
      calldata = data({ abi: ROUTER_ABI, functionName: "settle", args: [jobId(input.jobId), "0x"] });
      break;
    case "dispute":
      to = a.policy;
      calldata = data({ abi: POLICY_ABI, functionName: "dispute", args: [jobId(input.jobId)] });
      break;
    case "claim_refund":
      to = a.commerce;
      calldata = data({ abi: COMMERCE_ABI, functionName: "claimRefund", args: [jobId(input.jobId)] });
      break;
    default: {
      const exhaustive: never = input.step;
      return exhaustive;
    }
  }
  return { step: input.step, to, data: calldata, valueAtomic: "0" };
}
