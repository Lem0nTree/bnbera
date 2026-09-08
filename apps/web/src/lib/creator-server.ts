import { getCommerceAuthDatabasePool, requireAuthenticatedCommerceIdentity } from "./commerce-auth";
import { isAbsolute } from "node:path";
import { CreatorRepository } from "./creator-repository";
import { CreatorAuthorityError, unavailableCreatorRuntimeAuthority, type CreatorRuntimeAuthorityResolver } from "./creator-authority-runtime";
import { createPostgresCreatorAuthorityStore } from "./creator-authority-store";
import { readCreatorAuthority, requireRuntimeAuthority, revokeCreatorAuthority, type CreatorAuthorityPublicStatus } from "@bnbera/altana";
import { createLocalCreatorAuthorityComposition, type CreatorAuthorityComposition } from "./creator-t6-composition";
import { createCreatorRegistrationService, type CreatorRegistrationService } from "./creator-registration";

export function creatorRepository(): CreatorRepository { return new CreatorRepository(getCommerceAuthDatabasePool()); }
export function creatorRegistrationService(): CreatorRegistrationService { return createCreatorRegistrationService({ pool: getCommerceAuthDatabasePool() }); }
export { requireAuthenticatedCommerceIdentity as requireCreatorIdentity };

/** Replaced by the T6-owned composition only after its live grant/revoke gate. */
export type AuthorityComposition = CreatorAuthorityComposition;
const globals = globalThis as typeof globalThis & { __bnberaCreatorAuthorityComposition?: AuthorityComposition };
/** Hosting integration registers the reviewed T6 SDK gateway. There is no
 * environment fallback: a URL/key/config typo must leave Creator disabled.
 * The reviewed sink is Studio-owned (`.studio/wallets/altana-session.json`
 * managed as `ALTANA_SESSION`); it alone receives its raw session bytes. */
export function registerCreatorAuthorityComposition(composition: AuthorityComposition): void {
  if (typeof composition.gateway.read !== "function" || typeof composition.gateway.revoke !== "function" || typeof composition.sink.putRuntimeSession !== "function") throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "Creator authority adapters are incomplete.");
  globals.__bnberaCreatorAuthorityComposition = composition;
}
/**
 * Local MVP composition is deliberately opt-in. Both the existing runtime
 * feature flag and an absolute Studio workspace root are required; no
 * guessed path or managed/cloud credential is ever selected implicitly.
 */
export function configuredCreatorAuthorityComposition(): AuthorityComposition | null {
  if (process.env.CREATOR_RUNTIME_AUTHORITY_ENABLED !== "true") return null;
  const existing = globals.__bnberaCreatorAuthorityComposition;
  if (existing !== undefined) return existing;
  const workspaceRoot = process.env.CREATOR_STUDIO_WORKSPACE_ROOT;
  if (workspaceRoot === undefined || !isAbsolute(workspaceRoot) || workspaceRoot === "/") return null;
  const composition = createLocalCreatorAuthorityComposition({ workspaceRoot });
  globals.__bnberaCreatorAuthorityComposition = composition;
  return composition;
}
function authorityComposition(): AuthorityComposition | null { return configuredCreatorAuthorityComposition(); }
function authorityUnavailable(): never { throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "Creator authority is not configured for this runtime."); }
export function creatorAuthorityResolver(): CreatorRuntimeAuthorityResolver {
  const composition = authorityComposition(); if (composition === null) return unavailableCreatorRuntimeAuthority;
  const store = createPostgresCreatorAuthorityStore(getCommerceAuthDatabasePool());
  return { async requireRuntimeAuthority(binding) {
    const authorityRecord = await store.get(binding.authorityId);
    if (authorityRecord === null || authorityRecord.draftId !== binding.draftId) authorityUnavailable();
    const owner = await store.ownerAddressForDraft(binding.draftId);
    if (owner === null) authorityUnavailable();
    const scoped = await getCommerceAuthDatabasePool().query<{ creator_user_id: string }>("SELECT creator_user_id FROM agent_drafts WHERE id=$1", [binding.draftId]);
    if (scoped.rows[0]?.creator_user_id !== binding.userId) authorityUnavailable();
    const descriptor = await requireRuntimeAuthority({ store, gateway: composition.gateway, authorityId: binding.authorityId, request: (await import("./creator-contract")).creatorLifecycleAction, cumulativeSpend: [], nowUnix: Math.floor(Date.now() / 1000) });
    if (descriptor.policyDigest === null || descriptor.secretReference === null) authorityUnavailable();
    return { authorityId: binding.authorityId, policyDigest: descriptor.policyDigest, secretReference: descriptor.secretReference, expiresAt: new Date(descriptor.policy.expiresAtUnix * 1000).toISOString() };
  } };
}
async function assertAuthorityOwner(userId: string, authorityId: string) { const store = createPostgresCreatorAuthorityStore(getCommerceAuthDatabasePool()); const record = await store.get(authorityId); if (record === null) authorityUnavailable(); const row = await getCommerceAuthDatabasePool().query<{ creator_user_id: string }>("SELECT creator_user_id FROM agent_drafts WHERE id=$1", [record.draftId]); if (row.rows[0]?.creator_user_id !== userId) authorityUnavailable(); return { store, record }; }
export async function creatorAuthorityStatus(userId: string, authorityId: string): Promise<CreatorAuthorityPublicStatus> { const composition = authorityComposition(); if (composition === null) authorityUnavailable(); const { store } = await assertAuthorityOwner(userId, authorityId); return readCreatorAuthority(store, composition.gateway, authorityId); }
export async function revokeCreatorAuthorityForUser(userId: string, authorityId: string): Promise<CreatorAuthorityPublicStatus> { const composition = authorityComposition(); if (composition === null) authorityUnavailable(); const { store } = await assertAuthorityOwner(userId, authorityId); return revokeCreatorAuthority(store, composition.gateway, authorityId); }
