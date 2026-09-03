import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentCategories,
  agentStateAxesSchema,
  authorityStatuses,
  claimStatuses,
  erc8004IdentityKey,
  erc8004IdentitySchema,
  listingStatuses,
  marketplaceEligibilityResultSchema,
  originTypes,
  runtimeStatuses,
  verificationStatuses,
  type Erc8004Identity
} from "../../packages/domain/src/index.js";
import {
  AgentIngestionService,
  InMemoryIngestionRepository,
  normalizeClaimVerificationContext,
  normalizeClaimVerificationProof,
  normalizeManualImport,
  type ClaimVerificationProof,
  type DirectIdentityState,
  type RegistryChainReader
} from "../../packages/agent-ingestion/src/index.js";
import { errorEnvelopeSchema, AppError } from "../../packages/config/src/index.js";

const identity: Erc8004Identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "340282366920938463463374607431768211456"
};

const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const executionWallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const blockHash = "0x" + "11".repeat(32);

function directState(observedBlock = 100): DirectIdentityState {
  return {
    ownerAddress: owner,
    agentWallet: executionWallet,
    agentUri: "https://agent.example/profile.json",
    contentDigest: null,
    observedBlock,
    observedBlockHash: blockHash,
    readConsistency: "finalized",
    ownerObservedBlock: observedBlock,
    agentWalletObservedBlock: observedBlock,
    agentUriObservedBlock: observedBlock,
    contentDigestObservedBlock: observedBlock
  };
}

