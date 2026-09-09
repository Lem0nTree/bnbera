import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommerceQuoteSnapshot } from "@/lib/commerce-quote-contract";
import { CommerceQuoteDetails } from "./commerce-quote-details";

const quote: CommerceQuoteSnapshot = {
  schemaVersion: "bnbera.erc8183-quote/v1", quoteId: "12345678-1234-4234-8234-123456789012", agentIdentifier: "agent",
  identity: { namespace: "eip155", chainId: 56, identityRegistry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", agentId: "123" },
  agentVersionId: "12345678-1234-4234-8234-123456789013", agentVersion: 1,
  providerAddress: "0x4444444444444444444444444444444444444444", providerAddressSource: "erc8004_agent_wallet",
  service: { kind: "a2a", url: "https://seller.example/a2a", protocolVersion: "apex-erc8183-v1", observedAt: "2026-09-09T00:00:00Z", probeObservedAt: "2026-09-09T00:00:00Z" },
  chainId: 56, commerceContract: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6", paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666", paymentDecimals: 18, tokenSymbol: "U",
  priceAtomic: "100000000000000", task: '{"signed":"canonical contract task"}', taskDigest: "a".repeat(64),
  issuedAt: "2026-09-09T00:00:00Z", expiresAt: "2026-09-09T00:05:00Z", status: "draft",
  externalSeller: { protocol: "apex-erc8183-v1", requestedTask: "Summarize this public protocol", signedOffer: "opaque envelope", executionStatus: "unverified", disputeWindowSeconds: 604800 }
};

describe("explicit signed-offer quote presentation", () => {
  it("separates a readable requested task from exact contract data without claiming delivery", () => {
    const html = renderToStaticMarkup(<CommerceQuoteDetails quote={quote} />);
    expect(html).toContain("Provider-signed mainnet offer");
    expect(html).toContain("delivery history unverified");
    expect(html).toContain("Summarize this public protocol");
    expect(html.indexOf("canonical contract task")).toBeGreaterThan(html.indexOf("<details>"));
    expect(html).toContain("0.0001 United Dollars");
    expect(html).toContain("gas paid separately");
    expect(html).toContain("seven-day dispute window");
    expect(html).toContain("starting at on-chain submission");
    expect(html).toContain("read and review the delivery immediately");
    expect(html).toContain("cannot release the seller&#x27;s payment early");
    expect(html).toContain("reject the job earlier");
    expect(html).toContain("Anyone can settle");
    expect(html).toContain("not an on-chain veto");
    expect(html).toContain("never automatically sends");
    expect(html).toContain("18 decimals");
    expect(html).not.toContain("opaque envelope");
    expect(html).not.toContain("<button");
  });

  it("shows the signed seller limits before raw evidence without substituting catalog terms", () => {
    const html = renderToStaticMarkup(<CommerceQuoteDetails quote={{ ...quote, task: JSON.stringify({
      terms: { deliverables: "A one-time loan report", quality_standards: "No monitoring, transactions or custody", success_criteria: ["Use the supplied snapshot"] }
    }) }} />);
    expect(html).toContain("A one-time loan report");
    expect(html).toContain("No monitoring, transactions or custody");
    expect(html).toContain("Use the supplied snapshot");
    expect(html.indexOf("A one-time loan report")).toBeLessThan(html.indexOf("<details>"));
    expect(html.indexOf("No monitoring, transactions or custody")).toBeLessThan(html.indexOf("<details>"));
    expect(html).not.toContain("Seller terms could not be summarized");
  });

  it.each(["invalid JSON", JSON.stringify({ terms: { deliverables: "Incomplete" } })])("does not invent seller terms when their display projection fails", (task) => {
    const html = renderToStaticMarkup(<CommerceQuoteDetails quote={{ ...quote, task }} />);
    expect(html).toContain("Seller terms could not be summarized");
    expect(html).not.toContain("Quality requirements");
  });

  it("keeps reference quotes unchanged and displays their actual price", () => {
    const { externalSeller: omitted, ...reference } = quote;
    void omitted;
    const html = renderToStaticMarkup(<CommerceQuoteDetails quote={{ ...reference, chainId: 97, task: "A reference task", priceAtomic: "1000000000000000" }} />);
    expect(html).toContain("Server quote");
    expect(html).toContain("A reference task");
    expect(html).toContain("0.001 United Dollars");
    expect(html).not.toContain("Experimental");
    expect(html).not.toContain("7-day");
    expect(html).not.toContain("seven-day");
    expect(html).not.toContain("APEX OptimisticPolicy");
    expect(html).not.toContain("Seller terms could not be summarized");
  });
});
