import { z } from "zod";
import { ingestionError } from "../errors.js";
import { normalizeCandidate, normalizeIdentity, normalizeSourceReference } from "../normalize.js";
import type { IdentityCandidate, IdentityKey } from "../types.js";

export type EightHundredFourScanQuery = {
  readonly chainId?: number;
  readonly cursor?: string;
  readonly limit?: number;
};

export type EightHundredFourScanPage = {
  readonly items: readonly unknown[];
  readonly nextCursor: string | null;
};

/**
 * The provider transport is deliberately injected.  8004scan is a discovery
 * accelerator, but its URL, authentication, pagination, and response fields
 * are not part of the BNBEra public service contract.
 */
export interface EightHundredFourScanClient {
  listCandidates(query: EightHundredFourScanQuery): Promise<EightHundredFourScanPage>;
}

export type MappedEightHundredFourScanCandidate = {
  readonly identity: unknown;
  readonly sourceReference: unknown;
  readonly observedAt?: Date;
  readonly rawResponseDigest?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly services?: readonly unknown[];
  readonly capabilityManifest?: unknown;
};

export type EightHundredFourScanMapper = (
  raw: unknown
) => MappedEightHundredFourScanCandidate;

const canonicalScanRecordSchema = z.object({
  identity: z.unknown(),
  sourceReference: z.unknown(),
  observedAt: z.coerce.date().optional(),
  rawResponseDigest: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  services: z.array(z.unknown()).optional(),
  capabilityManifest: z.unknown().optional()
});

/**
 * Helper for a pre-normalized provider response. A production transport may
 * use a different response shape by supplying its own mapper.
 */
export function mapCanonicalScanCandidate(raw: unknown): MappedEightHundredFourScanCandidate {
  const parsed = canonicalScanRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw ingestionError(
      "INGESTION_INPUT_INVALID",
      "The 8004scan candidate does not match the mapped provider contract.",
      "fix_scan_mapper",
      parsed.error
    );
  }
  const value = parsed.data;
  return {
    identity: value.identity,
    sourceReference: value.sourceReference,
    ...(value.observedAt === undefined ? {} : { observedAt: value.observedAt }),
    ...(value.rawResponseDigest === undefined ? {} : { rawResponseDigest: value.rawResponseDigest }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
    ...(value.services === undefined ? {} : { services: value.services }),
    ...(value.capabilityManifest === undefined ? {} : { capabilityManifest: value.capabilityManifest })
  };
}

export function createEightHundredFourScanAdapter(
  client: EightHundredFourScanClient,
  mapper: EightHundredFourScanMapper = mapCanonicalScanCandidate,
  normalizedIngestionVersion = "8004scan-v1"
): EightHundredFourScanAdapter {
  return new EightHundredFourScanAdapter(client, mapper, normalizedIngestionVersion);
}

export class EightHundredFourScanAdapter {
  public constructor(
    private readonly client: EightHundredFourScanClient,
    private readonly mapper: EightHundredFourScanMapper,
    private readonly normalizedIngestionVersion: string
  ) {}

  async fetchPage(query: EightHundredFourScanQuery = {}): Promise<{
    readonly candidates: readonly IdentityCandidate[];
    readonly nextCursor: string | null;
  }> {
    const page = await this.client.listCandidates(query);
    if (!Array.isArray(page.items)) {
      throw ingestionError("INGESTION_INPUT_INVALID", "The 8004scan response has no candidate list.", "retry_scan");
    }
    const candidates = page.items.map((raw) => {
      const mapped = this.mapper(raw);
      return normalizeCandidate({
        identity: normalizeIdentity(mapped.identity),
        source: "8004scan",
        sourceReference: normalizeSourceReference(mapped.sourceReference),
        observedAt: mapped.observedAt ?? new Date(),
        normalizedIngestionVersion: this.normalizedIngestionVersion,
        ...(mapped.rawResponseDigest === undefined ? {} : { rawResponseDigest: mapped.rawResponseDigest as string }),
        ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }),
        ...(mapped.services === undefined ? {} : { services: mapped.services }),
        ...(mapped.capabilityManifest === undefined ? {} : { capabilityManifest: mapped.capabilityManifest })
      });
    });
    return { candidates, nextCursor: page.nextCursor ?? null };
  }

  async *iterate(query: EightHundredFourScanQuery = {}): AsyncGenerator<IdentityCandidate, void, void> {
    let cursor = query.cursor;
    do {
      const page = await this.fetchPage({ ...query, ...(cursor === undefined ? {} : { cursor }) });
      for (const candidate of page.candidates) {
        yield candidate;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }

  /** Stable key used by ingestion callers for idempotent page replay. */
  static candidateIdentityKey(candidate: IdentityCandidate): IdentityKey {
    return [
      candidate.identity.namespace,
      candidate.identity.chainId,
      candidate.identity.identityRegistry,
      candidate.identity.agentId
    ].join(":");
  }
}
