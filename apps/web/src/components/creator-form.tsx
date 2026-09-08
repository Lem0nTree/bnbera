"use client";
import { useState } from "react";

export function CreatorForm() {
  const [message, setMessage] = useState<string | null>(null);
  async function submit(formData: FormData) {
    setMessage(null);
    const response = await fetch("/api/creator/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(), name: formData.get("name"), slug: formData.get("slug"), description: formData.get("description"), protocol: "pancakeswap-v2", tradingPair: formData.get("tradingPair"), inputAmountWei: formData.get("inputAmountWei"), slippageBps: Number(formData.get("slippageBps")), quoteMaxAgeSeconds: Number(formData.get("quoteMaxAgeSeconds")), deadlineSeconds: Number(formData.get("deadlineSeconds")), publicationConsent: formData.get("publicationConsent") === "on"
    }) });
    const data = await response.json() as { error?: { safeMessage?: string } };
    setMessage(response.ok ? "Draft saved. Deployment remains blocked until the reviewed T6 authority and Studio runtime gates are available." : (data.error?.safeMessage ?? "Creator request failed."));
  }
  return <form action={submit} className="activation-panel">
    <label>Name<input name="name" required minLength={3} maxLength={80} /></label>
    <label>Public slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={80} /></label>
    <label>Description<textarea name="description" required minLength={20} maxLength={500} /></label>
    <label>Trading pair<select name="tradingPair" defaultValue="tbnb-cake"><option value="tbnb-cake">tBNB → CAKE</option><option value="tbnb-busd">tBNB → BUSD</option></select></label>
    <label>Input amount<select name="inputAmountWei" defaultValue="1000000000000000"><option value="100000000000000">0.0001 tBNB</option><option value="500000000000000">0.0005 tBNB</option><option value="1000000000000000">0.001 tBNB (maximum)</option></select></label>
    <label>Maximum slippage<select name="slippageBps" defaultValue="50"><option value="10">0.10%</option><option value="25">0.25%</option><option value="50">0.50% (maximum)</option></select></label>
    <label>Quote freshness<select name="quoteMaxAgeSeconds" defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label>
    <label>Swap deadline<select name="deadlineSeconds" defaultValue="120"><option value="60">60 seconds</option><option value="120">120 seconds</option></select></label>
    <label><input name="publicationConsent" type="checkbox" required /> I consent to publish this fixed-template agent after verification.</label>
    <p><small>Only the reviewed pairs and bounded values above are available. Router, token addresses, recipient, and calldata are derived server-side and cannot be supplied here.</small></p>
    <button type="submit">Save bounded swap draft</button>
    {message === null ? null : <p role="status">{message}</p>}
  </form>;
}
