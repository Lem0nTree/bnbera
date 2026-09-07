import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { BNB, BNB_TESTNET } from "@altananetwork/sdk";
import {
  authCookieName,
  createAltanaAdminKeyReader,
  issueWebAuthnChallenge,
  type AuthenticatedSession,
  type NonceStore,
  type AltanaAdminKeyReader,
  verifyAltanaPasskeyAssertion
} from "@bnbera/auth";
import { AppError, loadRuntimeConfig } from "@bnbera/config";
import { chainIdSchema, evmAddressSchema, normalizeEvmAddress } from "@bnbera/domain";
import type { Pool as PgPool } from "pg";
import type { AltanaReadNetwork } from "@bnbera/auth";
import { z } from "zod";

const { Pool } = pg;

const challengeRequestSchema = z.object({
  walletAddress: evmAddressSchema,
  chainId: chainIdSchema
});

const assertionRequestSchema = challengeRequestSchema.extend({
  response: z.unknown()
});

const sessionTtlMs = 15 * 60_000;
const challengeTtlMs = 60_000;
const maxTokenLength = 256;

type StringEnvironment = Record<string, string | undefined>;
type AuthPool = Pick<PgPool, "query" | "connect">;

type AuthRuntime = {
  readonly databaseUrl: string;
  readonly databaseSsl: boolean;
  readonly appOrigin: string;
  readonly rpId: string;
  readonly chainId: 56 | 97;
  readonly network: typeof BNB | typeof BNB_TESTNET;
};

type CreatedSession = {
  readonly token: string;
  readonly session: AuthenticatedSession;
};

type AuthGlobals = {
  pool?: { readonly key: string; readonly pool: PgPool };
};

const authGlobals = globalThis as typeof globalThis & { __bnberaCommerceAuth?: AuthGlobals };

function authError(
  code: string,
  safeMessage: string,
  nextAction: string,
  retriable = false,
  cause?: unknown
): AppError {
  return new AppError({
    code,
    safeMessage,
    requestId: "req_web_auth",
    retriable,
    nextAction,
    cause
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createOpaqueSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestSessionToken(token: string): string {
  if (token.length === 0 || token.length > maxTokenLength) {
    throw authError("SESSION_COOKIE_INVALID", "Your session is invalid.", "sign_in_again");
  }
  return digest(token);
}

function runtimeFromEnvironment(env: StringEnvironment = process.env): AuthRuntime {
  let runtime;
  try {
    runtime = loadRuntimeConfig(env);
  } catch (cause) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true, cause);
  }
  if (runtime.databaseUrl === undefined || runtime.databaseUrl.trim() === "") {
    throw authError("AUTH_DATABASE_UNAVAILABLE", "Authentication is temporarily unavailable.", "try_again", true);
  }
  let appUrl: URL;
  try {
    appUrl = new URL(runtime.appUrl);
  } catch (cause) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true, cause);
  }
  if (runtime.siweDomain.toLowerCase() !== appUrl.host.toLowerCase()) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true);
  }
  const chainId: 56 | 97 = runtime.bscChainId === 56 ? 56 : 97;
  const network = chainId === 56 ? BNB : BNB_TESTNET;
  if (network.chainId !== chainId) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true);
  }

  // The active standards lock still marks Altana deployment verification as
  // pending. Keep this entire chain-backed boundary disabled until an operator
  // explicitly enables the reviewed runtime; tests can inject a reader.
  if (env.T5_ALTANA_AUTH_ENABLED !== "true") {
    throw authError(
      "AUTH_CONFIGURATION_BLOCKED",
      "Altana passkey authentication is not enabled for this runtime.",
      "configure_auth_boundary"
    );
  }

  return {
    databaseUrl: runtime.databaseUrl,
    databaseSsl: runtime.databaseSsl,
    appOrigin: appUrl.origin,
    rpId: appUrl.hostname.toLowerCase(),
    chainId,
    network
  };
}

