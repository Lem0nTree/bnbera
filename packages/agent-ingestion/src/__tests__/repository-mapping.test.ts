import { describe, expect, it } from "vitest";
import { erc8004IdentityKey, type Erc8004Identity } from "@bnbera/domain";
import {
  claimRecordFromRow,
  claimRecordToRow,
  observationFromRow,
  observationToRow,
  type ChainObservation,
  type ClaimRecord
} from "../index.js";

const identity: Erc8004Identity = {
  namespace: "eip155",
  chainId: 97,
  identityRegistry: "0x1111111111111111111111111111111111111111",
  agentId: "42"
};
const identityKey = erc8004IdentityKey(identity);
const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const wallet = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("repository adapter mappings", () => {
  it("round-trips both observation digests and all observation state", () => {
    const observation: ChainObservation = {
      identityKey,
      identity,
      eventType: "MetadataUpdate",
      transactionHash: "0x" + "11".repeat(32),
      logIndex: 3,
      blockNumber: 123,
      blockHash: "0x" + "22".repeat(32),
      confirmationState: "canonical",
      ownerAddress: owner,
      agentUri: "https://agent.example/metadata.json",
      agentWallet: wallet,
      contentDigest: "33".repeat(32),
      observedFields: ["ownerAddress", "agentWallet", "agentUri", "contentDigest"],
      firstObservedAt: new Date("2026-09-02T00:00:00.000Z"),
      canonicalizedAt: new Date("2026-09-02T00:01:00.000Z"),
      orphanedAt: null,
      payloadDigest: "44".repeat(32)
    };

    const roundTripped = observationFromRow(observationToRow(observation));
    expect(roundTripped).toEqual(observation);
    expect(observationToRow(observation)).toEqual(expect.objectContaining({
      normalizedContentDigest: "33".repeat(32),
      payloadDigest: "44".repeat(32)
    }));
  });

  it("round-trips complete claim provenance, version, status, timestamps, and reason", () => {
    const claim: ClaimRecord = {
      identityKey,
      version: 4,
      status: "stale",
      claimantAddress: owner,
      ownerAddressAtVerification: owner,
      agentWalletAtVerification: wallet,
      verifiedAt: new Date("2026-09-02T00:01:00.000Z"),
      staleAt: new Date("2026-09-02T00:02:00.000Z"),
      lastReason: "owner_transfer"
    };

    const roundTripped = claimRecordFromRow(identityKey, claimRecordToRow(claim));
    expect(roundTripped).toEqual(claim);
    expect(claimRecordToRow(claim)).toEqual({
      claimStatus: "stale",
      claimVersion: 4,
      claimantAddress: owner,
      claimOwnerAddressAtVerification: owner,
      claimAgentWalletAtVerification: wallet,
      claimVerifiedAt: claim.verifiedAt,
      claimStaleAt: claim.staleAt,
      claimLastReason: "owner_transfer"
    });
  });
});
