import { erc8004IdentityKey, normalizeEvmAddress, type Erc8004Identity } from "@bnbera/domain";

/** Shared bound for discovery and rotating health cursor page configuration. */
export const MAX_MARKETPLACE_CURSOR_PAGE_SIZE = 500;

export type MarketplaceStateQueryable = {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ readonly rows: readonly TRow[]; readonly rowCount?: number | null }>;
};

export type MarketplaceDiscoveryCursor = {
  readonly scope: string;
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly pageSize: number;
  readonly nextOffset: number;
  readonly total: number | null;
  readonly sweep: number;
  readonly lastPageAt: Date | null;
  readonly updatedAt: Date;
};

export type MarketplaceRetryState = {
  readonly identityKey: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date;
  readonly lastAttemptAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastStage: string | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
};

export type MarketplaceRetryAttempt = {
  readonly stage: "published" | "withheld" | "failed";
  readonly errorCode: string | null;
  readonly attemptedAt: Date;
  readonly successDelayMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
};

export type MarketplaceRotation<T> = {
  readonly selected: readonly T[];
  readonly startOffset: number;
  readonly nextOffset: number;
};

/** Select a bounded circular batch without making the first page privileged. */
export function rotateMarketplaceBatch<T>(items: readonly T[], offset: number, limit: number): MarketplaceRotation<T> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("MARKETPLACE_ROTATION_CONFIGURATION_INVALID");
  }
  if (items.length === 0) return { selected: [], startOffset: 0, nextOffset: 0 };
  const startOffset = offset >= items.length ? 0 : offset;
  const count = Math.min(limit, items.length);
  const selected = Array.from({ length: count }, (_, index) => items[(startOffset + index) % items.length]!);
  return {
    selected,
    startOffset,
    nextOffset: (startOffset + count) % items.length
  };
}

type DiscoveryCursorRow = {
  scope: string;
  chain_id: number | string;
  identity_registry: string;
  page_size: number | string;
  next_offset: number | string;
  total: number | string | null;
  sweep: number | string;
  last_page_at: Date | null;
  updated_at: Date;
};

type RetryRow = {
  identity_key: string;
  attempt_count: number | string;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  last_stage: string | null;
  last_error_code: string | null;
  updated_at: Date;
};

type IdentityRow = { id: string; identity_key: string };

const errorCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/u;

function safeNonNegativeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`MARKETPLACE_STATE_${field.toUpperCase()}_INVALID`);
  return parsed;
}

function safeDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) throw new Error(`MARKETPLACE_STATE_${field.toUpperCase()}_INVALID`);
  return value;
}

function nullableDate(value: unknown, field: string): Date | null {
  return value === null ? null : safeDate(value, field);
}

function parseIdentityKey(identityKey: string): Erc8004Identity {
  const parts = identityKey.split(":");
  if (parts.length !== 4 || parts[0] === undefined || parts[1] === undefined || parts[2] === undefined || parts[3] === undefined) {
    throw new Error("MARKETPLACE_STATE_IDENTITY_INVALID");
  }
  if (!/^[1-9][0-9]*$/u.test(parts[1])) throw new Error("MARKETPLACE_STATE_IDENTITY_INVALID");
  const chainId = Number(parts[1]);
  if (!Number.isSafeInteger(chainId)) throw new Error("MARKETPLACE_STATE_IDENTITY_INVALID");
  return {
    namespace: parts[0],
    chainId,
    identityRegistry: normalizeEvmAddress(parts[2]),
    agentId: parts[3]
  };
}

function mapCursor(row: DiscoveryCursorRow): MarketplaceDiscoveryCursor {
  return {
    scope: row.scope,
    chainId: safeNonNegativeInteger(row.chain_id, "chain_id"),
    identityRegistry: normalizeEvmAddress(row.identity_registry),
    pageSize: safeNonNegativeInteger(row.page_size, "page_size"),
    nextOffset: safeNonNegativeInteger(row.next_offset, "next_offset"),
    total: row.total === null ? null : safeNonNegativeInteger(row.total, "total"),
    sweep: safeNonNegativeInteger(row.sweep, "sweep"),
    lastPageAt: nullableDate(row.last_page_at, "last_page_at"),
    updatedAt: safeDate(row.updated_at, "updated_at")
  };
}

