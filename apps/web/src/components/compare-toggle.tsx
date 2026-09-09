"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const maxCompareAgents = 3;

function selectedAgents(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .slice(0, maxCompareAgents);
}

export function CompareToggle({ slug }: { readonly slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = selectedAgents(searchParams.get("agents"));
  const isSelected = selected.includes(slug);
  const maxed = selected.length >= maxCompareAgents && !isSelected;

  function toggle(): void {
    const next = isSelected ? selected.filter((item) => item !== slug) : [...selected, slug];
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) {
      params.set("agents", next.join(","));
    } else {
      params.delete("agents");
    }
    const target = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
    router.push(target, { scroll: false });
  }

  return (
    <button
      className={`compare-toggle${isSelected ? " compare-toggle--selected" : ""}`}
      type="button"
      onClick={toggle}
      disabled={maxed}
      aria-pressed={isSelected}
      aria-label={isSelected ? `Remove ${slug} from comparison` : `Add ${slug} to comparison`}
      title={maxed ? "Compare up to three agents" : undefined}
    >
      {isSelected ? "In compare" : maxed ? "Compare full" : "Compare"}
    </button>
  );
}
