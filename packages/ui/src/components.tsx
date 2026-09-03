import type { ReactNode } from "react";
import type { AgentStateAxes } from "@bnbera/domain";

export type StatusTone = "purple" | "success" | "warning" | "danger" | "neutral" | "info";

const stateAxisMeta: ReadonlyArray<{
  readonly key: keyof AgentStateAxes;
  readonly label: string;
  readonly icon: string;
}> = [
  { key: "originType", label: "Origin", icon: "↗" },
  { key: "claimStatus", label: "Claim", icon: "◈" },
  { key: "verificationStatus", label: "Verification", icon: "✓" },
  { key: "runtimeStatus", label: "Runtime", icon: "◌" },
  { key: "authorityStatus", label: "Authority", icon: "⌁" },
  { key: "listingStatus", label: "Listing", icon: "▱" }
];

function displayState(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function BrandMark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`brand-mark${compact ? " brand-mark--compact" : ""}`} aria-label="BNBEra">
      <span className="brand-mark__glyph" aria-hidden="true">
        B
      </span>
      {!compact ? <span className="brand-mark__name">BNBEra</span> : null}
    </span>
  );
}

export function StatusBadge({
  label,
  value,
  tone = "neutral"
}: {
  readonly label?: string;
  readonly value: string;
  readonly tone?: StatusTone;
}) {
  return (
    <span
      aria-label={label ? `${label}: ${value}` : value}
      className={`status-badge status-badge--${tone}`}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {label ? <span className="status-badge__label">{label}</span> : null}
      <span>{value}</span>
    </span>
  );
}

export function DataModeBadge({
  mode,
  label
}: {
  readonly mode: "fixture" | "live" | "degraded" | "empty" | "error";
  readonly label: string;
}) {
  const tone: StatusTone = mode === "live"
    ? "success"
    : mode === "degraded"
      ? "warning"
      : mode === "error"
        ? "danger"
        : mode === "empty"
          ? "neutral"
          : "purple";
  return <StatusBadge value={label} tone={tone} />;
}

export function StateAxisGrid({
  axes,
  compact = false
}: {
  readonly axes: AgentStateAxes;
  readonly compact?: boolean;
}) {
  return (
    <div
      className={`state-axis-grid${compact ? " state-axis-grid--compact" : ""}`}
      aria-label="Independent agent state axes"
      role="list"
    >
      {stateAxisMeta.map(({ key, label, icon }) => (
        <div className="state-axis" key={key} role="listitem">
          <span className="state-axis__icon" aria-hidden="true">
            {icon}
          </span>
          <span className="state-axis__copy">
            <span className="state-axis__label">{label}</span>
            <span className="state-axis__value">{displayState(axes[key])}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Callout({
  title,
  children,
  tone = "neutral",
  icon = "i"
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly tone?: StatusTone;
  readonly icon?: string;
}) {
  return (
    <aside className={`callout callout--${tone}`}>
      <span className="callout__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <strong>{title}</strong>
        <div className="callout__body">{children}</div>
      </div>
    </aside>
  );
}

export function LoadingState({ label = "Loading marketplace read model" }: { readonly label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-state__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__orb" aria-hidden="true">
        ∅
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
        {action ? <div className="empty-state__action">{action}</div> : null}
      </div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p className="section-heading__description">{description}</p> : null}
      </div>
      {action ? <div className="section-heading__action">{action}</div> : null}
    </div>
  );
}