function getPool(runtime: AuthRuntime): PgPool {
  const key = `${runtime.databaseUrl}\u0000${runtime.databaseSsl ? "ssl" : "plain"}`;
  const existing = authGlobals.__bnberaCommerceAuth?.pool;
  if (existing?.key === key) return existing.pool;
  if (existing !== undefined) void existing.pool.end();
  const pool = new Pool({
    connectionString: runtime.databaseUrl,
    ssl: runtime.databaseSsl ? { rejectUnauthorized: true } : undefined,
    max: 8
  });
  authGlobals.__bnberaCommerceAuth = { pool: { key, pool } };
  return pool;
}

/** Test/process shutdown hook. Production keeps the pool cached between routes. */
export async function closeCommerceAuthDatabaseForTests(): Promise<void> {
  const current = authGlobals.__bnberaCommerceAuth?.pool;
  delete authGlobals.__bnberaCommerceAuth;
  if (current !== undefined) await current.pool.end();
}

function nonceStore(pool: AuthPool, now: () => Date = () => new Date()): NonceStore {
  return {
    async issue(input) {
      const issuedAt = now();
      if (!Number.isFinite(issuedAt.getTime())) throw new Error("invalid auth clock");
      const expiresAt = new Date(issuedAt.getTime() + challengeTtlMs);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const nonce = randomBytes(32).toString("base64url");
        try {
          await pool.query(
            `INSERT INTO auth_nonces (domain, chain_id, nonce_digest, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [input.domain, input.chainId, digest(nonce), expiresAt]
          );
          return { nonce, expiresAt };
        } catch (cause) {
          const code = typeof cause === "object" && cause !== null && "code" in cause
            ? (cause as { readonly code?: string }).code
            : undefined;
          if (code !== "23505" || attempt === 2) throw cause;
        }
      }
      throw new Error("nonce generation failed");
    },
    async consume(input) {
      const result = await pool.query(
        `UPDATE auth_nonces
            SET consumed_at = NOW()
          WHERE domain = $1
            AND chain_id = $2
            AND nonce_digest = $3
            AND consumed_at IS NULL
            AND expires_at > NOW()
          RETURNING id`,
        [input.domain, input.chainId, digest(input.nonce)]
      );
      return result.rowCount === 1;
    }
  };
}

export function createPostgresAuthNonceStore(pool: AuthPool, now?: () => Date): NonceStore {
  return nonceStore(pool, now);
}

function authContext(runtime: AuthRuntime) {
  return {
    domain: runtime.rpId,
    origin: runtime.appOrigin,
    rpId: runtime.rpId,
    chainId: runtime.chainId,
    challengeTtlMs,
    sessionTtlMs
  } as const;
}

function rowDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid ${field}`);
  return date;
}

async function createSession(
  pool: AuthPool,
  input: { readonly walletAddress: string; readonly chainId: number; readonly now?: Date }
): Promise<CreatedSession> {
  const issuedAt = input.now ?? new Date();
  if (!Number.isFinite(issuedAt.getTime())) throw authError("SESSION_INVALID", "Authentication is temporarily unavailable.", "try_again", true);
  const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs);
  const walletAddress = normalizeEvmAddress(input.walletAddress);
  const token = createOpaqueSessionToken();
  const tokenDigest = digestSessionToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET "updatedAt" = NOW()
       RETURNING id`,
      [`wallet:${input.chainId}:${walletAddress}`, walletAddress]
    );
    const userId = userResult.rows[0]?.id;
    if (userId === undefined) throw new Error("user identity was not persisted");
    await client.query(
      `INSERT INTO wallet_addresses (user_id, address, chain_id, is_primary, last_ownership_verified_at)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (chain_id, address)
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     is_primary = TRUE,
                     last_ownership_verified_at = EXCLUDED.last_ownership_verified_at,
                     "updatedAt" = NOW()`,
      [userId, walletAddress, input.chainId, issuedAt]
    );
    const sessionResult = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions
        (user_id, token_digest, wallet_address, chain_id, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, tokenDigest, walletAddress, input.chainId, issuedAt, expiresAt]
    );
    const sessionId = sessionResult.rows[0]?.id;
    if (sessionId === undefined) throw new Error("session was not persisted");
    await client.query("COMMIT");
    return {
      token,
      session: { sessionId, userId, walletAddress, chainId: input.chainId, issuedAt, expiresAt }
    };
  } catch (cause) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw authError("SESSION_PERSISTENCE_FAILED", "Authentication is temporarily unavailable.", "try_again", true, cause);
  } finally {
    client.release();
  }
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== authCookieName) continue;
    const encoded = segment.slice(separator + 1).trim();
    if (encoded.length === 0 || encoded.length > maxTokenLength * 2) return null;
    try {
      const value = decodeURIComponent(encoded);
      return value.length > 0 && value.length <= maxTokenLength ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function cookieHeader(token: string, expiresAt: Date, issuedAt = new Date()): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - issuedAt.getTime()) / 1_000));
  return `${authCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAuthSessionCookie(): string {
  return `${authCookieName}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

export function authSessionCookie(token: string, expiresAt: Date): string {
  return cookieHeader(token, expiresAt);
}

export async function parseAuthJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (cause) {
    throw authError("AUTH_REQUEST_INVALID", "The passkey authentication request is invalid.", "check_request", false, cause);
  }
}

export function parsePasskeyChallengeRequest(input: unknown): { readonly walletAddress: string; readonly chainId: 56 | 97 } {
  const parsed = challengeRequestSchema.safeParse(input);
  if (!parsed.success || (parsed.data.chainId !== 56 && parsed.data.chainId !== 97)) {
    throw authError("AUTH_REQUEST_INVALID", "The passkey authentication request is invalid.", "check_request", false, parsed.success ? undefined : parsed.error);
  }
  return { walletAddress: normalizeEvmAddress(parsed.data.walletAddress), chainId: parsed.data.chainId };
}

export function parsePasskeyAssertionRequest(input: unknown): {
  readonly walletAddress: string;
  readonly chainId: 56 | 97;
  readonly response: unknown;
} {
  const parsed = assertionRequestSchema.safeParse(input);
  if (!parsed.success || (parsed.data.chainId !== 56 && parsed.data.chainId !== 97)) {
    throw authError("AUTH_REQUEST_INVALID", "The passkey authentication request is invalid.", "check_request", false, parsed.success ? undefined : parsed.error);
  }
  return {
    walletAddress: normalizeEvmAddress(parsed.data.walletAddress),
    chainId: parsed.data.chainId,
    response: parsed.data.response
  };
}

export async function createPasskeyChallenge(input: unknown): Promise<{
  readonly challenge: string;
  readonly rpId: string;
  readonly origin: string;
  readonly userVerification: "required";
  readonly timeout: number;
  readonly expiresAt: string;
}> {
  const request = parsePasskeyChallengeRequest(input);
  const runtime = runtimeFromEnvironment();
  if (request.chainId !== runtime.chainId) {
    throw authError("AUTH_CHAIN_MISMATCH", "Passkey authentication is for a different network.", "switch_network");
  }
  const now = new Date();
  const challenge = await issueWebAuthnChallenge(
    nonceStore(getPool(runtime), () => now),
    { ...authContext(runtime), now }
  );
  return { ...challenge, expiresAt: challenge.expiresAt.toISOString() };
}

function defaultAdminKeyReader(runtime: AuthRuntime): AltanaAdminKeyReader {
  // The web app and auth package may resolve viem through different pinned
  // TypeScript peer variants; the runtime NetworkConfig is the same readonly
  // SDK shape, so cross the package boundary explicitly after validation.
  return createAltanaAdminKeyReader(runtime.network as unknown as AltanaReadNetwork);
}

export async function authenticatePasskey(input: unknown, options?: {
  readonly adminKeyReader?: AltanaAdminKeyReader;
  readonly now?: Date;
}): Promise<{ readonly session: AuthenticatedSession; readonly setCookie: string }> {
  const request = parsePasskeyAssertionRequest(input);
  const runtime = runtimeFromEnvironment();
  if (request.chainId !== runtime.chainId) {
    throw authError("AUTH_CHAIN_MISMATCH", "Passkey authentication is for a different network.", "switch_network");
  }
  const pool = getPool(runtime);
  const verified = await verifyAltanaPasskeyAssertion(
    options?.adminKeyReader ?? defaultAdminKeyReader(runtime),
    nonceStore(pool),
    request,
    options?.now === undefined ? authContext(runtime) : { ...authContext(runtime), now: options.now }
  );
  const created = await createSession(pool, options?.now === undefined
    ? { walletAddress: verified.walletAddress, chainId: verified.chainId }
    : { walletAddress: verified.walletAddress, chainId: verified.chainId, now: options.now });
  return { session: created.session, setCookie: cookieHeader(created.token, created.session.expiresAt, created.session.issuedAt) };
}

export async function getAuthenticatedSession(request: Request): Promise<AuthenticatedSession | null> {
  const token = cookieValue(request);
  if (token === null) return null;
  const runtime = runtimeFromEnvironment();
  const result = await getPool(runtime).query<{
    id: string;
    user_id: string;
    wallet_address: string | null;
    chain_id: number | null;
    issued_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, user_id, wallet_address, chain_id, issued_at, expires_at
       FROM auth_sessions
      WHERE token_digest = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
        AND wallet_address IS NOT NULL
        AND chain_id IN (56, 97)
      LIMIT 1`,
    [digestSessionToken(token)]
  );
  const row = result.rows[0];
  if (row === undefined || row.wallet_address === null || row.chain_id === null) return null;
  const session: AuthenticatedSession = {
    sessionId: row.id,
    userId: row.user_id,
    walletAddress: normalizeEvmAddress(row.wallet_address),
    chainId: row.chain_id,
    issuedAt: rowDate(row.issued_at, "issued_at"),
    expiresAt: rowDate(row.expires_at, "expires_at")
  };
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

export async function requireAuthenticatedCommerceIdentity(request: Request): Promise<{
  readonly authenticated: true;
  readonly userId: string;
  readonly requesterAddress: string;
  readonly chainId: number;
  readonly sessionId: string;
}> {
  const session = await getAuthenticatedSession(request);
  if (session === null) {
    throw authError("AUTH_REQUIRED", "Sign in with your Altana passkey to continue.", "sign_in");
  }
  return {
    authenticated: true,
    userId: session.userId,
    requesterAddress: session.walletAddress,
    chainId: session.chainId,
    sessionId: session.sessionId
  };
}

export async function revokeAuthenticatedSession(request: Request): Promise<void> {
  const token = cookieValue(request);
  if (token === null) return;
  const runtime = runtimeFromEnvironment();
  await getPool(runtime).query(
    `UPDATE auth_sessions SET revoked_at = NOW()
      WHERE token_digest = $1 AND revoked_at IS NULL`,
    [digestSessionToken(token)]
  );
}

export function authHttpError(error: unknown, requestId = "req_web_auth"): Response {
  const safeError = error instanceof AppError
    ? error
    : authError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", "try_again", true, error);
  const status = safeError.code === "AUTH_REQUIRED" || safeError.code === "SESSION_COOKIE_INVALID" ? 401
    : safeError.code === "AUTH_REQUEST_INVALID" || safeError.code === "AUTH_CHAIN_MISMATCH" ? 400
      : safeError.code === "AUTH_CONFIGURATION_BLOCKED" ? 503
        : safeError.retriable ? 503 : 401;
  return Response.json(safeError.toEnvelope(), {
    status,
    headers: { "Cache-Control": "no-store", Vary: "Accept", "X-Request-Id": requestId }
  });
}

export function authNoStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", Vary: "Accept" };
}
