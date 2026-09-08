import { describe, expect, it } from "vitest";
import {
  allowlistedGreenfieldReadUrl,
  projectEvidenceProjection,
  projectGreenfieldEvidence
} from "../evidence.js";

const SHA = "a".repeat(64);
const KECCAK = "b".repeat(64);
const SEAL = `0x${"c".repeat(64)}`;
const CHECKED_AT = "2026-09-08T00:00:00.000Z";
const PUBLICATION_ATTEMPT = "00000000-0000-4000-8000-000000000001";

function graph(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: "agent_profile",
    artifactId: "profile-2206",
    version: 1,
    objectState: "verified",
    objectSha256Digest: SHA,
    objectKeccak256Digest: KECCAK,
    objectSizeBytes: 128,
    objectSealTransactionHash: SEAL,
    objectReadbackVerifiedAt: CHECKED_AT,
    readUrl: "https://greenfield.example/read/profile-2206-v1.json",
    locator: {
      provider: "greenfield",
      uri: "greenfield://public/evidence/profile-2206-v1.json",
      bucket: "public",
      objectName: "evidence/profile-2206-v1.json",
      providerReference: "object-ref-1",
      version: 1,
      sha256Digest: SHA,
      keccak256Digest: KECCAK,
      sizeBytes: 128,
      immutable: true,
      verifiedAt: CHECKED_AT,
      publicationAttemptId: PUBLICATION_ATTEMPT
    },
    verification: {
      status: "verified",
      sealConfirmed: true,
      readbackStatus: "matched",
      expectedSha256Digest: SHA,
      observedSha256Digest: SHA,
      expectedKeccak256Digest: KECCAK,
      observedKeccak256Digest: KECCAK,
      expectedSizeBytes: 128,
      observedSizeBytes: 128,
      hashesMatch: true,
      sizeMatches: true,
      reasonCode: null,
      checkedAt: CHECKED_AT,
      publicationAttemptId: PUBLICATION_ATTEMPT
    },
    ...overrides
  };
}

describe("marketplace Greenfield evidence projection", () => {
  it("exposes a verified profile only with matching read-back graph and allowlisted HTTPS URL", () => {
    const result = projectGreenfieldEvidence(graph(), {
      allowedReadUrlOrigins: ["https://greenfield.example"]
    });
    expect(result).toMatchObject({
      artifactType: "agent_profile",
      status: "verified",
      provider: "greenfield",
      readUrl: "https://greenfield.example/read/profile-2206-v1.json",
      locator: "greenfield://public/evidence/profile-2206-v1.json",
      version: 1,
      sizeBytes: 128,
      sha256Digest: SHA,
      keccak256Digest: KECCAK,
      sealTransactionHash: SEAL
    });
  });

  it.each([
    ["non-HTTPS URL", "http://greenfield.example/profile.json"],
    ["malicious URL", "javascript:alert(1)"],
    ["unallowlisted HTTPS URL", "https://other.example/profile.json"]
  ])("rejects %s without hiding the artifact status", (_label, readUrl) => {
    const result = projectGreenfieldEvidence(graph({ readUrl }), {
      allowedReadUrlOrigins: ["https://greenfield.example"]
    });
    expect(result.status).toBe("unavailable");
    expect(result.readUrl).toBeNull();
    expect(result.locator).toBeNull();
    expect(result.reason).toBe("GREENFIELD_READ_URL_UNAVAILABLE");
  });

  it("does not expose a locator from IPFS, a failed verification, or mismatched size", () => {
    const ipfs = projectGreenfieldEvidence(graph({ locator: { provider: "ipfs", uri: "ipfs://cid" } }), {
      allowedReadUrlOrigins: ["https://greenfield.example"]
    });
    const failed = projectGreenfieldEvidence(graph({ verification: { ...graph().verification, status: "failed" } }), {
      allowedReadUrlOrigins: ["https://greenfield.example"]
    });
    const mismatch = projectGreenfieldEvidence(graph({ objectSizeBytes: 129 }), {
      allowedReadUrlOrigins: ["https://greenfield.example"]
    });
    expect(ipfs).toMatchObject({ status: "unavailable", readUrl: null, locator: null });
    expect(failed).toMatchObject({ status: "failed", readUrl: null, locator: null });
    expect(mismatch).toMatchObject({ status: "unavailable", readUrl: null, locator: null });
  });

  it("keeps pending publication explicit and isolates profile/run-bundle records", () => {
    const pending = projectGreenfieldEvidence(graph({
      version: 2,
      objectState: "awaiting_seal",
      verification: { ...graph().verification, status: "not_verified", sealConfirmed: null }
    }), { allowedReadUrlOrigins: ["https://greenfield.example"] });
    const projection = projectEvidenceProjection([
      graph(),
      { ...graph({ artifactType: "run_bundle", artifactId: "job-2206", jobId: "00000000-0000-4000-8000-000000000003", readUrl: "https://greenfield.example/read/job-2206.json" }) },
      graph({
        artifactType: "agent_profile",
        version: 2,
        objectState: "awaiting_seal",
        verification: { ...graph().verification, status: "not_verified", sealConfirmed: null }
      })
    ], { allowedReadUrlOrigins: ["https://greenfield.example"] });
    expect(pending.status).toBe("pending");
    expect(projection.profile.status).toBe("verified");
    expect(projection.runBundle.status).toBe("verified");
  });

  it("accepts only credential-free HTTPS links from the configured origin", () => {
    expect(allowlistedGreenfieldReadUrl("https://greenfield.example/object", ["https://greenfield.example"])).toBe("https://greenfield.example/object");
    expect(allowlistedGreenfieldReadUrl("https://user:pass@greenfield.example/object", ["https://greenfield.example"])).toBeNull();
    expect(allowlistedGreenfieldReadUrl("http://greenfield.example/object", ["https://greenfield.example"])).toBeNull();
  });

  it("does not combine a locator and verification from different publication attempts", () => {
    const mismatched = projectGreenfieldEvidence(graph({
      locator: { ...graph().locator, publicationAttemptId: "00000000-0000-4000-8000-000000000002" }
    }), { allowedReadUrlOrigins: ["https://greenfield.example"] });
    expect(mismatched).toMatchObject({ status: "unavailable", readUrl: null, locator: null });
    const matched = projectGreenfieldEvidence(graph(), { allowedReadUrlOrigins: ["https://greenfield.example"] });
    expect(matched.status).toBe("verified");
  });

  it("can derive a read URL only from an explicit HTTPS base", () => {
    const result = projectGreenfieldEvidence(graph({ readUrl: null, locator: { ...graph().locator, providerReference: "object-ref-1" } }), {
      readUrlBase: "https://greenfield.example/read"
    });
    expect(result).toMatchObject({
      status: "verified",
      readUrl: "https://greenfield.example/read/public/evidence/profile-2206-v1.json"
    });
  });
});
