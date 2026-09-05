import { describe, expect, it } from "vitest";
import {
  PostgresMarketplaceIngestionState,
  recordMarketplaceRetries,
  rotateMarketplaceBatch,
  type MarketplaceStateQueryable
} from "../index.js";

const identityKey = "eip155:97:0x1111111111111111111111111111111111111111:7";
const observedAt = new Date("2026-09-05T00:00:00.000Z");

function cursorRow(nextOffset = 0) {
  return {
    scope: "marketplace-test",
    chain_id: 97,
    identity_registry: "0x1111111111111111111111111111111111111111",
    page_size: 2,
    next_offset: nextOffset,
    total: 4,
    sweep: 0,
    last_page_at: null,
    updated_at: observedAt
  };
}

class FakeStateDatabase implements MarketplaceStateQueryable {
  public readonly statements: string[] = [];

  public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<{ readonly rows: readonly TRow[]; readonly rowCount?: number | null }> {
    this.statements.push(text);
    if (text.includes("INSERT INTO marketplace_discovery_cursors")) return { rows: [cursorRow() as unknown as TRow] };
    if (text.includes("UPDATE marketplace_discovery_cursors")) return { rows: [cursorRow(2) as unknown as TRow] };
    if (text.includes("FROM marketplace_ingestion_retries r")) return { rows: [] };
    if (text.includes("FROM erc8004_identities")) return { rows: [{ id: "identity-id", identity_key: identityKey } as unknown as TRow] };
    if (text.includes("INSERT INTO marketplace_ingestion_retries")) {
      return {
        rows: [{
          identity_key: identityKey,
          attempt_count: 1,
          next_attempt_at: new Date(observedAt.getTime() + 60_000),
          last_attempt_at: observedAt,
          last_success_at: null,
          last_stage: "failed",
          last_error_code: "PIPELINE_FAILED",
          updated_at: observedAt
        } as unknown as TRow]
      };
    }
    throw new Error(`unexpected state query: ${text}`);
  }
}

describe("persistent marketplace scheduling state", () => {
  it("rotates bounded health batches fairly and wraps at the end", () => {
    expect(rotateMarketplaceBatch(["a", "b", "c", "d"], 0, 2)).toEqual({
      selected: ["a", "b"],
      startOffset: 0,
      nextOffset: 2
    });
    expect(rotateMarketplaceBatch(["a", "b", "c", "d"], 2, 2)).toEqual({
      selected: ["c", "d"],
      startOffset: 2,
      nextOffset: 0
    });
    expect(rotateMarketplaceBatch(["a", "b", "c", "d"], 3, 2)).toEqual({
      selected: ["d", "a"],
      startOffset: 3,
      nextOffset: 1
    });
  });

  it("persists cursor advancement and bounded retry backoff through the SQL port", async () => {
    const database = new FakeStateDatabase();
    const state = new PostgresMarketplaceIngestionState(database);
    await expect(state.ensureDiscoveryCursor({
      scope: "marketplace-test",
      chainId: 97,
      identityRegistry: "0x1111111111111111111111111111111111111111",
      pageSize: 2
    })).resolves.toMatchObject({ nextOffset: 0, total: 4 });
    await expect(state.advanceDiscoveryCursor({
      scope: "marketplace-test",
      expectedOffset: 0,
      nextOffset: 2,
      total: 4,
      pageAt: observedAt
    })).resolves.toMatchObject({ nextOffset: 2 });
    await expect(state.recordRetry(identityKey, {
      stage: "failed",
      errorCode: "pipeline_failed",
      attemptedAt: observedAt
    })).resolves.toMatchObject({ attemptCount: 1, lastErrorCode: "PIPELINE_FAILED" });
    expect(database.statements.filter((statement) => statement.includes("marketplace_discovery_cursors"))).toHaveLength(2);
  });

  it("isolates one retry-write failure from the rest of the bounded batch", async () => {
    const attempts: string[] = [];
    const result = await recordMarketplaceRetries({
      async recordRetry(key) {
        attempts.push(key);
        if (key.endsWith(":2")) throw Object.assign(new Error("missing identity"), { code: "MARKETPLACE_RETRY_IDENTITY_MISSING" });
      }
    }, [
      { identityKey: "eip155:97:0x1111111111111111111111111111111111111111:1", status: "published", pipeline: { ingestion: "completed", registry: "verified", metadata: "resolved" }, versionId: "v1", diagnostics: [] },
      { identityKey: "eip155:97:0x1111111111111111111111111111111111111111:2", status: "failed", pipeline: { ingestion: "failed", registry: "skipped", metadata: "skipped" }, versionId: null, diagnostics: ["PIPELINE_FAILED"] },
      { identityKey: "eip155:97:0x1111111111111111111111111111111111111111:3", status: "withheld", pipeline: { ingestion: "completed", registry: "verified", metadata: "resolved" }, versionId: null, diagnostics: ["PUBLICATION_WITHHELD"] }
    ], observedAt);
    expect(attempts).toHaveLength(3);
    expect(result).toEqual({ recorded: 2, failures: 1, failureCodes: ["MARKETPLACE_RETRY_IDENTITY_MISSING"] });
  });
});
