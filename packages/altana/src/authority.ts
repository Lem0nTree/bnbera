import { keccak256, stringToHex } from "viem";
import { AltanaBoundaryError } from "./errors.ts";
import { handoffRuntimeSession, type EphemeralSessionMaterial, type RuntimeSessionSecretSink } from "./ephemeral-session.ts";
import { executionGate } from "./lifecycle.ts";
import { assertPolicyValidAt, serializePolicy, toPublicPolicySummary } from "./policy.ts";
import type { ActionRequest, CumulativeSpend, PublicSessionHandoffReceipt, RuntimeSessionDescriptor, SecretReference, SessionStateObservation, ScopedPolicy } from "./types.ts";

/** Public-only record returned by Creator authority routes. */
export interface CreatorAuthorityPublicStatus {
  readonly authorityId: string;
  readonly draftId: string;
  readonly ownerAddress: string;
  readonly policy: ReturnType<typeof toPublicPolicySummary>;
  readonly policyDigest: `0x${string}`;
  readonly expiresAtUnix: number;
  readonly status: SessionStateObservation["status"];
  readonly observedBlockNumber: string | null;
  readonly reasonCode: string | null;
}

export interface CreatorAuthorityRecord {
  readonly authorityId: string;
  readonly draftId: string;
  readonly ownerAddress: string;
  readonly descriptor: RuntimeSessionDescriptor;
  readonly secretReference: string;
  readonly handoff: PublicSessionHandoffReceipt;
  readonly observation: SessionStateObservation;
}

export interface CreatorAuthorityStore {
  getByDraft(draftId: string): Promise<CreatorAuthorityRecord | null>;
  get(authorityId: string): Promise<CreatorAuthorityRecord | null>;
  put(record: CreatorAuthorityRecord): Promise<void>;
}

/** Trusted draft ownership comes from server-side Creator persistence, never a request body. */
export interface CreatorAuthorityDraftResolver {
  ownerAddressForDraft(draftId: string): Promise<string | null>;
}

export interface CreatorAuthorityGateway {
  /** Must be an SDK/chain read, not a cache or client-provided status. */
  read(descriptor: RuntimeSessionDescriptor): Promise<SessionStateObservation>;
  revoke(descriptor: RuntimeSessionDescriptor): Promise<SessionStateObservation>;
}

export function authorityPolicyDigest(policy: ScopedPolicy): `0x${string}` {
  return keccak256(stringToHex(serializePolicy(policy)));
}

function assertLiveObservation(observation: SessionStateObservation): void {
  if (observation.source === "test" || observation.source === "keystore-read") {
    throw new AltanaBoundaryError("AUTHORITY_READ_REQUIRED", "Creator authority requires a live SDK or chain observation.");
  }
}

function assertBoundFreshObservation(descriptor: RuntimeSessionDescriptor, observation: SessionStateObservation, nowUnix: number): void {
  assertLiveObservation(observation);
  if (descriptor.policyDigest === null || observation.policyDigest === null || observation.sessionId !== descriptor.sessionId || observation.policyDigest.toLowerCase() !== descriptor.policyDigest.toLowerCase() || observation.observedAtUnix > nowUnix || nowUnix - observation.observedAtUnix > 60) {
    throw new AltanaBoundaryError("AUTHORITY_READ_REQUIRED", "Authority observation is not fresh and bound to the granted session policy.");
  }
}

function publicStatus(record: CreatorAuthorityRecord): CreatorAuthorityPublicStatus {
  return {
    authorityId: record.authorityId,
    draftId: record.draftId,
    ownerAddress: record.ownerAddress,
    policy: toPublicPolicySummary(record.descriptor.policy),
    policyDigest: record.descriptor.policyDigest ?? authorityPolicyDigest(record.descriptor.policy),
    expiresAtUnix: record.descriptor.policy.expiresAtUnix,
    status: record.observation.status,
    observedBlockNumber: record.observation.observedBlockNumber?.toString() ?? null,
    reasonCode: record.observation.reasonCode,
  };
}

/**
 * Persist only the secret-manager reference after the browser's one-time
 * handoff.  This deliberately has no request shape containing session bytes.
 */
