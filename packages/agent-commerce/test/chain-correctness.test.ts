import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Abi, type Address, type Hex } from "viem";
import {
  Erc8183AltanaAdapter,
  ERC8183_COMMERCE_EVENTS_ABI,
  ERC8183_POLICY_EVENTS_ABI,
  type Erc8183OnchainJob,
  type Erc8183RpcLog,
  type Erc8183RpcReceipt
} from "../src/index.js";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" as Address;
const ROUTER = "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25" as Address;
const POLICY = "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea" as Address;
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565" as Address;
const CLIENT = "0x3333333333333333333333333333333333333333" as Address;
const PROVIDER = "0x4444444444444444444444444444444444444444" as Address;
const DIGEST = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const BLOCK = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Hex;

const PIN = {
  enabled: true as const,
  chainId: 97 as const,
  specRevision: "apex-v1",
  commerceContract: COMMERCE,
  paymentToken: TOKEN,
  paymentDecimals: 18,
  abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 1,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "10000000000000000"
};

function logFor(abi: Abi, eventName: string, args: Record<string, unknown>, dataTypes: readonly { readonly type: string }[] = [], dataValues: readonly unknown[] = [], address: Address = COMMERCE): Erc8183RpcLog {
  const topics = encodeEventTopics({ abi, eventName, args } as never) as readonly Hex[];
  const data = dataTypes.length === 0 ? "0x" as Hex : encodeAbiParameters(dataTypes as never, dataValues as never);
  return { address, topics, data, logIndex: 0 };
}

function receipt(logs: readonly Erc8183RpcLog[]): Erc8183RpcReceipt {
  return { status: "success", blockNumber: 123n, blockHash: BLOCK, transactionHash: TX, logs };
}

function job(statusName: Erc8183OnchainJob["status"]): Erc8183OnchainJob {
  return { id: "7", client: CLIENT, provider: PROVIDER, evaluator: ROUTER, hook: ROUTER, description: "task", budgetAtomic: "1000", expiredAtUnix: 2_000_600, submittedAtUnix: 2_000_001, status: statusName, chainDeliverable: DIGEST };
}

function adapter(readJob: Erc8183OnchainJob, minedReceipt: Erc8183RpcReceipt): Erc8183AltanaAdapter {
  return new Erc8183AltanaAdapter({
    pin: PIN,
    receiptReader: { getTransactionReceipt: async () => minedReceipt },
    sdk: { getJob: async () => ({ id: 7n, client: readJob.client, provider: readJob.provider, evaluator: readJob.evaluator, hook: readJob.hook, description: readJob.description, budget: 1000n, expiredAt: BigInt(readJob.expiredAtUnix), submittedAt: BigInt(readJob.submittedAtUnix), status: ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"].indexOf(readJob.status), statusName: readJob.status, deliverable: readJob.chainDeliverable }) }
  });
}

describe("ERC-8183 operation-specific receipt correctness", () => {
  it("fails closed when standards-locked runtime observations are absent", async () => {
    const instance = adapter(job("FUNDED"), receipt([]));
    await expect(instance.verifyNetwork()).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
  });

  it("rejects a successful submit receipt that has no JobSubmitted event", async () => {
    const instance = adapter(job("SUBMITTED"), receipt([]));
    await expect(instance.verifyReceiptForOperation({ transactionHash: TX, kind: "submit", jobId: "7", signerAddress: PROVIDER, expectation: { digest: DIGEST } })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
  });

  it("checks the committed Keccak event and accepts a later completed state", async () => {
    const submitted = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobSubmitted", { jobId: 7n, provider: PROVIDER }, [{ type: "bytes32" }], [DIGEST]);
    const instance = adapter(job("COMPLETED"), receipt([submitted]));
    const result = await instance.verifyReceiptForOperation({ transactionHash: TX, kind: "submit", jobId: "7", signerAddress: PROVIDER, expectation: { digest: DIGEST, expectedState: "SUBMITTED" } });
    expect(result.job?.status).toBe("COMPLETED");
  });

  it("recovers a hired job identity from canonical events after an adapter restart", async () => {
    const created = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobCreated", { jobId: 7n, client: CLIENT, provider: PROVIDER }, [{ type: "address" }, { type: "uint256" }, { type: "address" }], [ROUTER, 2_000_600n, ROUTER]);
    const funded = logFor(ERC8183_COMMERCE_EVENTS_ABI as unknown as Abi, "JobFunded", { jobId: 7n, client: CLIENT, provider: PROVIDER }, [{ type: "uint256" }], [1000n]);
    const restartedAdapter = adapter(job("SUBMITTED"), receipt([created, funded]));
    const result = await restartedAdapter.verifyReceiptForOperation({ transactionHash: TX, kind: "create", jobId: null, signerAddress: CLIENT, expectation: { providerAddress: PROVIDER, amountAtomic: "1000", expectedState: "FUNDED" } });
    expect(result.job?.id).toBe("7");
    expect(result.job?.status).toBe("SUBMITTED");
  });

  it("verifies disputes by the client without requiring an approval record", async () => {
    const disputed = logFor(ERC8183_POLICY_EVENTS_ABI as unknown as Abi, "Disputed", { jobId: 7n, client: CLIENT }, [], [], POLICY);
    const instance = adapter(job("REJECTED"), receipt([disputed]));
    const result = await instance.verifyReceiptForOperation({ transactionHash: TX, kind: "settle", action: "dispute", jobId: "7", signerAddress: CLIENT });
    expect(result.job?.status).toBe("REJECTED");
  });
});
