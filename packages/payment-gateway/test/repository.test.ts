import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryPaymentRepository,
  b402PaymentPinSchema,
  challengeUnsignedDigest,
  paymentAuthorizationDigest,
  paymentAttemptSchema,
  paymentReceiptSchema,
  type PaymentAttempt,
  type PaymentReceipt
} from "../src/index.js";

const PIN = b402PaymentPinSchema.parse({
  rail: "x402_b402",
  settlementNetwork: 97,
  settlementAsset: "0x2222222222222222222222222222222222222222",
  settlementDecimals: 18,
  amountAtomic: "1000",
  recipient: "0x3333333333333333333333333333333333333333",
  method: "permit2_exact",
  destination: "https://agent.example.test/x402",
  facilitatorEndpoint: "https://facilitator.example.test/v1",
  maxChallengeLifetimeSeconds: 300
});

const unsignedChallenge = {
  challengeId: "challenge-repo-1",
  rail: "x402_b402" as const,
  version: "b402-v1",
  settlementNetwork: 97 as const,
  settlementAsset: PIN.settlementAsset,
  settlementDecimals: PIN.settlementDecimals,
  amountAtomic: PIN.amountAtomic,
  recipient: PIN.recipient,
  method: PIN.method,
  destination: PIN.destination,
  facilitatorEndpoint: PIN.facilitatorEndpoint,
  nonce: "nonce-repo-0001",
  issuedAtUnix: 2_000_000,
  expiresAtUnix: 2_000_120
};
const challenge = { ...unsignedChallenge, challengeDigest: challengeUnsignedDigest(unsignedChallenge) };
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000011";
const AUTHORIZATION = {
  attemptId: ATTEMPT_ID,
  challengeId: challenge.challengeId,
  challengeDigest: challenge.challengeDigest,
  payerAddress: "0x6666666666666666666666666666666666666666" as const,
  credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  authorizedAtUnix: 2_000_010
};
const ATTEMPT: PaymentAttempt = paymentAttemptSchema.parse({
  attemptId: ATTEMPT_ID,
  rail: "x402_b402",
  requestId: "request-repo-1",
  idempotencyKey: "attempt-repo-1",
  challenge,
  challengeDigest: challenge.challengeDigest,
  authorizationDigest: null,
  payerAddress: null,
  pin: PIN,
  status: "challenged",
  relayRequestDigest: null,
  receiptId: null,
  failureCode: null,
  sanitizedFailure: null,
  createdAtUnix: 2_000_000,
  updatedAtUnix: 2_000_000
});

