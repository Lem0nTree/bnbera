import { CreatorForm } from "@/components/creator-form";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator · bounded authority</p><h1>Review and approve one bounded PancakeSwap configuration.</h1><p>Choose the curated tBNB → CAKE or tBNB → BUSD pair, plus the bounded amount, quote freshness, slippage, and deadline. A browser passkey creates or recovers the user-controlled Altana wallet, and the server derives the fixed chain, router, token, selector, call, spend, and expiry policy.</p><p role="status">The grant is user-approved in the browser. After approval, the generated session is handed off once through the authenticated runtime boundary, then browser references are cleared. Deployment is queued only if that handoff and Studio readiness succeed.</p></section><CreatorForm /></div>;
}
