import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryPaymentRepository,
  b402PaymentPinSchema,
  b402SellerConfigurationDigest,
  challengeUnsignedDigest,
  createPaymentEvent,
  paymentAttemptSchema,
  paymentPinDigest,
  paymentReceiptSchema,
  validateAuthorization,
  validateSellerConfiguration,
  type PaymentAttempt,
  type PaymentReceipt
} from "../src/index.js";

const SELLER_CONFIGURATION = {
  enabled: true as const,
  merchantEnvironment: "testnet",
  merchantAccountReference: "merchant-repo-1",
  merchantCredentialReference: "secret://merchant-repo-1",
  facilitatorEndpoint: "https://facilitator.example.test/v1",
  settlementNetwork: 97 as const,
  settlementAsset: "0x2222222222222222222222222222222222222222",
  settlementDecimals: 18,
  payoutAddress: "0x3333333333333333333333333333333333333333",
  payoutVerificationState: "verified" as const,
  fixedEgressProfile: "b402-egress-repo-1",
  publicX402Url: "https://agent.example.test/x402",
  agentCoreRelayAuthenticationReference: "secret://relay-repo-1",
  priceUsd: "0.01",
  configurationVersion: 1,
  canaryStatus: "passed" as const
};

const PIN = b402PaymentPinSchema.parse({
  enabled: true,
  requestId: "request-repo-1",
  configurationVersion: SELLER_CONFIGURATION.configurationVersion,
  configurationDigest: b402SellerConfigurationDigest(validateSellerConfiguration(SELLER_CONFIGURATION)),
  rail: "x402_b402",
  settlementNetwork: 97,
  settlementAsset: "0x2222222222222222222222222222222222222222",
  settlementDecimals: 18,
  amountAtomic: "1000",
  recipient: "0x3333333333333333333333333333333333333333",
  method: "permit2_exact",
  destination: "https://agent.example.test/x402",
  facilitatorEndpoint: "https://facilitator.example.test/v1",
  fixedEgressProfile: "b402-egress-repo-1",
  payoutAddress: "0x3333333333333333333333333333333333333333",
  payoutVerificationState: "verified",
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
  pinDigest: paymentPinDigest(PIN),
  status: "challenged",
  relayRequestDigest: null,
  failureCode: null,
  sanitizedFailure: null,
  createdAtUnix: 2_000_000,
  updatedAtUnix: 2_000_000
});

