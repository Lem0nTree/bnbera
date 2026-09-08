/**
 * T6-owned seam. It intentionally returns public descriptor metadata only;
 * Creator never receives session material, passkeys, or a signing authority.
 */
export interface CreatorRuntimeAuthority {
  readonly authorityId: string;
  readonly policyDigest: string;
  readonly secretReference: string;
  readonly expiresAt: string;
}

export interface CreatorRuntimeAuthorityResolver {
  requireRuntimeAuthority(input: { readonly userId: string; readonly draftId: string; readonly authorityId: string }): Promise<CreatorRuntimeAuthority>;
}

export const unavailableCreatorRuntimeAuthority: CreatorRuntimeAuthorityResolver = {
  async requireRuntimeAuthority() {
    throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "A current Altana runtime authority is required before deployment.");
  }
};

export class CreatorAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * Coordinator adapter for T6's exact `requireRuntimeAuthority` export. T7
 * supplies no storage, gateway, session bytes, or signer; the coordinator
 * supplies those T6-only dependencies. The action is the fixed ERC-8004 URI
 * lifecycle write derived from the pinned ABI/lock, never request input.
 */
export function t6RuntimeAuthorityAdapter(input: {
  readonly assertBinding: (binding: { readonly userId: string; readonly draftId: string; readonly authorityId: string }) => Promise<void>;
  readonly requireRuntimeAuthority: (input: { readonly authorityId: string; readonly request: unknown; readonly cumulativeSpend: readonly unknown[]; readonly nowUnix: number }) => Promise<{ readonly sessionId: string; readonly policy: unknown; readonly policyDigest: string | null; readonly secretReference: string | null }>;
  readonly serializePolicy: (policy: unknown) => string;
}): CreatorRuntimeAuthorityResolver {
  return { async requireRuntimeAuthority(binding) {
    await input.assertBinding(binding);
    const { creatorLifecycleAction } = await import("./creator-contract");
    const descriptor = await input.requireRuntimeAuthority({ authorityId: binding.authorityId, request: creatorLifecycleAction, cumulativeSpend: [], nowUnix: Math.floor(Date.now() / 1_000) });
    if (descriptor.policyDigest === null || descriptor.secretReference === null) throw new CreatorAuthorityError("CREATOR_AUTHORITY_UNAVAILABLE", "T6 did not return a verified runtime descriptor.");
    // Import-free comparison keeps this thin adapter aligned with T6's
    // `keccak256(stringToHex(serializePolicy(policy)))` implementation.
    const expected = (await import("./creator-contract")).creatorPolicyDigest(input.serializePolicy(descriptor.policy));
    if (descriptor.policyDigest.toLowerCase() !== expected.toLowerCase()) throw new CreatorAuthorityError("CREATOR_POLICY_MISMATCH", "The T6 authority policy does not match its normalized Keccak digest.");
    return { authorityId: binding.authorityId, policyDigest: expected, secretReference: descriptor.secretReference, expiresAt: "T6-bound" };
  } };
}
