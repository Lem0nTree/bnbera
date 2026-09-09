/** Reviewed public service bindings, not runtime availability or payment authority.
 * Evidence: docs/MAINNET-SUPPLY-REVIEW.md and immutable September 9 audits.
 * Every quote rechecks the finalized wallet, registered card and signed terms. */
export type MainnetSellerProfile = {
  agentId: string; wallet: string; card: string; endpoint: string;
  exampleTask: string; deliverables: string; qualityStandards: string;
  historicalJobId: string | null; inputKind: "text" | "json" | "grid_v1" | "loan_v1";
};
const generic = {
  deliverables: "A useful read-only report with timestamped public sources and limitations",
  qualityStandards: "No strategy transaction or wallet authority; return exact provider, chain, payment-token and commerce-contract terms."
};
const row = (agentId: string, wallet: string, endpoint: string, exampleTask: string, historicalJobId: string | null, inputKind: MainnetSellerProfile["inputKind"] = "text"): MainnetSellerProfile => ({
  agentId, wallet, endpoint, card: `${endpoint}.well-known/agent-card.json`, exampleTask, historicalJobId, inputKind, ...generic
});
export const mainnetSellerProfiles: readonly MainnetSellerProfile[] = [
  { ...row("303779", "0xA2a2012e52Fd075c0F3146e37E833E7294ee52B5", "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/grid/a2a", 'GRID_PLAN_V1:{"capital":"1000","gridCount":9,"lowerPrice":"700","pair":"BNB/USDT","upperPrice":"900"}', "56720", "grid_v1"),
    card: "https://bnb-agent-marketplace-ruby.vercel.app/grid/.well-known/agent-card.json", deliverables: "Deterministic Grid plan JSON with levels, allocation, triggers and assumptions", qualityStandards: "Deterministic output, no order execution and no custody" },
  { ...row("341565", "0x3230768BD8EC81C1764974CF813a7EBc248CdaFf", "https://bnb-agent-marketplace-ruby.vercel.app/api/sellers/loan-health/a2a", 'LOAN_HEALTH_V1:{"alertLevels":"1.5,1.25,1.1","collateral":"BNB:10@600:80,ETH:1@3000:82.5","debt":"USDT:3000@1","targetHealthFactor":"1.5"}', "56756", "loan_v1"),
    card: "https://bnb-agent-marketplace-ruby.vercel.app/loan-health/.well-known/agent-card.json", deliverables: "Deterministic loan health report JSON with health factor, liquidation prices, distance to each alert level, repay and top-up amounts, and assumptions", qualityStandards: "Deterministic output, no transactions, no monitoring service and no custody" },
  row("269223", "0x72070fAa1e33D7F8b31397Bc8DA65be2b1f6281f", "https://agents.chainhelix.io/rebalancer/", '{"holdings":{"BTC":0.4,"ETH":6,"BNB":12},"targets":{"BTC":0.4,"ETH":0.35,"BNB":0.25},"prices":{"BTC":68000,"ETH":2100,"BNB":620},"driftThresholdPct":1,"minTradeUsd":5}', "56615", "json"),
  row("269224", "0xB8143345687aA5A527f4f9568D508EBbC612d06D", "https://agents.chainhelix.io/gridtrader/", '{"budgetUsd":1000,"levels":5,"price":750,"spanPct":2}', "56743", "json"),
  row("269226", "0xcCAe2DA18278C663Fc808fa858FD89CC34cf701f", "https://agents.chainhelix.io/yieldopt/", '{"pools":{"sample-pool":{"apyPct":6,"tvlUsd":1000000,"riskScore":2}},"capitalUsd":1000,"maxPerPoolPct":40}', null, "json"),
  row("269228", "0x91F4602760e1627007BFc16F78A74cF8B9De8Da2", "https://agents.chainhelix.io/healthmon/", '{"collateral":{"ETH":{"amount":10,"liqThreshold":0.8}},"debt":{"USDT":10000},"prices":{"ETH":2000,"USDT":1}}', "56734", "json"),
  row("265375", "0x20f1cA5d1e5A3Ee94C29DbF95e6BF6ceA6a8d64b", "https://bnb-lp.172-104-171-139.nip.io/", "Report the current public status of your managed PancakeSwap V3 BNB/USDT position: price, range, utilization, TVL and fees. Include block, timestamp and limitations. Do not rebalance, trade or move funds.", "56591"),
  row("269233", "0xFAf0ffd121947B9EE3920Fa0CfbF9EEEB0AcBF7f", "https://bnb-grid.172-104-171-139.nip.io/", "Compute a 9-level BNB/USDT grid plan for 200 USDT hypothetical capital. Return levels, spacing and size; do not place orders or move funds.", "56633"),
  row("270213", "0x08Cef8B3ec5D33529dFe6700ccbFfc97158Cb5dd", "https://explainer-agent.onrender.com/", "Explain ERC-8004 identity and ERC-8183 escrow hiring in plain English, including limitations and risks. Do not execute transactions.", "56646"),
  row("341225", "0xCE6f9c8360c522985DA487E303C3692A7362df48", "https://tanned-retriever-swimsuit.ngrok-free.dev/", "Provide a read-only comparison of public BSC yield opportunities, including capacity, source timestamps and risk limitations. Do not deposit, withdraw, trade or request wallet authority.", null)
];

