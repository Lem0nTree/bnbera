import { describe, expect, it } from "vitest";
import { canonicalSha256Hex } from "@bnbera/domain";
import {
  PostgresMarketplacePublicationService,
  type MarketplacePublicationClient,
  type MarketplacePublicationPool,
  type MarketplacePublicationQueryResult
} from "../index.js";

const identity = {
  namespace: "erc8004",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
} as const;

const observedAt = new Date("2026-09-05T12:00:00.000Z");
const now = new Date("2026-09-05T12:00:20.000Z");
const capabilityManifest = {
  schemaVersion: "capabilities-v1",
  capabilities: [{
    id: "quote",
    description: "Returns a public read-only quote.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    requiredProtocols: ["mcp"],
    allowedActions: ["quote"]
  }]
};

type IdentityRow = {
  identity_id: string;
  agent_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  agent_id_key: string;
  owner_address: string | null;
  agent_uri: string | null;
  observed_block: number | string | null;
  observed_block_hash: string | null;
  read_consistency: string | null;
  current_version_id: string | null;
  origin_type: string;
  claim_status: string;
  verification_status: string;
  runtime_status: string;
  authority_status: string;
  listing_status: string;
};

type VersionRow = {
  id: string;
  version: number;
  public_metadata: unknown;
  capability_manifest: unknown;
  pricing_manifest: unknown;
};

type CapabilityRow = {
  capability_manifest: unknown;
  manifest_digest: string;
};

type ServiceRow = {
  id: string;
  kind: string;
  url: string;
  protocol_version: string;
  discovery_source: string;
  validation_status: string;
  observed_at: Date;
  latency_ms: number | null;
  safe_capability_probe: Record<string, unknown> | null;
};

type ProbeRow = {
  id: string;
  kind: string;
  url: string;
  validation_status: string;
  observed_at: Date;
};

class PublicationDb implements MarketplacePublicationPool {
  readonly versions: VersionRow[] = [];
  readonly queries: string[] = [];
  readonly services: Array<Record<string, unknown>> = [];
  readonly identity: IdentityRow;
  readonly capabilities: CapabilityRow[];
  readonly serviceRows: ServiceRow[];
  readonly probeRows: ProbeRow[];
  private readonly failOnCommit: boolean;
  private transactionSnapshot: {
    readonly versions: VersionRow[];
    readonly services: Array<Record<string, unknown>>;
    readonly identity: IdentityRow;
  } | null = null;
  private client: PublicationClient;

  public constructor(options: {
    readonly readConsistency?: "finalized" | "provisional";
    readonly probes?: readonly ProbeRow[];
    readonly state?: Partial<Pick<IdentityRow, "verification_status" | "runtime_status" | "listing_status">>;
    readonly failOnCommit?: boolean;
    readonly identityRegistry?: string;
  } = {}) {
    this.failOnCommit = options.failOnCommit ?? false;
    this.identity = {
      identity_id: "00000000-0000-4000-8000-000000000001",
      agent_id: "00000000-0000-4000-8000-000000000002",
      namespace: identity.namespace,
      chain_id: identity.chainId,
      identity_registry: options.identityRegistry ?? identity.identityRegistry,
      agent_id_key: identity.agentId,
      owner_address: "0x2222222222222222222222222222222222222222",
      agent_uri: "https://agent.example/profile.json",
      observed_block: 123,
      observed_block_hash: `0x${"a".repeat(64)}`,
      read_consistency: options.readConsistency ?? "finalized",
      current_version_id: null,
      origin_type: "discovered",
      claim_status: "unclaimed",
      verification_status: options.state?.verification_status ?? "pending",
      runtime_status: options.state?.runtime_status ?? "unavailable",
      authority_status: "none",
      listing_status: options.state?.listing_status ?? "draft"
    };
    this.capabilities = [{
      capability_manifest: capabilityManifest,
      manifest_digest: canonicalSha256Hex(capabilityManifest)
    }];
    this.serviceRows = [{
      id: "00000000-0000-4000-8000-000000000003",
      kind: "mcp",
      url: "https://agent.example/mcp",
      protocol_version: "1.0",
      discovery_source: "8004scan",
      validation_status: "pending",
      observed_at: observedAt,
      latency_ms: 18,
      safe_capability_probe: { protocol: "mcp" }
    }];
    this.probeRows = [...(options.probes ?? [{
      id: "00000000-0000-4000-8000-000000000004",
      kind: "mcp",
      url: "https://agent.example/mcp",
      validation_status: "healthy",
      observed_at: observedAt
    }])];
    this.client = new PublicationClient(this);
  }

