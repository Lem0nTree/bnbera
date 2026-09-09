/** Read-only historical execution audit. No wallet or funded notification. */
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http, parseAbiItem, parseAbi, decodeEventLog, hexToString, keccak256, toBytes, type Address } from "viem";
import { canonicalSellerJson, externalSellerManifestSchema } from "../packages/agent-commerce/src/external-seller.ts";
import { createExternalSellerTransport } from "../apps/web/src/lib/external-seller-transport.ts";
const directory = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
const submitted = parseAbiItem("event JobSubmitted(uint256 indexed jobId,address indexed provider,bytes32 deliverable)");
const initialised = parseAbiItem("event JobInitialised(uint256 indexed jobId,bytes32 deliverable,uint64 submittedAt,bytes optParams)");
async function main() {
  if (process.env.MAINNET_EXECUTION_AUDIT_ENABLED !== "true") return;
  const offers = JSON.parse(await readFile(new URL("adapter-audit.json", directory), "utf8"));
  const client = createPublicClient({ transport: http(process.env.MAINNET_EXECUTION_RPC_URL ?? process.env.BSC_MAINNET_RPC_URL, { timeout: 15000, retryCount: 1 }) });
  if (await client.getChainId() !== 56) throw new Error("CHAIN_MISMATCH");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const maxBlocks = Math.min(1000000, Number(process.env.MAINNET_EXECUTION_LOOKBACK_BLOCKS ?? 100000));
  const floor = finalized.number - BigInt(maxBlocks);
  const results: unknown[] = []; const failures: unknown[] = [];
  const providers = offers.map((offer: {binding: {providerAddress: Address}}) => offer.binding.providerAddress);
  const commerce = offers[0].binding.commerceContract as Address;
  const count = await client.readContract({ address: commerce, abi: parseAbi(["function jobCounter() view returns(uint256)"]), functionName: "jobCounter", blockNumber: finalized.number });
  const transport = createExternalSellerTransport();
  for (let end = finalized.number; end > floor; end -= 500n) {
    const start = end - 499n > floor ? end - 499n : floor;
    try {
      const logs = (await client.getLogs({ address: commerce, event: submitted, fromBlock: start, toBlock: end, strict: true })).filter(log => providers.some((provider: string) => provider.toLowerCase() === log.args.provider.toLowerCase()));
      for (const log of logs) {
        const offer = offers.find((o: {binding: {providerAddress: string}}) => o.binding.providerAddress.toLowerCase() === log.args.provider.toLowerCase());
        const receipt = await client.getTransactionReceipt({hash: log.transactionHash});
        const entries = receipt.logs.filter(row => row.address.toLowerCase() === offer.binding.policyContract.toLowerCase()).flatMap(row => {
          try { const decoded = decodeEventLog({abi:[initialised],data:row.data,topics:row.topics}); return decoded.args.jobId === log.args.jobId && decoded.args.deliverable === log.args.deliverable ? [decoded.args] : []; } catch {return [];}
        });
        const pointer = entries.length === 1 ? JSON.parse(hexToString(entries[0]!.optParams)).deliverable_url : null;
        let resultStatus = "POINTER_UNAVAILABLE"; let content: string | null = null;
        if (typeof pointer === "string" && pointer.startsWith("https://")) {
          try { const fetched = await transport.get(pointer); const manifest = externalSellerManifestSchema.parse(fetched.body); if (manifest.job_id.toString() === log.args.jobId.toString() && manifest.chain_id === 56 && manifest.contracts.commerce.toLowerCase() === commerce.toLowerCase() && keccak256(toBytes(canonicalSellerJson(manifest))) === log.args.deliverable) { resultStatus="HASH_VERIFIED_MANIFEST"; content=manifest.response.content; } else resultStatus="MANIFEST_MISMATCH"; } catch { resultStatus="MANIFEST_UNAVAILABLE"; }
        }
        results.push({agentId:offer.agentId,jobId:log.args.jobId.toString(),provider:log.args.provider,transactionHash:log.transactionHash,blockNumber:log.blockNumber.toString(),deliverable:log.args.deliverable,pointer,resultStatus,content});
      }
    } catch (error) { failures.push({fromBlock:start.toString(),toBlock:end.toString(),status:"RPC_UNAVAILABLE", reason: (error as {shortMessage?:string}).shortMessage?.replace(/https?:\/\/\S+/gu,"[rpc]").slice(0,240)}); }
    await writeFile(new URL("execution-audit.json",directory), JSON.stringify({observedAt:new Date().toISOString(),finalizedBlock:finalized.number.toString(),jobCounter:count.toString(),scannedThroughBlock:start.toString(),targetFloor:floor.toString(),results,failures,chainWrites:false,notifications:false},null,2),{mode:0o600});
    console.log(JSON.stringify({scannedThroughBlock:start.toString(),observedSubmissions:results.length,failedWindows:failures.length}));
  }
}
main().catch(()=>{console.error("MAINNET_EXECUTION_AUDIT_FAILED");process.exitCode=1;});
