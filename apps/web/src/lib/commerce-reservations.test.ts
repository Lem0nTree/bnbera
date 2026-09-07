import { describe, expect, it, vi } from "vitest";
import { canonicalSha256Hex, erc8004IdentityKey } from "@bnbera/domain";
import { CommerceError } from "@bnbera/agent-commerce";
import {
  commerceQuoteRequestSchema,
  createReferenceProviderReadinessResolver,
  parsePersistedPricing,
  PostgresCommerceReservationStore,
  type CommerceProviderReadinessInput,
  type CommerceProviderReadinessResolver,
  type CommerceQuoteSnapshot
} from "./commerce-reservations";

const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const OWNER = "0x3333333333333333333333333333333333333333";
const REGISTRY = "0x1111111111111111111111111111111111111111";
const AGENT_ID = "42";
const AGENT_UUID = "00000000-0000-4000-8000-000000000010";
const VERSION_UUID = "00000000-0000-4000-8000-000000000011";
const JOB_UUID = "00000000-0000-4000-8000-000000000012";
const BUYER = "buyer-user";

const PIN = {
  enabled: true as const,
  chainId: 97 as const,
  specRevision: "apex-v1",
  commerceContract: COMMERCE,
  paymentToken: TOKEN,
  paymentDecimals: 18,
  abiHash: "4d8ac8b406dff522f1b9066eb3e00e2c8e491d4d09df2564ede124220b623ede",
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 1,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "10000000000000000"
};

const listingRow = {
  agent_id: AGENT_UUID,
  identity_id: "00000000-0000-4000-8000-000000000013",
  namespace: "eip155",
  chain_id: 97,
  identity_registry: REGISTRY,
  agent_identity_id: AGENT_ID,
  owner_address: OWNER,
  owner_observed_block: 123,
  agent_wallet: PROVIDER,
  agent_wallet_observed_block: 123,
  identity_observed_block: 123,
  identity_observed_block_hash: `0x${"a".repeat(64)}`,
  identity_read_consistency: "finalized",
  listing_status: "published",
  verification_status: "verified",
  runtime_status: "live",
  authority_status: "active",
  execution_wallet: PROVIDER,
  agent_version_id: VERSION_UUID,
  agent_version: 1,
  pricing_manifest: {
    model: "fixed",
    network: 97,
    tokenAddress: TOKEN,
    tokenSymbol: "U",
    decimals: 18,
    minAtomic: "100",
    maxAtomic: "100",
    observedAt: "2026-09-07T00:00:00.000Z"
  },
  service_kind: "a2a" as const,
  service_url: "https://provider.example/a2a",
  service_protocol_version: "1.0",
  service_observed_at: "2026-09-07T00:00:00.000Z",
  probe_observed_at: new Date().toISOString()
};

function readinessInput(overrides: Partial<CommerceProviderReadinessInput> = {}): CommerceProviderReadinessInput {
  const now = Math.floor(Date.now() / 1_000);
  return {
    identity: { namespace: "eip155", chainId: 97, identityRegistry: REGISTRY, agentId: AGENT_ID },
    ownerAddress: OWNER,
    ownerObservedBlock: 123,
    agentWallet: PROVIDER,
    agentWalletObservedBlock: 123,
    identityObservedBlock: 123,
    identityObservedBlockHash: `0x${"a".repeat(64)}`,
    identityReadConsistency: "finalized",
    providerAddress: PROVIDER,
    service: {
      kind: "a2a",
      url: "https://provider.example/a2a",
      protocolVersion: "1.0",
      observedAt: new Date(now * 1_000).toISOString(),
      probeObservedAt: new Date(now * 1_000).toISOString()
    },
    chainId: 97,
    commerceContract: COMMERCE,
    paymentToken: TOKEN,
    paymentDecimals: 18,
    priceAtomic: "100",
    authorityStatus: "none",
    version: { id: VERSION_UUID, number: 1 },
    ...overrides
  };
}

function readinessResolver(overrides: Partial<Parameters<typeof createReferenceProviderReadinessResolver>[0]> = {}) {
  return createReferenceProviderReadinessResolver({
    enabled: true,
    identity: readinessInput().identity,
    expectedOwnerAddress: OWNER,
    providerAddress: PROVIDER,
    providerEndpoint: "https://provider.example/a2a",
    authoritySecretReference: "env://T5_REFERENCE_PROVIDER_PRIVATE_KEY",
    chainId: 97,
    commerceContract: COMMERCE,
    paymentToken: TOKEN,
    paymentDecimals: 18,
    maxBudgetAtomic: PIN.maxBudgetAtomic,
    resolveSignerAddress: vi.fn(async () => PROVIDER),
    nowUnix: () => Math.floor(Date.now() / 1_000),
    ...overrides
  });
}

