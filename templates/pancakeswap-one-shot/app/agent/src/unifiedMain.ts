import express from "express";

/* Fixed, callable A2A-compatible surface. No free-form code, pricing, or
 * trading parameters are accepted from a request. The actual swap remains
 * behind the T6 authority gate and is never signed by this HTTP handler. */
const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/ping", (_request, response) => response.status(200).json({ status: "healthy", template: "pancakeswap-one-shot" }));
app.get("/.well-known/agent-card.json", (_request, response) => response.json({ name: "BNBEra bounded one-shot swap", description: "One bounded PancakeSwap V2 tBNB to CAKE swap; not a grid strategy.", url: process.env.AGENTCORE_RUNTIME_URL ?? "", version: "1.0.0", protocolVersion: "0.3.0", capabilities: {}, skills: [{ id: "get_bounded_swap_plan", name: "Get bounded one-shot swap plan", description: "Returns fixed plan constraints only; it does not verify funding or execute a swap.", tags: ["pancakeswap", "one-shot", "plan"], inputModes: ["application/json"], outputModes: ["application/json"] }] }));
const taskSchema = (value: unknown): { action: "quote_plan" } | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || input.action !== "quote_plan") return null;
  return { action: "quote_plan" };
};

/**
 * The deployed artifact cannot safely import the server-only authoritative
 * Builder. It returns plan constraints only: no job is claimed funded, no
 * quote/calldata is produced, and no swap is completed or signed here.
 */
app.post("/", (request, response) => {
  const task = taskSchema(request.body);
  if (task === null) return response.status(400).json({ code: "INVALID_BOUNDED_SWAP_PLAN_REQUEST", message: "Submit exactly { action: 'quote_plan' }." });
  return response.status(200).json({
    status: "plan_only_not_funded_or_executed",
    executionPlan: {
      builder: "bnbera-creator-authoritative-builder",
      chainId: 97,
      action: "swapExactETHForTokens",
      fixedInputWei: "1000000000000000",
      maxSlippageBps: 50,
      maxQuoteAgeSeconds: 60,
      maxDeadlineSeconds: 120,
      requires: ["confirmed_erc8183_job", "active_t6_authority", "fresh_onchain_quote", "user_owned_session_wallet"]
    }
  });
});
app.listen(Number(process.env.PORT ?? 9000), "0.0.0.0");
