import { canonicalSha256Hex, contentDigestSchema } from "@bnbera/domain";
import { PaymentError } from "./errors.js";
import {
  paymentAttemptSchema,
  paymentAuthorizationSchema,
  paymentAuthorizationDigest,
  paymentChallengeNonceSchema,
  type PaymentAttempt,
  type ValidatedPaymentAuthorization
} from "./types.js";
import { assertValidatedPaymentAuthorization, normalizeUrl, validatePaymentPin } from "./validation.js";

export const replayStates = ["inflight", "consumed", "rejected"] as const;
export type ReplayState = (typeof replayStates)[number];

export interface PaymentReplayReservation {
  readonly replayKey: string;
  readonly attemptId: string;
  readonly state: ReplayState;
  readonly expiresAtUnix: number;
  readonly responseDigest: string | null;
  readonly createdAtUnix: number;
  readonly updatedAtUnix: number;
}

export interface PaymentReplayStore {
  reserve(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly expiresAtUnix: number; readonly nowUnix: number }): PaymentReplayReservation;
  markConsumed(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly responseDigest: string; readonly nowUnix: number }): PaymentReplayReservation;
  markRejected(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly responseDigest: string | null; readonly nowUnix: number }): PaymentReplayReservation;
  get(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization }): PaymentReplayReservation | null;
}

function normalizeReplayKey(value: string): string {
  const replayKey = value.toLowerCase();
  contentDigestSchema.parse(replayKey);
  return replayKey;
}

export function paymentReplayKey(attempt: PaymentAttempt, authorization: ValidatedPaymentAuthorization): string {
  const trustedAttempt = paymentAttemptSchema.parse(attempt);
  assertValidatedPaymentAuthorization(authorization);
  const trustedPin = validatePaymentPin(trustedAttempt.pin);
  const trustedAuthorization = paymentAuthorizationSchema.parse(authorization);
  const trustedNonce = paymentChallengeNonceSchema.parse(trustedAttempt.challenge.nonce);
  if (trustedAuthorization.attemptId !== trustedAttempt.attemptId || trustedAuthorization.challengeId !== trustedAttempt.challenge.challengeId || trustedAuthorization.challengeDigest !== trustedAttempt.challengeDigest) {
    throw new PaymentError({ code: "INVALID_AUTHORIZATION", message: "Replay authorization is not bound to the payment attempt." });
  }
  return canonicalSha256Hex({
    rail: trustedPin.rail,
    settlementNetwork: trustedPin.settlementNetwork,
    settlementAsset: trustedPin.settlementAsset.toLowerCase(),
    settlementDecimals: trustedPin.settlementDecimals,
    amountAtomic: trustedPin.amountAtomic,
    recipient: trustedPin.recipient.toLowerCase(),
    method: trustedPin.method,
    destination: normalizeUrl(trustedPin.destination, "payment destination"),
    facilitatorEndpoint: normalizeUrl(trustedPin.facilitatorEndpoint, "facilitator endpoint"),
    fixedEgressProfile: trustedPin.fixedEgressProfile,
    paymentPinDigest: trustedAttempt.pinDigest,
    configurationDigest: trustedPin.configurationDigest,
    authorizationDigest: paymentAuthorizationDigest(trustedAuthorization),
    nonce: trustedNonce,
    credentialDigest: trustedAuthorization.credentialDigest.toLowerCase()
  });
}

export class InMemoryPaymentReplayStore implements PaymentReplayStore {
  private readonly entries = new Map<string, PaymentReplayReservation>();

  reserve(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly expiresAtUnix: number; readonly nowUnix: number }): PaymentReplayReservation {
    const replayKey = normalizeReplayKey(paymentReplayKey(input.attempt, input.authorization));
    const attempt = paymentAttemptSchema.parse(input.attempt);
    if (input.expiresAtUnix !== attempt.challenge.expiresAtUnix) {
      throw new PaymentError({ code: "INVALID_EXPIRY", message: "Replay reservation expiry must match the validated challenge expiry." });
    }
    if (!Number.isSafeInteger(input.nowUnix) || input.nowUnix <= 0 || !Number.isSafeInteger(input.expiresAtUnix) || input.expiresAtUnix <= input.nowUnix) {
      throw new PaymentError({ code: "CHALLENGE_EXPIRED", message: "A replay reservation must be created before its challenge expires." });
    }
    const existing = this.entries.get(replayKey);
    if (existing !== undefined) {
      if (existing.attemptId !== attempt.attemptId || existing.state !== "inflight" || existing.expiresAtUnix <= input.nowUnix) {
        throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: this payment authorization has already been consumed or reserved." });
      }
      return structuredClone(existing);
    }
    const entry: PaymentReplayReservation = {
      replayKey,
      attemptId: attempt.attemptId,
      state: "inflight",
      expiresAtUnix: input.expiresAtUnix,
      responseDigest: null,
      createdAtUnix: input.nowUnix,
      updatedAtUnix: input.nowUnix
    };
    this.entries.set(replayKey, entry);
    return structuredClone(entry);
  }

  markConsumed(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly responseDigest: string; readonly nowUnix: number }): PaymentReplayReservation {
    const responseDigest = input.responseDigest.toLowerCase();
    contentDigestSchema.parse(responseDigest);
    const attempt = paymentAttemptSchema.parse(input.attempt);
    const replayKey = normalizeReplayKey(paymentReplayKey(attempt, input.authorization));
    const existing = this.requireOwner(replayKey, attempt.attemptId);
    if (existing.state === "consumed") {
      if (existing.responseDigest !== responseDigest) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: the consumed response digest does not match." });
      return structuredClone(existing);
    }
    if (existing.state !== "inflight") throw new PaymentError({ code: "REPLAY_DETECTED", message: "Only an in-flight authorization can be consumed." });
    const next = { ...existing, state: "consumed" as const, responseDigest, updatedAtUnix: input.nowUnix };
    this.entries.set(replayKey, next);
    return structuredClone(next);
  }

  markRejected(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization; readonly responseDigest: string | null; readonly nowUnix: number }): PaymentReplayReservation {
    const responseDigest = input.responseDigest === null ? null : input.responseDigest.toLowerCase();
    if (responseDigest !== null) contentDigestSchema.parse(responseDigest);
    const attempt = paymentAttemptSchema.parse(input.attempt);
    const replayKey = normalizeReplayKey(paymentReplayKey(attempt, input.authorization));
    const existing = this.requireOwner(replayKey, attempt.attemptId);
    if (existing.state === "rejected") {
      if (existing.responseDigest !== responseDigest) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: the rejected response digest does not match." });
      return structuredClone(existing);
    }
    if (existing.state !== "inflight") throw new PaymentError({ code: "REPLAY_DETECTED", message: "Only an in-flight authorization can be rejected." });
    const next = { ...existing, state: "rejected" as const, responseDigest, updatedAtUnix: input.nowUnix };
    this.entries.set(replayKey, next);
    return structuredClone(next);
  }

  get(input: { readonly attempt: PaymentAttempt; readonly authorization: ValidatedPaymentAuthorization }): PaymentReplayReservation | null {
    const replayKey = normalizeReplayKey(paymentReplayKey(input.attempt, input.authorization));
    const entry = this.entries.get(replayKey);
    return entry === undefined ? null : structuredClone(entry);
  }

  private requireOwner(replayKey: string, attemptId: string): PaymentReplayReservation {
    const existing = this.entries.get(normalizeReplayKey(replayKey));
    if (existing === undefined) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Payment authorization was not reserved." });
    if (existing.attemptId !== attemptId) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Payment authorization belongs to another attempt." });
    return existing;
  }
}
