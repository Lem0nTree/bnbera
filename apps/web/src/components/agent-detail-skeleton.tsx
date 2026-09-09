export function AgentDetailSkeleton({ label = "Loading agent profile" }: { readonly label?: string }) {
  return <div className="page-shell directory-profile agent-detail-skeleton" role="status" aria-busy="true" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">
      <div className="agent-skeleton agent-skeleton--crumb" />
      <div className="agent-skeleton-hero"><div className="agent-skeleton agent-skeleton--avatar" /><div><div className="agent-skeleton agent-skeleton--label" /><div className="agent-skeleton agent-skeleton--title" /><div className="agent-skeleton agent-skeleton--line" /></div></div>
      <div className="agent-skeleton-layout"><div className="agent-skeleton-main">
        <div className="agent-skeleton-copy"><div className="agent-skeleton agent-skeleton--line" /><div className="agent-skeleton agent-skeleton--line" /><div className="agent-skeleton agent-skeleton--label" /></div>
        <div className="agent-skeleton agent-skeleton--nav" />
        <div className="agent-skeleton-card"><div className="agent-skeleton agent-skeleton--title" /><div className="agent-skeleton agent-skeleton--line" /><div className="agent-skeleton agent-skeleton--field" /><div className="agent-skeleton agent-skeleton--button" /></div>
        <div className="agent-skeleton-card"><div className="agent-skeleton agent-skeleton--label" /><div className="agent-skeleton agent-skeleton--field" /></div>
      </div><div className="agent-skeleton-card agent-skeleton-aside"><div className="agent-skeleton agent-skeleton--label" /><div className="agent-skeleton agent-skeleton--line" /><div className="agent-skeleton agent-skeleton--field" /><div className="agent-skeleton agent-skeleton--button" /></div></div>
    </div>
  </div>;
}
