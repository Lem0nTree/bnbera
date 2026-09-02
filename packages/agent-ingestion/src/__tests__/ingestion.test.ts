import { describe, expect, it } from "vitest";
import {
  AgentIngestionService,
  IdentityClaimService,
  InMemoryIngestionRepository,
  createEightHundredFourScanAdapter,
  normalizeRegistryEvent,
  type ClaimVerificationProof,
  type ChainObservation,
  type DirectIdentityState,
  type RegistryChainReader,
  type RegistryEvent
} from "../index.js";
import { erc8004IdentityKey, type Erc8004Identity } from "@bnbera/domain";

const identity: Erc8004Identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "115792089237316195423570985008687907853269984665640564039457584007913129639935"
};

const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const walletA = "0xcccccccccccccccccccccccccccccccccccccccc";
const claimContext = {
  chainId: 97,
  domain: "bnbera.example",
  uri: "https://bnbera.example/claim",
  resources: ["https://bnbera.example/claim-resource"],
  action: "claim" as const
};

function claimProof(address: string, nonce: string, issuedAt = new Date("2026-09-02T00:00:00.000Z")): ClaimVerificationProof {
  return {
    identity,
    address,
    ...claimContext,
    issuedAt,
    expirationTime: new Date("2026-09-02T00:10:00.000Z"),
    nonce,
    signatureDigest: "a".repeat(64)
  };
}

function verifiedProof(proof: ClaimVerificationProof) {
  return { ...proof, verifiedAt: new Date("2026-09-02T00:01:00.000Z") };
}

const testOperator = { operatorId: "operator:test", scopes: ["identity.claim.revoke"] as const };

function registryEvent(input: Partial<RegistryEvent> & Pick<RegistryEvent, "transactionHash" | "logIndex" | "blockNumber" | "blockHash">): RegistryEvent {
  return {
    identity,
    eventType: "Transfer",
    transactionHash: input.transactionHash,
    logIndex: input.logIndex,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    ownerAddress: input.ownerAddress ?? ownerA,
    agentWallet: input.agentWallet ?? walletA,
    agentUri: input.agentUri ?? "https://agent.example/metadata.json",
    contentDigest: input.contentDigest ?? null,
    observedAt: new Date("2026-09-02T00:00:00.000Z"),
    payload: input.payload ?? { kind: "transfer" }
  };
}

function state(
  ownerAddress: string | null = ownerA,
  agentWallet: string | null = walletA,
  observedBlock = 10,
  observedBlockHash = "0x" + observedBlock.toString(16).padStart(2, "0").repeat(32)
): DirectIdentityState {
  return {
    ownerAddress,
    agentWallet,
    agentUri: "https://agent.example/metadata.json",
    contentDigest: null,
    observedBlock,
    observedBlockHash,
    readConsistency: "finalized",
    ownerObservedBlock: observedBlock,
    agentWalletObservedBlock: observedBlock,
    agentUriObservedBlock: observedBlock,
    contentDigestObservedBlock: observedBlock
  };
}