  public async connect(): Promise<MarketplacePublicationClient> {
    this.client = new PublicationClient(this);
    return this.client;
  }

  public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<MarketplacePublicationQueryResult<TRow>> {
    return this.client.query(text, values) as Promise<MarketplacePublicationQueryResult<TRow>>;
  }

  queryInternal(text: string, values: readonly unknown[]): MarketplacePublicationQueryResult<Record<string, unknown>> {
    this.queries.push(text.replace(/\s+/gu, " ").trim());
    if (/^BEGIN$/u.test(text.trim())) {
      this.transactionSnapshot = {
        versions: this.versions.map((version) => ({ ...version })),
        services: this.services.map((service) => ({ ...service })),
        identity: { ...this.identity }
      };
      return { rows: [], rowCount: 0 };
    }
    if (/^COMMIT$/u.test(text.trim())) {
      if (this.failOnCommit) throw new Error("disposable commit failure");
      this.transactionSnapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (/^ROLLBACK$/u.test(text.trim())) {
      if (this.transactionSnapshot !== null) {
        this.versions.splice(0, this.versions.length, ...this.transactionSnapshot.versions.map((version) => ({ ...version })));
        this.services.splice(0, this.services.length, ...this.transactionSnapshot.services.map((service) => ({ ...service })));
        Object.assign(this.identity, this.transactionSnapshot.identity);
        this.transactionSnapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM erc8004_identities") && text.includes("FOR UPDATE OF i, a")) return { rows: [this.identity] };
    if (text.includes("FROM agent_capability_observations")) return { rows: this.capabilities };
    if (text.includes("FROM agent_service_observations")) return { rows: this.serviceRows };
    if (text.includes("FROM agent_service_probe_results")) return { rows: this.probeRows };
    if (text.includes("FROM agent_versions") && text.includes("FOR UPDATE") && text.includes("WHERE agent_id = $1 AND version = $2")) {
      const agentId = String(values[0]);
      const version = Number(values[1]);
      return {
        rows: this.versions.filter((candidate) => candidate.version === version && agentId === this.identity.agent_id)
      };
    }
    if (text.includes("FROM agent_versions") && text.includes("FOR UPDATE")) return { rows: this.versions };
    if (text.includes("FROM agent_versions") && text.includes("WHERE id = $1")) {
      const id = String(values[0]);
      return { rows: this.versions.filter((version) => version.id === id) };
    }
    if (text.includes("INSERT INTO agent_versions")) {
      const [id, _agentId, version, metadata, capabilities, pricing] = values;
      const row: VersionRow = {
        id: String(id),
        version: Number(version),
        public_metadata: JSON.parse(String(metadata)),
        capability_manifest: JSON.parse(String(capabilities)),
        pricing_manifest: JSON.parse(String(pricing))
      };
      if (this.versions.some((existing) => existing.id === row.id)) return { rows: [], rowCount: 0 };
      if (this.versions.some((existing) => existing.version === row.version)) return { rows: [], rowCount: 0 };
      this.versions.push(row);
      return { rows: [{ id: row.id, version: row.version }], rowCount: 1 };
    }
    if (text.includes("INSERT INTO agent_services")) {
      const key = `${String(values[1])}\u0000${String(values[2])}\u0000${String(values[3])}`;
      if (this.services.some((service) => `${String(service.agent_version_id)}\u0000${String(service.kind)}\u0000${String(service.url)}` === key)) {
        return { rows: [], rowCount: 0 };
      }
      this.services.push({ id: values[0], agent_version_id: values[1], kind: values[2], url: values[3] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("UPDATE agents")) {
      this.identity.current_version_id = String(values[0]);
      this.identity.verification_status = String(values[1]);
      this.identity.runtime_status = String(values[2]);
      this.identity.listing_status = String(values[3]);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("SELECT av.id") && text.includes("JOIN agents")) {
      const [namespace, chainId, identityRegistry, agentId] = values;
      if (namespace !== this.identity.namespace || Number(chainId) !== this.identity.chain_id ||
          identityRegistry !== this.identity.identity_registry || agentId !== this.identity.agent_id_key) {
        return { rows: [] };
      }
      const row = [...this.versions].sort((left, right) => right.version - left.version)[0];
      return { rows: row === undefined ? [] : [{ id: row.id }] };
    }
    throw new Error(`Unhandled fake publication SQL: ${text}`);
  }
}

class PublicationClient implements MarketplacePublicationClient {
  public constructor(private readonly database: PublicationDb) {}

  public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<MarketplacePublicationQueryResult<TRow>> {
    return this.database.queryInternal(text, values) as MarketplacePublicationQueryResult<TRow>;
  }

  public release(): void {}
}

function publicationInput(description = "A public read-only agent.") {
  return {
    identity,
    publicMetadata: {
      name: "Public quote agent",
      description,
      slug: "public-quote-agent",
      supportedProtocols: ["mcp"]
    },
    capabilityManifest,
    pricingManifest: { model: "unavailable" }
  } as const;
}

function creatorRegistrationPublicationInput() {
  const configurationDigest = "a".repeat(64);
  return {
    ...publicationInput(`A bounded browser-owned Creator agent. BNBEra bounded runtime: tbnb-busd; configuration digest: ${configurationDigest}.`),
    publicMetadata: {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "BUSD bounded agent",
      description: `A bounded browser-owned Creator agent. BNBEra bounded runtime: tbnb-busd; configuration digest: ${configurationDigest}.`,
      services: [{
        name: "A2A",
        endpoint: "https://agent.example/.well-known/agent-card.json",
        protocolVersion: "0.3.0"
      }],
      registrations: [],
      "x-bnbera": {
        template: "pancakeswap-one-shot@1.1.0",
        templateDigest: "b".repeat(64),
        configurationDigest,
        tradingPair: "tbnb-busd"
      },
      slug: "busd-bounded-agent",
      supportedProtocols: ["mcp"]
    }
  } as const;
}

describe("PostgresMarketplacePublicationService", () => {
  it("publishes Creator-shaped ERC-8004 metadata with a control-free description", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish(creatorRegistrationPublicationInput());

    expect(result.status).toBe("published");
    expect(database.versions[0]?.public_metadata).toMatchObject({
      name: "BUSD bounded agent",
      description: expect.not.stringMatching(/[\u0000-\u001f\u007f]/u),
      services: [{ kind: "mcp", protocolVersion: "1.0", discoverySource: "8004scan" }],
      "x-bnbera": { configurationDigest: "a".repeat(64), tradingPair: "tbnb-busd" }
    });
  });

  it("creates one immutable version, then reuses it on same-content replay", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const first = await service.publish(publicationInput());
    const replay = await service.publish(publicationInput());

    expect(first.status).toBe("published");
    expect(first.version).toBe(1);
    expect(first.versionCreated).toBe(true);
    expect(first.versionReused).toBe(false);
    expect(replay.status).toBe("published");
    expect(replay.version).toBe(1);
    expect(replay.versionId).toBe(first.versionId);
    expect(replay.versionCreated).toBe(false);
    expect(replay.versionReused).toBe(true);
    expect(database.versions).toHaveLength(1);
    expect(database.identity.current_version_id).toBe(first.versionId);
    expect(database.identity.verification_status).toBe("verified");
    expect(database.identity.runtime_status).toBe("live");
    expect(database.identity.listing_status).toBe("published");
    expect(database.queries.some((query) => query.includes("FOR UPDATE OF i, a"))).toBe(true);
  });

  it("creates the next immutable version for changed normalized content", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const first = await service.publish(publicationInput());
    const changed = await service.publish(publicationInput("A changed public read-only agent."));

    expect(first.version).toBe(1);
    expect(changed.status).toBe("published");
    expect(changed.version).toBe(2);
    expect(changed.versionId).not.toBe(first.versionId);
    expect(database.versions).toHaveLength(2);
    expect(database.identity.current_version_id).toBe(changed.versionId);
  });

  it("advances the version sequence when content reverts after a published change", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const first = await service.publish(publicationInput());
    await service.publish(publicationInput("A changed public read-only agent."));
    const reverted = await service.publish(publicationInput());

    expect(first.version).toBe(1);
    expect(reverted.status).toBe("published");
    expect(reverted.version).toBe(3);
    expect(reverted.versionId).not.toBe(first.versionId);
    expect(database.versions).toHaveLength(3);
    expect(database.identity.current_version_id).toBe(reverted.versionId);
  });

  it("reuses the newest retained version after a withheld replay", async () => {
    const database = new PublicationDb({ probes: [] });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const first = await service.publish(publicationInput());
    const changed = await service.publish(publicationInput("A changed public read-only agent."));
    const replay = await service.publish(publicationInput("A changed public read-only agent."));

    expect(first.status).toBe("withheld");
    expect(changed.status).toBe("withheld");
    expect(changed.version).toBe(2);
    expect(replay.status).toBe("withheld");
    expect(replay.versionId).toBe(changed.versionId);
    expect(replay.versionCreated).toBe(false);
    expect(replay.versionReused).toBe(true);
    expect(database.versions).toHaveLength(2);
    expect(database.identity.current_version_id).toBeNull();
    expect(await service.versionIdForIdentityKey(changed.identityKey!)).toBe(changed.versionId);
  });

  it("retains a valid version but withholds publication when health is absent", async () => {
    const database = new PublicationDb({ probes: [] });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish(publicationInput());

    expect(result.status).toBe("withheld");
    expect(result.versionCreated).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toEqual(["SERVICE_HEALTH_UNVERIFIED"]);
    expect(result.diagnostics[0]?.message).not.toMatch(/agent\.example|capabilit|0x|42/iu);
    expect(database.versions).toHaveLength(1);
    expect(database.services).toHaveLength(1);
    expect(database.identity.current_version_id).toBeNull();
    expect(database.identity.listing_status).toBe("draft");
  });

  it("keeps provisional identities withheld without promoting state axes", async () => {
    const database = new PublicationDb({ readConsistency: "provisional" });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish(publicationInput());

    expect(result.status).toBe("withheld");
    expect(result.diagnostics.map((item) => item.code)).toEqual(["IDENTITY_READ_NOT_FINALIZED"]);
    expect(result.versionCreated).toBe(true);
    expect(database.identity.verification_status).toBe("pending");
    expect(database.identity.runtime_status).toBe("unavailable");
    expect(database.identity.listing_status).toBe("draft");
  });

  it("requires a persisted capability observation and rejects fixture/sensitive metadata", async () => {
    const database = new PublicationDb();
    database.capabilities.length = 0;
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });
    const missingCapability = await service.publish(publicationInput());
    expect(missingCapability.status).toBe("withheld");
    expect(missingCapability.diagnostics[0]?.code).toBe("CAPABILITY_NOT_PERSISTED");
    expect(database.versions).toHaveLength(0);

    const unsafe = await service.publish({
      ...publicationInput(),
      publicMetadata: { ...publicationInput().publicMetadata, apiKey: "must-not-persist" }
    });
    expect(unsafe.status).toBe("withheld");
    expect(unsafe.diagnostics[0]?.code).toBe("METADATA_INVALID");

    const unsafeCapability = await service.publish({
      ...publicationInput(),
      capabilityManifest: { ...capabilityManifest, apiKey: "must-not-persist" }
    });
    expect(unsafeCapability.status).toBe("withheld");
    expect(unsafeCapability.diagnostics[0]?.code).toBe("CAPABILITY_INVALID");
  });

