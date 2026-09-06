import Link from "next/link";
import { Callout, DataModeBadge, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, compactAddress, formatObservedAt, joinOrFallback, statusTone, titleCase } from "@/lib/presentation";
import { ActivationPanel } from "./activation-panel";
import { CompareToggle } from "./compare-toggle";

function SchemaPreview({ value }: { readonly value: Record<string, unknown> }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function reputationViewSummary(view: MarketplaceAgentReadModel["metrics"]["reputation"]["rawPermissionless"]): string {
  if (view.count !== null) return `${view.count} active${view.source === null ? "" : ` · ${view.source}`}`;
  return view.reason ?? "Unavailable";
}

type ReputationView = MarketplaceAgentReadModel["metrics"]["reputation"]["rawPermissionless"];
type ReputationFeedback = ReputationView["feedback"][number];

/** Only HTTP(S) feedback URIs become links; every other URI stays inert text. */
function safeFeedbackLink(value: string): string | null {
  if (value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function FeedbackUri({ value }: { readonly value: string }) {
  if (value.length === 0) return <span>Not observed</span>;
  const href = safeFeedbackLink(value);
  return href === null
    ? <code>{value}</code>
    : <a href={href} target="_blank" rel="noreferrer">{value}</a>;
}

function ReputationFeedbackRecord({ feedback }: { readonly feedback: ReputationFeedback }) {
  const tags: Array<readonly [string, string]> = [
    ["Indexed tag", feedback.indexedTag1] as const,
    ["Tag 1", feedback.tag1] as const,
    ["Tag 2", feedback.tag2] as const
  ].filter((tag) => tag[1] !== undefined && tag[1].length > 0);
  return (
    <div className="capability-card">
      <div className="detail-actions">
        <StatusBadge value={feedback.revoked ? "Revoked" : "Active"} tone={feedback.revoked ? "danger" : "success"} />
        <span className="muted-label">ERC-8004 feedback #{feedback.feedbackIndex}</span>
      </div>
      <div className="detail-kv"><span>Reviewer</span><span><code>{feedback.reviewerAddress}</code></span></div>
      <div className="detail-kv"><span>Fixed-point value</span><span><code>{feedback.value}</code> · {feedback.valueDecimals} decimals</span></div>
      <div className="detail-kv"><span>Tags</span><span>{tags.length > 0 ? tags.map(([label, value]) => `${label}: ${value}`).join(" · ") : "Not observed"}</span></div>
      <div className="detail-kv"><span>Feedback block / time</span><span>#{feedback.feedbackBlockNumber} · {formatObservedAt(feedback.feedbackObservedAt)}</span></div>
      <div className="detail-kv"><span>Feedback block hash</span><span><code>{feedback.feedbackBlockHash}</code></span></div>
      <div className="detail-kv"><span>Feedback URI</span><span><FeedbackUri value={feedback.feedbackUri} /></span></div>
      <div className="detail-kv"><span>Feedback hash</span><span><code>{feedback.feedbackHash ?? "Not observed"}</code></span></div>
      {feedback.revoked && (
        <div className="detail-kv"><span>Revocation provenance</span><span><code>{feedback.revocationTransactionHash}</code> · block #{feedback.revocationBlockNumber} · {formatObservedAt(feedback.revocationObservedAt)}</span></div>
      )}
    </div>
  );
}

function ReputationFeedbackView({ label, view }: { readonly label: string; readonly view: ReputationView }) {
  if (view.feedback.length === 0) return null;
  return (
    <div className="detail-section__body">
      <div className="detail-actions"><strong>{label}</strong><span className="muted-label">{view.count ?? 0} active · {view.feedback.length} recorded</span></div>
      {view.feedback.map((feedback) => <ReputationFeedbackRecord key={`${feedback.feedbackTransactionHash}-${feedback.feedbackLogIndex}-${feedback.feedbackBlockHash}`} feedback={feedback} />)}
    </div>
  );
}

export function AgentDetailView({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
  const identityRead = agent.dataProvenance.identityRead;
  const identityConsistency = identityRead.readConsistency === null
    ? "Unknown"
    : titleCase(identityRead.readConsistency);
  const identityBlock = identityRead.observedBlock === null
    ? "Not observed"
    : `${identityRead.observedBlock} · ${identityConsistency}`;
  return (
    <div className="page-shell page-shell--tight">
      <section className="detail-hero">
        <div>
          <div className="detail-hero__crumbs"><Link href="/marketplace">Marketplace</Link> <span aria-hidden="true">/</span> {categoryLabel(agent.category)} <span aria-hidden="true">/</span> {agent.name}</div>
          <div className="agent-card__category">
            <span className={`category-mark category-mark--${agent.category}`} aria-hidden="true">{agent.category.slice(0, 1).toUpperCase()}</span>
            {categoryLabel(agent.category)}
          </div>
          <h1>{agent.name}</h1>
          <p className="detail-hero__tagline">{agent.tagline}</p>
          <div className="detail-hero__meta">
            <DataModeBadge mode={agent.dataProvenance.mode} label={agent.dataProvenance.label} />
            <StatusBadge value={agent.stateAxes.verificationStatus} tone={statusTone(agent.stateAxes.verificationStatus)} />
            <StatusBadge value={agent.stateAxes.runtimeStatus} tone={statusTone(agent.stateAxes.runtimeStatus)} />
            <StatusBadge label="Endpoint" value={titleCase(agent.health.endpointStatus)} tone={statusTone(agent.health.endpointStatus)} />
            <StatusBadge value={`BSC ${agent.identity.chainId}`} tone="info" />
          </div>
          <div className="detail-hero__actions">
            <CompareToggle slug={agent.slug} />
            <Link className="button button--ghost button--small" href={`/compare?agents=${agent.slug}`}>Open comparison</Link>
          </div>
        </div>
        <div className="detail-hero__identity">
          <div>
            <p className="eyebrow">Full ERC-8004 identity</p>
            <h2>Identity is the tuple</h2>
          </div>
          <div className="identity-line"><span>Namespace</span><span>{agent.identity.namespace}</span></div>
          <div className="identity-line"><span>Chain ID</span><span>{agent.identity.chainId}</span></div>
          <div className="identity-line"><span>Identity registry</span><span>{agent.identity.identityRegistry}</span></div>
          <div className="identity-line"><span>Agent ID</span><span>{agent.identity.agentId}</span></div>
          <div className="identity-line"><span>Owner observed</span><span>{compactAddress(agent.ownerAddress)}</span></div>
          <div className="identity-line"><span>Agent wallet observed</span><span>{compactAddress(agent.agentWallet)}</span></div>
        </div>
      </section>

      <section className="section-block section-block--flush">
        <Callout title="Provenance boundary" tone="info" icon="i">
          {agent.dataProvenance.details} State labels below describe the read record shape and are not live evidence while the adapter is in fixture or degraded mode.
        </Callout>
      </section>

      <div className="detail-sections">
        <section className="detail-section detail-section--wide">
          <p className="eyebrow">Observed boundaries</p>
          <h2>Database connectivity is not endpoint health</h2>
          <p className="detail-section__lede">The connected read model preserves the exact ERC-8004 chain observation and the independent service probe. Neither observation grants authority or guarantees a future response.</p>
          <div className="detail-section__body detail-section__body--split">
            <div className="detail-kv"><span>Endpoint health</span><span><StatusBadge value={titleCase(agent.health.endpointStatus)} tone={statusTone(agent.health.endpointStatus)} /></span></div>
            <div className="detail-kv"><span>Probe observed</span><span>{formatObservedAt(agent.health.observedAt)}{agent.health.latencyMs === null ? "" : ` · ${agent.health.latencyMs} ms`}</span></div>
            <div className="detail-kv"><span>Probe source</span><span>{agent.health.source ?? "Not observed"}</span></div>
            <div className="detail-kv"><span>Identity block · consistency</span><span>{identityBlock}</span></div>
            <div className="detail-kv"><span>Identity read observed</span><span>{formatObservedAt(identityRead.observedAt)}</span></div>
            <div className="detail-kv"><span>Identity block hash</span><span><code>{identityRead.observedBlockHash ?? "Not observed"}</code></span></div>
          </div>
        </section>

        <section className="detail-section detail-section--wide">
          <p className="eyebrow">Independent state model</p>
          <h2>Six axes, no overloaded status field</h2>
          <p className="detail-section__lede">Origin, claim, verification, runtime, authority, and listing can change independently. A claim never implies liveness or publication.</p>
          <StateAxisGrid axes={agent.stateAxes} />
        </section>

        <section className="detail-section">
          <p className="eyebrow">Capability manifest</p>
          <h2>What this agent advertises</h2>
          <p className="detail-section__lede">Structured inputs and outputs remain separate from live financial data and execution controls.</p>
          <div className="detail-section__body">
            {agent.capabilityManifest.capabilities.map((capability) => (
              <div className="capability-card" key={capability.id}>
                <h3>{capability.id}</h3>
                <p>{capability.description}</p>
                <div className="schema-pair">
                  <div><span>Input schema</span><SchemaPreview value={capability.inputSchema} /></div>
                  <div><span>Output schema</span><SchemaPreview value={capability.outputSchema} /></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Discovered service faces</p>
          <h2>How a service is reached</h2>
          <p className="detail-section__lede">URLs and protocol versions come from registered metadata or reviewed adapters; no universal path is assumed.</p>
          <div className="service-list">
            {agent.services.length > 0 ? agent.services.map((service) => (
              <div className="service-row" key={`${service.kind}-${service.url}`}>
                <span className="service-row__kind">{service.kind}</span>
                <span className="service-row__url">{service.url}</span>
                <StatusBadge value={service.validationStatus} tone={statusTone(service.validationStatus)} />
              </div>
            )) : <p className="detail-section__lede">No service observations returned.</p>}
          </div>
          {agent.serviceEvidence.length > 0 && (
            <div className="detail-section__body">
              {agent.serviceEvidence.map((evidence) => (
                <div className="capability-card" key={`${evidence.kind}-${evidence.advertisedUrl}`}>
                  <div className="detail-kv"><span>Advertised {evidence.kind} URL</span><span>{evidence.advertisedUrl}</span></div>
                  <div className="detail-kv"><span>Agent Card URL</span><span>{evidence.cardUrl ?? "Not observed"}</span></div>
                  <div className="detail-kv"><span>Invocation URL(s)</span><span>{evidence.invocationUrls.length > 0 ? evidence.invocationUrls.join(", ") : "Not observed"}</span></div>
                  <div className="detail-kv"><span>Advertised skills</span><span>{evidence.advertisedSkills.map((skill) => skill.id).join(", ") || "Not observed"}</span></div>
                  <div className="detail-kv"><span>Tested skills</span><span>{evidence.testedSkills.length > 0 ? evidence.testedSkills.map((skill) => skill.id).join(", ") : "None — transport/card check only"}</span></div>
                  <StatusBadge value={titleCase(evidence.testStatus)} tone={evidence.testStatus === "verified" ? "success" : "neutral"} />
                </div>
              ))}
            </div>
          )}
          <div className="detail-actions">
            <StatusBadge value={`Observed ${formatObservedAt(agent.freshness.observedAt)}`} tone="neutral" />
            <StatusBadge value={`Protocol ${joinOrFallback(agent.protocols, "not observed")}`} tone="purple" />
          </div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Current data</p>
          <h2>Freshness before interpretation</h2>
          <p className="detail-section__lede">Live DeFi values remain structured and timestamped. They never enter semantic ranking text.</p>
          {agent.currentData.status === "unavailable" ? (
            <Callout title="Current data unavailable" tone="warning" icon="!">{agent.currentData.summary} Execution must fail closed when freshness cannot be verified.</Callout>
          ) : (
            <div className="detail-section__body">
              <StatusBadge value={agent.currentData.status} tone={statusTone(agent.currentData.status)} />
              <p className="detail-section__lede">{agent.currentData.summary}</p>
              {agent.currentData.items.map((item) => <div className="detail-kv" key={item.label}><span>{item.label}</span><span>{item.value} · {item.source}</span></div>)}
            </div>
          )}
          <div className="detail-actions"><StatusBadge value={agent.freshness.label} tone={statusTone(agent.freshness.status)} /><span className="muted-label">{agent.freshness.source}</span></div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Observed marketplace metrics</p>
          <h2>Counts require provenance</h2>
          <p className="detail-section__lede">These fields are persisted observations, not estimates. Missing external feedback, jobs, results, or uptime samples stay explicitly unavailable.</p>
          <div className="detail-section__body">
            <div className="detail-kv"><span>Observed probe samples</span><span>{agent.metrics.uptime.status === "observed" ? `${agent.metrics.uptime.successfulChecks}/${agent.metrics.uptime.attemptedChecks} successful · ${Math.round((agent.metrics.uptime.successRatio ?? 0) * 100)}%` : "Not observed"}</span></div>
            <div className="detail-kv"><span>Observed span / coverage</span><span>{agent.metrics.uptime.windowSeconds === null ? "Not observed" : `${agent.metrics.uptime.windowSeconds === 0 ? "0 sec" : `${Math.round(agent.metrics.uptime.windowSeconds / 60)} min`} observed · ${Math.round((agent.metrics.uptime.coverageRatio ?? 0) * 100)}% of ${Math.round((agent.metrics.uptime.monitoringWindowSeconds ?? 0) / 60)} min horizon · ${formatObservedAt(agent.metrics.uptime.observedFrom)} to ${formatObservedAt(agent.metrics.uptime.observedTo)}`}</span></div>
            <div className="detail-kv"><span>Raw ERC-8004 feedback</span><span>{reputationViewSummary(agent.metrics.reputation.rawPermissionless)}</span></div>
            <div className="detail-kv"><span>Recognized reviewer / validator</span><span>{reputationViewSummary(agent.metrics.reputation.recognizedReviewers)}</span></div>
            <div className="detail-kv"><span>BNBEra verified-purchase reviews</span><span>{reputationViewSummary(agent.metrics.reputation.verifiedPurchases)}</span></div>
            <div className="detail-kv"><span>Completed jobs</span><span>{agent.metrics.completedJobs.completedCount === null ? "Unavailable" : agent.metrics.completedJobs.completedCount} · {agent.metrics.completedJobs.source ?? "No source"}</span></div>
            <div className="detail-kv"><span>Last result</span><span>{agent.metrics.lastResult.summary ?? "Unavailable"}{agent.metrics.lastResult.reference === null ? "" : ` · ${agent.metrics.lastResult.reference}`}</span></div>
            <p className="muted-label">Metrics are observed from persisted probes/enrichment only; no live qualification or fabricated zero values are implied.</p>
          </div>
          <ReputationFeedbackView label="Raw permissionless feedback provenance" view={agent.metrics.reputation.rawPermissionless} />
          <ReputationFeedbackView label="Recognized reviewer / validator provenance" view={agent.metrics.reputation.recognizedReviewers} />
        </section>

        <section className="detail-section">
          <p className="eyebrow">Eligibility explanation</p>
          <h2>{agent.eligibility.eligible ? "Eligible for the requested read" : "Excluded before ranking"}</h2>
          <p className="detail-section__lede">Hard filters run before semantic retrieval. A score cannot rescue a failed chain, protocol, health, authority, price, or freshness requirement.</p>
          <div className="detail-section__body">
            <StatusBadge value={agent.eligibility.score === null ? "No score" : `${agent.eligibility.score}/100`} tone={agent.eligibility.eligible ? "success" : "danger"} />
            {agent.eligibility.reasons.map((reason) => <div className="detail-kv" key={reason.code}><span>{reason.code}</span><span>{reason.message}</span></div>)}
          </div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Authority summary</p>
          <h2>Who can execute, and when</h2>
          <p className="detail-section__lede">Discovery and claim never grant BNBEra execution authority. The current web slice does not create or sign sessions.</p>
          <div className="detail-section__body">
            <div className="detail-kv"><span>Status</span><span><StatusBadge value={agent.authority.status} tone={statusTone(agent.authority.status)} /></span></div>
            <div className="detail-kv"><span>Provider</span><span>{titleCase(agent.authority.provider)}</span></div>
            <div className="detail-kv"><span>Execution wallet</span><span>{compactAddress(agent.authority.executionWallet)}</span></div>
            <div className="detail-kv"><span>Expiry</span><span>{formatObservedAt(agent.authority.expiry)}</span></div>
            <div className="detail-kv"><span>Spend cap</span><span>{agent.authority.spendCap ?? "Not observed"}</span></div>
            <p className="detail-section__lede">{agent.authority.summary}</p>
          </div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Pricing & activation</p>
          <h2>Next action is explicit</h2>
          <p className="detail-section__lede">A price or activation method is shown only when the read model supplies one. This record has no enabled rail.</p>
          <div className="detail-section__body">
            <div className="detail-kv"><span>Pricing</span><span>{agent.pricing.label}</span></div>
            <div className="detail-kv"><span>Method</span><span>{titleCase(agent.pricing.activationMethod)}</span></div>
            <p className="detail-section__lede">{agent.pricing.explanation}</p>
            <ActivationPanel activation={agent.activation} detail identifier={agent.slug} />
          </div>
        </section>

        <section className="detail-section">
          <p className="eyebrow">Evidence availability</p>
          <h2>Integrity is a separate gate</h2>
          <p className="detail-section__lede">Greenfield is linked only after seal and read-back hash verification; IPFS and Greenfield states remain independent.</p>
          <div className="detail-section__body">
            <StatusBadge value={agent.evidence.status} tone={statusTone(agent.evidence.status)} />
            <p className="detail-section__lede">{agent.evidence.summary}</p>
            <div className="detail-kv"><span>IPFS</span><span>{agent.evidence.ipfsUri ?? "Unavailable"}</span></div>
            <div className="detail-kv"><span>Greenfield</span><span>{agent.evidence.greenfieldUri ?? "Unavailable"}</span></div>
            <div className="detail-kv"><span>Last verified</span><span>{formatObservedAt(agent.evidence.lastVerifiedAt)}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