describe("payment repository idempotency and reconciliation", () => {
  it("persists one canonical challenge and rejects digest reuse", async () => {
    const repository = new InMemoryPaymentRepository();
    expect((await repository.saveChallenge(challenge)).replayed).toBe(false);
    expect((await repository.saveChallenge(challenge)).replayed).toBe(true);
    expect((await repository.getChallenge(challenge.challengeId))?.challengeDigest).toBe(challenge.challengeDigest);
    await expect(repository.saveChallenge({ ...challenge, challengeId: "challenge-repo-2" })).rejects.toThrow(/digest/i);
  });

  it("replays an identical attempt and detects conflicting idempotency", async () => {
    const repository = new InMemoryPaymentRepository();
    const first = await repository.create({ attempt: ATTEMPT });
    const replay = await repository.create({ attempt: ATTEMPT });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(repository.create({ attempt: { ...ATTEMPT, requestId: "request-repo-2" } })).rejects.toThrow(/idempotency/i);
    await expect(repository.create({ attempt: { ...ATTEMPT, attemptId: "00000000-0000-4000-8000-000000000012", idempotencyKey: "attempt-repo-2" } })).rejects.toThrow(/challenge/i);
  });

  it("does not apply a stale transition and replays the same successful action", async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.create({ attempt: ATTEMPT });
    const authorizationDigest = paymentAuthorizationDigest(AUTHORIZATION);
    const transition = { attemptId: ATTEMPT_ID, expectedStatus: "challenged" as const, nextStatus: "authorized" as const, idempotencyKey: "authorize-repo-1", correlationId: "corr-repo-1", nowUnix: 2_000_010, metadata: { authorizationDigest, payerAddress: AUTHORIZATION.payerAddress } };
    const first = await repository.transition(transition);
    const replay = await repository.transition(transition);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(repository.transition({ attemptId: ATTEMPT_ID, expectedStatus: "challenged", nextStatus: "relay_pending", idempotencyKey: "relay-repo-1", correlationId: "corr-repo-1", nowUnix: 2_000_011 })).rejects.toThrow(/status/i);
  });

  it("deduplicates receipts and resolves an ambiguous receipt after settlement", async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.create({ attempt: ATTEMPT });
    const receipt: PaymentReceipt = paymentReceiptSchema.parse({
      receiptId: randomUUID(),
      attemptId: ATTEMPT_ID,
      challengeId: challenge.challengeId,
      rail: "x402_b402",
      status: "unknown",
      settlementNetwork: PIN.settlementNetwork,
      settlementAsset: PIN.settlementAsset,
      settlementDecimals: PIN.settlementDecimals,
      amountAtomic: PIN.amountAtomic,
      expectedRecipient: PIN.recipient,
      actualRecipient: null,
      method: PIN.method,
      destination: PIN.destination,
      paymentTransactionHash: null,
      settlementTransactionHash: null,
      payoutAddress: null,
      payoutVerified: false,
      facilitatorRequestReference: "facilitator-repo-1",
      responseStatus: null,
      responseDigest: null,
      observedAtUnix: 2_000_020,
      settledAtUnix: null
    });
    expect((await repository.saveReceipt(receipt)).replayed).toBe(false);
    expect((await repository.saveReceipt(receipt)).replayed).toBe(true);
    const settled = paymentReceiptSchema.parse({
      ...receipt,
      receiptId: "00000000-0000-4000-8000-000000000099",
      status: "settled",
      actualRecipient: PIN.recipient,
      paymentTransactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payoutAddress: PIN.recipient,
      payoutVerified: true,
      responseStatus: 200,
      responseDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      observedAtUnix: 2_000_021,
      settledAtUnix: 2_000_021
    });
    expect((await repository.recordSettlement(settled)).replayed).toBe(false);
    expect((await repository.getReceiptByAttempt(ATTEMPT_ID))?.status).toBe("settled");
    expect((await repository.recordSettlement(settled)).replayed).toBe(true);
    expect((await repository.getReceiptByAttempt(ATTEMPT_ID))?.receiptId).toBe(settled.receiptId);
    expect((await repository.getSettlementByAttempt(ATTEMPT_ID))?.receiptId).toBe(settled.receiptId);
    await expect(repository.recordSettlement(receipt)).rejects.toThrow(/receipt/i);
    await expect(repository.saveReceipt({ ...receipt, responseDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).rejects.toThrow(/receipt/i);
  });

  it("keeps reconciliation records due and increments attempts", async () => {
    const repository = new InMemoryPaymentRepository();
    await repository.create({ attempt: ATTEMPT });
    const record = await repository.enqueue({ attemptId: ATTEMPT_ID, reasonCode: "UNKNOWN_POST_PAYMENT_OUTCOME", nextAttemptAtUnix: null, observedPaymentTransactionHash: null, observedSettlementTransactionHash: null, detailDigest: null, nowUnix: 2_000_030 });
    expect((await repository.listDue(2_000_031)).length).toBe(1);
    const updated = await repository.update({ reconciliationId: record.reconciliationId, state: "in_progress", nextAttemptAtUnix: 2_000_100, nowUnix: 2_000_040 });
    expect(updated.attemptCount).toBe(1);
    expect((await repository.listDue(2_000_041)).length).toBe(0);
  });
});
