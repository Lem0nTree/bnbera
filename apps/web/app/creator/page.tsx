import Link from "next/link";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";
import { CreatorDashboard } from "@/components/creator-dashboard";
import { creatorProductionProfile } from "@/lib/creator-contract";

export const dynamic = "force-dynamic";
export default function CreatorDashboardPage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator dashboard</p><h1>Deployment status is persisted, not guessed.</h1><p>Chain 97 is the canary. Chain {creatorProductionProfile.chainId} PancakeSwap readiness is read-only at verified block {creatorProductionProfile.verifiedAtBlock}; mainnet writes remain disabled pending an explicit release configuration.</p><p>{studio.ready ? studio.reason : `Writes disabled: ${studio.reason}`}</p><CreatorDashboard /><Link href="/create">Create a bounded swap agent</Link></section></div>;
}
