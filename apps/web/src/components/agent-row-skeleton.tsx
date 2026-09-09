export function AgentRowSkeletons({ count = 3 }: { readonly count?: number }) {
  return <div className="agent-row-skeletons" role="status" aria-label="Loading agents" aria-busy="true">
    <span className="sr-only">Loading agents</span>
    {Array.from({ length: count }, (_, index) => <div className="agent-row directory-row directory-row-skeleton" aria-hidden="true" key={index}>
      <div className="agent-skeleton directory-row-skeleton__avatar" />
      <div className="directory-row-skeleton__copy"><div className="agent-skeleton directory-row-skeleton__title" /><div className="agent-skeleton directory-row-skeleton__line" /><div className="agent-skeleton directory-row-skeleton__line" /><div className="agent-skeleton directory-row-skeleton__tags" /></div>
      <div className="agent-skeleton directory-row-skeleton__score" />
      <div className="directory-row-skeleton__action"><div className="agent-skeleton directory-row-skeleton__tags" /><div className="agent-skeleton directory-row-skeleton__button" /></div>
      <div className="directory-row-skeleton__footer">{[0, 1, 2, 3].map(item => <div className="agent-skeleton directory-row-skeleton__line" key={item} />)}</div>
    </div>)}
  </div>;
}
