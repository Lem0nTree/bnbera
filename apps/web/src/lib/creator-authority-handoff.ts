import { deserializeSession, signerFromPrivateKey, type SerializedSession } from "@altananetwork/sdk";
import { confirmCreatorAuthority, EphemeralSessionMaterial, type CreatorAuthorityGateway, type CreatorAuthorityPublicStatus, type CreatorAuthorityStore, type CreatorAuthorityDraftResolver, type RuntimeSessionSecretSink, type SecretReference } from "@bnbera/altana";
import { CreatorAuthorityError } from "./creator-authority-runtime";
import { creatorAuthorityGrant } from "./creator-altana-grant";
import type { CreatorBrowserAuthority } from "./creator-repository";
import { creatorLocalStudioDestination, creatorRuntimeName } from "./creator-local-secret";

const addressPattern = /^0x[0-9a-f]{40}$/iu;
const publicKeyPattern = /^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/iu;
const privateKeyPattern = /^0x[0-9a-f]{64}$/iu;
const periods = new Set(["minute", "hour", "day", "week", "month", "year"]);
const sessionKeys = ["expiry", "permissions", "publicKey", "walletAddress"] as const;

type HandoffStore = CreatorAuthorityStore & CreatorAuthorityDraftResolver;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function decimal(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  if (record(value) && exactKeys(value, ["$bigint"]) && typeof value.$bigint === "string" && /^\d+$/u.test(value.$bigint)) return value.$bigint;
  return null;
}

function invalidSession(): never {
  throw new CreatorAuthorityError("CREATOR_SESSION_INVALID", "The supplied Altana session is not a supported serialized session.");
}

/** Strictly parse the public SDK serialization, including safe bigint wrappers. */
export function parseCreatorSerializedSession(value: unknown): SerializedSession {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (value.length === 0 || value.length > 16 * 1024) invalidSession();
    try { parsed = JSON.parse(value) as unknown; } catch { invalidSession(); }
  }
  if (!record(parsed) || !exactKeys(parsed, sessionKeys) || !addressPattern.test(String(parsed.walletAddress)) || !publicKeyPattern.test(String(parsed.publicKey)) || typeof parsed.expiry !== "number" || !Number.isSafeInteger(parsed.expiry) || parsed.expiry <= 0 || !record(parsed.permissions)) invalidSession();
  const permissions = parsed.permissions;
  if (!Object.keys(permissions).every((key) => key === "calls" || key === "spend")) invalidSession();
  if (permissions.calls !== undefined) {
    if (!Array.isArray(permissions.calls)) invalidSession();
    for (const call of permissions.calls) {
      if (!record(call) || !exactKeys(call, ["signature", "to"]) || typeof call.signature !== "string" || call.signature.length === 0 || call.signature.length > 256 || typeof call.to !== "string" || !addressPattern.test(call.to)) invalidSession();
    }
  }
  if (permissions.spend !== undefined) {
    if (!Array.isArray(permissions.spend)) invalidSession();
    for (const spend of permissions.spend) {
      if (!record(spend) || !(["limit", "period"].every((key) => key in spend) && Object.keys(spend).every((key) => key === "limit" || key === "period" || key === "token")) || decimal(spend.limit) === null || typeof spend.period !== "string" || !periods.has(spend.period) || (spend.token !== undefined && (typeof spend.token !== "string" || !addressPattern.test(spend.token)))) invalidSession();
    }
  }
  return parsed as SerializedSession;
}

function mismatch(): never {
  throw new CreatorAuthorityError("CREATOR_SESSION_MISMATCH", "The supplied session does not match the persisted Creator authority.");
}

type TargetedCall = { readonly to: string; readonly signature: string };

function targetedCalls(value: readonly unknown[] | undefined): readonly TargetedCall[] | null {
  if (value === undefined) return null;
  const calls: TargetedCall[] = [];
  for (const call of value) {
    if (!record(call) || typeof call.to !== "string" || typeof call.signature !== "string") return null;
    calls.push({ to: call.to, signature: call.signature });
  }
  return calls;
}

function sameCallSet(actual: readonly TargetedCall[] | null, expected: readonly TargetedCall[] | null): boolean {
  if (actual === null || expected === null || actual.length !== expected.length) return false;
  const normalize = (call: { readonly to: string; readonly signature: string }) => `${call.to.toLowerCase()}:${call.signature}`;
  const left = actual.map(normalize).sort();
  const right = expected.map(normalize).sort();
  return left.every((value, index) => value === right[index]);
}

function sameSpendSet(actual: readonly { readonly limit: bigint; readonly period: string; readonly token?: string }[] | undefined, expected: readonly { readonly limit: bigint; readonly period: string; readonly token?: string }[] | undefined): boolean {
  if (actual === undefined || expected === undefined || actual.length !== expected.length) return false;
  const normalize = (spend: { readonly limit: bigint; readonly period: string; readonly token?: string }) => `${spend.limit.toString()}:${spend.period}:${spend.token?.toLowerCase() ?? "native"}`;
  const left = actual.map(normalize).sort();
  const right = expected.map(normalize).sort();
  return left.every((value, index) => value === right[index]);
}

function safeHandoffError(error: unknown): CreatorAuthorityError {
  if (error instanceof CreatorAuthorityError) return error;
  return new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "The Creator authority handoff could not be completed.");
}

/**
 * Verify one browser-created SDK session against server-owned authority
 * metadata, then hand it to the configured sink exactly once. This service
 * never returns or persists the session signer/private key.
 */
