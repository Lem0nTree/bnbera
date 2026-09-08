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
  publicationConfigurationDigest,
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
  assertDurablePublicationAttempt,
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

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex
    .slice(16, 20)
    .join("")}-${hex.slice(20, 32).join("")}`;
}

export function deterministicAttemptId(idempotencyKey: string, provider: PublicationProvider): string {
  return deterministicUuid(`bnbera.publication-attempt:${provider}:${idempotencyKey}`);
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
  const code = errorCode(error, "PROVIDER_FAILED");
  const fixed: Partial<Record<PublicationFailureCode, string>> = {
    INVALID_ARTIFACT: "Canonical evidence artifact is invalid",
    FORBIDDEN_PUBLIC_FIELD: "Canonical evidence artifact contains a forbidden public field",
    ARTIFACT_TOO_LARGE: "Canonical evidence artifact exceeds the configured size limit",
    OBJECT_TOO_LARGE: "Published evidence object exceeds the configured size limit",
    CREATE_FAILED: "Greenfield object creation failed",
    CREATE_UNKNOWN: "Greenfield object creation outcome is unknown and requires reconciliation",
    UPLOAD_FAILED: "Greenfield object upload failed",
    PROVIDER_FAILED: "Greenfield provider operation failed",
    MALFORMED_TRANSACTION: "Provider returned a malformed transaction hash",
    TIMEOUT: "Greenfield provider operation timed out",
    MISSING_OBJECT: "Greenfield object is unavailable",
    HASH_MISMATCH: "Greenfield readback hash did not match canonical bytes",
    SIZE_MISMATCH: "Greenfield readback size did not match canonical bytes",
    DUPLICATE_IDEMPOTENCY_KEY: "Publication idempotency key is already bound",
    UNSUPPORTED_PROVIDER: "Greenfield provider is not supported by trusted configuration",
    CONFIGURATION_CHANGED: "Publication configuration changed",
    DURABLE_GRAPH_INVALID: "Durable evidence graph is invalid",
    SEAL_TRANSACTION_MISSING: "Greenfield seal transaction hash is missing",
    CONCURRENT_UPDATE: "Publication state was concurrently updated",
    LEASE_LOST: "Publication lease is no longer held"
  };
  return fixed[code] ?? "Provider operation failed";
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
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new PublicationProviderError("MALFORMED_TRANSACTION", `${field} hash is malformed`, false);
  }
  // Greenfield reports an all-zero SealTxHash while the object is sealed but
  // no seal transaction is available. It is a confirmed seal status, not a
  // transaction claim.
  return /^0x0{64}$/.test(normalized) ? null : normalized;
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
  private readonly configurationDigest: string;

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
    this.configurationDigest = publicationConfigurationDigest(this.configuration);
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
    this.assertCurrentConfiguration(existing, provider);
    assertDurablePublicationAttempt(existing);
    const unknownCreate = existing.state === "create_failed" && existing.lastErrorCode === "CREATE_UNKNOWN";
    if (existing.state === "verified" || (!result.created && !existing.retryable && terminalStates.has(existing.state) && !unknownCreate)) {
      return existing;
    }

    const leaseToken = randomUUID();
    const lease = await this.dependencies.store.acquireLease(
      existing.attemptId,
      leaseToken,
      nowIso(this.clock),
      this.configuration.leaseDurationMs
    );
    if (!lease.acquired || lease.record === null) {
      // Another worker owns the attempt. Returning the durable state avoids a
      // duplicate provider operation; the reconciler will observe completion.
      return (await this.dependencies.store.findByAttemptId(existing.attemptId)) ?? existing;
    }

    let initial = lease.record;
    let outcome: PublicationAttemptRecord | null = null;
    try {
      if (!result.created && terminalStates.has(existing.state)) {
        if (unknownCreate) {
          const reconciled = await this.reconcileUnknownCreate(initial, digest);
          if (reconciled !== null) {
            outcome = reconciled;
            return reconciled;
          }
          outcome = initial;
          return initial;
        }
        if (!existing.retryable) {
          return existing;
        }
        const retrying = await this.transition(initial, "retrying", {
          retryCount: existing.retryCount + 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          retryable: false,
          startedAt: null,
          completedAt: null,
          verification: null
        });
        initial = await this.transition(retrying, "pending");
      } else if (!result.created && initial.state === "retrying") {
        initial = await this.transition(initial, "pending");
      }
      outcome = await this.runProvider(digest, provider, initial);
    } finally {
      const released = await this.dependencies.store.releaseLease(existing.attemptId, leaseToken, nowIso(this.clock));
      outcome = released ?? (await this.dependencies.store.findByAttemptId(existing.attemptId)) ?? outcome;
    }
    return outcome ?? initial;
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
      providerLabel: provider === "ipfs" ? this.configuration.ipfs.providerLabel : this.configuration.greenfield.providerLabel,
      configurationDigest: this.configurationDigest,
      configuredNetwork: provider === "ipfs" ? this.configuration.ipfs.network : this.configuration.greenfield.network,
      configuredBucket: provider === "ipfs" ? null : this.configuration.greenfield.bucket,
      artifactId: digest.artifact.artifactId,
      artifactType: digest.artifact.artifactType,
      artifactVersion: digest.artifact.version,
      objectName: assertImmutableObjectName(deterministicObjectName(digest.artifact)),
      sha256Digest: digest.sha256Digest,
      keccak256Digest: digest.keccak256Digest,
      sizeBytes: digest.sizeBytes,
      state,
      revision: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
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
      if (record.state !== "provider_failed" && !stateTransitions[record.state].includes("provider_failed")) {
        throw error;
      }
      return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
    }
  }

  private async reconcileUnknownCreate(
    initial: PublicationAttemptRecord,
    digest: ArtifactDigest
  ): Promise<PublicationAttemptRecord | null> {
    const adapter = this.dependencies.greenfield;
    if (adapter?.reconcileCreate === undefined) return null;
    let reconciliation;
    try {
      reconciliation = await adapter.reconcileCreate({
        objectName: initial.objectName,
        sizeBytes: digest.sizeBytes,
        canonicalBytes: digest.canonicalBytes
      });
    } catch {
      return null;
    }
    if (reconciliation.status === "unknown") return null;
    if (reconciliation.status === "present") {
      if (reconciliation.objectReference === null || reconciliation.creationTransactionHash === null) return null;
      // Return to the normal deterministic inspection path. It will compare
      // canonical bytes/checksums again before upload and will not rebroadcast.
    }
    const retrying = await this.transition(initial, "retrying", {
      retryCount: initial.retryCount + 1,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      startedAt: null,
      completedAt: null,
      // Re-run the normal canonical inspection path after the durable
      // reconciliation. This keeps all provider metadata/bytes checks in one
      // place and avoids treating a partial reconciliation receipt as an
      // upload authorization.
      providerReference: null,
      creationTransactionHash: null,
      sealTransactionHash: null,
      locator: null,
      verification: null
    });
    const pending = await this.transition(retrying, "pending");
    return this.runProvider(digest, "greenfield", pending);
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

        // A create broadcast can be accepted by the chain while the worker
        // loses its response. Reconcile the deterministic bucket/object first
        // so a retry can never blindly submit a second create transaction.
        if (adapter.inspectObject !== undefined) {
          let inspected;
          try {
            inspected = await adapter.inspectObject({
              objectName: record.objectName,
              sizeBytes: digest.sizeBytes,
              canonicalBytes: digest.canonicalBytes
            });
          } catch (error) {
            return this.fail(record, "provider_failed", errorCode(error, "PROVIDER_FAILED"), errorMessage(error));
          }
          if (inspected.status !== "missing") {
            if (inspected.objectReference === null) {
              return this.fail(
                record,
                "create_failed",
                "CREATE_FAILED",
                "Greenfield inspection found an object without a provider reference"
              );
            }
            const creationTransactionHash = checkedTransactionHash(
              inspected.creationTransactionHash,
              "Greenfield creation transaction"
            );
            if (creationTransactionHash === null) {
              return this.fail(
                record,
                "create_failed",
                "CREATE_FAILED",
                "Greenfield inspection found an object without its creation transaction hash"
              );
            }
            objectReference = inspected.objectReference;
            if (inspected.status === "sealed") {
              const locator = createEvidenceLocator({
                provider: "greenfield",
                providerLabel: this.configuration.greenfield.providerLabel,
                network: this.configuration.greenfield.network,
                uri: `greenfield://${this.configuration.greenfield.bucket}/${record.objectName}`,
                bucket: this.configuration.greenfield.bucket,
                objectName: record.objectName,
                providerReference: objectReference,
                version: digest.artifact.version,
                sha256Digest: digest.sha256Digest,
                keccak256Digest: digest.keccak256Digest,
                sizeBytes: digest.sizeBytes
              });
              record = await this.transition(record, "awaiting_seal", {
                providerReference: objectReference,
                creationTransactionHash,
                sealTransactionHash: checkedTransactionHash(inspected.sealTransactionHash, "Greenfield seal transaction"),
                locator
              });
              return this.awaitSeal(adapter, digest, record, objectReference);
            }
            record = await this.transition(record, "uploading", {
              providerReference: objectReference,
              creationTransactionHash
            });
          }
        }

        if (objectReference !== null) {
          // The inspection above recovered a durable create. Continue with
          // upload/seal handling below; no create call is made.
        } else {
          let created;
          try {
            created = await adapter.createObject({
              objectName: record.objectName,
              sizeBytes: digest.sizeBytes,
              mimeType: "application/json",
              canonicalBytes: digest.canonicalBytes
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
            objectReference,
            creationTransactionHash: record.creationTransactionHash
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
    if (record.leaseOwner === null) {
      throw new PublicationProviderError("LEASE_LOST", "Publication attempt is not held by a worker", false);
    }
    const expectedRevision = record.revision;
    const leaseToken = record.leaseOwner;
    const updated = publicationAttemptRecordSchema.parse({
      ...record,
      ...patch,
      state: nextState,
      revision: expectedRevision + 1,
      leaseOwner: leaseToken,
      startedAt: record.startedAt ?? (nextState === "validating" ? nowIso(this.clock) : null),
      completedAt: terminalStates.has(nextState) ? nowIso(this.clock) : record.completedAt,
      updatedAt: nowIso(this.clock)
    });
    await this.persist(updated, expectedRevision, leaseToken);
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
      code !== "CREATE_UNKNOWN" &&
      code !== "INVALID_ARTIFACT" &&
      code !== "FORBIDDEN_PUBLIC_FIELD" &&
      code !== "MALFORMED_TRANSACTION" &&
      code !== "SEAL_TRANSACTION_MISSING" &&
      code !== "CONFIGURATION_CHANGED" &&
      code !== "DURABLE_GRAPH_INVALID" &&
      code !== "CONCURRENT_UPDATE" &&
      code !== "LEASE_LOST";
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

  private async persist(record: PublicationAttemptRecord, expectedRevision: number, leaseToken: string): Promise<void> {
    await this.dependencies.store.save(record, expectedRevision, leaseToken, nowIso(this.clock));
  }

  private assertCurrentConfiguration(record: PublicationAttemptRecord, provider: PublicationProvider): void {
    const providerLabel = provider === "ipfs" ? this.configuration.ipfs.providerLabel : this.configuration.greenfield.providerLabel;
    const configuredNetwork = provider === "ipfs" ? this.configuration.ipfs.network : this.configuration.greenfield.network;
    const configuredBucket = provider === "ipfs" ? null : this.configuration.greenfield.bucket;
    if (
      record.configurationDigest !== this.configurationDigest ||
      record.providerLabel !== providerLabel ||
      record.configuredNetwork !== configuredNetwork ||
      record.configuredBucket !== configuredBucket
    ) {
      throw new PublicationProviderError(
        "CONFIGURATION_CHANGED",
        "Publication attempt was created under a different trusted storage configuration",
        false
      );
    }
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
