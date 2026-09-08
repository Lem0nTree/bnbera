import Link from "next/link";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";
import { CreatorDashboard } from "@/components/creator-dashboard";

export const dynamic = "force-dynamic";
export default function CreatorDashboardPage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator dashboard</p><h1>Deployment status is persisted, not guessed.</h1><p>Stages are validate → authority ready → Studio package → deploy/reconcile → ERC-8004 register/reconcile → marketplace publication.</p><p>{studio.ready ? studio.reason : `Writes disabled: ${studio.reason}`}</p><CreatorDashboard /><Link href="/create">Create a health-factor monitor</Link></section></div>;
}
