import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { BNB_TESTNET } from "@altananetwork/sdk";
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
  readonly chainId: 97;
  readonly network: typeof BNB_TESTNET;
};

type CreatedSession = {
  readonly token: string;
  readonly session: AuthenticatedSession;
};

type AuthGlobals = {
  pool?: { readonly key: string; readonly pool: PgPool };
};

const authGlobals = globalThis as typeof globalThis & { __bnberaCommerceAuth?: AuthGlobals };

const altanaSdkPackage = "@altananetwork/sdk";
const altanaSdkVersion = "0.9.0";
const altanaSdkIntegrity = "sha512-1RLOTvjQm5CHcIFDh/cN78prUkw59+v6qRDy43xKEOadmLyztpoHJIE1H+4Pisq4AbG+09tW8qMJ1UyuI/JBzw==";
const altanaVerificationBlock = 129_582_452;
const altanaVerificationStatus = "verified-read-only-runtime-at-block-129582452";
const zeroEip1967Slot = `0x${"0".repeat(64)}`;

type JsonRecord = Readonly<Record<string, unknown>>;

function jsonRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as JsonRecord;
}

function jsonString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is not a string`);
  return value;
}

function sameAddress(left: unknown, right: string, label: string): void {
  if (typeof left !== "string" || left.toLowerCase() !== right.toLowerCase()) throw new Error(`${label} does not match`);
}

function failClosedConfiguration(cause?: unknown): never {
  throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true, cause);
}

/**
 * Validate the checked-in Altana testnet evidence against the SDK network
 * object. This is deliberately read-only: the auth path must not trust an
 * environment-provided address, RPC or relay override.
 */
export function assertAltanaAuthStandardsLock(lock: unknown, network: typeof BNB_TESTNET = BNB_TESTNET): void {
  try {
    const root = jsonRecord(lock, "standards lock");
    const toolchain = jsonRecord(root.toolchain, "toolchain");
    const sdk = jsonRecord(toolchain.altanaSdk, "Altana SDK lock");
    if (sdk.package !== altanaSdkPackage || sdk.version !== altanaSdkVersion || sdk.integrity !== altanaSdkIntegrity) {
      throw new Error("Altana SDK package pin does not match the reviewed runtime");
    }

    const altana = jsonRecord(root.altana, "Altana lock");
    const testnet = jsonRecord(altana.testnet, "Altana testnet lock");
    if (testnet.chainId !== network.chainId || testnet.chainId !== 97) throw new Error("Altana testnet chain does not match");
    sameAddress(testnet.keyStore, network.keyStore, "Altana KeyStore");
    sameAddress(testnet.controller, network.keyStoreController, "Altana controller");
    sameAddress(testnet.controllerKeyStore, network.keyStore, "Altana controller KeyStore linkage");
    if (jsonString(testnet.publicRpcUrl, "Altana public RPC") !== network.publicRpcUrl) throw new Error("Altana public RPC does not match");
    if (jsonString(testnet.relay, "Altana relay") !== network.relayUrl) throw new Error("Altana relay does not match");
    if (testnet.verificationBlock !== altanaVerificationBlock) throw new Error("Altana verification block is not the reviewed read");
    if (jsonString(testnet.verificationStatus, "Altana verification status") !== altanaVerificationStatus) throw new Error("Altana verification is not complete");
    if (jsonString(testnet.deploymentKind, "Altana deployment kind") !== "direct") throw new Error("Altana deployments are not direct");
    if (jsonString(testnet.eip1967ImplementationSlot, "Altana implementation slot") !== zeroEip1967Slot || jsonString(testnet.eip1967BeaconSlot, "Altana beacon slot") !== zeroEip1967Slot) {
      throw new Error("Altana direct-deployment proxy slots are not empty");
    }
    const relayGet = jsonRecord(testnet.relayGet, "Altana relay GET evidence");
    if (relayGet.status !== 405) throw new Error("Altana relay GET evidence does not report 405");
  } catch (cause) {
    failClosedConfiguration(cause);
  }
}

export function readAltanaAuthStandardsLock(): unknown {
  try {
    return JSON.parse(readFileSync(new URL("../../../../config/standards.lock.json", import.meta.url), "utf8")) as unknown;
  } catch (cause) {
    return failClosedConfiguration(cause);
  }
}

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
  let appUrl: URL;
  try {
    appUrl = new URL(runtime.appUrl);
  } catch (cause) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true, cause);
  }
  if (runtime.siweDomain.toLowerCase() !== appUrl.host.toLowerCase()) {
    throw authError("AUTH_CONFIGURATION_INVALID", "Authentication is temporarily unavailable.", "try_again", true);
  }

  // This is intentionally an explicit local/testnet enablement. Mainnet
  // Altana custody remains pending in the standards lock and cannot be enabled
  // by changing BSC_CHAIN_ID or an untrusted request field.
  if (env.T5_ALTANA_AUTH_ENABLED !== "true") {
    throw authError(
      "AUTH_CONFIGURATION_BLOCKED",
      "Altana passkey authentication is not enabled for this runtime.",
      "configure_auth_boundary"
    );
  }

  if (runtime.bscChainId !== BNB_TESTNET.chainId) {
    throw authError(
      "AUTH_CONFIGURATION_BLOCKED",
      "Altana passkey authentication is enabled only for the reviewed BNB testnet runtime.",
      "switch_network"
    );
  }
  assertAltanaAuthStandardsLock(readAltanaAuthStandardsLock(), BNB_TESTNET);

  if (runtime.databaseUrl === undefined || runtime.databaseUrl.trim() === "") {
    throw authError("AUTH_DATABASE_UNAVAILABLE", "Authentication is temporarily unavailable.", "try_again", true);
  }

  return {
    databaseUrl: runtime.databaseUrl,
    databaseSsl: runtime.databaseSsl,
    appOrigin: appUrl.origin,
    rpId: appUrl.hostname.toLowerCase(),
    chainId: 97,
    network: BNB_TESTNET
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

/** Shared persistent pool for auth and the server-side commerce composition. */
export function getCommerceAuthDatabasePool(): PgPool {
  return getPool(runtimeFromEnvironment());
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
        AND chain_id = $2
      LIMIT 1`,
    [digestSessionToken(token), runtime.chainId]
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
