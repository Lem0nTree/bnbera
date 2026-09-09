import Link from "next/link";
import { Suspense } from "react";
import { Callout, DataModeBadge, EmptyState, LoadingState, SectionHeading } from "@bnbera/ui";
import { categoryLabel } from "@/lib/presentation";
import { readMarketplaceForPage } from "@/lib/marketplace-server";
import { AgentCard } from "@/components/agent-card";
export const dynamic = "force-dynamic";
const categories = ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"] as const;
export default async function HomePage() {
  const response = await readMarketplaceForPage({ limit: 6 });
  return <div className="page-shell">
    <section className="marketplace-hero">
      <p className="eyebrow">BNB Chain agent marketplace</p>
      <h1>Find an agent for your next task.</h1>
      <p>Explore capabilities, inspect evidence, and hire when available.</p>
      <form action="/marketplace" className="home-search">
        <label htmlFor="home-search">What do you need help with?</label>
        <div className="detail-actions"><input id="home-search" name="q" type="search" maxLength={120} placeholder="Search capabilities, protocols, or agents" /><button className="button button--primary" type="submit">Find agents →</button></div>
      </form>
      <nav className="category-chips" aria-label="Agent categories">{categories.map((category) => <Link key={category} href={`/marketplace/${category}`}>{categoryLabel(category)}</Link>)}</nav>
    </section>
    <section className="section-block">
      <SectionHeading title="Explore agents" action={<Link className="button button--ghost" href="/marketplace">Browse all agents →</Link>} />
      <div className="explorer__status-row"><DataModeBadge mode={response.mode} label={response.dataLabel} /></div>
      {response.mode !== "live" || response.status === "error" || response.status === "degraded" ? <Callout title={response.status === "error" ? "Agents could not be loaded" : "About this data"} tone={response.status === "error" ? "danger" : "info"}>{response.notice}</Callout> : null}
      {response.agents.length ? <Suspense fallback={<LoadingState label="Preparing agent cards" />}><div className="agent-grid">{response.agents.slice(0, 6).map((agent) => <AgentCard agent={agent} key={agent.id} />)}</div></Suspense> : <EmptyState title="No agents are available to display yet"><Link href="/marketplace">Open marketplace and reload the available supply.</Link></EmptyState>}
    </section>
    <section className="creator-invitation"><div><p className="eyebrow">Build with a bounded template</p><h2>Create your first agent.</h2><p>Configure a testnet swap agent and stay in control of its execution permissions.</p></div><Link className="button button--primary" href="/create">Create agent →</Link></section>
  </div>;
}
