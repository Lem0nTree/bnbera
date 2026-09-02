import { canonicalSha256Hex, normalizeEvmAddress } from "@bnbera/domain";
import { PaymentError } from "./errors.js";
import {
  b402PaymentPinSchema,
  b402SellerConfigurationSchema,
  challengeUnsignedDigest,
  decimalUintSchema,
  paymentAuthorizationDigest,
  paymentAuthorizationSchema,
  paymentChallengeSchema,
  paymentReceiptSchema,
  relayRequestSchema,
  secretReferenceSchema,
  type B402PaymentPin,
  type B402SellerConfiguration,
  type PaymentAuthorization,
  type PaymentChallenge,
  type PaymentReceipt,
  type RelayRequest
} from "./types.js";

const FORBIDDEN_FIELD = /(?:private.?key|seed|mnemonic|password|secret|credential|raw.?signature|access.?token|session.?token|wallet.?key)/i;

function safeParse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown } }, input: unknown, code: "INVALID_PAYMENT_CONFIG" | "INVALID_CHALLENGE" | "INVALID_AUTHORIZATION"): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PaymentError({ code, message: "The payment boundary input is invalid.", cause: result.error });
  }
  return result.data;
}

export function parseAtomic(value: string, label = "atomic amount"): bigint {
  if (!decimalUintSchema.safeParse(value).success) {
    throw new PaymentError({ code: "INVALID_AMOUNT", message: `${label} must be a non-negative decimal integer.` });
  }
  try {
    const parsed = BigInt(value);
    if (parsed > (1n << 256n) - 1n) throw new Error("uint256 overflow");
    return parsed;
  } catch (cause) {
    throw new PaymentError({ code: "INVALID_AMOUNT", message: `${label} is outside the uint256 range.`, cause });
  }
}

export function normalizeAddress(value: string, label = "address"): `0x${string}` {
  try {
    const normalized = normalizeEvmAddress(value);
    if (/^0x0{40}$/i.test(normalized)) throw new Error("zero address");
    return normalized as `0x${string}`;
  } catch (cause) {
    throw new PaymentError({ code: "INVALID_ADDRESS", message: `${label} must be a non-zero EVM address.`, cause });
  }
}

export function normalizeUrl(value: string, label = "URL"): string {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
      throw new Error("unsupported URL");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch (cause) {
    throw new PaymentError({ code: "INVALID_CHALLENGE", message: `${label} must be an HTTP(S) URL without embedded credentials.`, cause });
  }
}

function sameUrl(left: string, right: string): boolean {
  return normalizeUrl(left) === normalizeUrl(right);
}

export function assertSecretReference(value: string | null, label: string): void {
  if (value === null || !secretReferenceSchema.safeParse(value).success) {
    throw new PaymentError({ code: "INVALID_SECRET_REFERENCE", message: `${label} must be an approved secret reference, not a credential value.` });
  }
}

export function assertPublicPayloadSafe(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicPayloadSafe(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new PaymentError({ code: "INVALID_CHALLENGE", message: `Sensitive field rejected at ${path}.${key}.` });
    }
    assertPublicPayloadSafe(child, `${path}.${key}`);
  }
}

export function validateSellerConfiguration(input: unknown): B402SellerConfiguration {
  const config = safeParse(b402SellerConfigurationSchema, input, "INVALID_PAYMENT_CONFIG");
  if (config.enabled) {
    if (config.canaryStatus !== "passed") {
      throw new PaymentError({ code: "B402_NOT_READY", message: "B402 remains disabled until a complete paid canary passes.", nextAction: "run_paid_canary" });
    }
    if (config.payoutVerificationState !== "verified") {
      throw new PaymentError({ code: "PAYOUT_MISMATCH", message: "The configured payout address is not independently verified." });
    }
    assertSecretReference(config.merchantCredentialReference, "Merchant credential");
    assertSecretReference(config.agentCoreRelayAuthenticationReference, "AgentCore relay authentication");
    if (Number(config.priceUsd) <= 0) {
      throw new PaymentError({ code: "INVALID_AMOUNT", message: "A paid B402 service must have a positive configured price." });
    }
  }
  return {
    ...config,
    settlementAsset: normalizeAddress(config.settlementAsset, "settlement asset"),
    payoutAddress: normalizeAddress(config.payoutAddress, "payout address"),
    facilitatorEndpoint: normalizeUrl(config.facilitatorEndpoint, "facilitator endpoint"),
    publicX402Url: normalizeUrl(config.publicX402Url, "public X402 URL")
  };
}

