"use client";
import React, { useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { WalletConnectorChoices } from "./wallet-connector-choices";

export function GlobalWallet() {
  const { address, isConnected, chain, chainId, connector } = useAccount();
  const { disconnectAsync, isPending: disconnecting } = useDisconnect();
  const [message, setMessage] = useState<string | null>(null);
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const logout = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Sign-out could not complete. Try again.");
  };
  const closeWallet = async () => {
    setMessage(null);
    try { await logout(); await disconnectAsync(); }
    catch { setMessage("The wallet could not finish disconnecting. Check your wallet and try again."); }
  };
  return <details className="global-wallet"><summary><span aria-hidden="true">▣</span> {isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet"}</summary><div className="global-wallet__panel">
    <strong>{isConnected ? "Wallet connected" : "Choose your wallet"}</strong>
    <p>{isConnected ? `${connector?.name ?? "Wallet"} · ${chain?.name ?? `Chain ${chainId ?? "unknown"}`}. Connecting does not grant payment approval.` : "Connect a browser wallet or scan with WalletConnect. Sign-in and each payment require your approval."}</p>
    {isConnected ? <><div className="wallet-networks" aria-label="Wallet network">{([{ id: 56, name: "BNB mainnet" }, { id: 97, name: "BNB testnet" }] as const).map(network => <button className="button" type="button" key={network.id} aria-pressed={chainId === network.id} disabled={switching || disconnecting || chainId === network.id} onClick={async () => {
      setMessage(null);
      try { await logout(); await switchChainAsync({ chainId: network.id }); setMessage("Network changed. Sign in again when you are ready to hire."); }
      catch { setMessage("The network change was canceled or could not complete. Confirm the network in your wallet."); }
    }}>{network.name}</button>)}</div><small>Each agent shows its supported network and current hiring availability.</small><button className="button" type="button" disabled={disconnecting || switching} onClick={() => void closeWallet()}>{disconnecting ? "Disconnecting…" : "Disconnect"}</button></> : <WalletConnectorChoices />}
    {message && <p role="status">{message}</p>}
  </div></details>;
}
