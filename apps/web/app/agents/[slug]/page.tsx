import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import { Callout, EmptyState } from "@bnbera/ui";
import { AgentDetailView } from "@/components/agent-detail-view";
import { AgentDetailSkeleton } from "@/components/agent-detail-skeleton";
import { parseMarketplacePageParams } from "@/lib/marketplace-contract";
import { readMarketplaceAgentForPage } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";

type PageParams = Promise<{ slug: string }>;
type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

// Primitive arguments let metadata and the page share the same request-scoped
// read, including optional evidence queries. Never cache across visitors here.
const readAgent = cache((slug: string, preview: ReturnType<typeof parseMarketplacePageParams>["preview"]) =>
  readMarketplaceAgentForPage(slug, { preview }));

export async function generateMetadata({ params, searchParams }: { readonly params: PageParams; readonly searchParams: PageSearchParams }): Promise<Metadata> {
  const { slug } = await params;
  const input = parseMarketplacePageParams(await searchParams);
  const response = await readAgent(slug, input.preview);
  return {
    title: response.agent?.name ?? "Agent detail",
    description: response.agent?.tagline ?? "Marketplace agent detail and state axes."
  };
}

export default async function AgentPage({
  params,
  searchParams
}: {
  readonly params: PageParams;
  readonly searchParams: PageSearchParams;
}) {
  const { slug } = await params;
  const input = parseMarketplacePageParams(await searchParams);
  const response = await readAgent(slug, input.preview);

  if ((response.status === "ready" || response.status === "degraded") && response.agent) {
    return (
      <Suspense fallback={<AgentDetailSkeleton />}>
        <AgentDetailView agent={response.agent} sourceNotice={response.notice} />
      </Suspense>
    );
  }
  if (response.status === "empty" && response.mode === "fixture") {
    notFound();
  }
  if (response.status === "loading") return <AgentDetailSkeleton label={response.notice} />;
  return (
    <div className="page-shell page-shell--tight">
      <Link className="button button--ghost" href="/marketplace">← Back to marketplace</Link>
      {response.status === "error" && response.error ? (
        <Callout title={response.error.error.code} tone="danger" icon="!">
          {response.error.error.message} Next action: <code>{response.error.error.nextAction}</code>.
        </Callout>
      ) : (
        <EmptyState title="Agent detail is unavailable">{response.notice} No fixture fallback is used in production.</EmptyState>
      )}
    </div>
  );
}
