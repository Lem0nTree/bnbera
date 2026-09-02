import { createHash } from "node:crypto";
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
  type GreenfieldPublisher,
  type IpfsPublisher,
  type PublicationAttemptRecord,
  type PublicationAttemptState,
  type PublicationProvider,
  type PublicationResult,
  type PublicationStore,
  type PublishEvidenceInput,
  PublicationProviderError,
  isPublicationProviderError
} from "./types.js";

type Clock = () => Date;

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

function errorCode(error: unknown, fallback: string): string {
  return isPublicationProviderError(error) ? error.code : fallback;
}

function validTransactionHash(value: string | null): string | null {
  return value !== null && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : null;
}

export class EvidencePublisher {
  private readonly clock: Clock;
  private readonly maxSealPolls: number;

  constructor(
    private readonly dependencies: {
      readonly store: PublicationStore;
      readonly ipfs?: IpfsPublisher;
      readonly greenfield?: GreenfieldPublisher;
      readonly clock?: Clock;
      readonly maxSealPolls?: number;
    }
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.maxSealPolls = Math.max(1, dependencies.maxSealPolls ?? 5);
  }

  /**
   * Publish each requested provider independently. A failed IPFS attempt does
   * not trigger Greenfield, and a Greenfield failure never causes mirroring or
   * a false `verified` result on the other provider.
   */
  async publish(input: PublishEvidenceInput): Promise<PublicationResult> {
    const digest = digestArtifact(input.artifact);
    const providers = [...new Set(input.providers)];
    if (providers.length === 0) {
      throw new PublicationProviderError("UNSUPPORTED_PROVIDER", "At least one publication provider is required", false);
    }

    const attempts = await Promise.all(
      providers.map((provider) => this.publishProvider(input, digest, provider))
    );
    return { digest, attempts };
  }

  /** Retry or reconcile one provider without touching the other provider. */
  async reconcile(input: PublishEvidenceInput & { readonly provider: PublicationProvider }): Promise<PublicationAttemptRecord> {
    const result = await this.publish({ ...input, providers: [input.provider] });
    const attempt = result.attempts[0];
    if (attempt === undefined) {
      throw new Error("Publication reconciliation did not return an attempt");
    }
    return attempt;
  }

