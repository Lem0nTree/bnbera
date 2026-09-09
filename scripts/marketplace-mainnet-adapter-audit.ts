/** Exercise the production signed-offer boundary, read-only. No funded notification. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createPublicClient, http, parseAbi } from "viem";
import { ExternalErc8183SellerAdapter, type ExternalSellerBinding } from "../packages/agent-commerce/src/external-seller.ts";
import { ERC8183_MAINNET_MAX_EXACT_AMOUNT } from "../packages/agent-commerce/src/eoa.ts";
import { createExternalSellerTransport } from "../apps/web/src/lib/external-seller-transport.ts";
const directory = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
async function main() {
  if (process.env.MAINNET_ADAPTER_AUDIT_ENABLED !== "true") return;
  const previous = JSON.parse(await readFile(new URL("negotiation-audit.json", directory), "utf8"));
  const deployment = JSON.parse(await readFile(new URL("apex-chain56-readonly-audit.json", directory), "utf8"));
  const client = createPublicClient({ transport: http(process.env.BSC_MAINNET_RPC_URL, { timeout: 12000, retryCount: 1 }) });
  const abi = parseAbi(["function getAgentWallet(uint256) view returns(address)", "function ownerOf(uint256) view returns(address)"]);
  const results: Record<string, unknown>[] = [];
  for (const candidate of previous) {
    const signed = candidate.signatureAudit;
    if (signed?.status !== "VERIFIED_AGENT_WALLET_QUOTE" || signed.currency.toLowerCase() !== deployment.addresses.paymentToken.toLowerCase()) continue;
    const binding: ExternalSellerBinding = { identity: { namespace: "eip155", chainId: 56, identityRegistry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: String(candidate.agentId) },
      providerAddress: signed.agentWallet, endpoint: candidate.endpoint, resultBaseUrl: new URL(candidate.endpoint).origin,
      commerceContract: deployment.addresses.commerceProxy, routerContract: deployment.addresses.routerProxy, policyContract: deployment.addresses.policy,
      paymentToken: deployment.addresses.paymentToken, maxPriceAtomic: ERC8183_MAINNET_MAX_EXACT_AMOUNT };
    const adapter = new ExternalErc8183SellerAdapter(binding, { transport: createExternalSellerTransport(), randomId: randomUUID,
      readJob: async () => { throw new Error("READ_ONLY_NEGOTIATION_ONLY"); }, readIdentity: async input => {
        const block = await client.getBlock({ blockTag: "finalized" });
        const address = input.identity.identityRegistry as `0x${string}`;
        const [agentWallet, owner] = await Promise.all([client.readContract({ address, abi, functionName: "getAgentWallet", args: [BigInt(input.identity.agentId)], blockNumber: block.number }), client.readContract({ address, abi, functionName: "ownerOf", args: [BigInt(input.identity.agentId)], blockNumber: block.number })]);
        return { agentWallet, owner, finalizedBlock: String(block.number) };
      } });
    try {
      const quote = await adapter.negotiate({ task: signed.signedContent.task, deliverables: signed.signedContent.terms.deliverables, qualityStandards: signed.signedContent.terms.quality_standards });
      results.push({ agentId: candidate.agentId, status: "VERIFIED_SIGNED_OFFER", executionStatus: "UNVERIFIED", checkedAt: new Date().toISOString(), binding, quote });
      console.log(JSON.stringify({ agentId: candidate.agentId, status: "VERIFIED_SIGNED_OFFER", priceAtomic: quote.priceAtomic }));
    } catch (error) {
      const safe = error as { code?: string; message?: string; issues?: unknown[] };
      const schemaIssues = safe.issues?.map(issue => { const item = issue as {code?: string; path?: unknown; keys?: string[]}; return {code: item.code, path: item.path, keys: item.keys}; });
      results.push({ agentId: candidate.agentId, status: "REJECTED", checkedAt: new Date().toISOString(), code: safe.code ?? "SCHEMA_OR_TRANSPORT_REJECTED", schemaIssues, reason: safe.code ? safe.message : "The production bounded schema or transport rejected this offer." });
      console.log(JSON.stringify(results.at(-1)));
    }
    await writeFile(new URL("adapter-audit.json", directory), JSON.stringify(results, null, 2), { mode: 0o600 });
  }
  await writeFile(new URL(`adapter-review-${Date.now()}.json`, directory), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reviewed: results.length, verified: results.filter(row => row.status === "VERIFIED_SIGNED_OFFER").length }));
}
main().catch(() => { console.error("MAINNET_ADAPTER_AUDIT_FAILED"); process.exitCode = 1; });
