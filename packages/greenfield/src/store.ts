import type { PublicationAttemptRecord, PublicationAuditEvent, PublicationStore } from "./types.js";

/** Deterministic fake store used by unit tests and local adapter spikes. */
export class InMemoryPublicationStore implements PublicationStore {
  private readonly records = new Map<string, PublicationAttemptRecord>();
  private readonly leases = new Map<string, { readonly token: string; readonly expiresAt: number }>();
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
    this.records.set(record.idempotencyKey, record);
    return { record, created: true };
  }

  async save(record: PublicationAttemptRecord): Promise<void> {
    const existing = this.records.get(record.idempotencyKey);
    if (existing !== undefined && existing.sha256Digest !== record.sha256Digest) {
      throw new Error("Publication idempotency key is already bound to different content");
    }
    this.records.set(record.idempotencyKey, record);
  }

  async acquireLease(attemptId: string, leaseToken: string, now: string, durationMs: number): Promise<boolean> {
    const current = await this.findByAttemptId(attemptId);
    if (current === null) {
      return false;
    }
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      return false;
    }
    const existing = this.leases.get(attemptId);
    if (existing !== undefined && existing.expiresAt > nowMs && existing.token !== leaseToken) {
      return false;
    }
    this.leases.set(attemptId, { token: leaseToken, expiresAt: nowMs + durationMs });
    return true;
  }

  async releaseLease(attemptId: string, leaseToken: string): Promise<void> {
    const existing = this.leases.get(attemptId);
    if (existing?.token === leaseToken) {
      this.leases.delete(attemptId);
    }
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
