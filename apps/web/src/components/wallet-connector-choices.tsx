"use client";

import React, { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { walletConnectProjectConfigured } from "./eoa-wallet-provider";

export function selectWalletConnectors<T extends { readonly id: string; readonly type: string }>(connectors: readonly T[], legacyAvailable: boolean): readonly T[] {
  const discovered = connectors.filter(connector => connector.type === "injected" && connector.id !== "injected");
  return connectors.filter(connector => connector.id === "walletConnect" || discovered.includes(connector) || (connector.id === "injected" && discovered.length === 0 && legacyAvailable));
}

/** One explicit selection per connection; discovery never requests accounts. */
export function WalletConnectorChoices({ chainId, disabled = false }: { readonly chainId?: 56 | 97; readonly disabled?: boolean }) {
  const { connectors, connectAsync, isPending } = useConnect();
  const [mounted, setMounted] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMounted(true);
    let active = true;
    const fallback = connectors.find(connector => connector.id === "injected");
    if (fallback) void fallback.getProvider().then(provider => { if (active) setLegacyAvailable(Boolean(provider)); }).catch(() => { if (active) setLegacyAvailable(false); });
    return () => { active = false; };
  }, [connectors]);
  const discovered = connectors.filter(connector => connector.type === "injected" && connector.id !== "injected");
  const choices = mounted ? selectWalletConnectors(connectors, legacyAvailable) : [];
  return <div className="wallet-choices">
    {choices.map(connector => <button key={connector.uid} className="button wallet-choice" type="button" disabled={disabled || isPending} onClick={async () => {
      setError(null);
      setSelected(connector.uid);
      try { await connectAsync({ connector, ...(chainId === undefined ? {} : { chainId }) }); }
      catch { setError("Connection was canceled or could not complete. Choose a wallet to try again."); }
      finally { setSelected(null); }
    }}><span className="wallet-choice__icon" aria-hidden="true">{connector.id === "walletConnect" ? "▦" : "▣"}</span><span><strong>{isPending && selected === connector.uid ? "Opening wallet…" : connector.id === "injected" ? "Browser wallet" : connector.name}</strong><small>{connector.id === "walletConnect" ? "Scan QR or open a mobile wallet" : "Connect your browser extension"}</small></span><span aria-hidden="true">↗</span></button>)}
    {!mounted && <button className="button" disabled type="button">Finding wallets…</button>}
    {mounted && discovered.length === 0 && !legacyAvailable && <p className="wallet-choices__note">No browser wallet detected. Open this page with MetaMask or Rabby installed{walletConnectProjectConfigured ? ", or use WalletConnect." : "."}</p>}
    {!walletConnectProjectConfigured && <p className="wallet-choices__note">WalletConnect QR is unavailable in this preview. Browser wallets can still connect.</p>}
    {error && <p role="status">{error}</p>}
  </div>;
}
