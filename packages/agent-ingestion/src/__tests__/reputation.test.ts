import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import {
  InMemoryIngestionRepository,
  ReputationIngestionService,
  assertOfficialErc8004ReputationAbi,
  createOfficialErc8004ReputationEventDecoder,
  normalizeReputationEventWithDigest,
  type ReputationChainReader,
  type ReputationFeedbackEvent
} from "../index.js";

const identity = { namespace: "eip155", chainId: 97, identityRegistry: "0x1111111111111111111111111111111111111111", agentId: "7" } as const;
const reputationRegistry = "0x2222222222222222222222222222222222222222";
const reviewer = "0x3333333333333333333333333333333333333333";
const block10 = `0x${"aa".repeat(32)}`;
const block11 = `0x${"bb".repeat(32)}`;

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function addressTopic(value: string): string {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function feedbackLog(): Readonly<Record<string, unknown>> {
  const decoder = createOfficialErc8004ReputationEventDecoder();
  return {
    address: reputationRegistry,
    topics: [decoder.logTopics[0], `0x${word(7n)}`, addressTopic(reviewer), keccak256(toHex("quality"))],
    data: encodeAbiParameters([
      { type: "uint64" }, { type: "int128" }, { type: "uint8" }, { type: "string" }, { type: "string" },
      { type: "string" }, { type: "string" }, { type: "bytes32" }
    ], [0n, 87n, 0, "quality", "quality", "https://agent.example/task", "ipfs://feedback", `0x${"44".repeat(32)}`])
  };
}

function event(input: Partial<ReputationFeedbackEvent> & Pick<ReputationFeedbackEvent, "eventType" | "transactionHash" | "logIndex" | "blockNumber" | "blockHash">): ReputationFeedbackEvent {
  return normalizeReputationEventWithDigest({
    identity,
    reputationRegistry,
    eventType: input.eventType,
    clientAddress: reviewer,
    feedbackIndex: "0",
    value: input.eventType === "NewFeedback" ? "87" : null,
    valueDecimals: input.eventType === "NewFeedback" ? 0 : null,
    indexedTag1: input.eventType === "NewFeedback" ? "quality" : null,
    tag1: input.eventType === "NewFeedback" ? "quality" : null,
    tag2: input.eventType === "NewFeedback" ? "" : null,
    endpoint: input.eventType === "NewFeedback" ? "https://agent.example/task" : null,
    feedbackUri: input.eventType === "NewFeedback" ? "ipfs://feedback" : null,
    feedbackHash: input.eventType === "NewFeedback" ? `0x${"44".repeat(32)}` : null,
    transactionHash: input.transactionHash,
    logIndex: input.logIndex,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    confirmationState: "provisional",
    observedAt: new Date("2026-09-05T00:00:00.000Z"),
    canonicalizedAt: null,
    orphanedAt: null
  });
}

function reader(events: readonly ReputationFeedbackEvent[], latestBlock: number): ReputationChainReader {
  return {
    async getLatestBlock() { return latestBlock; },
    async getTrustedBlockHash(blockNumber) { return blockNumber === 11 ? block11 : block10; },
    async getReputationEvents() { return events; },
    async findCommonAncestor() { return 0; }
  };
}

describe("ERC-8004 Reputation Registry", () => {
  it("loads the standards-locked ABI and retains full feedback provenance", () => {
    const decoder = assertOfficialErc8004ReputationAbi("867b7975a5f2f9fee38c4a148a84471b141f4de91409ccc0c6bebe3df4f04001");
    const decoded = decoder.decodeLog({ log: feedbackLog(), chainId: identity.chainId, identityRegistry: identity.identityRegistry, reputationRegistry });
    expect(decoded).toMatchObject({ identity, reputationRegistry, eventType: "NewFeedback", clientAddress: reviewer, feedbackIndex: "0", value: "87", valueDecimals: 0, indexedTag1: keccak256(toHex("quality")), feedbackUri: "ipfs://feedback", feedbackHash: `0x${"44".repeat(32)}` });
    expect(() => assertOfficialErc8004ReputationAbi("0".repeat(64))).toThrow(/standards.lock|standards lock/i);
  });

  it("ingests idempotently and removes revoked feedback from the active view without deleting history", async () => {
    const repository = new InMemoryIngestionRepository();
    await repository.upsertIdentity({ identity, originType: "discovered" });
    const first = event({ eventType: "NewFeedback", transactionHash: `0x${"01".repeat(32)}`, logIndex: 0, blockNumber: 10, blockHash: block10 });
    const revoke = event({ eventType: "FeedbackRevoked", transactionHash: `0x${"02".repeat(32)}`, logIndex: 0, blockNumber: 11, blockHash: block11 });
    const service = new ReputationIngestionService(repository, () => new Date("2026-09-05T01:00:00.000Z"));
    const initial = await service.sync(reader([first], 10), { chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, startBlock: 0, confirmationThreshold: 0 });
    expect(initial.insertedEventCount).toBe(1);
    expect(initial.promotedEventCount).toBe(1);
    expect((await repository.listReputationFeedback(identity)).map((item) => item.feedbackIndex)).toEqual(["0"]);
    const replay = await service.sync(reader([], 10), { chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, startBlock: 0, confirmationThreshold: 0 });
    expect(replay.insertedEventCount).toBe(0);
    await service.sync(reader([revoke], 11), { chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, startBlock: 0, confirmationThreshold: 0 });
    expect(await repository.listReputationFeedback(identity)).toEqual([]);
    const history = await repository.listReputationFeedback(identity, { includeRevoked: true });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ feedbackIndex: "0", revoked: true, revocationTransactionHash: revoke.transactionHash, revocationBlockNumber: 11 });
    expect((await repository.listReputationEvents({ chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry })).length).toBe(2);
  });

  it("retains an orphaned log when the same transaction/log is re-included on a replacement block", async () => {
    const repository = new InMemoryIngestionRepository();
    await repository.upsertIdentity({ identity, originType: "discovered" });
    const transactionHash = `0x${"04".repeat(32)}`;
    const original = event({ eventType: "NewFeedback", transactionHash, logIndex: 0, blockNumber: 10, blockHash: block10 });
    const replacement = event({ eventType: "NewFeedback", transactionHash, logIndex: 0, blockNumber: 10, blockHash: `0x${"cc".repeat(32)}` });

    await repository.appendReputationEvent(original);
    await repository.markReputationOrphaned({ chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, fromBlock: 10, occurredAt: new Date("2026-09-05T01:01:00.000Z") });
    await expect(repository.appendReputationEvent(replacement)).resolves.toEqual(replacement);

    expect(await repository.listReputationEvents({ chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry })).toHaveLength(2);
    expect(await repository.listReputationEvents({ chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, state: "orphaned" })).toMatchObject([{ transactionHash, blockHash: block10, confirmationState: "orphaned" }]);

    await repository.markReputationCanonical({ chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, throughBlock: 10, canonicalizedAt: new Date("2026-09-05T01:02:00.000Z") });
    expect(await repository.listReputationFeedback(identity)).toMatchObject([{ feedbackTransactionHash: transactionHash, feedbackBlockHash: `0x${"cc".repeat(32)}`, revoked: false }]);
  });

  it("rejects a reader event whose supplied digest does not match its public provenance", async () => {
    const repository = new InMemoryIngestionRepository();
    await repository.upsertIdentity({ identity, originType: "discovered" });
    const valid = event({ eventType: "NewFeedback", transactionHash: `0x${"03".repeat(32)}`, logIndex: 0, blockNumber: 10, blockHash: block10 });
    const conflicting = { ...valid, payloadDigest: "0".repeat(64) };
    await expect(new ReputationIngestionService(repository).sync(reader([conflicting], 10), { chainId: 97, identityRegistry: identity.identityRegistry, reputationRegistry, startBlock: 0, confirmationThreshold: 0 })).rejects.toMatchObject({ code: "REPUTATION_DUPLICATE_CONFLICT" });
  });
});
