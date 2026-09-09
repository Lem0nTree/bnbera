import { describe, expect, it, vi } from "vitest";
vi.mock("./eoa-wallet-provider", () => ({ walletConnectProjectConfigured: false }));
import { selectWalletConnectors } from "./wallet-connector-choices";

const fallback = { id: "injected", type: "injected" };
const metamask = { id: "io.metamask", type: "injected" };
const rabby = { id: "io.rabby", type: "injected" };
const walletConnect = { id: "walletConnect", type: "walletConnect" };

describe("explicit browser wallet selection", () => {
  it("keeps each EIP-6963 wallet distinct and hides the ambiguous legacy duplicate", () => {
    expect(selectWalletConnectors([fallback, walletConnect, metamask, rabby], true)).toEqual([walletConnect, metamask, rabby]);
  });
  it("offers discovered extensions without WalletConnect configuration", () => {
    expect(selectWalletConnectors([fallback, metamask, rabby], false)).toEqual([metamask, rabby]);
  });
  it("offers legacy injection only when its provider exists and no named extension was discovered", () => {
    expect(selectWalletConnectors([fallback, walletConnect], true)).toEqual([fallback, walletConnect]);
    expect(selectWalletConnectors([fallback, walletConnect], false)).toEqual([walletConnect]);
  });
  it("does not invent wallets in a browser with no provider", () => {
    expect(selectWalletConnectors([fallback], false)).toEqual([]);
  });
});
