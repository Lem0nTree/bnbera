import { AppError } from "@bnbera/config";
import {
  chainIdSchema,
  evmAddressSchema,
  normalizeEvmAddress
} from "@bnbera/domain";
import { z } from "zod";

export const authCookieName = "__Host-bnbera_session";

export const siweRequestSchema = z.object({
  address: evmAddressSchema,
  chainId: chainIdSchema,
  domain: z.string().trim().min(1).max(253),
  uri: z.string().url(),
  nonce: z.string().min(8).max(128),
  issuedAt: z.coerce.date(),
  expirationTime: z.coerce.date().optional(),
  notBefore: z.coerce.date().optional(),
  statement: z.string().max(1_000).optional(),
  resources: z.array(z.string().url()).max(32).optional()
});

export type SiweRequest = z.infer<typeof siweRequestSchema>;

export type AuthenticatedSession = {
  readonly sessionId: string;
  readonly userId: string;
  readonly walletAddress: string;
  readonly chainId: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
};

export type SessionRecord = AuthenticatedSession & {
  /** A one-way digest of the cookie token. The raw cookie is never persisted. */
  readonly tokenDigest: string;
};

export type VerifiedSiweProof = {
  readonly address: string;
  readonly chainId: number;
  readonly issuedAt: Date;
  readonly expirationTime?: Date;
};

export interface SiweVerifier {
  verify(input: SiweRequest): Promise<VerifiedSiweProof>;
}

export interface NonceStore {
  issue(input: { readonly domain: string; readonly chainId: number }): Promise<{
    readonly nonce: string;
    readonly expiresAt: Date;
  }>;
  consume(input: { readonly domain: string; readonly chainId: number; readonly nonce: string }): Promise<boolean>;
}

export interface SessionStore {
  create(input: SessionRecord): Promise<AuthenticatedSession>;
  getByTokenDigest(tokenDigest: string): Promise<AuthenticatedSession | null>;
  revoke(sessionId: string): Promise<void>;
}

export type AuthBoundary = {
  readonly verifySiwe: (input: SiweRequest, expected: { domain: string; chainId: number }) => Promise<VerifiedSiweProof>;
  readonly assertSession: (session: AuthenticatedSession, now?: Date) => AuthenticatedSession;
  readonly assertWalletOwnership: (session: AuthenticatedSession, expectedAddress: string) => void;
};

function authError(code: string, message: string, nextAction: string): AppError {
  return new AppError({
    code,
    safeMessage: message,
    requestId: "auth-boundary",
    retriable: false,
    nextAction
  });
}

export function validateSiweRequest(
  input: unknown,
  expected: { readonly domain: string; readonly chainId: number }
): SiweRequest {
  const request = siweRequestSchema.parse(input);
  if (request.domain !== expected.domain || request.chainId !== expected.chainId) {
    throw authError("SIWE_CONTEXT_MISMATCH", "Wallet proof context does not match this application.", "sign_in_again");
  }
  if (request.expirationTime !== undefined && request.expirationTime <= request.issuedAt) {
    throw authError("SIWE_TIME_INVALID", "Wallet proof has an invalid expiration.", "sign_in_again");
  }
  if (request.notBefore !== undefined && request.notBefore > new Date()) {
    throw authError("SIWE_NOT_ACTIVE", "Wallet proof is not active yet.", "sign_in_again");
  }
  return request;
}

export async function verifySiweRequest(
  verifier: SiweVerifier,
  input: unknown,
  expected: { readonly domain: string; readonly chainId: number }
): Promise<VerifiedSiweProof> {
  const request = validateSiweRequest(input, expected);
  const proof = await verifier.verify(request);
  const verifiedAddress = normalizeEvmAddress(proof.address);
  const requestedAddress = normalizeEvmAddress(request.address);

  if (verifiedAddress !== requestedAddress || proof.chainId !== request.chainId) {
    throw authError("SIWE_SIGNATURE_INVALID", "Wallet proof could not be verified.", "sign_in_again");
  }
  if (proof.expirationTime !== undefined && proof.expirationTime <= new Date()) {
    throw authError("SIWE_EXPIRED", "Wallet proof has expired.", "sign_in_again");
  }

  return {
    ...proof,
    address: verifiedAddress
  };
}

export function assertSessionUsable(
  session: AuthenticatedSession,
  now: Date = new Date()
): AuthenticatedSession {
  if (session.expiresAt <= now) {
    throw authError("SESSION_EXPIRED", "Your session has expired.", "sign_in_again");
  }
  return session;
}

export function assertWalletOwnership(session: AuthenticatedSession, expectedAddress: string): void {
  if (normalizeEvmAddress(session.walletAddress) !== normalizeEvmAddress(expectedAddress)) {
    throw authError("WALLET_OWNERSHIP_REQUIRED", "The connected wallet does not own this resource.", "connect_owner_wallet");
  }
}

export function createAuthBoundary(verifier: SiweVerifier): AuthBoundary {
  return {
    verifySiwe: (input, expected) => verifySiweRequest(verifier, input, expected),
    assertSession: assertSessionUsable,
    assertWalletOwnership
  };
}
