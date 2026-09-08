"use client";
import { useState } from "react";

export function CreatorForm() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setMessage(null);
    const response = await fetch("/api/creator/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(), name: formData.get("name"), slug: formData.get("slug"), description: formData.get("description"), protocol: "pancakeswap-v2", refreshMinutes: Number(formData.get("refreshMinutes")), publicationConsent: formData.get("publicationConsent") === "on"
    }) });
    const data = await response.json() as { error?: { safeMessage?: string } };
    setMessage(response.ok ? "Draft saved. Deployment remains blocked until the reviewed T6 authority and Studio runtime gates are available." : (data.error?.safeMessage ?? "Creator request failed."));
  }
  return <form action={submit} className="activation-panel">
    <label>Name<input name="name" required minLength={3} maxLength={80} /></label>
    <label>Public slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} /></label>
    <label>Description<textarea name="description" required minLength={20} maxLength={500} /></label>
    <label>Refresh interval<select name="refreshMinutes" defaultValue="15"><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option></select></label>
    <label><input name="publicationConsent" type="checkbox" required /> I consent to publish this fixed-template agent after verification.</label>
    <button type="submit">Save reviewed-configuration draft</button>
    {message === null ? null : <p role="status">{message}</p>}
  </form>;
}
