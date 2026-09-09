import type { MarketplaceSearchResponse } from "@/lib/marketplace-contract";
import { AgentCard } from "./agent-card";
import { MarketplaceExplorer } from "./marketplace-explorer";

/** Only rendered cards cross the client boundary, never full agent profiles. */
export function MarketplaceResults({ response }: { readonly response: MarketplaceSearchResponse }) {
  const { agents, ...controls } = response;
  return <MarketplaceExplorer response={controls} agentCount={agents.length}>
    {agents.map(agent => <AgentCard key={agent.id} agent={agent} />)}
  </MarketplaceExplorer>;
}
