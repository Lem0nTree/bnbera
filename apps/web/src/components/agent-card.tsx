import Link from "next/link";
import { DataModeBadge, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel } from "@/lib/marketplace-contract";
import { compactAddress, joinOrFallback, statusTone, titleCase } from "@/lib/presentation";
import { ActivationPanel } from "./activation-panel";
import { CompareToggle } from "./compare-toggle";

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
        <span><b>Identity</b> {identity.namespace}:{identity.chainId}:{compactAddress(identity.identityRegistry)}:#{identity.agentId}</span>
        <span><b>Protocols</b> {joinOrFallback(agent.protocols, "Not observed")}</span>
      </div>
      <StateAxisGrid axes={agent.stateAxes} compact />
      <div className="agent-card__footer">
        <div className="agent-card__freshness">
          <span className="muted-label">Freshness</span>
          <StatusBadge value={agent.freshness.label} tone={statusTone(agent.freshness.status)} />
        </div>
        <div className="agent-card__actions">
          <CompareToggle slug={agent.slug} />
          <Link className="button button--small" href={`/agents/${agent.slug}`}>
            View detail <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
      <ActivationPanel activation={agent.activation} />
      <p className="fixture-caption">{titleCase(agent.dataProvenance.label)} · {agent.dataProvenance.details}</p>
    </article>
  );
}
