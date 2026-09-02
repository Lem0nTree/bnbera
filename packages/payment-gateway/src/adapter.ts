import type {
  B402PaymentPin,
  PaymentAttempt,
  PaymentAuthorization,
  PaymentChallenge,
  PaymentReceipt,
  RelayRequest
} from "./types.js";

export interface PaymentChallengeRequest {
  readonly attemptId: string;
  readonly requestId: string;
  readonly pin: B402PaymentPin;
  readonly nowUnix: number;
}

export interface PaymentRelayOutcome {
  readonly requestReference: string;
  readonly status: "settlement_pending" | "unknown" | "partial_failure";
  readonly paymentTransactionHash: `0x${string}` | null;
  readonly settlementTransactionHash: `0x${string}` | null;
  readonly responseStatus: number | null;
  readonly responseDigest: string | null;
  readonly receipt: PaymentReceipt | null;
}

export interface PaymentReconciliationObservation {
  readonly status: "reconciled" | "failed" | "manual_review";
  readonly paymentTransactionHash: `0x${string}` | null;
  readonly settlementTransactionHash: `0x${string}` | null;
  readonly detailDigest: string | null;
}

/**
 * Adapter seam for the official B402/X402 SDK and AgentCore relay. The core
 * boundary never accepts raw signed credentials; an adapter may handle an
 * ephemeral credential internally and returns only public digests/receipts.
 */
export interface B402PaymentAdapter {
  readonly kind: "b402";
  issueChallenge(input: PaymentChallengeRequest): Promise<PaymentChallenge>;
  verifyAuthorization(input: { readonly challenge: PaymentChallenge; readonly authorization: PaymentAuthorization; readonly pin: B402PaymentPin; readonly nowUnix: number }): Promise<{ readonly authorizationDigest: string }>;
  relayPaidRequest(input: { readonly attempt: PaymentAttempt; readonly authorization: PaymentAuthorization; readonly relay: RelayRequest }): Promise<PaymentRelayOutcome>;
  reconcile(input: { readonly attempt: PaymentAttempt; readonly authorization: PaymentAuthorization | null }): Promise<PaymentReconciliationObservation>;
}