  it("normalizes the full identity and public pricing/protocol boundary", async () => {
    const database = new PublicationDb({ identityRegistry: "0xAA11111111111111111111111111111111111111" });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish({
      ...publicationInput(),
      identity: { ...identity, identityRegistry: "0xAA11111111111111111111111111111111111111" },
      publicMetadata: {
        ...publicationInput().publicMetadata,
        supportedProtocols: ["mcp", "http"],
        protocols: ["http", "mcp"]
      },
      pricingManifest: {
        model: "fixed",
        network: 56,
        tokenAddress: "0xBb22222222222222222222222222222222222222",
        tokenSymbol: "USDT",
        decimals: 18,
        amountAtomic: "10",
        observedAt: observedAt.toISOString(),
        providerNote: "discarded from the immutable public projection"
      }
    });

    expect(result.status).toBe("published");
    expect(result.identityKey).toBe("erc8004:97:0xaa11111111111111111111111111111111111111:42");
    expect(database.versions[0]?.public_metadata).toMatchObject({
      supportedProtocols: ["http", "mcp"],
      pricing: {
        model: "fixed",
        network: 97,
        tokenAddress: "0xbb22222222222222222222222222222222222222",
        tokenSymbol: "USDT",
        decimals: 18,
        minAtomic: "10",
        maxAtomic: "10",
        observedAt: observedAt.toISOString()
      }
    });
    expect(database.versions[0]?.pricing_manifest).toMatchObject({ model: "fixed", network: 97 });
    expect(database.versions[0]?.public_metadata).not.toHaveProperty("providerNote");
  });