function mapRetry(row: RetryRow): MarketplaceRetryState {
  return {
    identityKey: row.identity_key,
    attemptCount: safeNonNegativeInteger(row.attempt_count, "attempt_count"),
    nextAttemptAt: safeDate(row.next_attempt_at, "next_attempt_at"),
    lastAttemptAt: nullableDate(row.last_attempt_at, "last_attempt_at"),
    lastSuccessAt: nullableDate(row.last_success_at, "last_success_at"),
    lastStage: row.last_stage,
    lastErrorCode: row.last_error_code,
    updatedAt: safeDate(row.updated_at, "updated_at")
  };
}

function errorCode(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  return errorCodePattern.test(normalized) ? normalized : "MARKETPLACE_RETRY_FAILED";
}

function boundedDelay(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum) throw new Error("MARKETPLACE_STATE_DELAY_INVALID");
  return result;
}

export class PostgresMarketplaceIngestionState {
  public constructor(private readonly queryable: MarketplaceStateQueryable) {}

  public async getDiscoveryCursor(scope: string): Promise<MarketplaceDiscoveryCursor | null> {
    const result = await this.queryable.query<DiscoveryCursorRow>(
      `SELECT scope, chain_id, identity_registry, page_size, next_offset, total, sweep,
              last_page_at, "updatedAt" AS updated_at
         FROM marketplace_discovery_cursors
        WHERE scope = $1`,
      [scope]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCursor(row);
  }

  public async ensureDiscoveryCursor(input: {
    readonly scope: string;
    readonly chainId: number;
    readonly identityRegistry: string;
    readonly pageSize: number;
  }): Promise<MarketplaceDiscoveryCursor> {
    const registry = normalizeEvmAddress(input.identityRegistry);
    if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_MARKETPLACE_CURSOR_PAGE_SIZE) {
      throw new Error("MARKETPLACE_CURSOR_CONFIGURATION_INVALID");
    }
    const result = await this.queryable.query<DiscoveryCursorRow>(
      `INSERT INTO marketplace_discovery_cursors
         (scope, chain_id, identity_registry, page_size, next_offset, total, sweep, last_page_at)
       VALUES ($1, $2, $3, $4, 0, NULL, 0, NULL)
       ON CONFLICT (scope) DO UPDATE SET "updatedAt" = marketplace_discovery_cursors."updatedAt"
       RETURNING scope, chain_id, identity_registry, page_size, next_offset, total, sweep,
                 last_page_at, "updatedAt" AS updated_at`,
      [input.scope, input.chainId, registry, input.pageSize]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("MARKETPLACE_CURSOR_NOT_PERSISTED");
    const cursor = mapCursor(row);
    if (cursor.chainId !== input.chainId || cursor.identityRegistry !== registry || cursor.pageSize !== input.pageSize) {
      throw new Error("MARKETPLACE_CURSOR_CONFIGURATION_CONFLICT");
    }
    return cursor;
  }

  public async advanceDiscoveryCursor(input: {
    readonly scope: string;
    readonly expectedOffset: number;
    readonly nextOffset: number;
    readonly total: number | null;
    readonly pageAt: Date;
  }): Promise<MarketplaceDiscoveryCursor> {
    if (!Number.isSafeInteger(input.expectedOffset) || input.expectedOffset < 0 || !Number.isSafeInteger(input.nextOffset) || input.nextOffset < 0 || !Number.isSafeInteger(input.total ?? 0) || (input.total !== null && input.total < 0)) {
      throw new Error("MARKETPLACE_CURSOR_POSITION_INVALID");
    }
    const result = await this.queryable.query<DiscoveryCursorRow>(
      `UPDATE marketplace_discovery_cursors
          SET next_offset = $1,
              total = $2,
              sweep = sweep + CASE WHEN $1 <= next_offset THEN 1 ELSE 0 END,
              last_page_at = $3,
              "updatedAt" = $3
        WHERE scope = $4 AND next_offset = $5
       RETURNING scope, chain_id, identity_registry, page_size, next_offset, total, sweep,
                 last_page_at, "updatedAt" AS updated_at`,
      [input.nextOffset, input.total, input.pageAt, input.scope, input.expectedOffset]
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("MARKETPLACE_CURSOR_CONFLICT");
    return mapCursor(row);
  }

  public async getRetryState(identityKey: string): Promise<MarketplaceRetryState | null> {
    const identity = parseIdentityKey(identityKey);
    const result = await this.queryable.query<RetryRow>(
      `SELECT concat(i.namespace, ':', i.chain_id, ':', i.identity_registry, ':', i.agent_id) AS identity_key,
              r.attempt_count, r.next_attempt_at, r.last_attempt_at, r.last_success_at,
              r.last_stage, r.last_error_code, r."updatedAt" AS updated_at
         FROM marketplace_ingestion_retries r
         JOIN erc8004_identities i ON i.id = r.identity_id
        WHERE i.namespace = $1 AND i.chain_id = $2 AND i.identity_registry = $3 AND i.agent_id = $4`,
      [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRetry(row);
  }

  public async isRetryDue(identityKey: string, now: Date): Promise<boolean> {
    const state = await this.getRetryState(identityKey);
    return state === null || state.nextAttemptAt.getTime() <= now.getTime();
  }

  public async recordRetry(identityKey: string, attempt: MarketplaceRetryAttempt): Promise<MarketplaceRetryState> {
    const identity = parseIdentityKey(identityKey);
    const existing = await this.getRetryState(identityKey);
    const successful = attempt.stage === "published";
    const retryBaseDelayMs = boundedDelay(attempt.retryBaseDelayMs, 60_000, 86_400_000);
    const retryMaxDelayMs = boundedDelay(attempt.retryMaxDelayMs, 1_800_000, 86_400_000);
    if (retryMaxDelayMs < retryBaseDelayMs) throw new Error("MARKETPLACE_STATE_DELAY_INVALID");
    const successDelayMs = boundedDelay(attempt.successDelayMs, 300_000, 86_400_000);
    const attemptCount = successful ? 0 : Math.min(31, (existing?.attemptCount ?? 0) + 1);
    const retryDelay = Math.min(retryMaxDelayMs, retryBaseDelayMs * (2 ** Math.max(0, attemptCount - 1)));
    const nextAttemptAt = new Date(attempt.attemptedAt.getTime() + (successful ? successDelayMs : retryDelay));
    const lastErrorCode = successful ? null : errorCode(attempt.errorCode);
    const identityRows = await this.queryable.query<IdentityRow>(
      `SELECT id, concat(namespace, ':', chain_id, ':', identity_registry, ':', agent_id) AS identity_key
         FROM erc8004_identities
        WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4`,
      [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
    );
    // A composition timeout can be observed before the normal ingestion
    // transaction creates its identity row. Materialize only the full tuple
    // (with all state axes left at their schema defaults) so its retry state
    // survives the restart; this never fabricates verification or listing.
    let row = identityRows.rows[0];
    if (row === undefined) {
      const inserted = await this.queryable.query<IdentityRow>(
        `INSERT INTO erc8004_identities (namespace, chain_id, identity_registry, agent_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, chain_id, identity_registry, agent_id) DO NOTHING
         RETURNING id, concat(namespace, ':', chain_id, ':', identity_registry, ':', agent_id) AS identity_key`,
        [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
      );
      row = inserted.rows[0];
      if (row === undefined) {
        row = (await this.queryable.query<IdentityRow>(
          `SELECT id, concat(namespace, ':', chain_id, ':', identity_registry, ':', agent_id) AS identity_key
             FROM erc8004_identities
            WHERE namespace = $1 AND chain_id = $2 AND identity_registry = $3 AND agent_id = $4`,
          [identity.namespace, identity.chainId, identity.identityRegistry, identity.agentId]
        )).rows[0];
      }
    }
    if (row === undefined) throw new Error("MARKETPLACE_RETRY_IDENTITY_MISSING");
    const result = await this.queryable.query<RetryRow>(
      `INSERT INTO marketplace_ingestion_retries
         (identity_id, attempt_count, next_attempt_at, last_attempt_at, last_success_at, last_stage, last_error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (identity_id) DO UPDATE SET
         attempt_count = EXCLUDED.attempt_count,
         next_attempt_at = EXCLUDED.next_attempt_at,
         last_attempt_at = EXCLUDED.last_attempt_at,
         last_success_at = EXCLUDED.last_success_at,
         last_stage = EXCLUDED.last_stage,
         last_error_code = EXCLUDED.last_error_code,
         "updatedAt" = EXCLUDED.last_attempt_at
       RETURNING $8::text AS identity_key, attempt_count, next_attempt_at, last_attempt_at,
                 last_success_at, last_stage, last_error_code, "updatedAt" AS updated_at`,
      [row.id, attemptCount, nextAttemptAt, attempt.attemptedAt, successful ? attempt.attemptedAt : existing?.lastSuccessAt ?? null, attempt.stage, lastErrorCode, erc8004IdentityKey(identity)]
    );
    const persisted = result.rows[0];
    if (persisted === undefined) throw new Error("MARKETPLACE_RETRY_NOT_PERSISTED");
    return mapRetry(persisted);
  }
}
