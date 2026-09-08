import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/* Bounded A2A surface. No free-form code, pricing, or request-supplied trade
 * parameters are accepted. The public configuration is server-derived from a
 * persisted audited draft; this handler never signs or executes a swap. */
type PublicConfig = { tradingPair: "tbnb-cake" | "tbnb-busd"; inputAmountWei: "100000000000000" | "500000000000000" | "1000000000000000"; slippageBps: 10 | 25 | 50; quoteMaxAgeSeconds: 30 | 60; deadlineSeconds: 60 | 120 };
function publicConfig(): PublicConfig {
  try {
    const artifact = JSON.parse(readFileSync(join(process.cwd(), "bnbera-public-config.json"), "utf8")) as { configuration?: unknown; configurationDigest?: unknown };
    const value = artifact.configuration as Record<string, unknown>;
    if (typeof artifact.configurationDigest !== "string" || !/^[0-9a-f]{64}$/.test(artifact.configurationDigest)) throw new Error("invalid digest");
    if (Object.keys(value).length !== 6 || value.protocol !== "pancakeswap-v2" || !["tbnb-cake", "tbnb-busd"].includes(String(value.tradingPair)) || !["100000000000000", "500000000000000", "1000000000000000"].includes(String(value.inputAmountWei)) || ![10, 25, 50].includes(Number(value.slippageBps)) || ![30, 60].includes(Number(value.quoteMaxAgeSeconds)) || ![60, 120].includes(Number(value.deadlineSeconds))) throw new Error("invalid");
    const canonical = { protocol: value.protocol, tradingPair: value.tradingPair, inputAmountWei: value.inputAmountWei, slippageBps: value.slippageBps, quoteMaxAgeSeconds: value.quoteMaxAgeSeconds, deadlineSeconds: value.deadlineSeconds };
    if (createHash("sha256").update(JSON.stringify(canonical)).digest("hex") !== artifact.configurationDigest) throw new Error("digest mismatch");
    return value as PublicConfig;
  } catch { throw new Error("Invalid Creator public configuration; refusing runtime start."); }
}
const configuration = publicConfig();
const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/ping", (_request, response) => response.status(200).json({ status: "healthy", template: "pancakeswap-one-shot", version: "1.1.0" }));
app.get("/.well-known/agent-card.json", (_request, response) => response.json({ name: `BNBEra bounded ${configuration.tradingPair} one-shot swap`, description: "One bounded PancakeSwap V2 native tBNB swap over a curated pair; not a grid strategy.", url: process.env.AGENTCORE_RUNTIME_URL ?? "", version: "1.1.0", protocolVersion: "0.3.0", capabilities: {}, skills: [{ id: "get_bounded_swap_plan", name: "Get bounded one-shot swap plan", description: "Returns the persisted bounded plan only; it does not verify funding or execute a swap.", tags: ["pancakeswap", "one-shot", "plan"], inputModes: ["application/json"], outputModes: ["application/json"] }] }));
const taskSchema = (value: unknown): { action: "quote_plan" } | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && input.action === "quote_plan" ? { action: "quote_plan" } : null;
};
app.post("/", (request, response) => {
  if (taskSchema(request.body) === null) return response.status(400).json({ code: "INVALID_BOUNDED_SWAP_PLAN_REQUEST", message: "Submit exactly { action: 'quote_plan' }." });
  return response.status(200).json({ status: "plan_only_not_funded_or_executed", executionPlan: { builder: "bnbera-creator-authoritative-builder", chainId: 97, action: "swapExactETHForTokens", ...configuration, nativeInput: true, recipient: "derived-user-session-wallet", requires: ["confirmed_erc8183_job", "active_t6_authority", "fresh_onchain_quote", "user_owned_session_wallet"] } });
});
app.listen(Number(process.env.PORT ?? 9000), "0.0.0.0");
