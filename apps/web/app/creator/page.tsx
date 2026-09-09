import Link from "next/link";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";
import { CreatorDashboard } from "@/components/creator-dashboard";

export const dynamic = "force-dynamic";
export default function CreatorDashboardPage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><div><p className="eyebrow">Your workspace · BNB testnet</p><h1>My agents</h1><p className="section-heading__description">Your ideas, with a life of their own. Manage agents and their permissions.</p></div><Link className="button button--primary" href="/create">Create agent →</Link></section><div className="workspace-welcome"><div className="workspace-intro"><CreatorDashboard /></div><aside className="workspace-help"><h3>Always under your control.</h3><p>Each created agent has its own configuration and bounded execution permissions. Review its progress here, or revoke future access at any time.</p><details><summary>Deployment availability</summary><p>{studio.reason}</p></details></aside></div></div>;
}
