import { describe, expect, it } from "vitest";
import {
  createEvidenceLocator,
  digestArtifact,
  deterministicObjectName
} from "@bnbera/evidence";
import {
  EvidencePublisher,
  InMemoryPublicationStore,
  defaultPublicationConfiguration,
  publicationAttemptRecordSchema,
  type GreenfieldPublisher,
  type PublicationAttemptState,
  type PublicationConfiguration
} from "../src/index.js";
import { DeterministicGreenfieldPublisher, DeterministicIpfsPublisher } from "../src/fakes.js";

const artifact = {
  schemaVersion: "bnbera.evidence/v1",
  artifactType: "run_bundle",
  artifactId: "run-1",
  version: 1,
  environment: "hackathon",
  createdAt: "2026-09-02T08:00:00Z",
  payload: {
    runId: "run-1",
    identity: {
      namespace: "eip155",
      chainId: 97,
      identityRegistry: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      agentId: "1"
    },
    agentVersion: "template@1.0.0",
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

function configuration(
  overrides: Partial<PublicationConfiguration> = {}
): PublicationConfiguration {
  return {
    ...defaultPublicationConfiguration,
    ...overrides,
    ipfs: { ...defaultPublicationConfiguration.ipfs, ...(overrides.ipfs ?? {}) },
    greenfield: { ...defaultPublicationConfiguration.greenfield, ...(overrides.greenfield ?? {}) }
  };
}

function publisher(options: {
  readonly store?: InMemoryPublicationStore;
  readonly ipfs?: DeterministicIpfsPublisher;
  readonly greenfield?: GreenfieldPublisher;
  readonly config?: PublicationConfiguration;
  readonly sleep?: (milliseconds: number) => Promise<void>;
} = {}) {
  const store = options.store ?? new InMemoryPublicationStore();
  const dependencies = {
    store,
    configuration: options.config ?? configuration(),
    ipfs: options.ipfs ?? new DeterministicIpfsPublisher(),
    greenfield: options.greenfield ?? new DeterministicGreenfieldPublisher()
  };
  return new EvidencePublisher(options.sleep === undefined ? dependencies : { ...dependencies, sleep: options.sleep });
}

async function seedAttempt(
  store: InMemoryPublicationStore,
  state: PublicationAttemptState,
  options: { readonly idempotencyKey: string; readonly providerReference?: string; readonly locator?: ReturnType<typeof createEvidenceLocator> }
) {
  const digest = digestArtifact(artifact);
  const objectName = deterministicObjectName(digest.artifact);
  const now = "2026-09-02T08:00:00.000Z";
  const record = publicationAttemptRecordSchema.parse({
    attemptId: `seed-${options.idempotencyKey}`,
    idempotencyKey: `${options.idempotencyKey}:greenfield`,
    provider: "greenfield",
    artifactId: digest.artifact.artifactId,
    artifactType: digest.artifact.artifactType,
    artifactVersion: digest.artifact.version,
    objectName,
    sha256Digest: digest.sha256Digest,
    keccak256Digest: digest.keccak256Digest,
    sizeBytes: digest.sizeBytes,
    state,
    providerReference: options.providerReference ?? null,
    creationTransactionHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    sealTransactionHash: null,
    locator: options.locator ?? null,
    verification: null,
    retryCount: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    retryable: false,
    submittedAt: state === "submitted" ? now : null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  });
  await store.createOrGet(record);
  return { digest, objectName, record };
}

describe("independent evidence publication", () => {
  it("verifies both configured providers independently", async () => {
    const store = new InMemoryPublicationStore();
    const instance = publisher({ store });
    const result = await instance.publish({ artifact, idempotencyKey: "run-1-v1" });
    expect(result.attempts.map((attempt) => attempt.state)).toEqual(["verified", "verified"]);
    expect(result.attempts.every((attempt) => attempt.verification?.status === "verified")).toBe(true);
    expect(result.attempts.every((attempt) => attempt.locator?.immutable === true && attempt.locator.verifiedAt !== null)).toBe(true);
    expect(store.values()).toHaveLength(2);
    expect(new Set(store.values().map((attempt) => attempt.idempotencyKey)).size).toBe(2);
  });

  it("does not mirror when IPFS fails and Greenfield succeeds", async () => {
    const result = await publisher({ ipfs: new DeterministicIpfsPublisher({ failUpload: true }) }).publish({
      artifact,
      idempotencyKey: "independent-failure"
    });
    expect(result.attempts.find((attempt) => attempt.provider === "ipfs")?.state).toBe("upload_failed");
    expect(result.attempts.find((attempt) => attempt.provider === "greenfield")?.state).toBe("verified");
  });

  it("requires seal confirmation before readback verification", async () => {
    const greenfield = new DeterministicGreenfieldPublisher({ sealAfterPolls: 2 });
    const result = await publisher({ greenfield }).publish({ artifact, idempotencyKey: "delayed-seal" });
    expect(result.attempts.find((attempt) => attempt.provider === "greenfield")?.state).toBe("verified");
    expect(greenfield.getPollCount()).toBe(2);
  });

  it("uses a bounded backoff seam between seal polls", async () => {
    const delays: number[] = [];
    const greenfield = new DeterministicGreenfieldPublisher({ sealAfterPolls: 3 });
    const result = await publisher({
      greenfield,
      config: configuration({ maxSealPolls: 3, sealBackoffMs: [7, 11] }),
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      }
    }).publish({ artifact, idempotencyKey: "bounded-backoff" });
    expect(result.attempts.find((attempt) => attempt.provider === "greenfield")?.state).toBe("verified");
    expect(delays).toEqual([7, 11]);
  });

  it("records a provider readback failure instead of treating availability as integrity", async () => {
    const result = await publisher({ greenfield: new DeterministicGreenfieldPublisher({ failRead: true }) }).publish({
      artifact,
      idempotencyKey: "readback-provider-failure"
    });
    const attempt = result.attempts.find((value) => value.provider === "greenfield");
    expect(attempt?.state).toBe("readback_failed");
    expect(attempt?.lastErrorCode).toBe("PROVIDER_FAILED");
    expect(attempt?.verification?.status).toBe("failed");
  });

  it("keeps a provider-submitted transaction distinct from a published object", async () => {
    const result = await publisher({
      greenfield: new DeterministicGreenfieldPublisher({ submittedWithoutReference: true })
    }).publish({ artifact, idempotencyKey: "submitted-only" });
    const attempt = result.attempts.find((value) => value.provider === "greenfield");
    expect(attempt?.state).toBe("create_failed");
    expect(attempt?.submittedAt).not.toBeNull();
    expect(attempt?.verification).toBeNull();
  });

  it.each([
    ["seal_timeout", new DeterministicGreenfieldPublisher({ timeoutOnSeal: true }), "seal_timeout"],
    ["missing", new DeterministicGreenfieldPublisher({ missingOnRead: true }), "readback_failed"],
    ["corrupt", new DeterministicGreenfieldPublisher({ corruptReadback: true }), "hash_mismatch"],
    ["provider", new DeterministicGreenfieldPublisher({ failCreate: true }), "create_failed"]
  ] as const)("records %s without claiming publication", async (_label, greenfield, expected) => {
    const result = await publisher({
      greenfield,
      config: configuration({ maxSealPolls: 2 })
    }).reconcile({ artifact, idempotencyKey: `failure-${_label}`, provider: "greenfield" });
    expect(result.state).toBe(expected);
    expect(result.verification?.status).not.toBe("verified");
  });

  it("returns a duplicate state when the idempotency key is reused for different bytes", async () => {
    const store = new InMemoryPublicationStore();
    const instance = publisher({
      store,
      config: configuration({ enabledProviders: ["ipfs"] })
    });
    await instance.publish({ artifact, idempotencyKey: "duplicate-key" });
    const altered = { ...artifact, version: 2 };
    const result = await instance.publish({ artifact: altered, idempotencyKey: "duplicate-key" });
    expect(result.attempts[0]?.state).toBe("duplicate");
    expect(result.attempts[0]?.lastErrorCode).toBe("DUPLICATE_IDEMPOTENCY_KEY");
  });

  it("derives the immutable object name and locator labels from trusted config", async () => {
    const greenfield = new DeterministicGreenfieldPublisher();
    const result = await publisher({
      greenfield,
      config: configuration({
        enabledProviders: ["greenfield"],
        greenfield: { network: "greenfield_5600-1", providerLabel: "trusted-label", bucket: "greenfield-test" }
      })
    }).publish({
      artifact,
      idempotencyKey: "trusted-config"
    });
    expect(result.attempts[0]?.objectName).toBe("evidence/hackathon/run_bundle/run-1/versions/1/run_bundle.json");
    expect(result.attempts[0]?.locator?.providerLabel).toBe("trusted-label");
    expect(result.attempts[0]?.locator?.network).toBe("greenfield_5600-1");
    expect(result.attempts[0]?.locator?.bucket).toBe("greenfield-test");
  });

  it("resumes submitted, uploading, and awaiting-seal states without illegal retry transitions", async () => {
    const greenfield = new DeterministicGreenfieldPublisher();
    const store = new InMemoryPublicationStore();
    const submitted = await seedAttempt(store, "submitted", { idempotencyKey: "resume-submitted", providerReference: deterministicObjectName(digestArtifact(artifact).artifact) });
    const uploadedReceipt = await greenfield.uploadObject({
      bytes: submitted.digest.canonicalBytes,
      objectReference: submitted.objectName
    });
    const locator = createEvidenceLocator({
      provider: "greenfield",
      providerLabel: defaultPublicationConfiguration.greenfield.providerLabel,
      network: defaultPublicationConfiguration.greenfield.network,
      uri: uploadedReceipt.uri,
      bucket: defaultPublicationConfiguration.greenfield.bucket,
      objectName: submitted.objectName,
      providerReference: uploadedReceipt.providerReference,
      version: submitted.digest.artifact.version,
      sha256Digest: submitted.digest.sha256Digest,
      keccak256Digest: submitted.digest.keccak256Digest,
      sizeBytes: submitted.digest.sizeBytes
    });
    await seedAttempt(store, "uploading", { idempotencyKey: "resume-uploading", providerReference: submitted.objectName });
    await seedAttempt(store, "awaiting_seal", { idempotencyKey: "resume-awaiting", providerReference: submitted.objectName, locator });

    const instance = publisher({ store, greenfield, config: configuration({ enabledProviders: ["greenfield"] }) });
    const [submittedResult, uploadingResult, awaitingResult] = await Promise.all([
      instance.reconcile({ artifact, idempotencyKey: "resume-submitted", provider: "greenfield" }),
      instance.reconcile({ artifact, idempotencyKey: "resume-uploading", provider: "greenfield" }),
      instance.reconcile({ artifact, idempotencyKey: "resume-awaiting", provider: "greenfield" })
    ]);
    expect(submittedResult.state).toBe("verified");
    expect(uploadingResult.state).toBe("verified");
    expect(awaitingResult.state).toBe("verified");
    expect(submittedResult.retryCount).toBe(0);
    expect(uploadingResult.retryCount).toBe(0);
    expect(awaitingResult.retryCount).toBe(0);
  });

  it("fails closed on malformed creation and seal transaction hashes", async () => {
    const malformedCreate = await publisher({
      greenfield: new DeterministicGreenfieldPublisher({ malformedTransactionHash: true }),
      config: configuration({ enabledProviders: ["greenfield"] })
    }).publish({ artifact, idempotencyKey: "malformed-create" });
    expect(malformedCreate.attempts[0]?.state).toBe("create_failed");
    expect(malformedCreate.attempts[0]?.lastErrorCode).toBe("MALFORMED_TRANSACTION");

    const base = new DeterministicGreenfieldPublisher();
    const malformedSeal: GreenfieldPublisher = {
      createObject: (input) => base.createObject(input),
      uploadObject: (input) => base.uploadObject(input),
      waitForSeal: async () => {
        const receipt = await base.waitForSeal();
        return { ...receipt, sealTransactionHash: receipt.status === "sealed" ? "malformed" : null };
      },
      readObject: (input) => base.readObject(input)
    };
    const malformedSealResult = await publisher({
      greenfield: malformedSeal,
      config: configuration({ enabledProviders: ["greenfield"] })
    }).publish({ artifact, idempotencyKey: "malformed-seal" });
    expect(malformedSealResult.attempts[0]?.state).toBe("provider_failed");
    expect(malformedSealResult.attempts[0]?.lastErrorCode).toBe("MALFORMED_TRANSACTION");
  });

  it("persists validation_failed for artifacts over the configured limit", async () => {
    const store = new InMemoryPublicationStore();
    const result = await publisher({
      store,
      config: configuration({ enabledProviders: ["greenfield"], maxArtifactBytes: 1, maxObjectBytes: 1 })
    }).publish({ artifact, idempotencyKey: "too-large" });
    expect(result.attempts[0]?.state).toBe("validation_failed");
    expect(store.auditEvents()).toEqual([
      expect.objectContaining({ action: "validation_failed", reasonCode: "ARTIFACT_TOO_LARGE" })
    ]);
  });

  it("enforces the object-size limit independently from the artifact limit", async () => {
    const store = new InMemoryPublicationStore();
    const result = await publisher({
      store,
      config: configuration({ enabledProviders: ["greenfield"], maxArtifactBytes: 100_000, maxObjectBytes: 1 })
    }).publish({ artifact, idempotencyKey: "object-too-large" });
    expect(result.attempts[0]?.state).toBe("validation_failed");
    expect(result.attempts[0]?.lastErrorCode).toBe("OBJECT_TOO_LARGE");
  });

  it("rejects a Greenfield receipt for an unconfigured bucket", async () => {
    const base = new DeterministicGreenfieldPublisher();
    const wrongBucket: GreenfieldPublisher = {
      createObject: (input) => base.createObject(input),
      uploadObject: async (input) => ({ ...(await base.uploadObject(input)), bucket: "attacker-bucket" }),
      waitForSeal: () => base.waitForSeal(),
      readObject: (input) => base.readObject(input)
    };
    const result = await publisher({
      greenfield: wrongBucket,
      config: configuration({ enabledProviders: ["greenfield"] })
    }).publish({ artifact, idempotencyKey: "wrong-bucket" });
    expect(result.attempts[0]?.state).toBe("upload_failed");
    expect(result.attempts[0]?.lastErrorCode).toBe("PROVIDER_FAILED");
  });

  it("uses atomic create-or-get and one provider operation under concurrent requests", async () => {
    const store = new InMemoryPublicationStore();
    const greenfield = new DeterministicGreenfieldPublisher();
    const instance = publisher({ store, greenfield, config: configuration({ enabledProviders: ["greenfield"] }) });
    const results = await Promise.all([
      instance.publish({ artifact, idempotencyKey: "concurrent-key" }),
      instance.publish({ artifact, idempotencyKey: "concurrent-key" })
    ]);
    expect(greenfield.getCreateCount()).toBe(1);
    expect(greenfield.getUploadCount()).toBe(1);
    expect(store.values()).toHaveLength(1);
    expect(store.values()[0]?.state).toBe("verified");
    expect(results.some((result) => result.attempts[0]?.state === "verified")).toBe(true);
  });

  it("retries only terminal retryable failures", async () => {
    const store = new InMemoryPublicationStore();
    const failing = new DeterministicGreenfieldPublisher({ failCreate: true });
    const first = publisher({ store, greenfield: failing, config: configuration({ enabledProviders: ["greenfield"] }) });
    const failed = await first.publish({ artifact, idempotencyKey: "retry-me" });
    expect(failed.attempts[0]?.state).toBe("create_failed");
    const recovered = publisher({ store, greenfield: new DeterministicGreenfieldPublisher(), config: configuration({ enabledProviders: ["greenfield"] }) });
    const retry = await recovered.reconcile({ artifact, idempotencyKey: "retry-me", provider: "greenfield" });
    expect(retry.state).toBe("verified");
    expect(retry.retryCount).toBe(1);
  });
});
