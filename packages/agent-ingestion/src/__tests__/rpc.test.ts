import { describe, expect, it, vi } from "vitest";
import { JsonRpcClient, probeRpc } from "../rpc.js";

function response(result: unknown, id = 1): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("read-only JSON-RPC transport", () => {
  it("rejects endpoints with embedded credentials", () => {
    expect(() => new JsonRpcClient("https://user:pass@example.com/rpc")).toThrow(/endpoint/i);
    expect(() => new JsonRpcClient("https://example.com/rpc?apiKey=secret")).toThrow(/endpoint/i);
  });

  it("probes chain, block, bytecode, and proxy implementation without a write method", async () => {
    const implementation = `0x${"11".repeat(20)}`;
    const proxyCode = `0x${"60".repeat(8)}`;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { readonly id: number; readonly method: string };
      switch (body.method) {
        case "eth_chainId": return response("0x61", body.id);
        case "eth_blockNumber": return response("0x10", body.id);
        case "eth_getBlockByNumber": return response({ hash: `0x${"22".repeat(32)}` }, body.id);
        case "eth_getCode": return response(proxyCode, body.id);
        case "eth_getStorageAt": return response(`0x${"00".repeat(12)}${implementation.slice(2)}`, body.id);
        default: throw new Error(`unexpected method ${body.method}`);
      }
    });
    const report = await probeRpc(
      "https://rpc.example.test",
      97,
      [{ name: "identity", address: `0x${"aa".repeat(20)}` }],
      { fetch: fetcher }
    );
    expect(report.observedChainId).toBe(97);
    expect(report.latestBlock).toBe(16);
    expect(report.contracts[0]).toMatchObject({ bytecodePresent: true, bytecodeLength: 8, implementation });
    expect(fetcher.mock.calls.every(([, request]) => request?.method === "POST")).toBe(true);
    expect(fetcher.mock.calls.some(([, request]) => String(request?.body).includes("eth_sendRawTransaction"))).toBe(false);
  });

  it("fails closed when the endpoint reports another chain", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { readonly id: number };
      return response("0x38", body.id);
    });
    await expect(probeRpc("https://rpc.example.test", 97, [], { fetch: fetcher })).rejects.toThrow(/different chain/i);
  });
});
