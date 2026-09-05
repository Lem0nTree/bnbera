import { describe, expect, it } from "vitest";
import { encodeAbiParameters } from "viem";
import {
  Erc8004DirectRegistrySyncJob,
  InMemoryIngestionRepository,
  createOfficialErc8004RegistryEventDecoder,
  officialErc8004IdentityAbiSha256,
  resolveErc8004RegistrySyncConfig,
  type RegistryChainReader,
  type RegistryEvent
} from "../index.js";

const registry = "0x1111111111111111111111111111111111111111";
const identity = { namespace: "eip155", chainId: 97, identityRegistry: registry, agentId: "7" } as const;
const blockHash = `0x${"aa".repeat(32)}`;
const owner = "0x2222222222222222222222222222222222222222";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function addressTopic(value: string): string {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function registeredLog(): Readonly<Record<string, unknown>> {
  const decoder = createOfficialErc8004RegistryEventDecoder();
  return {
    address: registry,
    topics: [decoder.logTopics[0], `0x${word(7n)}`, addressTopic(owner)],
    data: encodeAbiParameters([{ type: "string" }], ["https://agent.example/metadata.json"])
  };
}

function registryEvent(): RegistryEvent {
  return {
    identity,
    eventType: "Registered",
    transactionHash: `0x${"01".repeat(32)}`,
    logIndex: 0,
    blockNumber: 10,
    blockHash,
    ownerAddress: owner,
    agentUri: "https://agent.example/metadata.json",
    changedFields: ["ownerAddress", "agentUri"],
    payload: { event: "Registered" },
    observedAt: new Date("2026-09-05T00:00:00.000Z")
  };
}

function reader(events: readonly RegistryEvent[] = [registryEvent()]): RegistryChainReader {
  return {
    async getLatestBlock() { return 10; },
    async getTrustedBlockHash() { return blockHash; },
    async getRegistryEvents() { return events; },
    async readIdentity() {
      return {
        ownerAddress: owner,
        agentWallet: null,
        agentUri: "https://agent.example/metadata.json",
        contentDigest: null,
        observedBlock: 10,
        observedBlockHash: blockHash,
        readConsistency: "finalized",
        ownerObservedBlock: 10,
        agentWalletObservedBlock: 10,
        agentUriObservedBlock: 10,
        contentDigestObservedBlock: null
      };
    },
    async findCommonAncestor() { return 0; }
  };
}

describe("official direct registry event seam", () => {
  it("decodes a Registered log from the pinned ABI without exposing provider fields", () => {
    const decoder = createOfficialErc8004RegistryEventDecoder();
    const decoded = decoder.decodeLog({ log: registeredLog(), chainId: 97, identityRegistry: registry });
    expect(decoded).toMatchObject({
      identity,
      eventType: "Registered",
      ownerAddress: owner,
      agentUri: "https://agent.example/metadata.json",
      changedFields: ["ownerAddress", "agentUri"]
    });
    expect(decoded?.payload).toEqual({
      event: "Registered",
      args: { agentId: "7", agentURI: "https://agent.example/metadata.json", owner }
    });
  });

  it("resolves only an explicit lock finality entry", () => {
    const lock = {
      networks: {
        "97": {
          erc8004: {
            identityRegistry: registry,
            abiHashes: { identityRegistry: officialErc8004IdentityAbiSha256 },
            verificationStatus: "verified-read-only-bytecode-and-abi"
          }
        }
      }
    };
    expect(() => resolveErc8004RegistrySyncConfig(lock, 97, officialErc8004IdentityAbiSha256)).toThrowError(
      expect.objectContaining({ code: "REGISTRY_FINALITY_UNRESOLVED" })
    );
    expect(resolveErc8004RegistrySyncConfig({
      ...lock,
      networks: {
        "97": {
          erc8004: {
            ...lock.networks["97"].erc8004,
            confirmationThreshold: 12
          }
        }
      }
    }, 97, officialErc8004IdentityAbiSha256)).toMatchObject({ confirmationThreshold: 12, identityRegistry: registry });
  });

  it("fails closed before a provider call when either direct gate is disabled", async () => {
    const repository = new InMemoryIngestionRepository();
    let called = false;
    const job = new Erc8004DirectRegistrySyncJob({
      repository,
      reader: new Proxy(reader(), { get(target, property, receiver) {
        if (property === "getLatestBlock") return async () => { called = true; return Reflect.get(target, property, receiver) as never; };
        return Reflect.get(target, property, receiver);
      } }),
      gates: { ERC8004_INGESTION_ENABLED: true, ERC8004_DIRECT_REGISTRY_SYNC_ENABLED: false },
      chainId: 97,
      identityRegistry: registry,
      startBlock: 10,
      confirmationThreshold: 12
    });
    await expect(job.run()).resolves.toMatchObject({ status: "disabled", reason: "ERC8004_DIRECT_REGISTRY_SYNC_DISABLED" });
    expect(called).toBe(false);
  });

  it("persists a bounded canonical event and forwards the complete identity tuple", async () => {
    const repository = new InMemoryIngestionRepository();
    let forwarded: readonly string[] = [];
    const job = new Erc8004DirectRegistrySyncJob({
      repository,
      reader: reader(),
      gates: { ERC8004_INGESTION_ENABLED: true, ERC8004_DIRECT_REGISTRY_SYNC_ENABLED: true },
      chainId: 97,
      identityRegistry: registry,
      startBlock: 10,
      confirmationThreshold: 0,
      maxBlockRange: 1,
      maxEvents: 1,
      forwardCandidates: async (candidates) => {
        forwarded = candidates.map((candidate) => `${candidate.identity.namespace}:${candidate.identity.chainId}:${candidate.identity.identityRegistry}:${candidate.identity.agentId}`);
      }
    });
    const result = await job.run();
    expect(result).toMatchObject({ status: "completed", forwardedCount: 1, composition: "completed" });
    expect(forwarded).toEqual(["eip155:97:0x1111111111111111111111111111111111111111:7"]);
    expect(result.sync?.checkpoint).toMatchObject({ lastScannedBlock: 10, lastFinalizedBlock: 10, lastScannedBlockHash: blockHash });
    expect((await repository.listObservations({ chainId: 97, identityRegistry: registry }))[0]?.confirmationState).toBe("canonical");
  });

  it("rejects a provider read wider than the configured block bound", async () => {
    const job = new Erc8004DirectRegistrySyncJob({
      repository: new InMemoryIngestionRepository(),
      reader: { ...reader(), async getLatestBlock() { return 10; } },
      gates: { ERC8004_INGESTION_ENABLED: true, ERC8004_DIRECT_REGISTRY_SYNC_ENABLED: true },
      chainId: 97,
      identityRegistry: registry,
      startBlock: 1,
      confirmationThreshold: 0,
      maxBlockRange: 2
    });
    await expect(job.run()).rejects.toMatchObject({ code: "REGISTRY_SYNC_RANGE_EXCEEDED" });
  });
});