describe("payment repository idempotency and reconciliation", () => {
  it("requires an enabled canary-passed seller configuration at repository construction", () => {
    expect(() => new InMemoryPaymentRepository({
      ...SELLER_CONFIGURATION,
      enabled: false,
      merchantCredentialReference: null,
      agentCoreRelayAuthenticationReference: null
    })).toThrow(/disabled/i);
  });

  it("persists one canonical challenge and rejects digest reuse", async () => {
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010 });
    expect((await repository.saveChallenge(challenge)).replayed).toBe(false);
    expect((await repository.saveChallenge(challenge)).replayed).toBe(true);
    expect((await repository.getChallenge(challenge.challengeId))?.challengeDigest).toBe(challenge.challengeDigest);
    await expect(repository.saveChallenge({ ...challenge, challengeId: "challenge-repo-2" })).rejects.toThrow(/digest/i);
  });

  it("replays an identical attempt and detects conflicting idempotency", async () => {
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010 });
    const first = await repository.create({ attempt: ATTEMPT });
    const replay = await repository.create({ attempt: ATTEMPT });
    expect(first.replayed).toBe(false);
    expect(first.attempt.createdAtUnix).toBe(2_000_010);
    expect(first.attempt.updatedAtUnix).toBe(2_000_010);
    expect(replay.replayed).toBe(true);
    expect((await repository.create({ attempt: { ...ATTEMPT, createdAtUnix: 123, updatedAtUnix: 456 } })).replayed).toBe(true);
    await expect(repository.create({ attempt: { ...ATTEMPT, failureCode: "conflict" } })).rejects.toThrow(/idempotency/i);
    await expect(repository.create({ attempt: { ...ATTEMPT, attemptId: "00000000-0000-4000-8000-000000000012", idempotencyKey: "attempt-repo-2" } })).rejects.toThrow(/challenge/i);
  });

  it("does not apply a stale transition and replays the same successful action", async () => {
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010 });
    await repository.create({ attempt: ATTEMPT });
    const authorization = validateAuthorization(AUTHORIZATION, challenge, PIN, 2_000_010);
    const transition = { attemptId: ATTEMPT_ID, expectedStatus: "challenged" as const, nextStatus: "authorized" as const, idempotencyKey: "authorize-repo-1", correlationId: "corr-repo-1", nowUnix: 2_000_010, metadata: { authorization } };
    const first = await repository.transition(transition);
    const replay = await repository.transition(transition);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    await expect(repository.transition({ attemptId: ATTEMPT_ID, expectedStatus: "challenged", nextStatus: "relay_pending", idempotencyKey: "relay-repo-1", correlationId: "corr-repo-1", nowUnix: 2_000_011 })).rejects.toThrow(/status/i);
  });

  it("does not permit an unvalidated event append and rolls back an event conflict", async () => {
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010 });
    await repository.create({ attempt: ATTEMPT });
    const authorization = validateAuthorization(AUTHORIZATION, challenge, PIN, 2_000_010);
    await expect(repository.appendEvent({
      eventId: randomUUID(),
      eventKey: "action:authorize-atomic",
      attemptId: ATTEMPT_ID,
      eventType: "payment_rejected",
      previousStatus: "challenged",
      nextStatus: "rejected",
      paymentTransactionHash: null,
      settlementTransactionHash: null,
      payloadDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payload: {},
      correlationId: "corr-atomic",
      observedAtUnix: 2_000_010
    })).rejects.toThrow(/validated|event key/i);
    const authorized = await repository.transition({
      attemptId: ATTEMPT_ID,
      expectedStatus: "challenged",
      nextStatus: "authorized",
      idempotencyKey: "authorize-atomic",
      correlationId: "corr-atomic",
      nowUnix: 2_000_010,
       metadata: { authorization }
    });
    await expect(repository.transaction(async (unit) => unit.commit({
      actionKey: "authorize-atomic",
      actionDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedAttempt: authorized.attempt,
      attempt: authorized.attempt,
      event: { ...authorized.event, eventType: "payment_rejected", nextStatus: "rejected" }
    }))).rejects.toThrow(/event key/i);
    expect((await repository.get(ATTEMPT_ID))?.status).toBe("authorized");
    await expect(repository.appendEvent(createPaymentEvent({
      eventKey: "unknown-attempt-event",
      attemptId: "00000000-0000-4000-8000-000000000099",
      eventType: "payment_rejected",
      previousStatus: "challenged",
      nextStatus: "rejected",
      correlationId: "corr-unknown",
      observedAtUnix: 2_000_010
    }))).rejects.toThrow(/unknown attempt/i);
  });

  it("deduplicates receipts and resolves an ambiguous receipt after settlement", async () => {
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010 });
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
    await expect(repository.transaction(async (unit) => {
      await unit.saveReceipt(receipt);
      throw new Error("rollback-receipt");
    })).rejects.toThrow("rollback-receipt");
    expect(await repository.getReceiptByAttempt(ATTEMPT_ID)).toBeNull();
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
    const reconcilerAddress = "0x9999999999999999999999999999999999999999";
    const repository = new InMemoryPaymentRepository(SELLER_CONFIGURATION, { nowUnix: () => 2_000_010, reconcilerAddresses: [reconcilerAddress] });
    await repository.create({ attempt: ATTEMPT });
    const record = await repository.enqueue({ attemptId: ATTEMPT_ID, reasonCode: "UNKNOWN_POST_PAYMENT_OUTCOME", nextAttemptAtUnix: null, observedPaymentTransactionHash: null, observedSettlementTransactionHash: null, detailDigest: null, nowUnix: 2_000_030 });
    expect((await repository.listDue(2_000_031)).length).toBe(1);
    await expect(repository.update({ reconciliationId: record.reconciliationId, state: "in_progress", nextAttemptAtUnix: 2_000_100, nowUnix: 2_000_040, reconcilerAddress: "0x8888888888888888888888888888888888888888" })).rejects.toThrow(/reconciler|authorized/i);
    const updated = await repository.update({ reconciliationId: record.reconciliationId, state: "in_progress", nextAttemptAtUnix: 2_000_100, nowUnix: 2_000_040, reconcilerAddress });
    expect(updated.attemptCount).toBe(1);
    expect((await repository.listDue(2_000_041)).length).toBe(0);
  });
});
