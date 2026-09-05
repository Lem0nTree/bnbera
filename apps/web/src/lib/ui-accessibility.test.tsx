import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { BrandMark, SectionHeading } from "../../../../packages/ui/src/components";

describe("marketplace UI accessibility primitives", () => {
  it("gives compact BrandMark an allowed accessible name without hiding the full wordmark", () => {
    const compact = renderToStaticMarkup(<BrandMark compact />);
    const full = renderToStaticMarkup(<BrandMark />);

    expect(compact).toContain('role="img"');
    expect(compact).toContain('aria-label="BNBEra"');
    expect(full).toContain("BNBEra");
    expect(full).not.toContain('aria-label="BNBEra"');
  });

  it("supports a page-level h1 while retaining h2 section defaults", () => {
    const pageHeading = renderToStaticMarkup(<SectionHeading headingLevel={1} title="Marketplace" />);
    const sectionHeading = renderToStaticMarkup(<SectionHeading title="State axes" />);

    expect(pageHeading).toContain("<h1");
    expect(pageHeading).toContain(">Marketplace</h1>");
    expect(sectionHeading).toContain("<h2");
    expect(sectionHeading).toContain(">State axes</h2>");
  });
});
