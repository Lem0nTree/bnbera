import assert from "node:assert/strict";
import test from "node:test";
import { EphemeralSessionMaterial, confirmCreatorAuthority, requireRuntimeAuthority, revokeCreatorAuthority, type CreatorAuthorityRecord, type CreatorAuthorityStore, type RuntimeSessionDescriptor, type ScopedPolicy } from "../src/index.ts";

const policy: ScopedPolicy = { chainId: 97, adminAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", sessionPublicAddress: "0xcccccccccccccccccccccccccccccccccccccccc", sessionPublicKey: `0x04${"11".repeat(64)}` as `0x${string}`, calls: [{ target: "0xdddddddddddddddddddddddddddddddddddddddd", selectors: ["0x12345678"], maxNativeValueWei: 0n }], spend: [], expiresAtUnix: 2_000_000_000 };
const descriptor: RuntimeSessionDescriptor = { sessionId: "authority-1", policy, policyDigest: "0x1111111111111111111111111111111111111111111111111111111111111111", grantTransactionHash: null, secretReference: null, grantedAtUnix: 1_700_000_000 };

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
