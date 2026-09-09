/** Read-only mainnet supply scan. Keeps a resumable public candidate audit apart
 * from the 100-profile directory. Never signs, invokes tools, or buys work. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { EightHundredFourScanHttpClient, type EightHundredFourScanQuery } from "../packages/agent-ingestion/src/adapters/8004scan.ts";
import { normalizeDirectorySnapshot, publicRecord, publicText, publicHttpsUrl } from "../packages/agent-ingestion/src/directory.ts";
import { verifyDirectoryService } from "../packages/agent-ingestion/src/directory-verification.ts";
import { createExternalSellerTransport } from "../apps/web/src/lib/external-seller-transport.ts";
import { selectPendingCandidates } from "./mainnet-audit-selection.ts";

const auditDirectory = new URL("../.runtime/mainnet-supply-upgrade/", import.meta.url);
const auditFile = new URL("candidate-audit.json", auditDirectory);
const maxDetails = Math.min(250, Math.max(1, Number(process.env.MAINNET_AUDIT_MAX_DETAILS ?? 100)));
const log = (value: unknown) => console.log(JSON.stringify(value));
const errorCode = (error: unknown) => publicText(publicRecord(error).code, 64) ?? "SOURCE_UNAVAILABLE";
type Candidate = { agentId: string; name: string; owner: string | null; protocols: string[]; score: number | null; x402Advertised: boolean; sources: string[]; detail?: Record<string, unknown> };
type Audit = { startedAt: string; updatedAt: string; pages: Record<string, unknown>[]; candidates: Candidate[] };

async function main() {
  if (process.env.MAINNET_SUPPLY_AUDIT_ENABLED !== "true") { log({ status: "disabled" }); return; }
  if (!Number.isSafeInteger(maxDetails)) throw new Error("INVALID_AUDIT_CAP");
  await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
  let audit: Audit = { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pages: [], candidates: [] };
  try { audit = JSON.parse(await readFile(auditFile, "utf8")); } catch { /* First bounded scan. */ }
  const save = async () => { audit.updatedAt = new Date().toISOString(); await writeFile(auditFile, JSON.stringify(audit, null, 2), { mode: 0o600 }); };
  const client = EightHundredFourScanHttpClient.fromEnvironment(process.env, { timeoutMs: 20000, maxRetries: 1, minRequestIntervalMs: 2200, maxResponseBytes: 8 * 1024 * 1024 });
  const registry = "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
  const queries: EightHundredFourScanQuery[] = [
    ...["quality_score", "total_score", "activity_score", "total_feedbacks"].flatMap(sortBy => [0, 100].map(offset => ({ sortBy: sortBy as EightHundredFourScanQuery["sortBy"], offset }))),
    ...["ERC8183", "ERC-8183", "negotiate", "APEX", "escrow", "x402"].map(search => ({ search, sortBy: "total_score" as const })),
    ...["MCP", "A2A"].map(supportedProtocol => ({ supportedProtocol, sortBy: "quality_score" as const }))
  ];
  if (process.env.MAINNET_AUDIT_EXPANDED_DISCOVERY === "true") queries.push(
    ...["quality_score", "activity_score", "total_feedbacks"].flatMap(sortBy => [200, 300, 400].map(offset => ({ sortBy: sortBy as EightHundredFourScanQuery["sortBy"], offset }))),
    ...[0, 100, 200].map(offset => ({ sortBy: "created_at" as const, offset })),
    ...["RangeReset", "health factor", "yield", "rebalanc", "grid", "monitor", "ERC8183"].map(search => ({ search, sortBy: "activity_score" as const })),
    ...[100, 200, 300].map(offset => ({ supportedProtocol: "A2A", sortBy: "quality_score" as const, offset })),
  );
  if (process.env.MAINNET_AUDIT_PROVIDER_DISCOVERY === "true") {
    const history = JSON.parse(await readFile(new URL("provider-history-v2.json", auditDirectory), "utf8"));
    const resultAudit = JSON.parse(await readFile(new URL("provider-result-audit-v2.json", auditDirectory), "utf8"));
    const withResult = new Set(resultAudit.results.filter((row: {resultStatus?: string}) => row.resultStatus === "HASH_VERIFIED_MANIFEST").map((row: {providerAddress: string}) => row.providerAddress.toLowerCase()));
    const providers = history.providers.filter((provider: {agentIds: string[]}) => provider.agentIds.length === 0)
      .sort((a: {provider: string}, b: {provider: string}) => Number(withResult.has(b.provider)) - Number(withResult.has(a.provider))).slice(0, 30);
    queries.splice(0, queries.length, ...providers.map((provider: {provider: string}) => ({search: provider.provider, sortBy: "activity_score" as const})));
  }
  if (process.env.MAINNET_AUDIT_SEARCH) {
    if (process.env.MAINNET_AUDIT_SEARCH.length > 200) throw new Error("INVALID_SEARCH");
    queries.splice(0, queries.length, {search: process.env.MAINNET_AUDIT_SEARCH, sortBy: "activity_score"});
  }
  if (process.env.MAINNET_AUDIT_INCLUDE_INACTIVE === "true") for (let index = 0; index < queries.length; index++) queries[index] = {...queries[index], isActive: "any"};
  let sourceLimited = false;
  for (const query of queries) {
    const key = JSON.stringify(query);
    if (audit.pages.some(page => page.key === key && page.status === "completed")) continue;
    try {
      const page = await client.listCandidates({ chainId: 56, isTestnet: false, limit: 100, sortOrder: "desc", ...query });
      for (const raw of page.items) {
        const row = publicRecord(raw); const agentId = String(row.token_id);
        if (row.chain_id !== 56 || String(row.contract_address).toLowerCase() !== registry || !/^\d+$/u.test(agentId)) continue;
        const existing = audit.candidates.find(candidate => candidate.agentId === agentId);
        if (existing) { if (!existing.sources.includes(key)) existing.sources.push(key); continue; }
        audit.candidates.push({ agentId, name: publicText(row.name, 160) ?? `Agent ${agentId}`,
          owner: typeof row.owner_address === "string" && /^0x[\da-f]{40}$/iu.test(row.owner_address) ? row.owner_address.toLowerCase() : null,
          protocols: Array.isArray(row.supported_protocols) ? row.supported_protocols.flatMap(value => publicText(value, 128) ?? []) : [],
          score: typeof row.total_score === "number" ? row.total_score : null, x402Advertised: row.x402_supported === true, sources: [key] });
      }
      audit.pages.push({ key, status: "completed", total: page.total, returned: page.items.length, checkedAt: new Date().toISOString() });
      await save(); log({ stage: "scan", query, total: page.total, returned: page.items.length, uniqueCandidates: audit.candidates.length });
    } catch (error) { audit.pages.push({ key, status: "failed", reason: errorCode(error) }); await save(); log({ stage: "scan", query, reason: errorCode(error) }); if (["SCAN_RATE_LIMITED", "SCAN_CIRCUIT_OPEN"].includes(errorCode(error))) { sourceLimited = true; break; } }
  }
  const priority = (candidate: Candidate) => (/ERC.?8183|negotiate|escrow/iu.test(candidate.sources.join(" ")) ? 1000 : 0) + (candidate.protocols.some(p => /a2a|mcp/iu.test(p)) ? 200 : 0) + (candidate.x402Advertised ? 100 : 0) + (candidate.score ?? 0);
  const selected = selectPendingCandidates(audit.candidates, maxDetails, priority);
  const cache = new Map<string, ReturnType<typeof verifyDirectoryService>>();
  for (const candidate of selected) {
    if (sourceLimited) break;
    if (candidate.detail?.status === "completed") continue;
    try {
      const identity = { namespace: "eip155", chainId: 56, identityRegistry: registry, agentId: candidate.agentId };
      const raw = publicRecord(await client.getCandidateByIdentity(identity));
      if (raw.chain_id !== 56 || String(raw.token_id) !== candidate.agentId || String(raw.contract_address).toLowerCase() !== registry) throw new Error("IDENTITY_MISMATCH");
      const snapshot = normalizeDirectorySnapshot(raw, null);
      const interfaces = snapshot.services.filter(service => /^(a2a|mcp)$/iu.test(service.name));
      const checks = [];
      for (const service of interfaces) {
        const key = JSON.stringify(service); let pending = cache.get(key);
        if (!pending) { pending = verifyDirectoryService(service); cache.set(key, pending); }
        checks.push(await pending);
      }
      const terms: { path: string; value: string | number | boolean }[] = [];
      const inspect = (value: unknown, path = "vendor", depth = 0) => {
        if (depth > 12 || terms.length >= 64) return;
        if (Array.isArray(value)) { value.slice(0, 64).forEach((item, index) => inspect(item, `${path}.${index}`, depth + 1)); return; }
        for (const [key, item] of Object.entries(publicRecord(value))) {
          if (/private|secret|password|authorization|credential|api.?key/iu.test(key)) continue;
          if (/^(price|amount|currency|chain_id|chainId|network|payment_token|commerce_contract|commerceContract|provider_address|providerAddress|payTo|x402_supported|paymentMethods|payment_method|protocol)$/u.test(key) && ["string", "number", "boolean"].includes(typeof item)) {
            const safe = typeof item === "string" ? publicText(item, 256) : item;
            if (safe !== null) terms.push({ path: `${path}.${key}`, value: safe as string | number | boolean });
          }
          if (typeof item === "object") inspect(item, `${path}.${key}`, depth + 1);
        }
      };
      inspect(raw);
      const cards = [];
      for (const service of interfaces.filter(service => service.name.toLowerCase() === "a2a")) {
        try {
          const card = publicRecord((await createExternalSellerTransport().get(service.url)).body); inspect(card, "agentCard");
          cards.push({ url: service.url, name: publicText(card.name, 160), invocationUrl: publicHttpsUrl(card.url), skills: Array.isArray(card.skills) ? card.skills.slice(0, 32).map(skill => ({ id: publicText(publicRecord(skill).id, 160), name: publicText(publicRecord(skill).name, 160) })) : [] });
        } catch { cards.push({ url: service.url, status: "CARD_TERMS_UNAVAILABLE" }); }
      }
      candidate.detail = { status: "completed", checkedAt: new Date().toISOString(), sourceUrl: snapshot.sourceUrl, services: snapshot.services, checks, cards, terms,
        protocolVerified: checks.some(check => check.status === "verified"), hireable: false,
        blockers: ["MAINNET_COMMERCE_RELEASE_PENDING", ...(!terms.some(term => /price|amount/u.test(term.path)) ? ["ACTIONABLE_PRICE_MISSING"] : []), "PROVIDER_SETTLEMENT_BINDING_UNVERIFIED", "TASK_EXECUTION_NOT_INVOKED"] };
      await save(); log({ stage: "candidate", agentId: candidate.agentId, name: candidate.name, verified: checks.filter(check => check.status === "verified").map(check => check.protocol), terms: terms.length, blockers: candidate.detail.blockers });
    } catch (error) { candidate.detail = { status: "failed", reason: errorCode(error) }; await save(); log({ stage: "candidate", agentId: candidate.agentId, reason: errorCode(error) }); if (["SCAN_RATE_LIMITED", "SCAN_CIRCUIT_OPEN"].includes(errorCode(error))) { sourceLimited = true; break; } }
  }
  log({ status: sourceLimited ? "source-rate-limited" : "completed", uniqueCandidates: audit.candidates.length, details: audit.candidates.filter(candidate => candidate.detail?.status === "completed").length,
    protocolVerified: audit.candidates.filter(candidate => candidate.detail?.protocolVerified === true).length, hireable: 0, evidence: auditFile.pathname });
}
main().catch(error => { log({ status: "failed", reason: errorCode(error) }); process.exitCode = 1; });