/**
 * Repository and lifecycle boundaries must receive a verified enabled
 * configuration. Keeping this check here prevents callers from opting into a
 * disabled standards-lock entry by merely setting a payment pin's fields.
 */
export function parseEnabledSellerConfiguration(input: unknown): B402SellerConfiguration {
  const config = validateSellerConfiguration(input);
  if (!config.enabled) {
    throw new PaymentError({ code: "PAYMENT_DISABLED", message: "B402 payment configuration is disabled by the standards lock.", nextAction: "verify_standards_lock" });
  }
  return config;
}

export function validatePaymentPin(input: unknown): B402PaymentPin {
  const pin = safeParse(b402PaymentPinSchema, input, "INVALID_PAYMENT_CONFIG");
  parseAtomic(pin.amountAtomic, "Pinned payment amount");
  return {
    ...pin,
    settlementAsset: normalizeAddress(pin.settlementAsset, "settlement asset"),
    recipient: normalizeAddress(pin.recipient, "payment recipient"),
    destination: normalizeUrl(pin.destination, "payment destination"),
    facilitatorEndpoint: normalizeUrl(pin.facilitatorEndpoint, "facilitator endpoint")
  };
}

/**
 * Bind a per-request payment pin to the enabled seller configuration. Amount,
 * recipient, method, and request id remain request-specific, while network,
 * asset, route, fixed egress, and payout trust are not caller-selectable.
 */
export function validatePaymentPinAgainstSellerConfiguration(
  pinInput: unknown,
  configurationInput: unknown
): { readonly pin: B402PaymentPin; readonly configuration: B402SellerConfiguration } {
  const configuration = parseEnabledSellerConfiguration(configurationInput);
  const pin = validatePaymentPin(pinInput);
  if (pin.settlementNetwork !== configuration.settlementNetwork) {
    throw new PaymentError({ code: "NETWORK_MISMATCH", message: "Payment pin network does not match the enabled seller configuration." });
  }
  if (normalizeAddress(pin.settlementAsset, "pinned asset") !== normalizeAddress(configuration.settlementAsset, "configured settlement asset")) {
    throw new PaymentError({ code: "ASSET_MISMATCH", message: "Payment pin asset does not match the enabled seller configuration." });
  }
  if (pin.settlementDecimals !== configuration.settlementDecimals) {
    throw new PaymentError({ code: "DECIMALS_MISMATCH", message: "Payment pin decimals do not match the enabled seller configuration." });
  }
  if (pin.fixedEgressProfile !== configuration.fixedEgressProfile) {
    throw new PaymentError({ code: "EGRESS_PROFILE_MISMATCH", message: "Payment pin egress profile does not match the trusted seller configuration." });
  }
  if (normalizeAddress(pin.payoutAddress, "pinned payout address") !== normalizeAddress(configuration.payoutAddress, "configured payout address")) {
    throw new PaymentError({ code: "PAYOUT_MISMATCH", message: "Payment pin payout address does not match the independently verified seller configuration." });
  }
  if (pin.payoutVerificationState !== configuration.payoutVerificationState || configuration.payoutVerificationState !== "verified") {
    throw new PaymentError({ code: "PAYOUT_MISMATCH", message: "Payment pin payout verification is not enabled and verified." });
  }
  if (!sameUrl(pin.destination, configuration.publicX402Url)) {
    throw new PaymentError({ code: "DESTINATION_MISMATCH", message: "Payment pin destination does not match the enabled seller route." });
  }
  if (!sameUrl(pin.facilitatorEndpoint, configuration.facilitatorEndpoint)) {
    throw new PaymentError({ code: "FACILITATOR_MISMATCH", message: "Payment pin facilitator does not match the enabled seller configuration." });
  }
  return { pin, configuration };
}

