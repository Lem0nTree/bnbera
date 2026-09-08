import { decodeErc8004AgentUri } from "@altananetwork/sdk";
import { describe, expect, it } from "vitest";
import { canonicalRuntimeConfigurationDigest, type CreatorRuntimeConfiguration } from "./creator-contract";
import {
  CREATOR_ERC8004_REGISTRY,
  creatorRegistrationFile,
  creatorRegistrationUriDigest,
  createCreatorRegistrationService,
  encodedCreatorRegistrationUri,
  finalizedCreatorRegistrationFile,
  type CreatorRegistrationChainLog,
} from "./creator-registration";

const configuration: CreatorRuntimeConfiguration = {
  protocol: "pancakeswap-v2",
  tradingPair: "tbnb-busd",
  inputAmountWei: "500000000000000",
  slippageBps: 25,
  quoteMaxAgeSeconds: 30,
  deadlineSeconds: 60,
};

const ownerAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const executionWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const mintTransactionHash = `0x${"11".repeat(32)}`;

type StoredEvent = {
  readonly status_message: string;
  readonly external_resource_references: unknown;
  readonly transaction_hash: string | null;
  readonly retryable: boolean;
  readonly created_at: Date;
};

function deploymentRow() {
  return {
    deployment_id: "00000000-0000-4000-8000-000000000001",
    draft_id: "00000000-0000-4000-8000-000000000002",
    creator_user_id: "00000000-0000-4000-8000-000000000003",
    state: "deploying_runtime",
    current_step: "erc8004_register_reconcile",
    attempt: 1,
    public_url: "https://1.1.1.1/agent",
    name: "BUSD bounded agent",
    description: "A bounded browser-owned Creator agent.",
    configuration,
    configuration_digest: canonicalRuntimeConfigurationDigest(configuration),
    admin_wallet: ownerAddress,
    execution_wallet: executionWallet,
  } as const;
}

class RegistrationTestPool {
  readonly events: StoredEvent[] = [];
  readonly queries: string[] = [];
  readonly deployment = deploymentRow();
  agentExecutionWallet: string | null = executionWallet;
  identityRow: Record<string, unknown> | undefined;
  private transactionTail: Promise<void> = Promise.resolve();

  async query<T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> {
    this.queries.push(sql);
    if (sql.includes("SELECT i.identity_registry")) {
      if (this.agentExecutionWallet === null && sql.includes("lower(a.execution_wallet)=lower(au.execution_wallet)")) return { rows: [] as readonly T[] };
      return { rows: this.identityRow === undefined ? [] : [this.identityRow] as unknown as readonly T[] };
    }
    if (sql.includes("SELECT status_message") && sql.includes("FROM deployment_events WHERE deployment_id=$1")) {
      return { rows: this.events as unknown as readonly T[] };
    }
    if (sql.includes("FROM agent_deployments d")) {
      return { rows: [this.deployment] as unknown as readonly T[] };
    }
    if (sql.includes("INSERT INTO deployment_events")) {
      const statusMessage = String(values[4]);
      this.events.push({
        status_message: statusMessage,
        external_resource_references: JSON.parse(String(values[5])),
        transaction_hash: values[6] as string | null,
        retryable: Boolean(values[7]),
        created_at: new Date(Date.now() + this.events.length),
      });
    }
    return { rows: [] as readonly T[] };
  }

  async connect(): Promise<{ readonly query: RegistrationTestPool["query"]; readonly release: () => void }> {
    let releaseTransaction: (() => void) | null = null;
    const query = async <T = Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> => {
      if (sql === "BEGIN") {
        const prior = this.transactionTail;
        let resolveCurrent: (() => void) | null = null;
        this.transactionTail = new Promise<void>((resolve) => { resolveCurrent = resolve; });
        await prior;
        releaseTransaction = resolveCurrent;
      }
      const result = await this.query<T>(sql, values);
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        releaseTransaction?.();
        releaseTransaction = null;
      }
      return result;
    };
    return { query, release: () => { releaseTransaction?.(); releaseTransaction = null; } };
  }
}

function chainReader(overrides: Partial<{
  readonly agentUri: string;
  readonly finalizedBlock: bigint;
  readonly logs: readonly CreatorRegistrationChainLog[];
}> = {}) {
  return {
    async finalizedBlock() { return overrides.finalizedBlock ?? 100n; },
    async receipt() { return null; },
    async findRegistered(input: { readonly fromBlock: bigint; readonly toBlock: bigint }) {
      return (overrides.logs ?? []).filter((log) => log.blockNumber >= input.fromBlock && log.blockNumber <= input.toBlock);
    },
    async readAgent() { return { owner: ownerAddress, agentUri: overrides.agentUri ?? "" }; },
  };
}

