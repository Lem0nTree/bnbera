"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Callout, EmptyState, LoadingState, StatusBadge } from "@bnbera/ui";
import type { MarketplaceSearchResponse } from "@/lib/marketplace-contract";
import { categoryLabel, titleCase } from "@/lib/presentation";

const categories = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor"
] as const;

function paramsForCategory(searchString: string, category: string): string {
  const params = new URLSearchParams();
  const search = new URLSearchParams(searchString);
  for (const key of ["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness", "sort"]) {
    const value = search.get(key);
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `/marketplace/${category}${query ? `?${query}` : ""}`;
}

function paramsForAllSupply(searchString: string): string {
  const params = new URLSearchParams(searchString);
  params.delete("category");
  params.delete("offset");
  params.delete("agents");
  const query = params.toString();
  return `/marketplace${query ? `?${query}` : ""}`;
}

export function MarketplaceExplorer({ response, agentCount, children }: { readonly response: Omit<MarketplaceSearchResponse, "agents">; readonly agentCount: number; readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentCategory = response.selection.category;
  const pageSize=Number(searchParams.get("limit")??20);
  const cleanParams = new URLSearchParams(searchParams.toString());
  cleanParams.delete("agents");
  const searchString = cleanParams.toString();

  function submitFilters(formData: FormData): void {
    const next = new URLSearchParams();
    const values = ["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness", "sort"];
    for (const name of values) {
      const value = String(formData.get(name) ?? "").trim();
      if (value) {
        next.set(name, value);
      }
    }
    if (currentCategory) {
      next.set("category", currentCategory);
    }
    router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`);
  }

  const selectedOrigin = searchParams.get("origin") ?? response.selection.origin ?? "";
  const selectedChainId = searchParams.get("chainId") ?? (response.selection.chainId?.toString() ?? "");
  const selectedVerification = searchParams.get("verification") ?? response.selection.verification ?? "";
  const selectedRuntime = searchParams.get("runtime") ?? response.selection.runtime ?? "";
  const selectedProtocol = searchParams.get("protocol") ?? response.selection.protocol ?? "";
  const selectedFreshness = searchParams.get("freshness") ?? response.selection.freshness ?? "";
  const selectedSort = searchParams.get("sort") ?? response.selection.sort ?? "relevance";
  const query = searchParams.get("q") ?? response.selection.query;

  return (
    <div className="explorer">
      <div className="explorer__status-row">
        <div className="explorer__status-copy">
          <span>
            {response.total} agent{response.total === 1 ? "" : "s"}{response.directoryStats?" in this collection":""}
          </span>
        </div>
      </div>

      {response.mode === "live" && response.meta?.warning && <p className="preview-banner">{response.meta.warning}</p>}

      {response.mode !== "live" && <p className="preview-banner">{response.mode === "fixture" ? "Preview collection · Sample agents. Hiring is unavailable." : response.status === "degraded" ? "Degraded data · Check the latest status before hiring." : response.notice}</p>}

      <div className="category-tabs" aria-label="Marketplace categories">
        <Link prefetch={false}
          aria-current={!currentCategory ? "page" : undefined}
          className={!currentCategory ? "category-tab category-tab--active" : "category-tab"}
          href={paramsForAllSupply(searchString)}
        >
          All agents
        </Link>
        {categories.map((category) => (
          <Link prefetch={false}
            aria-current={currentCategory === category ? "page" : undefined}
            className={currentCategory === category ? "category-tab category-tab--active" : "category-tab"}
            href={paramsForCategory(searchString, category)}
            key={category}
          >
            <span>{categoryLabel(category)}</span>
          </Link>
        ))}
      </div>

      <form
        className="filter-panel"
        key={searchString}
        onSubmit={(event) => {
          event.preventDefault();
          void submitFilters(new FormData(event.currentTarget));
        }}
      >
        <label className="search-field filter-panel__query">
          <span className="sr-only">Search agents</span>
          <span className="search-field__icon" aria-hidden="true">⌕</span>
          <input type="search" name="q" maxLength={120} defaultValue={query} placeholder="Search capabilities, protocols, or agent names" />
        </label>
        <label className="select-field">
          <span>Network</span>
          <select name="chainId" defaultValue={selectedChainId}>
            <option value="">Any BSC network</option>
            <option value="56">BSC mainnet · 56</option>
            <option value="97">BSC testnet · 97</option>
          </select>
        </label>
        <details className="more-filters" open={Boolean(selectedOrigin || selectedVerification || selectedRuntime || selectedFreshness || selectedProtocol)}><summary>More filters</summary><div className="more-filters__grid">
        <label className="select-field">
          <span>Origin</span>
          <select name="origin" defaultValue={selectedOrigin}>
            <option value="">Any origin</option>
            <option value="discovered">Discovered</option>
            <option value="manual_import">Manual import</option>
            <option value="created">Created</option>
          </select>
        </label>
        <label className="select-field">
          <span>Verification</span>
          <select name="verification" defaultValue={selectedVerification}>
            <option value="">Any state</option>
            <option value="verified">Verified</option>
            <option value="degraded">Degraded</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="select-field">
          <span>Runtime</span>
          <select name="runtime" defaultValue={selectedRuntime}>
            <option value="">Any state</option>
            <option value="live">Live axis</option>
            <option value="paused">Paused</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className="select-field">
          <span>Data freshness</span>
          <select name="freshness" defaultValue={selectedFreshness}>
            <option value="">Any freshness</option>
            <option value="fresh">Fresh</option>
            <option value="stale">Stale</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="select-field">
          <span>Protocol</span>
          <select name="protocol" defaultValue={selectedProtocol}>
            <option value="">Any protocol</option>
            <option value="pancakeswap">PancakeSwap</option>
            <option value="pancakeswap-v3">PancakeSwap V3</option>
            <option value="venus">Venus</option>
            <option value="lista">Lista</option>
            <option value="a2a">A2A</option>
            <option value="mcp">MCP</option>
            <option value="x402">X402</option>
          </select>
        </label>
        </div></details>
        <label className="select-field">
          <span>Sort</span>
          <select name="sort" defaultValue={selectedSort}>
            <option value="relevance">Relevance</option>
            <option value="score">{response.directoryStats?"8004scan score":"Eligibility score"}</option>
            <option value="freshness">Freshness</option>
          </select>
        </label>
        <button className="button button--primary filter-panel__submit" type="submit">Apply filters</button>
      </form>
      {["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness"].some(key => searchParams.has(key)) && <div className="applied-filters">{["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness"].filter((key) => searchParams.has(key)).map((key) => { const params = new URLSearchParams(searchString); params.delete(key); return <Link key={key} href={`${pathname}?${params}`} aria-label={`Remove ${key} filter`}>{titleCase(key)}: {searchParams.get(key)} ×</Link>; })}<Link href={pathname}>Clear filters</Link></div>}

      {response.status === "loading" ? <LoadingState label={response.notice} /> : null}
      {response.status === "error" && response.error ? (
        <Callout title={`${response.error.error.code} · retryable ${response.error.error.retriable ? "yes" : "no"}`} tone="danger" icon="!">
          {response.error.error.message} Next action: <code>{response.error.error.nextAction}</code>.
        </Callout>
      ) : null}
      {response.status === "empty" ? (
        <EmptyState title={response.selection.query || currentCategory ? "No records match this view" : "Marketplace supply is empty"}>
          {response.notice} Try a wider filter, or connect the read-model API. Fixture data is never used as a production fallback.
        </EmptyState>
      ) : null}
      {response.status === "degraded" && agentCount === 0 ? (
        <EmptyState title="No agents are currently available">
          The connected collection has no listings that meet the current availability checks. Try again later or explore the recorded candidate details below. No sample agents have been substituted.
        </EmptyState>
      ) : null}

      {agentCount > 0 ? (
        <div className="agent-grid">
          {children}
        </div>
      ) : null}

      {response.total>agentCount && <nav className="directory-load-more" aria-label="Result pages">
        {Number(searchParams.get("offset")??0)>0 && <Link prefetch={false} className="button" href={`${pathname}?${new URLSearchParams({...Object.fromEntries(searchParams),offset:String(Math.max(0,Number(searchParams.get("offset")??0)-pageSize))})}`}>Previous page</Link>}
        {Number(searchParams.get("offset")??0)+agentCount<response.total && <Link prefetch={false} className="button" href={`${pathname}?${new URLSearchParams({...Object.fromEntries(searchParams),offset:String(Number(searchParams.get("offset")??0)+pageSize)})}`}>Next page</Link>}
      </nav>}

      {response.excluded.length > 0 ? (
        <details className="excluded-panel"><summary>Excluded candidates ({response.excluded.length})</summary><section aria-labelledby="excluded-heading">
          <div className="excluded-panel__heading">
            <div>
              <p className="eyebrow">Eligibility boundary</p>
              <h2 id="excluded-heading">Candidates excluded before ranking</h2>
              <p>These records remain visible as explanations, but they are not eligible for the current read request.</p>
            </div>
            <StatusBadge value="Hard filters first" tone="warning" />
          </div>
          <div className="excluded-list">
            {response.excluded.map((agent) => (
              <article className="excluded-row" key={agent.id}>
                <div className="excluded-row__identity">
                  <div>
                    <h3>{agent.name}</h3>
                    <p>{categoryLabel(agent.category)} · <code>{agent.slug}</code></p>
                  </div>
                  <Link className="button button--ghost button--small" href={`/agents/${agent.slug}`}>Inspect detail ↗</Link>
                </div>
                <ul className="excluded-row__reasons">
                  {agent.reasons.map((reason) => (
                    <li key={reason.code}>
                      <StatusBadge value={titleCase(reason.code)} tone="danger" />
                      <span>{reason.message}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section></details>
      ) : null}

      {response.mode !== "live" ? (
        <details className="state-preview-panel"><summary>Preview tools & data source</summary>
          <div>
            <p className="eyebrow">QA-friendly state previews</p>
            <h3>Every read state has a truthful UI path</h3>
            <p>These links are enabled only in non-production environments and never change the production data source.</p>
          </div>
          <div className="state-preview-panel__links">
            {(["loading", "empty", "degraded", "error"] as const).map((state) => (
              <Link className="button button--ghost button--small" href={`${pathname}?preview=${state}`} key={state}>
                {state} preview
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