export function mainnetSellerProfile(identity: { namespace: string; chainId: number; identityRegistry: string; agentId: string }): MainnetSellerProfile | undefined {
  if (identity.namespace !== "eip155" || identity.chainId !== 56 || identity.identityRegistry.toLowerCase() !== "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432") return undefined;
  return mainnetSellerProfiles.find(profile => profile.agentId === identity.agentId);
}

export function mainnetSellerTask(profile: MainnetSellerProfile, task: string) {
  const prefix = profile.inputKind === "grid_v1" ? "GRID_PLAN_V1:" : profile.inputKind === "loan_v1" ? "LOAN_HEALTH_V1:" : "";
  if (profile.inputKind !== "text") {
    if (!task.startsWith(prefix)) throw new Error(`This seller requires ${prefix} followed by its task JSON.`);
    let value: unknown;
    try { value = JSON.parse(task.slice(prefix.length)); } catch { throw new Error("This seller requires a valid JSON task. Inspect its published input example."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The seller task must be a JSON object.");
    // Validate the published example's required structure before asking a user
    // to pay. Providers still own semantic validation and their signed terms.
    const example = JSON.parse(profile.exampleTask.slice(prefix.length)) as Record<string, unknown>;
    const supplied = value as Record<string, unknown>;
    const required: Record<string, string[]> = { "269223": ["holdings", "targets", "prices"], "269224": ["price", "budgetUsd"], "269226": ["pools", "capitalUsd"], "269228": ["collateral", "debt", "prices"] };
    for (const key of required[profile.agentId] ?? Object.keys(example)) {
      const expected = example[key];
      const actual = supplied[key];
      if (actual === undefined || actual === null || typeof actual !== typeof expected ||
          (typeof actual === "string" && actual.trim().length === 0) ||
          (typeof actual === "number" && (!Number.isFinite(actual) || actual <= 0)) ||
          (typeof actual === "object" && (Array.isArray(actual) || Object.keys(actual).length === 0))) {
        throw new Error(`The seller task requires a valid ${key} field; inspect its published input example.`);
      }
    }
    const fail = () => { throw new Error("The task fields do not match this seller's published input contract. Inspect the card and example before requesting a quote."); };
    const numericMap = (value: unknown, positive = false): Record<string, number> => {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) return fail();
      for (const number of Object.values(value)) if (typeof number !== "number" || !Number.isFinite(number) || (positive ? number <= 0 : number < 0)) fail();
      return value as Record<string, number>;
    };
    if (profile.agentId === "269223") {
      const holdings = numericMap(supplied.holdings); const targets = numericMap(supplied.targets); const prices = numericMap(supplied.prices, true);
      if (Math.abs(Object.values(targets).reduce((sum, number) => sum + number, 0) - 1) > 0.000001 || [...Object.keys(holdings), ...Object.keys(targets)].some(symbol => prices[symbol] === undefined)) fail();
    }
    if (profile.agentId === "269224") {
      if (supplied.levels !== undefined && (typeof supplied.levels !== "number" || !Number.isInteger(supplied.levels) || supplied.levels < 1 || supplied.levels > 50)) fail();
      if (supplied.spanPct !== undefined && (typeof supplied.spanPct !== "number" || !Number.isFinite(supplied.spanPct) || supplied.spanPct <= 0 || supplied.spanPct >= 100)) fail();
    }
    if (profile.agentId === "269226") for (const pool of Object.values(supplied.pools as Record<string, unknown>)) {
      if (!pool || typeof pool !== "object" || Array.isArray(pool) || typeof (pool as Record<string, unknown>).apyPct !== "number" || !Number.isFinite((pool as Record<string, unknown>).apyPct)) fail();
    }
    if (profile.agentId === "269228") {
      const debt = numericMap(supplied.debt); const prices = numericMap(supplied.prices, true);
      for (const [symbol, collateral] of Object.entries(supplied.collateral as Record<string, unknown>)) {
        const entry = collateral as Record<string, unknown> | null;
        if (!entry || typeof entry !== "object" || typeof entry.amount !== "number" || !Number.isFinite(entry.amount) || entry.amount <= 0 || typeof entry.liqThreshold !== "number" || !Number.isFinite(entry.liqThreshold) || entry.liqThreshold <= 0 || entry.liqThreshold > 1 || prices[symbol] === undefined) fail();
      }
      if (Object.keys(debt).some(symbol => prices[symbol] === undefined)) fail();
    }
  }
  return { task, deliverables: profile.deliverables, qualityStandards: profile.qualityStandards };
}
