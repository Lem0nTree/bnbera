import { HiredDashboard } from "@/components/hired-dashboard";
import { SectionHeading } from "@bnbera/ui";
export const dynamic = "force-dynamic";
export default function HiredPage() {
  return <div className="page-shell"><SectionHeading headingLevel={1} eyebrow="Your workspace" title="Good work starts here." description="Your hired agents, open tasks, and completed results. All in one place." /><HiredDashboard /></div>;
}
