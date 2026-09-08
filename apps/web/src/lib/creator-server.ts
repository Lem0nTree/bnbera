import { getCommerceAuthDatabasePool, requireAuthenticatedCommerceIdentity } from "./commerce-auth";
import { CreatorRepository } from "./creator-repository";
import { unavailableCreatorRuntimeAuthority, type CreatorRuntimeAuthorityResolver } from "./creator-authority-runtime";

export function creatorRepository(): CreatorRepository { return new CreatorRepository(getCommerceAuthDatabasePool()); }
export { requireAuthenticatedCommerceIdentity as requireCreatorIdentity };

/** Replaced by the T6-owned composition only after its live grant/revoke gate. */
export function creatorAuthorityResolver(): CreatorRuntimeAuthorityResolver { return unavailableCreatorRuntimeAuthority; }
