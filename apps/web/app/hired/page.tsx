import { HiredDashboard } from "@/components/hired-dashboard";
import { SectionHeading } from "@bnbera/ui";
export const dynamic = "force-dynamic";
export default function HiredPage() {
  return <div className="page-shell"><SectionHeading headingLevel={1} eyebrow="Your workspace" title="Hired agents" description="Track every job for your signed-in buyer account. Review results and resume the next safe action." /><HiredDashboard /></div>;
}
