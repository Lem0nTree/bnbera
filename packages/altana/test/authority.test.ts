import assert from "node:assert/strict";
import test from "node:test";
import { EphemeralSessionMaterial, authorityPolicyDigest, confirmCreatorAuthority, readCreatorAuthority, requireRuntimeAuthority, revokeCreatorAuthority, type CreatorAuthorityRecord, type CreatorAuthorityStore, type RuntimeSessionDescriptor, type ScopedPolicy } from "../src/index.ts";

const policy: ScopedPolicy = { chainId: 97, adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc", sessionPublicKey: `0x04${"11".repeat(64)}` as `0x${string}`, calls: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", selectors: ["0x12345678"], maxNativeValueWei: 0n }], spend: [], expiresAtUnix: 2_000_000_000 };
const descriptor: RuntimeSessionDescriptor = { sessionId: "authority-1", policy, policyDigest: authorityPolicyDigest(policy), grantTransactionHash: null, secretReference: null, grantedAtUnix: 1_700_000_000 };

test("authority handoff stores only a reference and rejects replay/revocation", async () => {
  let record: CreatorAuthorityRecord | null = null;
  const store: CreatorAuthorityStore = { async get(id) { return record?.authorityId === id ? record : null; }, async getByDraft(id) { return record?.draftId === id ? record : null; }, async put(next) { record = next; } };
  let revoked = false;
  const gateway = { async read() { return { sessionId: "authority-1", policyDigest: descriptor.policyDigest, status: revoked ? "revoked" as const : "active" as const, observedAtUnix: 1_700_000_001, observedBlockNumber: 1n, source: "chain-read" as const, reasonCode: null }; }, async revoke() { revoked = true; return this.read(); } };
  const sink = { async putRuntimeSession(input: { readonly bytes: Uint8Array }) { assert.equal(new TextDecoder().decode(input.bytes), "session-secret"); return { handoffId: "handoff-1", destination: { provider: "local-test-only" as const, reference: "ref/authority-1" }, sessionId: "authority-1", policyDigest: descriptor.policyDigest, acceptedAtUnix: 1_700_000_001, consumed: true as const }; } };
  const drafts = { async ownerAddressForDraft() { return policy.adminAddress; } };
  const status = await confirmCreatorAuthority({ authorityId: "authority-1", draftId: "draft-1", ownerAddress: policy.adminAddress, descriptor, material: new EphemeralSessionMaterial(new TextEncoder().encode("session-secret")), destination: { provider: "local-test-only", reference: "ref/authority-1" }, sink, gateway, store, drafts, nowUnix: 1_700_000_001 });
  assert.equal(status.status, "active");
  assert.notEqual(record, null);
  const persisted = record as unknown as CreatorAuthorityRecord;
  assert.equal(persisted.secretReference, "ref/authority-1");
  assert.equal("material" in persisted, false);
  await assert.rejects(() => confirmCreatorAuthority({ authorityId: "authority-2", draftId: "draft-1", ownerAddress: policy.adminAddress, descriptor, material: new EphemeralSessionMaterial(new TextEncoder().encode("x")), destination: { provider: "local-test-only", reference: "ref/authority-1" }, sink, gateway, store, drafts, nowUnix: 1_700_000_001 }));
  await revokeCreatorAuthority(store, gateway, "authority-1", 1_700_000_001);
  await assert.rejects(() => requireRuntimeAuthority({ store, gateway, authorityId: "authority-1", request: { target: policy.calls[0].target, selector: "0x12345678", valueWei: 0n, spends: [] }, cumulativeSpend: [], nowUnix: 1_700_000_001 }));
});

test("verifies live authority before consuming material and reloads a durable handoff", async () => {
  let record: CreatorAuthorityRecord | null = null;
  const store: CreatorAuthorityStore = { async get(id) { return record?.authorityId === id ? record : null; }, async getByDraft(id) { return record?.draftId === id ? record : null; }, async put(next) { record = next; } };
  let reads = 0;
  const gateway = { async read() { reads += 1; return { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "active" as const, observedAtUnix: 1_700_000_001, observedBlockNumber: 1n, source: "chain-read" as const, reasonCode: null }; }, async revoke() { return { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "revoked" as const, observedAtUnix: 1_700_000_001, observedBlockNumber: 1n, source: "chain-read" as const, reasonCode: "USER_REVOKED" }; } };
  let sinkCalls = 0;
  const sink = { async putRuntimeSession() { sinkCalls += 1; return { handoffId: "handoff-reload", destination: { provider: "local-test-only" as const, reference: "ref/authority-reload" }, sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, acceptedAtUnix: 1_700_000_001, consumed: true as const }; } };
  const input = { authorityId: "authority-reload", draftId: "draft-reload", ownerAddress: policy.adminAddress, descriptor, destination: { provider: "local-test-only" as const, reference: "ref/authority-reload" }, sink, gateway, store, drafts: { async ownerAddressForDraft() { return policy.adminAddress; } }, nowUnix: 1_700_000_001 };
  await confirmCreatorAuthority({ ...input, material: new EphemeralSessionMaterial(new Uint8Array([1])) });
  const reloaded = await confirmCreatorAuthority({ ...input, material: new EphemeralSessionMaterial(new Uint8Array([2])) });
  assert.equal(reloaded.status, "active");
  assert.equal(sinkCalls, 1);
  assert.equal(reads, 2);
});

