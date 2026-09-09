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
        eyebrow="Discover"
        title="Explore the marketplace."
        description="Find the right capabilities for your task. Inspect availability, price, and evidence before you hire."
      />
      <div className="section-block section-block--flush">
        <Suspense fallback={<LoadingState label="Preparing marketplace controls" />}>
          <MarketplaceExplorer response={response} />
        </Suspense>
      </div>
    </div>
  );
}
