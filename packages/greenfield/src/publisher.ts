import { createHash, randomUUID } from "node:crypto";
import {
  createEvidenceLocator,
  createVerificationResult,
  deterministicObjectName,
  digestArtifact,
  keccak256Hex,
  type ArtifactDigest
} from "@bnbera/evidence";
import {
  publicationAttemptRecordSchema,
  publicationConfigurationSchema,
  publicationFailureCodes,
  type GreenfieldPublisher,
  type IpfsPublisher,
  type PublicationAttemptRecord,
  type PublicationAttemptState,
  type PublicationConfiguration,
  type PublicationFailureCode,
  type PublicationProvider,
  type PublicationResult,
  type PublicationStore,
  type PublishEvidenceInput,
  PublicationProviderError,
  isPublicationProviderError
} from "./types.js";

type Clock = () => Date;
type Sleeper = (milliseconds: number) => Promise<void>;

const stateTransitions: Readonly<Record<PublicationAttemptState, readonly PublicationAttemptState[]>> = {
  pending: ["validating", "retrying", "duplicate"],
  validating: ["creating_object", "uploading", "validation_failed", "provider_failed"],
  creating_object: ["submitted", "uploading", "create_failed", "provider_failed"],
  submitted: ["uploading", "create_failed", "provider_failed"],
  uploading: ["awaiting_seal", "reading_back", "upload_failed", "provider_failed"],
  awaiting_seal: ["awaiting_seal", "reading_back", "seal_timeout", "provider_failed"],
  reading_back: ["verified", "readback_failed", "hash_mismatch", "provider_failed"],
  verified: [],
  validation_failed: ["retrying"],
  create_failed: ["retrying"],
  upload_failed: ["retrying"],
  seal_timeout: ["retrying"],
  readback_failed: ["retrying"],
  hash_mismatch: ["retrying"],
  duplicate: [],
  provider_failed: ["retrying"],
  retrying: ["pending"]
};

const terminalStates = new Set<PublicationAttemptState>([
  "verified",
  "validation_failed",
  "create_failed",
  "upload_failed",
  "seal_timeout",
  "readback_failed",
  "hash_mismatch",
  "duplicate",
  "provider_failed"
]);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
}

function nowIso(clock: Clock): string {
  return clock().toISOString();
}

