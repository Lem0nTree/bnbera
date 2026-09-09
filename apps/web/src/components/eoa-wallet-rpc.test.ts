import { describe, expect, it } from "vitest";
import { eoaWagmiConfig } from "./eoa-wallet-provider";

describe("browser mainnet receipt transport", () => {
  it("uses the explicitly configured CORS-capable endpoint instead of the chain default", () => {
    const client = eoaWagmiConfig.getClient({ chainId: 56 });
    expect(client.chain.id).toBe(56);
    expect(client.transport.url).toBe(process.env.NEXT_PUBLIC_BSC_MAINNET_RPC_URL?.trim() || "https://bsc-dataseed.bnbchain.org");
  });
});
