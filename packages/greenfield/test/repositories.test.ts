import { describe, expect, it } from "vitest";
import {
  createEvidenceLocator,
  createVerificationResult,
  digestArtifact
} from "@bnbera/evidence";
import {
  fromEvidenceLocatorRow,
  fromEvidenceObjectRow,
  fromEvidencePublicationAttemptRow,
  fromEvidenceVerificationResultRow,
  toEvidenceLocatorRow,
  toEvidenceObjectRow,
  toEvidencePublicationAttemptRow,
  toEvidenceVerificationResultRow
} from "../src/index.js";
import { publicationAttemptRecordSchema } from "../src/types.js";

const artifact = {
  schemaVersion: "bnbera.evidence/v1",
  artifactType: "run_bundle",
  artifactId: "run-repository-test",
  version: 1,
  environment: "hackathon",
  createdAt: "2026-09-02T08:00:00Z",
  payload: {
    runId: "run-repository-test",
    identity: {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      agentId: "1"
    },
    agentVersion: "test@1.0.0",
    observedAt: "2026-09-02T08:00:00Z",
    observedBlock: "10",
    dataSources: [],
    candidateActions: [],
    rejectedActions: [],
    selectedAction: null,
    simulationOutput: { status: "ok" },
    riskValidations: { status: "passed" },
    policyValidation: { status: "passed" },
    quote: { amount: "1" },
    transactionHash: null,
    receiptSummary: { status: "simulated" },
    beforeState: { value: "1" },
    afterState: { value: "1" },
    ipfsDeliverable: null,
    contentSha256: null,
    contentKeccak256: null,
    finalStatus: "simulated"
  }
} as const;

describe("persistent evidence row mappings", () => {
  it("round-trips object and publication-attempt metadata without raw bytes", () => {
    const digest = digestArtifact(artifact);
    const now = "2026-09-02T08:00:00.000Z";
    const record = publicationAttemptRecordSchema.parse({
      attemptId: "attempt-repository-test",
      idempotencyKey: "repository-test:greenfield",
      provider: "greenfield",
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: "evidence/hackathon/run_bundle/run-repository-test/versions/1/run_bundle.json",
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      state: "awaiting_seal",
      providerReference: "greenfield-ref",
      creationTransactionHash: `0x${"1".repeat(64)}`,
      sealTransactionHash: null,
      locator: null,
      verification: null,
      retryCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      submittedAt: now,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    });
    const object = {
      id: "object-repository-test",
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactSchemaVersion: "bnbera.evidence/v1",
      resourceId: digest.artifact.artifactId,
      version: digest.artifact.version,
      idempotencyKey: "repository-test",
      state: "validating" as const,
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      mimeType: "application/json" as const,
      createdAt: now,
      updatedAt: now
    };
    const objectRoundTrip = fromEvidenceObjectRow(toEvidenceObjectRow(object));
    const attemptRoundTrip = fromEvidencePublicationAttemptRow(
      toEvidencePublicationAttemptRow(record, object.id),
      null,
      null
    );
    expect(objectRoundTrip).toEqual(object);
    expect(attemptRoundTrip).toEqual(record);
  });

  it("maps locator and verification rows as separate correlated records", () => {
    const locator = createEvidenceLocator({
      provider: "greenfield",
      providerLabel: "greenfield-test",
      network: "greenfield_5600-1",
      uri: "greenfield://greenfield-test/object",
      bucket: "greenfield-test",
      objectName: "object",
      providerReference: "ref",
      version: 1,
      sha256Digest: "a".repeat(64),
      keccak256Digest: "b".repeat(64),
      sizeBytes: 12
    });
    const verification = createVerificationResult({
      checkedAt: new Date("2026-09-02T08:00:00Z"),
      sealConfirmed: true,
      expectedSha256Digest: "a".repeat(64),
      observedSha256Digest: "a".repeat(64),
      expectedKeccak256Digest: "b".repeat(64),
      observedKeccak256Digest: "b".repeat(64),
      expectedSizeBytes: 12,
      observedSizeBytes: 12,
      readbackStatus: "matched"
    });
    const locatorRow = toEvidenceLocatorRow({ ...locator, evidenceObjectId: "object-1" }, "attempt-1");
    const verificationRow = toEvidenceVerificationResultRow(
      { ...verification, evidenceObjectId: "object-1" },
      "attempt-1"
    );
    expect(fromEvidenceLocatorRow(locatorRow)).toEqual(locator);
    expect(fromEvidenceVerificationResultRow(verificationRow)).toEqual(verification);
    expect(locatorRow.publication_attempt_id).toBe("attempt-1");
    expect(verificationRow.publication_attempt_id).toBe("attempt-1");
  });
});
