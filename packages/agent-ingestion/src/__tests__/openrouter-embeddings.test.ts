import { describe, expect, it, vi } from "vitest";
import { OpenRouterEmbeddingProvider } from "../index.js";
import type { RuntimeEmbeddingConfig } from "@bnbera/config";

const config: RuntimeEmbeddingConfig = {
  provider: "openrouter",
  model: "openai/text-embedding-3-small",
  modelVersion: "openrouter-openai-text-embedding-3-small-v1",
  dimension: 3,
  secretReference: "ERC8004_EMBEDDING_API_KEY"
};

function response(vectors: readonly (readonly number[])[], indices = vectors.map((_, index) => index)): Response {
  return new Response(JSON.stringify({
    object: "list",
    model: config.model,
    data: vectors.map((embedding, position) => ({ embedding, index: indices[position] ?? position, object: "embedding" }))
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OpenRouter embedding adapter", () => {
  it("uses the documented embeddings payload and preserves provider metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-value");
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({
        input: ["first", "second"],
        model: config.model,
        dimensions: config.dimension
      });
      return response([[1, 0, 0], [0, 1, 0]], [1, 0]);
    });
    const provider = new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      fetch: fetcher,
      maxBatchSize: 2,
      headers: { authorization: "Bearer caller-value", "X-Title": "BNBEra test" }
    });

    const vectors = await provider.embedMany(["first", "second"]);
    expect(vectors).toEqual([[0, 1, 0], [1, 0, 0]]);
    expect(provider.provider).toBe("openrouter");
    expect(provider.model).toBe(config.model);
    expect(provider.modelVersion).toBe(config.modelVersion);
    expect(provider.dimension).toBe(3);
  });

  it("chunks large input batches and retries documented transient statuses", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(response([[1, 0, 0]]))
      .mockResolvedValueOnce(response([[0, 1, 0]]));
    const sleeps: number[] = [];
    const provider = new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      fetch: fetcher,
      maxBatchSize: 1,
      maxRetries: 1,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); }
    });

    await expect(provider.embedMany(["one", "two"])).resolves.toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([]);
  });

  it("fails closed on auth, malformed response, and timeout without exposing the credential", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("unauthorized", { status: 401 }));
    const provider = new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      fetch: fetcher
    });
    const authError = await provider.embed("one").catch((error: unknown) => error);
    expect(authError).toMatchObject({ code: "EMBEDDING_AUTH_FAILED" });
    expect(String(authError)).toMatch(/secret|credential|provider/i);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const malformed = new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      fetch: vi.fn<typeof fetch>(async () => response([[1, 0]]))
    });
    await expect(malformed.embed("one")).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });

    const timeoutFetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const timed = new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      fetch: timeoutFetcher,
      timeoutMs: 100,
      maxRetries: 0
    });
    await expect(timed.embed("one")).rejects.toMatchObject({ code: "EMBEDDING_TIMEOUT" });
    expect(String((await timed.embed("one").catch((error: unknown) => error)))).not.toContain("test-value");
  });

  it("requires an HTTPS endpoint unless an explicit test override is supplied", () => {
    expect(() => new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      endpoint: "http://localhost:1234/embeddings"
    })).toThrow(/HTTPS/i);
    expect(() => new OpenRouterEmbeddingProvider({
      config,
      resolveSecret: () => "test-value",
      endpoint: "http://localhost:1234/embeddings",
      allowInsecureEndpoint: true
    })).not.toThrow();
  });
});