test("does not consume material when the pre-handoff live read is not active", async () => {
  const material = new EphemeralSessionMaterial(new Uint8Array([1]));
  let sinkCalls = 0;
  const store: CreatorAuthorityStore = { async get() { return null; }, async getByDraft() { return null; }, async put() {} };
  await assert.rejects(() => confirmCreatorAuthority({ authorityId: "authority-inactive", draftId: "draft-inactive", ownerAddress: policy.adminAddress, descriptor, material, destination: { provider: "local-test-only", reference: "ref/inactive" }, sink: { async putRuntimeSession() { sinkCalls += 1; throw new Error("must not run"); } }, gateway: { async read() { return { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "revoked" as const, observedAtUnix: 1_700_000_001, observedBlockNumber: 1n, source: "chain-read" as const, reasonCode: "USER_REVOKED" }; }, async revoke() { throw new Error("must not run"); } }, store, drafts: { async ownerAddressForDraft() { return policy.adminAddress; } }, nowUnix: 1_700_000_001 }));
  assert.equal(sinkCalls, 0);
  assert.equal(material.consumed, false);
});

test("revoke freshness is evaluated from its completed observation", async () => {
  let record: CreatorAuthorityRecord | null = { authorityId: "authority-revoke-time", draftId: "draft-revoke-time", ownerAddress: policy.adminAddress, descriptor: { ...descriptor, secretReference: "ref/revoke-time" }, secretReference: "ref/revoke-time", handoff: { handoffId: "handoff-revoke-time", destinationProvider: "local-test-only", sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, acceptedAtUnix: 1_700_000_001, consumed: true }, observation: { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "active", observedAtUnix: 1_700_000_001, observedBlockNumber: 1n, source: "chain-read", reasonCode: null } };
  const store: CreatorAuthorityStore = { async get() { return record; }, async getByDraft() { return record; }, async put(next) { record = next; } };
  await assert.doesNotReject(() => revokeCreatorAuthority(store, { async read() { throw new Error("unused"); }, async revoke() { return { sessionId: descriptor.sessionId, policyDigest: descriptor.policyDigest, status: "revoked" as const, observedAtUnix: 1_700_000_120, observedBlockNumber: 2n, source: "chain-read" as const, reasonCode: "USER_REVOKED" }; } }, "authority-revoke-time", 1_700_000_001));
});

test("reload refreshes status, derives actual expiry, and rejects runtime execution", async () => {
  let record: CreatorAuthorityRecord | null = null;
  const store: CreatorAuthorityStore = { async get() { return record; }, async getByDraft() { return record; }, async put(next) { record = next; } };
  const expiresAtUnix = 1_700_000_010;
  const expiringPolicy = { ...policy, expiresAtUnix };
  const expiring = { ...descriptor, policy: expiringPolicy, policyDigest: authorityPolicyDigest(expiringPolicy) };
  let reads = 0;
  const gateway = { async read() { reads += 1; const observedAtUnix = reads === 1 ? 1_700_000_001 : 1_700_000_009; return { sessionId: expiring.sessionId, policyDigest: expiring.policyDigest, status: "active" as const, observedAtUnix, observedBlockNumber: 9n, source: "chain-read" as const, reasonCode: null }; }, async revoke() { return { sessionId: expiring.sessionId, policyDigest: expiring.policyDigest, status: "revoked" as const, observedAtUnix: 1_700_000_009, observedBlockNumber: 9n, source: "chain-read" as const, reasonCode: "USER_REVOKED" }; } };
  const sink = { async putRuntimeSession() { return { handoffId: "handoff-2", destination: { provider: "local-test-only" as const, reference: "ref/authority-2" }, sessionId: expiring.sessionId, policyDigest: expiring.policyDigest, acceptedAtUnix: 1_700_000_001, consumed: true as const }; } };
  await confirmCreatorAuthority({ authorityId: "authority-2", draftId: "draft-2", ownerAddress: policy.adminAddress, descriptor: expiring, material: new EphemeralSessionMaterial(new Uint8Array([1])), destination: { provider: "local-test-only", reference: "ref/authority-2" }, sink, gateway, store, drafts: { async ownerAddressForDraft() { return policy.adminAddress; } }, nowUnix: 1_700_000_001 });
  const status = await readCreatorAuthority(store, gateway, "authority-2", expiresAtUnix);
  assert.equal(status.status, "expired");
  assert.equal(status.reasonCode, "AUTHORITY_EXPIRED");
  assert.equal(status.observedAtUnix, 1_700_000_009);
  const persisted = await store.get("authority-2");
  if (persisted === null) throw new Error("authority was not persisted");
  assert.equal("material" in persisted, false);
  assert.equal(persisted.secretReference, "ref/authority-2");
  await assert.rejects(() => requireRuntimeAuthority({ store, gateway, authorityId: "authority-2", request: { target: policy.calls[0].target, selector: "0x12345678", valueWei: 0n, spends: [] }, cumulativeSpend: [], nowUnix: expiresAtUnix }));
});

test("rejects a descriptor whose digest is not bound to its reviewed policy", async () => {
  const store: CreatorAuthorityStore = { async get() { return null; }, async getByDraft() { return null; }, async put() {} };
  await assert.rejects(() => confirmCreatorAuthority({ authorityId: "authority-3", draftId: "draft-3", ownerAddress: policy.adminAddress, descriptor: { ...descriptor, policyDigest: `0x${"00".repeat(32)}` }, material: new EphemeralSessionMaterial(new Uint8Array([1])), destination: { provider: "local-test-only", reference: "ref/authority-3" }, sink: { async putRuntimeSession() { throw new Error("must not run"); } }, gateway: { async read() { throw new Error("must not run"); }, async revoke() { throw new Error("must not run"); } }, store, drafts: { async ownerAddressForDraft() { return policy.adminAddress; } }, nowUnix: 1_700_000_001 }));
});
