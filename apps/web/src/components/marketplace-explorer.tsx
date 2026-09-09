"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Callout, DataModeBadge, EmptyState, LoadingState, StatusBadge } from "@bnbera/ui";
import type { MarketplaceSearchResponse } from "@/lib/marketplace-contract";
import { categoryDescription, categoryLabel, titleCase } from "@/lib/presentation";
import { AgentCard } from "./agent-card";

const categories = [
  "rebalancing",
  "grid-trading",
  "yield-optimisation",
  "health-factor"
] as const;

function modeTone(response: MarketplaceSearchResponse): "info" | "warning" | "danger" | "success" {
  if (response.status === "error") {
    return "danger";
  }
  if (response.status === "degraded") {
    return "warning";
  }
  if (response.mode === "live") {
    return "success";
  }
  return "info";
}

function paramsForCategory(searchString: string, category: string): string {
  const params = new URLSearchParams();
  const search = new URLSearchParams(searchString);
  for (const key of ["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness", "sort", "agents"]) {
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
  const query = params.toString();
  return `/marketplace${query ? `?${query}` : ""}`;
}

export function MarketplaceExplorer({ response }: { readonly response: MarketplaceSearchResponse }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentCategory = response.selection.category;
  const selectedCompare = searchParams.get("agents");
  const searchString = searchParams.toString();

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
    if (selectedCompare) next.set("agents", selectedCompare);
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
          <DataModeBadge mode={response.mode} label={response.dataLabel} />
          <span>
            {response.total} eligible record{response.total === 1 ? "" : "s"}
            {response.excluded.length > 0 ? ` · ${response.excluded.length} excluded before ranking` : ""}
          </span>
        </div>
        {selectedCompare ? (
          <Link className="compare-bar" href={`/compare?agents=${encodeURIComponent(selectedCompare)}`}>
            Compare selected <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>

      <Callout title="Read-only marketplace boundary" tone={modeTone(response)} icon={response.status === "error" ? "!" : "i"}>
        {response.notice}
      </Callout>

      <div className="category-tabs" aria-label="Marketplace categories">
        <Link
          aria-current={!currentCategory ? "page" : undefined}
          className={!currentCategory ? "category-tab category-tab--active" : "category-tab"}
          href={paramsForAllSupply(searchString)}
        >
          All agents <span>⌁</span>
        </Link>
        {categories.map((category) => (
          <Link
            aria-current={currentCategory === category ? "page" : undefined}
            className={currentCategory === category ? "category-tab category-tab--active" : "category-tab"}
            href={paramsForCategory(searchString, category)}
            key={category}
          >
            <span>{categoryLabel(category)}</span>
            <small>{categoryDescription(category).split(" ").slice(0, 2).join(" ")}…</small>
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
            <option value="score">Eligibility score</option>
            <option value="freshness">Freshness</option>
          </select>
        </label>
        <button className="button button--primary filter-panel__submit" type="submit">Apply filters</button>
      </form>
      <div className="applied-filters">{["q", "chainId", "origin", "verification", "runtime", "protocol", "freshness"].filter((key) => searchParams.has(key)).map((key) => { const params = new URLSearchParams(searchString); params.delete(key); return <Link key={key} href={`${pathname}?${params}`} aria-label={`Remove ${key} filter`}>{titleCase(key)}: {searchParams.get(key)} ×</Link>; })}<Link href={`${pathname}${selectedCompare ? `?agents=${encodeURIComponent(selectedCompare)}` : ""}`}>Clear filters</Link></div>

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
      {response.status === "degraded" ? (
        <Callout title="Degraded data" tone="warning" icon="!">
          Browse the labelled preview if useful, but do not interpret runtime, freshness, eligibility, or evidence fields as live proof.
        </Callout>
      ) : null}

      {response.agents.length > 0 ? (
        <div className="agent-grid">
          {response.agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)}
        </div>
      ) : null}

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
        <div className="state-preview-panel">
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
        </div>
      ) : null}
    </div>
  );
}
