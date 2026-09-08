import Link from "next/link";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";
import { CreatorDashboard } from "@/components/creator-dashboard";
import { creatorProductionProfile } from "@/lib/creator-contract";

export const dynamic = "force-dynamic";
export default function CreatorDashboardPage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator dashboard</p><h1>Deployment status is persisted, not guessed.</h1><p>The only MVP template is a bounded one-shot PancakeSwap swap, not a grid strategy. Browser authority records show the exact curated pair/configuration binding, public policy digest, expiry, and revoke state. Chain 97 is the canary. Chain {creatorProductionProfile.chainId} PancakeSwap readiness is read-only at verified block {creatorProductionProfile.verifiedAtBlock}; mainnet writes remain disabled pending an explicit release configuration.</p><p>{studio.ready ? studio.reason : "Studio readiness is not an authority or deployment enablement signal."}</p><CreatorDashboard /><Link href="/create">Create a bounded one-shot swap agent</Link></section></div>;
}
