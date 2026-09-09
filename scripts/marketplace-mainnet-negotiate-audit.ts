/** Obtain public seller terms only. No funded-job notification or chain write. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolveSafePublicNetworkTarget } from "../packages/agent-ingestion/src/metadata.ts";
import { publicRecord, publicText } from "../packages/agent-ingestion/src/directory.ts";
import { createPublicClient, http, getAddress, keccak256, toBytes, recoverMessageAddress, parseAbi, type Hex } from "viem";
import { assertSafePublicValue } from "../packages/agent-ingestion/src/normalize.ts";

// Matches the public SDK's canonical description/EIP-191 format at
// bnb-chain/bnbagent-sdk@bab27109237d509c780a36cf831dcfce70aabafe.
function canonical(value: unknown): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(publicRecord(value)[key])])) : value;
  return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
const sanitize = (value: unknown) => typeof value === "string" ? value.replaceAll("[", "(").replaceAll("]", ")").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "") : "";

const directory = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
const output = new URL("negotiation-audit.json", directory);
async function main() {
  if (process.env.MAINNET_NEGOTIATION_AUDIT_ENABLED !== "true") return;
  const audit = JSON.parse(await readFile(new URL("candidate-audit.json", directory), "utf8"));
  try {
    const direct = JSON.parse(await readFile(new URL("direct-identity-audit.json", directory), "utf8"));
    for (const row of direct.results.filter((row: {detail?: {status?: string}}) => row.detail?.status === "completed")) {
      const index = audit.candidates.findIndex((candidate: {agentId: string}) => candidate.agentId === row.agentId);
      if (index >= 0) audit.candidates[index] = {...audit.candidates[index], ...row}; else audit.candidates.push(row);
    }
  } catch { /* Direct identity fallback has not run. */ }
  const chain = createPublicClient({ transport: http(process.env.BSC_MAINNET_RPC_URL, { timeout: 15000, retryCount: 1 }) });
  if (await chain.getChainId() !== 56) throw new Error("CHAIN_MISMATCH");
  const registry = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
  const registryAbi = parseAbi(["function ownerOf(uint256) view returns(address)", "function getAgentWallet(uint256) view returns(address)"]);
  const results: Record<string, unknown>[] = [];
  try { results.push(...JSON.parse(await readFile(output, "utf8"))); } catch { /* First run. */ }
  let attempted = 0;
  const selectedIds = process.env.MAINNET_NEGOTIATION_AGENT_IDS?.split(",");
  if (selectedIds && (selectedIds.length > 60 || selectedIds.some(id => !/^\d+$/u.test(id)))) throw new Error("INVALID_IDENTITY_SET");
  const requestedTask = process.env.MAINNET_NEGOTIATION_TASK ?? "Provide a read-only report using your advertised service and public BSC mainnet data. No trades, token approvals, deposits, withdrawals or strategy transactions. This request asks only for your available task, exact price and ERC-8183 settlement terms; do not execute work or create an on-chain job.";
  if (requestedTask.length > 1600 || !requestedTask.trim()) throw new Error("INVALID_TASK_DESCRIPTION");
  const requestedTerms = {deliverables: process.env.MAINNET_NEGOTIATION_DELIVERABLES ?? "A useful read-only report with timestamped public sources and limitations", quality_standards: process.env.MAINNET_NEGOTIATION_QUALITY ?? "No strategy transaction or wallet authority; return exact provider, chain, payment-token and commerce-contract terms."};
  if (Object.values(requestedTerms).some(value => value.length > 1200 || !value.trim())) throw new Error("INVALID_TASK_TERMS");
  for (const candidate of audit.candidates) {
    if (selectedIds && !selectedIds.includes(candidate.agentId)) continue;
    if (attempted >= 60) break;
    if (process.env.MAINNET_NEGOTIATION_REFRESH !== "true" && results.some(result => result.agentId === candidate.agentId && result.signatureAudit !== undefined)) continue;
    const card = candidate.detail?.cards?.find((card: { invocationUrl?: string; skills?: { id: string }[] }) => card.invocationUrl && card.skills?.some(skill => skill.id === "negotiate"));
    if (!card) continue;
    attempted++;
    const result: Record<string, unknown> = { agentId: candidate.agentId, name: candidate.name, endpoint: card.invocationUrl, checkedAt: new Date().toISOString() };
    try {
      const target = await resolveSafePublicNetworkTarget(card.invocationUrl);
      if (target.url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
      const id = randomUUID();
      const response = await fetch(target.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "message/send", params: { message: { messageId: randomUUID(), role: "user", parts: [{ kind: "data", data: { skill: "negotiate", task_description: requestedTask, terms: requestedTerms } }] } } }) });
      result.httpStatus = response.status;
      const after = await resolveSafePublicNetworkTarget(card.invocationUrl);
      if (JSON.stringify([...target.addresses].sort()) !== JSON.stringify([...after.addresses].sort())) throw new Error("DNS_CHANGED");
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) { try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 65536) throw new Error("RESPONSE_TOO_LARGE"); chunks.push(next.value); } } finally { await reader.cancel(); } }
      const body = publicRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (body.jsonrpc !== "2.0" || body.id !== id) throw new Error("RESPONSE_ID_INVALID");
      const terms: { path: string; value: string | number | boolean }[] = [];
      const visit = (value: unknown, path = "response", depth = 0) => {
        if (depth > 12 || terms.length >= 64) return;
        if (Array.isArray(value)) { value.slice(0, 32).forEach((item, index) => visit(item, `${path}.${index}`, depth + 1)); return; }
        for (const [key, item] of Object.entries(publicRecord(value))) {
          if (/private|secret|password|authorization|credential|api.?key/iu.test(key)) continue;
          if (/^(price|amount|currency|chain_id|chainId|network|payment_token|paymentToken|commerce_contract|commerceContract|provider_address|providerAddress|provider|payTo|protocol|status|code|message)$/u.test(key) && ["string", "number", "boolean"].includes(typeof item)) {
            const safe = typeof item === "string" ? publicText(item, 300) : item;
            if (safe !== null) terms.push({ path: `${path}.${key}`, value: safe as string | number | boolean });
          }
          if (key === "text" && typeof item === "string") { try { visit(JSON.parse(item), `${path}.text`, depth + 1); } catch { /* Never export unstructured remote text. */ } }
          if (typeof item === "object") visit(item, `${path}.${key}`, depth + 1);
        }
      };
      visit(body); result.status = body.error ? "SELLER_DECLINED" : "TERMS_RETURNED"; result.terms = terms;
      const rpcResult = publicRecord(body.result);
      const envelope = Array.isArray(rpcResult.parts) ? publicRecord(rpcResult.parts.map(part => publicRecord(part).data).find(data => publicRecord(data).negotiation_hash)) : rpcResult;
      const sellerResponse = publicRecord(envelope.response); const sellerRequest = publicRecord(envelope.request); const sellerTerms = publicRecord(sellerResponse.terms);
      result.signatureAudit = { status: "SIGNED_QUOTE_UNAVAILABLE" };
      if (envelope.negotiation_hash && envelope.provider_sig && sellerResponse.accepted === true) {
        const content = { version: 1, negotiated_at: sellerResponse.negotiated_at, quote_expires_at: sellerResponse.quote_expires_at,
          task: sanitize(sellerRequest.task_description), terms: { deliverables: sanitize(sellerTerms.deliverables), quality_standards: sanitize(sellerTerms.quality_standards),
            ...(Array.isArray(sellerTerms.success_criteria) && sellerTerms.success_criteria.length ? { success_criteria: sellerTerms.success_criteria.map(sanitize) } : {}) },
          price: sellerTerms.price, currency: sellerTerms.currency, chain_id: envelope.chain_id, verifying_contract: getAddress(String(envelope.verifying_contract)) };
        assertSafePublicValue(content);
        const digest = keccak256(toBytes(canonical(content)));
        const hashMatches = digest === envelope.negotiation_hash;
        const recovered = await recoverMessageAddress({ message: String(envelope.negotiation_hash), signature: String(envelope.provider_sig) as Hex });
        const block = await chain.getBlock({ blockTag: "finalized" });
        const [owner, wallet] = await Promise.all([
          chain.readContract({ address: registry, abi: registryAbi, functionName: "ownerOf", args: [BigInt(candidate.agentId)], blockNumber: block.number }),
          chain.readContract({ address: registry, abi: registryAbi, functionName: "getAgentWallet", args: [BigInt(candidate.agentId)], blockNumber: block.number })
        ]);
        const matchesWallet = recovered.toLowerCase() === wallet.toLowerCase();
        const matchesOwner = recovered.toLowerCase() === owner.toLowerCase();
        result.signatureAudit = { status: hashMatches && matchesWallet ? "VERIFIED_AGENT_WALLET_QUOTE" : "BINDING_MISMATCH", hashMatches, recovered, agentWallet: wallet, owner,
          matchesWallet, matchesOwner, finalizedBlock: String(block.number), chainId: envelope.chain_id, verifyingContract: envelope.verifying_contract,
          currency: sellerTerms.currency, priceAtomic: sellerTerms.price, quoteExpiresAt: sellerResponse.quote_expires_at,
          negotiationHash: envelope.negotiation_hash, providerSignature: envelope.provider_sig, signedContent: content };
      }
    } catch (error) { const message = publicRecord(error).message; result.status = "UNAVAILABLE"; result.reason = typeof message === "string" && /^[A-Z_]+$/u.test(message) ? message : "NEGOTIATION_UNAVAILABLE"; }
    const previous = results.findIndex(row => row.agentId === candidate.agentId);
    if (previous >= 0) results[previous] = result; else results.push(result);
    await writeFile(output, JSON.stringify(results, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ agentId: result.agentId, name: result.name, status: result.status, terms: result.terms, signatureAudit: publicRecord(result.signatureAudit).status }));
  }
  console.log(JSON.stringify({ status: "completed", negotiations: results.length, evidence: output.pathname }));
}
main().catch(() => { console.log(JSON.stringify({ status: "AUDIT_FAILED" })); process.exitCode = 1; });