  it("retains only the Creator configuration binding needed for exact G1 handoff", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });
    const configurationDigest = "a".repeat(64);

    const result = await service.publish({
      ...publicationInput(),
      publicMetadata: {
        ...publicationInput().publicMetadata,
        "x-bnbera": {
          configurationDigest,
          tradingPair: "tbnb-busd",
          template: "untrusted-extra-field"
        }
      }
    });

    expect(result.status).toBe("published");
    expect(database.versions[0]?.public_metadata).toMatchObject({
      "x-bnbera": { configurationDigest, tradingPair: "tbnb-busd" }
    });
    expect(database.versions[0]?.public_metadata).not.toMatchObject({
      "x-bnbera": { template: expect.anything() }
    });
  });

  it("persists an explicit ERC-8183 activation binding without changing generic listings", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const generic = await service.publish(publicationInput());
    const reference = await service.publish({
      ...publicationInput("Reference provider with a bounded ERC-8183 offer."),
      pricingManifest: {
        model: "fixed",
        network: 97,
        tokenAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        tokenSymbol: "U",
        decimals: 18,
        amountAtomic: "1000000000000000",
        minAtomic: "1000000000000000",
        maxAtomic: "1000000000000000"
      },
      activationOffer: {
        advertised: true,
        method: "erc8183",
        label: "ERC-8183 health-factor hire (chain-97 canary)",
        erc8183: {
          chainId: 97,
          commerceContract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          routerContract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          policyContract: "0xcccccccccccccccccccccccccccccccccccccccc",
          paymentToken: "0xdddddddddddddddddddddddddddddddddddddddd",
          paymentTokenSymbol: "U",
          paymentDecimals: 18,
          providerAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          priceAtomic: "1000000000000000",
          releaseEnabled: false
        }
      }
    });

    expect(generic.status).toBe("published");
    expect(database.versions[0]?.public_metadata).not.toHaveProperty("activationOffer");
    expect(reference.status).toBe("published");
    expect(database.identity.authority_status).toBe("none");
    expect(database.versions[1]?.public_metadata).toMatchObject({
      activationOffer: {
        advertised: true,
        method: "erc8183",
        erc8183: {
          chainId: 97,
          commerceContract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          routerContract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          policyContract: "0xcccccccccccccccccccccccccccccccccccccccc",
          paymentToken: "0xdddddddddddddddddddddddddddddddddddddddd",
          providerAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          priceAtomic: "1000000000000000",
          releaseEnabled: false
        }
      }
    });
  });

  it("withholds malformed or credential-bearing service observations", async () => {
    const database = new PublicationDb();
    database.serviceRows[0]!.url = "https://agent.example/mcp?api_key=must-not-persist";
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish(publicationInput());

    expect(result.status).toBe("withheld");
    expect(result.diagnostics[0]?.code).toBe("SERVICE_INVALID");
    expect(database.versions).toHaveLength(0);
  });

  it("rolls back an incomplete publication and exposes only a fixed error", async () => {
    const database = new PublicationDb({ failOnCommit: true });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    await expect(service.publish(publicationInput())).rejects.toMatchObject({
      name: "MarketplacePublicationError",
      message: "Marketplace publication could not be completed."
    });

    expect(database.versions).toHaveLength(0);
    expect(database.services).toHaveLength(0);
    expect(database.identity.current_version_id).toBeNull();
    expect(database.queries.at(-1)).toBe("ROLLBACK");
  });

  it("exposes a real full-tuple version resolver for category attachment", async () => {
    const database = new PublicationDb();
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });
    const published = await service.publish(publicationInput());
    const resolve = service.versionIdForIdentityKey;

    expect(await service.versionIdForIdentity(identity)).toBe(published.versionId);
    expect(await resolve("erc8004:97:0x1111111111111111111111111111111111111111:42")).toBe(published.versionId);
    expect(await service.versionIdForIdentityKey("erc8004:56:0x1111111111111111111111111111111111111111:42")).toBeNull();
  });

  it("does not automatically unpause or republish manually suspended listings", async () => {
    const database = new PublicationDb({ state: { listing_status: "paused" } });
    const service = new PostgresMarketplacePublicationService(database, { now: () => now });

    const result = await service.publish(publicationInput());

    expect(result.status).toBe("withheld");
    expect(result.diagnostics[0]?.code).toBe("LISTING_MANUAL_REVIEW");
    expect(database.identity.listing_status).toBe("paused");
    expect(database.identity.current_version_id).toBeNull();
  });
});
