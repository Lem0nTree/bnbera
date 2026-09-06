import { describe, expect, it } from "vitest";
import {
  commerceApprovalOrDisputeRequestSchema,
  commerceHireRequestSchema,
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
    expect(commerceHireRequestSchema.parse({
      idempotencyKey: "hire-parent-only",
      commerceJobId: "00000000-0000-4000-8000-000000000007",
      task: "health factor",
      budgetAtomic: "1000"
    })).toEqual({
      idempotencyKey: "hire-parent-only",
      commerceJobId: "00000000-0000-4000-8000-000000000007",
      task: "health factor",
      budgetAtomic: "1000"
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
});
