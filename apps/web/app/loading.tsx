import { AgentRowSkeletons } from "@/components/agent-row-skeleton";

export default function Loading() {
  return <div className="page-shell">
    <div className="marketplace-skeleton-heading" aria-hidden="true"><div className="agent-skeleton agent-skeleton--label" /><div className="agent-skeleton agent-skeleton--title" /><div className="agent-skeleton agent-skeleton--line" /></div>
    <AgentRowSkeletons />
  </div>;
}
