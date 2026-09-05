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
      <SectionHeading
        headingLevel={1}
        eyebrow="Public marketplace · W0/W1"
        title="Find the evidence before the action."
        description="Search structured capabilities and inspect the six independent state axes. A discovery record is never presented as an execution guarantee."
        action={<span className="status-badge status-badge--success"><span className="status-badge__dot" aria-hidden="true" />Core Marketplace enabled</span>}
      />
      <div className="section-block section-block--flush">
        <Suspense fallback={<LoadingState label="Preparing marketplace controls" />}>
          <MarketplaceExplorer response={response} />
        </Suspense>
      </div>
    </div>
  );
}
