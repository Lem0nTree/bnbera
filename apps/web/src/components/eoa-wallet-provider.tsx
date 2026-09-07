"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bscTestnet } from "viem/chains";
import { WagmiProvider, createConfig, http, type Config } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { useState, type ReactNode } from "react";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

/**
 * The WalletConnect project ID is public configuration and deliberately stays
 * outside the standards lock. Without it the connector is omitted, keeping
 * the marketplace read-only rather than constructing an invalid connector.
 */
export const walletConnectProjectConfigured = projectId.length > 0;

export const eoaWagmiConfig: Config = createConfig({
  chains: [bscTestnet],
  connectors: walletConnectProjectConfigured
    ? [walletConnect({ projectId, showQrModal: true })]
    : [],
  transports: {
    [bscTestnet.id]: http()
  },
  // T5 intentionally exposes exactly one connector. Do not let wagmi add
  // injected providers (including MetaMask's extension) behind our back.
  multiInjectedProviderDiscovery: false,
  ssr: true
});

export function EoaWalletProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={eoaWagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
