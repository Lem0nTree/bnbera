import { AppError } from "@bnbera/config";
import {
  chainIdSchema,
  evmAddressSchema,
  normalizeEvmAddress
} from "@bnbera/domain";
import { z } from "zod";

export const authCookieName = "__Host-bnbera_session";

const defaultSiwePolicy = {
  maxIssuedAtAgeMs: 5 * 60 * 1_000,
  maxFutureSkewMs: 30 * 1_000,
  maxLifetimeMs: 15 * 60 * 1_000
} as const;

const httpUriSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === ""
      );
    } catch {
      return false;
    }
  }, "SIWE URI must be an HTTP(S) URL without credentials or a fragment");

export const siweRequestSchema = z.object({
  address: evmAddressSchema,
  chainId: chainIdSchema,
  domain: z.string().trim().min(1).max(253),
  uri: httpUriSchema,
  nonce: z.string().min(8).max(128),
  issuedAt: z.coerce.date(),
  expirationTime: z.coerce.date(),
  notBefore: z.coerce.date().optional(),
  statement: z.string().max(1_000).optional(),
  resources: z.array(z.string().url()).max(32).optional()
});

export type SiweRequest = z.infer<typeof siweRequestSchema>;

export type SiweVerificationContext = {
  readonly domain: string;
  readonly uri: string;
  readonly chainId: number;
  readonly now?: Date;
  readonly maxIssuedAtAgeMs?: number;
  readonly maxFutureSkewMs?: number;
  readonly maxLifetimeMs?: number;
};

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
  readonly expirationTime: Date;
};

export interface SiweVerifier {
  verify(input: SiweRequest): Promise<VerifiedSiweProof>;
}

export interface NonceStore {
  issue(input: { readonly domain: string; readonly chainId: number }): Promise<{
    readonly nonce: string;
    readonly expiresAt: Date;
  }>;
  /** Consume atomically: at most one concurrent verifier may receive true. */
  consume(input: { readonly domain: string; readonly chainId: number; readonly nonce: string }): Promise<boolean>;
}

export interface SessionStore {
  create(input: SessionRecord): Promise<AuthenticatedSession>;
  getByTokenDigest(tokenDigest: string): Promise<AuthenticatedSession | null>;
  revoke(sessionId: string): Promise<void>;
}

export type AuthBoundary = {
  readonly verifySiwe: (
    input: unknown,
    expected: SiweVerificationContext
  ) => Promise<VerifiedSiweProof>;
  readonly assertSession: (session: AuthenticatedSession, now?: Date) => AuthenticatedSession;
  readonly assertWalletOwnership: (session: AuthenticatedSession, expectedAddress: string) => void;
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

type ValidatedSiweContext = {
  readonly domain: string;
  readonly uri: string;
  readonly chainId: number;
  readonly now: Date;
  readonly maxIssuedAtAgeMs: number;
  readonly maxFutureSkewMs: number;
  readonly maxLifetimeMs: number;
};

function parseHttpUri(uri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (cause) {
    throw authError("SIWE_AUDIENCE_MISMATCH", "Wallet proof audience is not valid.", "sign_in_again", cause);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw authError("SIWE_AUDIENCE_MISMATCH", "Wallet proof audience is not valid.", "sign_in_again");
  }

  return parsed;
}

function canonicalHttpUri(uri: string): string {
  return parseHttpUri(uri).toString();
}

function policyValue(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw authError("SIWE_POLICY_INVALID", "Wallet proof policy is invalid.", "contact_support");
  }
  return value;
}

function validateContext(expected: SiweVerificationContext): ValidatedSiweContext {
  const parsed = z
    .object({
      domain: z.string().trim().min(1).max(253),
      uri: httpUriSchema,
      chainId: chainIdSchema,
      now: z.date().optional(),
      maxIssuedAtAgeMs: z.number().optional(),
      maxFutureSkewMs: z.number().optional(),
      maxLifetimeMs: z.number().optional()
    })
    .safeParse(expected);

  if (!parsed.success) {
    throw authError("SIWE_CONTEXT_INVALID", "Wallet proof context is invalid.", "contact_support", parsed.error);
  }

  const domain = parsed.data.domain.toLowerCase();
  const uri = canonicalHttpUri(parsed.data.uri);
  if (new URL(uri).host.toLowerCase() !== domain) {
    throw authError("SIWE_CONTEXT_MISMATCH", "Wallet proof context does not match this application.", "contact_support");
  }

  const now = parsed.data.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw authError("SIWE_CONTEXT_INVALID", "Wallet proof context is invalid.", "contact_support");
  }

  return {
    domain,
    uri,
    chainId: parsed.data.chainId,
    now,
    maxIssuedAtAgeMs: policyValue(parsed.data.maxIssuedAtAgeMs, defaultSiwePolicy.maxIssuedAtAgeMs),
    maxFutureSkewMs: policyValue(parsed.data.maxFutureSkewMs, defaultSiwePolicy.maxFutureSkewMs),
    maxLifetimeMs: policyValue(parsed.data.maxLifetimeMs, defaultSiwePolicy.maxLifetimeMs)
  };
}

