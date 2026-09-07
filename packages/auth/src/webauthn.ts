import { AppError } from "@bnbera/config";
import { chainIdSchema, evmAddressSchema, normalizeEvmAddress } from "@bnbera/domain";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { keccak256, type Hex } from "viem";
import { z } from "zod";
import type { NonceStore } from "./boundary.js";

const defaultWebAuthnPolicy = {
  challengeTtlMs: 60_000,
  sessionTtlMs: 15 * 60_000
} as const;

const base64UrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/u, "Expected a base64url value");

const authenticationResponseSchema = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional()
  }),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown())
});

export type WebAuthnAuthenticationResponse = AuthenticationResponseJSON;

export type WebAuthnChallengeContext = {
  readonly domain: string;
  readonly origin: string;
  readonly rpId: string;
  readonly chainId: number;
  readonly now?: Date;
  readonly challengeTtlMs?: number;
};

export type WebAuthnAssertionInput = {
  readonly walletAddress: string;
  readonly chainId: number;
  readonly response: unknown;
};

export type WebAuthnChallenge = {
  readonly challenge: string;
  readonly rpId: string;
  readonly origin: string;
  readonly userVerification: "required";
  readonly timeout: number;
  readonly expiresAt: Date;
};

/**
 * A root key is deliberately a different type from an Altana session key.
 * `isRoot` and `expiry` must come from a current chain read; neither is
 * inferred from a browser assertion or request body.
 */
export type AltanaAdminKey = {
  readonly keyId: Hex;
  readonly publicKey: Hex;
  readonly isRoot: boolean;
  readonly revoked: boolean;
  readonly expiry: bigint;
};

export interface AltanaAdminKeyReader {
  read(input: { readonly walletAddress: string; readonly chainId: number }): Promise<readonly AltanaAdminKey[]>;
}

type ValidatedWebAuthnContext = {
  readonly domain: string;
  readonly origin: string;
  readonly rpId: string;
  readonly chainId: number;
  readonly now: Date;
  readonly challengeTtlMs: number;
};

export type VerifiedAltanaPasskey = {
  readonly walletAddress: string;
  readonly chainId: number;
  readonly credentialId: string;
  readonly verifiedAt: Date;
};

function authError(code: string, message: string, nextAction: string, cause?: unknown): AppError {
  return new AppError({
    code,
    safeMessage: message,
    requestId: "auth-boundary",
    retriable: false,
    nextAction,
    cause
  });
}

function positivePolicyValue(value: number | undefined, fallback: number, code: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw authError(code, "Passkey authentication policy is invalid.", "contact_support");
  }
  return value;
}

function parseOrigin(origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch (cause) {
    throw authError("WEBAUTHN_CONTEXT_INVALID", "Passkey authentication context is invalid.", "contact_support", cause);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== ""
  ) {
    throw authError("WEBAUTHN_CONTEXT_INVALID", "Passkey authentication context is invalid.", "contact_support");
  }
  return parsed;
}

function validateWebAuthnContext(expected: WebAuthnChallengeContext): ValidatedWebAuthnContext {
  const parsed = z
    .object({
      domain: z.string().trim().min(1).max(253),
      origin: z.string().url(),
      rpId: z.string().trim().min(1).max(253),
      chainId: chainIdSchema,
      now: z.date().optional(),
      challengeTtlMs: z.number().optional()
    })
    .safeParse(expected);
  if (!parsed.success) {
    throw authError("WEBAUTHN_CONTEXT_INVALID", "Passkey authentication context is invalid.", "contact_support", parsed.error);
  }

  const domain = parsed.data.domain.toLowerCase();
  const originUrl = parseOrigin(parsed.data.origin);
  const origin = originUrl.origin;
  const rpId = parsed.data.rpId.toLowerCase();
  if (originUrl.hostname.toLowerCase() !== domain || rpId !== domain) {
    throw authError("WEBAUTHN_CONTEXT_MISMATCH", "Passkey authentication context does not match this application.", "contact_support");
  }

  const now = parsed.data.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw authError("WEBAUTHN_CONTEXT_INVALID", "Passkey authentication context is invalid.", "contact_support");
  }

  return {
    domain,
    origin,
    rpId,
    chainId: parsed.data.chainId,
    now,
    challengeTtlMs: positivePolicyValue(parsed.data.challengeTtlMs, defaultWebAuthnPolicy.challengeTtlMs, "WEBAUTHN_POLICY_INVALID")
  };
}

