import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retired comparison product", () => {
  it("has no active comparison controls or preserved shortlist", () => {
    for (const path of ["agent-card.tsx", "agent-detail-view.tsx", "app-navigation.tsx", "marketplace-explorer.tsx"]) {
      const source = readFileSync(new URL(`../components/${path}`, import.meta.url), "utf8");
      expect(source).not.toContain("CompareToggle");
      expect(source).not.toContain("/compare");
      expect(source).not.toContain("selectedCompare");
    }
    expect(readFileSync(new URL("../../app/compare/page.tsx", import.meta.url), "utf8")).toContain('redirect("/marketplace")');
  });
  it("shares a single shell wallet provider with hire flows", () => {
    expect(readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8")).toContain("<EoaWalletProvider>");
    for (const path of ["commerce-journey.tsx", "hired-dashboard.tsx"]) {
      expect(readFileSync(new URL(`../components/${path}`, import.meta.url), "utf8")).not.toContain("<EoaWalletProvider>");
    }
  });
});
