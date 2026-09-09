import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ configured: false, connected: false }));
vi.mock("./eoa-wallet-provider", () => ({ get walletConnectProjectConfigured() { return state.configured; } }));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: state.connected, address: state.connected ? "0x1234567890123456789012345678901234567890" : undefined }),
  useConnect: () => ({ connectors: state.configured ? [{ id: "walletConnect" }] : [], connectAsync: vi.fn(), isPending: false }),
  useDisconnect: () => ({ disconnectAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(), isPending: false })
}));
import { GlobalWallet } from "./global-wallet";
beforeEach(() => { state.configured = false; state.connected = false; });
describe("global wallet entry", () => {
  it("preserves browser wallet access without WalletConnect configuration", () => {
    const html = renderToStaticMarkup(<GlobalWallet />);
    expect(html).toContain("WalletConnect QR is unavailable");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Browser wallets can still connect");
  });
  it("offers configured WalletConnect without pretending payment approval", () => {
    state.configured = true;
    const html = renderToStaticMarkup(<GlobalWallet />);
    expect(html).toContain("Connect wallet");
    // The browser-only connector becomes ready after hydration, not during SSR.
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("WalletConnect QR is unavailable");
    expect(html).toContain("each payment require your approval");
  });
  it("shows the shared connected address and disconnect action", () => {
    state.configured = true; state.connected = true;
    const html = renderToStaticMarkup(<GlobalWallet />);
    expect(html).toContain("0x1234…7890");
    expect(html).toContain("Disconnect");
    expect(html).toContain("does not grant payment approval");
    expect(html).toContain("BNB mainnet");
    expect(html).toContain("BNB testnet");
  });
});
