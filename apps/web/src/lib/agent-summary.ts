import type { MarketplaceAgentReadModel } from "./marketplace-contract";

export function agentPriceLabel(agent: MarketplaceAgentReadModel): string {
  return agent.pricing.availability === "available" ? agent.pricing.label : "Price unavailable";
}

/** Only the explicitly five-point, active verified-purchase records form stars.
 * A truncated review list is labelled as a sample, never an all-time aggregate. */
export function verifiedRating(agent: MarketplaceAgentReadModel) {
  const records = agent.metrics.reputation.verifiedReviews;
  return {
    count: records.length,
    average: records.length ? records.reduce((sum, review) => sum + review.score, 0) / records.length : null,
    partial: agent.metrics.reputation.verifiedPurchases.count !== null && agent.metrics.reputation.verifiedPurchases.count !== records.length
  };
}

export function heartbeatLabel(agent: MarketplaceAgentReadModel, now = Date.now()): string {
  if (agent.dataProvenance.mode === "fixture") return "Preview";
  const observed = agent.health.observedAt === null ? Number.NaN : Date.parse(agent.health.observedAt);
  if (agent.dataProvenance.mode === "degraded" || agent.health.endpointStatus === "unhealthy") return "Degraded";
  if (!Number.isFinite(observed) || observed > now || now - observed > 120_000) return "Not recently checked";
  return agent.health.endpointStatus === "healthy" ? "Online" : "Status unknown";
}

export function agentExplorerUrl(agent: MarketplaceAgentReadModel): string | null {
  if (agent.dataProvenance.mode === "fixture" || agent.dataProvenance.identityRead.readConsistency === null) return null;
  const origin = agent.identity.chainId === 56 ? "https://bscscan.com" : agent.identity.chainId === 97 ? "https://testnet.bscscan.com" : null;
  return origin === null ? null : `${origin}/address/${agent.identity.identityRegistry}`;
}
