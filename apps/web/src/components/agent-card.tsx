import Link from "next/link";
import { DataModeBadge, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import { erc8004IdentityKey } from "@bnbera/domain";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, compactAddress, formatObservedAt, joinOrFallback, statusTone, titleCase } from "@/lib/presentation";
import { CompareToggle } from "./compare-toggle";

function reputationCountLabel(view: MarketplaceAgentReadModel["metrics"]["reputation"]["rawPermissionless"]): string {
  if (view.count !== null) return `${view.count} active`;
  return view.status === "unknown" ? "Unknown" : "Unavailable";
}

export function AgentCard({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  const identity = agent.identity;
  return (
    <article className="agent-card">
      <div className="agent-card__topline">
        <div className="agent-card__category">
          <span className={`category-mark category-mark--${agent.category}`} aria-hidden="true">
            {agent.category === "rebalancing" ? "R" : agent.category === "grid-trading" ? "G" : agent.category === "yield-optimisation" ? "Y" : agent.category === "health-factor" ? "H" : "?"}
          </span>
          <span>{categoryLabel(agent.category)}</span>
        </div>
        <DataModeBadge mode={agent.dataProvenance.mode === "fixture" ? "fixture" : agent.dataProvenance.mode} label={agent.dataProvenance.label} />
      </div>
      <div className="agent-card__heading">
        <div>
          <h3>{agent.name}</h3>
          <p>{agent.tagline}</p>
        </div>
        <StatusBadge
          label="Eligibility"
          value={agent.eligibility.eligible ? `${agent.eligibility.score ?? "—"}/100` : "Excluded"}
          tone={agent.eligibility.eligible ? "success" : "danger"}
        />
      </div>
      <p className="agent-card__description">{agent.description}</p>
      <div className="agent-card__facts">
        <span><b>Network</b> BSC {identity.chainId === 97 ? "testnet" : "mainnet"}</span>
        <span><b>Protocols</b> {joinOrFallback(agent.protocols, "Not observed")}</span>
        <span><b>Endpoint probe</b> {titleCase(agent.health.endpointStatus)} · {formatObservedAt(agent.health.observedAt)}{agent.health.latencyMs === null ? "" : ` · ${agent.health.latencyMs} ms`}</span>
        <span><b>Observed uptime samples</b> {agent.metrics.uptime.status === "observed" ? `${agent.metrics.uptime.successfulChecks}/${agent.metrics.uptime.attemptedChecks}` : "Not observed"}</span>
        <span><b>Reputation views</b> raw {reputationCountLabel(agent.metrics.reputation.rawPermissionless)} · recognized {reputationCountLabel(agent.metrics.reputation.recognizedReviewers)} · verified {reputationCountLabel(agent.metrics.reputation.verifiedPurchases)}</span>
        <span><b>Completed jobs</b> {agent.metrics.completedJobs.completedCount ?? "Unavailable"}</span>
      </div>
      <details className="quiet-disclosure"><summary>Listing status & identity</summary><StateAxisGrid axes={agent.stateAxes} compact /><p><code title={erc8004IdentityKey(identity)}>{identity.namespace}:{identity.chainId}:{compactAddress(identity.identityRegistry)}:#{identity.agentId}</code></p><p><code>{erc8004IdentityKey(identity)}</code></p></details>
      <div className="agent-card__footer">
        <div className="agent-card__freshness">
          <span className="muted-label">Read observations</span>
          <div className="agent-card__status-stack">
            <StatusBadge label="Data" value={agent.freshness.label} tone={statusTone(agent.freshness.status)} />
            <StatusBadge label="Endpoint" value={titleCase(agent.health.endpointStatus)} tone={statusTone(agent.health.endpointStatus)} />
          </div>
        </div>
        <div className="agent-card__actions">
          <CompareToggle slug={agent.slug} />
          <Link className="button button--small" href={`/agents/${agent.slug}`}>
            View agent <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
      <div className="agent-card__offer"><strong>{agent.pricing.label}</strong>{agent.activation.enabled ? <Link href={`/agents/${agent.slug}#hire`}>Hire agent →</Link> : <small>{agent.activation.reason}</small>}</div>
      <p className="fixture-caption">{titleCase(agent.dataProvenance.label)} · {agent.dataProvenance.details}</p>
    </article>
  );
}