function deterministicAttemptId(idempotencyKey: string, provider: PublicationProvider): string {
  return `publication-${provider}-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

function providerIdempotencyKey(idempotencyKey: string, provider: PublicationProvider): string {
  return `${idempotencyKey}:${provider}`;
}

function assertImmutableObjectName(value: string): string {
  if (
    value.length === 0 ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new PublicationProviderError("INVALID_ARTIFACT", "Invalid immutable evidence object name", false);
  }
  return value;
}

function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "Provider operation failed";
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[redacted-secret]")
    .replace(/(?:private[_ -]?key|password|passphrase|secret|token|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 500) || "Provider operation failed";
}

function errorCode(error: unknown, fallback: PublicationFailureCode): PublicationFailureCode {
  if (isPublicationProviderError(error)) {
    return error.code;
  }
  const candidate = (error as { readonly code?: unknown } | null)?.code;
  return typeof candidate === "string" && publicationFailureCodes.includes(candidate as PublicationFailureCode)
    ? (candidate as PublicationFailureCode)
    : fallback;
}

function checkedTransactionHash(value: string | null, field: string): string | null {
  if (value === null) {
    return null;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new PublicationProviderError("MALFORMED_TRANSACTION", `${field} hash is malformed`, false);
  }
  return value.toLowerCase();
}

function checkedNetwork(actual: string, expected: string, provider: PublicationProvider): void {
  if (actual !== expected) {
    throw new PublicationProviderError(
      "PROVIDER_FAILED",
      `${provider} adapter reported an unexpected configured network`,
      false
    );
  }
}

export class EvidencePublisher {
  private readonly clock: Clock;
  private readonly sleep: Sleeper;
  private readonly configuration: PublicationConfiguration;

  constructor(
    private readonly dependencies: {
      readonly store: PublicationStore;
      readonly configuration: PublicationConfiguration;
      readonly ipfs?: IpfsPublisher;
      readonly greenfield?: GreenfieldPublisher;
      readonly clock?: Clock;
      /** Inject a no-op in tests; production supplies a bounded scheduler. */
      readonly sleep?: Sleeper;
    }
  ) {
    this.configuration = publicationConfigurationSchema.parse(dependencies.configuration);
    this.clock = dependencies.clock ?? (() => new Date());
    this.sleep = dependencies.sleep ?? (async () => undefined);
  }

  /**
   * Publish each configured provider independently. Provider selection,
   * network labels, bucket and object name all come from trusted configuration.
   */
  async publish(input: PublishEvidenceInput): Promise<PublicationResult> {
    let digest: ArtifactDigest;
    try {
      digest = digestArtifact(input.artifact);
    } catch (error) {
      const code = errorCode(error, "INVALID_ARTIFACT");
      const message = errorMessage(error);
      await Promise.all(
        this.configuration.enabledProviders.map((provider) =>
          this.dependencies.store.appendAudit({
            attemptId: deterministicAttemptId(providerIdempotencyKey(input.idempotencyKey, provider), provider),
            idempotencyKey: providerIdempotencyKey(input.idempotencyKey, provider),
            action: "validation_failed",
            reasonCode: code,
            message,
            createdAt: nowIso(this.clock)
          })
        )
      );
      throw error;
    }

    if (digest.artifact.environment !== this.configuration.environment) {
      const message = "Artifact environment does not match trusted configuration";
      await Promise.all(
        this.configuration.enabledProviders.map((provider) =>
          this.dependencies.store.appendAudit({
            attemptId: deterministicAttemptId(providerIdempotencyKey(input.idempotencyKey, provider), provider),
            idempotencyKey: providerIdempotencyKey(input.idempotencyKey, provider),
            action: "validation_failed",
            reasonCode: "INVALID_ARTIFACT",
            message,
            createdAt: nowIso(this.clock)
          })
        )
      );
      throw new PublicationProviderError("INVALID_ARTIFACT", message, false);
    }

    const attempts = await Promise.all(
      this.configuration.enabledProviders.map((provider) => this.publishProvider(input, digest, provider))
    );
    return { digest, attempts };
  }

  /** Retry or reconcile one configured provider without touching the other. */
  async reconcile(
    input: PublishEvidenceInput & { readonly provider: PublicationProvider }
  ): Promise<PublicationAttemptRecord> {
    if (!this.configuration.enabledProviders.includes(input.provider)) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "Provider is not enabled by trusted configuration", false);
    }
    const digest = digestArtifact(input.artifact);
    if (digest.artifact.environment !== this.configuration.environment) {
      const message = "Artifact environment does not match trusted configuration";
      await this.dependencies.store.appendAudit({
        attemptId: deterministicAttemptId(providerIdempotencyKey(input.idempotencyKey, input.provider), input.provider),
        idempotencyKey: providerIdempotencyKey(input.idempotencyKey, input.provider),
        action: "validation_failed",
        reasonCode: "INVALID_ARTIFACT",
        message,
        createdAt: nowIso(this.clock)
      });
      throw new PublicationProviderError("INVALID_ARTIFACT", message, false);
    }
    return this.publishProvider(input, digest, input.provider);
  }

  private async publishProvider(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    provider: PublicationProvider
  ): Promise<PublicationAttemptRecord> {
    const candidate = this.newRecord(input, digest, provider, "pending");
    const result = await this.dependencies.store.createOrGet(candidate);
    const existing = result.record;

    if (
      existing.provider !== provider ||
      existing.sha256Digest !== digest.sha256Digest ||
      existing.keccak256Digest !== digest.keccak256Digest
    ) {
      const duplicate = this.newRecord(input, digest, provider, "duplicate");
      return this.withError(duplicate, "DUPLICATE_IDEMPOTENCY_KEY", "Idempotency key is bound to different content");
    }
    if (existing.state === "verified" || (!result.created && !existing.retryable && terminalStates.has(existing.state))) {
      return existing;
    }

    const leaseToken = randomUUID();
    const acquired = await this.dependencies.store.acquireLease(
      existing.attemptId,
      leaseToken,
      nowIso(this.clock),
      this.configuration.leaseDurationMs
    );
    if (!acquired) {
      // Another worker owns the attempt. Returning the durable state avoids a
      // duplicate provider operation; the reconciler will observe completion.
      return (await this.dependencies.store.findByAttemptId(existing.attemptId)) ?? existing;
    }

    let initial = existing;
    try {
      if (!result.created && terminalStates.has(existing.state)) {
        if (!existing.retryable) {
          return existing;
        }
        const retrying = await this.transition(existing, "retrying", {
          retryCount: existing.retryCount + 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          retryable: false,
          startedAt: null,
          completedAt: null,
          verification: null
        });
        initial = await this.transition(retrying, "pending");
      } else if (!result.created && existing.state === "retrying") {
        initial = await this.transition(existing, "pending");
      }
      return await this.runProvider(digest, provider, initial);
    } finally {
      await this.dependencies.store.releaseLease(existing.attemptId, leaseToken);
    }
  }

  private newRecord(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    provider: PublicationProvider,
    state: PublicationAttemptState
  ): PublicationAttemptRecord {
    const timestamp = nowIso(this.clock);
    if (digest.artifact.environment !== this.configuration.environment) {
      throw new PublicationProviderError("INVALID_ARTIFACT", "Artifact environment does not match trusted configuration", false);
    }
    return publicationAttemptRecordSchema.parse({
      attemptId: deterministicAttemptId(providerIdempotencyKey(input.idempotencyKey, provider), provider),
      idempotencyKey: providerIdempotencyKey(input.idempotencyKey, provider),
      provider,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: assertImmutableObjectName(deterministicObjectName(digest.artifact)),
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      state,
      providerReference: null,
      creationTransactionHash: null,
      sealTransactionHash: null,
      locator: null,
      verification: null,
      retryCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      submittedAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private async runProvider(
    digest: ArtifactDigest,
    provider: PublicationProvider,
    initial: PublicationAttemptRecord
  ): Promise<PublicationAttemptRecord> {
    let record = initial;
    try {
      if (record.state === "pending" || record.state === "retrying") {
        record = await this.transition(record, "validating");
      }
      const sizeFailure = await this.validateSizeBounds(record, digest);
      if (sizeFailure !== null) {
        return sizeFailure;
      }
      if (provider === "ipfs") {
        if (this.dependencies.ipfs === undefined) {
          return this.fail(record, "provider_failed", "UNSUPPORTED_PROVIDER", "IPFS adapter is not configured");
        }
        return this.runIpfs(digest, record);
      }
      if (this.dependencies.greenfield === undefined) {
        return this.fail(record, "provider_failed", "UNSUPPORTED_PROVIDER", "Greenfield adapter is not configured");
      }
      return this.runGreenfield(digest, record);
    } catch (error) {
      return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
    }
  }

  private async validateSizeBounds(record: PublicationAttemptRecord, digest: ArtifactDigest): Promise<PublicationAttemptRecord | null> {
    if (digest.sizeBytes > this.configuration.maxArtifactBytes) {
      return this.fail(record, "validation_failed", "ARTIFACT_TOO_LARGE", "Canonical artifact exceeds the configured size limit");
    }
    if (digest.sizeBytes > this.configuration.maxObjectBytes) {
      return this.fail(record, "validation_failed", "OBJECT_TOO_LARGE", "Published object exceeds the configured size limit");
    }
    return null;
  }

  private async runIpfs(
    digest: ArtifactDigest,
    initial: PublicationAttemptRecord
  ): Promise<PublicationAttemptRecord> {
    const adapter = this.dependencies.ipfs;
    if (adapter === undefined) {
      return this.fail(initial, "provider_failed", "UNSUPPORTED_PROVIDER", "IPFS adapter is not configured");
    }

    if (initial.state === "reading_back") {
      const uri = initial.locator?.uri;
      if (uri === undefined) {
        return this.fail(initial, "readback_failed", "MISSING_OBJECT", "IPFS readback has no durable locator");
      }
      return this.verifyReadback(initial, digest, () => adapter.read({ uri }), null);
    }

    let record = await this.transition(initial, "uploading");
    let receipt;
    try {
      receipt = await adapter.upload({
        bytes: digest.canonicalBytes,
        objectName: record.objectName,
        sha256Digest: digest.sha256Digest,
        keccak256Digest: digest.keccak256Digest,
        sizeBytes: digest.sizeBytes,
        mimeType: "application/json"
      });
      checkedNetwork(receipt.network, this.configuration.ipfs.network, "ipfs");
      const locator = createEvidenceLocator({
        provider: "ipfs",
        providerLabel: this.configuration.ipfs.providerLabel,
        network: this.configuration.ipfs.network,
        uri: receipt.uri,
        providerReference: receipt.providerReference,
        version: digest.artifact.version,
        sha256Digest: digest.sha256Digest,
        keccak256Digest: digest.keccak256Digest,
        sizeBytes: digest.sizeBytes
      });
      record = await this.transition(record, "reading_back", {
        providerReference: receipt.providerReference,
        locator
      });
    } catch (error) {
      return this.fail(record, "upload_failed", errorCode(error, "UPLOAD_FAILED"), errorMessage(error));
    }
    return this.verifyReadback(record, digest, () => adapter.read({ uri: record.locator?.uri ?? receipt.uri }), null);
  }

  private async runGreenfield(
    digest: ArtifactDigest,
    initial: PublicationAttemptRecord
  ): Promise<PublicationAttemptRecord> {
    const adapter = this.dependencies.greenfield;
    if (adapter === undefined) {
      return this.fail(initial, "provider_failed", "UNSUPPORTED_PROVIDER", "Greenfield adapter is not configured");
    }
    let record = initial;
    let objectReference = record.providerReference;

    if (record.state === "reading_back") {
      if (objectReference === null) {
        return this.fail(record, "readback_failed", "MISSING_OBJECT", "Greenfield readback has no durable object reference");
      }
      const durableObjectReference = objectReference;
      return this.verifyReadback(record, digest, () => adapter.readObject({ objectReference: durableObjectReference }), true);
    }

    if (record.state === "awaiting_seal") {
      if (objectReference === null || record.locator === null) {
        return this.fail(record, "provider_failed", "PROVIDER_FAILED", "Awaiting-seal attempt is missing durable object metadata");
      }
      return this.awaitSeal(adapter, digest, record, objectReference);
    }

    if (record.state === "validating" || record.state === "creating_object") {
      if (objectReference === null) {
        record = record.state === "creating_object" ? record : await this.transition(record, "creating_object");
        let created;
        try {
          created = await adapter.createObject({
            objectName: record.objectName,
            sizeBytes: digest.sizeBytes,
            mimeType: "application/json"
          });
          const creationTransactionHash = checkedTransactionHash(
            created.creationTransactionHash,
            "Greenfield creation transaction"
          );
          record = await this.transition(record, created.status === "submitted" ? "submitted" : "uploading", {
            providerReference: created.objectReference,
            creationTransactionHash,
            submittedAt: created.status === "submitted" ? nowIso(this.clock) : null
          });
          objectReference = created.objectReference;
        } catch (error) {
          return this.fail(record, "create_failed", errorCode(error, "CREATE_FAILED"), errorMessage(error));
        }
        if (objectReference === null) {
          return this.fail(record, "create_failed", "CREATE_FAILED", "Provider did not return an object reference");
        }
      }
    }

    if (record.state === "submitted" || record.state === "uploading") {
      if (objectReference === null) {
        return this.fail(record, "create_failed", "CREATE_FAILED", "Submitted attempt has no object reference");
      }
      if (record.state === "submitted") {
        record = await this.transition(record, "uploading");
      }

      if (record.locator === null) {
        try {
          const receipt = await adapter.uploadObject({
            bytes: digest.canonicalBytes,
            objectName: record.objectName,
            sha256Digest: digest.sha256Digest,
            keccak256Digest: digest.keccak256Digest,
            sizeBytes: digest.sizeBytes,
            mimeType: "application/json",
            objectReference
          });
          checkedNetwork(receipt.network, this.configuration.greenfield.network, "greenfield");
          if (receipt.bucket !== this.configuration.greenfield.bucket) {
            throw new PublicationProviderError(
              "PROVIDER_FAILED",
              "Greenfield adapter reported an unconfigured bucket",
              false
            );
          }
          const uri = new URL(receipt.uri);
          if (uri.hostname !== this.configuration.greenfield.bucket) {
            throw new PublicationProviderError(
              "PROVIDER_FAILED",
              "Greenfield URI does not identify the configured bucket",
              false
            );
          }
          const locator = createEvidenceLocator({
            provider: "greenfield",
            providerLabel: this.configuration.greenfield.providerLabel,
            network: this.configuration.greenfield.network,
            uri: receipt.uri,
            bucket: this.configuration.greenfield.bucket,
            objectName: record.objectName,
            providerReference: receipt.providerReference,
            version: digest.artifact.version,
            sha256Digest: digest.sha256Digest,
            keccak256Digest: digest.keccak256Digest,
            sizeBytes: digest.sizeBytes
          });
          record = await this.transition(record, "awaiting_seal", {
            providerReference: objectReference,
            locator
          });
        } catch (error) {
          return this.fail(record, "upload_failed", errorCode(error, "UPLOAD_FAILED"), errorMessage(error));
        }
      } else {
        record = await this.transition(record, "awaiting_seal", { providerReference: objectReference });
      }
      return this.awaitSeal(adapter, digest, record, objectReference);
    }

    return this.fail(record, "provider_failed", "PROVIDER_FAILED", "Greenfield attempt cannot be reconciled from its durable state");
  }

  private async awaitSeal(
    adapter: GreenfieldPublisher,
    digest: ArtifactDigest,
    initial: PublicationAttemptRecord,
    objectReference: string
  ): Promise<PublicationAttemptRecord> {
    let record = initial;
    let sealStatus: "sealed" | "pending" | "missing" = "pending";
    for (let attempt = 1; attempt <= this.configuration.maxSealPolls; attempt += 1) {
      let seal;
      try {
        seal = await adapter.waitForSeal({ objectReference, attempt });
        const sealTransactionHash = checkedTransactionHash(seal.sealTransactionHash, "Greenfield seal transaction");
        if (seal.status === "sealed") {
          record = await this.transition(record, "reading_back", { sealTransactionHash });
          return this.verifyReadback(record, digest, () => adapter.readObject({ objectReference }), true);
        }
        sealStatus = seal.status;
      } catch (error) {
        return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
      }
      if (sealStatus === "missing") {
        return this.fail(record, "readback_failed", "MISSING_OBJECT", "Greenfield object is missing while awaiting seal");
      }
      if (attempt < this.configuration.maxSealPolls) {
        record = await this.transition(record, "awaiting_seal");
        const delay = this.configuration.sealBackoffMs[Math.min(attempt - 1, this.configuration.sealBackoffMs.length - 1)];
        if (delay !== undefined && delay > 0) {
          await this.sleep(delay);
        }
      }
    }
    return this.fail(record, "seal_timeout", "TIMEOUT", "Greenfield seal was not confirmed within the polling bound");
  }

  private async verifyReadback(
    record: PublicationAttemptRecord,
    digest: ArtifactDigest,
    read: () => Promise<Uint8Array>,
    sealConfirmed: boolean | null
  ): Promise<PublicationAttemptRecord> {
    let bytes: Uint8Array;
    try {
      bytes = await read();
    } catch (error) {
      const code = errorCode(error, "MISSING_OBJECT");
      const readbackStatus = code === "TIMEOUT" ? "timeout" : code === "MISSING_OBJECT" ? "missing" : "provider_failed";
      const verification = createVerificationResult({
        checkedAt: this.clock(),
        sealConfirmed,
        expectedSha256Digest: digest.sha256Digest,
        observedSha256Digest: null,
        expectedKeccak256Digest: digest.keccak256Digest,
        observedKeccak256Digest: null,
        expectedSizeBytes: digest.sizeBytes,
        observedSizeBytes: null,
        readbackStatus,
        reasonCode: code
      });
      return this.fail(record, "readback_failed", code, errorMessage(error), { verification });
    }
    const observedSha256Digest = createHash("sha256").update(bytes).digest("hex");
    const observedKeccak256Digest = keccak256Hex(bytes);
    const bytesMatch = sameBytes(bytes, digest.canonicalBytes);
    const verification = createVerificationResult({
      checkedAt: this.clock(),
      sealConfirmed,
      expectedSha256Digest: digest.sha256Digest,
      observedSha256Digest,
      expectedKeccak256Digest: digest.keccak256Digest,
      observedKeccak256Digest,
      expectedSizeBytes: digest.sizeBytes,
      observedSizeBytes: bytes.byteLength,
      readbackStatus: bytesMatch ? "matched" : "corrupt",
      reasonCode: bytesMatch ? null : bytes.byteLength === digest.sizeBytes ? "HASH_MISMATCH" : "SIZE_MISMATCH"
    });
    if (verification.status !== "verified") {
      const failureState = verification.readbackStatus === "corrupt" ? "hash_mismatch" : "readback_failed";
      return this.fail(
        record,
        failureState,
        verification.reasonCode === "SIZE_MISMATCH" ? "SIZE_MISMATCH" : "HASH_MISMATCH",
        "Readback content does not match canonical bytes",
        { verification }
      );
    }
    const verifiedLocator =
      record.locator === null
        ? null
        : {
            ...record.locator,
            verifiedAt: this.clock().toISOString()
          };
    return this.transition(record, "verified", { verification, locator: verifiedLocator });
  }

  private async transition(
    record: PublicationAttemptRecord,
    nextState: PublicationAttemptState,
    patch: Partial<PublicationAttemptRecord> = {}
  ): Promise<PublicationAttemptRecord> {
    if (record.state !== nextState && !stateTransitions[record.state].includes(nextState)) {
      throw new Error(`Illegal publication state transition: ${record.state} -> ${nextState}`);
    }
    const updated = publicationAttemptRecordSchema.parse({
      ...record,
      ...patch,
      state: nextState,
      startedAt: record.startedAt ?? (nextState === "validating" ? nowIso(this.clock) : null),
      completedAt: terminalStates.has(nextState) ? nowIso(this.clock) : record.completedAt,
      updatedAt: nowIso(this.clock)
    });
    await this.persist(updated);
    return updated;
  }

  private async fail(
    record: PublicationAttemptRecord,
    state: Extract<
      PublicationAttemptState,
      | "validation_failed"
      | "create_failed"
      | "upload_failed"
      | "seal_timeout"
      | "readback_failed"
      | "hash_mismatch"
      | "provider_failed"
      | "duplicate"
    >,
    code: PublicationFailureCode,
    message: string,
    patch: Partial<PublicationAttemptRecord> = {}
  ): Promise<PublicationAttemptRecord> {
    const retryable =
      code !== "DUPLICATE_IDEMPOTENCY_KEY" &&
      code !== "MISSING_OBJECT" &&
      code !== "ARTIFACT_TOO_LARGE" &&
      code !== "OBJECT_TOO_LARGE" &&
      code !== "INVALID_ARTIFACT" &&
      code !== "FORBIDDEN_PUBLIC_FIELD" &&
      code !== "MALFORMED_TRANSACTION";
    const failed = await this.transition(record, state, {
      ...patch,
      lastErrorCode: code,
      lastErrorMessage: message,
      retryable
    });
    if (state === "validation_failed") {
      await this.dependencies.store.appendAudit({
        attemptId: failed.attemptId,
        idempotencyKey: failed.idempotencyKey,
        action: "validation_failed",
        reasonCode: code,
        message,
        createdAt: failed.updatedAt
      });
    }
    return failed;
  }

  private async persist(record: PublicationAttemptRecord): Promise<void> {
    await this.dependencies.store.save(record);
  }

  private withError(record: PublicationAttemptRecord, code: PublicationFailureCode, message: string): PublicationAttemptRecord {
    return publicationAttemptRecordSchema.parse({
      ...record,
      lastErrorCode: code,
      lastErrorMessage: message,
      retryable: false,
      completedAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock)
    });
  }
}
