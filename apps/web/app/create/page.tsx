import { CreatorForm } from "@/components/creator-form";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator · draft preparation</p><h1>Prepare one bounded tBNB → CAKE configuration.</h1><p>Reviewed configuration only: any future session would be limited to 0.001 tBNB, self-recipient, a fresh quote, 0.5% maximum slippage, and a 120-second deadline. Total native session spending would be capped at 0.002 BNB/hour.</p><p role="status">Draft preparation only; authority and deployment are unavailable.</p></section><CreatorForm /></div>;
}