function assertChallengeTerms(challenge: PaymentChallenge, pin: B402PaymentPin, nowUnix: number): void {
  if (challenge.rail !== pin.rail) {
    throw new PaymentError({ code: "INVALID_CHALLENGE", message: "Payment rail does not match the pinned B402 rail." });
  }
  if (challenge.settlementNetwork !== pin.settlementNetwork) {
    throw new PaymentError({ code: "NETWORK_MISMATCH", message: "Payment network does not match the pinned settlement network." });
  }
  if (normalizeAddress(challenge.settlementAsset, "challenge asset") !== normalizeAddress(pin.settlementAsset, "pinned asset")) {
    throw new PaymentError({ code: "ASSET_MISMATCH", message: "Payment asset does not match the independently pinned asset." });
  }
  if (challenge.settlementDecimals !== pin.settlementDecimals) {
    throw new PaymentError({ code: "DECIMALS_MISMATCH", message: "Payment-token decimals do not match the pinned asset." });
  }
  if (BigInt(challenge.amountAtomic) !== BigInt(pin.amountAtomic)) {
    throw new PaymentError({ code: "AMOUNT_MISMATCH", message: "Payment amount does not match the independently pinned amount." });
  }
  if (normalizeAddress(challenge.recipient, "challenge recipient") !== normalizeAddress(pin.recipient, "pinned recipient")) {
    throw new PaymentError({ code: "RECIPIENT_MISMATCH", message: "Payment recipient does not match the independently pinned recipient." });
  }
  if (challenge.method !== pin.method) {
    throw new PaymentError({ code: "METHOD_MISMATCH", message: "Payment method is not the pinned B402 method." });
  }
  if (!sameUrl(challenge.destination, pin.destination)) {
    throw new PaymentError({ code: "DESTINATION_MISMATCH", message: "Payment destination does not match the independently pinned route." });
  }
  if (!sameUrl(challenge.facilitatorEndpoint, pin.facilitatorEndpoint)) {
    throw new PaymentError({ code: "FACILITATOR_MISMATCH", message: "Facilitator endpoint does not match the independently pinned endpoint." });
  }
  if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0 || challenge.expiresAtUnix <= nowUnix) {
    throw new PaymentError({ code: "CHALLENGE_EXPIRED", message: "The payment challenge has expired." });
  }
  if (challenge.expiresAtUnix > nowUnix + pin.maxChallengeLifetimeSeconds || challenge.expiresAtUnix <= challenge.issuedAtUnix) {
    throw new PaymentError({ code: "INVALID_EXPIRY", message: "Payment challenge expiry is outside the pinned lifetime." });
  }
  if (challenge.issuedAtUnix > nowUnix + 60) {
    throw new PaymentError({ code: "INVALID_EXPIRY", message: "Payment challenge issuance is too far in the future." });
  }
}

export function validateChallenge(input: unknown, pinInput: unknown, nowUnix: number): PaymentChallenge {
  const challenge = safeParse(paymentChallengeSchema, input, "INVALID_CHALLENGE");
  const pin = validatePaymentPin(pinInput);
  parseAtomic(challenge.amountAtomic, "Challenge amount");
  const { challengeDigest: _challengeDigest, ...unsignedChallenge } = challenge;
  if (challengeUnsignedDigest(unsignedChallenge) !== challenge.challengeDigest) {
    throw new PaymentError({ code: "CHALLENGE_TAMPERED", message: "Payment challenge digest does not match its canonical terms." });
  }
  assertChallengeTerms(challenge, pin, nowUnix);
  return {
    ...challenge,
    settlementAsset: normalizeAddress(challenge.settlementAsset, "challenge asset"),
    recipient: normalizeAddress(challenge.recipient, "challenge recipient"),
    destination: normalizeUrl(challenge.destination, "challenge destination"),
    facilitatorEndpoint: normalizeUrl(challenge.facilitatorEndpoint, "challenge facilitator endpoint")
  };
}

export function validateAuthorization(input: unknown, challengeInput: unknown, pinInput: unknown, nowUnix: number): PaymentAuthorization {
  const authorization = safeParse(paymentAuthorizationSchema, input, "INVALID_AUTHORIZATION");
  const challenge = validateChallenge(challengeInput, pinInput, nowUnix);
  if (authorization.challengeId !== challenge.challengeId || authorization.challengeDigest !== challenge.challengeDigest) {
    throw new PaymentError({ code: "CHALLENGE_TAMPERED", message: "Authorization is bound to a different challenge." });
  }
  if (authorization.authorizedAtUnix < challenge.issuedAtUnix || authorization.authorizedAtUnix > challenge.expiresAtUnix || authorization.authorizedAtUnix <= 0) {
    throw new PaymentError({ code: "INVALID_EXPIRY", message: "Payment authorization falls outside the challenge lifetime." });
  }
  return {
    ...authorization,
    payerAddress: normalizeAddress(authorization.payerAddress, "payer address")
  };
}

