import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import { erc8004IdentityKey } from "@bnbera/domain";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, formatObservedAt, titleCase } from "@/lib/presentation";
import { AgentAvatar } from "./agent-avatar";

type Agent = MarketplaceAgentReadModel;
const rows: ReadonlyArray<{ label: string; render: (agent: Agent) => ReactNode }> = [
  { label: "What it does", render: (a) => <p>{a.description}</p> },
  { label: "Category", render: (a) => categoryLabel(a.category) },
  { label: "Capabilities", render: (a) => <ul className="compare-reasons">{a.capabilityManifest.capabilities.map((c) => <li key={c.id}>{c.description}</li>)}</ul> },
  { label: "Price", render: (a) => <><strong>{a.pricing.label}</strong><p>{a.pricing.explanation}</p></> },
  { label: "Availability", render: (a) => <><StatusBadge value={a.activation.enabled ? "Available to hire" : "Hiring unavailable"} tone={a.activation.enabled ? "success" : "neutral"} /><p>{a.activation.reason}</p></> },
  { label: "Observed uptime", render: (a) => <>{a.metrics.uptime.status === "observed" ? `${a.metrics.uptime.successfulChecks}/${a.metrics.uptime.attemptedChecks} successful checks` : "Not observed"}<p>Observed {formatObservedAt(a.health.observedAt)} · {titleCase(a.health.endpointStatus)}</p><p>{a.freshness.label}</p></> },
  { label: "Completed jobs", render: (a) => <>{a.metrics.completedJobs.completedCount ?? "Not available"}<p>{a.metrics.completedJobs.source ?? "Source unavailable"}</p></> },
  { label: "Buyer reviews", render: (a) => <>{a.metrics.reputation.verifiedPurchases.count ?? "Not available"}<p>Verified BNBEra purchases</p></> },
  { label: "Other reputation", render: (a) => <><p>Recognized reviewers: {a.metrics.reputation.recognizedReviewers.count ?? "Not available"}</p><p>Raw onchain feedback: {a.metrics.reputation.rawPermissionless.count ?? "Not available"}</p></> },
  { label: "Technical details", render: (a) => <details><summary>Identity, services & states</summary><code>{erc8004IdentityKey(a.identity)}</code><p>{a.protocols.join(", ") || "Protocols not observed"}</p><StateAxisGrid axes={a.stateAxes} compact /><p>Eligibility: {a.eligibility.eligible ? a.eligibility.score ?? "No score" : "Excluded"}</p>{a.eligibility.reasons.map((r) => <p key={r.code}>{r.message}</p>)}<p>{a.authority.summary}</p><p>Authority: {a.authority.status} · expiry {formatObservedAt(a.authority.expiry)}</p></details> },
  { label: "Evidence & provenance", render: (a) => <details><summary>{a.dataProvenance.mode === "live" ? "Inspect evidence" : "Preview data"}</summary><p>{a.dataProvenance.details}</p><p>{a.evidence.summary}</p><p>Identity observed {formatObservedAt(a.dataProvenance.identityRead.observedAt)}</p><Link className="text-link" href={`/agents/${a.slug}#public-evidence`}>View complete evidence →</Link></details> }
];

export function CompareTable({ agents }: { readonly agents: readonly Agent[] }) {
  if (agents.length === 0) return <EmptyState title="Find your shortlist" action={<Link className="button button--primary" href="/marketplace">Explore agents →</Link>}>Add up to three agents from the marketplace to compare what they do, what they cost, and their track record.</EmptyState>;
  return <section aria-label="Compare agents">
    <p className="compare-scroll-hint">{agents.length} {agents.length === 1 ? "agent" : "agents"} selected. Scroll sideways to compare. Keyboard: focus the comparison, then use arrow keys.</p>
    <div className="compare-table-wrap" role="region" aria-label="Agent comparison; scroll horizontally to inspect all agents" tabIndex={0}>
      <table className="comparison-table" style={{ minWidth: `${10 + agents.length * 18}rem` }}>
        <caption className="sr-only">Agent capabilities, prices, and evidence comparison</caption>
        <thead><tr><th scope="col">Your shortlist</th>{agents.map((a) => <th scope="col" key={a.id}><AgentAvatar category={a.category} /><h2>{a.name}</h2><p>BNB {a.identity.chainId === 97 ? "Testnet" : "Mainnet"}</p>{a.dataProvenance.mode !== "live" && <StatusBadge value={a.dataProvenance.mode === "fixture" ? "Development fixture" : "Degraded data"} tone="warning" />}<Link className="button button--small" href={`/agents/${a.slug}`}>View agent ↗</Link></th>)}</tr></thead>
        <tbody>{rows.map(({label, render}) => <tr key={label}><th scope="row">{label}</th>{agents.map((a) => <td key={a.id}>{render(a)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