  private async publishProvider(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    provider: PublicationProvider
  ): Promise<PublicationAttemptRecord> {
    const providerKey = providerIdempotencyKey(input.idempotencyKey, provider);
    const existing = await this.dependencies.store.findByIdempotencyKey(providerKey);
    if (existing !== null) {
      if (existing.provider !== provider || existing.sha256Digest !== digest.sha256Digest || existing.keccak256Digest !== digest.keccak256Digest) {
        const duplicate = this.newRecord(input, digest, provider, "duplicate");
        return this.withError(duplicate, "DUPLICATE_IDEMPOTENCY_KEY", "Idempotency key is bound to different content");
      }
      if (existing.state === "verified") {
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
      const pending = await this.transition(retrying, "pending");
      return this.runProvider(input, digest, provider, pending, existing.state);
    }

    const created = this.newRecord(input, digest, provider, "pending");
    await this.persist(created);
    return this.runProvider(input, digest, provider, created, null);
  }

  private newRecord(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    provider: PublicationProvider,
    state: PublicationAttemptState
  ): PublicationAttemptRecord {
    const timestamp = nowIso(this.clock);
    return publicationAttemptRecordSchema.parse({
      attemptId: deterministicAttemptId(providerIdempotencyKey(input.idempotencyKey, provider), provider),
      idempotencyKey: providerIdempotencyKey(input.idempotencyKey, provider),
      provider,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: assertImmutableObjectName(input.objectName ?? deterministicObjectName(digest.artifact)),
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
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    provider: PublicationProvider,
    initial: PublicationAttemptRecord,
    previousState: PublicationAttemptState | null
  ): Promise<PublicationAttemptRecord> {
    let record = initial;
    try {
      record = await this.transition(initial, "validating");
      if (provider === "ipfs") {
        if (this.dependencies.ipfs === undefined) {
          return this.fail(record, "provider_failed", "UNSUPPORTED_PROVIDER", "IPFS adapter is not configured");
        }
        return this.runIpfs(input, digest, record);
      }
      if (this.dependencies.greenfield === undefined) {
        return this.fail(record, "provider_failed", "UNSUPPORTED_PROVIDER", "Greenfield adapter is not configured");
      }
      return this.runGreenfield(input, digest, record, previousState);
    } catch (error) {
      return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
    }
  }

  private async runIpfs(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    initial: PublicationAttemptRecord
  ): Promise<PublicationAttemptRecord> {
    const adapter = this.dependencies.ipfs;
    if (adapter === undefined) {
      return this.fail(initial, "provider_failed", "UNSUPPORTED_PROVIDER", "IPFS adapter is not configured");
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
    } catch (error) {
      return this.fail(record, "upload_failed", errorCode(error, "UPLOAD_FAILED"), errorMessage(error));
    }

    const locator = createEvidenceLocator({
      provider: "ipfs",
      network: input.ipfsNetwork ?? receipt.network,
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
    return this.verifyReadback(record, digest, () => adapter.read({ uri: receipt.uri }), null);
  }

  private async runGreenfield(
    input: PublishEvidenceInput,
    digest: ArtifactDigest,
    initial: PublicationAttemptRecord,
    previousState: PublicationAttemptState | null
  ): Promise<PublicationAttemptRecord> {
    const adapter = this.dependencies.greenfield;
    if (adapter === undefined) {
      return this.fail(initial, "provider_failed", "UNSUPPORTED_PROVIDER", "Greenfield adapter is not configured");
    }
    let record = initial;
    let objectReference = previousState !== null && initial.providerReference !== null ? initial.providerReference : null;
    if (objectReference === null) {
      record = await this.transition(record, "creating_object");
      let created;
      try {
        created = await adapter.createObject({ objectName: record.objectName, sizeBytes: digest.sizeBytes, mimeType: "application/json" });
      } catch (error) {
        return this.fail(record, "create_failed", errorCode(error, "CREATE_FAILED"), errorMessage(error));
      }
      record = await this.transition(record, created.status === "submitted" ? "submitted" : "uploading", {
        providerReference: created.objectReference,
        creationTransactionHash: validTransactionHash(created.creationTransactionHash),
        submittedAt: created.status === "submitted" ? nowIso(this.clock) : null
      });
      objectReference = created.objectReference;
      if (objectReference === null) {
        return this.fail(record, "create_failed", "CREATE_FAILED", "Provider did not return an object reference");
      }
      if (record.state === "submitted") {
        record = await this.transition(record, "uploading");
      }
    } else {
      record = await this.transition(record, "uploading");
    }

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
      const locator = createEvidenceLocator({
        provider: "greenfield",
        network: input.greenfieldNetwork ?? receipt.network,
        uri: receipt.uri,
        bucket: new URL(receipt.uri).hostname || "configured",
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

    let seal = null;
    for (let attempt = 1; attempt <= this.maxSealPolls; attempt += 1) {
      try {
        seal = await adapter.waitForSeal({ objectReference, attempt });
      } catch (error) {
        return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
      }
      if (seal.status === "sealed") {
        break;
      }
      if (seal.status === "missing") {
        return this.fail(record, "readback_failed", "MISSING_OBJECT", "Greenfield object is missing while awaiting seal");
      }
      if (attempt < this.maxSealPolls) {
        record = await this.transition(record, "awaiting_seal");
      }
    }
    if (seal?.status !== "sealed") {
      return this.fail(record, "seal_timeout", "TIMEOUT", "Greenfield seal was not confirmed within the polling bound");
    }

    record = await this.transition(record, "reading_back", {
      sealTransactionHash: validTransactionHash(seal.sealTransactionHash)
    });
    return this.verifyReadback(record, digest, () => adapter.readObject({ objectReference }), true);
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
      const reason = code === "TIMEOUT" ? "TIMEOUT" : code === "MISSING_OBJECT" ? "MISSING_OBJECT" : "PROVIDER_FAILED";
      return this.fail(record, "readback_failed", reason, errorMessage(error));
    }
    const observedSha256Digest = createHash("sha256").update(bytes).digest("hex");
    const observedKeccak256Digest = keccak256Hex(bytes);
    const verification = createVerificationResult({
      checkedAt: this.clock(),
      sealConfirmed,
      expectedSha256Digest: digest.sha256Digest,
      observedSha256Digest,
      expectedKeccak256Digest: digest.keccak256Digest,
      observedKeccak256Digest,
      expectedSizeBytes: digest.sizeBytes,
      observedSizeBytes: bytes.byteLength,
      readbackStatus: sameBytes(bytes, digest.canonicalBytes) ? "matched" : "corrupt",
      reasonCode: sameBytes(bytes, digest.canonicalBytes) ? null : "HASH_MISMATCH"
    });
    if (verification.status !== "verified") {
      const failureState = verification.readbackStatus === "corrupt" ? "hash_mismatch" : "readback_failed";
      return this.fail(record, failureState, verification.reasonCode ?? "HASH_MISMATCH", "Readback content does not match canonical bytes", {
        verification
      });
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
    state: Extract<PublicationAttemptState, "validation_failed" | "create_failed" | "upload_failed" | "seal_timeout" | "readback_failed" | "hash_mismatch" | "provider_failed" | "duplicate">,
    code: string,
    message: string,
    patch: Partial<PublicationAttemptRecord> = {}
  ): Promise<PublicationAttemptRecord> {
    return this.transition(record, state, {
      ...patch,
      lastErrorCode: code,
      lastErrorMessage: message,
      retryable: code !== "DUPLICATE_IDEMPOTENCY_KEY" && code !== "MISSING_OBJECT"
    });
  }

  private async persist(record: PublicationAttemptRecord): Promise<void> {
    await this.dependencies.store.save(record);
  }

  private withError(record: PublicationAttemptRecord, code: string, message: string): PublicationAttemptRecord {
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
