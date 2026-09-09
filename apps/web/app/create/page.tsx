import { CreatorForm } from "@/components/creator-form";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  return <div className="page-shell"><section className="marketplace-hero"><p className="eyebrow">Creator · BNB testnet</p><h1>Create your first agent.</h1><p>Configure a bounded testnet swap agent. You control its execution permissions.</p><p>One-shot swap · tBNB → CAKE or BUSD · up to 0.001 tBNB per swap.</p></section><CreatorForm /></div>;
}
