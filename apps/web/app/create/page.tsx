import { CreatorForm } from "@/components/creator-form";
import { AgentAvatar } from "@/components/agent-avatar";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  return <div className="page-shell"><section className="marketplace-hero"><p className="eyebrow">Creator · BNB testnet</p><h1>Make it your own.</h1><p>Create a swap agent in a few guided steps. You choose the pair, set the limits, and control its permissions.</p></section><div className="creator-layout"><aside className="creator-template"><AgentAvatar category="rebalancing" /><h2>One-shot swap</h2><p>A focused template for a single, bounded token swap.</p><ul><li>tBNB → CAKE or BUSD</li><li>Up to 0.001 tBNB per swap</li><li>Your spend and slippage limits</li><li>Revoke permissions anytime</li></ul><span className="status-badge status-badge--warning">BNB Testnet</span></aside><CreatorForm /></div></div>;
}
