import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommerceWalletPanel } from "./commerce-wallet-panel";
const props = { address: "0x267054A4E06604CA5B5411ed8A3D29D5c84fC08b", network: "BNB mainnet", walletOnly: true, busy: false, choices: <div>Connector choices</div>, onConnect: () => {}, onSwitch: () => {}, onSignIn: () => {}, onDisconnect: () => {} };
describe("buyer access presentation", () => {
  it("uses the header connection entry once while disconnected", () => {
    const html = renderToStaticMarkup(<CommerceWalletPanel {...props} state="disconnected" />);
    expect(html).toContain("Choose wallet");
    expect(html).not.toContain("Connector choices");
    expect(html).not.toContain("Sign in with wallet");
    expect(html).not.toContain(props.address);
  });
  it("shows sign-in rather than another connection prompt for connected buyers", () => {
    const html = renderToStaticMarkup(<CommerceWalletPanel {...props} state="connected" />);
    expect(html).toContain("0x2670…C08b");
    expect(html).toContain("Sign in with wallet");
    expect(html).toContain("does not approve a payment");
    expect(html).not.toContain("Choose wallet");
  });
  it("requires network switching before sign-in", () => {
    const html = renderToStaticMarkup(<CommerceWalletPanel {...props} state="wrong_network" />);
    expect(html).toContain("Switch to BNB mainnet");
    expect(html).not.toContain("Sign in with wallet");
  });
  it("does not request another sign-in when ready", () => {
    const html = renderToStaticMarkup(<CommerceWalletPanel {...props} state="ready" />);
    expect(html).toContain("Signed in");
    expect(html).not.toContain("Sign in with wallet");
  });
});
