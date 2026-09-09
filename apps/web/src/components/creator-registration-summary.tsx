"use client";

import { useEffect, useState } from "react";
import { getCreatorErc8004RegistrationStatus, type CreatorBrowserRegistrationStatus } from "@/lib/creator-browser-grant";

export function CreatorRegistrationSummary({ deploymentId, revision }: { readonly deploymentId: string; readonly revision: number }) {
  const [status, setStatus] = useState<CreatorBrowserRegistrationStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setStatus(null);
    setFailed(false);
    void getCreatorErc8004RegistrationStatus(deploymentId).then((value) => {
      if (current) setStatus(value);
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [deploymentId, revision]);

  if (failed) return <p>Registration status is unavailable. Refresh My agents to read it again.</p>;
  if (status === null) return <p>Reading registration status…</p>;
  const identity = status.state === "registered" ? status.identity : null;
  return <div className="creator-registration-summary">
    <div className="detail-kv"><span>Registration</span><strong>{status.state.replaceAll("_", " ")}</strong></div>
    {identity === null ? <p>{status.pendingReason ?? "A finalized identity has not been returned yet."}</p> : <>
      <p>Registered agent #{identity.agentId} · BNB testnet. Marketplace publication is checked separately; a listing link is not yet available here.</p>
      <details><summary>Exact registered identity</summary><code>{identity.namespace}:{identity.chainId}:{identity.identityRegistry}:{identity.agentId}</code><p>Version {identity.agentVersionId}</p></details>
    </>}
  </div>;
}
