import Link from "next/link";
import { Callout, DataModeBadge, StateAxisGrid, StatusBadge } from "@bnbera/ui";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { categoryLabel, compactAddress, formatObservedAt, joinOrFallback, statusTone, titleCase } from "@/lib/presentation";
import { ActivationPanel } from "./activation-panel";
import { CompareToggle } from "./compare-toggle";

function SchemaPreview({ value }: { readonly value: Record<string, unknown> }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export function AgentDetailView({ agent }: { readonly agent: MarketplaceAgentReadModel }) {
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
            <ActivationPanel activation={agent.activation} detail />
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
