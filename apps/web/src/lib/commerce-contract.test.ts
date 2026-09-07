import { describe, expect, it } from "vitest";
import {
  commerceApprovalOrDisputeRequestSchema,
  commerceBrowserDispatchSchema,
  commerceExternalDispatchRequestSchema,
  commerceHireRequestSchema,
  commerceReviewRequestSchema,
  commerceSubmitRequestSchema
} from "./commerce-contract";

const LOCAL_SHA256 = "d".repeat(64);
const CHAIN_KECCAK = `0x${"e".repeat(64)}`;

describe("commerce API contract", () => {
  it("rejects request-body authority and gate claims", () => {
    const result = commerceHireRequestSchema.safeParse({
      idempotencyKey: "hire-authority-boundary",
      commerceJobId: "00000000-0000-4000-8000-000000000007",
      task: "health factor",
      budgetAtomic: "1000",
      requesterAddress: "0x4444444444444444444444444444444444444444",
      authority: { wallet: { address: "0x4444444444444444444444444444444444444444" } },
      standardsLock: { enabled: true },
      developmentCanaryEnabled: true
    });

    expect(result.success).toBe(false);
    expect(commerceHireRequestSchema.safeParse({
      idempotencyKey: "hire-parent-only",
      commerceJobId: "00000000-0000-4000-8000-000000000007",
      task: "health factor",
      budgetAtomic: "1000"
    }).success).toBe(false);
    expect(commerceHireRequestSchema.parse({
      idempotencyKey: "hire-quote-only",
      commerceJobId: "00000000-0000-4000-8000-000000000007"
    })).toEqual({
      idempotencyKey: "hire-quote-only",
      commerceJobId: "00000000-0000-4000-8000-000000000007"
    });
  });

  it("requires buyer approval to bind the exact local result digest", () => {
    expect(commerceApprovalOrDisputeRequestSchema.safeParse({
      idempotencyKey: "approve-without-digest",
      action: "approve"
    }).success).toBe(false);
    expect(commerceApprovalOrDisputeRequestSchema.safeParse({
      idempotencyKey: "dispute-with-digest",
      action: "dispute",
      resultDigest: LOCAL_SHA256
    }).success).toBe(false);
    expect(commerceApprovalOrDisputeRequestSchema.parse({
      idempotencyKey: "approve-exact-result",
      action: "approve",
      resultDigest: LOCAL_SHA256
    }).resultDigest).toBe(LOCAL_SHA256);
  });

  it("keeps local SHA-256 and chain Keccak as separate submission fields", () => {
    const parsed = commerceSubmitRequestSchema.parse({
      idempotencyKey: "submit-separated-digests",
      resultDigest: LOCAL_SHA256,
      chainDeliverable: CHAIN_KECCAK
    });
    expect(parsed.resultDigest).toBe(LOCAL_SHA256);
    expect(parsed.chainDeliverable).toBe(CHAIN_KECCAK);
  });

  it("accepts only public browser evidence and binds dispatch to the reviewed actor", () => {
    const operationId = "00000000-0000-4000-8000-000000000008";
    const actorAddress = "0x5555555555555555555555555555555555555555";
    const callsId = `0x${"a".repeat(64)}`;
    expect(commerceExternalDispatchRequestSchema.safeParse({ operationId, callsId, signer: { address: actorAddress } }).success).toBe(false);
    expect(commerceExternalDispatchRequestSchema.parse({ operationId, callsId })).toEqual({ operationId, callsId });
    expect(commerceExternalDispatchRequestSchema.parse({ operationId, claim: true })).toEqual({ operationId, claim: true });
    expect(commerceExternalDispatchRequestSchema.parse({ operationId, walletRejected: true })).toEqual({ operationId, walletRejected: true });
    expect(commerceExternalDispatchRequestSchema.safeParse({ operationId, claim: true, transactionHash: CHAIN_KECCAK }).success).toBe(false);
    expect(commerceExternalDispatchRequestSchema.safeParse({ operationId, walletRejected: true, claim: true }).success).toBe(false);
    expect(commerceBrowserDispatchSchema.parse({
      operationId,
      action: "hire",
      chainId: 97,
      actorAddress,
      providerAddress: "0x6666666666666666666666666666666666666666",
      task: "health factor",
      budgetAtomic: "1000",
      deadlineSeconds: null,
      jobId: null
    }).actorAddress).toBe(actorAddress);
  });

  it("binds review identity to the authenticated server boundary", () => {
    const result = commerceReviewRequestSchema.safeParse({
      idempotencyKey: "review-with-client-identity",
      score: 5,
      comment: "exact result",
      buyerUserId: "00000000-0000-4000-8000-000000000009",
      buyerAddress: "0x5555555555555555555555555555555555555555"
    });
    expect(result.success).toBe(false);
    expect(commerceReviewRequestSchema.parse({
      idempotencyKey: "review-server-identity",
      score: 5,
      comment: "exact result"
    })).toEqual({ idempotencyKey: "review-server-identity", score: 5, comment: "exact result" });
  });
});
