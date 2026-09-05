import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LoadingState, SectionHeading } from "@bnbera/ui";
import { MarketplaceExplorer } from "@/components/marketplace-explorer";
import {
  categoryDescription,
  categoryLabel,
  categoryFromSegment,
  parseMarketplacePageParams
} from "@/lib/marketplace-contract";
import { readMarketplaceForPage } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";

type PageParams = Promise<{ category: string }>;
type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

export async function generateStaticParams() {
  return [
    { category: "rebalancing" },
    { category: "grid-trading" },
    { category: "yield-optimisation" },
    { category: "health-factor" }
  ];
}

export default async function CategoryPage({
  params,
  searchParams
}: {
  readonly params: PageParams;
  readonly searchParams: PageSearchParams;
}) {
  const { category: segment } = await params;
  const category = categoryFromSegment(segment);
  if (!category) {
    notFound();
  }
  const input = parseMarketplacePageParams(await searchParams);
  const response = await readMarketplaceForPage({ ...input, category });
  return (
    <div className="page-shell">
      <SectionHeading
        headingLevel={1}
        eyebrow="Marketplace category"
        title={categoryLabel(category)}
        description={categoryDescription(category)}
        action={<span className="status-badge status-badge--purple"><span className="status-badge__dot" aria-hidden="true" />Category view</span>}
      />
      <div className="section-block section-block--flush">
        <Suspense fallback={<LoadingState label={`Loading ${categoryLabel(category)} records`} />}>
          <MarketplaceExplorer response={response} />
        </Suspense>
      </div>
    </div>
  );
}
