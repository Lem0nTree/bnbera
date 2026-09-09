/** Finalized ERC-8004 + safe public metadata fallback for submitting providers.
 * No vendor detail dependency, task invocation, database write, or signer. */
import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, http, parseAbi } from "viem";
import { BoundedMetadataResolver } from "../packages/agent-ingestion/src/metadata.ts";
import { publicHttpsUrl, publicRecord, publicText } from "../packages/agent-ingestion/src/directory.ts";
import { verifyDirectoryService } from "../packages/agent-ingestion/src/directory-verification.ts";
import { createExternalSellerTransport } from "../apps/web/src/lib/external-seller-transport.ts";
const dir = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
async function main() {
  if (process.env.MAINNET_DIRECT_AUDIT_ENABLED !== "true") return;
  const source = JSON.parse(await readFile(new URL("candidate-audit.json", dir), "utf8"));
  const history = JSON.parse(await readFile(new URL("provider-history-v2.json", dir), "utf8"));
  const wanted = new Set<string>(history.providers.flatMap((provider: {agentIds: string[]}) => provider.agentIds));
  const selectedIds = process.env.MAINNET_DIRECT_AGENT_IDS?.split(",");
  if (selectedIds && (selectedIds.length > 100 || selectedIds.some(id => !/^\d+$/u.test(id)))) throw new Error("INVALID_IDENTITY_SET");
  const candidates = selectedIds ? selectedIds.map(agentId => source.candidates.find((candidate: {agentId: string}) => candidate.agentId === agentId) ?? {agentId, name: `Agent ${agentId}`})
    : source.candidates.filter((candidate: {agentId: string}) => wanted.has(candidate.agentId)).slice(0, 100);
  const client = createPublicClient({transport: http(process.env.BSC_MAINNET_RPC_URL, {timeout: 15000, retryCount: 1})});
  if (await client.getChainId() !== 56) throw new Error("CHAIN_MISMATCH");
  const address = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
  const abi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getAgentWallet(uint256) view returns(address)", "function tokenURI(uint256) view returns(string)"]);
  const resolver = new BoundedMetadataResolver({timeoutMs: 8000, maxBytes: 1024 * 1024});
  const results: Record<string, unknown>[] = [];
  try { results.push(...JSON.parse(await readFile(new URL("direct-identity-audit.json", dir), "utf8")).results); } catch { /* First pass. */ }
  for (const candidate of candidates) {
    const row: Record<string, unknown> = {agentId: candidate.agentId, name: candidate.name, checkedAt: new Date().toISOString(), hireable: false};
    try {
      const block = await client.getBlock({blockTag: "finalized"});
      const [owner, wallet, uri] = await Promise.all([
        client.readContract({address, abi, functionName: "ownerOf", args: [BigInt(candidate.agentId)], blockNumber: block.number}),
        client.readContract({address, abi, functionName: "getAgentWallet", args: [BigInt(candidate.agentId)], blockNumber: block.number}),
        client.readContract({address, abi, functionName: "tokenURI", args: [BigInt(candidate.agentId)], blockNumber: block.number}),
      ]);
      row.identity = {namespace: "eip155", chainId: 56, identityRegistry: address, agentId: candidate.agentId};
      row.finalizedIdentity = {owner, agentWallet: wallet, blockNumber: block.number.toString()};
      const registration = publicRecord((await resolver.resolve(uri, null)).document);
      row.registrationName = publicText(registration.name, 160);
      if (row.registrationName) row.name = row.registrationName;
      const rawServices = Array.isArray(registration.services) ? registration.services : Array.isArray(registration.endpoints) ? registration.endpoints : [];
      const services = rawServices.flatMap(item => {
        const service = publicRecord(item); const name = publicText(service.name, 64); const url = publicHttpsUrl(service.endpoint ?? service.url);
        return name && url && /^(a2a|mcp)$/iu.test(name) ? [{name, url, version: publicText(service.version, 64)}] : [];
      });
      const checks = []; const cards = [];
      for (const service of services) {
        checks.push(await verifyDirectoryService(service));
        if (service.name.toLowerCase() !== "a2a") continue;
        try {
          const card = publicRecord((await createExternalSellerTransport().get(service.url)).body);
          cards.push({url: service.url, name: publicText(card.name, 160), invocationUrl: publicHttpsUrl(card.url), skills: Array.isArray(card.skills) ? card.skills.slice(0, 32).map(skill => ({id: publicText(publicRecord(skill).id, 160), name: publicText(publicRecord(skill).name, 160)})) : []});
        } catch { cards.push({url: service.url, status: "CARD_UNAVAILABLE"}); }
      }
      row.detail = {status: "completed", checkedAt: new Date().toISOString(), source: "finalized-tokenURI", services, checks, cards, protocolVerified: checks.some(check => check.status === "verified"), hireable: false};
    } catch (error) {row.status = "UNAVAILABLE"; const code = publicRecord(error).code; row.reason = typeof code === "string" && /^[A-Z_]+$/u.test(code) ? code : "IDENTITY_OR_METADATA_UNAVAILABLE";}
    const previous = results.findIndex(result => result.agentId === row.agentId);
    if (previous >= 0) results[previous] = row; else results.push(row);
    await writeFile(new URL("direct-identity-audit.json", dir), JSON.stringify({observedAt: new Date().toISOString(), results, chainWrites: false}, null, 2), {mode: 0o600});
    console.log(JSON.stringify({agentId: candidate.agentId, status: row.status ?? "REVIEWED", protocolVerified: publicRecord(row.detail).protocolVerified}));
  }
}
main().catch(() => {console.error("DIRECT_IDENTITY_AUDIT_FAILED"); process.exitCode = 1;});
