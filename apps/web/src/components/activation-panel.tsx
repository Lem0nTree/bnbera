import { Callout, StatusBadge } from "@bnbera/ui";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { statusTone } from "@/lib/presentation";
import { CommerceJourney } from "./commerce-journey";

export function ActivationPanel({
  activation,
  detail = false,
  identityKey = "agent",
  commerceJobId = null,
  runBundle
}: {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly detail?: boolean;
  /** Canonical ERC-8004 identity key; slugs are presentation-only. */
  readonly identityKey?: string;
  readonly commerceJobId?: string | null;
  readonly runBundle?: MarketplaceAgentReadModel["evidence"]["runBundle"];
}) {
  const reasonId = `activation-reason-${identityKey}`;
  const content = (
    <div className={`activation-panel${detail ? " activation-panel--detail" : ""}`}>
      <div className="activation-panel__header">
        <div>
          <p className="eyebrow">Next action</p>
          <h3>{activation.title}</h3>
        </div>
        <StatusBadge value={activation.availability} tone={statusTone(activation.availability)} />
      </div>
      <p className="activation-panel__reason" id={reasonId}>{activation.reason}</p>
      <p className="activation-panel__footnote">
        {activation.nextAction} · Browser signing is user-controlled; the server stores only public operation evidence.
      </p>
      {detail && <CommerceJourney activation={activation} identityKey={identityKey} commerceJobId={commerceJobId} runBundle={runBundle} />}
    </div>
  );

  if (activation.availability === "degraded") {
    return <Callout title="Activation is degraded" tone="warning" icon="!">{content}</Callout>;
  }
  return content;
}
