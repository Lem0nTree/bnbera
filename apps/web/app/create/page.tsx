import { CreatorForm } from "@/components/creator-form";
import { studioReadiness, readCreatorStandardsLock } from "@/lib/creator-studio";

export const dynamic = "force-dynamic";
export default function CreatePage() {
  const studio = studioReadiness(readCreatorStandardsLock());
  return <div className="page-shell"><section className="section-heading"><p className="eyebrow">Creator · G3 preparation</p><h1>Create one health-factor monitor.</h1><p>Only audited parameters are accepted. The user-controlled Altana authority and native Studio deployment remain fail-closed until their independent gates pass.</p><p role="status">{studio.ready ? studio.reason : `Deployment disabled: ${studio.reason}`}</p></section><CreatorForm /></div>;
}
