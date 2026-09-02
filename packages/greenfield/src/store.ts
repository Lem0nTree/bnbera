import {
  PublicationProviderError,
  publicationAttemptRecordSchema,
  type PublicationAttemptRecord,
  type PublicationAuditEvent,
  type PublicationStore
} from "./types.js";

/** Deterministic fake store used by unit tests and local adapter spikes. */
export class InMemoryPublicationStore implements PublicationStore {
  private readonly records = new Map<string, PublicationAttemptRecord>();
  private readonly audits: PublicationAuditEvent[] = [];

  async findByIdempotencyKey(idempotencyKey: string): Promise<PublicationAttemptRecord | null> {
    return this.records.get(idempotencyKey) ?? null;
  }

  async findByAttemptId(attemptId: string): Promise<PublicationAttemptRecord | null> {
    for (const record of this.records.values()) {
      if (record.attemptId === attemptId) {
        return record;
      }
    }
    return null;
  }

  async createOrGet(record: PublicationAttemptRecord): Promise<{
    readonly record: PublicationAttemptRecord;
    readonly created: boolean;
  }> {
    const existing = this.records.get(record.idempotencyKey);
    if (existing !== undefined) {
      return { record: existing, created: false };
    }
    const parsed = publicationAttemptRecordSchema.parse(record);
    this.records.set(parsed.idempotencyKey, parsed);
    return { record: parsed, created: true };
  }

  async save(
    record: PublicationAttemptRecord,
    expectedRevision: number,
    leaseToken: string,
    now = record.updatedAt
  ): Promise<void> {
    const existing = this.records.get(record.idempotencyKey);
    if (existing === undefined) {
      throw new PublicationProviderError("CONCURRENT_UPDATE", "Publication attempt disappeared during compare-and-set", false);
    }
    if (!Number.isFinite(Date.parse(now))) {
      throw new PublicationProviderError("LEASE_LOST", "Publication attempt compare-and-set timestamp is invalid", false);
    }
    if (existing.sha256Digest !== record.sha256Digest || existing.keccak256Digest !== record.keccak256Digest) {
      throw new PublicationProviderError(
        "DUPLICATE_IDEMPOTENCY_KEY",
        "Publication idempotency key is already bound to different content",
        false
      );
    }
    if (existing.revision !== expectedRevision || record.revision !== expectedRevision + 1) {
      throw new PublicationProviderError("CONCURRENT_UPDATE", "Publication attempt revision is stale", false);
    }
    if (
      existing.leaseOwner !== leaseToken ||
      record.leaseOwner !== leaseToken ||
      existing.leaseExpiresAt === null ||
      Date.parse(existing.leaseExpiresAt) <= Date.parse(now)
    ) {
      throw new PublicationProviderError("LEASE_LOST", "Publication attempt lease is not owned or has expired", false);
    }
    this.records.set(record.idempotencyKey, publicationAttemptRecordSchema.parse(record));
  }

  async acquireLease(
    attemptId: string,
    leaseToken: string,
    now: string,
    durationMs: number
  ): Promise<{ readonly acquired: boolean; readonly record: PublicationAttemptRecord | null }> {
    // Keep the check-and-set synchronous inside this in-memory fake. An
    // adapter backed by Postgres must provide the same atomicity with a
    // conditional UPDATE/row lock; awaiting a lookup here would let two
    // workers observe the same unleased snapshot.
    let current: PublicationAttemptRecord | null = null;
    for (const candidate of this.records.values()) {
      if (candidate.attemptId === attemptId) {
        current = candidate;
        break;
      }
    }
    if (current === null) {
      return { acquired: false, record: null };
    }
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      return { acquired: false, record: current };
    }
    if (
      current.leaseOwner !== null &&
      current.leaseExpiresAt !== null &&
      Date.parse(current.leaseExpiresAt) > nowMs &&
      current.leaseOwner !== leaseToken
    ) {
      return { acquired: false, record: current };
    }
    const leased = publicationAttemptRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      leaseOwner: leaseToken,
      leaseExpiresAt: new Date(nowMs + durationMs).toISOString(),
      updatedAt: now
    });
    this.records.set(leased.idempotencyKey, leased);
    return { acquired: true, record: leased };
  }

  async releaseLease(attemptId: string, leaseToken: string, now?: string): Promise<PublicationAttemptRecord | null> {
    let current: PublicationAttemptRecord | null = null;
    for (const candidate of this.records.values()) {
      if (candidate.attemptId === attemptId) {
        current = candidate;
        break;
      }
    }
    if (current === null || current.leaseOwner !== leaseToken) {
      return null;
    }
    const released = publicationAttemptRecordSchema.parse({
      ...current,
      revision: current.revision + 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now ?? current.updatedAt
    });
    this.records.set(released.idempotencyKey, released);
    return released;
  }

  async appendAudit(event: PublicationAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  auditEvents(): readonly PublicationAuditEvent[] {
    return [...this.audits];
  }

  values(): readonly PublicationAttemptRecord[] {
    return [...this.records.values()];
  }
}