function validateSiweRequestWithContext(
  input: unknown,
  expected: SiweVerificationContext
): { readonly request: SiweRequest; readonly context: ValidatedSiweContext } {
  const context = validateContext(expected);
  const parsed = siweRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw authError("SIWE_REQUEST_INVALID", "Wallet proof is invalid.", "sign_in_again", parsed.error);
  }

  const request = parsed.data;
  const requestDomain = request.domain.toLowerCase();
  const requestUri = canonicalHttpUri(request.uri);
  if (requestDomain !== context.domain || request.chainId !== context.chainId) {
    throw authError("SIWE_CONTEXT_MISMATCH", "Wallet proof context does not match this application.", "sign_in_again");
  }
  if (new URL(requestUri).host.toLowerCase() !== requestDomain || requestUri !== context.uri) {
    throw authError("SIWE_AUDIENCE_MISMATCH", "Wallet proof audience does not match this application.", "sign_in_again");
  }

  const issuedAtMs = request.issuedAt.getTime();
  const expirationMs = request.expirationTime.getTime();
  const nowMs = context.now.getTime();
  if (issuedAtMs > nowMs + context.maxFutureSkewMs) {
    throw authError("SIWE_TIME_INVALID", "Wallet proof issued-at time is invalid.", "sign_in_again");
  }
  if (issuedAtMs < nowMs - context.maxIssuedAtAgeMs) {
    throw authError("SIWE_ISSUED_AT_STALE", "Wallet proof is too old.", "sign_in_again");
  }
  if (expirationMs <= issuedAtMs || expirationMs - issuedAtMs > context.maxLifetimeMs) {
    throw authError("SIWE_TIME_INVALID", "Wallet proof has an invalid expiration.", "sign_in_again");
  }
  if (expirationMs <= nowMs) {
    throw authError("SIWE_EXPIRED", "Wallet proof has expired.", "sign_in_again");
  }
  if (request.notBefore !== undefined && request.notBefore.getTime() > nowMs) {
    throw authError("SIWE_NOT_ACTIVE", "Wallet proof is not active yet.", "sign_in_again");
  }

  return { request, context };
}

export function validateSiweRequest(
  input: unknown,
  expected: SiweVerificationContext
): SiweRequest {
  return validateSiweRequestWithContext(input, expected).request;
}

export async function verifySiweRequest(
  verifier: SiweVerifier,
  nonceStore: NonceStore,
  input: unknown,
  expected: SiweVerificationContext
): Promise<VerifiedSiweProof> {
  const { request, context } = validateSiweRequestWithContext(input, expected);

  let proof: VerifiedSiweProof;
  try {
    proof = await verifier.verify(request);
  } catch (cause) {
    throw authError("SIWE_SIGNATURE_INVALID", "Wallet proof could not be verified.", "sign_in_again", cause);
  }

  let verifiedAddress: string;
  try {
    if (!(proof.issuedAt instanceof Date) || !Number.isFinite(proof.issuedAt.getTime())) {
      throw new Error("Verifier returned an invalid issued-at time");
    }
    if (!(proof.expirationTime instanceof Date) || !Number.isFinite(proof.expirationTime.getTime())) {
      throw new Error("Verifier returned an invalid expiration");
    }
    verifiedAddress = normalizeEvmAddress(proof.address);
    const requestedAddress = normalizeEvmAddress(request.address);
    if (
      verifiedAddress !== requestedAddress ||
      proof.chainId !== request.chainId ||
      proof.issuedAt.getTime() !== request.issuedAt.getTime() ||
      proof.expirationTime.getTime() !== request.expirationTime.getTime()
    ) {
      throw new Error("Verifier result does not match the signed request");
    }
  } catch (cause) {
    throw authError("SIWE_SIGNATURE_INVALID", "Wallet proof could not be verified.", "sign_in_again", cause);
  }

  if (nonceStore === undefined || nonceStore === null || typeof nonceStore.consume !== "function") {
    throw authError("SIWE_NONCE_UNAVAILABLE", "Wallet proof could not be accepted.", "try_again");
  }

  let consumed: boolean;
  try {
    consumed = await nonceStore.consume({
      domain: context.domain,
      chainId: request.chainId,
      nonce: request.nonce
    });
  } catch (cause) {
    throw authError("SIWE_NONCE_UNAVAILABLE", "Wallet proof could not be accepted.", "try_again", cause);
  }
  if (consumed !== true) {
    throw authError("SIWE_NONCE_REJECTED", "Wallet proof could not be accepted.", "sign_in_again");
  }

  return { ...proof, address: verifiedAddress };
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

export function createAuthBoundary(verifier: SiweVerifier, nonceStore: NonceStore): AuthBoundary {
  return {
    verifySiwe: (input, expected) => verifySiweRequest(verifier, nonceStore, input, expected),
    assertSession: assertSessionUsable,
    assertWalletOwnership
  };
}
