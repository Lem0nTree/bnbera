import Link from "next/link";
import { Suspense } from "react";
import { Callout, EmptyState, LoadingState, SectionHeading } from "@bnbera/ui";
import { categoryLabel } from "@/lib/presentation";
import { readMarketplaceForPage } from "@/lib/marketplace-server";
import { AgentCard } from "@/components/agent-card";
export const dynamic = "force-dynamic";
const categories = ["rebalancing", "grid-trading", "yield-optimisation", "health-factor"] as const;
export default async function HomePage() {
  const response = await readMarketplaceForPage({ limit: 6 });
  return <div className="page-shell">
    <section className="home-hero">
      <p className="eyebrow">The BNB Chain agent marketplace</p>
      <h1>Find your agent.<br /><span className="sr-only">Manage your position.</span><span className="home-hero__taglines" aria-hidden="true"><span className="home-hero__tagline-track"><span>Manage your position.</span><span>Analyze your wallet.</span><span>Get custom alerts.</span><span>Manage your position.</span></span></span></h1>
      <p>Discover agents for your onchain tasks. Understand what they do, explore their record, and hire with confidence.</p>
      <form action="/marketplace" className="home-search">
        <label className="sr-only" htmlFor="home-search">What do you need help with?</label>
        <div className="home-search__control"><span aria-hidden="true">⌕</span><input id="home-search" name="q" type="search" maxLength={120} placeholder="What do you want to do?" /><button className="button button--primary" type="submit">Find agents <span aria-hidden="true">→</span></button></div>
      </form>
      <nav className="category-chips" aria-label="Agent categories">{categories.map((category) => <Link key={category} href={`/marketplace/${category}`}>{categoryLabel(category)} <span aria-hidden="true">↗</span></Link>)}</nav>
    </section>
    <section className="home-agents">
      <SectionHeading title="Explore agents" action={<Link className="button button--ghost" href="/marketplace">View marketplace <span aria-hidden="true">→</span></Link>} />
      <div className="source-note">{response.mode !== "live" ? <><span>{response.dataLabel}</span><details><summary>About this data</summary><p>{response.notice}</p></details></> : <span>Capabilities and observations from registered agents.</span>}</div>
      {response.status === "error" ? <Callout title="Agents could not be loaded" tone="danger">{response.notice}<Link href="/marketplace">Try the marketplace →</Link></Callout> : null}
      {response.agents.length ? <Suspense fallback={<LoadingState label="Preparing agent cards" />}><div className="agent-grid">{response.agents.slice(0, 6).map((agent) => <AgentCard agent={agent} key={agent.id} />)}</div></Suspense> : response.status !== "error" ? <EmptyState title="No agents are available to display yet"><Link href="/marketplace">Open the marketplace to check availability.</Link></EmptyState> : null}
    </section>
    <section className="how-it-works"><SectionHeading eyebrow="From discovery to done" title="Your next task, in good hands." /><div className="how-it-works__grid"><div><b>01 — DISCOVER</b><h3>Find the right capability.</h3><p>Search by task or explore a category to find an agent that fits.</p></div><div><b>02 — UNDERSTAND</b><h3>Know what to expect.</h3><p>Review capabilities, pricing, and the agent’s observed track record.</p></div><div><b>03 — HIRE</b><h3>You stay in control.</h3><p>Review the quote, fund available tasks, and approve the result before settlement.</p></div></div></section>
    <section className="creator-invitation"><div><p className="eyebrow">Built by you. Ready for more.</p><h2>Your idea. Your agent.</h2><p>Start with a guided testnet swap template. Set its limits and keep control of its permissions.</p></div><Link className="button button--primary" href="/create">Create an agent <span aria-hidden="true">→</span></Link></section>
  </div>;
}
