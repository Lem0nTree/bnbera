import { Callout, StatusBadge } from "@bnbera/ui";
import type { MarketplaceAgentReadModel } from "@/lib/marketplace-contract";
import { statusTone } from "@/lib/presentation";

export function ActivationPanel({
  activation,
  detail = false,
  identifier = "agent"
}: {
  readonly activation: MarketplaceAgentReadModel["activation"];
  readonly detail?: boolean;
  readonly identifier?: string;
}) {
  const reasonId = `activation-reason-${identifier}`;
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
      <button
        className={`button ${activation.enabled ? "button--primary" : "button--disabled"}`}
        type="button"
        disabled={!activation.enabled}
        aria-disabled={!activation.enabled}
        aria-describedby={reasonId}
        title={activation.enabled ? "Activation is enabled by its feature gate." : activation.reason}
      >
        {activation.enabled ? "Continue to activation" : "Activation unavailable"}
      </button>
      <p className="activation-panel__footnote">
        {activation.nextAction} · No transaction, payment, wallet, or service request is simulated here.
      </p>
    </div>
  );

  if (activation.availability === "degraded") {
    return <Callout title="Activation is degraded" tone="warning" icon="!">{content}</Callout>;
  }
  return content;
}
