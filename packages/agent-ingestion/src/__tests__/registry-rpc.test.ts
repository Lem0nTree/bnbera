import { describe, expect, it } from "vitest";
import {
  JsonRpcClient,
  JsonRpcRegistryChainReader,
  createOfficialErc8004RegistryReadDefinitions,
  officialErc8004IdentityAbiSha256
} from "../index.js";

const registry = "0x1111111111111111111111111111111111111111";
const identity = { namespace: "eip155", chainId: 97, identityRegistry: registry, agentId: "7" } as const;
const blockHash = `0x${"aa".repeat(32)}`;

function rpcResponse(result: unknown, id: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "content-type": "application/json" } });
}

function rpcError(error: Readonly<Record<string, unknown>>, id: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error }), { status: 200, headers: { "content-type": "application/json" } });
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function addressResult(value: string): string {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function stringResult(value: string): string {
  const bytes = Buffer.from(value, "utf8").toString("hex");
  const paddedBytes = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return `0x${word(32n)}${word(BigInt(bytes.length / 2))}${paddedBytes}`;
}

describe("configured read-only registry adapter", () => {
  it("generates v2 ownerOf/getAgentWallet/tokenURI calldata from the pinned ABI for a uint256-max ID", async () => {
    const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: officialErc8004IdentityAbiSha256 });
    const maxId = ((1n << 256n) - 1n).toString(10);
    const largeIdentity = { ...identity, agentId: maxId } as const;

    expect(definitions.abiSha256).toBe(officialErc8004IdentityAbiSha256);
    expect(definitions.owner.calldata(largeIdentity)).toBe(`0x6352211e${word((1n << 256n) - 1n)}`);
    expect(definitions.agentWallet.calldata(largeIdentity)).toBe(`0x00339509${word((1n << 256n) - 1n)}`);
    // The deployed v2 API calls the registry value tokenURI; the adapter
    // exposes it as agentUri without inventing an agentURI selector.
    expect(definitions.agentUri.calldata(largeIdentity)).toBe(`0xc87b56dd${word((1n << 256n) - 1n)}`);
    expect(() => createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: "0".repeat(64) })).toThrow(/standards lock/i);
  });

  it("reads owner, zero-wallet sentinel, and tokenURI at one explicit block for the pinned ABI", async () => {
    const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: officialErc8004IdentityAbiSha256 });
    const calls: Array<{ readonly data: string; readonly blockTag: string }> = [];
    const owner = "0x2222222222222222222222222222222222222222";
    const fetcher = async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { readonly method: string; readonly id: number; readonly params?: readonly unknown[] };
      if (body.method === "eth_chainId") return rpcResponse("0x61", body.id);
      if (body.method === "eth_getBlockByNumber") return rpcResponse({ hash: blockHash }, body.id);
      if (body.method === "eth_call") {
        const request = body.params?.[0] as { readonly data?: unknown } | undefined;
        const blockTag = body.params?.[1];
        calls.push({ data: String(request?.data), blockTag: String(blockTag) });
        if (request?.data === definitions.owner.calldata(identity)) return rpcResponse(addressResult(owner), body.id);
        if (request?.data === definitions.agentWallet.calldata(identity)) return rpcResponse(addressResult("0x0000000000000000000000000000000000000000"), body.id);
        if (request?.data === definitions.agentUri.calldata(identity)) return rpcResponse(stringResult("https://agent.example/metadata.json"), body.id);
      }
      throw new Error(`unexpected request ${body.method}`);
    };
    const reader = new JsonRpcRegistryChainReader({
      chainId: 97,
      identityRegistry: registry,
      client: new JsonRpcClient("https://rpc.example.test", { fetch: fetcher }),
      ...definitions,
      readConsistency: "finalized"
    });

    const state = await reader.readIdentity(identity, { blockNumber: 10, blockHash });
    expect(state).toMatchObject({
      ownerAddress: owner,
      agentWallet: null,
      agentUri: "https://agent.example/metadata.json",
      contentDigest: null,
      observedBlock: 10,
      observedBlockHash: blockHash,
      readConsistency: "finalized",
      ownerObservedBlock: 10,
      agentWalletObservedBlock: 10,
      agentUriObservedBlock: 10,
      contentDigestObservedBlock: null
    });
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.blockTag === "0xa")).toBe(true);
    expect(calls.map((call) => call.data)).toEqual([
      definitions.owner.calldata(identity),
      definitions.agentWallet.calldata(identity),
      definitions.agentUri.calldata(identity)
    ]);
  });

  it("preserves a nonexistent/reverting registry read as an error", async () => {
    const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: officialErc8004IdentityAbiSha256 });
    const fetcher = async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { readonly method: string; readonly id: number };
      if (body.method === "eth_chainId") return rpcResponse("0x61", body.id);
      if (body.method === "eth_getBlockByNumber") return rpcResponse({ hash: blockHash }, body.id);
      if (body.method === "eth_call") return rpcError({ code: -3_201, message: "execution reverted: ERC721NonexistentToken" }, body.id);
      throw new Error(`unexpected request ${body.method}`);
    };
    const reader = new JsonRpcRegistryChainReader({
      chainId: 97,
      identityRegistry: registry,
      client: new JsonRpcClient("https://rpc.example.test", { fetch: fetcher }),
      ...definitions
    });

    await expect(reader.readIdentity(identity, { blockNumber: 10, blockHash })).rejects.toMatchObject({ code: "CHAIN_PROVIDER_ERROR" });
  });

  it("rejects an explicit block tag when the provider reports a different canonical hash", async () => {
    const definitions = createOfficialErc8004RegistryReadDefinitions({ expectedAbiSha256: officialErc8004IdentityAbiSha256 });
    const fetcher = async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { readonly method: string; readonly id: number };
      if (body.method === "eth_chainId") return rpcResponse("0x61", body.id);
      if (body.method === "eth_getBlockByNumber") return rpcResponse({ hash: `0x${"bb".repeat(32)}` }, body.id);
      throw new Error(`unexpected request ${body.method}`);
    };
    const reader = new JsonRpcRegistryChainReader({
      chainId: 97,
      identityRegistry: registry,
      client: new JsonRpcClient("https://rpc.example.test", { fetch: fetcher }),
      ...definitions
    });

    await expect(reader.readIdentity(identity, { blockNumber: 10, blockHash })).rejects.toMatchObject({ code: "REORG_RECONCILIATION_REQUIRED" });
  });

  it("reads all identity fields at a trusted explicit block with injected ABI decoders", async () => {
    const fetcher = async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { readonly method: string; readonly id: number };
      if (body.method === "eth_chainId") return rpcResponse("0x61", body.id);
      if (body.method === "eth_getBlockByNumber") return rpcResponse({ hash: blockHash }, body.id);
      if (body.method === "eth_call") return rpcResponse("0x", body.id);
      throw new Error(`unexpected ${body.method}`);
    };
    const client = new JsonRpcClient("https://rpc.example.test", { fetch: fetcher });
    const reader = new JsonRpcRegistryChainReader({
      chainId: 97,
      identityRegistry: registry,
      client,
      owner: { calldata: () => "0x11111111", decode: () => "0x2222222222222222222222222222222222222222" },
      agentWallet: { calldata: () => "0x22222222", decode: () => null },
      agentUri: { calldata: () => "0x33333333", decode: () => "data:application/json,%7B%7D" },
      contentDigest: { calldata: () => "0x44444444", decode: () => "aabb".repeat(16) },
      readConsistency: "finalized"
    });
    const state = await reader.readIdentity(identity, { blockNumber: 10, blockHash });
    expect(state).toMatchObject({ ownerAddress: "0x2222222222222222222222222222222222222222", agentWallet: null, agentUri: "data:application/json,%7B%7D", contentDigest: "aabb".repeat(16), observedBlock: 10, readConsistency: "finalized" });
  });

  it("rejects write RPC methods before a provider call", async () => {
    let called = false;
    const client = new JsonRpcClient("https://rpc.example.test", { fetch: async () => { called = true; return rpcResponse(null, 1); } });
    await expect(client.request({ method: "eth_sendRawTransaction", params: [] })).rejects.toThrow(/read-only/i);
    expect(called).toBe(false);
  });
});
