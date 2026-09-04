import { describe, expect, it, vi } from "vitest";
import {
  InMemorySemanticVectorRepository,
  PgVectorSemanticRepository,
  withPgVectorTransaction
} from "../index.js";

const agentVersionId = "11111111-1111-4111-8111-111111111111";
const sourceTextDigest = "a".repeat(64);

describe("semantic vector repository contracts", () => {
  it("matches the complete source/provider/model/version/dimension/schema key", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({ rows: [], rowCount: 0 }));
    const repository = new PgVectorSemanticRepository({ query: query as never });
    await expect(repository.find(agentVersionId, "model-v1", {
      provider: "openrouter",
      model: "openai/text-embedding-3-small",
      modelVersion: "model-v1",
      dimension: 1536,
      sourceTextDigest,
      semanticDocumentSchemaVersion: "bnbera-agent-semantic-v1"
    })).resolves.toBeNull();

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("provider = $3");
    expect(sql).toContain("model = $4");
    expect(sql).toContain("dimension = $5");
    expect(sql).toContain("source_text_digest = $6");
    expect(sql).toContain("semantic_document_schema_version = $7");
    expect(query.mock.calls[0]?.[1]).toEqual([
      agentVersionId,
      "model-v1",
      "openrouter",
      "openai/text-embedding-3-small",
      1536,
      sourceTextDigest,
      "bnbera-agent-semantic-v1"
    ]);
  });

  it("requires a hard-filtered candidate set for public searches and emits visibility joins", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({
      rows: [{
        agent_version_id: agentVersionId,
        embedding: "[1,0,0]",
        provider: "test-provider",
        model: "test-model",
        model_version: "model-v1",
        dimension: 3,
        source_text_digest: sourceTextDigest,
        semantic_document_schema_version: "bnbera-agent-semantic-v1",
        classifier_version: null,
        createdAt: new Date("2026-09-04T00:00:00.000Z"),
        similarity: 1
      }],
      rowCount: 1
    }));
    const repository = new PgVectorSemanticRepository({ query: query as never }, { storageDimension: 3 });
    await expect(repository.search({
      vector: [1, 0, 0],
      provider: "test-provider",
      model: "test-model",
      modelVersion: "model-v1",
      dimension: 3,
      semanticDocumentSchemaVersion: "bnbera-agent-semantic-v1",
      publicOnly: true,
      candidateAgentVersionIds: [agentVersionId, agentVersionId.toUpperCase()],
      limit: 1
    })).resolves.toHaveLength(1);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("INNER JOIN agent_versions");
    expect(sql).toContain("INNER JOIN agents");
    expect(sql).toContain("agents.current_version_id = agent_listing_embeddings.agent_version_id");
    expect(sql).toContain("agents.listing_status = 'published'");
    expect(sql).toContain("agents.verification_status IN ('verified', 'degraded')");
    expect(sql).toContain("agents.runtime_status = 'live'");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "[1,0,0]",
      "model-v1",
      3,
      "test-provider",
      "test-model",
      "bnbera-agent-semantic-v1",
      [agentVersionId],
      1
    ]);

    const noScopeQuery = vi.fn();
    const noScope = new PgVectorSemanticRepository({ query: noScopeQuery as never }, { storageDimension: 3 });
    await expect(noScope.search({
      vector: [1, 0, 0],
      modelVersion: "model-v1",
      dimension: 3,
      publicOnly: true
    })).rejects.toMatchObject({ code: "REPOSITORY_FAILURE" });
    expect(noScopeQuery).not.toHaveBeenCalled();
  });

  it("rejects zero vectors before exact or pgvector search", async () => {
    const query = vi.fn();
    const repository = new PgVectorSemanticRepository({ query: query as never }, { storageDimension: 3 });
    await expect(repository.search({ vector: [0, 0, 0], modelVersion: "model-v1", dimension: 3 })).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
    expect(query).not.toHaveBeenCalled();

    const inMemory = new InMemorySemanticVectorRepository();
    await expect(inMemory.search({ vector: [0, 0, 0], modelVersion: "model-v1", dimension: 3 })).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
  });

  it("commits repository work on one client and rolls back on failure", async () => {
    const client = {
      query: vi.fn(async (..._args: unknown[]) => ({ rows: [], rowCount: 0 })),
      release: vi.fn()
    };
    const pool = { connect: vi.fn(async () => client) };
    await expect(withPgVectorTransaction(pool as never, async (repository) => {
      await repository.find(agentVersionId, "model-v1");
      return "done";
    })).resolves.toBe("done");
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", expect.stringContaining("SELECT"), "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);

    const failingClient = {
      query: vi.fn(async (sql: string, ..._args: unknown[]) => {
        if (sql === "COMMIT") throw new Error("commit failed");
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn()
    };
    await expect(withPgVectorTransaction({ connect: vi.fn(async () => failingClient) } as never, async () => "never")).rejects.toThrow("commit failed");
    expect(failingClient.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(failingClient.release).toHaveBeenCalledTimes(1);
  });
});