export function validateRelayRequest(input: unknown, attemptId: string, authorization: PaymentAuthorization, pinInput: unknown): RelayRequest {
  const relay = safeParse(relayRequestSchema, input, "INVALID_AUTHORIZATION");
  const pin = validatePaymentPin(pinInput);
  if (relay.attemptId !== attemptId || relay.authorizationDigest !== paymentAuthorizationDigest(authorization)) {
    throw new PaymentError({ code: "INVALID_AUTHORIZATION", message: "Relay request is not bound to the validated authorization." });
  }
  if (relay.requestId !== pin.requestId) {
    throw new PaymentError({ code: "REQUEST_MISMATCH", message: "Relay request correlation does not match the trusted payment pin." });
  }
  if (relay.fixedEgressProfile !== pin.fixedEgressProfile) {
    throw new PaymentError({ code: "EGRESS_PROFILE_MISMATCH", message: "Relay request egress profile does not match the trusted payment pin." });
  }
  if (relay.method !== pin.method) {
    throw new PaymentError({ code: "METHOD_MISMATCH", message: "Relay method does not match the pinned payment method." });
  }
  if (!sameUrl(relay.destination, pin.destination)) {
    throw new PaymentError({ code: "DESTINATION_MISMATCH", message: "Relay destination does not match the pinned route." });
  }
  return {
    ...relay,
    destination: normalizeUrl(relay.destination, "relay destination")
  };
}

export function validateReceipt(input: unknown, pinInput: unknown, attemptId: string, challengeId: string): PaymentReceipt {
  const receipt = safeParse(paymentReceiptSchema, input, "INVALID_CHALLENGE");
  const pin = validatePaymentPin(pinInput);
  if (receipt.attemptId !== attemptId || receipt.challengeId !== challengeId) {
    throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "Receipt is not bound to the payment attempt and challenge." });
  }
  if (receipt.rail !== pin.rail) {
    throw new PaymentError({ code: "INVALID_CHALLENGE", message: "Receipt rail does not match the pinned payment rail." });
  }
  if (receipt.settlementNetwork !== pin.settlementNetwork) {
    throw new PaymentError({ code: "NETWORK_MISMATCH", message: "Receipt network does not match the pinned network." });
  }
  if (normalizeAddress(receipt.settlementAsset, "receipt asset") !== normalizeAddress(pin.settlementAsset, "pinned asset")) {
    throw new PaymentError({ code: "ASSET_MISMATCH", message: "Receipt asset does not match the pinned asset." });
  }
  if (receipt.settlementDecimals !== pin.settlementDecimals || BigInt(receipt.amountAtomic) !== BigInt(pin.amountAtomic)) {
    throw new PaymentError({ code: "AMOUNT_MISMATCH", message: "Receipt amount or decimals do not match the pinned payment." });
  }
  if (normalizeAddress(receipt.expectedRecipient, "receipt recipient") !== normalizeAddress(pin.recipient, "pinned recipient")) {
    throw new PaymentError({ code: "RECIPIENT_MISMATCH", message: "Receipt expected recipient does not match the pinned recipient." });
  }
  if (receipt.actualRecipient !== null && normalizeAddress(receipt.actualRecipient, "actual recipient") !== normalizeAddress(pin.recipient, "pinned recipient")) {
    throw new PaymentError({ code: "RECIPIENT_MISMATCH", message: "Observed settlement recipient does not match the pinned recipient." });
  }
  if (receipt.method !== pin.method || !sameUrl(receipt.destination, pin.destination)) {
    throw new PaymentError({ code: "DESTINATION_MISMATCH", message: "Receipt method or destination does not match the pinned terms." });
  }
  if (receipt.status === "settled") {
    if (receipt.paymentTransactionHash === null && receipt.settlementTransactionHash === null) {
      throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "A settled receipt requires an on-chain transaction reference." });
    }
    if (!receipt.payoutVerified || receipt.actualRecipient === null || receipt.payoutAddress === null) {
      throw new PaymentError({ code: "PAYOUT_MISMATCH", message: "A settled receipt requires independently verified payout-recipient evidence." });
    }
    if (normalizeAddress(receipt.payoutAddress, "payout address") !== normalizeAddress(pin.payoutAddress, "pinned payout address")) {
      throw new PaymentError({ code: "PAYOUT_MISMATCH", message: "Observed payout address does not match the pinned recipient." });
    }
    if (receipt.settledAtUnix === null) {
      throw new PaymentError({ code: "SETTLEMENT_UNVERIFIED", message: "A settled receipt requires a settlement observation time." });
    }
  }
  return {
    ...receipt,
    settlementAsset: normalizeAddress(receipt.settlementAsset, "receipt asset"),
    expectedRecipient: normalizeAddress(receipt.expectedRecipient, "receipt recipient"),
    actualRecipient: receipt.actualRecipient === null ? null : normalizeAddress(receipt.actualRecipient, "actual recipient"),
    destination: normalizeUrl(receipt.destination, "receipt destination")
  };
}

export function receiptDigest(receipt: PaymentReceipt): string {
  return canonicalSha256Hex(receipt);
}