function registrationPool(pool: RegistrationTestPool): Parameters<typeof createCreatorRegistrationService>[0]["pool"] {
  return pool as unknown as Parameters<typeof createCreatorRegistrationService>[0]["pool"];
}

async function prepareFinalizedUri(
  service: ReturnType<typeof createCreatorRegistrationService>,
  pool: RegistrationTestPool,
  chain: { agentUri: string }
) {
  const userId = "00000000-0000-4000-8000-000000000003";
  const mint = await service.prepare(userId, pool.deployment.deployment_id, "mint", ownerAddress);
  await service.recordResult(userId, pool.deployment.deployment_id, {
    phase: "mint",
    callsId: "0x1234",
    transactionHash: null,
    status: "CONFIRMED",
    agentId: "42",
    uriDigest: mint.uriDigest,
  }, ownerAddress);
  const uri = await service.prepare(userId, pool.deployment.deployment_id, "uri", ownerAddress);
  await service.recordResult(userId, pool.deployment.deployment_id, {
    phase: "uri",
    callsId: null,
    transactionHash: null,
    status: "UNKNOWN",
    agentId: "42",
    uriDigest: uri.uriDigest,
  }, ownerAddress);
  chain.agentUri = uri.registrationUri;
  return { userId, uri };
}

describe("Creator ERC-8004 browser registration file", () => {
  it("keeps the server-selected trading pair and digest through the URI update", () => {
    const configurationDigest = canonicalRuntimeConfigurationDigest(configuration);
    const initial = creatorRegistrationFile({
      name: "BUSD bounded agent",
      description: "A bounded browser-owned Creator agent for this testnet pair.",
      endpoint: "https://creator.example/.well-known/agent-card.json",
      configuration,
      configurationDigest,
    });
    const final = finalizedCreatorRegistrationFile(initial, "42");
    const decoded = decodeErc8004AgentUri(encodedCreatorRegistrationUri(final));
    expect(decoded.registrations).toHaveLength(1);
    expect(decoded.registrations[0]?.agentId).toBe(42);
    expect(decoded.registrations[0]?.agentRegistry.toLowerCase()).toBe(`eip155:97:${CREATOR_ERC8004_REGISTRY}`);
    expect((decoded as typeof final)["x-bnbera"].tradingPair).toBe("tbnb-busd");
    expect((decoded as typeof final)["x-bnbera"].configurationDigest).toBe(configurationDigest);
    expect(initial.description).not.toMatch(/[\u0000-\u001f\u007f]/u);
    expect(initial.description).toContain("BNBEra bounded runtime: tbnb-busd");
    expect(initial.description).toContain(`configuration digest: ${configurationDigest}.`);
    expect(decoded.services[0]?.endpoint).toBe("https://creator.example/.well-known/agent-card.json");
    expect(initial.services[0]).toMatchObject({
      name: "A2A",
      endpoint: "https://creator.example/.well-known/agent-card.json",
      protocolVersion: "0.3.0",
    });
    expect(initial.services[0]?.version).toBeUndefined();
    expect(decoded.services[0] as unknown as Record<string, unknown>).toMatchObject({
      name: "A2A",
      protocolVersion: "0.3.0",
    });
    expect((decoded.services[0] as unknown as Record<string, unknown>).version).toBeUndefined();
  });

  it("hashes exact data URI bytes", () => {
    const uri = "data:application/json;base64,eyJ0ZXN0Ijp0cnVlfQ==";
    expect(creatorRegistrationUriDigest(uri)).toHaveLength(64);
    expect(creatorRegistrationUriDigest(uri)).toBe(creatorRegistrationUriDigest(uri));
    expect(creatorRegistrationUriDigest(uri)).not.toBe(creatorRegistrationUriDigest(`${uri}#changed`));
  });
});

