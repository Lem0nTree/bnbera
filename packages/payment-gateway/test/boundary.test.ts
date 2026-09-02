import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PaymentError,
  InMemoryPaymentReplayStore,
  assertPaymentTransition,
  b402PaymentPinSchema,
  b402SellerConfigurationDigest,
  challengeUnsignedDigest,
  classifyRelayTimeout,
  paymentAuthorizationDigest,
  paymentAttemptSchema,
  paymentPinDigest,
  paymentReplayKey,
  paymentReceiptSchema,
  createPaymentEvent,
  parseEnabledSellerConfiguration,
  transitionPaymentAttempt,
  validateAuthorization,
  validateChallenge,
  validateRelayRequest,
  validateReceipt,
  validatePaymentPinAgainstSellerConfiguration,
  validateSellerConfiguration,
  type B402PaymentPin,
  type PaymentAttempt,
  type PaymentChallenge,
  type PaymentReceipt
} from "../src/index.js";
import { canonicalSha256Hex } from "@bnbera/domain";

const SELLER_CONFIGURATION = {
  enabled: true as const,
  merchantEnvironment: "testnet",
  merchantAccountReference: "merchant-1",
  merchantCredentialReference: "secret://merchant-1",
  facilitatorEndpoint: "https://facilitator.example.test/v1",
  settlementNetwork: 97 as const,
  settlementAsset: "0x2222222222222222222222222222222222222222",
  settlementDecimals: 18,
  payoutAddress: "0x3333333333333333333333333333333333333333",
  payoutVerificationState: "verified" as const,
  fixedEgressProfile: "b402-egress-1",
  publicX402Url: "https://agent.example.test/x402",
  agentCoreRelayAuthenticationReference: "secret://relay-1",
  priceUsd: "0.01",
  configurationVersion: 1,
  canaryStatus: "passed" as const
};

const PIN: B402PaymentPin = b402PaymentPinSchema.parse({
  enabled: true,
  requestId: "request-1",
  configurationVersion: SELLER_CONFIGURATION.configurationVersion,
  configurationDigest: b402SellerConfigurationDigest(validateSellerConfiguration(SELLER_CONFIGURATION)),
  rail: "x402_b402",
  settlementNetwork: 97,
  settlementAsset: "0x2222222222222222222222222222222222222222",
  settlementDecimals: 18,
  amountAtomic: "1000",
  recipient: "0x3333333333333333333333333333333333333333",
  method: "eip3009",
  destination: "https://agent.example.test/x402",
  facilitatorEndpoint: "https://facilitator.example.test/v1",
  fixedEgressProfile: "b402-egress-1",
  payoutAddress: "0x3333333333333333333333333333333333333333",
  payoutVerificationState: "verified",
  maxChallengeLifetimeSeconds: 300
});

function challenge(): PaymentChallenge {
  const unsigned = {
    challengeId: "challenge-1",
    rail: "x402_b402" as const,
    version: "b402-v1",
    settlementNetwork: 97 as const,
    settlementAsset: PIN.settlementAsset,
    settlementDecimals: 18,
    amountAtomic: "1000",
    recipient: PIN.recipient,
    method: "eip3009" as const,
    destination: PIN.destination,
    facilitatorEndpoint: PIN.facilitatorEndpoint,
    nonce: "nonce-00000001",
    issuedAtUnix: 1_000_000,
    expiresAtUnix: 1_000_120
  };
  return { ...unsigned, challengeDigest: challengeUnsignedDigest(unsigned) };
}

const ATTEMPT_ID = "00000000-0000-4000-8000-000000000001";

function attempt(): PaymentAttempt {
  const current = challenge();
  return {
    attemptId: ATTEMPT_ID,
    rail: "x402_b402",
    requestId: "request-1",
    idempotencyKey: "attempt-1",
    challenge: current,
    challengeDigest: current.challengeDigest,
    authorizationDigest: null,
    payerAddress: null,
    pin: PIN,
    pinDigest: paymentPinDigest(PIN),
    status: "challenged",
    relayRequestDigest: null,
    failureCode: null,
    sanitizedFailure: null,
    createdAtUnix: 1_000_000,
    updatedAtUnix: 1_000_000
  };
}

