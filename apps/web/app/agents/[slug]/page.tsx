import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Callout, EmptyState, LoadingState } from "@bnbera/ui";
import { AgentDetailView } from "@/components/agent-detail-view";
import { parseMarketplacePageParams } from "@/lib/marketplace-contract";
import { readMarketplaceAgentForPage } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";

type PageParams = Promise<{ slug: string }>;
type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

export async function generateMetadata({ params }: { readonly params: PageParams }): Promise<Metadata> {
  const { slug } = await params;
  const response = await readMarketplaceAgentForPage(slug);
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
  const response = await readMarketplaceAgentForPage(slug, { preview: input.preview });

  if ((response.status === "ready" || response.status === "degraded") && response.agent) {
    return (
      <Suspense fallback={<div className="page-shell page-shell--tight"><LoadingState label="Loading agent detail" /></div>}>
        <AgentDetailView agent={response.agent} sourceNotice={response.notice} />
      </Suspense>
    );
  }
  if (response.status === "empty" && response.mode === "fixture") {
    notFound();
  }
  return (
    <div className="page-shell page-shell--tight">
      <Link className="button button--ghost" href="/marketplace">← Back to marketplace</Link>
      {response.status === "error" && response.error ? (
        <Callout title={response.error.error.code} tone="danger" icon="!">
          {response.error.error.message} Next action: <code>{response.error.error.nextAction}</code>.
        </Callout>
      ) : response.status === "loading" ? (
        <LoadingState label={response.notice} />
      ) : (
        <EmptyState title="Agent detail is unavailable">{response.notice} No fixture fallback is used in production.</EmptyState>
      )}
    </div>
  );
}
