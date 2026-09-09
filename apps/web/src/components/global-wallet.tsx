"use client";
import React, { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { walletConnectProjectConfigured } from "./eoa-wallet-provider";

export function GlobalWallet() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [message, setMessage] = useState<string | null>(null);
  const [mounted,setMounted] = useState(false);
  useEffect(()=>setMounted(true),[]);
  const connector = connectors.find(item => item.id === "walletConnect");
  const available = walletConnectProjectConfigured;
  const ready = mounted && available && Boolean(connector);
  return <details className="global-wallet"><summary><span aria-hidden="true">▣</span> {isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet"}</summary><div className="global-wallet__panel"><strong>{isConnected ? "Wallet connected" : "Your wallet, your control"}</strong><p>{isConnected ? `${chain?.name ?? "Unknown network"}. Connecting does not grant payment approval.` : available ? "Connect with WalletConnect. Sign-in and each payment require your approval." : "Wallet connection is unavailable in this preview. You can still explore every agent."}</p>{isConnected ? <button className="button" onClick={() => disconnect()}>Disconnect</button> : <button className="button button--primary" disabled={!ready || isPending} onClick={async () => { if (!connector) return; setMessage(null); try { await connectAsync({ connector }); } catch { setMessage("Connection was canceled or could not complete. Try again when ready."); } }}>{isPending ? "Opening WalletConnect…" : available ? "Connect wallet" : "WalletConnect not configured"}</button>}{message && <p role="status">{message}</p>}</div></details>;
}
