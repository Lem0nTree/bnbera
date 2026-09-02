import { canonicalSha256Hex, contentDigestSchema } from "@bnbera/domain";
import { PaymentError } from "./errors.js";
import {
  paymentAuthorizationSchema,
  paymentChallengeNonceSchema,
  type B402PaymentPin,
  type PaymentAuthorization
} from "./types.js";
import { normalizeUrl, validatePaymentPin } from "./validation.js";

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
  reserve(input: { readonly replayKey: string; readonly attemptId: string; readonly expiresAtUnix: number; readonly nowUnix: number }): PaymentReplayReservation;
  markConsumed(input: { readonly replayKey: string; readonly attemptId: string; readonly responseDigest: string; readonly nowUnix: number }): PaymentReplayReservation;
  markRejected(input: { readonly replayKey: string; readonly attemptId: string; readonly responseDigest: string | null; readonly nowUnix: number }): PaymentReplayReservation;
  get(replayKey: string): PaymentReplayReservation | null;
}

export function paymentReplayKey(pin: B402PaymentPin, challengeNonce: string, authorization: PaymentAuthorization): string {
  const trustedPin = validatePaymentPin(pin);
  const trustedAuthorization = paymentAuthorizationSchema.parse(authorization);
  const trustedNonce = paymentChallengeNonceSchema.parse(challengeNonce);
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
    nonce: trustedNonce,
    credentialDigest: trustedAuthorization.credentialDigest.toLowerCase()
  });
}

export class InMemoryPaymentReplayStore implements PaymentReplayStore {
  private readonly entries = new Map<string, PaymentReplayReservation>();

  reserve(input: { readonly replayKey: string; readonly attemptId: string; readonly expiresAtUnix: number; readonly nowUnix: number }): PaymentReplayReservation {
    const replayKey = input.replayKey.toLowerCase();
    contentDigestSchema.parse(replayKey);
    paymentAuthorizationSchema.shape.attemptId.parse(input.attemptId);
    if (!Number.isSafeInteger(input.nowUnix) || input.nowUnix <= 0 || !Number.isSafeInteger(input.expiresAtUnix) || input.expiresAtUnix <= input.nowUnix) {
      throw new PaymentError({ code: "CHALLENGE_EXPIRED", message: "A replay reservation must be created before its challenge expires." });
    }
    const existing = this.entries.get(replayKey);
    if (existing !== undefined) {
      if (existing.attemptId !== input.attemptId || existing.state !== "inflight" || existing.expiresAtUnix <= input.nowUnix) {
        throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: this payment authorization has already been consumed or reserved." });
      }
      return structuredClone(existing);
    }
    const entry: PaymentReplayReservation = {
      replayKey,
      attemptId: input.attemptId,
      state: "inflight",
      expiresAtUnix: input.expiresAtUnix,
      responseDigest: null,
      createdAtUnix: input.nowUnix,
      updatedAtUnix: input.nowUnix
    };
    this.entries.set(input.replayKey, entry);
    return structuredClone(entry);
  }

  markConsumed(input: { readonly replayKey: string; readonly attemptId: string; readonly responseDigest: string; readonly nowUnix: number }): PaymentReplayReservation {
    const responseDigest = input.responseDigest.toLowerCase();
    contentDigestSchema.parse(responseDigest);
    const existing = this.requireOwner(input.replayKey, input.attemptId);
    if (existing.state === "consumed") {
      if (existing.responseDigest !== responseDigest) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: the consumed response digest does not match." });
      return structuredClone(existing);
    }
    if (existing.state !== "inflight") throw new PaymentError({ code: "REPLAY_DETECTED", message: "Only an in-flight authorization can be consumed." });
    const next = { ...existing, state: "consumed" as const, responseDigest, updatedAtUnix: input.nowUnix };
    this.entries.set(input.replayKey, next);
    return structuredClone(next);
  }

  markRejected(input: { readonly replayKey: string; readonly attemptId: string; readonly responseDigest: string | null; readonly nowUnix: number }): PaymentReplayReservation {
    const responseDigest = input.responseDigest === null ? null : input.responseDigest.toLowerCase();
    if (responseDigest !== null) contentDigestSchema.parse(responseDigest);
    const existing = this.requireOwner(input.replayKey, input.attemptId);
    if (existing.state === "rejected") {
      if (existing.responseDigest !== responseDigest) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Replay protection: the rejected response digest does not match." });
      return structuredClone(existing);
    }
    if (existing.state !== "inflight") throw new PaymentError({ code: "REPLAY_DETECTED", message: "Only an in-flight authorization can be rejected." });
    const next = { ...existing, state: "rejected" as const, responseDigest, updatedAtUnix: input.nowUnix };
    this.entries.set(input.replayKey, next);
    return structuredClone(next);
  }

  get(replayKey: string): PaymentReplayReservation | null {
    const entry = this.entries.get(replayKey.toLowerCase());
    return entry === undefined ? null : structuredClone(entry);
  }

  private requireOwner(replayKey: string, attemptId: string): PaymentReplayReservation {
    const existing = this.entries.get(replayKey.toLowerCase());
    if (existing === undefined) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Payment authorization was not reserved." });
    if (existing.attemptId !== attemptId) throw new PaymentError({ code: "REPLAY_DETECTED", message: "Payment authorization belongs to another attempt." });
    return existing;
  }
}
