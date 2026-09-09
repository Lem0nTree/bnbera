"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bsc, bscTestnet } from "viem/chains";
import { WagmiProvider, createConfig, http, useAccount, type Config } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { useEffect, useRef, useState, type ReactNode } from "react";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/**
 * The WalletConnect project ID is public configuration and deliberately stays
 * outside the standards lock. Browser wallets do not require a project ID.
 */
export const walletConnectProjectConfigured = projectId.length > 0;

export const eoaWagmiConfig: Config = createConfig({
  chains: [bscTestnet, bsc],
  // WalletConnect's persistent browser storage must never initialize during SSR.
  connectors: [injected({ shimDisconnect: true }), ...(walletConnectProjectConfigured && typeof window !== "undefined"
    ? [walletConnect({ projectId, showQrModal: true })]
    : [])],
  transports: {
    [bscTestnet.id]: http(),
    [bsc.id]: http()
  },
  // EIP-6963 gives each extension its own connector, including MetaMask/Rabby.
  multiInjectedProviderDiscovery: true,
  ssr: true
});

/** Invalidate the server session even when the user is browsing outside a hire. */
function WalletSessionBoundary() {
  const { address, chainId, isConnected, isReconnecting } = useAccount();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (isReconnecting) return;
    const current = isConnected ? `${address?.toLowerCase()}:${chainId}` : null;
    if (previous.current !== null && previous.current !== current) {
      void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" }).catch(() => undefined);
    }
    previous.current = current;
  }, [address, chainId, isConnected, isReconnecting]);
  return null;
}

export function EoaWalletProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={eoaWagmiConfig}>
      <QueryClientProvider client={queryClient}><WalletSessionBoundary />{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
