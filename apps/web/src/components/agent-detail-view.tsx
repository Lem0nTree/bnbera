import Link from "next/link";
import { Callout, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import { erc8004IdentityKey } from "@bnbera/domain";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, compactAddress, formatObservedAt, joinOrFallback, priceDisplayLabel, statusTone, titleCase } from "@/lib/presentation";
import { ActivationPanel } from "./activation-panel";
import { AgentDecisionSummary, AgentRating, AgentReviews } from "./agent-decision-summary";
import { AgentAvatar } from "./agent-avatar";
import { agentExplorerUrl, agentPriceLabel, heartbeatLabel } from "@/lib/agent-summary";
import { DirectoryAgentProfile } from "./directory-agent";
import { ProtocolRefresh } from "./protocol-refresh";

function SchemaPreview({ value }: { readonly value: Record<string, unknown> }) {
  return <details><summary>Inspect schema</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

function reputationViewSummary(view: MarketplaceAgentReadModel["metrics"]["reputation"]["rawPermissionless"]): string {
  if (view.count !== null) return `${view.count} active${view.source === null ? "" : ` · ${view.source}`}`;
  return view.reason ?? "Unavailable";
}

type ReputationView = MarketplaceAgentReadModel["metrics"]["reputation"]["rawPermissionless"];
type ReputationFeedback = ReputationView["feedback"][number];
type VerifiedPurchaseReview = MarketplaceAgentReadModel["metrics"]["reputation"]["verifiedReviews"][number];

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

function safeEvidenceLink(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function evidenceVersionLabel(
  artifact: Pick<MarketplaceAgentReadModel["evidence"]["profile"], "version">,
  currentVersion: number | null
): string {
  if (artifact.version === null) return "Not observed";
  return currentVersion !== null && artifact.version !== currentVersion
    ? `Agent version ${artifact.version} · historical snapshot`
    : `Agent version ${artifact.version}`;
}

export function evidenceSealLabel(
  artifact: Pick<MarketplaceAgentReadModel["evidence"]["profile"], "status" | "sealTransactionHash">
): string {
  if (artifact.status === "verified") {
    return artifact.sealTransactionHash === null
      ? "Seal confirmed; transaction hash unavailable."
      : "Seal confirmed";
  }
  return "Seal not confirmed";
}

function EvidenceArtifactRow({
  label,
  artifact,
  currentVersion
}: {
  readonly label: string;
  readonly artifact: MarketplaceAgentReadModel["evidence"]["profile"];
  readonly currentVersion: number | null;
}) {
  const readUrl = artifact.status === "verified" ? safeEvidenceLink(artifact.readUrl) : null;
  return (
    <div className="capability-card">
      <div className="detail-actions">
        <strong>{label}</strong>
        <StatusBadge value={titleCase(artifact.status)} tone={artifact.status === "verified" ? "success" : artifact.status === "failed" ? "danger" : artifact.status === "pending" ? "warning" : "neutral"} />
      </div>
      <div className="detail-kv"><span>Status</span><span>{artifact.summary}</span></div>
      <div className="detail-kv"><span>Version</span><span>{evidenceVersionLabel(artifact, currentVersion)}</span></div>
      {artifact.artifactType === "run_bundle" && <div className="detail-kv"><span>Bound commerce job</span><span><code>{artifact.jobId ?? "Not observed"}</code></span></div>}
      <div className="detail-kv"><span>Greenfield seal</span><span>{evidenceSealLabel(artifact)}{artifact.sealTransactionHash === null ? null : <> · <code>{artifact.sealTransactionHash}</code></>}</span></div>
      <div className="detail-kv"><span>Greenfield read URL</span><span>{readUrl === null ? "Unavailable" : <a href={readUrl} target="_blank" rel="noreferrer">Open verified JSON</a>}</span></div>
      <div className="detail-kv"><span>Internal locator</span><span><code>{artifact.locator ?? "Unavailable"}</code></span></div>
      <div className="detail-kv"><span>Last verified</span><span>{formatObservedAt(artifact.verifiedAt)}</span></div>
      <details><summary>Artifact integrity details</summary><p>SHA-256: <code>{artifact.sha256Digest ?? "Unavailable"}</code></p><p>Keccak: <code>{artifact.keccak256Digest ?? "Unavailable"}</code></p><p>{artifact.sizeBytes ?? "Unknown"} bytes · provider {artifact.provider ?? "Unavailable"}</p></details>
      {artifact.reason !== null && <p className="muted-label">{artifact.reason}</p>}
    </div>
  );
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
      <div className="detail-kv"><span>Reputation registry</span><span><code>{feedback.reputationRegistry}</code></span></div>
      <div className="detail-kv"><span>Reviewer</span><span><code>{feedback.reviewerAddress}</code></span></div>
      <div className="detail-kv"><span>Fixed-point value</span><span><code>{feedback.value}</code> · {feedback.valueDecimals} decimals</span></div>
      <div className="detail-kv"><span>Tags</span><span>{tags.length > 0 ? tags.map(([label, value]) => `${label}: ${value}`).join(" · ") : "Not observed"}</span></div>
      <div className="detail-kv"><span>Endpoint</span><span>{feedback.endpoint || "Not observed"}</span></div>
      <div className="detail-kv"><span>Feedback transaction / log</span><span><code>{feedback.feedbackTransactionHash}</code> · log {feedback.feedbackLogIndex}</span></div>
      <div className="detail-kv"><span>Feedback block / time</span><span>#{feedback.feedbackBlockNumber} · {formatObservedAt(feedback.feedbackObservedAt)}</span></div>
      <div className="detail-kv"><span>Feedback block hash</span><span><code>{feedback.feedbackBlockHash}</code></span></div>
      <div className="detail-kv"><span>Feedback URI</span><span><FeedbackUri value={feedback.feedbackUri} /></span></div>
      <div className="detail-kv"><span>Feedback hash</span><span><code>{feedback.feedbackHash ?? "Not observed"}</code></span></div>
      {feedback.revoked && (
        <>
          <div className="detail-kv"><span>Revocation transaction / log</span><span><code>{feedback.revocationTransactionHash}</code> · log {feedback.revocationLogIndex}</span></div>
          <div className="detail-kv"><span>Revocation block / time</span><span>#{feedback.revocationBlockNumber} · {formatObservedAt(feedback.revocationObservedAt)}</span></div>
          <div className="detail-kv"><span>Revocation block hash</span><span><code>{feedback.revocationBlockHash}</code></span></div>
        </>
      )}
    </div>
  );
}

function ReputationFeedbackView({ label, view }: { readonly label: string; readonly view: ReputationView }) {
  return (
    <div className="detail-section__body">
      <div className="detail-actions">
        <strong>{label}</strong>
        <StatusBadge value={titleCase(view.status)} tone={statusTone(view.status)} />
        {view.count !== null && <span className="muted-label">{view.count} active · {view.feedback.length} recorded</span>}
      </div>
      {view.feedback.length > 0
        ? view.feedback.map((feedback) => <ReputationFeedbackRecord key={`${feedback.feedbackTransactionHash}-${feedback.feedbackLogIndex}-${feedback.feedbackBlockHash}`} feedback={feedback} />)
        : <p className="detail-section__lede">{view.reason ?? "No feedback records are available in this view."}</p>}
    </div>
  );
}

function VerifiedPurchaseReviewRecord({ review }: { readonly review: VerifiedPurchaseReview }) {
  return (
    <div className="capability-card">
      <div className="detail-actions">
        <StatusBadge value={`${review.score}/5`} tone="success" />
        <span className="muted-label">Verified purchase · {formatObservedAt(review.observedAt)}</span>
      </div>
      <div className="detail-kv"><span>Reviewer</span><span><code>{review.reviewerAddress}</code></span></div>
      <div className="detail-kv"><span>Completed job</span><span><code>{review.commerceJobId}</code></span></div>
      <div className="detail-kv"><span>Result SHA-256</span><span><code>{review.resultSha256}</code></span></div>
      <div className="detail-kv"><span>Result Keccak</span><span><code>{review.resultKeccak}</code></span></div>
      <div className="detail-kv"><span>Settlement receipt</span><span><code>{review.settlementTransactionHash}</code></span></div>
      <div className="detail-kv"><span>Buyer comment</span><span>{review.comment || "No comment provided."}</span></div>
    </div>
  );
}

function VerifiedPurchaseReviewView({ reviews }: { readonly reviews: readonly VerifiedPurchaseReview[] }) {
  return (
    <div className="detail-section__body">
      <div className="detail-actions">
        <strong>Verified-purchase reviews</strong>
        <StatusBadge value={reviews.length > 0 ? `${reviews.length} observed` : "None observed"} tone={reviews.length > 0 ? "success" : "neutral"} />
      </div>
      {reviews.length > 0
        ? reviews.map((review) => <VerifiedPurchaseReviewRecord key={review.reviewId} review={review} />)
        : <p className="detail-section__lede">No settled BNBEra review is available for this listing.</p>}
    </div>
  );
}

export function AgentDetailView({ agent, sourceNotice }: { readonly agent: MarketplaceAgentReadModel; readonly sourceNotice?: string }) {
  if (agent.directory) return <DirectoryAgentProfile agent={agent}/>;
  const identityRead = agent.dataProvenance.identityRead;
  const identityConsistency = identityRead.readConsistency === null ? "Unknown" : titleCase(identityRead.readConsistency);
  const identityBlock = identityRead.observedBlock === null ? "Not observed" : `${identityRead.observedBlock} · ${identityConsistency}`;
  const profileReadUrl = agent.evidence.profile.status === "verified" ? safeEvidenceLink(agent.evidence.greenfieldUri) : null;
  const preview = agent.dataProvenance.mode === "fixture";
  const heartbeat = heartbeatLabel(agent);
  const explorerUrl = agentExplorerUrl(agent);
  return <div className="page-shell page-shell--tight agent-profile">
    <ProtocolRefresh intervalMs={agent.activation.boundedCapacity?5_000:30_000}/>
    <div className="detail-hero__crumbs"><Link href="/marketplace">← All agents</Link><span>{categoryLabel(agent.category)}</span></div>
    {agent.dataProvenance.mode !== "live" && <p className="preview-banner">{preview ? "Preview profile · Sample data. Hiring is unavailable." : "Recorded profile · Current availability could not be confirmed."}</p>}
    <section className="profile-header">
      <div className="profile-art"><AgentAvatar category={agent.category} name={agent.name} /></div>
      <div className="profile-intro">
        <div className="profile-category">{categoryLabel(agent.category)} · BNB {agent.identity.chainId === 97 ? "testnet" : "mainnet"}</div>
        <h1>{agent.name}</h1>
        <AgentRating agent={agent} />
        <p className="profile-purpose">{agent.description}</p>
        <div className="profile-summary">
          <div><span>Service check</span><strong className="heartbeat" data-online={heartbeat === "Interface verified"}><i />{heartbeat}</strong><small>{preview ? "No live heartbeat" : `Checked ${formatObservedAt(agent.health.observedAt)}`}</small></div>
          <div><span>Price</span><strong>{priceDisplayLabel(agent.pricing.label)}</strong><small>{preview ? "Sample price" : "Review quote before paying"}</small></div>
          {agent.metrics.reputation.verifiedPurchases.count !== null && <div><span>Buyer reviews</span><strong>{agent.metrics.reputation.verifiedPurchases.count}</strong><small>Verified purchases</small></div>}
          {agent.metrics.completedJobs.completedCount !== null && <div><span>Completed jobs</span><strong>{agent.metrics.completedJobs.completedCount}</strong><small>{agent.metrics.completedJobs.source}</small></div>}
          {explorerUrl && <div><span>On-chain data</span><a href={explorerUrl} target="_blank" rel="noreferrer">View registry ↗</a></div>}
        </div>
      </div>
      <aside className="profile-booking" aria-label="Price and hiring availability">
        <div className="profile-booking__heading"><span className="eyebrow">{agent.activation.enabled ? "Start your next task" : "Hiring availability"}</span><span className="booking-status" data-ready={!preview && agent.activation.enabled}><i aria-hidden="true"/>{!preview && agent.activation.enabled ? "Ready" : "Unavailable"}</span></div>
        <strong>{agentPriceLabel(agent)}</strong><p>{preview ? "Sample offer · Hiring unavailable" : agent.pricing.availability === "available" ? "Published price · confirm your quote before funding." : "No verified price is available."}</p>
        <dl className="profile-booking__facts"><div><dt>Network</dt><dd>BNB {agent.identity.chainId === 97 ? "testnet" : "mainnet"}</dd></div><div><dt>Payment</dt><dd>{agent.activation.method === "erc8183" ? "ERC-8183 escrow" : "No verified offer"}</dd></div>{agent.activation.boundedCapacity && <div><dt>Remaining task slots</dt><dd>{agent.activation.boundedCapacity.remaining}</dd></div>}</dl>
        <a className="button button--primary" href="#hire">{agent.activation.enabled ? "Review task & price" : "View availability"} <span aria-hidden="true">↗</span></a>
        <small>{preview ? "Preview data only" : agent.activation.enabled ? "You approve funding in your wallet. Settlement follows the quoted policy." : "New tasks are paused. You can still view existing hires."}</small>
        {agent.activation.boundedCapacity && <small>Readiness checked {formatObservedAt(agent.activation.boundedCapacity.checkedAt)}</small>}
      </aside>
    </section>
    <AgentDecisionSummary agent={agent} />
    <nav className="profile-nav" aria-label="Agent sections"><a href="#services">Services</a><a href="#reviews">Reviews</a><a href="#hire">Hire</a><a href="#technical-details">Technical details</a></nav>
    <section className="profile-services" id="services">
      <div className="profile-section-heading"><h2>What it does</h2><span>{agent.capabilityManifest.capabilities.length} advertised {agent.capabilityManifest.capabilities.length === 1 ? "capability" : "capabilities"}</span></div>
      <div className="profile-protocol-summary">{agent.services.map(service=><div key={`${service.kind}:${service.url}`}><strong>{service.kind.toUpperCase()}</strong><span className="protocol-status">{agent.services.length===1?heartbeatLabel(agent):"Advertised · individual check unavailable"}</span><small>{agent.services.length===1?`Checked ${formatObservedAt(agent.health.observedAt)}${agent.health.latencyMs!==null?` · ${agent.health.latencyMs} ms`:""}`:"The aggregate profile check is not attributed to this service."}</small><a href={service.url} target="_blank" rel="noreferrer">{service.kind==="a2a"?"Agent Card":"Service endpoint"} ↗</a></div>)}</div><p className="directory-footnote">Card or interface validation is separate from a completed task. A check expires after two minutes and is not an uptime measurement.</p>
      <div className="profile-service-grid">{agent.capabilityManifest.capabilities.length ? agent.capabilityManifest.capabilities.map((capability, index) => <article className="profile-service" key={capability.id}>
        <div className="profile-service__heading"><span className="profile-service__number">{String(index + 1).padStart(2, "0")}</span><span>Advertised capability</span></div>
        <h3>{capability.id.replaceAll(/[-_.:]+/gu, " ")}</h3><p>{capability.description}</p>
        {capability.requiredProtocols.length > 0 && <div className="profile-service__protocols">{capability.requiredProtocols.map(protocol => <span key={protocol}>{protocol}</span>)}</div>}
        <div className="profile-service__footer"><span>Review task compatibility<br/><small>{agent.activation.enabled ? "Quote confirmed before funding" : "Hiring currently unavailable"}</small></span><a className="button" href="#hire">{agent.activation.enabled ? "Review task" : "Availability"} <span aria-hidden="true">↗</span></a></div>
      </article>) : <p>No service description is available yet.</p>}</div>
    </section>
    <AgentReviews agent={agent} />
    <section className="profile-hire" id="hire">
      <div><h2>{agent.activation.enabled ? "Start a task" : "Hiring availability"}</h2><p>{preview ? "This is a sample profile. Explore its services or find another agent." : agent.activation.enabled ? "Describe your task, review the quote, then approve payment in your wallet." : "This agent is not accepting new tasks through BNBEra right now."}</p></div>
      {agent.activation.enabled || agent.activation.boundedCapacity ? <ActivationPanel activation={agent.activation} detail targetChainId={agent.identity.chainId === 56 ? 56 : 97} identityKey={erc8004IdentityKey(agent.identity)} runBundle={agent.evidence.runBundle} /> : <><p>{agent.activation.reason}</p><div className="detail-actions"><Link className="button" href="/marketplace">Explore agents →</Link><Link className="button button--ghost" href="/hired">View existing hires</Link></div></>}
    </section>
    <details className="profile-technical" id="technical-details"><summary>Technical details <span>Identity, heartbeat history & evidence</span></summary>
      {sourceNotice && <p className="detail-section__lede">{sourceNotice}</p>}
      <p className="detail-section__lede">{agent.dataProvenance.label} · {agent.dataProvenance.details}</p>
      <p className="detail-section__lede">Hiring: {agent.activation.reason} {agent.activation.nextAction}</p>
      <p className="detail-section__lede">Pricing: {priceDisplayLabel(agent.pricing.explanation)}</p>
      <details className="detail-section"><summary>Capability schemas</summary>{agent.capabilityManifest.capabilities.map(capability => <div className="capability-card" key={capability.id}><h3>{capability.id}</h3><p>{capability.description}</p><div className="schema-pair"><div>Input<SchemaPreview value={capability.inputSchema} /></div><div>Output<SchemaPreview value={capability.outputSchema} /></div></div></div>)}</details>
        <details className="detail-section" id="track-record"><summary>Track record & reputation</summary>
          <p className="eyebrow">Observed marketplace metrics</p>
          <h2>Track record & reputation</h2>
          <p className="detail-section__lede">These fields are persisted observations, not estimates. Missing external feedback, jobs, results, or uptime samples stay explicitly unavailable.</p>
          <div className="detail-section__body">
            <div className="detail-kv"><span>Observed probe samples</span><span>{agent.metrics.uptime.status === "observed" ? `${agent.metrics.uptime.successfulChecks}/${agent.metrics.uptime.attemptedChecks} successful · ${Math.round((agent.metrics.uptime.successRatio ?? 0) * 100)}%` : "Not observed"}</span></div>
            <div className="detail-kv"><span>Observed span / coverage</span><span>{agent.metrics.uptime.windowSeconds === null ? "Not observed" : `${agent.metrics.uptime.windowSeconds === 0 ? "0 sec" : `${Math.round(agent.metrics.uptime.windowSeconds / 60)} min`} observed · ${Math.round((agent.metrics.uptime.coverageRatio ?? 0) * 100)}% of ${Math.round((agent.metrics.uptime.monitoringWindowSeconds ?? 0) / 60)} min horizon · ${formatObservedAt(agent.metrics.uptime.observedFrom)} to ${formatObservedAt(agent.metrics.uptime.observedTo)}`}</span></div>
            <div className="detail-kv"><span>Raw ERC-8004 feedback</span><span>{reputationViewSummary(agent.metrics.reputation.rawPermissionless)}</span></div>
            <div className="detail-kv"><span>Recognized reviewer / validator</span><span>{reputationViewSummary(agent.metrics.reputation.recognizedReviewers)}</span></div>
            <div className="detail-kv"><span>BNBEra verified-purchase reviews</span><span>{reputationViewSummary(agent.metrics.reputation.verifiedPurchases)}</span></div>
            <div className="detail-kv"><span>Completed jobs</span><span>{agent.metrics.completedJobs.completedCount === null ? "Unavailable" : agent.metrics.completedJobs.completedCount} · {agent.metrics.completedJobs.source ?? "No source"}</span></div>
            <div className="detail-kv"><span>Latest settled result / receipt</span><span>{agent.metrics.lastResult.summary ?? "Unavailable"}{agent.metrics.lastResult.reference === null ? "" : ` · ${agent.metrics.lastResult.reference}`}</span></div>
            <p className="muted-label">Metrics are observed from persisted probes/enrichment only; no live qualification or fabricated zero values are implied.</p>
          </div>
          <ReputationFeedbackView label="Raw permissionless feedback provenance" view={agent.metrics.reputation.rawPermissionless} />
          <ReputationFeedbackView label="Recognized reviewer / validator provenance" view={agent.metrics.reputation.recognizedReviewers} />
          <ReputationFeedbackView label="BNBEra verified-purchase review provenance" view={agent.metrics.reputation.verifiedPurchases} />
          <VerifiedPurchaseReviewView reviews={agent.metrics.reputation.verifiedReviews} />
        </details>
        <details className="detail-section" id="current-data"><summary>Current data & freshness</summary>
          <p className="eyebrow">Current data</p>
          <h2>Live data & freshness</h2>
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
        </details>
      <details className="detail-section technical-details" id="identity-and-services"><summary>Identity, services & permissions</summary><p className="detail-section__lede">Registration, service checks, and execution permissions are separate facts.</p>
        <details className="detail-hero__identity"><summary>Identity details · agent #{agent.identity.agentId}</summary>
          <div>
            <p className="eyebrow">Full ERC-8004 identity</p>
            <h2>Identity is the tuple</h2>
          </div>
          <div className="identity-line"><span>Namespace</span><span>{agent.identity.namespace}</span></div>
          <div className="identity-line"><span>Chain ID</span><span>{agent.identity.chainId}</span></div>
          <div className="identity-line"><span>Identity registry</span><span>{agent.identity.identityRegistry}</span></div>
          <div className="identity-line"><span>Agent ID</span><span>{agent.identity.agentId}</span></div>
          <div className="identity-line"><span>Owner observed</span><span>{agent.ownerAddress ?? "Not observed"}</span></div>
          <div className="identity-line"><span>Agent wallet observed</span><span>{agent.agentWallet ?? "Not observed"}</span></div>
        </details>

        <h2>Independent listing states</h2><StateAxisGrid axes={agent.stateAxes} />
        <section className="detail-section detail-section--wide" id="overview">
          <p className="eyebrow">Observed boundaries</p>
          <h2>Availability & observations</h2>
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
        <section className="detail-section">
          <p className="eyebrow">Discovered service faces</p>
          <h2>How a service is reached</h2>
          <p className="detail-section__lede">URLs and protocol versions come from registered metadata or reviewed adapters; no universal path is assumed.</p>
          <div className="service-list">
            {agent.services.length > 0 ? agent.services.map((service) => (
              <div className="service-row" key={`${service.kind}-${service.url}`}>
                <span className="service-row__kind">{service.kind} · {service.protocolVersion ?? "Version not observed"}</span>
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
                  <p className="muted-label">Test observed: {formatObservedAt(evidence.testedAt)}</p>
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
          <p className="detail-section__lede">Discovery and ownership do not grant execution permission. Authority below describes this agent's observed permissions.</p>
          <div className="detail-section__body">
            <div className="detail-kv"><span>Status</span><span><StatusBadge value={agent.authority.status} tone={statusTone(agent.authority.status)} /></span></div>
            <div className="detail-kv"><span>Provider</span><span>{titleCase(agent.authority.provider)}</span></div>
            <div className="detail-kv"><span>Execution wallet</span><span>{compactAddress(agent.authority.executionWallet)}</span></div>
            <div className="detail-kv"><span>Expiry</span><span>{formatObservedAt(agent.authority.expiry)}</span></div>
            <div className="detail-kv"><span>Spend cap</span><span>{agent.authority.spendCap ?? "Not observed"}</span></div>
            <p className="detail-section__lede">{agent.authority.summary}</p>
          </div>
        </section>
      </details>
        <details className="detail-section detail-section--wide" id="public-evidence"><summary>Evidence & provenance</summary>
          <p className="eyebrow">Evidence availability</p>
          <h2>Public evidence</h2>
          <p className="detail-section__lede">Greenfield is linked only after seal and read-back hash verification; IPFS and Greenfield states remain independent.</p>
          <div className="detail-section__body">
            <details><summary>Identity & source provenance</summary>{agent.dataProvenance.sources.map((source) => <div className="capability-card" key={`${source.source}:${source.sourceReference}`}><strong>{source.source}</strong><p>{source.sourceReference}</p><p>First seen {formatObservedAt(source.firstObservedAt)} · last seen {formatObservedAt(source.lastObservedAt)}</p><p>Ingestion version {source.normalizedIngestionVersion}</p><code>{source.rawResponseDigest ?? "Digest unavailable"}</code></div>)}</details>
            <StatusBadge value={agent.evidence.status} tone={statusTone(agent.evidence.status)} />
            <p className="detail-section__lede">{agent.evidence.summary}</p>
            <div className="detail-kv"><span>IPFS</span><span>{agent.evidence.ipfsUri ?? "Unavailable"}</span></div>
            <div className="detail-kv"><span>Greenfield</span><span>{profileReadUrl === null ? "Unavailable" : <a href={profileReadUrl} target="_blank" rel="noreferrer">Open verified profile JSON</a>}</span></div>
            <div className="detail-kv"><span>Profile locator</span><span><code>{agent.evidence.greenfieldLocator ?? "Unavailable"}</code></span></div>
            <div className="detail-kv"><span>Last verified</span><span>{formatObservedAt(agent.evidence.lastVerifiedAt)}</span></div>
            <div className="detail-section__body">
              <EvidenceArtifactRow label="Versioned agent_profile" artifact={agent.evidence.profile} currentVersion={agent.evidence.currentVersion} />
              <EvidenceArtifactRow label="Completed-job run_bundle" artifact={agent.evidence.runBundle} currentVersion={agent.evidence.currentVersion} />
            </div>
          </div>
        </details>
    </details>
  </div>;
}
