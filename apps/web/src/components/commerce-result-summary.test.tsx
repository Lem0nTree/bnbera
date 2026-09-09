import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommerceResultSummary } from "./commerce-result-summary";

const fixture = {
  fixture: true, source: "bnbera.fixture.health-factor", account: "0x1111111111111111111111111111111111111111",
  chainId: 97, protocol: "Venus", observedAtUnix: 1_700_000_000, healthFactor: 1.72, unit: "ratio", interpretation: "safe",
};

describe("known commerce result presentation", () => {
  it("labels fixture evidence and retains the reported assessment", () => {
    const html = renderToStaticMarkup(<CommerceResultSummary result={{ schemaVersion: "bnbera.erc8183.result/v1", result: fixture }} />);
    expect(html).toContain("1.72 ratio");
    expect(html).toContain("Reported assessment: safe");
    expect(html).toContain("not a live account measurement");
  });
  it("preserves exact values and caller-attested provenance", () => {
    const html = renderToStaticMarkup(<CommerceResultSummary result={{ ...fixture, fixture: false, source: "bnbera.reference.health-factor", healthFactorExact: "1.720000000000000001", collateralValueUsd: "2100.000000000000000001", debtValueUsd: "1000", liquidationThresholdBps: 8000, provenance: { sourceKind: "caller_attested", sourceReference: "https://example.com/snapshot", observedAtUnix: 1_700_000_000 } }} />);
    expect(html).toContain("1.720000000000000001 ratio");
    expect(html).toContain("2100.000000000000000001 USD");
    expect(html).toContain("Caller-attested snapshot");
  });
  it.each([{ healthFactor: 1.72 }, { ...fixture, interpretation: "guaranteed" }, { ...fixture, healthFactor: Infinity }])("does not interpret unsupported or malformed evidence", (result) => {
    const html = renderToStaticMarkup(<CommerceResultSummary result={result} />);
    expect(html).toContain("Open the raw result");
    expect(html).not.toContain("Reported assessment");
  });
});
