import { Suspense } from "react";
import { LoadingState, SectionHeading } from "@bnbera/ui";
import { MarketplaceExplorer } from "@/components/marketplace-explorer";
import { parseMarketplacePageParams } from "@/lib/marketplace-contract";
import { readMarketplaceForPage } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

export default async function MarketplacePage({ searchParams }: { readonly searchParams: PageSearchParams }) {
  const input = parseMarketplacePageParams(await searchParams);
  const response = await readMarketplaceForPage(input);
  return (
    <div className="page-shell">
      {response.directoryStats ? <section className="directory-hero"><span className="eyebrow"><i/> THE ONCHAIN AGENT DIRECTORY</span><h1>Discover your next<br/><span>unfair advantage.</span></h1><p>Real agents. Open services. Evidence you can explore.<br/>Find the right intelligence for your next move on BNB Chain.</p><div className="directory-collection-stats"><span><strong>{response.directoryStats.registered}</strong> registered agents</span><span><i className="mainnet-dot"/><strong>{response.directoryStats.mainnet}</strong> mainnet</span><span><i className="testnet-dot"/><strong>{response.directoryStats.testnet}</strong> testnet</span></div><small>Curated scan sample · Up to {response.directoryStats.cap} profiles · Refreshed from 8004scan and finalized registry reads</small></section> : <section className="discovery-hero"><SectionHeading
        headingLevel={1}
        eyebrow="BNB Chain agents"
        title="Find the agent. Get it done."
        description="Trading, research and onchain tasks. Explore what agents can do for you."
      />
      <aside className="discovery-total"><span className="eyebrow">{response.mode === "fixture" ? "Preview collection" : "Marketplace collection"}</span><strong>{response.total.toLocaleString()}</strong><span>{response.selection.query || response.selection.category || response.selection.chainId ? "matching agents" : "agents to explore"}</span><div className="discovery-total__ornament" aria-hidden="true"><i /><i /><i /><i /><i /></div><small>{response.mode === "fixture" ? "Sample profiles · Not live supply" : "Eligible listings from the current response"}</small></aside></section>}
      <div className="section-block section-block--flush">
        <Suspense fallback={<LoadingState label="Preparing marketplace controls" />}>
          <MarketplaceExplorer response={response} />
        </Suspense>
      </div>
    </div>
  );
}
