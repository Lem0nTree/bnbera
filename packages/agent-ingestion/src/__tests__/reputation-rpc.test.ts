import { describe, expect, it, vi } from "vitest";
import { JsonRpcClient, JsonRpcReputationChainReader, createOfficialErc8004ReputationEventDecoder } from "../index.js";

function response(result: unknown, id: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("ERC-8004 reputation RPC reader", () => {
  it("passes NewFeedback and FeedbackRevoked as an OR filter in topic0", async () => {
    const decoder = createOfficialErc8004ReputationEventDecoder();
    const requests: Array<{ readonly method: string; readonly params: readonly unknown[] }> = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { readonly id: number; readonly method: string; readonly params: readonly unknown[] };
      requests.push(body);
      if (body.method === "eth_chainId") return response("0x61", body.id);
      if (body.method === "eth_getLogs") return response([], body.id);
      throw new Error(`unexpected method ${body.method}`);
    });
    const reader = new JsonRpcReputationChainReader({
      chainId: 97,
      identityRegistry: "0x1111111111111111111111111111111111111111",
      reputationRegistry: "0x2222222222222222222222222222222222222222",
      client: new JsonRpcClient("https://rpc.example.test", { fetch: fetcher }),
      logTopics: [decoder.logTopics],
      decodeLog: decoder.decodeLog
    });

    await reader.getReputationEvents({
      chainId: 97,
      identityRegistry: "0x1111111111111111111111111111111111111111",
      reputationRegistry: "0x2222222222222222222222222222222222222222",
      fromBlock: 10,
      toBlock: 11
    });

    const logRequest = requests.find((request) => request.method === "eth_getLogs");
    expect(logRequest?.params[0]).toMatchObject({
      address: "0x2222222222222222222222222222222222222222",
      fromBlock: "0xa",
      toBlock: "0xb",
      topics: [decoder.logTopics]
    });
  });
});