function normalizePublicKey(publicKey: string): { readonly raw: Uint8Array; readonly flat: Uint8Array } {
  if (!/^0x[0-9a-fA-F]*$/u.test(publicKey) || (publicKey.length - 2) % 2 !== 0) {
    throw new Error("Altana public key is not valid hex");
  }
  const raw = Uint8Array.from(Buffer.from(publicKey.slice(2), "hex"));
  if (raw.length === 64) return { raw, flat: raw };
  if (raw.length === 65 && raw[0] === 0x04) return { raw, flat: raw.slice(1) };
  throw new Error("Altana public key is not an uncompressed P-256 key");
}

function cosePublicKey(publicKey: Hex): Uint8Array {
  const { flat } = normalizePublicKey(publicKey);
  return isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, flat.slice(0, 32)],
    [-3, flat.slice(32, 64)]
  ]));
}

function walletAddressFromUserHandle(userHandle: string | undefined): string {
  if (userHandle === undefined) {
    throw authError("WEBAUTHN_WALLET_BINDING_INVALID", "Passkey authentication is not bound to a wallet.", "sign_in_again");
  }
  let decoded: Uint8Array;
  try {
    decoded = isoBase64URL.toBuffer(userHandle);
  } catch (cause) {
    throw authError("WEBAUTHN_WALLET_BINDING_INVALID", "Passkey authentication is not bound to a wallet.", "sign_in_again", cause);
  }
  if (decoded.length !== 20) {
    throw authError("WEBAUTHN_WALLET_BINDING_INVALID", "Passkey authentication is not bound to a wallet.", "sign_in_again");
  }
  return `0x${Buffer.from(decoded).toString("hex")}`;
}

function signedChallenge(response: AuthenticationResponseJSON): string {
  try {
    const clientDataJson = isoBase64URL.toUTF8String(response.response.clientDataJSON);
    const parsedClientData: unknown = JSON.parse(clientDataJson);
    if (typeof parsedClientData !== "object" || parsedClientData === null) throw new Error("clientData is not an object");
    const challenge = (parsedClientData as { readonly challenge?: unknown }).challenge;
    if (typeof challenge !== "string" || !base64UrlSchema.safeParse(challenge).success) {
      throw new Error("clientData challenge is invalid");
    }
    return challenge;
  } catch (cause) {
    throw authError("WEBAUTHN_ASSERTION_INVALID", "Passkey authentication could not be verified.", "sign_in_again", cause);
  }
}

function assertAdminKey(key: AltanaAdminKey): void {
  if (key.isRoot !== true || key.revoked === true || key.expiry !== 0n) {
    throw new Error("Altana key is not a current root key");
  }
  const { raw } = normalizePublicKey(key.publicKey);
  if (keccak256(`0x${Buffer.from(raw).toString("hex")}` as Hex).toLowerCase() !== key.keyId.toLowerCase()) {
    throw new Error("Altana key identifier does not match its public key");
  }
}

/**
 * Issue a short-lived challenge. The nonce store owns generation and expiry;
 * the returned challenge is the only raw nonce allowed to leave this boundary.
 */
export async function issueWebAuthnChallenge(
  nonceStore: NonceStore,
  expected: WebAuthnChallengeContext
): Promise<WebAuthnChallenge> {
  const context = validateWebAuthnContext(expected);
  if (typeof nonceStore?.issue !== "function") {
    throw authError("WEBAUTHN_NONCE_UNAVAILABLE", "Passkey authentication is temporarily unavailable.", "try_again");
  }
  let issued: { readonly nonce: string; readonly expiresAt: Date };
  try {
    issued = await nonceStore.issue({ domain: context.domain, chainId: context.chainId });
  } catch (cause) {
    throw authError("WEBAUTHN_NONCE_UNAVAILABLE", "Passkey authentication is temporarily unavailable.", "try_again", cause);
  }
  if (
    !base64UrlSchema.safeParse(issued.nonce).success ||
    !(issued.expiresAt instanceof Date) ||
    !Number.isFinite(issued.expiresAt.getTime()) ||
    issued.expiresAt.getTime() <= context.now.getTime() ||
    issued.expiresAt.getTime() > context.now.getTime() + context.challengeTtlMs
  ) {
    throw authError("WEBAUTHN_NONCE_INVALID", "Passkey authentication is temporarily unavailable.", "try_again");
  }
  return {
    challenge: issued.nonce,
    rpId: context.rpId,
    origin: context.origin,
    userVerification: "required",
    timeout: Math.max(1, issued.expiresAt.getTime() - context.now.getTime()),
    expiresAt: issued.expiresAt
  };
}

