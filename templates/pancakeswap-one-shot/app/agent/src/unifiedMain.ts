import express from "express";

/* Fixed, callable A2A-compatible surface. No free-form code, pricing, or
 * trading parameters are accepted from a request. The actual swap remains
 * behind the T6 authority gate and is not performed by this HTTP handler. */
const app = express();
app.use(express.json({ limit: "16kb" }));
app.get("/ping", (_request, response) => response.status(200).json({ status: "healthy", template: "pancakeswap-one-shot" }));
app.get("/.well-known/agent-card.json", (_request, response) => response.json({ name: "BNBEra bounded one-shot swap", description: "One bounded PancakeSwap V2 tBNB to CAKE swap; not a grid strategy.", url: process.env.AGENTCORE_RUNTIME_URL ?? "", version: "1.0.0", protocolVersion: "0.3.0", capabilities: {}, skills: [{ id: "execute_bounded_swap", name: "Execute bounded one-shot swap", description: "Requires an active user-controlled authority and confirmed ERC-8183 job.", tags: ["pancakeswap", "one-shot", "erc8183"], inputModes: ["application/json"], outputModes: ["application/json"] }] }));
app.post("/", (_request, response) => response.status(503).json({ code: "AUTHORITY_REQUIRED", message: "The bounded swap execution is available only through a confirmed ERC-8183 job and active T6 authority." }));
app.listen(Number(process.env.PORT ?? 9000), "0.0.0.0");
