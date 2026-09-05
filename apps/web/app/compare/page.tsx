import Link from "next/link";
import { Callout, SectionHeading } from "@bnbera/ui";
import { CompareTable } from "@/components/compare-table";
import { readMarketplaceAgentForPage } from "@/lib/marketplace-server";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

function parseSlugs(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return [...new Set(raw.split(",").map((slug) => slug.trim()).filter(Boolean))].slice(0, 3);
}

export default async function ComparePage({ searchParams }: { readonly searchParams: PageSearchParams }) {
  const params = await searchParams;
  const slugs = parseSlugs(params.agents);
  const responses = await Promise.all(slugs.map((slug) => readMarketplaceAgentForPage(slug)));
  const agents = responses.flatMap((response) => response.agent ? [response.agent] : []);
  const errors = responses.flatMap((response) => response.error ? [response.error] : []);
  const missing = slugs.filter((_, index) => responses[index]?.status === "empty");
  return (
    <div className="page-shell page-shell--tight">
      <SectionHeading
        headingLevel={1}
        eyebrow="Read-only comparison"
        title="Put the state axes side by side."
        description="Compare up to three marketplace records using the same identity, capability, freshness, evidence, and activation contract as browse and detail."
        action={<Link className="button button--ghost button--small" href="/marketplace">Add agents</Link>}
      />
      <div className="section-block section-block--flush">
        <Callout title="Comparison has no side effects" tone="info" icon="i">
          No wallet connection, quote, payment, transaction, or service invocation occurs when comparison changes.
        </Callout>
      </div>
      {errors.length > 0 ? (
        <div className="section-block section-block--flush">
          <Callout title="Some comparison records are unavailable" tone="warning" icon="!">
            {errors.map((error) => `${error.error.code}: ${error.error.message}`).join(" · ")}
          </Callout>
        </div>
      ) : null}
      {missing.length > 0 ? (
        <div className="section-block section-block--flush">
          <Callout title="Some comparison records are missing" tone="warning" icon="!">
            {missing.join(", ")} is not present in the current read model. Comparison continues with the records that were returned.
          </Callout>
        </div>
      ) : null}
      <div className="section-block section-block--flush">
        <CompareTable agents={agents} />
      </div>
    </div>
  );
}
