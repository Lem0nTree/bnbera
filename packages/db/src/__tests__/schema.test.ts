import { describe, expect, it } from "vitest";
import {
  agentListingEmbeddings,
  agents,
  authSessions,
  erc8004Identities,
  schemaTables
} from "../schema.js";

describe("foundation database schema", () => {
  it("contains the complete identity key and independent marketplace axes", () => {
    expect(Object.keys(erc8004Identities)).toEqual(
      expect.arrayContaining(["namespace", "chainId", "identityRegistry", "agentId", "ownerAddress", "agentWallet"])
    );
    expect(Object.keys(agents)).toEqual(
      expect.arrayContaining([
        "originType",
        "claimStatus",
        "verificationStatus",
        "runtimeStatus",
        "authorityStatus",
        "listingStatus"
      ])
    );
  });

  it("keeps session storage to a digest and includes the pinned vector shape", () => {
    expect(Object.keys(authSessions)).toContain("tokenDigest");
    expect(Object.keys(authSessions)).not.toContain("token");
    expect(Object.keys(agentListingEmbeddings)).toEqual(
      expect.arrayContaining(["embedding", "provider", "model", "dimension", "sourceTextDigest"])
    );
  });

  it("exports every foundation table for downstream repositories", () => {
    expect(Object.keys(schemaTables).length).toBeGreaterThanOrEqual(20);
  });
});