describe("W0/W1 stable marketplace contracts", () => {
  it("requires the complete ERC-8004 identity tuple and preserves decimal IDs", () => {
    const parsed = erc8004IdentitySchema.parse(identity);
    const key = erc8004IdentityKey(parsed);

    expect(key).toBe(
      "eip155:97:0x1111111111111111111111111111111111111111:340282366920938463463374607431768211456"
    );
    expect(erc8004IdentityKey({ ...identity, chainId: 56 })).not.toBe(key);
    expect(erc8004IdentityKey({ ...identity, identityRegistry: "0x2222222222222222222222222222222222222222" })).not.toBe(key);
    expect(erc8004IdentityKey({ ...identity, agentId: "1" })).not.toBe(key);
  });

  it("keeps all six marketplace state axes independently representable", () => {
    const axes = agentStateAxesSchema.parse({
      originType: "discovered",
      claimStatus: "stale",
      verificationStatus: "degraded",
      runtimeStatus: "unavailable",
      authorityStatus: "expired",
      listingStatus: "paused"
    });

    expect(Object.keys(axes)).toEqual([
      "originType",
      "claimStatus",
      "verificationStatus",
      "runtimeStatus",
      "authorityStatus",
      "listingStatus"
    ]);
    expect(axes).not.toHaveProperty("status");
    expect(agentCategories).toEqual([
      "rebalancing",
      "grid-trading",
      "yield-optimisation",
      "health-factor",
      "uncategorized"
    ]);
    expect(originTypes).toContain(axes.originType);
    expect(claimStatuses).toContain(axes.claimStatus);
    expect(verificationStatuses).toContain(axes.verificationStatus);
    expect(runtimeStatuses).toContain(axes.runtimeStatus);
    expect(authorityStatuses).toContain(axes.authorityStatus);
    expect(listingStatuses).toContain(axes.listingStatus);
  });

  it("accepts an ineligible result only with a stable reason-code contract", () => {
    const result = marketplaceEligibilityResultSchema.parse({
      eligible: false,
      score: null,
      components: null,
      reasons: [
        { code: "ENDPOINT_UNHEALTHY", message: "The advertised endpoint is not healthy." },
        { code: "AUTHORITY_EXPIRED", message: "The execution authority has expired." }
      ]
    });

    expect(result.eligible).toBe(false);
    expect(result.score).toBeNull();
    expect(result.components).toBeNull();
  });

  it("keeps error envelopes safe and excludes the in-memory cause", () => {
    const appError = new AppError({
      code: "MARKETPLACE_UNAVAILABLE",
      safeMessage: "The marketplace read model is temporarily unavailable.",
      requestId: "qa-contract-1",
      retriable: true,
      nextAction: "retry",
      cause: new Error("database password must never cross the boundary")
    });
    const envelope = appError.toEnvelope();

    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(JSON.stringify(envelope)).not.toMatch(/password|database/i);
    expect(envelope).not.toHaveProperty("cause");
  });

  it("propagates manual/import data into the ingestion read boundary without implying trust", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    const candidate = normalizeManualImport({
      identity,
      importReference: "qa-manual-import-1",
      importedAt: new Date("2026-09-03T00:00:00.000Z"),
      metadata: { name: "Explicitly labelled QA candidate" },
      services: [
        { kind: "mcp", url: "https://agent.example/mcp", protocolVersion: "1" }
      ],
      capabilityManifest: {
        schemaVersion: "1",
        capabilities: [
          {
            id: "quote",
            description: "Returns a quote",
            inputSchema: { type: "object" },
            outputSchema: { type: "object" }
          }
        ]
      }
    });

    const result = await ingestion.ingestCandidate(candidate);

    expect(result.identityKey).toBe(erc8004IdentityKey(identity));
    expect(result.capabilityDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.services).toHaveLength(1);
    expect(result.identity.state).toEqual({
      originType: "manual_import",
      claimStatus: "unclaimed",
      verificationStatus: "pending",
      runtimeStatus: "unavailable",
      authorityStatus: "none",
      listingStatus: "draft"
    });
  });

  it("does not turn invalid public metadata into a successful candidate", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);

    await expect(
      ingestion.ingestCandidate({
        identity,
        source: "manual",
        sourceReference: "qa-sensitive-metadata",
        observedAt: new Date("2026-09-03T00:00:00.000Z"),
        normalizedIngestionVersion: "manual-v1",
        metadata: { name: "unsafe", accessToken: "should-not-enter-read-model" }
      })
    ).rejects.toMatchObject({ code: "INGESTION_INPUT_INVALID" });
    expect(await repository.listIdentities()).toHaveLength(0);
  });

  it("requires block-hash provenance before canonical identity state can be read", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "qa-missing-block-hash",
      observedAt: new Date("2026-09-03T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });

    const reader: RegistryChainReader = {
      async readIdentity() {
        return { ...directState(), observedBlockHash: undefined } as unknown as DirectIdentityState;
      }
    };

    await expect(ingestion.reconcileIdentity(reader, identity)).rejects.toMatchObject({
      code: "REORG_RECONCILIATION_REQUIRED"
    });
    expect((await repository.findIdentity(identity))?.observedBlock).toBeNull();
  });

  it("normalizes the server-issued claim context without inventing a route", () => {
    const context = normalizeClaimVerificationContext({
      chainId: 97,
      domain: "BNBEra.example",
      uri: "https://bnbera.example/claim",
      resources: ["https://bnbera.example/claim-resource"],
      action: "claim"
    });

    expect(context).toEqual({
      chainId: 97,
      domain: "bnbera.example",
      uri: "https://bnbera.example/claim",
      resources: ["https://bnbera.example/claim-resource"],
      action: "claim"
    });
  });

  it("does not treat an unsigned or incomplete claim proof as identity authority", () => {
    const incompleteProof = {
      identity,
      address: owner,
      chainId: 97,
      domain: "bnbera.example",
      uri: "https://bnbera.example/claim",
      resources: [],
      action: "claim",
      issuedAt: new Date("2026-09-03T00:00:00.000Z"),
      expirationTime: new Date("2026-09-03T00:10:00.000Z"),
      nonce: "short",
      signatureDigest: "not-a-digest"
    } satisfies ClaimVerificationProof;

    expect(() => normalizeClaimVerificationProof(incompleteProof)).toThrow(/claim signature digest|claim proof fields are invalid/i);
  });
});

describe("W0/W1 seam inventory", () => {
  it("keeps the QA fixture provenance explicit", async () => {
    const testPath = fileURLToPath(new URL("../integration/w0-w1-marketplace-contracts.test.ts", import.meta.url));
    const source = await readFile(testPath, "utf8");
    expect(source).toContain("Explicitly labelled QA candidate");
    expect(source).toContain("manual_import");
  });
});