export async function confirmCreatorAuthority(input: {
  readonly authorityId: string;
  readonly draftId: string;
  readonly ownerAddress: string;
  readonly descriptor: RuntimeSessionDescriptor;
  readonly material: EphemeralSessionMaterial;
  readonly destination: SecretReference;
  readonly sink: RuntimeSessionSecretSink;
  readonly gateway: CreatorAuthorityGateway;
  readonly store: CreatorAuthorityStore;
  readonly drafts: CreatorAuthorityDraftResolver;
  readonly nowUnix: number;
}): Promise<CreatorAuthorityPublicStatus> {
  assertPolicyValidAt(input.descriptor.policy, input.nowUnix);
  const trustedOwner = await input.drafts.ownerAddressForDraft(input.draftId);
  if (trustedOwner === null || trustedOwner.toLowerCase() !== input.ownerAddress.toLowerCase() || trustedOwner.toLowerCase() !== input.descriptor.policy.adminAddress.toLowerCase()) {
    throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority owner does not match the authenticated draft owner.");
  }
  const existing = await input.store.getByDraft(input.draftId);
  if (existing !== null) {
    throw new AltanaBoundaryError("SESSION_HANDOFF_FAILED", "Creator authority has already been confirmed for this draft.");
  }
  if (input.descriptor.secretReference !== null) throw new AltanaBoundaryError("SESSION_HANDOFF_FAILED", "A browser grant cannot pre-populate a secret reference.");
  const handoff = await handoffRuntimeSession({ material: input.material, descriptor: input.descriptor, destination: input.destination, sink: input.sink, nowUnix: input.nowUnix });
  const observation = await input.gateway.read(input.descriptor);
  assertBoundFreshObservation(input.descriptor, observation, input.nowUnix);
  if (observation.status !== "active") {
    throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "The granted authority could not be independently verified.");
  }
  const record: CreatorAuthorityRecord = { authorityId: input.authorityId, draftId: input.draftId, ownerAddress: input.ownerAddress.toLowerCase(), descriptor: { ...input.descriptor, secretReference: handoff.destination.reference }, secretReference: handoff.destination.reference, handoff: { handoffId: handoff.handoffId, destinationProvider: handoff.destination.provider, sessionId: handoff.sessionId, policyDigest: handoff.policyDigest, acceptedAtUnix: handoff.acceptedAtUnix, consumed: true }, observation };
  await input.store.put(record);
  return publicStatus(record);
}

export async function readCreatorAuthority(store: CreatorAuthorityStore, gateway: CreatorAuthorityGateway, authorityId: string, nowUnix = Math.floor(Date.now() / 1000)): Promise<CreatorAuthorityPublicStatus> {
  const record = await store.get(authorityId);
  if (record === null) throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority was not found.");
  const observation = await gateway.read(record.descriptor);
  assertBoundFreshObservation(record.descriptor, observation, nowUnix);
  const updated = { ...record, observation };
  await store.put(updated);
  return publicStatus(updated);
}

export async function revokeCreatorAuthority(store: CreatorAuthorityStore, gateway: CreatorAuthorityGateway, authorityId: string, nowUnix = Math.floor(Date.now() / 1000)): Promise<CreatorAuthorityPublicStatus> {
  const record = await store.get(authorityId);
  if (record === null) throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority was not found.");
  const observation = await gateway.revoke(record.descriptor);
  assertBoundFreshObservation(record.descriptor, observation, nowUnix);
  if (observation.status !== "revoked") throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority revocation was not confirmed.");
  const updated = { ...record, observation };
  await store.put(updated);
  return publicStatus(updated);
}

/** Runtime receives a descriptor/reference only, after a fresh live authority read. */
export async function requireRuntimeAuthority(input: { readonly store: CreatorAuthorityStore; readonly gateway: CreatorAuthorityGateway; readonly authorityId: string; readonly request: ActionRequest; readonly cumulativeSpend: readonly CumulativeSpend[]; readonly nowUnix: number }): Promise<Pick<RuntimeSessionDescriptor, "sessionId" | "policy" | "policyDigest" | "secretReference">> {
  const record = await input.store.get(input.authorityId);
  if (record === null) throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority was not found.");
  const observation = await input.gateway.read(record.descriptor);
  assertBoundFreshObservation(record.descriptor, observation, input.nowUnix);
  const gate = executionGate({ descriptor: record.descriptor, observation, request: input.request, cumulativeSpend: input.cumulativeSpend, nowUnix: input.nowUnix });
  if (!gate.allowed) throw new AltanaBoundaryError("SESSION_NOT_ACTIVE", "Creator authority is not active for this runtime action.");
  return { sessionId: record.descriptor.sessionId, policy: record.descriptor.policy, policyDigest: record.descriptor.policyDigest, secretReference: record.secretReference };
}
