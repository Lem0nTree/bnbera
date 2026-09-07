import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Abi, type Address, type Hex } from "viem";
import {
  Erc8183AltanaAdapter,
  ERC8183_EOA_CONTRACTS,
  ERC8183_COMMERCE_EVENTS_ABI,
  ERC8183_ROUTER_EVENTS_ABI,
  ERC20_APPROVAL_EVENTS_ABI,
  buildErc8183EoaCall,
  type Erc8183OnchainJob,
  type Erc8183RpcLog,
  type Erc8183RpcReceipt,
  type Erc8183EoaStep
} from "../src/index.js";

const CLIENT = "0x3333333333333333333333333333333333333333";
const PROVIDER = "0x4444444444444444444444444444444444444444";
const JOB_ID = "7";
const BUDGET = "1000";
const EXPIRY = 2_000_600;
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const BLOCK = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex;

const COMMERCE_ABI = [
  { type: "function", name: "createJob", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "string" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setBudget", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "fund", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "claimRefund", inputs: [{ type: "uint256" }], outputs: [] }
] as const;
const TOKEN_ABI = [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }] as const;

function call(step: Erc8183EoaStep) {
  return buildErc8183EoaCall({
    chainId: 97,
    contracts: ERC8183_EOA_CONTRACTS,
    step,
    ...(step === "create" ? { providerAddress: PROVIDER, task: "task", expiredAtUnix: EXPIRY } : {}),
    ...(["set_budget", "approve", "fund"].includes(step) ? { budgetAtomic: BUDGET } : {}),
    ...(["register", "set_budget", "fund", "settle", "dispute", "claim_refund"].includes(step) ? { jobId: JOB_ID } : {})
  });
}

function logFor(abi: Abi, eventName: string, args: Record<string, unknown>, dataTypes: readonly { readonly type: string }[] = [], dataValues: readonly unknown[] = [], address: Address = ERC8183_EOA_CONTRACTS.commerceContract): Erc8183RpcLog {
  return {
    address,
    topics: encodeEventTopics({ abi, eventName, args } as never) as readonly Hex[],
    data: dataTypes.length === 0 ? "0x" as Hex : encodeAbiParameters(dataTypes as never, dataValues as never),
    blockNumber: 123n,
    blockHash: BLOCK,
    transactionHash: TX,
    logIndex: 0
  };
}

function receipt(logs: readonly Erc8183RpcLog[]): Erc8183RpcReceipt {
  return { status: "success", blockNumber: 123n, blockHash: BLOCK, transactionHash: TX, logs };
}

function job(status: Erc8183OnchainJob["status"] = "OPEN"): Erc8183OnchainJob {
  return { id: JOB_ID, client: CLIENT as Address, provider: PROVIDER as Address, evaluator: ERC8183_EOA_CONTRACTS.routerContract, hook: ERC8183_EOA_CONTRACTS.routerContract, description: "task", budgetAtomic: BUDGET, expiredAtUnix: EXPIRY, submittedAtUnix: 0, status, chainDeliverable: `0x${"0".repeat(64)}` as Hex };
}

