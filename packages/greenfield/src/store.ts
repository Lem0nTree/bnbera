import type { PublicationAttemptRecord, PublicationStore } from "./types.js";

/** Deterministic fake store used by unit tests and local adapter spikes. */
export class InMemoryPublicationStore implements PublicationStore {
  private readonly records = new Map<string, PublicationAttemptRecord>();

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

  async save(record: PublicationAttemptRecord): Promise<void> {
    const existing = this.records.get(record.idempotencyKey);
    if (existing !== undefined && existing.sha256Digest !== record.sha256Digest) {
      throw new Error("Publication idempotency key is already bound to different content");
    }
    this.records.set(record.idempotencyKey, record);
  }

  values(): readonly PublicationAttemptRecord[] {
    return [...this.records.values()];
  }
}