export async function handoffCreatorAuthority(input: {
  readonly draftId: string;
  readonly ownerAddress: string;
  readonly authority: CreatorBrowserAuthority;
  readonly serializedSession: unknown;
  readonly sessionPrivateKey: string;
  readonly gateway: CreatorAuthorityGateway;
  readonly sink: RuntimeSessionSecretSink;
  readonly store: HandoffStore;
  readonly nowUnix?: number;
}): Promise<CreatorAuthorityPublicStatus> {
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(nowUnix) || nowUnix <= 0) throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "Creator authority time is invalid.");
  if (input.authority.draftId !== input.draftId || input.authority.ownerAddress.toLowerCase() !== input.ownerAddress.toLowerCase()) throw new CreatorAuthorityError("CREATOR_AUTHORITY_OWNERSHIP", "The authority is not owned by this Creator draft.");
  if (input.authority.status !== "active" || input.authority.expiresAtUnix <= nowUnix) throw new CreatorAuthorityError("CREATOR_AUTHORITY_NOT_ACTIVE", "The Creator authority is no longer active.");
  if (!privateKeyPattern.test(input.sessionPrivateKey)) throw new CreatorAuthorityError("CREATOR_SESSION_INVALID", "The supplied Altana session key is invalid.");

  const stored = parseCreatorSerializedSession(input.serializedSession);
  let signer;
  try { signer = signerFromPrivateKey(input.sessionPrivateKey as `0x${string}`); } catch { throw new CreatorAuthorityError("CREATOR_SESSION_INVALID", "The supplied Altana session key is invalid."); }
  if (signer.publicKey.toLowerCase() !== String(stored.publicKey).toLowerCase() || signer.publicKey.toLowerCase() !== input.authority.sessionPublicKey.toLowerCase() || signer.address.toLowerCase() !== input.authority.sessionPublicAddress.toLowerCase() || stored.walletAddress.toLowerCase() !== input.authority.walletAddress.toLowerCase()) mismatch();

  const grantIssuedAtUnix = input.authority.expiresAtUnix - 3600;
  if (!Number.isSafeInteger(grantIssuedAtUnix) || grantIssuedAtUnix <= 0 || grantIssuedAtUnix > nowUnix) throw new CreatorAuthorityError("CREATOR_POLICY_MISMATCH", "The persisted Creator authority expiry is outside the fixed grant window.");
  let grant: ReturnType<typeof creatorAuthorityGrant>;
  try {
    grant = creatorAuthorityGrant({ adminAddress: input.authority.ownerAddress as `0x${string}`, walletAddress: input.authority.walletAddress as `0x${string}`, sessionPublicAddress: input.authority.sessionPublicAddress as `0x${string}`, sessionPublicKey: input.authority.sessionPublicKey as `0x${string}`, nowUnix: grantIssuedAtUnix });
  } catch { throw new CreatorAuthorityError("CREATOR_POLICY_MISMATCH", "The persisted Creator authority policy is not valid."); }
  if (grant.policy.expiresAtUnix !== input.authority.expiresAtUnix || grant.policyDigest.toLowerCase() !== input.authority.policyDigest.toLowerCase()) throw new CreatorAuthorityError("CREATOR_POLICY_MISMATCH", "The persisted Creator authority does not match the server-locked policy.");

  let session;
  try { session = deserializeSession(stored, signer); } catch { throw new CreatorAuthorityError("CREATOR_SESSION_INVALID", "The supplied Altana session could not be reconstructed."); }
  if (session.expiry !== input.authority.expiresAtUnix || !sameCallSet(targetedCalls(session.permissions.calls), targetedCalls(grant.sdk.permissions.calls)) || !sameSpendSet(session.permissions.spend, grant.sdk.permissions.spend)) mismatch();

  const descriptor = {
    sessionId: `creator-browser:${input.draftId}:${input.authority.sessionPublicAddress.slice(2, 14).toLowerCase()}`,
    policy: grant.policy,
    policyDigest: grant.policyDigest,
    grantTransactionHash: input.authority.grantTransactionHash as `0x${string}` | null,
    secretReference: null,
    grantedAtUnix: grantIssuedAtUnix,
  } as const;
  const destination: SecretReference = creatorLocalStudioDestination(creatorRuntimeName(input.draftId), input.authority.authorityId);
  const canonicalCalls = targetedCalls(grant.sdk.permissions.calls) ?? [];
  const canonical = JSON.stringify({
    version: 1,
    walletAddress: session.walletAddress.toLowerCase(),
    publicKey: signer.publicKey.toLowerCase(),
    expiry: session.expiry,
    permissions: {
      calls: canonicalCalls.map((call) => ({ to: call.to.toLowerCase(), signature: call.signature })),
      spend: (grant.sdk.permissions.spend ?? []).map((spend) => ({ limit: { $bigint: spend.limit.toString(10) }, period: spend.period, ...(spend.token === undefined ? {} : { token: spend.token.toLowerCase() }) })),
    },
    signer: { type: "privateKey", privateKey: input.sessionPrivateKey.toLowerCase() },
  });
  const material = new EphemeralSessionMaterial(Buffer.from(canonical, "utf8"));
  try {
    try {
      return await confirmCreatorAuthority({ authorityId: input.authority.authorityId, draftId: input.draftId, ownerAddress: input.ownerAddress, descriptor, material, destination, sink: input.sink, gateway: input.gateway, store: input.store, drafts: input.store, nowUnix });
    } catch (error) { throw safeHandoffError(error); }
  } finally {
    material.dispose();
  }
}
