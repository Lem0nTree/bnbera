import Link from "next/link";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";
import { CreatorDashboard } from "@/components/creator-dashboard";

export const dynamic = "force-dynamic";
export default function CreatorDashboardPage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="marketplace-hero"><p className="eyebrow">Your workspace · BNB testnet</p><h1>My agents</h1><p>Manage your agent configuration, deployment, and execution permissions.</p><Link className="button button--primary" href="/create">Create agent</Link></section><CreatorDashboard /><details><summary>Studio availability</summary><p>{studio.reason}</p></details></div>;
}