function adapterFor(expectedCall: ReturnType<typeof call>, minedReceipt: Erc8183RpcReceipt, onchainJob: Erc8183OnchainJob, envelopeOverrides: Partial<{ readonly from: Address; readonly to: Address; readonly input: Hex; readonly value: bigint }> = {}, receiptAvailable = true): Erc8183AltanaAdapter {
  return new Erc8183AltanaAdapter({
    pin: {
      enabled: true,
      chainId: 97,
      specRevision: "apex-v1",
      commerceContract: ERC8183_EOA_CONTRACTS.commerceContract,
      paymentToken: ERC8183_EOA_CONTRACTS.paymentToken,
      paymentDecimals: 18,
      abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
      evaluatorProfile: "verified-policy-v1",
      confirmationThreshold: 1,
      minExpiryLeadSeconds: 60,
      maxExpiryHorizonSeconds: 86_400,
      minBudgetAtomic: "1",
      maxBudgetAtomic: "10000000000000000"
    },
    transactionReader: { getTransaction: async () => ({ hash: TX, from: envelopeOverrides.from ?? CLIENT as Address, to: envelopeOverrides.to ?? expectedCall.to, input: envelopeOverrides.input ?? expectedCall.data, value: envelopeOverrides.value ?? 0n }) },
    receiptReader: { getTransactionReceipt: async () => receiptAvailable ? minedReceipt : null },
    sdk: {
      getJob: async () => ({
        id: BigInt(onchainJob.id),
        client: onchainJob.client,
        provider: onchainJob.provider,
        evaluator: onchainJob.evaluator,
        description: onchainJob.description,
        budget: BigInt(onchainJob.budgetAtomic),
        expiredAt: BigInt(onchainJob.expiredAtUnix),
        status: ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"].indexOf(onchainJob.status),
        statusName: onchainJob.status,
        hook: onchainJob.hook,
        submittedAt: BigInt(onchainJob.submittedAtUnix),
        deliverable: onchainJob.chainDeliverable
      })
    }
  });
}

