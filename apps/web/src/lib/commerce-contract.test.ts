import { describe, expect, it } from "vitest";
import {
  commerceApprovalOrDisputeRequestSchema,
  commerceHireRequestSchema,
  commerceSubmitRequestSchema
} from "./commerce-contract";

const PROVIDER = "0x4444444444444444444444444444444444444444";
const IDENTITY_REGISTRY = "0x1111111111111111111111111111111111111111";
const LOCAL_SHA256 = "d".repeat(64);
const CHAIN_KECCAK = `0x${"e".repeat(64)}`;

const providerBinding = {
  identity: { namespace: "eip155", chainId: 97, identityRegistry: IDENTITY_REGISTRY, agentId: "42" },
  agentVersionId: "00000000-0000-4000-8000-000000000042",
  agentVersion: 1
};

describe("commerce API contract", () => {
  it("rejects request-body authority and gate claims", () => {
    const result = commerceHireRequestSchema.safeParse({
      idempotencyKey: "hire-authority-boundary",
      commerceJobId: "00000000-0000-4000-8000-000000000007",
      providerAddress: PROVIDER,
      task: "health factor",
      budgetAtomic: "1000",
      providerBinding,
      requesterAddress: PROVIDER,
      authority: { wallet: { address: PROVIDER } },
      standardsLock: { enabled: true },
      developmentCanaryEnabled: true
    });

    expect(result.success).toBe(false);
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
