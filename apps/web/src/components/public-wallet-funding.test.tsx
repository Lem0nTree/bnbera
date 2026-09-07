import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { PublicWalletFunding } from "./public-wallet-funding";

const WALLET = "0x1111111111111111111111111111111111111111";

describe("public wallet funding panel", () => {
  it("exposes the full public address with a labelled copy control and manual fallback", () => {
    const markup = renderToStaticMarkup(
      <PublicWalletFunding identifier="agent-2206" walletAddress={WALLET} copyState="idle" onCopy={() => undefined} />
    );

    expect(markup).toContain(`value="${WALLET}"`);
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('aria-label="Copy public wallet address"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("BNB testnet gas and U testnet funds");
    expect(markup).toContain("Ctrl+C or Cmd+C");
    expect(markup).not.toMatch(/private.?key|credential|signer|session/iu);
  });

  it("announces a copied address without exposing anything beyond the public address", () => {
    const markup = renderToStaticMarkup(
      <PublicWalletFunding identifier="agent-2206" walletAddress={WALLET} copyState="copied" onCopy={() => undefined} />
    );

    expect(markup).toContain("Public wallet address copied.");
    expect(markup).toContain(">Copied</button>");
    expect(markup).not.toMatch(/private.?key|credential|signer|session/iu);
  });
});
