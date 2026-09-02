import { describe, expect, it } from "vitest";
import {
  CommerceError,
  assertErc8183Transition,
  createErc8183JobEvent,
  erc8183DeploymentPinDigest,
  erc8183JobRecordSchema,
  parseEnabledDeploymentPin,
  quoteDigest,
  validateJobTerms,
  validateQuote,
  type EnabledErc8183DeploymentPin,
  type Erc8183JobRecord
} from "../src/index.js";

const PIN: EnabledErc8183DeploymentPin = {
  enabled: true,
  chainId: 97,
  specRevision: "erc-8183-test-revision",
  commerceContract: "0x1111111111111111111111111111111111111111",
  paymentToken: "0x2222222222222222222222222222222222222222",
  paymentDecimals: 18,
  abiHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  evaluatorProfile: "verified-policy-v1",
  confirmationThreshold: 3,
  minExpiryLeadSeconds: 60,
  maxExpiryHorizonSeconds: 86_400,
  minBudgetAtomic: "1",
  maxBudgetAtomic: "100000000000000000000"
};

const TERMS = {
  chainId: 97 as const,
  commerceContract: PIN.commerceContract,
  paymentToken: PIN.paymentToken,
  paymentDecimals: 18,
  clientAddress: "0x3333333333333333333333333333333333333333",
  providerAddress: "0x4444444444444444444444444444444444444444",
  evaluatorAddress: "0x5555555555555555555555555555555555555555",
  hookAddress: null,
  budgetAtomic: "1000",
  descriptionDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  expiresAtUnix: 1_000_600
};

const JOB: Erc8183JobRecord = erc8183JobRecordSchema.parse({
  jobKey: { chainId: 97, commerceContract: PIN.commerceContract, jobId: "7" },
  terms: TERMS,
  deploymentPin: PIN,
  deploymentPinDigest: erc8183DeploymentPinDigest(PIN),
  state: "open",
  createdAtUnix: 1_000_000,
  updatedAtUnix: 1_000_000,
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

describe("ERC-8183 boundary validation", () => {
  it("rejects a disabled or incomplete standards pin", () => {
    expect(() => parseEnabledDeploymentPin({ enabled: false, chainId: 97, disabledReason: "address not verified" })).toThrowError(CommerceError);
    expect(() => parseEnabledDeploymentPin({ enabled: true, chainId: 97 })).toThrowError(CommerceError);
  });

  it("validates a job against chain, contract, token, budget, and expiry pins", () => {
    expect(validateJobTerms(TERMS, PIN, 1_000_000).budgetAtomic).toBe("1000");
    expect(() => validateJobTerms({ ...TERMS, chainId: 56 }, PIN, 1_000_000)).toThrow(/chain/i);
    expect(() => validateJobTerms({ ...TERMS, paymentToken: "0x6666666666666666666666666666666666666666" }, PIN, 1_000_000)).toThrow(/token/i);
    expect(() => validateJobTerms({ ...TERMS, budgetAtomic: "0" }, PIN, 1_000_000)).toThrow(/range/i);
    expect(() => validateJobTerms({ ...TERMS, expiresAtUnix: 1_000_010 }, PIN, 1_000_000)).toThrow(/lead/i);
  });

  it("keeps quote digest deterministic and rejects an expired quote", () => {
    const quote = validateQuote({
      quoteId: "quote-7",
      jobKey: JOB.jobKey,
      chainId: 97,
      commerceContract: PIN.commerceContract,
      paymentToken: PIN.paymentToken,
      paymentDecimals: 18,
      providerAddress: TERMS.providerAddress,
      descriptionDigest: TERMS.descriptionDigest,
      minPriceAtomic: "100",
      maxPriceAtomic: "2000",
      priceAtomic: "1000",
      issuedAtUnix: 1_000_000,
      expiresAtUnix: 1_000_300,
      idempotencyKey: "quote-7-v1"
    }, PIN, 1_000_100);
    expect(quoteDigest(quote)).toHaveLength(64);
    expect(() => validateQuote({ ...quote, expiresAtUnix: 1_000_101 }, PIN, 1_000_101)).toThrow(/expired/i);
  });

  it("does not allow public commerce event payloads to carry credentials", () => {
    expect(() => createErc8183JobEvent({
      eventKey: "event-7",
      jobKey: JOB.jobKey,
      eventType: "job_submitted",
      previousState: "funded",
      nextState: "submitted",
      actorAddress: TERMS.providerAddress,
      correlationId: "corr-7",
      observedAtUnix: 1_000_100,
      payload: { privateKey: "never" }
    })).toThrow(/sensitive/i);
  });

  it("requires evaluator authority for completion and expiry for refunds", () => {
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "funded", action: "fund", actorAddress: TERMS.providerAddress!, nowUnix: 1_000_000 })).toThrow(/authorized/i);
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "funded", action: "fund", actorAddress: TERMS.clientAddress, nowUnix: 1_000_000 })).not.toThrow();
    const funded = { ...JOB, state: "funded" as const };
    const submitted = { ...funded, state: "submitted" as const };
    expect(() => assertErc8183Transition({ job: submitted, deploymentPin: PIN, nextState: "completed", action: "complete", actorAddress: TERMS.providerAddress!, nowUnix: 1_000_100 })).toThrow(/authorized/i);
    expect(() => assertErc8183Transition({ job: submitted, deploymentPin: PIN, nextState: "expired", action: "claim_refund", actorAddress: TERMS.providerAddress!, nowUnix: TERMS.expiresAtUnix })).toThrow(/authorized/i);
    expect(() => assertErc8183Transition({ job: submitted, deploymentPin: PIN, nextState: "expired", action: "claim_refund", actorAddress: TERMS.clientAddress, nowUnix: TERMS.expiresAtUnix })).not.toThrow();
  });

  it("rejects active protocol actions at or after the trusted job expiry", () => {
    const atExpiry = TERMS.expiresAtUnix;
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "funded", action: "fund", actorAddress: TERMS.clientAddress, nowUnix: atExpiry })).toThrow(/active job expiry/i);
    expect(() => assertErc8183Transition({ job: { ...JOB, state: "funded" }, deploymentPin: PIN, nextState: "submitted", action: "submit", actorAddress: TERMS.providerAddress!, nowUnix: atExpiry })).toThrow(/active job expiry/i);
    expect(() => assertErc8183Transition({ job: { ...JOB, state: "submitted" }, deploymentPin: PIN, nextState: "completed", action: "complete", actorAddress: TERMS.evaluatorAddress, nowUnix: atExpiry })).toThrow(/active job expiry/i);
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "rejected", action: "reject", actorAddress: TERMS.clientAddress, nowUnix: atExpiry })).toThrow(/active job expiry/i);
  });

  it("requires an authenticated configured reconciler for a same-state reconcile", () => {
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "open", action: "reconcile", actorAddress: TERMS.evaluatorAddress, nowUnix: 1_000_100 })).toThrow(/reconciler|authorized/i);
    expect(() => assertErc8183Transition({ job: JOB, deploymentPin: PIN, nextState: "open", action: "reconcile", actorAddress: TERMS.evaluatorAddress, nowUnix: 1_000_100, reconcilerAddresses: [TERMS.evaluatorAddress] })).not.toThrow();
  });
});