describe("B402/X402 boundary validation", () => {
  it("keeps hosted B402 disabled until a complete canary and payout check pass", () => {
    const base = {
      enabled: true,
      merchantEnvironment: "testnet",
      merchantAccountReference: "merchant-1",
      merchantCredentialReference: "secret://merchant-1",
      facilitatorEndpoint: PIN.facilitatorEndpoint,
      settlementNetwork: 97 as const,
      settlementAsset: PIN.settlementAsset,
      settlementDecimals: 18,
      payoutAddress: PIN.recipient,
      payoutVerificationState: "verified" as const,
      fixedEgressProfile: "b402-egress-1",
      publicX402Url: PIN.destination,
      agentCoreRelayAuthenticationReference: "secret://relay-1",
      priceUsd: "0.01",
      configurationVersion: 1,
      canaryStatus: "not_run" as const
    };
    expect(() => validateSellerConfiguration(base)).toThrowError(PaymentError);
    expect(() => validateSellerConfiguration({ ...base, canaryStatus: "passed" })).not.toThrow();
    expect(() => parseEnabledSellerConfiguration({ ...base, enabled: false, merchantCredentialReference: null, agentCoreRelayAuthenticationReference: null })).toThrow(/disabled/i);
    expect(validatePaymentPinAgainstSellerConfiguration(PIN, SELLER_CONFIGURATION).pin.fixedEgressProfile).toBe(PIN.fixedEgressProfile);
    expect(() => validatePaymentPinAgainstSellerConfiguration({ ...PIN, fixedEgressProfile: "untrusted-egress" }, SELLER_CONFIGURATION)).toThrow(/egress/i);
  });

  it("requires challenge terms and digest to match independent pins", () => {
    expect(validateChallenge(challenge(), PIN, 1_000_030).recipient).toBe(PIN.recipient.toLowerCase());
    expect(() => validateChallenge({ ...challenge(), settlementNetwork: 56 }, PIN, 1_000_030)).toThrow(/digest|network/i);
    expect(() => validateChallenge({ ...challenge(), settlementAsset: "0x4444444444444444444444444444444444444444" }, PIN, 1_000_030)).toThrow(/digest|asset/i);
    expect(() => validateChallenge({ ...challenge(), amountAtomic: "1001" }, PIN, 1_000_030)).toThrow(/digest|amount/i);
    expect(() => validateChallenge({ ...challenge(), recipient: "0x5555555555555555555555555555555555555555" }, PIN, 1_000_030)).toThrow(/digest|recipient/i);
    expect(() => validateChallenge({ ...challenge(), expiresAtUnix: 1_000_400 }, PIN, 1_000_030)).toThrow(/digest|lifetime/i);
    expect(() => validateChallenge({ ...challenge(), challengeDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0" }, PIN, 1_000_030)).toThrow(/digest/i);
    expect(() => validateChallenge(challenge(), PIN, 1_000_121)).toThrow(/expired/i);
  });

  it("binds authorization and relay input to the exact challenge", () => {
    const current = challenge();
    const authorization = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: current.challengeId,
      challengeDigest: current.challengeDigest,
      payerAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, current, PIN, 1_000_040);
    expect(paymentAuthorizationDigest(authorization)).toHaveLength(64);
    expect(() => validateAuthorization({ ...authorization, challengeId: "challenge-2" }, current, PIN, 1_000_040)).toThrow(/challenge/i);
    expect(() => validateAuthorization(authorization, current, PIN, current.expiresAtUnix)).toThrow(/expired/i);
    expect(() => transitionPaymentAttempt({
      attempt: attempt(),
      sellerConfiguration: SELLER_CONFIGURATION,
      nextStatus: "authorized",
      nowUnix: current.expiresAtUnix,
      idempotencyKey: "authorize-expired",
      correlationId: "corr-expired",
      metadata: { authorization }
    })).toThrow(/expired/i);
    const relay = validateRelayRequest({
      attemptId: ATTEMPT_ID,
      requestId: PIN.requestId,
      idempotencyKey: "relay-request-1",
      destination: PIN.destination,
      method: PIN.method,
      requestBody: { prompt: "hello" },
      authorizationDigest: paymentAuthorizationDigest(authorization),
      requestDigest: canonicalSha256Hex({ prompt: "hello" }),
      fixedEgressProfile: PIN.fixedEgressProfile,
      timeoutMs: 10_000
    }, ATTEMPT_ID, authorization, PIN, current, 1_000_040);
    expect(relay.fixedEgressProfile).toBe(PIN.fixedEgressProfile);
    expect(() => validateRelayRequest({
      attemptId: ATTEMPT_ID,
      requestId: PIN.requestId,
      idempotencyKey: "relay-request-expired",
      destination: PIN.destination,
      method: PIN.method,
      requestBody: { prompt: "hello" },
      authorizationDigest: paymentAuthorizationDigest(authorization),
      requestDigest: canonicalSha256Hex({ prompt: "hello" }),
      fixedEgressProfile: PIN.fixedEgressProfile,
      timeoutMs: 10_000
    }, ATTEMPT_ID, authorization, PIN, current, current.expiresAtUnix)).toThrow(/expired/i);
    expect(() => validateRelayRequest({
      attemptId: ATTEMPT_ID,
      requestId: "request-other",
      idempotencyKey: "relay-request-2",
      destination: PIN.destination,
      method: PIN.method,
       requestBody: { prompt: "hello" },
       authorizationDigest: paymentAuthorizationDigest(authorization),
       requestDigest: canonicalSha256Hex({ prompt: "hello" }),
      fixedEgressProfile: PIN.fixedEgressProfile,
      timeoutMs: 10_000
    }, ATTEMPT_ID, authorization, PIN, current, 1_000_040)).toThrow(/correlation/i);
  });

  it("requires a verified, recipient-matching receipt before delivery", () => {
    const current = challenge();
    const base: PaymentReceipt = paymentReceiptSchema.parse({
      receiptId: randomUUID(),
      attemptId: ATTEMPT_ID,
      challengeId: current.challengeId,
      rail: "x402_b402",
      status: "settled",
      settlementNetwork: 97,
      settlementAsset: PIN.settlementAsset,
      settlementDecimals: 18,
      amountAtomic: PIN.amountAtomic,
      expectedRecipient: PIN.recipient,
      actualRecipient: PIN.recipient,
      method: PIN.method,
      destination: PIN.destination,
      paymentTransactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      settlementTransactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      payoutAddress: PIN.recipient,
      payoutVerified: true,
      facilitatorRequestReference: "facilitator-request-1",
      responseStatus: 200,
      responseDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      observedAtUnix: 1_000_060,
      settledAtUnix: 1_000_060
    });
    expect(validateReceipt(base, PIN, ATTEMPT_ID, current.challengeId).status).toBe("settled");
    expect(() => validateReceipt({ ...base, actualRecipient: "0x7777777777777777777777777777777777777777" }, PIN, ATTEMPT_ID, current.challengeId)).toThrow(/recipient/i);
    expect(() => validateReceipt({ ...base, payoutVerified: false }, PIN, ATTEMPT_ID, current.challengeId)).toThrow(/payout/i);
  });

  it("keeps receipt ownership on receipt.attemptId without an attempt backlink", () => {
    expect(() => paymentAttemptSchema.parse({ ...attempt(), receiptId: randomUUID() })).toThrow(/receiptId|unrecognized/i);
    expect(paymentReceiptSchema.parse({
      receiptId: randomUUID(),
      attemptId: ATTEMPT_ID,
      challengeId: challenge().challengeId,
      rail: "x402_b402",
      status: "unknown",
      settlementNetwork: 97,
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
      facilitatorRequestReference: null,
      responseStatus: null,
      responseDigest: null,
      observedAtUnix: 1_000_060,
      settledAtUnix: null
    }).attemptId).toBe(ATTEMPT_ID);
  });

  it("makes replay reservation terminal and never silently reuses it", () => {
    const initial = attempt();
    const authorization = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: initial.challenge.challengeId,
      challengeDigest: initial.challenge.challengeDigest,
      payerAddress: "0x6666666666666666666666666666666666666666",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, initial.challenge, PIN, 1_000_040);
    const store = new InMemoryPaymentReplayStore();
    expect(store.reserve({ attempt: initial, authorization, expiresAtUnix: initial.challenge.expiresAtUnix, nowUnix: 1_000_040 }).state).toBe("inflight");
    store.markConsumed({ attempt: initial, authorization, responseDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", nowUnix: 1_000_050 });
    expect(() => store.reserve({ attempt: initial, authorization, expiresAtUnix: initial.challenge.expiresAtUnix, nowUnix: 1_000_051 })).toThrow(/replay/i);
  });

  it("uses one canonical replay reservation for case variants at lookup and CAS boundaries", () => {
    const initial = attempt();
    const authorization = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: initial.challenge.challengeId,
      challengeDigest: initial.challenge.challengeDigest,
      payerAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, initial.challenge, PIN, 1_000_040);
    const authorizationVariant = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: initial.challenge.challengeId,
      challengeDigest: initial.challenge.challengeDigest,
      payerAddress: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, initial.challenge, PIN, 1_000_040);
    const key = paymentReplayKey(initial, authorization);
    const store = new InMemoryPaymentReplayStore();
    const first = store.reserve({ attempt: initial, authorization, expiresAtUnix: initial.challenge.expiresAtUnix, nowUnix: 1_000_040 });
    expect(store.reserve({ attempt: initial, authorization: authorizationVariant, expiresAtUnix: initial.challenge.expiresAtUnix, nowUnix: 1_000_041 })).toEqual(first);
    expect(store.get({ attempt: initial, authorization: authorizationVariant })?.replayKey).toBe(key);
    const consumed = store.markConsumed({ attempt: initial, authorization: authorizationVariant, responseDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", nowUnix: 1_000_050 });
    expect(store.get({ attempt: initial, authorization })?.state).toBe("consumed");
    expect(consumed.replayKey).toBe(key);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(() => store.markConsumed({ attempt: initial, authorization, responseDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", nowUnix: 1_000_051 })).toThrow(/digest/i);
  });

  it("rejects credential-shaped fields from public payment events", () => {
    expect(() => createPaymentEvent({
      eventKey: "event-sensitive-1",
      attemptId: ATTEMPT_ID,
      eventType: "payment_authorized",
      previousStatus: "challenged",
      nextStatus: "authorized",
      correlationId: "corr-sensitive-1",
      observedAtUnix: 1_000_040,
      payload: { secret: "never", nested: { credential: "never" } }
    })).toThrow(/sensitive/i);
  });

  it("blocks relay retry after an unknown post-payment outcome until reconciliation", () => {
    const initial = attempt();
    const authorization = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: initial.challenge.challengeId,
      challengeDigest: initial.challenge.challengeDigest,
      payerAddress: "0x6666666666666666666666666666666666666666",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, initial.challenge, PIN, 1_000_040);
    const authorized = transitionPaymentAttempt({
      attempt: initial,
      sellerConfiguration: SELLER_CONFIGURATION,
      nextStatus: "authorized",
      nowUnix: 1_000_040,
      idempotencyKey: "authorize-1",
      correlationId: "corr-1",
      metadata: { authorization }
    }).attempt;
    const pending = transitionPaymentAttempt({ attempt: authorized, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "relay_pending", nowUnix: 1_000_041, idempotencyKey: "relay-1", correlationId: "corr-1" }).attempt;
    const unknown = transitionPaymentAttempt({ attempt: pending, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "unknown", nowUnix: 1_000_050, idempotencyKey: "unknown-1", correlationId: "corr-1" }).attempt;
    expect(() => assertPaymentTransition({ attempt: unknown, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "settlement_pending", nowUnix: 1_000_060 })).toThrow(/reconciled/i);
    const reconcilerAddress = "0x9999999999999999999999999999999999999999";
    expect(() => transitionPaymentAttempt({ attempt: unknown, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "settlement_pending", nowUnix: 1_000_070, idempotencyKey: "reconcile-unauthenticated", correlationId: "corr-1", metadata: { reconciliationConfirmed: true } })).toThrow(/authenticated|reconciler/i);
    const reconciled = transitionPaymentAttempt({ attempt: unknown, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "settlement_pending", nowUnix: 1_000_070, idempotencyKey: "reconcile-1", correlationId: "corr-1", reconcilerAddresses: [reconcilerAddress], metadata: { reconciliationConfirmed: true, reconcilerAddress } }).attempt;
    expect(reconciled.status).toBe("settlement_pending");
  });

  it("classifies relay timeouts without authorizing an automatic retry", () => {
    expect(classifyRelayTimeout({ paymentMayHaveSettled: true })).toEqual({
      nextStatus: "unknown",
      errorCode: "UNKNOWN_POST_PAYMENT_OUTCOME",
      requiresReconciliation: true
    });
    expect(classifyRelayTimeout({ paymentMayHaveSettled: false })).toEqual({
      nextStatus: "partial_failure",
      errorCode: "RELAY_TIMEOUT",
      requiresReconciliation: true
    });

    const initial = attempt();
    const authorization = validateAuthorization({
      attemptId: ATTEMPT_ID,
      challengeId: initial.challenge.challengeId,
      challengeDigest: initial.challenge.challengeDigest,
      payerAddress: "0x6666666666666666666666666666666666666666",
      credentialDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorizedAtUnix: 1_000_040
    }, initial.challenge, PIN, 1_000_040);
    const authorized = transitionPaymentAttempt({
      attempt: initial,
      sellerConfiguration: SELLER_CONFIGURATION,
      nextStatus: "authorized",
      nowUnix: 1_000_040,
      idempotencyKey: "authorize-partial-1",
      correlationId: "corr-partial-1",
      metadata: { authorization }
    }).attempt;
    expect(() => transitionPaymentAttempt({
      attempt: authorized,
      sellerConfiguration: SELLER_CONFIGURATION,
      nextStatus: "relay_pending",
      nowUnix: initial.challenge.expiresAtUnix,
      idempotencyKey: "relay-expired-1",
      correlationId: "corr-expired-1"
    })).toThrow(/expired/i);
    const pending = transitionPaymentAttempt({ attempt: authorized, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "relay_pending", nowUnix: 1_000_041, idempotencyKey: "relay-partial-1", correlationId: "corr-partial-1" }).attempt;
    const partial = transitionPaymentAttempt({
      attempt: pending,
      sellerConfiguration: SELLER_CONFIGURATION,
      nextStatus: "partial_failure",
      nowUnix: 1_000_050,
      idempotencyKey: "partial-1",
      correlationId: "corr-partial-1",
      metadata: { failureCode: "RELAY_TIMEOUT", sanitizedFailure: "The relay timed out before a response was observed." }
    }).attempt;
    expect(partial.status).toBe("partial_failure");
    expect(() => assertPaymentTransition({ attempt: partial, sellerConfiguration: SELLER_CONFIGURATION, nextStatus: "settlement_pending", nowUnix: 1_000_060 })).toThrow(/reconciled/i);
  });
});