describe("WalletConnect EOA ERC-8183 calls", () => {
  it("builds every step as one exact zero-value transaction", () => {
    const steps: readonly Erc8183EoaStep[] = ["create", "register", "set_budget", "approve", "fund", "settle", "dispute", "claim_refund"];
    for (const step of steps) {
      const built = call(step);
      expect(built.valueAtomic).toBe("0");
      expect(built.data).toMatch(/^0x[0-9a-f]+$/iu);
    }
  });

  it("never predicts a job ID and binds approve to commerce for the exact amount", () => {
    const created = call("create");
    const decodedCreate = decodeFunctionData({ abi: COMMERCE_ABI as unknown as Abi, data: created.data });
    expect(decodedCreate.functionName).toBe("createJob");
    expect(decodedCreate.args?.[0]).toBe(PROVIDER);
    const approved = call("approve");
    const decodedApproval = decodeFunctionData({ abi: TOKEN_ABI as unknown as Abi, data: approved.data });
    expect(approved.to.toLowerCase()).toBe(ERC8183_EOA_CONTRACTS.paymentToken.toLowerCase());
    expect((decodedApproval.args?.[0] as Address).toLowerCase()).toBe(ERC8183_EOA_CONTRACTS.commerceContract.toLowerCase());
    expect(decodedApproval.args?.[1]).toBe(1000n);
  });

  it("rejects a non-pinned deployment, wrong network, and missing actual job ID", () => {
    expect(() => buildErc8183EoaCall({ chainId: 56, contracts: ERC8183_EOA_CONTRACTS, step: "create", providerAddress: PROVIDER, task: "task", expiredAtUnix: EXPIRY })).toThrow(/pinned|97/i);
    expect(() => buildErc8183EoaCall({ chainId: 97, contracts: { ...ERC8183_EOA_CONTRACTS, commerceContract: CLIENT }, step: "approve", budgetAtomic: BUDGET })).toThrow(/standards|deployment/i);
    expect(() => buildErc8183EoaCall({ chainId: 97, contracts: ERC8183_EOA_CONTRACTS, step: "fund", budgetAtomic: BUDGET })).toThrow(/job ID/i);
    expect(() => buildErc8183EoaCall({ chainId: 97, contracts: ERC8183_EOA_CONTRACTS, step: "create", providerAddress: PROVIDER, task: "task", expiredAtUnix: EXPIRY, jobId: JOB_ID })).toThrow(/predicted|job ID/i);
  });

  it("derives and persists the actual JobCreated ID, including after reload", async () => {
    const created = call("create");
    const createdLog = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobCreated", { jobId: 7n, client: CLIENT, provider: PROVIDER }, [{ type: "address" }, { type: "uint256" }, { type: "address" }], [ERC8183_EOA_CONTRACTS.routerContract, EXPIRY, ERC8183_EOA_CONTRACTS.routerContract]);
    const instance = adapterFor(created, receipt([createdLog]), job("OPEN"));
    const verified = await instance.verifyEoaReceipt({ transactionHash: TX, step: "create", actorAddress: CLIENT, providerAddress: PROVIDER, task: "task", budgetAtomic: BUDGET, expiredAtUnix: EXPIRY });
    expect(verified.jobId).toBe(JOB_ID);
    await expect(instance.verifyEoaReceipt({ transactionHash: TX, step: "create", actorAddress: CLIENT, jobId: JOB_ID, providerAddress: PROVIDER, task: "task", budgetAtomic: BUDGET, expiredAtUnix: EXPIRY })).resolves.toMatchObject({ jobId: JOB_ID });
  });

  it("rejects changed actors, wrong spender/amount, and a missing receipt without rebroadcast", async () => {
    const created = call("create");
    const createdLog = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobCreated", { jobId: 7n, client: CLIENT, provider: PROVIDER }, [{ type: "address" }, { type: "uint256" }, { type: "address" }], [ERC8183_EOA_CONTRACTS.routerContract, EXPIRY, ERC8183_EOA_CONTRACTS.routerContract]);
    await expect(adapterFor(created, receipt([createdLog]), job("OPEN"), { from: "0x5555555555555555555555555555555555555555" as Address }).verifyEoaReceipt({ transactionHash: TX, step: "create", actorAddress: CLIENT, providerAddress: PROVIDER, task: "task", expiredAtUnix: EXPIRY })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });

    const approved = call("approve");
    const approvalLog = logFor(ERC20_APPROVAL_EVENTS_ABI as unknown as Abi, "Approval", { owner: CLIENT, spender: "0x5555555555555555555555555555555555555555", value: 999n }, [], [], ERC8183_EOA_CONTRACTS.paymentToken);
    await expect(adapterFor(approved, receipt([approvalLog]), job("OPEN")).verifyEoaReceipt({ transactionHash: TX, step: "approve", actorAddress: CLIENT, jobId: JOB_ID, budgetAtomic: BUDGET })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });

    await expect(adapterFor(created, receipt([createdLog]), job("OPEN"), {}, false).verifyEoaReceipt({ transactionHash: TX, step: "create", actorAddress: CLIENT, providerAddress: PROVIDER, task: "task", expiredAtUnix: EXPIRY })).rejects.toMatchObject({ code: "TRANSACTION_UNKNOWN" });
  });

  it("verifies the register, exact budget, and funded event sequence", async () => {
    const register = call("register");
    const registeredLog = logFor(ERC8183_ROUTER_EVENTS_ABI as unknown as Abi, "JobRegistered", { jobId: 7n, policy: ERC8183_EOA_CONTRACTS.policyContract, client: CLIENT }, [], [], ERC8183_EOA_CONTRACTS.routerContract);
    await expect(adapterFor(register, receipt([registeredLog]), job("OPEN")).verifyEoaReceipt({ transactionHash: TX, step: "register", actorAddress: CLIENT, jobId: JOB_ID })).resolves.toMatchObject({ jobId: JOB_ID });

    const budget = call("set_budget");
    await expect(adapterFor(budget, receipt([]), job("OPEN")).verifyEoaReceipt({ transactionHash: TX, step: "set_budget", actorAddress: CLIENT, jobId: JOB_ID, budgetAtomic: BUDGET })).resolves.toMatchObject({ jobId: JOB_ID });

    const fund = call("fund");
    const fundedLog = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobFunded", { jobId: 7n, client: CLIENT, provider: PROVIDER }, [{ type: "uint256" }], [BigInt(BUDGET)]);
    await expect(adapterFor(fund, receipt([fundedLog]), job("FUNDED")).verifyEoaReceipt({ transactionHash: TX, step: "fund", actorAddress: CLIENT, jobId: JOB_ID, providerAddress: PROVIDER, budgetAtomic: BUDGET })).resolves.toMatchObject({ jobId: JOB_ID });
  });
});