/**
 * Verify a browser assertion against a current on-chain Altana root key.
 * Authentication is intentionally separate from execution authority: a
 * session key (`isRoot=false` or `expiry>0`) can never satisfy this function.
 */
export async function verifyAltanaPasskeyAssertion(
  keyReader: AltanaAdminKeyReader,
  nonceStore: NonceStore,
  input: WebAuthnAssertionInput,
  expected: WebAuthnChallengeContext
): Promise<VerifiedAltanaPasskey> {
  const context = validateWebAuthnContext(expected);
  const parsedInput = z
    .object({ walletAddress: evmAddressSchema, chainId: chainIdSchema, response: z.unknown() })
    .safeParse(input);
  if (!parsedInput.success || parsedInput.data.chainId !== context.chainId) {
    throw authError("WEBAUTHN_CONTEXT_MISMATCH", "Passkey authentication context does not match this application.", "sign_in_again", parsedInput.success ? undefined : parsedInput.error);
  }
  const walletAddress = normalizeEvmAddress(parsedInput.data.walletAddress);
  const responseParsed = authenticationResponseSchema.safeParse(parsedInput.data.response);
  if (!responseParsed.success) {
    throw authError("WEBAUTHN_ASSERTION_INVALID", "Passkey authentication could not be verified.", "sign_in_again", responseParsed.error);
  }
  const response = responseParsed.data as AuthenticationResponseJSON;
  if (response.id !== response.rawId) {
    throw authError("WEBAUTHN_ASSERTION_INVALID", "Passkey authentication could not be verified.", "sign_in_again");
  }
  const responseWalletAddress = walletAddressFromUserHandle(response.response.userHandle);
  if (responseWalletAddress !== walletAddress) {
    throw authError("WEBAUTHN_WALLET_BINDING_INVALID", "Passkey authentication is not bound to this wallet.", "sign_in_again");
  }
  const challenge = signedChallenge(response);

  if (typeof keyReader?.read !== "function") {
    throw authError("ALTANA_ADMIN_KEY_UNAVAILABLE", "Wallet ownership could not be verified on-chain.", "try_again");
  }
  let keys: readonly AltanaAdminKey[];
  try {
    keys = await keyReader.read({ walletAddress, chainId: context.chainId });
  } catch (cause) {
    throw authError("ALTANA_ADMIN_KEY_UNAVAILABLE", "Wallet ownership could not be verified on-chain.", "try_again", cause);
  }
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32) {
    throw authError("ALTANA_ADMIN_KEY_INVALID", "The wallet has no current administrative passkey.", "sign_in_again");
  }

  let verified = false;
  for (const key of keys) {
    try {
      assertAdminKey(key);
      const credential: WebAuthnCredential = {
        id: response.id,
        publicKey: cosePublicKey(key.publicKey),
        counter: 0
      };
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: context.origin,
        expectedRPID: context.rpId,
        credential,
        expectedType: "webauthn.get",
        requireUserVerification: true,
        advancedFIDOConfig: { userVerification: "required" }
      });
      // The callback above only proves the shape; the nonce is consumed below
      // against the exact challenge after the library parses clientDataJSON.
      if (result.verified) {
        verified = true;
        break;
      }
    } catch {
      // A wallet may have more than one current root key. Try the next root
      // key without exposing whether a particular key matched.
    }
  }
  if (!verified) {
    throw authError("WEBAUTHN_ASSERTION_INVALID", "Passkey authentication could not be verified.", "sign_in_again");
  }

  if (typeof nonceStore?.consume !== "function") {
    throw authError("WEBAUTHN_NONCE_UNAVAILABLE", "Passkey authentication is temporarily unavailable.", "try_again");
  }
  let consumed: boolean;
  try {
    consumed = await nonceStore.consume({
      domain: context.domain,
      chainId: context.chainId,
      nonce: challenge
    });
  } catch (cause) {
    throw authError("WEBAUTHN_NONCE_UNAVAILABLE", "Passkey authentication is temporarily unavailable.", "try_again", cause);
  }
  if (consumed !== true) {
    throw authError("WEBAUTHN_NONCE_REJECTED", "Passkey authentication could not be accepted.", "sign_in_again");
  }

  return {
    walletAddress,
    chainId: context.chainId,
    credentialId: response.id,
    verifiedAt: context.now
  };
}

export const webAuthnPolicy = defaultWebAuthnPolicy;
