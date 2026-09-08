"use client";
import { useEffect, useState } from "react";

type Draft = { id: string; name: string; slug: string; status: string; deploymentState: string | null; currentStep: string | null };
export function CreatorDashboard() {
  const [drafts, setDrafts] = useState<readonly Draft[] | null>(null);
  useEffect(() => { void fetch("/api/creator/drafts", { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<{ drafts: Draft[] }> : { drafts: [] }).then((data) => setDrafts(data.drafts)).catch(() => setDrafts([])); }, []);
  if (drafts === null) return <p>Loading persisted Creator drafts…</p>;
  if (drafts.length === 0) return <p>No Creator drafts yet.</p>;
  return <ul>{drafts.map((draft) => <li key={draft.id}><strong>{draft.name}</strong> · {draft.status} · {draft.deploymentState ?? "not queued"} {draft.currentStep === null ? "" : `(${draft.currentStep})`}</li>)}</ul>;
}
