import type { EvidenceLocator, VerificationResult } from "@bnbera/evidence";
import type { EvidenceState } from "@bnbera/domain";
import type { PublicationStore } from "./types.js";
import { InMemoryPublicationStore } from "./store.js";

/** Metadata persisted for one immutable canonical artifact version. Raw bytes
 * are intentionally absent; providers are responsible for storage payloads. */
export interface EvidenceObjectRecord {
  readonly id: string;
  readonly artifactId: string;
  readonly artifactType: string;
  readonly artifactSchemaVersion: string;
  readonly resourceId: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly state: EvidenceState;
  readonly sha256Digest: string;
  readonly keccak256Digest: string;
  readonly sizeBytes: number;
  readonly mimeType: "application/json";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceObjectRepository {
  readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<EvidenceObjectRecord | null>;
  readonly findById: (id: string) => Promise<EvidenceObjectRecord | null>;
  readonly save: (record: EvidenceObjectRecord) => Promise<void>;
}

export interface EvidencePublicationAttemptRepository extends PublicationStore {}

export interface EvidenceLocatorRepository {
  readonly addLocator: (locator: EvidenceLocator & { readonly evidenceObjectId: string }) => Promise<void>;
  readonly listLocatorsForObject: (evidenceObjectId: string) => Promise<readonly EvidenceLocator[]>;
}

export interface EvidenceVerificationRepository {
  readonly addVerification: (result: VerificationResult & { readonly evidenceObjectId: string }) => Promise<void>;
  readonly listVerificationsForObject: (evidenceObjectId: string) => Promise<readonly VerificationResult[]>;
}

export class InMemoryEvidenceObjectRepository implements EvidenceObjectRepository {
  private readonly objects = new Map<string, EvidenceObjectRecord>();

  async findByIdempotencyKey(idempotencyKey: string): Promise<EvidenceObjectRecord | null> {
    for (const object of this.objects.values()) {
      if (object.idempotencyKey === idempotencyKey) {
        return object;
      }
    }
    return null;
  }

  async findById(id: string): Promise<EvidenceObjectRecord | null> {
    return this.objects.get(id) ?? null;
  }

  async save(record: EvidenceObjectRecord): Promise<void> {
    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (existing !== null && existing.sha256Digest !== record.sha256Digest) {
      throw new Error("Evidence idempotency key is already bound to different content");
    }
    if (existing !== null && existing.id !== record.id) {
      throw new Error("Evidence idempotency key already has an immutable object");
    }
    this.objects.set(record.id, record);
  }
}

export class InMemoryEvidenceLocatorRepository implements EvidenceLocatorRepository {
  private readonly locators = new Map<string, (EvidenceLocator & { readonly evidenceObjectId: string })[]>();

  async addLocator(locator: EvidenceLocator & { readonly evidenceObjectId: string }): Promise<void> {
    const values = this.locators.get(locator.evidenceObjectId) ?? [];
    if (!values.some((existing) => existing.provider === locator.provider && existing.uri === locator.uri)) {
      values.push(locator);
    }
    this.locators.set(locator.evidenceObjectId, values);
  }

  async listLocatorsForObject(evidenceObjectId: string): Promise<readonly EvidenceLocator[]> {
    return this.locators.get(evidenceObjectId) ?? [];
  }
}

export class InMemoryEvidenceVerificationRepository implements EvidenceVerificationRepository {
  private readonly verifications = new Map<string, (VerificationResult & { readonly evidenceObjectId: string })[]>();

  async addVerification(result: VerificationResult & { readonly evidenceObjectId: string }): Promise<void> {
    const values = this.verifications.get(result.evidenceObjectId) ?? [];
    values.push(result);
    this.verifications.set(result.evidenceObjectId, values);
  }

  async listVerificationsForObject(evidenceObjectId: string): Promise<readonly VerificationResult[]> {
    return this.verifications.get(evidenceObjectId) ?? [];
  }
}

/** Deterministic repository bundle for local adapter tests and contract tests. */
export class InMemoryEvidenceRepositories {
  readonly objects = new InMemoryEvidenceObjectRepository();
  readonly attempts: EvidencePublicationAttemptRepository = new InMemoryPublicationStore();
  readonly locators = new InMemoryEvidenceLocatorRepository();
  readonly verifications = new InMemoryEvidenceVerificationRepository();
}
