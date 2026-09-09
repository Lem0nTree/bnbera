/** Read-only receipt audit. Never signs, broadcasts, or changes application state. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BNB, getErc8183Job } from "@altananetwork/sdk";
import { createPublicClient, decodeEventLog, erc20Abi, http, parseAbi, type Hex } from "viem";
import { ERC8183_COMMERCE_EVENTS_ABI, ERC8183_EOA_MAINNET_CONTRACTS } from "../packages/agent-commerce/src/index.js";

const directory = resolve(process.argv[2] ?? "docs/release-evidence/mainnet-e2e-2026-09-09");
const rpcUrl = process.env.BSC_MAINNET_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const client = createPublicClient({ chain: BNB.chain, transport: http(rpcUrl) });
const serialize = (value: unknown) => `${JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? item.toString() : item, 2)}\n`;
const buyer = "0x230072625F8090d5271C5f882748ce11134ac2Ba" as const;
const contracts = ERC8183_EOA_MAINNET_CONTRACTS;

async function main() {
  if (await client.getChainId() !== 56) throw new Error("Expected BSC mainnet");
  const records = (await readFile(resolve(directory, "transactions.ndjson"), "utf8")).trim().split("\n")
    .map(line => JSON.parse(line) as { step: string; transactionHash: Hex; operationId?: string });
  const audited = [];
  let jobId: bigint | undefined;
  for (const record of records) {
    const receipt = await client.getTransactionReceipt({ hash: record.transactionHash });
    const transaction = await client.getTransaction({ hash: record.transactionHash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const events = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contracts.commerceContract.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: ERC8183_COMMERCE_EVENTS_ABI, data: log.data, topics: log.topics });
        events.push(event);
        if (event.eventName === "JobCreated") jobId = event.args.jobId;
      } catch { /* Non-commerce lifecycle log remains in the full receipt. */ }
    }
    if (receipt.status !== "success") throw new Error(`Transaction is not successful: ${record.transactionHash}`);
    if (record.step !== "submit" && transaction.from.toLowerCase() !== buyer.toLowerCase()) throw new Error("Buyer transaction actor mismatch");
    audited.push({ ...record, explorer: `https://bscscan.com/tx/${record.transactionHash}`, timestamp: new Date(Number(block.timestamp) * 1000).toISOString(), transaction, receipt, events, gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice });
  }
  if (jobId === undefined) throw new Error("No receipt-derived JobCreated ID");
  const job = await getErc8183Job({ ...BNB, publicRpcUrl: rpcUrl }, jobId);
  const policyAbi = parseAbi(["function disputeWindow() view returns(uint64)", "function submittedAt(uint256) view returns(uint64)"]);
  const [windowSeconds, submittedAt, balance, allowance] = await Promise.all([
    client.readContract({ address: contracts.policyContract, abi: policyAbi, functionName: "disputeWindow" }),
    client.readContract({ address: contracts.policyContract, abi: policyAbi, functionName: "submittedAt", args: [jobId] }),
    client.readContract({ address: contracts.paymentToken, abi: erc20Abi, functionName: "balanceOf", args: [buyer] }),
    client.readContract({ address: contracts.paymentToken, abi: erc20Abi, functionName: "allowance", args: [buyer, contracts.commerceContract] })
  ]);
  const result = { observedAt: new Date().toISOString(), chainId: 56, buyer, contracts, jobId, job,
    windowSeconds, submittedAt, settlementNotBefore: submittedAt === 0n ? null : new Date(Number(submittedAt + windowSeconds) * 1000).toISOString(),
    buyerUBalanceAtomic: balance, remainingAllowanceAtomic: allowance, transactions: audited };
  await writeFile(resolve(directory, "chain-audit.json"), serialize(result));
  console.log(serialize({ jobId, transactions: audited.length, job, settlementNotBefore: result.settlementNotBefore, remainingAllowanceAtomic: allowance }));
}
main().catch(() => { console.error("MAINNET_E2E_PROOF_AUDIT_FAILED: keep the previous proof and reconcile the exact saved hashes."); process.exitCode = 1; });
