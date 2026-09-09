import React, { type ReactNode } from "react";

type WalletPanelProps = {
  readonly state: "disconnected" | "wrong_network" | "connected" | "ready";
  readonly address: string | undefined;
  readonly network: string;
  readonly walletOnly: boolean;
  readonly busy: boolean;
  readonly choices: ReactNode;
  readonly onConnect: () => void;
  readonly onSwitch: () => void;
  readonly onSignIn: () => void;
  readonly onDisconnect: () => void;
};

/** Presentation only: connection, SIWE and transaction authority remain separate. */
export function CommerceWalletPanel({ state, address, network, walletOnly, busy, choices, onConnect, onSwitch, onSignIn, onDisconnect }: WalletPanelProps) {
  const title = state === "disconnected" ? "Connect your buyer wallet" : state === "wrong_network" ? "Switch to the right network" : state === "connected" ? walletOnly ? "Sign in to view your hires" : "Sign in to continue" : "Buyer wallet ready";
  return <section className="commerce-wallet-panel" aria-label="Buyer wallet access">
    <div className="commerce-wallet-panel__heading">
      <span className="commerce-wallet-panel__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7"/><path d="M20 12h-4v4h4"/></svg></span>
      <div><span className="commerce-wallet-panel__eyebrow">Buyer account</span><h3>{title}</h3></div>
    </div>
    <div className="commerce-wallet-panel__identity">
      {address && state !== "disconnected" && <strong title={address}>{address.slice(0, 6)}…{address.slice(-4)}</strong>}
      <span>{network}</span>
      {state === "connected" && <small>Connected · sign-in required</small>}
      {state === "ready" && <small className="signal-positive">Signed in</small>}
    </div>
    <p>{state === "disconnected" ? walletOnly ? "Use the wallet you hired with to access your private jobs and results." : "Connect a wallet to review a signed offer and hire this agent." : state === "wrong_network" ? `Your wallet is on another network. Switch to ${network} to continue.` : state === "connected" ? "Confirm one gasless signature to prove wallet ownership. This does not approve a payment." : "Review each task and payment before approving it in your wallet."}</p>
    <div className="commerce-wallet-panel__actions">
      {state === "disconnected" && (walletOnly ? <button className="button button--primary" type="button" disabled={busy} onClick={onConnect}>Choose wallet</button> : choices)}
      {state === "wrong_network" && <button className="button button--primary" type="button" disabled={busy} onClick={onSwitch}>{busy ? "Switching…" : `Switch to ${network}`}</button>}
      {state === "connected" && <button className="button button--primary" type="button" disabled={busy} onClick={onSignIn}>{busy ? "Confirm in your wallet…" : "Sign in with wallet"}</button>}
      {state === "ready" && <button className="button button--ghost button--small" type="button" disabled={busy} onClick={onDisconnect}>Disconnect wallet</button>}
    </div>
    {state !== "ready" && <small className="commerce-wallet-panel__note">Your wallet stays in your control. Payments require separate approval.</small>}
  </section>;
}
