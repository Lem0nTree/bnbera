import Link from "next/link";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { AgentAvatar } from "./agent-avatar";
import { AgentReviews } from "./agent-decision-summary";
import { DirectoryActions } from "./directory-actions";
import { ProtocolRefresh } from "./protocol-refresh";
import { ActivationPanel } from "./activation-panel";
import { categoryLabel, formatObservedAt, priceDisplayLabel } from "@/lib/presentation";
import { serviceVerificationState, type DirectorySnapshot } from "@bnbera/agent-ingestion/directory";

const serviceLabels = { verified:"Verified", reachable:"Reachable", auth_required:"Authentication required", invalid:"Invalid response", unreachable:"Unreachable", advertised:"Advertised · not checked", stale:"Stale check" };
function DirectoryServiceStatus({service,data}:{readonly service:DirectorySnapshot["services"][number];readonly data:DirectorySnapshot}) {
  const check=data.serviceVerifications.find(s=>s.name===service.name&&s.url===service.url);
  const state=check?serviceVerificationState(check,data.renderedAt??data.fetchedAt):"advertised";
  return <span className={`protocol-status protocol-status--${state}`} title={check?.checkedAt?`${formatObservedAt(check.checkedAt)}${check.reason?` · ${check.reason}`:""}`:"No protocol check recorded"}><i aria-hidden="true"/>{service.name.toUpperCase()} · {serviceLabels[state]}</span>;
}
function DirectoryAvailability({agent}:{readonly agent:MarketplaceAgentReadModel}) {
  const data=agent.directory!;
  const verified=data.serviceVerifications.filter(s=>serviceVerificationState(s,data.renderedAt??data.fetchedAt)==="verified");
  const latest=data.serviceVerifications.filter(s=>s.checkedAt).sort((a,b)=>b.checkedAt!.localeCompare(a.checkedAt!))[0];
  return <>
    <div className="directory-heartbeat-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12h4l3-8 6 16 3-8h4"/></svg><h2>Agent heartbeat</h2></div>
    <div className="directory-status-line"><i data-state={verified.length?"reachable":"unprobed"}/><strong>{verified.length?`${verified.length} protocol${verified.length===1?"":"s"} verified`:"No fresh verified protocol"}</strong></div>
    <dl className="directory-heartbeat-data">
      <div><dt>Last check</dt><dd title={formatObservedAt(latest?.checkedAt??null)}>{latest?formatRelativeObservation(latest.checkedAt,Date.parse(data.renderedAt??data.fetchedAt)):"Pending"}</dd></div>
      <div><dt>Last response</dt><dd>{latest?.latencyMs!=null?`${latest.latencyMs.toLocaleString()} ms`:"Not measured"}</dd></div>
      <div><dt>Advertised services</dt><dd>{data.services.length}</dd></div>
    </dl>
    <a className="directory-heartbeat-detail" href="#services">View protocol checks <span aria-hidden="true">↗</span></a>
    <small>Protocol checks only · task success and uptime unverified.</small>
  </>;
}
function DirectoryServices({agent}:{readonly agent:MarketplaceAgentReadModel}) {
  const data=agent.directory!;
  return <section className="directory-section" id="services"><div className="profile-section-heading"><h2>Services & capabilities</h2><span>{data.services.length} advertised</span></div>
    <div className="directory-services">{data.services.length?data.services.map((service,index)=>{
      const check=data.serviceVerifications.find(s=>s.name===service.name&&s.url===service.url);
      return <article key={`${service.url}-${index}`}><div className="directory-service-icon" aria-hidden="true">{service.name.toLowerCase()==="a2a"?"⌘":service.name.toLowerCase()==="mcp"?"◇":"↗"}</div><div className="protocol-service-body"><h3>{service.name.toUpperCase()}</h3><p>{new URL(service.url).hostname}{service.version?` · v${service.version}`:""}</p><DirectoryServiceStatus service={service} data={data}/><small>{check?.checkedAt?`Checked ${formatObservedAt(check.checkedAt)}${check.latencyMs===null?"":` · ${check.latencyMs} ms`}`:"Not checked yet"}</small>{check&&<small>{check.evidence==="agent-card-schema"?`${check.capabilityCount??0} advertised skills · Agent Card schema verified; invocation not tested`:check.evidence==="handshake-and-list"?`${check.capabilityCount??0} capabilities listed · No tools invoked`:check.evidence==="http-availability"?"HTTP availability only · Not an Agent Card":check.reason??"No protocol evidence"}</small>}{check&&check.capabilityNames.length>0&&<details><summary>Declared capabilities</summary><ul>{check.capabilityNames.map(name=><li key={name}>{name}</li>)}</ul></details>}</div><a className="button" href={service.url} target="_blank" rel="noreferrer">{service.name.toLowerCase()==="a2a"?"Open card":"Open service"} ↗</a></article>;
    }):<p className="directory-empty">No public service endpoint was supplied in this registration.</p>}</div><p className="directory-footnote">Checks expire after two minutes. Authentication is never bypassed, MCP tools are never invoked, and no uptime percentage is inferred.</p>
    {data.skills.length>0&&<><h3 className="directory-capability-heading">Agent-advertised skills</h3><div className="directory-skills">{data.skills.map(skill=><article key={skill.id}><span aria-hidden="true">↗</span><div><h3>{skill.name}</h3><p>{skill.description}</p></div></article>)}</div></>}
  </section>;
}

