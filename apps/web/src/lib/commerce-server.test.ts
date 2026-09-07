import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PostgresErc8183OperationRepository } from "@bnbera/agent-commerce";
import {
  commerceAuthorityBoundaryError,
  createProductionCommerceComposition,
  getCommerceComposition,
  T4_AUTHORITY_BOUNDARY_BLOCKER,
  type AuthenticatedCommerceIdentity,
  type CommerceAuthorityResolver,
  type CommerceIdentityResolver,
  type CommerceParentHireRecord,
  Erc8183CommerceComposition
} from "./commerce-server";
import { GET as statusRoute } from "../../app/api/commerce/[jobId]/route";

const BUYER = "0x3333333333333333333333333333333333333333";
const OTHER = "0x5555555555555555555555555555555555555555";
const COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565";
const PARENT_ID = "00000000-0000-4000-8000-000000000007";
const VERSION_ID = "00000000-0000-4000-8000-000000000042";
const IDENTITY = { namespace: "eip155", chainId: 97, identityRegistry: "0x1111111111111111111111111111111111111111", agentId: "42" };
const BINDING = { identity: IDENTITY, agentVersionId: VERSION_ID, agentVersion: 1 };
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
const PERSISTENT_POOL = {
  query: async () => ({ rows: [] }),
  connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined })
};
const STANDARDS_LOCK = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../config/standards.lock.json", import.meta.url)), "utf8")) as Record<string, unknown>;

const identity: AuthenticatedCommerceIdentity = {
  authenticated: true,
  userId: "buyer-user",
  requesterAddress: BUYER
};

const identityResolver: CommerceIdentityResolver = {
  resolve: async () => identity
};

const authorityResolver: CommerceAuthorityResolver = {
  resolve: async () => ({ wallet: { address: BUYER } } as never)
};

function parent(overrides: Partial<CommerceParentHireRecord> = {}): CommerceParentHireRecord {
  return {
    commerceJobId: PARENT_ID,
    buyerUserId: identity.userId,
    status: "negotiating",
    priceAtomic: "1000",
    task: "health factor",
    taskInputDigest: PostgresErc8183OperationRepository.requestDigest("health factor"),
    fundingTransactionHash: null,
    fulfillmentTransactionHash: null,
    disputeTransactionHash: null,
    settlementTransactionHash: null,
    providerAddress: OTHER,
    providerBinding: BINDING,
    listing: {
      providerAddress: OTHER,
      providerBinding: BINDING,
      terms: { chainId: 97, commerceContract: COMMERCE, paymentToken: TOKEN, paymentDecimals: 18, priceAtomic: "1000" },
      listingStatus: "published",
      verificationStatus: "verified",
      runtimeStatus: "live",
      authorityStatus: "active",
      version: { id: VERSION_ID, number: 1 }
    },
    ...overrides
  };
}

function testComposition(overrides: Record<string, unknown> = {}): Erc8183CommerceComposition {
  const composition = Object.create(Erc8183CommerceComposition.prototype) as Erc8183CommerceComposition & Record<string, unknown>;
  Object.assign(composition, {
    adapter: { pin: PIN },
    identityResolver,
    authorityResolver,
    parentHireResolver: { resolve: async () => parent() },
    service: { hire: vi.fn(async (input: unknown) => ({ operation: { operationId: "00000000-0000-4000-8000-000000000001", jobId: null }, result: null, replayed: false, input })) },
    reads: { get: vi.fn() },
    operations: { get: vi.fn() },
    ...overrides
  });
  return composition;
}

