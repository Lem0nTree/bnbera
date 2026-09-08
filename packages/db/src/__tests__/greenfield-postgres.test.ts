import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { GreenfieldPostgresAdapter, type GreenfieldLocatorRow } from "../greenfield-postgres.js";

type Query = { readonly text: string; readonly values: readonly unknown[] };

function databaseRow(row: GreenfieldLocatorRow): Record<string, unknown> {
  return {
    id: row.id,
    evidence_object_id: row.evidence_object_id,
    publication_attempt_id: row.publication_attempt_id,
    provider: row.provider,
    provider_label: row.provider_label,
    network: row.network,
    uri: row.uri,
    bucket: row.bucket,
    object_name: row.object_name,
    provider_reference: row.provider_reference,
    version: row.version,
    sha256_digest: row.sha256_digest,
    keccak256_digest: row.keccak256_digest,
    size_bytes: row.size_bytes,
    immutable: row.immutable,
    verified_at: row.verified_at,
    created_at: row.created_at
  };
}

class LocatorDatabaseMock {
  row: GreenfieldLocatorRow | null = null;
  readonly queries: Query[] = [];

  async query(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }> {
    this.queries.push({ text, values });
    const normalized = text.trimStart();

    if (normalized.startsWith("INSERT INTO evidence_locators")) {
      const provider = values[3] as GreenfieldLocatorRow["provider"];
      const uri = String(values[6]);
      if (this.row !== null && this.row.provider === provider && this.row.uri === uri) {
        return { rows: [], rowCount: 0 };
      }
      this.row = {
        id: String(values[0]),
        evidence_object_id: String(values[1]),
        publication_attempt_id: values[2] === null ? null : String(values[2]),
        provider,
        provider_label: String(values[4]),
        network: String(values[5]),
        uri,
        bucket: values[7] === null ? null : String(values[7]),
        object_name: values[8] === null ? null : String(values[8]),
        provider_reference: values[9] === null ? null : String(values[9]),
        version: Number(values[10]),
        sha256_digest: String(values[11]),
        keccak256_digest: String(values[12]),
        size_bytes: Number(values[13]),
        immutable: true,
        verified_at: values[14] === null ? null : new Date(values[14] as Date),
        created_at: new Date(values[15] as Date)
      };
      return { rows: [databaseRow(this.row)], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT") && normalized.includes("FROM evidence_locators WHERE provider = $1 AND uri = $2")) {
      const provider = values[0] as GreenfieldLocatorRow["provider"];
      const uri = String(values[1]);
      const row = this.row !== null && this.row.provider === provider && this.row.uri === uri ? this.row : null;
      return { rows: row === null ? [] : [databaseRow(row)], rowCount: row === null ? 0 : 1 };
    }

    if (normalized.startsWith("UPDATE evidence_locators")) {
      const [id, provider, uri, verifiedAt] = values;
      if (
        this.row !== null &&
        this.row.id === String(id) &&
        this.row.provider === provider &&
        this.row.uri === String(uri) &&
        this.row.verified_at === null
      ) {
        this.row = { ...this.row, verified_at: new Date(verifiedAt as Date) };
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected SQL in locator mock: ${normalized}`);
  }
}

function createAdapter(database: LocatorDatabaseMock): GreenfieldPostgresAdapter {
  return new GreenfieldPostgresAdapter(database as unknown as PoolClient);
}

function locator(overrides: Partial<GreenfieldLocatorRow> = {}): GreenfieldLocatorRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    evidence_object_id: "22222222-2222-4222-8222-222222222222",
    publication_attempt_id: "33333333-3333-4333-8333-333333333333",
    provider: "greenfield",
    provider_label: "bnbchain-testnet-sp1",
    network: "greenfield_5600-1",
    uri: "greenfield://bnbera-testnet/profile",
    bucket: "bnbera-testnet",
    object_name: "profile.json",
    provider_reference: "profile.json",
    version: 1,
    sha256_digest: "a".repeat(64),
    keccak256_digest: "b".repeat(64),
    size_bytes: 128,
    immutable: true,
    verified_at: null,
    created_at: new Date("2026-09-08T10:00:00.000Z"),
    ...overrides
  };
}

describe("GreenfieldPostgresAdapter locator verification promotion", () => {
  it("promotes an existing immutable locator after matching readback verification", async () => {
    const database = new LocatorDatabaseMock();
    const adapter = createAdapter(database);
    const pending = locator();
    const verifiedAt = new Date("2026-09-08T10:02:00.000Z");

    await adapter.locators.add(pending);
    await adapter.locators.add({ ...pending, id: "44444444-4444-4444-8444-444444444444", verified_at: verifiedAt });

    expect(database.row?.verified_at).toEqual(verifiedAt);
    expect(database.row?.id).toBe(pending.id);
    expect(database.row?.sha256_digest).toBe(pending.sha256_digest);
    const promotion = database.queries.find((query) => query.text.trimStart().startsWith("UPDATE evidence_locators"));
    expect(promotion?.values).toEqual([pending.id, pending.provider, pending.uri, verifiedAt]);
    expect(promotion?.text).toMatch(/SET verified_at = \$4/);
    expect(promotion?.text).toMatch(/AND verified_at IS NULL/);
  });

  it("does not overwrite a non-null verification time on replay", async () => {
    const database = new LocatorDatabaseMock();
    const adapter = createAdapter(database);
    const firstVerifiedAt = new Date("2026-09-08T10:02:00.000Z");

    await adapter.locators.add({ ...locator(), verified_at: firstVerifiedAt });
    await adapter.locators.add({ ...locator(), id: "55555555-5555-4555-8555-555555555555", verified_at: new Date("2026-09-08T10:03:00.000Z") });
    await adapter.locators.add({ ...locator(), id: "66666666-6666-4666-8666-666666666666", verified_at: null });

    expect(database.row?.verified_at).toEqual(firstVerifiedAt);
    expect(database.queries.filter((query) => query.text.trimStart().startsWith("UPDATE evidence_locators"))).toHaveLength(0);
  });

  it("rejects immutable conflicts before attempting verification promotion", async () => {
    const database = new LocatorDatabaseMock();
    const adapter = createAdapter(database);
    const pending = locator();

    await adapter.locators.add(pending);
    await expect(
      adapter.locators.add({
        ...pending,
        id: "77777777-7777-4777-8777-777777777777",
        sha256_digest: "c".repeat(64),
        verified_at: new Date("2026-09-08T10:02:00.000Z")
      })
    ).rejects.toMatchObject({ code: "DURABLE_GRAPH_INVALID" });

    expect(database.row?.verified_at).toBeNull();
    expect(database.queries.filter((query) => query.text.trimStart().startsWith("UPDATE evidence_locators"))).toHaveLength(0);
  });
});
