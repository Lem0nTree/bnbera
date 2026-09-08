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
  InMemoryEvidenceRepositories,
  toEvidenceLocatorRow,
  toEvidenceObjectRow,
  toEvidencePublicationAttemptRow,
  toEvidenceVerificationResultRow
} from "../src/index.js";
import { publicationAttemptRecordSchema, publicationConfigurationDigest, defaultPublicationConfiguration } from "../src/types.js";
import { deterministicAttemptId } from "../src/publisher.js";

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
const zeroTransactionHash = `0x${"0".repeat(64)}`;

describe("persistent evidence row mappings", () => {
  it("round-trips object and publication-attempt metadata without raw bytes", () => {
    const digest = digestArtifact(artifact);
    const now = "2026-09-02T08:00:00.000Z";
    const record = publicationAttemptRecordSchema.parse({
      attemptId: deterministicAttemptId("repository-test:greenfield", "greenfield"),
      idempotencyKey: "repository-test:greenfield",
      provider: "greenfield",
      providerLabel: defaultPublicationConfiguration.greenfield.providerLabel,
      configurationDigest: publicationConfigurationDigest(defaultPublicationConfiguration),
      configuredNetwork: defaultPublicationConfiguration.greenfield.network,
      configuredBucket: defaultPublicationConfiguration.greenfield.bucket,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: "evidence/hackathon/run_bundle/run-repository-test/versions/1/run_bundle.json",
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      state: "awaiting_seal",
      revision: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
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
      id: "11111111-1111-4111-8111-111111111111",
      runId: null,
      agentId: null,
      benchmarkId: null,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactSchemaVersion: "bnbera.evidence/v1",
      resourceId: "resource-distinct-from-artifact",
      version: digest.artifact.version,
      idempotencyKey: "repository-test",
      state: "validating" as const,
      ipfsUri: null,
      greenfieldBucket: null,
      greenfieldObject: null,
      creationTransactionHash: null,
      sealTransactionHash: null,
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      mimeType: "application/json" as const,
      readbackVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    };
    const objectRoundTrip = fromEvidenceObjectRow(toEvidenceObjectRow(object));
    const attemptRoundTrip = fromEvidencePublicationAttemptRow(
      toEvidencePublicationAttemptRow(record, object.id),
      object,
      null,
      null
    );
    expect(objectRoundTrip).toEqual(object);
    expect(objectRoundTrip.artifactId).not.toBe(objectRoundTrip.resourceId);
    expect(attemptRoundTrip).toEqual(record);

    const normalizedObject = fromEvidenceObjectRow(
      toEvidenceObjectRow({ ...object, sealTransactionHash: zeroTransactionHash })
    );
    expect(normalizedObject.sealTransactionHash).toBeNull();
    const normalizedAttempt = publicationAttemptRecordSchema.parse({ ...record, sealTransactionHash: zeroTransactionHash });
    expect(normalizedAttempt.sealTransactionHash).toBeNull();
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
    const objectId = "22222222-2222-4222-8222-222222222222";
    const attemptId = deterministicAttemptId("repository-locator:greenfield", "greenfield");
    const locatorRow = toEvidenceLocatorRow({ ...locator, evidenceObjectId: objectId }, attemptId);
    const verificationRow = toEvidenceVerificationResultRow(
      { ...verification, evidenceObjectId: objectId },
      attemptId
    );
    expect(fromEvidenceLocatorRow(locatorRow)).toEqual(locator);
    expect(fromEvidenceVerificationResultRow(verificationRow)).toEqual(verification);
    expect(locatorRow.publication_attempt_id).toBe(attemptId);
    expect(verificationRow.publication_attempt_id).toBe(attemptId);
  });

  it("exposes one unit-of-work bundle for object, attempt, locator and verification writes", async () => {
    const repositories = new InMemoryEvidenceRepositories();
    const seen: string[] = [];
    await repositories.unitOfWork.run(async (bundle) => {
      seen.push(
        bundle.objects.constructor.name,
        bundle.attempts.constructor.name,
        bundle.locators.constructor.name,
        bundle.verifications.constructor.name
      );

      return undefined;
    });
    expect(seen).toEqual([
      "InMemoryEvidenceObjectRepository",
      "InMemoryPublicationStore",
      "InMemoryEvidenceLocatorRepository",
      "InMemoryEvidenceVerificationRepository"
    ]);
  });

  it("fails closed when a hydrated verified graph has mismatched evidence", () => {
    const digest = digestArtifact(artifact);
    const now = "2026-09-02T08:00:00.000Z";
    const object = {
      id: "55555555-5555-4555-8555-555555555555",
      runId: null,
      agentId: null,
      benchmarkId: null,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactSchemaVersion: "bnbera.evidence/v1",
      resourceId: "durable-resource",
      version: digest.artifact.version,
      idempotencyKey: "durable-object",
      state: "verified" as const,
      ipfsUri: null,
      greenfieldBucket: "greenfield-test",
      greenfieldObject: "durable-object",
      creationTransactionHash: `0x${"1".repeat(64)}`,
      sealTransactionHash: `0x${"2".repeat(64)}`,
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      mimeType: "application/json" as const,
      readbackVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    };
    const locator = createEvidenceLocator({
      provider: "greenfield",
      providerLabel: defaultPublicationConfiguration.greenfield.providerLabel,
      network: defaultPublicationConfiguration.greenfield.network,
      uri: "greenfield://greenfield-test/durable-object",
      bucket: "greenfield-test",
      objectName: "durable-object",
      providerReference: "durable-object",
      version: digest.artifact.version,
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      verifiedAt: new Date(now)
    });
    const verification = createVerificationResult({
      checkedAt: new Date(now),
      sealConfirmed: true,
      expectedSha256Digest: digest.sha256Digest,
      observedSha256Digest: digest.sha256Digest,
      expectedKeccak256Digest: digest.keccak256Digest,
      observedKeccak256Digest: digest.keccak256Digest,
      expectedSizeBytes: digest.sizeBytes,
      observedSizeBytes: digest.sizeBytes,
      readbackStatus: "matched"
    });
    const record = publicationAttemptRecordSchema.parse({
      attemptId: "66666666-6666-4666-8666-666666666666",
      idempotencyKey: "durable-object:greenfield",
      provider: "greenfield",
      providerLabel: defaultPublicationConfiguration.greenfield.providerLabel,
      configurationDigest: publicationConfigurationDigest(defaultPublicationConfiguration),
      configuredNetwork: defaultPublicationConfiguration.greenfield.network,
      configuredBucket: defaultPublicationConfiguration.greenfield.bucket,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: "durable-object",
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      state: "verified",
      revision: 2,
      leaseOwner: null,
      leaseExpiresAt: null,
      providerReference: "durable-object",
      creationTransactionHash: `0x${"1".repeat(64)}`,
      sealTransactionHash: `0x${"2".repeat(64)}`,
      locator,
      verification,
      retryCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      submittedAt: now,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now
    });
    const objectRow = toEvidenceObjectRow(object);
    const attemptRow = toEvidencePublicationAttemptRow(record, object.id);
    expect(
      fromEvidencePublicationAttemptRow(attemptRow, objectRow, locator, verification).state
    ).toBe("verified");

    const nullableSealRecord = publicationAttemptRecordSchema.parse({ ...record, sealTransactionHash: zeroTransactionHash });
    expect(nullableSealRecord.sealTransactionHash).toBeNull();
    expect(
      fromEvidencePublicationAttemptRow(
        toEvidencePublicationAttemptRow(nullableSealRecord, object.id),
        objectRow,
        locator,
        verification
      ).state
    ).toBe("verified");
    const mismatchedLocator = { ...locator, sha256Digest: "f".repeat(64) };
    expect(() => fromEvidencePublicationAttemptRow(attemptRow, objectRow, mismatchedLocator, verification)).toThrow(
      /Verified publication is missing matching locator/
    );
  });
});
