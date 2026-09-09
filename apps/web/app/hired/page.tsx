import { HiredDashboard } from "@/components/hired-dashboard";
import { SectionHeading } from "@bnbera/ui";
import { mainnetBrowserCommerceEnabled } from "@bnbera/config";
export const dynamic = "force-dynamic";
export default function HiredPage() {
  return <div className="page-shell"><SectionHeading headingLevel={1} eyebrow="Your workspace" title="Your hired agents" description="Track deliveries, review results, and follow your payments." /><HiredDashboard defaultChainId={mainnetBrowserCommerceEnabled() ? 56 : 97} /></div>;
}
