import type { StatusTone } from "@bnbera/ui";

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
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
  if (["rejected", "revoked", "unavailable", "delisted", "suspended", "expired"].includes(value)) {
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
