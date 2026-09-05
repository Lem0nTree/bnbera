import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingBackfillJob,
  InMemoryEmbeddingBackfillRepository,
  InMemorySemanticVectorRepository,
  PgEmbeddingBackfillRepository,
  buildBackfillSemanticDocument,
  ensureSemanticVector,
  ingestionError,
  type EmbeddingBackfillCandidate,
  type EmbeddingProvider
} from "../index.js";

const identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
} as const;

const versions = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"
] as const;

function candidate(agentVersionId: string, text: string): EmbeddingBackfillCandidate {
  return {
    agentVersionId,
    identity,
    category: "yield-optimisation",
    publicMetadata: { name: text, description: `Public ${text} capability` },
    capabilityManifest: {
      capabilities: [{ id: text, description: text, inputSchema: {}, outputSchema: {}, allowedActions: ["quote"] }]
    },
    protocols: ["A2A"],
    actions: ["quote"],
    services: [{ kind: "a2a", url: "https://agent.example/a2a", protocolVersion: "0.3" }],
    classifierVersion: "deterministic-rules-v1"
  };
}

function provider(embed: EmbeddingProvider["embed"] = async () => [1, 0, 0]): EmbeddingProvider {
  return {
    provider: "test-provider",
    model: "test-model",
    modelVersion: "test-v1",
    dimension: 3,
    embed
  };
}

const enabledGates = {
  ERC8004_INGESTION_ENABLED: true,
  MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: true
} as const;

describe("resumable embedding backfill", () => {
  it("selects only current, live, published versions for PostgreSQL backfill", async () => {
    const query = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
    const repository = new PgEmbeddingBackfillRepository({ query: query as never });

    await repository.listCandidates({ afterAgentVersionId: null, limit: 8 });

    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toMatch(/a\.runtime_status = 'live'/iu);
    expect(statement).toMatch(/a\.listing_status = 'published'/iu);
    expect(statement).toMatch(/a\.current_version_id = av\.id/iu);
  });

  it("is disabled by default and does not require a provider or touch the source", async () => {
    const source = {
      listCandidates: vi.fn(async () => [candidate(versions[0], "yield")])
    };
    const job = new EmbeddingBackfillJob({
      source,
      vectorRepository: new InMemorySemanticVectorRepository()
    });
    const result = await job.run({ scope: "disabled" });
    expect(result.status).toBe("disabled");
    expect(source.listCandidates).not.toHaveBeenCalled();
  });

  it("commits ordered pages, resumes from the cursor, and is idempotent after completion", async () => {
    const repository = new InMemoryEmbeddingBackfillRepository([
      candidate(versions[0], "yield one"),
      candidate(versions[1], "yield two"),
      candidate(versions[2], "yield three")
    ]);
    const vectors = new InMemorySemanticVectorRepository();
    const embed = vi.fn(async () => [1, 0, 0]);
    const job = new EmbeddingBackfillJob({
      source: repository,
      checkpointRepository: repository,
      vectorRepository: vectors,
      provider: provider(embed),
      gates: enabledGates,
      now: () => new Date("2026-09-04T00:00:00.000Z")
    });

    const first = await job.run({ scope: "versions", pageSize: 2, maxPages: 1, maxItems: 2 });
    expect(first.status).toBe("partial");
    expect(first.generated).toBe(2);
    expect(first.nextAgentVersionId).toBe(versions[1]);
    expect(embed).toHaveBeenCalledTimes(2);

    const second = await job.run({ scope: "versions", pageSize: 2, maxPages: 1, maxItems: 2 });
    expect(second.status).toBe("partial");
    expect(second.generated).toBe(3);
    expect(second.nextAgentVersionId).toBe(versions[2]);

    const completed = await job.run({ scope: "versions", pageSize: 2, maxPages: 2, maxItems: 2 });
    expect(completed.status).toBe("completed");
    expect(completed.generated).toBe(3);
    expect(completed.checkpoint?.completedAt).not.toBeNull();
    expect(embed).toHaveBeenCalledTimes(3);

    const replay = await job.run({ scope: "versions", pageSize: 2, maxPages: 2, maxItems: 2 });
    expect(replay.status).toBe("completed");
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it("retries bounded provider failures without advancing past a failed item", async () => {
    const repository = new InMemoryEmbeddingBackfillRepository([candidate(versions[0], "yield")]);
    const vectors = new InMemorySemanticVectorRepository();
    let calls = 0;
    const sleeps: number[] = [];
    const flaky = provider(async () => {
      calls += 1;
      if (calls === 1) throw ingestionError("EMBEDDING_PROVIDER_FAILED", "temporary provider failure", "retry_embedding", undefined, true);
      return [1, 0, 0];
    });
    const job = new EmbeddingBackfillJob({
      source: repository,
      checkpointRepository: repository,
      vectorRepository: vectors,
      provider: flaky,
      gates: enabledGates,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      random: () => 0
    });
    const result = await job.run({ scope: "retry", maxRetries: 1, maxPages: 1, maxItems: 1 });
    expect(result.status).toBe("partial");
    expect(result.generated).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([250]);
  });

  it("keeps the semantic document public and rejects incompatible vector versions", async () => {
    const document = buildBackfillSemanticDocument({
      ...candidate(versions[0], "yield"),
      publicMetadata: { name: "Yield", description: "Public description" },
      riskSummary: { endpointStatus: "healthy", balance: "omit", prompt: "omit" }
    });
    expect(document.text).not.toMatch(/balance|prompt|omit/iu);
    const repository = new InMemorySemanticVectorRepository();
    await ensureSemanticVector({ agentVersionId: versions[0], document, classifierVersion: null, provider: provider() }, repository);
    await expect(ensureSemanticVector({
      agentVersionId: versions[0],
      document,
      classifierVersion: null,
      provider: { ...provider(), provider: "other-provider" }
    }, repository)).rejects.toMatchObject({ code: "EMBEDDING_VERSION_CONFLICT" });
  });
});
