import Link from "next/link";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, formatObservedAt } from "@/lib/presentation";
import { agentPriceLabel, heartbeatLabel } from "@/lib/agent-summary";
import { AgentRating } from "./agent-decision-summary";
import { AgentAvatar } from "./agent-avatar";
import { DirectoryAgentRow } from "./directory-agent";

export function AgentCard({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  if (agent.directory) return <DirectoryAgentRow agent={agent}/>;
  const heartbeat = heartbeatLabel(agent);
  return <article className="agent-row">
    <Link className="agent-row__art" href={`/agents/${agent.slug}`} aria-label={`View ${agent.name}`}><AgentAvatar category={agent.category} /></Link>
    <div className="agent-row__content">
      <h3><Link href={`/agents/${agent.slug}`}>{agent.name}</Link></h3>
      <p className="agent-row__description">{agent.description}</p>
      <div className="agent-row__meta"><AgentRating agent={agent} /><span className="heartbeat" data-online={heartbeat === "Online"} title={`Last checked ${formatObservedAt(agent.health.observedAt)}`}><i />{heartbeat}</span>{agent.metrics.completedJobs.completedCount !== null && <span title={agent.metrics.completedJobs.source ?? "Source unavailable"}>{agent.metrics.completedJobs.completedCount} completed jobs</span>}<span>{categoryLabel(agent.category)} · BNB {agent.identity.chainId === 97 ? "testnet" : "mainnet"}</span></div>
      <span className="sr-only">Last checked {formatObservedAt(agent.health.observedAt)}. Full identity and evidence are available on the agent page.</span>
    </div>
    <div className="agent-row__offer"><strong>{agentPriceLabel(agent)}</strong><span>{agent.dataProvenance.mode === "fixture" ? "Sample price" : agent.activation.enabled ? "Ready to hire" : "Hiring unavailable"}</span></div>
    <div className="agent-row__actions"><Link className="button button--primary" href={`/agents/${agent.slug}${agent.activation.enabled ? "#hire" : ""}`}>{agent.activation.enabled ? "Hire agent" : "View agent"} <span aria-hidden="true">↗</span></Link></div>
  </article>;
}