function quoteSnapshot(): CommerceQuoteSnapshot {
  return {
    schemaVersion: "bnbera.erc8183-quote/v1",
    quoteId: JOB_UUID,
    agentIdentifier: "eip155:97:0x1111111111111111111111111111111111111111:42",
    identity: { namespace: "eip155", chainId: 97, identityRegistry: REGISTRY, agentId: AGENT_ID },
    agentVersionId: VERSION_UUID,
    agentVersion: 1,
    providerAddress: PROVIDER,
    providerAddressSource: "erc8004_agent_wallet",
    service: {
      kind: "a2a",
      url: listingRow.service_url,
      protocolVersion: "1.0",
      observedAt: "2026-09-07T00:00:00.000Z",
      probeObservedAt: listingRow.probe_observed_at
    },
    chainId: 97,
    commerceContract: COMMERCE,
    paymentToken: TOKEN,
    paymentDecimals: 18,
    tokenSymbol: "U",
    priceAtomic: "100",
    task: "health factor",
    taskDigest: canonicalSha256Hex("health factor"),
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    status: "draft"
  };
}

function reservationRow(quote: CommerceQuoteSnapshot, buyerUserId = BUYER) {
  return {
    id: quote.quoteId,
    erc8183_job_id: `draft:${quote.quoteId}`,
    buyer_user_id: buyerUserId,
    provider_agent_id: AGENT_UUID,
    quote,
    price: quote.priceAtomic,
    task_input_digest: quote.taskDigest,
    status: "draft" as const,
    funding_transaction_hash: null,
    fulfillment_transaction_hash: null,
    dispute_transaction_hash: null,
    settlement_transaction_hash: null
  };
}

