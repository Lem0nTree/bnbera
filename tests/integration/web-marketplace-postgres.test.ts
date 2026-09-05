import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../../packages/db/src/client.js";
import { GET as getMarketplace } from "../../apps/web/app/api/marketplace/route";
import { GET as getMarketplaceAgent } from "../../apps/web/app/api/marketplace/[slug]/route";
import { closeMarketplaceDatabaseForTests } from "../../apps/web/src/lib/marketplace-server";
import {
  marketplaceAgentReadResponseSchema,
  marketplaceSearchResponseSchema
} from "../../apps/web/src/lib/marketplace-contract";

const databaseUrl = process.env.DATABASE_URL?.trim() || null;
const requireDatabaseTests = process.env.BNBERA_REQUIRE_DATABASE_TESTS === "true";
const environmentKeys = [
  "NODE_ENV",
  "BNBERA_ENV",
  "DATABASE_URL",
  "DATABASE_SSL",
  "MARKETPLACE_DATA_MODE",
  "MARKETPLACE_API_URL",
  "MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED",
  "ERC8004_EMBEDDING_PROVIDER",
  "ERC8004_EMBEDDING_MODEL",
  "ERC8004_EMBEDDING_MODEL_VERSION",
  "ERC8004_EMBEDDING_DIMENSION",
  "ERC8004_EMBEDDING_SECRET_REFERENCE"
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

type TestPool = ReturnType<typeof createDb>["pool"];
type Seed = {
  readonly identityId: string;
  readonly agentId: string;
  readonly versionId: string;
  readonly slug: string;
};

let setupPool: TestPool | null = null;

beforeAll(() => {
  if (databaseUrl !== null) setupPool = createDb(databaseUrl).pool;
});

afterEach(async () => {
  await closeMarketplaceDatabaseForTests();
  for (const key of environmentKeys) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

afterAll(async () => {
  await closeMarketplaceDatabaseForTests();
  if (setupPool !== null) await setupPool.end();
});

function configureLiveEnvironment(): void {
  process.env.NODE_ENV = "development";
  process.env.MARKETPLACE_DATA_MODE = "live";
  process.env.DATABASE_URL = databaseUrl ?? "";
  process.env.DATABASE_SSL = "false";
  delete process.env.BNBERA_ENV;
  delete process.env.MARKETPLACE_API_URL;
  delete process.env.MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED;
  delete process.env.ERC8004_EMBEDDING_PROVIDER;
  delete process.env.ERC8004_EMBEDDING_MODEL;
  delete process.env.ERC8004_EMBEDDING_MODEL_VERSION;
  delete process.env.ERC8004_EMBEDDING_DIMENSION;
  delete process.env.ERC8004_EMBEDDING_SECRET_REFERENCE;
}

async function seedPostgresReadModel(pool: TestPool): Promise<{
  readonly valid: Seed;
  readonly incompleteIdentityId: string;
}> {
  const valid = {
    identityId: randomUUID(),
    agentId: randomUUID(),
    versionId: randomUUID(),
    slug: `qa-postgres-${randomUUID().slice(0, 8)}`
  } as const;
  const incompleteIdentityId = randomUUID();
  const incompleteAgentId = randomUUID();
  const registry = `0x${"8".repeat(40)}`;
  const owner = `0x${"1".repeat(40)}`;
  const wallet = `0x${"2".repeat(40)}`;
  const blockHash = `0x${"a".repeat(64)}`;
  const validAgentNumber = String(Date.now());
  const incompleteAgentNumber = `${validAgentNumber}1`;
  const observedAt = new Date();
  const capabilityManifest = {
    schemaVersion: "qa-capabilities-v1",
    capabilities: [{
      id: "qa-quote",
      description: "Returns a bounded quote for a read-only integration test.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      requiredProtocols: ["mcp"],
      allowedActions: ["quote"]
    }]
  };
  const publicMetadata = {
    name: "Disposable PostgreSQL Agent",
    description: "A verified PostgreSQL-backed marketplace integration record.",
    slug: valid.slug,
    category: "rebalancing",
    supportedProtocols: ["mcp"],
    pricing: {
      model: "free",
      tokenAddress: null,
      tokenSymbol: null,
      decimals: 18,
      minAtomic: null,
      maxAtomic: null,
      observedAt: observedAt.toISOString()
    },
    dataFreshness: {
      status: "fresh",
      observedAt: observedAt.toISOString(),
      source: "qa-postgres-read-model",
      maxAgeSeconds: 300
    }
  };
  const pricingManifest = { model: "free" };
  const serviceUrl = `https://qa.example/${valid.slug}/mcp`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO erc8004_identities
        (id, namespace, chain_id, identity_registry, agent_id, owner_address,
         owner_observed_block, agent_wallet, agent_wallet_observed_block, agent_uri,
         agent_uri_observed_block, observed_block, observed_block_hash, read_consistency)
       VALUES ($1, 'erc8004', 97, $2, $3, $4, 100, $5, 100, $6, 100, 100, $7, 'finalized'),
              ($8, 'erc8004', 97, $2, $9, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      [
        valid.identityId,
        registry,
        validAgentNumber,
        owner,
        wallet,
        `https://qa.example/${valid.slug}/profile.json`,
        blockHash,
        incompleteIdentityId,
        incompleteAgentNumber
      ]
    );
    await client.query(
      `INSERT INTO agents
        (id, identity_id, origin_type, verification_status, runtime_status,
         authority_status, listing_status, category, wallet_provider)
       VALUES ($1, $2, 'discovered', 'verified', 'live', 'none', 'published', 'rebalancing', 'unknown'),
              ($3, $4, 'discovered', 'pending', 'unavailable', 'none', 'draft', 'uncategorized', 'unknown')`,
      [valid.agentId, valid.identityId, incompleteAgentId, incompleteIdentityId]
    );
    await client.query(
      `INSERT INTO agent_versions
        (id, agent_id, version, public_metadata, capability_manifest, pricing_manifest)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [valid.versionId, valid.agentId, JSON.stringify(publicMetadata), JSON.stringify(capabilityManifest), JSON.stringify(pricingManifest)]
    );
    await client.query(`UPDATE agents SET current_version_id = $1 WHERE id = $2`, [valid.versionId, valid.agentId]);
    await client.query(
      `INSERT INTO agent_discovery_sources
        (id, identity_id, source, source_reference, first_observed_at,
         last_observed_at, raw_response_digest, normalized_ingestion_version)
       VALUES ($1, $2, '8004scan', $3, $4, $4, NULL, 'qa-postgres-v1')`,
      [randomUUID(), valid.identityId, `qa-source-${randomUUID()}`, observedAt]
    );
    await client.query(
      `INSERT INTO agent_capability_observations
        (id, identity_id, source, schema_version, capability_manifest,
         manifest_digest, observed_at)
       VALUES ($1, $2, '8004scan', 'qa-capabilities-v1', $3::jsonb, $4, $5)`,
      [randomUUID(), valid.identityId, JSON.stringify(capabilityManifest), "b".repeat(64), observedAt]
    );
    await client.query(
      `INSERT INTO agent_service_observations
        (id, identity_id, kind, url, protocol_version, discovery_source,
         validation_status, observed_at, latency_ms, safe_capability_probe,
         capability_manifest_digest)
       VALUES ($1, $2, 'mcp', $3, 'qa-mcp-v1', '8004scan', 'healthy', $4, 12, $5::jsonb, NULL)`,
      [randomUUID(), valid.identityId, serviceUrl, observedAt, JSON.stringify({ protocol: "mcp" })]
    );
    await client.query(
      `INSERT INTO agent_service_probe_results
        (id, identity_id, kind, url, validation_status, status_code,
         latency_ms, safe_capability_probe, error_code, observed_at)
       VALUES ($1, $2, 'mcp', $3, 'healthy', 200, 12, $4::jsonb, NULL, $5)`,
      [randomUUID(), valid.identityId, serviceUrl, JSON.stringify({ protocol: "mcp" }), observedAt]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { valid, incompleteIdentityId };
}

async function removePostgresReadModel(pool: TestPool, seed: { readonly valid: Seed; readonly incompleteIdentityId: string }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM agents WHERE id = $1`, [seed.valid.agentId]);
    await client.query(`DELETE FROM agents WHERE identity_id = $1`, [seed.incompleteIdentityId]);
    await client.query(`DELETE FROM erc8004_identities WHERE id IN ($1, $2)`, [seed.valid.identityId, seed.incompleteIdentityId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("PostgreSQL-backed marketplace API", () => {
  it("requires an injected database URL when CI database coverage is enabled", () => {
    if (requireDatabaseTests) expect(databaseUrl).not.toBeNull();
  });

  it.skipIf(databaseUrl === null && !requireDatabaseTests)("reads live records and exposes empty, degraded, and detail states honestly", async () => {
    configureLiveEnvironment();
    const pool = setupPool;
    if (pool === null) throw new Error("The PostgreSQL test pool was not initialized.");

    const empty = await getMarketplace(new Request("https://bnbera.example/api/marketplace?q=qa-no-such-agent"));
    const emptyBody = marketplaceSearchResponseSchema.parse(await empty.json());
    expect(empty.status).toBe(200);
    // With synchronization disabled, the source truthfully reports stale
    // projection state as degraded even when the query has no matching rows.
    expect(["empty", "degraded"]).toContain(emptyBody.status);
    expect(emptyBody.agents).toEqual([]);
    expect(["empty", "live", "degraded"]).toContain(emptyBody.mode);

    const seed = await seedPostgresReadModel(pool);
    try {
      const browse = await getMarketplace(new Request("https://bnbera.example/api/marketplace"));
      const browseBody = marketplaceSearchResponseSchema.parse(await browse.json());
      expect(browse.status).toBe(200);
      expect(browseBody.status).toBe("degraded");
      expect(browseBody.mode).toBe("degraded");
      expect(browseBody.agents.map((agent) => agent.slug)).toContain(seed.valid.slug);
      const persistedAgent = browseBody.agents.find((agent) => agent.slug === seed.valid.slug);
      expect(persistedAgent).toMatchObject({
        category: "rebalancing",
        dataProvenance: { mode: "degraded" },
        name: "Disposable PostgreSQL Agent"
      });
      expect(persistedAgent?.identity).toMatchObject({
        namespace: "erc8004",
        chainId: 97,
        identityRegistry: `0x${"8".repeat(40)}`
      });

      const detail = await getMarketplaceAgent(
        new Request(`https://bnbera.example/api/marketplace/${seed.valid.slug}`),
        { params: Promise.resolve({ slug: seed.valid.slug }) }
      );
      const detailBody = marketplaceAgentReadResponseSchema.parse(await detail.json());
      expect(detail.status).toBe(200);
      expect(detailBody.status).toBe("degraded");
      expect(detailBody.mode).toBe("degraded");
      expect(detailBody.agent).toMatchObject({
        slug: seed.valid.slug,
        name: "Disposable PostgreSQL Agent",
        dataProvenance: { mode: "degraded" },
        stateAxes: {
          originType: "discovered",
          verificationStatus: "verified",
          runtimeStatus: "live",
          listingStatus: "published"
        }
      });
    } finally {
      await removePostgresReadModel(pool, seed);
    }
  });
});
