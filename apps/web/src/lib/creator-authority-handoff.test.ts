import { serializeSession, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import type { CreatorAuthorityRecord, CreatorAuthorityStore, RuntimeSessionDescriptor, SessionStateObservation } from "@bnbera/altana";
import { describe, expect, it } from "vitest";
import { creatorAuthorityGrant } from "./creator-altana-grant";
import { handoffCreatorAuthority, parseCreatorSerializedSession } from "./creator-authority-handoff";
import { creatorRuntimeName } from "./creator-local-secret";

const nowUnix = 1_700_000_000;
const privateKey = `0x${"11".repeat(32)}` as `0x${string}`;
const signer = signerFromPrivateKey(privateKey);
const adminAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const walletAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
const draftId = "00000000-0000-4000-8000-000000000001";
const authorityId = "00000000-0000-4000-8000-000000000002";
const grant = creatorAuthorityGrant({ adminAddress, walletAddress, sessionPublicAddress: signer.address, sessionPublicKey: signer.publicKey, nowUnix });
const session: Session = { walletAddress, signer, publicKey: signer.publicKey, permissions: grant.sdk.permissions, expiry: grant.policy.expiresAtUnix };
const serialized = serializeSession(session);
const authority = { authorityId, draftId, ownerAddress: adminAddress, walletAddress, sessionPublicAddress: signer.address, sessionPublicKey: signer.publicKey, policyDigest: grant.policyDigest, expiresAtUnix: grant.policy.expiresAtUnix, status: "active" as const, grantTransactionHash: null, revokeTransactionHash: null };

function observation(descriptor: RuntimeSessionDescriptor): SessionStateObservation {
  return { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "active", observedAtUnix: nowUnix, observedBlockNumber: 123n, source: "chain-read", reasonCode: null };
}

function setup() {
  let stored: CreatorAuthorityRecord | null = null;
  let sinkCalls = 0;
  const store: CreatorAuthorityStore & { ownerAddressForDraft(draft: string): Promise<string | null> } = {
    async get(id) { return stored?.authorityId === id ? stored : null; },
    async getByDraft(id) { return stored?.draftId === id ? stored : null; },
    async put(record) { stored = record; },
    async ownerAddressForDraft(id) { return id === draftId ? adminAddress : null; },
  };
  const gateway = { async read(descriptor: RuntimeSessionDescriptor) { return observation(descriptor); }, async revoke() { throw new Error("unused"); } };
  const sink = { async putRuntimeSession(input: { readonly destination: { readonly provider: "studio-delegated-secret-channel"; readonly reference: string }; readonly descriptor: RuntimeSessionDescriptor; readonly bytes: Uint8Array }) { sinkCalls += 1; return { handoffId: "test-handoff-1", destination: input.destination, sessionId: input.descriptor.sessionId, policyDigest: input.descriptor.policyDigest, acceptedAtUnix: nowUnix, consumed: true as const }; } };
  return { store, gateway, sink, calls: () => sinkCalls, record: () => stored };
}

describe("Creator authority session bridge", () => {
  it("reconstructs the SDK signer, verifies the fixed policy, and stores only a public handoff record", async () => {
    const state = setup();
    const result = await handoffCreatorAuthority({ draftId, ownerAddress: adminAddress, authority, serializedSession: serialized, sessionPrivateKey: privateKey, gateway: state.gateway, sink: state.sink, store: state.store, nowUnix });
    expect(result.status).toBe("active");
    expect(state.calls()).toBe(1);
    const record = state.record();
    expect(record?.secretReference).toBe(`studio-local/${creatorRuntimeName(draftId)}/${authorityId}`);
    expect(JSON.stringify(record, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).not.toContain(privateKey);
  });

  it("reconciles a retry after the sink accepted the exact bytes without a second sink call", async () => {
    const state = setup();
    const args = { draftId, ownerAddress: adminAddress, authority, serializedSession: serialized, sessionPrivateKey: privateKey, gateway: state.gateway, sink: state.sink, store: state.store, nowUnix };
    await handoffCreatorAuthority(args);
    await handoffCreatorAuthority(args);
    expect(state.calls()).toBe(1);
  });

  it("rejects mismatched session expiry or permissions before the sink", async () => {
    const state = setup();
    await expect(handoffCreatorAuthority({ draftId, ownerAddress: adminAddress, authority, serializedSession: { ...serialized, expiry: serialized.expiry - 1 }, sessionPrivateKey: privateKey, gateway: state.gateway, sink: state.sink, store: state.store, nowUnix })).rejects.toMatchObject({ code: "CREATOR_SESSION_MISMATCH" });
    await expect(handoffCreatorAuthority({ draftId, ownerAddress: adminAddress, authority, serializedSession: { ...serialized, permissions: { ...serialized.permissions, calls: [...(serialized.permissions.calls ?? []), { to: adminAddress, signature: "other()" }] } }, sessionPrivateKey: privateKey, gateway: state.gateway, sink: state.sink, store: state.store, nowUnix })).rejects.toMatchObject({ code: "CREATOR_SESSION_MISMATCH" });
    expect(state.calls()).toBe(0);
  });

  it("rejects extra serialized-session fields and a signer/address mismatch", async () => {
    expect(() => parseCreatorSerializedSession({ ...serialized, unexpected: true })).toThrow();
    const state = setup();
    await expect(handoffCreatorAuthority({ draftId, ownerAddress: adminAddress, authority, serializedSession: serialized, sessionPrivateKey: `0x${"22".repeat(32)}`, gateway: state.gateway, sink: state.sink, store: state.store, nowUnix })).rejects.toMatchObject({ code: "CREATOR_SESSION_MISMATCH" });
    expect(state.calls()).toBe(0);
  });
});