describe("Creator ERC-8004 durable browser reservations", () => {
  it("serializes concurrent prepare calls so only one tab receives a mint reservation", async () => {
    const pool = new RegistrationTestPool();
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader() });
    const [first, second] = await Promise.all([
      service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress),
      service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress),
    ]);

    expect([first.canMint, second.canMint].sort()).toEqual([false, true]);
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_MINT_INTENT")).toHaveLength(1);
  });

  it("reserves the mint phase once, so reloads cannot mint a second identity", async () => {
    const pool = new RegistrationTestPool();
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader() });
    const first = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress);
    const second = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress);

    expect(first.canMint).toBe(true);
    expect(second.canMint).toBe(false);
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_MINT_INTENT")).toHaveLength(1);
    expect(pool.queries.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("keeps a mint reservation after a lost/unknown broadcast and blocks a new result reservation", async () => {
    const pool = new RegistrationTestPool();
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader() });
    const prepared = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress);
    await service.recordResult("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, {
      phase: "mint",
      callsId: null,
      transactionHash: null,
      status: "UNKNOWN",
      agentId: null,
      uriDigest: prepared.uriDigest,
    }, ownerAddress);
    const reloaded = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress);

    expect(reloaded.canMint).toBe(false);
    expect(reloaded.state).toBe("mint_pending");
    expect(reloaded.mintOutcomeRecorded).toBe(true);
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_MINT_RESULT")).toHaveLength(1);
  });

  it("resumes a bounded mint log scan from its durable cursor after a delayed registration", async () => {
    const pool = new RegistrationTestPool();
    const chain: {
      agentUri: string;
      finalizedBlock: bigint;
      logs: readonly CreatorRegistrationChainLog[];
    } = { agentUri: "", finalizedBlock: 100n, logs: [] };
    const userId = "00000000-0000-4000-8000-000000000003";
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader(chain) });
    const prepared = await service.prepare(userId, pool.deployment.deployment_id, "mint", ownerAddress);
    chain.finalizedBlock = 3_100n;
    chain.logs = [{ agentId: "42", agentUri: prepared.registrationUri, owner: ownerAddress, transactionHash: mintTransactionHash, blockNumber: 3_000n }];
    const first = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(first.state).toBe("mint_pending");
    expect(first.mintScanStartBlock).toBe("100");
    expect(first.mintScanCursor).toBe("2100");

    chain.agentUri = prepared.registrationUri;
    const second = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(second.state).toBe("mint_confirmed");
    expect(second.agentId).toBe("42");
    expect(second.mintScanStartBlock).toBe("100");
    expect(pool.events.some((event) => event.status_message === "CREATOR_ERC8004_BROWSER_RECONCILE" && (event.external_resource_references as Record<string, unknown>).reason === "REGISTERED_EVENT_RECONCILED")).toBe(true);
  });

  it("reserves URI once after mint and blocks re-signing after a lost URI broadcast", async () => {
    const pool = new RegistrationTestPool();
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader() });
    const mint = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "mint", ownerAddress);
    await service.recordResult("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, {
      phase: "mint",
      callsId: "0x1234",
      transactionHash: mintTransactionHash,
      status: "CONFIRMED",
      agentId: "42",
      uriDigest: mint.uriDigest,
    }, ownerAddress);
    const firstUri = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "uri", ownerAddress);
    await service.recordResult("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, {
      phase: "uri",
      callsId: null,
      transactionHash: null,
      status: "UNKNOWN",
      agentId: "42",
      uriDigest: firstUri.uriDigest,
    }, ownerAddress);
    const reloadedUri = await service.prepare("00000000-0000-4000-8000-000000000003", pool.deployment.deployment_id, "uri", ownerAddress);

    expect(firstUri.canSetUri).toBe(true);
    expect(reloadedUri.canSetUri).toBe(false);
    expect(reloadedUri.state).toBe("uri_pending");
    expect(reloadedUri.uriOutcomeRecorded).toBe(true);
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_URI_INTENT")).toHaveLength(1);
  });

  it("confirms the exact final URI when the finalized registry content digest is unavailable", async () => {
    const pool = new RegistrationTestPool();
    const userId = "00000000-0000-4000-8000-000000000003";
    const chain = { agentUri: "" };
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader(chain) });
    const mint = await service.prepare(userId, pool.deployment.deployment_id, "mint", ownerAddress);
    await service.recordResult(userId, pool.deployment.deployment_id, {
      phase: "mint",
      callsId: "0x1234",
      transactionHash: null,
      status: "CONFIRMED",
      agentId: "42",
      uriDigest: mint.uriDigest,
    }, ownerAddress);
    const uri = await service.prepare(userId, pool.deployment.deployment_id, "uri", ownerAddress);
    await service.recordResult(userId, pool.deployment.deployment_id, {
      phase: "uri",
      callsId: null,
      transactionHash: null,
      status: "UNKNOWN",
      agentId: "42",
      uriDigest: uri.uriDigest,
    }, ownerAddress);
    chain.agentUri = uri.registrationUri;
    pool.identityRow = {
      identity_registry: CREATOR_ERC8004_REGISTRY,
      agent_id: "42",
      owner_address: ownerAddress,
      agent_wallet: executionWallet,
      agent_uri: uri.registrationUri,
      content_digest: null,
      agent_version_id: "00000000-0000-4000-8000-000000000042",
      version_public_metadata: { "x-bnbera": { configurationDigest: pool.deployment.configuration_digest, tradingPair: "tbnb-busd" } },
      service_url: "https://1.1.1.1/agent/.well-known/agent-card.json",
    };
    const result = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(result.state).toBe("registered");
    expect(result.uriTransactionHash).toBeNull();
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_OPERATION")).toHaveLength(1);
    expect(pool.events.some((event) => event.status_message === "CREATOR_ERC8004_BROWSER_RECONCILE" && (event.external_resource_references as Record<string, unknown>).reason === "URI_CONFIRMED_FROM_FINALIZED_REGISTRY")).toBe(true);
  });

  it("withholds the G1 handoff when a finalized registry content digest disagrees", async () => {
    const pool = new RegistrationTestPool();
    const chain = { agentUri: "" };
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader(chain) });
    const { userId, uri } = await prepareFinalizedUri(service, pool, chain);
    pool.identityRow = {
      identity_registry: CREATOR_ERC8004_REGISTRY,
      agent_id: "42",
      owner_address: ownerAddress,
      agent_wallet: executionWallet,
      agent_uri: uri.registrationUri,
      content_digest: "0".repeat(64),
      agent_version_id: "00000000-0000-4000-8000-000000000042",
      version_public_metadata: { "x-bnbera": { configurationDigest: pool.deployment.configuration_digest, tradingPair: "tbnb-busd" } },
      service_url: "https://1.1.1.1/agent/.well-known/agent-card.json",
    };

    const result = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(result.state).toBe("uri_pending");
    expect(result.pendingReason).toBe("G1_FINALIZED_IDENTITY_VERSION_OR_SERVICE_PENDING");
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_OPERATION")).toHaveLength(0);
  });

  it("matches the authority to the finalized identity wallet when the agent execution wallet is null", async () => {
    const pool = new RegistrationTestPool();
    pool.agentExecutionWallet = null;
    const chain = { agentUri: "" };
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader(chain) });
    const { userId, uri } = await prepareFinalizedUri(service, pool, chain);
    pool.identityRow = {
      identity_registry: CREATOR_ERC8004_REGISTRY,
      agent_id: "42",
      owner_address: ownerAddress,
      agent_wallet: executionWallet,
      agent_uri: uri.registrationUri,
      content_digest: uri.uriDigest,
      agent_version_id: "00000000-0000-4000-8000-000000000042",
      version_public_metadata: { "x-bnbera": { configurationDigest: pool.deployment.configuration_digest, tradingPair: "tbnb-busd" } },
      service_url: "https://1.1.1.1/agent/.well-known/agent-card.json",
    };

    const result = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(result.state).toBe("registered");
    expect(pool.queries.some((query) => query.includes("lower(i.agent_wallet)=lower(au.execution_wallet)"))).toBe(true);
  });

  it("withholds the G1 handoff when the selected current version lacks the exact configuration binding", async () => {
    const pool = new RegistrationTestPool();
    const userId = "00000000-0000-4000-8000-000000000003";
    const chain = { agentUri: "" };
    const service = createCreatorRegistrationService({ pool: registrationPool(pool), chainReader: chainReader(chain) });
    const mint = await service.prepare(userId, pool.deployment.deployment_id, "mint", ownerAddress);
    await service.recordResult(userId, pool.deployment.deployment_id, {
      phase: "mint",
      callsId: "0x1234",
      transactionHash: null,
      status: "CONFIRMED",
      agentId: "42",
      uriDigest: mint.uriDigest,
    }, ownerAddress);
    const uri = await service.prepare(userId, pool.deployment.deployment_id, "uri", ownerAddress);
    await service.recordResult(userId, pool.deployment.deployment_id, {
      phase: "uri",
      callsId: null,
      transactionHash: null,
      status: "UNKNOWN",
      agentId: "42",
      uriDigest: uri.uriDigest,
    }, ownerAddress);
    chain.agentUri = uri.registrationUri;
    pool.identityRow = {
      identity_registry: CREATOR_ERC8004_REGISTRY,
      agent_id: "42",
      owner_address: ownerAddress,
      agent_wallet: executionWallet,
      agent_uri: uri.registrationUri,
      content_digest: uri.uriDigest,
      agent_version_id: "00000000-0000-4000-8000-000000000042",
      version_public_metadata: { "x-bnbera": { configurationDigest: "0".repeat(64), tradingPair: "tbnb-busd" } },
      service_url: "https://1.1.1.1/agent/.well-known/agent-card.json",
    };
    const result = await service.reconcile(userId, pool.deployment.deployment_id, ownerAddress);

    expect(result.state).toBe("uri_pending");
    expect(result.pendingReason).toBe("G1_FINALIZED_IDENTITY_VERSION_OR_SERVICE_PENDING");
    expect(pool.events.filter((event) => event.status_message === "CREATOR_ERC8004_BROWSER_OPERATION")).toHaveLength(0);
  });
});