describe("T5 commerce server composition", () => {
  it("exposes the local-canary blocker without requiring Altana buyer authority", async () => {
    await expect(getCommerceComposition()).rejects.toMatchObject({
      code: "COMMERCE_DISABLED",
      message: expect.stringContaining("local development canary"),
      nextAction: "enable_local_development_canary"
    });
    expect(commerceAuthorityBoundaryError().message).toContain(T4_AUTHORITY_BOUNDARY_BLOCKER);
  });

  it("returns the local-canary blocker through the status API without leaking server internals", async () => {
    const response = await statusRoute(new Request("http://localhost/api/commerce/7"), { params: Promise.resolve({ jobId: "7" }) });
    const body = await response.json() as { readonly status: string; readonly error: { readonly code: string; readonly message: string } };
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "error", error: { code: "COMMERCE_DISABLED" } });
    expect(body.error.message).toContain("local development canary");
    expect(body.error.message).not.toMatch(/private.?key|password|secret|DATABASE_URL/iu);
  });

  it("returns a stable 503 when the local T5 composition has no database", async () => {
    vi.stubEnv("T5_ALTANA_AUTH_ENABLED", "true");
    vi.stubEnv("DATABASE_URL", "");
    try {
      const response = await statusRoute(new Request("http://localhost/api/commerce/7"), { params: Promise.resolve({ jobId: "7" }) });
      const body = await response.json() as { readonly status: string; readonly error: { readonly code: string; readonly message: string } };
      expect(response.status).toBe(503);
      expect(body).toMatchObject({ status: "error", error: { code: "COMMERCE_DISABLED" } });
      expect(body.error.message).not.toMatch(/private.?key|password|secret|DATABASE_URL/iu);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("requires an authoritative standards-lock snapshot before constructing a writer", () => {
    expect(() => createProductionCommerceComposition({
      standardsLock: null,
      pin: {} as never,
      pool: {} as never,
      identityResolver,
      parentHireResolver: { resolve: async () => null }
    })).toThrowError(/authoritative standards\.lock snapshot/i);
  });

  it("requires a read identity before constructing a composition", () => {
    expect(() => createProductionCommerceComposition({
      standardsLock: STANDARDS_LOCK,
      pin: {} as never,
      pool: PERSISTENT_POOL as never,
      identityResolver: undefined as never,
      parentHireResolver: { resolve: async () => null }
    })).toThrowError(/read identity resolver/i);
  });

  it("composes the persistent quote reservation as the default parent resolver", () => {
    expect(() => createProductionCommerceComposition({
      standardsLock: STANDARDS_LOCK,
      pin: PIN,
      pool: PERSISTENT_POOL as never,
      identityResolver
    })).not.toThrow();
  });

  it("fails closed before an SDK hire when the persistent parent seam is absent", async () => {
    const composition = testComposition({ parentHireResolver: undefined });
    await expect(composition.hire(new Request("http://localhost"), {
      idempotencyKey: "hire-missing-parent",
      commerceJobId: PARENT_ID,
      task: "health factor",
      budgetAtomic: "1000"
    })).rejects.toMatchObject({ code: "COMMERCE_DISABLED" });
  });

  it("does not require an Altana signer for an authorized status reload", async () => {
    const job = { job: { terms: { clientAddress: BUYER, providerAddress: null } } };
    const composition = testComposition({
      authorityResolver: undefined,
      reads: { get: vi.fn(async () => job) }
    });
    await expect(composition.status(new Request("http://localhost"), "7")).resolves.toBe(job);
  });

  it("resolves provider and binding from the parent seam before the SDK hire", async () => {
    const order: string[] = [];
    const hire = vi.fn(async (input: unknown) => ({ operation: { operationId: "00000000-0000-4000-8000-000000000001", jobId: null }, result: null, replayed: false, input }));
    const resolve = vi.fn(async () => { order.push("resolve"); return parent(); });
    hire.mockImplementation(async (input: unknown) => { order.push("hire"); return { operation: { operationId: "00000000-0000-4000-8000-000000000001", jobId: null }, result: null, replayed: false, input }; });
    const composition = testComposition({ parentHireResolver: { resolve }, service: { hire } });
    await composition.hire(new Request("http://localhost"), {
      idempotencyKey: "hire-parent-boundary",
      commerceJobId: PARENT_ID,
      task: "health factor",
      budgetAtomic: "1000"
    });
    expect(order).toEqual(["resolve", "hire"]);
    expect(hire).toHaveBeenCalledWith(expect.objectContaining({ providerAddress: OTHER, providerBinding: BINDING }));
  });

  it("claims the parent before reserving one server-derived hire key", async () => {
    const claim = vi.fn(async () => undefined);
    const prepareHireIntent = vi.fn(() => ({}) as never);
    const reserveExternal = vi.fn(async () => ({
      operation: {
        operationId: "00000000-0000-4000-8000-000000000001",
        jobId: null,
        status: "awaiting_signature",
        context: { signerAddress: BUYER, sdkAction: "hire", dispatchClaimed: true }
      },
      replayed: false,
      dispatchable: false
    }));
    const composition = testComposition({
      reservationResolver: { claim },
      service: { prepareHireIntent, reserveExternal }
    });
    await composition.prepareHireIntent(new Request("http://localhost"), {
      idempotencyKey: "browser-random-key-a",
      commerceJobId: PARENT_ID
    });
    await composition.prepareHireIntent(new Request("http://localhost"), {
      idempotencyKey: "browser-random-key-b",
      commerceJobId: PARENT_ID
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(prepareHireIntent).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `t5-hire:${PARENT_ID}` }));
    expect(reserveExternal).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: `t5-hire:${PARENT_ID}` }));
    expect(reserveExternal).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: `t5-hire:${PARENT_ID}` }));
  });

  it("denies a parent/listing binding mismatch without reaching the SDK", async () => {
    const hire = vi.fn();
    const mismatched = parent({ providerAddress: BUYER });
    const composition = testComposition({ parentHireResolver: { resolve: async () => mismatched }, service: { hire } });
    await expect(composition.hire(new Request("http://localhost"), {
      idempotencyKey: "hire-binding-mismatch",
      commerceJobId: PARENT_ID,
      task: "health factor",
      budgetAtomic: "1000"
    })).rejects.toMatchObject({ code: "ONCHAIN_MISMATCH" });
    expect(hire).not.toHaveBeenCalled();
  });

  it("authorizes reconciliation from the immutable operation signer without a projection read", async () => {
    const existing = { jobId: "7", context: { signerAddress: BUYER } };
    const reconcile = vi.fn(async () => ({ operation: existing, result: null, replayed: false }));
    const projectionRead = vi.fn(() => { throw new Error("projection should not be read before repair"); });
    const composition = testComposition({
      operations: { get: vi.fn(async () => existing) },
      reads: { get: projectionRead },
      service: { reconcile }
    });
    await composition.reconcile(new Request("http://localhost"), "00000000-0000-4000-8000-000000000002");
    expect(reconcile).toHaveBeenCalledOnce();
    expect(projectionRead).not.toHaveBeenCalled();
  });

  it("denies reconciliation when the persisted signer belongs to another actor", async () => {
    const reconcile = vi.fn();
    const composition = testComposition({
      operations: { get: vi.fn(async () => ({ jobId: "7", context: { signerAddress: OTHER } })) },
      service: { reconcile }
    });
    await expect(composition.reconcile(new Request("http://localhost"), "00000000-0000-4000-8000-000000000002")).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    expect(reconcile).not.toHaveBeenCalled();
  });
});
