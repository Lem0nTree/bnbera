import type { StatusTone } from "@bnbera/ui";
import type { AgentCategory } from "@bnbera/domain";

/** Display wording only; signed token symbols and amounts remain unchanged. */
export function priceDisplayLabel(value: string): string {
  return value.replace(/\bU\b/g, "United Dollars");
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function categoryLabel(category: AgentCategory): string {
  const labels: Record<AgentCategory, string> = {
    rebalancing: "LP rebalancing",
    "grid-trading": "Grid trading",
    "yield-optimisation": "Yield optimisation",
    "health-factor": "Health factor",
    uncategorized: "Uncategorized"
  };
  return labels[category];
}

export function categoryDescription(category: AgentCategory): string {
  const descriptions: Record<AgentCategory, string> = {
    rebalancing: "Range-aware liquidity operators with explicit protocol and risk boundaries.",
    "grid-trading": "Bounded price-band strategies that disclose inventory and turnover limits.",
    "yield-optimisation": "Structured venue comparisons with current-data provenance and assumptions.",
    "health-factor": "Lending risk monitors that explain thresholds, data freshness, and authority.",
    uncategorized: "Records that still need enough structured capability evidence for classification."
  };
  return descriptions[category];
}

export function compactAddress(address: string | null): string {
  if (!address) {
    return "Not observed";
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatObservedAt(value: string | null): string {
  if (!value) {
    return "Not observed";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid observation";
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(parsed);
}

export function statusTone(value: string): StatusTone {
  if (["live", "verified", "active", "published", "fresh", "healthy"].includes(value)) {
    return "success";
  }
  if (["degraded", "stale", "pending", "paused", "claimed"].includes(value)) {
    return "warning";
  }
  if (["rejected", "revoked", "unavailable", "unhealthy", "delisted", "suspended", "expired"].includes(value)) {
    return "danger";
  }
  if (["fixture", "created", "discovered", "manual_import"].includes(value)) {
    return "purple";
  }
  return "neutral";
}

export function categoryClass(category: string): string {
  return category.replaceAll("_", "-");
}

export function joinOrFallback(values: readonly string[], fallback: string): string {
  return values.length > 0 ? values.join(" · ") : fallback;
}
