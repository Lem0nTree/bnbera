import { describe, expect, it } from "vitest";
import {
  CommerceError,
  InMemoryErc8183Repository,
  erc8183JobRecordSchema,
  type Erc8183JobRecord
} from "../src/index.js";

const JOB: Erc8183JobRecord = erc8183JobRecordSchema.parse({
  jobKey: { chainId: 97, commerceContract: "0x1111111111111111111111111111111111111111", jobId: "7" },
  terms: {
    chainId: 97,
    commerceContract: "0x1111111111111111111111111111111111111111",
    paymentToken: "0x2222222222222222222222222222222222222222",
    paymentDecimals: 18,
    clientAddress: "0x3333333333333333333333333333333333333333",
    providerAddress: "0x4444444444444444444444444444444444444444",
    evaluatorAddress: "0x5555555555555555555555555555555555555555",
    hookAddress: null,
    budgetAtomic: "1000",
    descriptionDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    expiresAtUnix: 2_000_600
  },
  state: "open",
  createdAtUnix: 2_000_000,
  updatedAtUnix: 2_000_000,
  deliverableDigest: null,
  fundingTransactionHash: null,
  submissionTransactionHash: null,
  completionTransactionHash: null,
  rejectionTransactionHash: null,
  refundTransactionHash: null,
  lastObservedBlock: null,
  lastObservedBlockHash: null,
  lastObservedAtUnix: null
});

describe("ERC-8183 repository idempotency", () => {
  it("replays an identical create and rejects a conflicting key", async () => {
    const repository = new InMemoryErc8183Repository();
    const first = await repository.create({ job: JOB, idempotencyKey: "create-job-7" });
    const replay = await repository.create({ job: JOB, idempotencyKey: "create-job-7" });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.job.jobKey).toEqual(first.job.jobKey);
    await expect(repository.create({ job: { ...JOB, jobKey: { ...JOB.jobKey, jobId: "8" } }, idempotencyKey: "create-job-7" })).rejects.toThrow(CommerceError);
  });

  it("rejects stale transitions and replays a successful transition", async () => {
    const repository = new InMemoryErc8183Repository();
    await repository.create({ job: JOB, idempotencyKey: "create-job-7" });
    const first = await repository.transition({
      jobKey: JOB.jobKey,
      expectedState: "open",
      nextState: "funded",
      action: "fund",
      actorAddress: JOB.terms.clientAddress,
      idempotencyKey: "fund-job-7",
      nowUnix: 2_000_100,
      correlationId: "corr-fund-7",
      metadata: { transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    });
    const replay = await repository.transition({
      jobKey: JOB.jobKey,
      expectedState: "open",
      nextState: "funded",
      action: "fund",
      actorAddress: JOB.terms.clientAddress,
      idempotencyKey: "fund-job-7",
      nowUnix: 2_000_100,
      correlationId: "corr-fund-7",
      metadata: { transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(repository.transition({
      jobKey: JOB.jobKey,
      expectedState: "open",
      nextState: "submitted",
      action: "submit",
      actorAddress: JOB.terms.providerAddress!,
      idempotencyKey: "submit-job-7",
      nowUnix: 2_000_200,
      correlationId: "corr-submit-7"
    })).rejects.toThrow(/state/i);
  });

  it("keeps event keys append-only and detects conflicting duplicates", async () => {
    const repository = new InMemoryErc8183Repository();
    await repository.create({ job: JOB, idempotencyKey: "create-job-7" });
    const event = (await repository.transition({
      jobKey: JOB.jobKey,
      expectedState: "open",
      nextState: "funded",
      action: "fund",
      actorAddress: JOB.terms.clientAddress,
      idempotencyKey: "fund-job-7",
      nowUnix: 2_000_100,
      correlationId: "corr-fund-7"
    })).event;
    expect((await repository.appendEvent(event)).replayed).toBe(true);
    await expect(repository.appendEvent({ ...event, payloadDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" })).rejects.toThrow(/event key/i);
  });
});