function formatRelativeObservation(value: string | null, now = Date.now()): string {
  if (!value) return "Not reported";
  const elapsed=Math.max(0,now-Date.parse(value));
  if(!Number.isFinite(elapsed))return "Not reported";
  if(elapsed<60000)return "Just now";
  if(elapsed<3600000)return `${Math.floor(elapsed/60000)}m ago`;
  if(elapsed<86400000)return `${Math.floor(elapsed/3600000)}h ago`;
  return `${Math.floor(elapsed/86400000)}d ago`;
}
export const relativeObservation = formatRelativeObservation;
export function DirectoryScore({score,large=false}:{readonly score:number|null;readonly large?:boolean}) {
  return <div className={`directory-score${large?" directory-score--large":""}`} title="8004scan overall score, out of 100. A vendor ranking signal, not a verified-purchase rating."><svg viewBox="0 0 64 64" aria-hidden="true"><circle className="directory-score__track" cx="32" cy="32" r="28"/><circle className="directory-score__value" cx="32" cy="32" r="28" pathLength="100" strokeDasharray={`${score??0} 100`}/></svg><strong>{score===null?"—":score.toFixed(1)}</strong><span className="sr-only">8004scan score out of 100</span></div>;
}
export function DirectoryAgentRow({agent}:{readonly agent:MarketplaceAgentReadModel}) {
  const data=agent.directory!;
  const relativeObservation = (value:string|null) => formatRelativeObservation(value,Date.parse(data.renderedAt??data.fetchedAt));
  const checked=data.serviceVerifications.filter(s=>serviceVerificationState(s,data.renderedAt??data.fetchedAt)==="verified").length;
  const latestCheck = data.serviceVerifications.flatMap(service => service.checkedAt ?? []).sort().at(-1) ?? null;
  return <article className="agent-row directory-row">
    <Link prefetch={false} className="agent-row__art" href={`/agents/${agent.slug}`} aria-label={`View ${agent.name}`}><AgentAvatar category={agent.category} imageUrl={data.imageUrl} name={agent.name}/></Link>
    <div className="agent-row__content"><div className="directory-row__title"><h3><Link prefetch={false} href={`/agents/${agent.slug}`}>{agent.name}</Link></h3><span className={`chain-chip${agent.identity.chainId===97?" chain-chip--testnet":""}`}><span aria-hidden="true">◆</span> {agent.identity.chainId===56?"BNB Chain":"Testnet"}</span></div><p className="agent-row__description">{agent.description}</p><div className="directory-row__signals"><span title="Feedback indexed by 8004scan; permissionless, not verified BNBEra purchases">☆ {data.feedback.count?.toLocaleString()??"—"} feedback{data.feedback.average!==null?` · ${data.feedback.average.toFixed(1)}/100`:""}</span><span title={`8004scan profile update: ${formatObservedAt(data.vendorUpdatedAt)}`}>◷ Updated {relativeObservation(data.vendorUpdatedAt)}</span><span className={checked?"signal-positive":""}><i/>{checked ? `${checked} protocol verified` : "No fresh verified protocol"}</span></div><div className="directory-row__protocols">{data.services.slice(0,4).map(service=><DirectoryServiceStatus key={`${service.name}:${service.url}`} service={service} data={data}/>)}{agent.category!=="uncategorized"&&<span>{categoryLabel(agent.category)}</span>}</div></div>
    <div className="directory-row__score"><DirectoryScore score={data.scores.overall}/><span>Quality score</span></div>
    <div className="agent-row__actions"><div className="directory-row__price"><span>Last quoted</span><strong>{agent.pricing.amountAtomic ? priceDisplayLabel(agent.pricing.label).replace(/^Last quoted\s+/i, "") : "Not verified"}</strong></div><Link prefetch={false} className="button button--primary" href={`/agents/${agent.slug}${agent.activation.enabled ? "#hire" : ""}`}>{agent.activation.enabled ? "Hire" : "Explore agent"} <span aria-hidden="true">↗</span></Link><small>{agent.activation.enabled ? "Review a fresh signed quote" : "Hiring unavailable"}</small></div>
    <div className="directory-row__evidence"><span><small>Services</small><strong>{data.services.length} advertised</strong></span><span title={formatObservedAt(latestCheck)}><small>Last check</small><strong>{latestCheck ? relativeObservation(latestCheck) : "Pending"}</strong></span><span><small>Identity</small><strong>ERC-8004 #{agent.identity.agentId}</strong></span><span title={`8004scan vendor ranking · ${formatObservedAt(data.scores.observedAt)} · not a verified-purchase rating`}><small>Score source</small><strong>{data.scores.overall===null?"Not available":"8004scan · /100"}</strong></span></div>
  </article>;
}

