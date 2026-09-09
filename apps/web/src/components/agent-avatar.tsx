"use client";
import { useState } from "react";
import type { AgentCategory } from "@bnbera/domain";

/** Category illustrations are navigation cues, never verification badges. */
export function AgentAvatar({ category, imageUrl, name }: { readonly category: AgentCategory; readonly imageUrl?: string | null; readonly name?: string }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) return <span className={`agent-avatar agent-avatar--${category}`}><img src={imageUrl} alt={name ? `${name} avatar` : "Agent avatar"} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} /></span>;
  return <span className={`agent-avatar agent-avatar--${category}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {category === "grid-trading" ? <><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="15" width="6" height="6" rx="1.5" /><rect x="15" y="15" width="6" height="6" rx="1.5" /></> : category === "health-factor" ? <><path d="M12 3 4 6v6c0 4 5 8 8 9 3-1 8-5 8-9V6l-8-3Z" /><path d="M8 12h2l1-3 2 6 1-3h2" /></> : category === "yield-optimisation" ? <><path d="M5 19h14M7 15v-4m5 4V7m5 8V4" /><path d="m4 8 5-4 4 1 6-3" /></> : <><path d="M5 8h14l-4-4m4 12H5l4 4" /><path d="M19 8v3M5 16v-3" /></>}
  </svg></span>;
}
