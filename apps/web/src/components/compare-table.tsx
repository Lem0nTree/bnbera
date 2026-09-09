import Link from "next/link";
import type { CSSProperties } from "react";
import { DataModeBadge, EmptyState, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import { erc8004IdentityKey } from "@bnbera/domain";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, compactAddress, formatObservedAt, joinOrFallback, statusTone, titleCase } from "@/lib/presentation";
import { ActivationPanel } from "./activation-panel";

export function CompareTable({ agents }: { readonly agents: readonly MarketplaceAgentReadModel[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState title="Choose up to three agents to compare">
        Comparison is read-only and uses the same marketplace contract as browse and detail. No activation or payment is triggered.
        <Link className="button button--primary button--small" href="/marketplace">Browse agents</Link>
      </EmptyState>
    );
  }

  return (
    <section aria-label="Compare agents">
      <p className="compare-scroll-hint">{agents.length} {agents.length === 1 ? "agent" : "agents"} selected. Scroll sideways to compare; scroll down for evidence. Keyboard: focus the comparison, then use arrow keys.</p>
    <div className="compare-table-wrap" role="region" aria-label="Agent comparison; scroll horizontally to inspect all agents" tabIndex={0}>
      <div className="compare-grid" style={{ "--compare-columns": agents.length } as CSSProperties}>
        {agents.map((agent) => (
          <article className="compare-column" key={agent.id}>
            <div className="compare-column__identity"><strong>{agent.name}</strong><span>Chain {agent.identity.chainId} · #{agent.identity.agentId}</span></div>
            <div className="compare-column__header">
              <DataModeBadge mode={agent.dataProvenance.mode} label={agent.dataProvenance.label} />
              <p className="eyebrow">{categoryLabel(agent.category)}</p>
              <h2>{agent.name}</h2>
              <p>{agent.tagline}</p>
              <Link className="text-link" href={`/agents/${agent.slug}`}>Open detail ↗</Link>
            </div>
            <div className="compare-cell">
              <span className="compare-label">Eligibility</span>
              <StatusBadge
                value={agent.eligibility.eligible ? `${agent.eligibility.score ?? "—"}/100` : "Excluded"}
                tone={agent.eligibility.eligible ? "success" : "danger"}
              />
              {agent.eligibility.reasons.length > 0 ? (
                <ul className="compare-reasons">
                  {agent.eligibility.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}
                </ul>
              ) : agent.scoreExplanation.factors.length > 0 ? (
                <ul className="compare-reasons">
                  {agent.scoreExplanation.factors.map((factor) => <li key={factor}>{factor}</li>)}
                </ul>
              ) : <p>No explanation returned.</p>}
            </div>
            <div className="compare-cell">
              <span className="compare-label">ERC-8004 identity</span>
              <code>{agent.identity.namespace}</code>
              <code>chain {agent.identity.chainId}</code>
              <code>{agent.identity.identityRegistry}</code>
              <code>agentId {agent.identity.agentId}</code>
            </div>
            <div className="compare-cell">
              <span className="compare-label">State axes</span>
              <StateAxisGrid axes={agent.stateAxes} compact />
            </div>
            <div className="compare-cell">
              <span className="compare-label">Provenance</span>
              <p>{titleCase(agent.stateAxes.originType)} · {agent.dataProvenance.details}</p>
              <p><b>Claimant:</b> {compactAddress(agent.ownerAddress)}</p>
              <p><b>Identity read:</b> {agent.dataProvenance.identityRead.readConsistency ?? "unknown"} · {formatObservedAt(agent.dataProvenance.identityRead.observedAt)}</p>
            </div>
            <div className="compare-cell">
              <span className="compare-label">Protocol & capability</span>
              <p>{joinOrFallback(agent.protocols, "Not observed")}</p>
              <p>{agent.capabilityManifest.capabilities[0]?.description ?? "No capability manifest returned."}</p>
            </div>
            <div className="compare-cell">
              <span className="compare-label">Freshness & evidence</span>
              <StatusBadge value={agent.freshness.label} tone={statusTone(agent.freshness.status)} />
              <StatusBadge label="Endpoint" value={titleCase(agent.health.endpointStatus)} tone={statusTone(agent.health.endpointStatus)} />
              <p>{agent.evidence.summary}</p>
            </div>
            <ActivationPanel activation={agent.activation} detail identityKey={erc8004IdentityKey(agent.identity)} />
          </article>
        ))}
      </div>
    </div>
    </section>
  );
}
