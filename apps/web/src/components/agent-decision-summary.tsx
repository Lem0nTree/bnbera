import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { agentExplorerUrl, heartbeatLabel, verifiedRating } from "@/lib/agent-summary";
import { formatObservedAt } from "@/lib/presentation";

export function AgentRating({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  const rating = verifiedRating(agent);
  return <span className="agent-rating">{rating.average === null ? <><span aria-hidden="true">☆</span> Unrated</> : <><span aria-hidden="true">★</span> {rating.average.toFixed(1)} <span>({rating.count} verified {rating.count === 1 ? "review" : "reviews"}{rating.partial ? " shown" : ""})</span></>}</span>;
}

export function AgentDecisionSummary({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  const uptime = agent.metrics.uptime;
  const observed = uptime.status === "observed" && uptime.attemptedChecks > 1;
  const percent = observed ? Math.round(100 * uptime.successfulChecks / uptime.attemptedChecks) : null;
  const explorer = agentExplorerUrl(agent);
  const reputation = agent.metrics.reputation;
  return <section className="decision-grid" aria-label="Agent track record">
    <article className="decision-card decision-card--health"><span className="eyebrow">Service check</span><h2 className="heartbeat" data-online={heartbeatLabel(agent) === "Interface verified"}><i />{heartbeatLabel(agent)}</h2><p>Last checked {formatObservedAt(agent.health.observedAt)}</p>
      {observed ? <><div className="observation-meter" role="meter" aria-label="Successful observed service checks" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent!}><span style={{ width: `${percent}%` }} /></div><strong>{percent}% successful checks</strong><p>{uptime.successfulChecks.toLocaleString()} of {uptime.attemptedChecks.toLocaleString()} observed checks · {uptime.monitoringWindowSeconds === null ? "Horizon unavailable" : `${Math.round(uptime.monitoringWindowSeconds / 60)} min monitoring horizon`}</p><small>{uptime.coverageRatio === null ? "Coverage unknown" : `${Math.round(uptime.coverageRatio * 100)}% observation coverage`} · Gaps are unknown, not uptime.</small></> : <p className="decision-empty">No monitoring history available. A heartbeat is not proof of task execution.</p>}
    </article>
    <article className="decision-card"><span className="eyebrow">Work & reputation</span><h2>{agent.metrics.completedJobs.completedCount ?? "—"} <span>completed {agent.metrics.completedJobs.completedCount === 1 ? "job" : "jobs"}</span></h2><p>{agent.metrics.completedJobs.source === "bnbera-erc8183-settled" ? "Confirmed BNBEra settlements" : agent.metrics.completedJobs.source ?? "No confirmed job history available"}</p><div className="reputation-sources"><span>Verified buyer reviews <strong>{reputation.verifiedPurchases.count ?? "Unavailable"}</strong></span><span>Recognized feedback <strong>{reputation.recognizedReviewers.count ?? "Unavailable"}</strong></span><span>Raw on-chain feedback <strong>{reputation.rawPermissionless.count ?? "Unavailable"}</strong></span></div><small>Independent sources. Raw feedback is not a verified review.</small>{agent.metrics.lastResult.status === "available" && agent.metrics.lastResult.summary && <p>Latest result: {agent.metrics.lastResult.summary}</p>}</article>
    <article className="decision-card"><span className="eyebrow">On-chain identity</span><h2>Agent #{agent.identity.agentId}</h2><p>BNB {agent.identity.chainId === 97 ? "testnet" : "mainnet"} · ERC-8004</p><p>Registry identity and service performance are separate signals.</p>{explorer ? <a className="text-link" href={explorer} target="_blank" rel="noreferrer">View registry on BscScan ↗</a> : <small>No verified explorer link available.</small>}</article>
  </section>;
}

export function AgentReviews({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  const reviews = agent.metrics.reputation.verifiedReviews;
  return <section className="profile-reviews" id="reviews"><div className="profile-section-heading"><h2>Buyer reviews</h2><AgentRating agent={agent} /></div>{reviews.length ? <div className="buyer-review-grid">{reviews.map(review => <article className="buyer-review" key={review.reviewId}><div><span className="agent-rating">★ {review.score}/5</span><span>Verified purchase</span></div><p>{review.comment || "This buyer left a rating without a comment."}</p><small>{review.reviewerAddress.slice(0, 6)}…{review.reviewerAddress.slice(-4)} · {formatObservedAt(review.observedAt)}</small></article>)}</div> : <p className="review-empty">No verified buyer reviews yet. Explore the services and observed track record before choosing this agent.</p>}</section>;
}
