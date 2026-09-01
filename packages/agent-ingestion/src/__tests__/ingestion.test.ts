import { describe, expect, it } from "vitest";
import {
  AgentIngestionService,
  IdentityClaimService,
  InMemoryIngestionRepository,
  createEightHundredFourScanAdapter,
  type ClaimVerificationProof,
  type DirectIdentityState,
  type RegistryChainReader,
  type RegistryEvent
} from "../index.js";
import type { Erc8004Identity } from "@bnbera/domain";

const identity: Erc8004Identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "115792089237316195423570985008687907853269984665640564039457584007913129639935"
};

const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const walletA = "0xcccccccccccccccccccccccccccccccccccccccc";

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

function state(ownerAddress: string | null = ownerA, agentWallet: string | null = walletA, observedBlock = 10): DirectIdentityState {
  return {
    ownerAddress,
    agentWallet,
    agentUri: "https://agent.example/metadata.json",
    contentDigest: null,
    observedBlock
  };
}

describe("A3 identity and discovery ingestion", () => {
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
    const proof: ClaimVerificationProof = {
      address: ownerA,
      chainId: 97,
      issuedAt: new Date("2026-09-02T00:00:00.000Z"),
      expirationTime: new Date("2026-09-02T00:10:00.000Z"),
      nonce: "nonce-1234",
      signatureDigest: "a".repeat(64)
    };
    const claims = new IdentityClaimService(
      repository,
      reader,
      { async verify() { return true; } },
      { now: () => new Date("2026-09-02T00:01:00.000Z") }
    );
    const claimed = await claims.claim({ identity, proof });

    expect(claimed.ownerAddress).toBe(ownerA);
    expect(claimed.agentWallet).toBe(walletA);
    expect(claimed.state.claimStatus).toBe("claimed");
    expect((await repository.getClaim("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))?.claimantAddress).toBe(ownerA);
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
      { async verify() { return true; } },
      { now: () => new Date("2026-09-02T00:01:00.000Z") }
    );
    await claims.claim({
      identity,
      proof: {
        address: ownerA,
        chainId: 97,
        issuedAt: new Date("2026-09-02T00:00:00.000Z"),
        expirationTime: new Date("2026-09-02T00:10:00.000Z"),
        nonce: "nonce-1234"
      }
    });
    currentOwner = ownerB;
    const revalidated = await claims.revalidate(identity);

    expect(revalidated.state.claimStatus).toBe("stale");
    expect(revalidated.state.listingStatus).toBe("draft");
    expect((await repository.listClaimEvents("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))[1]?.eventType).toBe("stale");
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
      finalizedBlockHash: "0x" + "11".repeat(32)
    });
    const record = await repository.findIdentity(identity);

    expect(record?.ownerAddress).toBe(ownerB);
    expect(record?.agentWallet).toBe(walletA);
    expect(record?.agentUri).toBe("https://agent.example/metadata.json");
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
      { async verify() { return true; } },
      { now: () => new Date("2026-09-02T00:01:00.000Z") }
    );
    await claims.claim({
      identity,
      proof: {
        address: ownerA,
        chainId: 97,
        issuedAt: new Date("2026-09-02T00:00:00.000Z"),
        expirationTime: new Date("2026-09-02T00:10:00.000Z"),
        nonce: "nonce-revoke"
      }
    });
    const revoked = await claims.revoke(identity, "operator revoked owner-management proof");

    expect(revoked.state.claimStatus).toBe("stale");
    expect((await repository.listClaimEvents("eip155:97:0x1111111111111111111111111111111111111111:115792089237316195423570985008687907853269984665640564039457584007913129639935"))[1]?.eventType).toBe("revoked");
  });
});

describe("reorg-aware registry synchronization", () => {
  it("promotes finalized observations, rewinds on block-hash mismatch, and replays the replacement chain", async () => {
    const repository = new InMemoryIngestionRepository();
    const ingestion = new AgentIngestionService(repository);
    const hashes: Record<number, string> = {
      10: "0x" + "10".repeat(32),
      11: "0x" + "11".repeat(32),
      12: "0x" + "12".repeat(32),
      13: "0x" + "13".repeat(32)
    };
    let phase = 1;
    const reader: RegistryChainReader = {
      async getLatestBlock() { return phase === 1 ? 12 : 13; },
      async getBlockHash(blockNumber) {
        if (phase === 2 && blockNumber === 12) return "0x" + "aa".repeat(32);
        return hashes[blockNumber] ?? null;
      },
      async getRegistryEvents(query) {
        if (phase === 1) {
          return [
            registryEvent({ transactionHash: "0x" + "01".repeat(32), logIndex: 0, blockNumber: 10, blockHash: hashes[10]! }),
            registryEvent({ transactionHash: "0x" + "02".repeat(32), logIndex: 0, blockNumber: 11, blockHash: hashes[11]! })
          ];
        }
        expect(query.fromBlock).toBe(11);
        return [
          registryEvent({ transactionHash: "0x" + "03".repeat(32), logIndex: 0, blockNumber: 11, blockHash: "0x" + "bb".repeat(32), ownerAddress: ownerB }),
          registryEvent({ transactionHash: "0x" + "04".repeat(32), logIndex: 0, blockNumber: 12, blockHash: "0x" + "cc".repeat(32), ownerAddress: ownerB })
        ];
      },
      async readIdentity() { return state(ownerB, walletA, phase === 1 ? 11 : 12); },
      async findCommonAncestor() { return 10; }
    };
    const first = await ingestion.syncRegistry(reader, {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      startBlock: 10,
      confirmationThreshold: 1
    });
    expect(first.promotedObservationCount).toBe(2);
    expect(first.reorgRewound).toBe(false);
    phase = 2;
    const second = await ingestion.syncRegistry(reader, {
      chainId: 97,
      identityRegistry: identity.identityRegistry,
      startBlock: 10,
      confirmationThreshold: 1
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