describe("A3 identity and discovery ingestion", () => {
  it("runs the single-candidate path inside the repository transaction", async () => {
    class FailingSourceRepository extends InMemoryIngestionRepository {
      override async recordSource(
        _input: Parameters<InMemoryIngestionRepository["recordSource"]>[0]
      ): Promise<never> {
        throw new Error("source write failed");
      }
    }
    const repository = new FailingSourceRepository();
    const ingestion = new AgentIngestionService(repository);

    await expect(
      ingestion.ingestCandidate({
        identity,
        source: "manual",
        sourceReference: "transactional-single-candidate",
        observedAt: new Date("2026-09-02T00:00:00.000Z"),
        normalizedIngestionVersion: "manual-v1"
      })
    ).rejects.toThrow("source write failed");
    expect(await repository.listIdentities()).toHaveLength(0);
  });

  it("rejects an unsupported discovery source at runtime", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);

    await expect(
      ingestion.ingestCandidate({
        identity,
        source: "unknown" as never,
        sourceReference: "unsupported-source",
        observedAt: new Date("2026-09-02T00:00:00.000Z"),
        normalizedIngestionVersion: "manual-v1"
      })
    ).rejects.toMatchObject({ code: "INGESTION_SOURCE_UNSUPPORTED" });
    expect(await repository.listIdentities()).toHaveLength(0);
  });

  it("rejects an identity read without explicit block-hash provenance", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "missing-read-provenance",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    const reader = {
      async readIdentity() {
        return { ownerAddress: ownerA, agentWallet: walletA, agentUri: null, contentDigest: null, observedBlock: 10 } as DirectIdentityState;
      }
    };

    await expect(ingestion.reconcileIdentity(reader, identity)).rejects.toMatchObject({
      code: "REORG_RECONCILIATION_REQUIRED"
    });
    expect((await repository.findIdentity(identity))?.observedBlock).toBeNull();
  });

  it("rejects missing or undefined declared event fields but accepts explicit null clears", () => {
    const fields = ["ownerAddress", "agentWallet", "agentUri", "contentDigest"] as const;
    const base = registryEvent({
      transactionHash: "0x" + "13".repeat(32),
      logIndex: 0,
      blockNumber: 13,
      blockHash: "0x" + "13".repeat(32)
    });

    for (const field of fields) {
      const missing = { ...base } as Partial<RegistryEvent>;
      delete missing[field];
      expect(() => normalizeRegistryEvent({
        ...missing,
        changedFields: [field]
      } as RegistryEvent)).toThrow("Every declared registry event field must be present");

      expect(normalizeRegistryEvent({
        ...base,
        [field]: null,
        changedFields: [field]
      } as RegistryEvent)[field]).toBeNull();

      expect(() => normalizeRegistryEvent({
        ...base,
        [field]: undefined,
        changedFields: [field]
      } as RegistryEvent)).toThrow("present but undefined");
    }
  });

  it("deduplicates 8004scan replay while retaining normalized services and capabilities", async () => {
    const page = {
      items: [
        {
          identity,
          sourceReference: "scan-result-1",
          observedAt: "2026-09-02T00:00:00.000Z",
          metadata: { name: "Public agent" },
          services: [
            { kind: "mcp", url: "https://agent.example/mcp", protocolVersion: "2025-06-18" },
            { kind: "a2a", url: "https://agent.example/card", protocolVersion: "0.3" }
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
        }
      ],
      nextCursor: null
    };
    const adapter = createEightHundredFourScanAdapter({
      async listCandidates() {
        return page;
      }
    });
    const repository = new InMemoryIngestionRepository();
    const service = new AgentIngestionService(repository);
    const firstPage = await adapter.fetchPage();
    const secondPage = await adapter.fetchPage();
    await service.ingestCandidates([...firstPage.candidates, ...secondPage.candidates]);

    expect(await repository.listIdentities()).toHaveLength(1);
    const key = "eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(await repository.listSources(key)).toHaveLength(1);
    expect(await repository.listServices(key)).toHaveLength(2);
    expect(await repository.listCapabilities(key)).toHaveLength(1);
  });

  it("rejects credentials and accepts only explicitly advertised HTTP(S) services", async () => {
    const repository = new InMemoryIngestionRepository();
    const service = new AgentIngestionService(repository);
    const result = await service.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-1",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1",
      metadata: { name: "Safe" },
      services: [
        { kind: "mcp", url: "https://agent.example/mcp", protocolVersion: "1" },
        { kind: "a2a", url: "https://user:password@agent.example/card", protocolVersion: "1" },
        { kind: "readiness", url: "https://agent.example/status", protocolVersion: "1" }
      ]
    });

    expect(result.services.map((item) => item.url)).toEqual([
      "https://agent.example/mcp",
      "https://agent.example/status"
    ]);
    expect(result.rejectedServices).toHaveLength(1);
  });

  it("requires the current NFT owner for a claim and keeps agentWallet independent", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "8004scan",
      sourceReference: "candidate-1",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "8004scan-v1"
    });
    const reader = {
      async readIdentity() {
        return state(ownerA, walletA, 20);
      }
    };
    await ingestion.reconcileIdentity(reader, identity);
    const proof = claimProof(ownerA, "nonce-1234");
    const claims = new IdentityClaimService(
      repository,
      reader,
      { async verify({ proof: verified }) { return verifiedProof(verified); } },
      { now: () => new Date("2026-09-02T00:01:00.000Z"), internalOperatorId: "operator:indexer" }
    );
    const claimed = await claims.claim({ identity, proof, context: claimContext });

    expect(claimed.ownerAddress).toBe(ownerA);
    expect(claimed.agentWallet).toBe(walletA);
    expect(claimed.state.claimStatus).toBe("claimed");
    expect((await repository.getClaim("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))?.claimantAddress).toBe(ownerA);
  });

  it("closes the owner-read TOCTOU window before the claim CAS", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-owner-toctou",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    await ingestion.reconcileIdentity({ async readIdentity() { return state(ownerA, walletA, 21); } }, identity);
    let reads = 0;
    const reader = {
      async readIdentity() {
        reads += 1;
        return reads === 1 ? state(ownerA, walletA, 22) : state(ownerB, walletA, 23);
      }
    };
    const claims = new IdentityClaimService(
      repository,
      reader,
      { async verify({ proof: verified }) { return verifiedProof(verified); } },
      { now: () => new Date("2026-09-02T00:01:00.000Z"), internalOperatorId: "operator:indexer" }
    );

    await expect(
      claims.claim({ identity, proof: claimProof(ownerA, "nonce-toctou"), context: claimContext })
    ).rejects.toMatchObject({ code: "CLAIM_OWNER_MISMATCH" });
    expect(await repository.getClaim(erc8004IdentityKey(identity))).toBeNull();
    expect((await repository.findIdentity(identity))?.ownerAddress).toBe(ownerA);
  });

  it("marks an old claim stale after a canonical owner transfer without delisting the identity", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-claim",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    let currentOwner = ownerA;
    const reader = {
      async readIdentity() {
        return state(currentOwner, walletA, 30);
      }
    };
    await ingestion.reconcileIdentity(reader, identity);
    const claims = new IdentityClaimService(
      repository,
      reader,
      { async verify({ proof: verified }) { return verifiedProof(verified); } },
      { now: () => new Date("2026-09-02T00:01:00.000Z"), internalOperatorId: "operator:indexer" }
    );
    await claims.claim({
      identity,
      proof: claimProof(ownerA, "nonce-1234"),
      context: claimContext
    });
    currentOwner = ownerB;
    const revalidated = await claims.revalidate(identity);

    expect(revalidated.state.claimStatus).toBe("stale");
    expect(revalidated.state.listingStatus).toBe("draft");
    expect((await repository.listClaimEvents("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))[1]?.eventType).toBe("stale");
  });

  it("rejects a stale claim CAS and leaves the claim event log unchanged", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-cas",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    await ingestion.reconcileIdentity({ async readIdentity() { return state(ownerA, walletA, 25); } }, identity);
    const identityKey = erc8004IdentityKey(identity);
    const actor = { type: "owner" as const, walletAddress: ownerA, proofDigest: "b".repeat(64) };
    const claim = {
      identityKey,
      version: 1,
      status: "claimed" as const,
      claimantAddress: ownerA,
      ownerAddressAtVerification: ownerA,
      agentWalletAtVerification: walletA,
      verifiedAt: new Date("2026-09-02T00:01:00.000Z"),
      staleAt: null,
      lastReason: "claimed" as const,
      verificationObservedBlock: 25,
      verificationObservedBlockHash: "0x" + "19".repeat(32),
      verificationReadConsistency: "finalized" as const
    };
    await repository.mutateClaim({
      identityKey,
      expectedVersion: null,
      expectedStatus: null,
      expectedOwnerAddress: ownerA,
      expectedCanonicalRead: {
        observedBlock: 25,
        observedBlockHash: "0x" + "19".repeat(32),
        readConsistency: "finalized"
      },
      claim,
      actor,
      event: {
        identityKey,
        eventType: "claimed",
        claimantAddress: ownerA,
        observedOwnerAddress: ownerA,
        observedAgentWallet: walletA,
        proofDigest: actor.proofDigest,
        actorType: "owner",
        actorId: ownerA,
        reason: "test",
        occurredAt: claim.verifiedAt
      }
    });
    await expect(
      repository.mutateClaim({
        identityKey,
        expectedVersion: null,
        expectedStatus: null,
        expectedOwnerAddress: ownerA,
        expectedCanonicalRead: {
          observedBlock: 25,
          observedBlockHash: "0x" + "19".repeat(32),
          readConsistency: "finalized"
        },
        claim: { ...claim, version: 2 },
        actor,
        event: {
          identityKey,
          eventType: "claimed",
          claimantAddress: ownerA,
          observedOwnerAddress: ownerA,
          observedAgentWallet: walletA,
          proofDigest: actor.proofDigest,
          actorType: "owner",
          actorId: ownerA,
          reason: "stale test",
          occurredAt: claim.verifiedAt
        }
      })
    ).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
    expect(await repository.listClaimEvents(identityKey)).toHaveLength(1);
  });

  it("rejects a verifier result bound to a different SIWE resource", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-proof-binding",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    const reader = { async readIdentity() { return state(ownerA, walletA, 35); } };
    await ingestion.reconcileIdentity(reader, identity);
    const claims = new IdentityClaimService(
      repository,
      reader,
      {
        async verify({ proof: verified }) {
          return verifiedProof({ ...verified, resources: ["https://evil.example/resource"] });
        }
      },
      { now: () => new Date("2026-09-02T00:01:00.000Z"), internalOperatorId: "operator:indexer" }
    );
    await expect(
      claims.claim({ identity, proof: claimProof(ownerA, "nonce-binding"), context: claimContext })
    ).rejects.toMatchObject({ code: "CLAIM_PROOF_INVALID" });
    expect(await repository.getClaim(erc8004IdentityKey(identity))).toBeNull();
  });

  it("does not erase unaffected canonical fields when an event declares only the fields it changed", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestRegistryEvents(
      [
        registryEvent({
          transactionHash: "0x" + "05".repeat(32),
          logIndex: 0,
          blockNumber: 10,
          blockHash: "0x" + "10".repeat(32)
        }),
        (() => {
          const {
            agentWallet: _agentWallet,
            agentUri: _agentUri,
            contentDigest: _contentDigest,
            ...ownerOnlyEvent
          } = registryEvent({
            transactionHash: "0x" + "06".repeat(32),
            logIndex: 0,
            blockNumber: 11,
            blockHash: "0x" + "11".repeat(32),
            ownerAddress: ownerB
          });
          return { ...ownerOnlyEvent, changedFields: ["ownerAddress"] as const };
        })()
      ],
      { chainId: 97, identityRegistry: identity.identityRegistry }
    );
    await ingestion.canonicalizeThrough({
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      throughBlock: 11,
      finalizedBlockTag: { blockNumber: 11, blockHash: "0x" + "11".repeat(32) }
    }, {
      async getTrustedBlockHash(blockNumber) {
        return "0x" + blockNumber.toString(10).padStart(2, "0").repeat(32);
      }
    });
    const record = await repository.findIdentity(identity);

    expect(record?.ownerAddress).toBe(ownerB);
    expect(record?.agentWallet).toBe(walletA);
    expect(record?.agentUri).toBe("https://agent.example/metadata.json");
  });

  it("orders promoted observations by chain position even when the adapter is unordered", async () => {
    class ReversePromotionRepository extends InMemoryIngestionRepository {
      override async markCanonical(
        input: Parameters<InMemoryIngestionRepository["markCanonical"]>[0]
      ): Promise<readonly ChainObservation[]> {
        const promoted = await super.markCanonical(input);
        return [...promoted].reverse();
      }
    }
    const repository = new ReversePromotionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestRegistryEvents(
      [
        registryEvent({
          transactionHash: "0x" + "07".repeat(32),
          logIndex: 0,
          blockNumber: 10,
          blockHash: "0x" + "10".repeat(32),
          ownerAddress: ownerA
        }),
        registryEvent({
          transactionHash: "0x" + "08".repeat(32),
          logIndex: 0,
          blockNumber: 11,
          blockHash: "0x" + "11".repeat(32),
          ownerAddress: ownerB
        })
      ],
      { chainId: 97, identityRegistry: identity.identityRegistry }
    );

    const promoted = await ingestion.canonicalizeThrough({
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      throughBlock: 11,
      finalizedBlockTag: { blockNumber: 11, blockHash: "0x" + "11".repeat(32) }
    }, {
      async getTrustedBlockHash(blockNumber) {
        return "0x" + blockNumber.toString(10).padStart(2, "0").repeat(32);
      }
    });

    expect(promoted.map((observation) => observation.blockNumber)).toEqual([10, 11]);
    expect((await repository.findIdentity(identity))?.ownerAddress).toBe(ownerB);
  });

  it("records explicit claim revocation as a revoked event while using the shared stale axis", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    await ingestion.ingestCandidate({
      identity,
      source: "manual",
      sourceReference: "manual-revocation",
      observedAt: new Date("2026-09-02T00:00:00.000Z"),
      normalizedIngestionVersion: "manual-v1"
    });
    const reader = { async readIdentity() { return state(ownerA, walletA, 40); } };
    await ingestion.reconcileIdentity(reader, identity);
    const claims = new IdentityClaimService(
      repository,
      reader,
      {
        async verify({ proof: verified }) { return verifiedProof(verified); }
      },
      { now: () => new Date("2026-09-02T00:01:00.000Z"), internalOperatorId: "operator:indexer", operatorAuthorizer: {
        async authorize({ operator }) { return operator; }
      } }
    );
    await claims.claim({
      identity,
      proof: claimProof(ownerA, "nonce-revoke"),
      context: claimContext
    });
    const revoked = await claims.revoke(identity, "operator revoked owner-management proof", testOperator);

    expect(revoked.state.claimStatus).toBe("stale");
    expect((await repository.listClaimEvents("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))[1]?.eventType).toBe("revoked");
  });
});

