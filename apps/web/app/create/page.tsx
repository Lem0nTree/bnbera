import { CreatorForm } from "@/components/creator-form";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator · G3 preparation</p><h1>Create one bounded tBNB → CAKE agent.</h1><p>After your explicit grant, its Altana session—not a root key—may make exactly one 0.001 tBNB PancakeSwap V2 testnet swap to CAKE, recipient=self, fresh quote, 0.5% maximum slippage, and a 120-second deadline. Health-factor monitoring is optional utility only.</p><p role="status">{studio.ready ? studio.reason : `Deployment disabled: ${studio.reason}`}</p></section><CreatorForm /></div>;
}