describe("ERC-8183 quote reservations", () => {
  it("accepts only one persisted fixed price matching the standards pin", () => {
    expect(parsePersistedPricing(listingRow.pricing_manifest, PIN)).toMatchObject({
      priceAtomic: "100",
      tokenAddress: TOKEN,
      decimals: 18,
      network: 97
    });
  });

  it("rejects unavailable, variable, mismatched and out-of-bounds prices", () => {
    expect(() => parsePersistedPricing({ ...listingRow.pricing_manifest, model: "unavailable", minAtomic: null, maxAtomic: null }, PIN)).toThrow(/no fixed/i);
    expect(() => parsePersistedPricing({ ...listingRow.pricing_manifest, minAtomic: "100", maxAtomic: "101" }, PIN)).toThrow(/range/i);
    expect(() => parsePersistedPricing({ ...listingRow.pricing_manifest, tokenAddress: "0x3333333333333333333333333333333333333333" }, PIN)).toThrow(/token/i);
    expect(() => parsePersistedPricing({ ...listingRow.pricing_manifest, network: 56 }, PIN)).toThrow(/network/i);
    expect(() => parsePersistedPricing({ ...listingRow.pricing_manifest, minAtomic: "0", maxAtomic: "0" }, PIN)).toThrow(/bounds/i);
  });

  it("does not permit the browser to submit provider, price or identity fields", () => {
    expect(commerceQuoteRequestSchema.safeParse({
      agentIdentifier: "agent",
      task: "health factor",
      providerAddress: PROVIDER,
      priceAtomic: "100",
      identity: listingRow.agent_identity_id
    }).success).toBe(false);
    expect(commerceQuoteRequestSchema.parse({ agentIdentifier: "agent", task: "health factor" })).toEqual({ agentIdentifier: "agent", task: "health factor" });
  });

  it("quotes an external listing with no Creator authority when provider readiness is valid", async () => {
    const externalListing = { ...listingRow, authority_status: "none" };
    const resolver = readinessResolver();
    const client = {
      query: async (text: string) => text.includes("FROM commerce_jobs") ? { rows: [] } : { rows: [], rowCount: 1 },
      release: () => undefined
    };
    const store = new PostgresCommerceReservationStore({
      query: async (text: string) => text.includes("FROM agents a") ? { rows: [externalListing] } : { rows: [] },
      connect: async () => client
    } as never, PIN, resolver);

    await expect(store.quote({
      buyerUserId: BUYER,
      agentIdentifier: erc8004IdentityKey(readinessInput().identity),
      task: "health factor"
    })).resolves.toMatchObject({
      identity: readinessInput().identity,
      providerAddress: PROVIDER,
      priceAtomic: "100"
    });
  });

  it.each([
    ["wrong signer", readinessResolver({ resolveSignerAddress: vi.fn(async () => OWNER) }), readinessInput(), "UNAUTHORIZED_ACTOR"],
    ["wrong identity", readinessResolver(), readinessInput({ identity: { ...readinessInput().identity, agentId: "43" } }), "UNAUTHORIZED_ACTOR"],
    ["wrong endpoint", readinessResolver(), readinessInput({ service: { ...readinessInput().service, url: "https://other.example/a2a" } }), "ONCHAIN_MISMATCH"],
    ["disabled provider", readinessResolver({ enabled: false }), readinessInput(), "COMMERCE_DISABLED"],
    ["stale probe", readinessResolver(), readinessInput({ service: { ...readinessInput().service, probeObservedAt: new Date((Math.floor(Date.now() / 1_000) - 121) * 1_000).toISOString() } }), "STALE_JOB"],
    ["changed agent wallet", readinessResolver(), readinessInput({ agentWallet: "0x4444444444444444444444444444444444444444" }), "UNAUTHORIZED_ACTOR"],
    ["expired listing", readinessResolver(), readinessInput({ authorityStatus: "expired" }), "STALE_JOB"]
  ] as const)("denies provider readiness for %s", async (_label, resolver, input, code) => {
    await expect(resolver.resolve(input)).rejects.toMatchObject({ code });
  });

  it("revalidates provider readiness between quote and funding resolution", async () => {
    const externalListing = { ...listingRow, authority_status: "none" };
    let persisted: ReturnType<typeof reservationRow> | undefined;
    const validResolver = readinessResolver();
    const resolve = vi.fn(async (input: CommerceProviderReadinessInput) => validResolver.resolve(input));
    resolve.mockImplementationOnce(async (input) => validResolver.resolve(input));
    resolve.mockImplementationOnce(async () => {
      throw new CommerceError({ code: "STALE_JOB", message: "The provider readiness changed before funding.", nextAction: "reload_listing" });
    });
    const client = {
      query: async (text: string) => text.includes("FROM commerce_jobs") ? { rows: persisted === undefined ? [] : [persisted] } : { rows: [], rowCount: 1 },
      release: () => undefined
    };
    const store = new PostgresCommerceReservationStore({
      query: async (text: string) => {
        if (text.includes("FROM agents a")) return { rows: [externalListing] };
        if (text.includes("FROM commerce_jobs")) return { rows: persisted === undefined ? [] : [persisted] };
        return { rows: [] };
      },
      connect: async () => client
    } as never, PIN, { resolve } satisfies CommerceProviderReadinessResolver);
    const quote = await store.quote({
      buyerUserId: BUYER,
      agentIdentifier: erc8004IdentityKey(readinessInput().identity),
      task: "health factor"
    });
    persisted = reservationRow(quote);
    await expect(store.resolve({
      commerceJobId: quote.quoteId,
      buyerUserId: BUYER,
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18
    })).rejects.toMatchObject({ code: "STALE_JOB" });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("resolves a reservation only for its buyer and current published listing", async () => {
    const quote = quoteSnapshot();
    const row = reservationRow(quote);
    const pool = {
      query: async (text: string, params: readonly unknown[] = []) => {
        if (text.includes("FROM commerce_jobs")) return { rows: params[1] === BUYER ? [row] : [] };
        if (text.includes("FROM agents a")) return { rows: [listingRow] };
        throw new Error(`unexpected query: ${text}`);
      },
      connect: async () => { throw new Error("quote write not expected"); }
    };
    const store = new PostgresCommerceReservationStore(pool as never, PIN);
    await expect(store.resolve({
      commerceJobId: JOB_UUID,
      buyerUserId: BUYER,
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18
    })).resolves.toMatchObject({ commerceJobId: JOB_UUID, buyerUserId: BUYER, priceAtomic: "100", providerAddress: PROVIDER });
    await expect(store.resolve({
      commerceJobId: JOB_UUID,
      buyerUserId: "other-buyer",
      chainId: 97,
      commerceContract: COMMERCE,
      paymentToken: TOKEN,
      paymentDecimals: 18
    })).resolves.toBeNull();
  });

  it("atomically claims a draft quote and rejects funded reclaims", async () => {
    const quote = quoteSnapshot();
    const row = reservationRow(quote);
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        if (text.includes("FROM commerce_jobs")) return { rows: [row] };
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined
    };
    const store = new PostgresCommerceReservationStore({
      query: async () => ({ rows: [] }),
      connect: async () => client
    } as never, PIN);
    await expect(store.claim({ commerceJobId: JOB_UUID, buyerUserId: BUYER })).resolves.toBeUndefined();
    expect(statements.some((text) => text.includes("FOR UPDATE"))).toBe(true);
    expect(statements.some((text) => text.includes("status = 'negotiating'"))).toBe(true);

    const funded = { ...row, status: "funded" as const, funding_transaction_hash: `0x${"a".repeat(64)}` };
    const fundedStore = new PostgresCommerceReservationStore({
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async (text: string) => text.includes("FROM commerce_jobs") ? { rows: [funded] } : { rows: [], rowCount: 1 },
        release: () => undefined
      })
    } as never, PIN);
    await expect(fundedStore.claim({ commerceJobId: JOB_UUID, buyerUserId: BUYER })).rejects.toMatchObject({ code: "STALE_JOB" });
  });
});
