import { describe, expect, it } from "vitest";
import {
  InMemoryErc8183MarketplaceProjection,
  erc8183CompletedJobSchema,
  type Erc8183CompletedJob
} from "../src/index.js";

const IDENTITY = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
} as const;
const VERSION_ID = "00000000-0000-4000-8000-000000000042";
const COMMERCE_JOB_ID = "00000000-0000-4000-8000-000000000101";
const RESULT_ID = "00000000-0000-4000-8000-000000000102";
const BUYER_ID = "00000000-0000-4000-8000-000000000103";
const BUYER = "0x2222222222222222222222222222222222222222";
const PROVIDER = "0x3333333333333333333333333333333333333333";

function completedJob(): Erc8183CompletedJob {
  return erc8183CompletedJobSchema.parse({
    resultId: RESULT_ID,
    commerceJobId: COMMERCE_JOB_ID,
    jobKey: {
      chainId: 97,
      commerceContract: "0x4444444444444444444444444444444444444444",
      jobId: "7"
    },
    buyerUserId: BUYER_ID,
    buyerAddress: BUYER,
    providerBinding: { identity: IDENTITY, agentVersionId: VERSION_ID, agentVersion: 3 },
    result: {
      localSha256: "a".repeat(64),
      chainKeccak: `0x${"b".repeat(64)}`,
      deliverableUrl: "https://example.test/result/7.json",
      payload: { status: "complete" },
      submissionReceipt: {
        transactionHash: `0x${"c".repeat(64)}`,
        blockNumber: "100",
        blockHash: `0x${"d".repeat(64)}`,
        logIndex: 0
      },
      settlementReceipt: {
        transactionHash: `0x${"e".repeat(64)}`,
        blockNumber: "101",
        blockHash: `0x${"f".repeat(64)}`,
        logIndex: 1
      },
      submittedAtUnix: 2_000_100,
      settledAtUnix: 2_000_200
    },
    settledAtUnix: 2_000_200,
    review: null
  });
}

describe("bounded ERC-8183 marketplace projection", () => {
  it("counts only the settled identity/version and keeps result provenance", async () => {
    const projection = new InMemoryErc8183MarketplaceProjection([completedJob()]);

    const read = await projection.readForIdentity({ identity: IDENTITY, agentVersionId: VERSION_ID, agentVersion: 3 });
    expect(read.completedJobs).toHaveLength(1);
    expect(read.completedJobs[0]?.result.settlementReceipt.transactionHash).toBe(`0x${"e".repeat(64)}`);
    expect(read.verifiedReviews).toEqual([]);
    expect((await projection.readForIdentity({ identity: IDENTITY, agentVersionId: VERSION_ID.replace(/42$/u, "43"), agentVersion: 3 })).completedJobs).toEqual([]);
  });

  it("requires the authenticated buyer and preserves one active review with history", async () => {
    const projection = new InMemoryErc8183MarketplaceProjection([completedJob()]);
    const createInput = {
      idempotencyKey: "review-create-1",
      commerceJobId: COMMERCE_JOB_ID,
      buyerUserId: BUYER_ID,
      buyerAddress: BUYER,
      score: 4,
      comment: "Delivered the requested result."
    };

    await expect(projection.createReview({ ...createInput, buyerAddress: PROVIDER })).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTOR" });
    const created = await projection.createReview(createInput);
    expect(created.replayed).toBe(false);
    expect(created.review.state).toBe("active");
    expect(created.review.providerBinding.identity).toEqual(IDENTITY);
    expect((await projection.createReview(createInput)).replayed).toBe(true);
    await expect(projection.createReview({ ...createInput, idempotencyKey: "review-create-2", score: 5 })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const updated = await projection.updateReview({
      idempotencyKey: "review-update-1",
      reviewId: created.review.reviewId,
      commerceJobId: COMMERCE_JOB_ID,
      buyerUserId: BUYER_ID,
      buyerAddress: BUYER,
      score: 5,
      comment: "Updated after settlement review."
    });
    expect(updated.review.state).toBe("active");
    expect(updated.review.supersedesReviewId).toBe(created.review.reviewId);
    expect((await projection.listReviewHistory({ commerceJobId: COMMERCE_JOB_ID, includeInactive: true }))).toHaveLength(2);
    expect((await projection.readForIdentity({ identity: IDENTITY })).verifiedReviews).toHaveLength(1);

    const revoked = await projection.revokeReview({
      idempotencyKey: "review-revoke-1",
      reviewId: updated.review.reviewId,
      commerceJobId: COMMERCE_JOB_ID,
      buyerUserId: BUYER_ID,
      buyerAddress: BUYER,
      reason: "Buyer withdrew the review."
    });
    expect(revoked.review.state).toBe("revoked");
    expect((await projection.getCompletedJob({ commerceJobId: COMMERCE_JOB_ID }))?.review).toBeNull();
    expect((await projection.listReviewHistory({ commerceJobId: COMMERCE_JOB_ID, includeInactive: true })).map((review) => review.state)).toEqual(["superseded", "revoked"]);
    expect((await projection.revokeReview({
      idempotencyKey: "review-revoke-1",
      reviewId: updated.review.reviewId,
      commerceJobId: COMMERCE_JOB_ID,
      buyerUserId: BUYER_ID,
      buyerAddress: BUYER,
      reason: "Buyer withdrew the review."
    })).replayed).toBe(true);
  });
});