export function DirectoryAgentProfile({agent}:{readonly agent:MarketplaceAgentReadModel}) {
  const data=agent.directory!;
  const relativeObservation = (value:string|null) => formatRelativeObservation(value,Date.parse(data.renderedAt??data.fetchedAt));
  const explorer=agent.identity.chainId===56?"https://bscscan.com":"https://testnet.bscscan.com";
  const dimensions=[{name:"Quality",value:data.scores.quality},{name:"Activity",value:data.scores.activity},{name:"Metadata",value:data.scores.metadata},{name:"Health",value:data.scores.health}];
  return <div className="page-shell directory-profile">
    <ProtocolRefresh/>
    <div className="directory-breadcrumb"><Link href="/marketplace">← All agents</Link><span>/</span><span>{agent.name}</span></div>
    <section className="directory-profile__hero"><div className="directory-profile__identity"><AgentAvatar category={agent.category} imageUrl={data.imageUrl} name={agent.name}/><div><div className="directory-profile__labels"><span className="chain-chip">◆ {agent.identity.chainId===56?"BNB Chain · Mainnet":"BNB Chain · Testnet"}</span><span>ERC-8004 #{agent.identity.agentId}</span></div><h1>{agent.name}</h1><div className="directory-profile__subline"><span className="signal-positive">✓ Registry confirmed</span><span>Updated {relativeObservation(data.vendorUpdatedAt)}</span><span>{data.feedback.count??"—"} public feedback</span></div></div></div><DirectoryActions slug={agent.slug} name={agent.name}/></section>
    <div className="directory-profile__layout"><div className="directory-profile__main"><section className="directory-overview"><span className="eyebrow">Meet your next agent</span><p>{agent.description}</p><div className="directory-service-tags">{data.protocols.map(protocol=><span key={protocol}>{protocol}</span>)}{agent.category!=="uncategorized"&&<span>{categoryLabel(agent.category)}</span>}</div></section>
      <nav className="profile-nav" aria-label="Agent sections">{agent.activation.method === "erc8183"&&<a className="directory-hire-nav" href="#hire">Hire agent <span aria-hidden="true">↗</span></a>}<a href="#services">Services <span>{data.services.length}</span></a><a href="#reputation">Reputation</a><a href="#reviews">Reviews</a><a href="#onchain">On-chain</a><a href="#technical-details">Metadata</a></nav>
      {agent.activation.method === "erc8183" && <section className="directory-section directory-hire" id="hire" aria-labelledby="directory-hire-title">
        <div className="directory-hire__summary"><div><div className="directory-hire__heading"><span className="eyebrow">Put this agent to work</span><span className="directory-hire__network">BNB Chain · Mainnet</span></div><h2 id="directory-hire-title">Hire with a signed mainnet offer</h2><p className="directory-hire__intro">Set your task. Review the quote. You control funding.</p></div>
          <div className="directory-hire__price"><span>Last quoted</span><strong>{priceDisplayLabel(agent.pricing.label).replace(/^Last quoted\s+/i, "")}</strong><small>Final amount comes from your signed quote.</small></div>
        </div>
        <ActivationPanel activation={agent.activation} detail compact targetChainId={56} identityKey={agent.id} runBundle={agent.evidence.runBundle} />
      </section>}
      <DirectoryServices agent={agent}/>
      <section className="directory-section" id="reputation"><div className="profile-section-heading"><h2>Reputation & quality</h2><a href={data.sourceUrl} target="_blank" rel="noreferrer">Source: {data.sourceLabel ?? "8004scan"} ↗</a></div><div className="directory-quality"><div><DirectoryScore score={data.scores.overall} large/><h3>Overall score</h3><p>8004scan · out of 100</p></div><div className="directory-dimensions">{dimensions.map(dimension=><div key={dimension.name}><div><span>{dimension.name}</span><strong>{dimension.value===null?"Not measured":dimension.value.toFixed(1)}</strong></div><div className="directory-meter"><span style={{width:`${dimension.value??0}%`}}/></div></div>)}</div></div><p className="directory-footnote">{data.scores.algorithm??"Vendor ranking"} · Scored {relativeObservation(data.scores.observedAt)}. These vendor signals are separate from buyer reviews and BNBEra hire eligibility.</p><div className="directory-stat-grid"><article><strong>{data.feedback.count?.toLocaleString()??"—"}</strong><span>Public feedback</span><small>Indexed by 8004scan</small></article><article><strong>{data.feedback.average===null?"—":data.feedback.average.toFixed(1)}</strong><span>Feedback average /100</span><small>Permissionless feedback</small></article><article><strong>{data.stats.validations?.toLocaleString()??"—"}</strong><span>Validation records</span><small>Indexed by 8004scan</small></article></div></section>
      <section className="directory-section"><div className="profile-section-heading"><h2>Community feedback</h2><a href={`${data.sourceUrl}#feedback`} target="_blank" rel="noreferrer">View source: {data.sourceLabel ?? "8004scan"} ↗</a></div>{data.feedback.items.length?<div className="directory-feedback">{data.feedback.items.map((item,index)=><article key={index}><div><strong>{item.reviewer?`${item.reviewer.slice(0,8)}…${item.reviewer.slice(-4)}`:"Public reviewer"}</strong><span>{item.value??"—"}{item.tag?` · ${item.tag}`:""}</span></div><p>{item.comment??"This reviewer left a score without a public comment."}</p><small>{formatObservedAt(item.observedAt)} · 8004scan indexed feedback</small></article>)}</div>:<p className="directory-empty">{data.feedback.count===0?"No public feedback yet. This is an early opportunity to explore the agent's services.":data.sourceLabel ? "No vendor feedback records were provided by this registry source." : "Review records are available through the source link."}</p>}</section>
      <AgentReviews agent={agent}/>
      <DirectoryPublicArtifacts agent={agent}/>
      <section className="directory-section" id="onchain"><div className="profile-section-heading"><h2>On-chain identity</h2><span className="signal-positive">✓ Finalized block {agent.dataProvenance.identityRead.observedBlock?.toLocaleString()}</span></div><div className="directory-chain-links"><a href={`${explorer}/token/${agent.identity.identityRegistry}?a=${agent.identity.agentId}`} target="_blank" rel="noreferrer"><span>ERC-8004 registration</span><strong>Agent #{agent.identity.agentId} ↗</strong></a>{agent.ownerAddress&&<a href={`${explorer}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer"><span>Owner wallet</span><strong>{agent.ownerAddress.slice(0,8)}…{agent.ownerAddress.slice(-6)} ↗</strong></a>}{data.createdTransaction&&<a href={`${explorer}/tx/${data.createdTransaction}`} target="_blank" rel="noreferrer"><span>Registration transaction</span><strong>View transaction ↗</strong></a>}<a href={data.sourceUrl} target="_blank" rel="noreferrer"><span>Agent explorer</span><strong>View source: {data.sourceLabel ?? "8004scan"} ↗</strong></a></div></section>
      <details className="profile-technical" id="technical-details"><summary>Technical details <span>Registry, metadata & source evidence</span></summary><dl className="directory-metadata"><dt>Full identity</dt><dd><code>{agent.id}</code></dd><dt>Identity registry</dt><dd><a href={`${explorer}/address/${agent.identity.identityRegistry}`} target="_blank" rel="noreferrer">{agent.identity.identityRegistry} ↗</a></dd><dt>Owner</dt><dd><code>{agent.ownerAddress??"Unavailable"}</code></dd><dt>Agent wallet</dt><dd><code>{agent.agentWallet??"Not registered"}</code></dd><dt>Metadata resolution</dt><dd>{data.registration.status}{data.registration.reason?` · ${data.registration.reason}`:""}</dd><dt>Registration URI</dt><dd><code>{data.registration.uri??"Unavailable"}</code></dd><dt>Content SHA-256</dt><dd><code>{data.registration.digest??"Unavailable"}</code></dd><dt>Observed block</dt><dd>{agent.dataProvenance.identityRead.observedBlock} · finalized</dd><dt>Block hash</dt><dd><code>{agent.dataProvenance.identityRead.observedBlockHash}</code></dd><dt>Profile refreshed</dt><dd>{formatObservedAt(data.fetchedAt)}</dd><dt>Separate state axes</dt><dd>{Object.entries(agent.stateAxes).map(([key,value])=><span key={key}>{key}: {value}<br/></span>)}</dd></dl></details>
    </div><aside className="directory-profile__aside"><section className="directory-availability"><DirectoryAvailability agent={agent}/>{agent.activation.enabled ? <a className="button button--primary" href="#hire">Review mainnet offer <span aria-hidden="true">↗</span></a> : <><button className="button button--primary" disabled>Hire unavailable</button><details className="directory-unavailable-reason"><summary>Why unavailable?</summary><p>{agent.activation.reason}</p></details></>}</section>
      <section className="directory-aside-card" aria-labelledby="aside-reputation-title"><div className="directory-aside-heading"><h2 id="aside-reputation-title">Reputation & quality</h2><a href="#reputation" aria-label="View full reputation and quality">↗</a></div>
        <div className="directory-aside-scores"><div><strong>{data.scores.overall?.toFixed(1)??"—"}<small>/100</small></strong><span>Overall score</span></div><div><strong>{data.scores.quality?.toFixed(1)??"—"}<small>/100</small></strong><span>Quality score</span></div></div>
        <p className="directory-aside-caption">8004scan ranking · {data.scores.observedAt?`Scored ${relativeObservation(data.scores.observedAt)}`:"Not measured"}</p>
        <dl className="directory-aside-data"><div><dt>Public feedback</dt><dd>{data.feedback.count?.toLocaleString()??"—"}</dd></div><div><dt>Feedback average</dt><dd>{data.feedback.average!==null?`${data.feedback.average.toFixed(1)} /100`:"—"}</dd></div></dl>
        <p className="directory-aside-caption">Permissionless · separate from buyer reviews</p>
        <dl className="directory-aside-data directory-aside-data--separated"><div><dt>Completed BNBEra hires</dt><dd>{agent.metrics.completedJobs.completedCount??"—"}</dd></div><div><dt>Verified buyer reviews</dt><dd>{agent.metrics.reputation.verifiedPurchases.count??"—"}</dd></div></dl>
      </section>
      <section className="directory-aside-card" aria-labelledby="aside-identity-title"><div className="directory-aside-heading"><h2 id="aside-identity-title">On-chain identity</h2><a href="#onchain" aria-label="View full on-chain identity">↗</a></div><dl className="directory-aside-data">
        <div><dt>Network</dt><dd>BNB {agent.identity.chainId===56?"Mainnet":"Testnet"}</dd></div>
        <div><dt>ERC-8004</dt><dd><a href={`${explorer}/token/${agent.identity.identityRegistry}?a=${agent.identity.agentId}`} target="_blank" rel="noreferrer">#{agent.identity.agentId} ↗</a></dd></div>
        <div><dt>Registry</dt><dd><a title={agent.identity.identityRegistry} href={`${explorer}/address/${agent.identity.identityRegistry}`} target="_blank" rel="noreferrer">{agent.identity.identityRegistry.slice(0,6)}…{agent.identity.identityRegistry.slice(-4)} ↗</a></dd></div>
        <div><dt>Owner</dt><dd>{agent.ownerAddress?<a title={agent.ownerAddress} href={`${explorer}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer">{agent.ownerAddress.slice(0,6)}…{agent.ownerAddress.slice(-4)} ↗</a>:"Unavailable"}</dd></div>
        <div><dt>Finalized block</dt><dd>{agent.dataProvenance.identityRead.observedBlock?.toLocaleString()??"Not observed"}</dd></div>
      </dl></section><a className="directory-source-link" href={data.sourceUrl} target="_blank" rel="noreferrer">View source profile ↗</a></aside></div>
  </div>;
}

function DirectoryPublicArtifacts({agent}:{readonly agent:MarketplaceAgentReadModel}) {
  const artifacts=[agent.evidence.profile,agent.evidence.runBundle].filter(artifact=>artifact.status!=="unavailable");
  if(!artifacts.length)return null;
  return <section className="directory-section"><div className="profile-section-heading"><h2>Published evidence</h2><span>Greenfield · independently recorded</span></div><div className="directory-feedback">{artifacts.map(artifact=><article key={artifact.artifactType}><div><strong>{artifact.artifactType==="agent_profile"?"Agent profile snapshot":"Completed-job result"}</strong><span>{artifact.status}</span></div><p>Version {artifact.version??"unavailable"}{artifact.version!==agent.evidence.currentVersion?" · Historical snapshot":""}{artifact.jobId?` · Job ${artifact.jobId}`:""}</p>{artifact.status==="verified"&&artifact.readUrl&&<a className="text-link" href={artifact.readUrl} target="_blank" rel="noreferrer">Open verified JSON ↗</a>}<small>Verified {formatObservedAt(artifact.verifiedAt)}</small><details><summary>Integrity details</summary><p>{artifact.summary}</p><p>SHA-256: <code>{artifact.sha256Digest??"Unavailable"}</code></p><p>Keccak: <code>{artifact.keccak256Digest??"Unavailable"}</code></p><p>{artifact.status==="verified"&&!artifact.sealTransactionHash?"Seal confirmed; transaction hash unavailable.":artifact.sealTransactionHash??"Seal not confirmed"}</p></details></article>)}</div></section>;
}