describe("reorg-aware registry synchronization", () => {
  it("fails closed when a trusted provider hash disagrees with an event before promotion", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    const event = registryEvent({
      transactionHash: "0x" + "09".repeat(32),
      logIndex: 0,
      blockNumber: 9,
      blockHash: "0x" + "09".repeat(32)
    });
    await ingestion.ingestRegistryEvents([event], { chainId: 97, identityRegistry: identity.identityRegistry });

    await expect(
      ingestion.canonicalizeThrough(
        {
          chainId: 97,
          identityRegistry: identity.identityRegistry,
          throughBlock: 9,
          finalizedBlockTag: { blockNumber: 9, blockHash: "0x" + "aa".repeat(32) }
        },
        { async getTrustedBlockHash() { return "0x" + "aa".repeat(32); } }
      )
    ).rejects.toMatchObject({ code: "REORG_RECONCILIATION_REQUIRED" });
    expect(
      (await repository.listObservations({ chainId: 97, identityRegistry: identity.identityRegistry }))[0]?.confirmationState
    ).toBe("provisional");
  });

  it("rolls back observations, identities, and checkpoint when the final checkpoint write fails", async () => {
    class FailingCheckpointRepository extends InMemoryIngestionRepository {
      override async saveCheckpoint(): Promise<never> {
        throw new Error("checkpoint write failed");
      }
    }
    const repository = new FailingCheckpointRepository();
    const ingestion = new AgentIngestionService(repository);
    const blockHash = "0x" + "0a".repeat(32);
    const reader: RegistryChainReader = {
      async getLatestBlock() { return 10; },
      async getTrustedBlockHash() { return blockHash; },
      async getRegistryEvents() {
        return [registryEvent({
          transactionHash: "0x" + "0a".repeat(32),
          logIndex: 0,
          blockNumber: 10,
          blockHash
        })];
      },
      async readIdentity() { return state(ownerA, walletA, 10); },
      async findCommonAncestor() { return 0; }
    };

    await expect(
      ingestion.syncRegistry(reader, {
        chainId: 97,
        identityRegistry: identity.identityRegistry,
        startBlock: 10,
        confirmationThreshold: 0
      })
    ).rejects.toThrow("checkpoint write failed");
    expect(await repository.getCheckpoint(97, identity.identityRegistry)).toBeNull();
    expect(await repository.listIdentities()).toHaveLength(0);
    expect(await repository.listObservations({ chainId: 97, identityRegistry: identity.identityRegistry })).toHaveLength(0);
  });

  it("fails closed when a reorg crosses the finalized checkpoint", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    const checkpoint = {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      indexerVersion: "registry-indexer-v1",
      lastScannedBlock: 12,
      lastScannedBlockHash: "0x" + "12".repeat(32),
      lastFinalizedBlock: 11,
      lastFinalizedBlockHash: "0x" + "11".repeat(32),
      confirmationThreshold: 1,
      cursorVersion: 1,
      lastReconciliationAt: null
    } as const;
    await repository.saveCheckpoint(checkpoint, {
      expectedCursorVersion: null,
      expectedLastScannedBlockHash: null
    });
    const reader: RegistryChainReader = {
      async getLatestBlock() { return 13; },
      async getTrustedBlockHash(blockNumber) {
        return blockNumber === 12 ? "0x" + "aa".repeat(32) : "0x" + blockNumber.toString(16).padStart(2, "0").repeat(32);
      },
      async getRegistryEvents() { return []; },
      async readIdentity(_identity, _blockTag) { return state(ownerA, walletA, 10); },
      async findCommonAncestor() { return 10; }
    };

    await expect(
      ingestion.syncRegistry(reader, {
        chainId: 97,
        identityRegistry: identity.identityRegistry,
        startBlock: 10,
        confirmationThreshold: 1
      })
    ).rejects.toMatchObject({ code: "REORG_RECONCILIATION_REQUIRED", nextAction: "manual_review_finality" });
    expect(await repository.getCheckpoint(97, identity.identityRegistry)).toEqual(checkpoint);
  });

  it("requires checkpoint CAS, continuity, and immutable threshold configuration", async () => {
    const repository = new InMemoryIngestionRepository();
    const first = {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      indexerVersion: "registry-indexer-v1",
      lastScannedBlock: 10,
      lastScannedBlockHash: "0x" + "10".repeat(32),
      lastFinalizedBlock: 10,
      lastFinalizedBlockHash: "0x" + "10".repeat(32),
      confirmationThreshold: 1,
      cursorVersion: 1,
      lastReconciliationAt: null
    } as const;
    await repository.saveCheckpoint(first, {
      expectedCursorVersion: null,
      expectedLastScannedBlockHash: null
    });

    await expect(
      repository.saveCheckpoint(
        { ...first, cursorVersion: 2, confirmationThreshold: 2 },
        {
          expectedCursorVersion: first.cursorVersion,
          expectedLastScannedBlockHash: first.lastScannedBlockHash,
          previousScannedBlock: first.lastScannedBlock,
          previousScannedBlockHash: first.lastScannedBlockHash
        }
      )
    ).rejects.toMatchObject({ code: "CHECKPOINT_CONFLICT" });

    await expect(
      repository.saveCheckpoint(
        { ...first, cursorVersion: 2, lastScannedBlock: 12, lastScannedBlockHash: "0x" + "12".repeat(32) },
        {
          expectedCursorVersion: first.cursorVersion,
          expectedLastScannedBlockHash: first.lastScannedBlockHash,
          previousScannedBlock: 9,
          previousScannedBlockHash: "0x" + "09".repeat(32)
        }
      )
    ).rejects.toMatchObject({ code: "CHECKPOINT_CONFLICT" });

    const rewound = await repository.saveCheckpoint(
      {
        ...first,
        cursorVersion: 2,
        lastScannedBlock: 9,
        lastScannedBlockHash: "0x" + "09".repeat(32),
        lastFinalizedBlock: 9,
        lastFinalizedBlockHash: "0x" + "09".repeat(32)
      },
      {
        expectedCursorVersion: first.cursorVersion,
        expectedLastScannedBlockHash: first.lastScannedBlockHash,
        previousScannedBlock: first.lastScannedBlock,
        previousScannedBlockHash: first.lastScannedBlockHash,
        verifiedRewind: {
          previousScannedBlock: first.lastScannedBlock,
          previousScannedBlockHash: first.lastScannedBlockHash,
          commonAncestorBlock: 9,
          commonAncestorHash: "0x" + "09".repeat(32)
        }
      }
    );
    expect(rewound.lastFinalizedBlock).toBe(9);
  });

  it("promotes finalized observations, rewinds on block-hash mismatch, and replays the replacement chain", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    const hashes: Record<number, string> = {
      10: "0x" + "10".repeat(32),
      11: "0x" + "11".repeat(32),
      12: "0x" + "12".repeat(32),
      13: "0x" + "13".repeat(32),
      14: "0x" + "14".repeat(32)
    };
    let phase = 1;
    let checkpointProbe = true;
    const reader: RegistryChainReader = {
      async getLatestBlock() { return phase === 1 ? 12 : 14; },
      async getTrustedBlockHash(blockNumber) {
        if (phase === 2 && blockNumber === 12 && checkpointProbe) {
          checkpointProbe = false;
          return "0x" + "aa".repeat(32);
        }
        if (phase === 2 && blockNumber === 11) return "0x" + "bb".repeat(32);
        if (phase === 2 && blockNumber === 12) return "0x" + "cc".repeat(32);
        return hashes[blockNumber] ?? null;
      },
      async getRegistryEvents(query) {
        if (phase === 1) {
          expect(query.blockTag).toEqual({ blockNumber: 12, blockHash: hashes[12] });
          return [
            registryEvent({ transactionHash: "0x" + "01".repeat(32), logIndex: 0, blockNumber: 10, blockHash: hashes[10]! }),
            registryEvent({ transactionHash: "0x" + "02".repeat(32), logIndex: 0, blockNumber: 11, blockHash: hashes[11]! })
          ];
        }
        expect(query.fromBlock).toBe(11);
        expect(query.toBlock).toBe(14);
        expect(query.blockTag).toEqual({ blockNumber: 14, blockHash: hashes[14] });
        return [
          registryEvent({ transactionHash: "0x" + "03".repeat(32), logIndex: 0, blockNumber: 11, blockHash: "0x" + "bb".repeat(32), ownerAddress: ownerB }),
          registryEvent({ transactionHash: "0x" + "04".repeat(32), logIndex: 0, blockNumber: 12, blockHash: "0x" + "cc".repeat(32), ownerAddress: ownerB })
        ];
      },
      async readIdentity(_identity, blockTag) {
        if (phase === 2) {
          expect(blockTag).toEqual({ blockNumber: 10, blockHash: hashes[10] });
        }
        return phase === 1
          ? state(ownerB, walletA, 11)
          : state(ownerB, walletA, 10, hashes[10]!);
      },
      async findCommonAncestor() { return 10; }
    };
    const first = await ingestion.syncRegistry(reader, {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      startBlock: 10,
      confirmationThreshold: 2
    });
    expect(first.promotedObservationCount).toBe(1);
    expect(first.reorgRewound).toBe(false);
    phase = 2;
    const second = await ingestion.syncRegistry(reader, {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      startBlock: 10,
      confirmationThreshold: 2
    });

    expect(second.reorgRewound).toBe(true);
    expect(second.orphanedObservationCount).toBe(1);
    expect(second.promotedObservationCount).toBe(2);
    expect((await repository.listVisibleCanonicalObservations(97, identity.identityRegistry)).map((item) => item.transactionHash)).toEqual([
      "0x" + "01".repeat(32),
      "0x" + "03".repeat(32),
      "0x" + "04".repeat(32)
    ]);
    expect((await repository.getCheckpoint(97, identity.identityRegistry))?.lastFinalizedBlock).toBe(12);
  });
});
