import { canonicalSha256Hex, erc8004IdentityKey } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { AgentIngestionService, type CandidateIngestionResult } from "./ingestion.js";
import type {
  EightHundredFourScanAdapter,
  EightHundredFourScanQuery
} from "./adapters/8004scan.js";
import type {
  ResumableScanRepository,
  ScanDiscoveryCheckpoint
} from "./types.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES = 100;
const DEFAULT_MAX_CANDIDATES = 500;
const MAX_CANDIDATES = 10_000;
const DEFAULT_MAX_RUN_MS = 120_000;
const MAX_RUN_MS = 600_000;
const MAX_OFFSET = 10_000_000;
const MAX_CURSOR_LENGTH = 256;

export type Erc8004ScanJobGate =
  | "ERC8004_INGESTION_ENABLED"
  | "ERC8004SCAN_DISCOVERY_ENABLED";

export type Erc8004ScanJobGates = Readonly<Record<Erc8004ScanJobGate, boolean>>;

export const disabledErc8004ScanJobGates: Erc8004ScanJobGates = Object.freeze({
  ERC8004_INGESTION_ENABLED: false,
  ERC8004SCAN_DISCOVERY_ENABLED: false
});

export type Erc8004ScanJobRunOptions = {
  /** Stable non-secret identifier for one query stream. */
  readonly scope: string;
  readonly query?: EightHundredFourScanQuery;
  /** Maximum provider pages fetched by this invocation. */
  readonly maxPages?: number;
  /** Maximum candidates accepted by this invocation. */
  readonly maxCandidates?: number;
  /** Wall-clock limit for this invocation, including provider calls. */
  readonly maxRunMs?: number;
  /** Caller cancellation; no state is committed after it is observed. */
  readonly signal?: AbortSignal;
};

export type Erc8004ScanJobMetrics = {
  readonly pagesFetched: number;
  readonly candidatesFetched: number;
  readonly pagesCommitted: number;
  readonly candidatesCommitted: number;
  readonly durationMs: number;
};

export type Erc8004ScanJobResult = {
  readonly status: "disabled" | "completed" | "partial";
  readonly scope: string;
  readonly queryDigest: string | null;
  readonly checkpoint: ScanDiscoveryCheckpoint | null;
  readonly nextOffset: number | null;
  readonly nextCursor: string | null;
  readonly total: number | null;
  /** Results contain only normalized public fields and bounded rejection data. */
  readonly candidates: readonly CandidateIngestionResult[];
  readonly metrics: Erc8004ScanJobMetrics;
  readonly warnings: readonly string[];
};

export type Erc8004ScanJobOptions = {
  readonly repository: ResumableScanRepository;
  readonly adapter?: EightHundredFourScanAdapter;
  readonly gates?: Partial<Erc8004ScanJobGates>;
  readonly now?: () => Date;
};

type NormalizedQuery = {
  readonly base: EightHundredFourScanQuery;
  readonly pageSize: number;
  readonly initialOffset: number | null;
  readonly initialCursor: string | null;
  readonly queryDigest: string;
  readonly explicitStart: boolean;
};

function mergeGates(input: Partial<Erc8004ScanJobGates> | undefined): Erc8004ScanJobGates {
  return {
    ...disabledErc8004ScanJobGates,
    ...(input ?? {})
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      `The 8004scan job ${field} is outside its safe bound.`,
      "fix_scan_configuration"
    );
  }
  return result;
}

function normalizedScope(scope: string): string {
  const value = scope.trim();
  if (
    value.length === 0 ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      "The 8004scan job scope is invalid.",
      "fix_scan_configuration"
    );
  }
  return value;
}

function normalizeOffset(value: number | undefined): number {
  if (
    value === undefined ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_OFFSET
  ) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      "The 8004scan job start offset is invalid.",
      "fix_scan_configuration"
    );
  }
  return value;
}

function normalizeCursor(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const normalized = value.trim();
  if (!/^[0-9]+$/u.test(normalized)) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      "The reviewed 8004scan API requires a numeric offset cursor.",
      "fix_scan_pagination"
    );
  }
  const parsed = Number(normalized);
  return normalizeOffset(parsed);
}

function normalizeQuery(query: EightHundredFourScanQuery | undefined): NormalizedQuery {
  const input = query ?? {};
  if (input.offset !== undefined && input.cursor !== undefined) {
    throw ingestionError(
      "SCAN_JOB_CONFIG_INVALID",
      "The 8004scan job cannot start with both offset and cursor.",
      "fix_scan_pagination"
    );
  }
  const pageSize = boundedInteger(input.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, "page size");
  const explicitStart = input.offset !== undefined || input.cursor !== undefined;
  const initialOffset = input.offset === undefined
    ? normalizeCursor(input.cursor)
    : normalizeOffset(input.offset);
  const base: EightHundredFourScanQuery = {
    limit: pageSize,
    ...(input.chainId === undefined ? {} : { chainId: input.chainId }),
    ...(input.isTestnet === undefined ? {} : { isTestnet: input.isTestnet }),
    ...(input.supportedProtocol === undefined ? {} : { supportedProtocol: input.supportedProtocol }),
    ...(input.search === undefined ? {} : { search: input.search })
  };
  const queryDigest = canonicalSha256Hex({
    ...(base.chainId === undefined ? {} : { chainId: base.chainId }),
    ...(base.isTestnet === undefined ? {} : { isTestnet: base.isTestnet }),
    ...(base.supportedProtocol === undefined ? {} : { supportedProtocol: base.supportedProtocol }),
    ...(base.search === undefined ? {} : { search: base.search }),
    limit: pageSize
  });
  return {
    base,
    pageSize,
    initialOffset,
    initialCursor: null,
    queryDigest,
    explicitStart
  };
}

function scanJobError(
  code: "SCAN_JOB_CHECKPOINT_CONFLICT" | "SCAN_JOB_PROVIDER_INVALID",
  message: string,
  details?: unknown
): ReturnType<typeof ingestionError> {
  return ingestionError(code, message, code === "SCAN_JOB_PROVIDER_INVALID" ? "review_scan_provider" : "reload_scan_checkpoint", details);
}

function cancelledError(): ReturnType<typeof ingestionError> {
  return ingestionError(
    "SCAN_JOB_CANCELLED",
    "The 8004scan discovery run was cancelled or exceeded its time limit.",
    "resume_scan_run",
    undefined,
    true
  );
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledError();
}

function pageDigest(
  scope: string,
  queryDigest: string,
  offset: number | null,
  cursor: string | null,
  page: Awaited<ReturnType<EightHundredFourScanAdapter["fetchPage"]>>
): string {
  return canonicalSha256Hex({
    scope,
    queryDigest,
    offset,
    cursor,
    identities: page.candidates.map((candidate) => ({
      identity: candidate.identity,
      source: candidate.source,
      sourceReference: candidate.sourceReference
    })),
    nextOffset: page.nextOffset ?? null,
    nextCursor: page.nextCursor ?? null,
    total: page.total ?? null
  });
}

function validateCheckpointConfiguration(
  checkpoint: ScanDiscoveryCheckpoint,
  scope: string,
  query: NormalizedQuery
): void {
  if (
    checkpoint.scope !== scope ||
    checkpoint.queryDigest !== query.queryDigest ||
    checkpoint.pageSize !== query.pageSize ||
    (query.explicitStart &&
      (checkpoint.initialOffset !== query.initialOffset || checkpoint.initialCursor !== query.initialCursor))
  ) {
    throw scanJobError(
      "SCAN_JOB_CHECKPOINT_CONFLICT",
      "The persisted 8004scan checkpoint does not match this query scope.",
      { scope, queryDigest: query.queryDigest }
    );
  }
  if (checkpoint.nextOffset !== null && checkpoint.nextCursor !== null) {
    throw scanJobError(
      "SCAN_JOB_CHECKPOINT_CONFLICT",
      "The persisted 8004scan checkpoint contains both offset and cursor state.",
      { scope }
    );
  }
}

function validatePage(
  page: Awaited<ReturnType<EightHundredFourScanAdapter["fetchPage"]>>,
  currentOffset: number | null,
  currentCursor: string | null,
  requestedLimit: number
): { readonly nextOffset: number | null; readonly nextCursor: string | null; readonly total: number | null } {
  if (!Array.isArray(page.candidates) || page.candidates.length > requestedLimit) {
    throw scanJobError(
      "SCAN_JOB_PROVIDER_INVALID",
      "The 8004scan page exceeded the requested candidate bound."
    );
  }
  if (
    page.total !== undefined &&
    (page.total === null || !Number.isSafeInteger(page.total) || page.total < 0)
  ) {
    throw scanJobError("SCAN_JOB_PROVIDER_INVALID", "The 8004scan total is invalid.");
  }
  const nextOffset = page.nextOffset ?? null;
  const nextCursor = page.nextCursor ?? null;
  if (nextOffset !== null) {
    if (
      !Number.isSafeInteger(nextOffset) ||
      nextOffset < 0 ||
      nextOffset > MAX_OFFSET ||
      currentOffset === null ||
      nextOffset <= currentOffset
    ) {
      throw scanJobError("SCAN_JOB_PROVIDER_INVALID", "The 8004scan offset did not advance.");
    }
    if (nextCursor !== null && /^[0-9]+$/u.test(nextCursor) && Number(nextCursor) !== nextOffset) {
      throw scanJobError("SCAN_JOB_PROVIDER_INVALID", "The 8004scan offset and cursor disagree.");
    }
    return { nextOffset, nextCursor: null, total: page.total ?? null };
  }
  if (nextCursor !== null) {
    if (
      typeof nextCursor !== "string" ||
      nextCursor.trim().length === 0 ||
      nextCursor.length > MAX_CURSOR_LENGTH ||
      nextCursor === currentCursor
    ) {
      throw scanJobError("SCAN_JOB_PROVIDER_INVALID", "The 8004scan cursor did not advance.");
    }
    return { nextOffset: null, nextCursor, total: page.total ?? null };
  }
  return { nextOffset: null, nextCursor: null, total: page.total ?? null };
}

function timerSignal(
  parent: AbortSignal | undefined,
  maxRunMs: number
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort();
  if (parent?.aborted === true) controller.abort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), maxRunMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}

/**
 * Bounded, resumable 8004scan list ingestion. Each page is committed with
 * its provider checkpoint, while a transaction-scoped lock prevents two
 * workers from consuming the same scope concurrently. Ingestion only writes
 * discovery/source observations; verification and publication remain separate.
 */
export class Erc8004ScanJob {
  private readonly repository: ResumableScanRepository;
  private readonly adapter: EightHundredFourScanAdapter | undefined;
  private readonly gates: Erc8004ScanJobGates;
  private readonly now: () => Date;

  public constructor(options: Erc8004ScanJobOptions) {
    this.repository = options.repository;
    this.adapter = options.adapter;
    this.gates = mergeGates(options.gates);
    this.now = options.now ?? (() => new Date());
  }

  public featureGates(): Erc8004ScanJobGates {
    return this.gates;
  }

  public async run(options: Erc8004ScanJobRunOptions): Promise<Erc8004ScanJobResult> {
    const startedAt = this.now();
    const scope = normalizedScope(options.scope);
    const maxPages = boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, MAX_PAGES, "page count");
    const maxCandidates = boundedInteger(options.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, MAX_CANDIDATES, "candidate count");
    const maxRunMs = boundedInteger(options.maxRunMs, DEFAULT_MAX_RUN_MS, 250, MAX_RUN_MS, "run time");
    if (!this.gates.ERC8004_INGESTION_ENABLED || !this.gates.ERC8004SCAN_DISCOVERY_ENABLED) {
      return {
        status: "disabled",
        scope,
        queryDigest: null,
        checkpoint: null,
        nextOffset: null,
        nextCursor: null,
        total: null,
        candidates: [],
        metrics: { pagesFetched: 0, candidatesFetched: 0, pagesCommitted: 0, candidatesCommitted: 0, durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()) },
        warnings: ["ERC-8004 discovery is disabled by feature gate."]
      };
    }
    if (this.adapter === undefined) {
      throw ingestionError("SCAN_JOB_CONFIG_INVALID", "The 8004scan discovery adapter is not configured.", "configure_scan_adapter");
    }
    const query = normalizeQuery(options.query);
    const timed = timerSignal(options.signal, maxRunMs);
    try {
      assertNotAborted(timed.signal);
      return await this.repository.withScanDiscoveryRunLock(scope, () =>
        this.runLocked(scope, query, maxPages, maxCandidates, timed.signal, startedAt)
      );
    } finally {
      timed.dispose();
    }
  }

  private async runLocked(
    scope: string,
    query: NormalizedQuery,
    maxPages: number,
    maxCandidates: number,
    signal: AbortSignal,
    startedAt: Date
  ): Promise<Erc8004ScanJobResult> {
    const persisted = await this.repository.getScanDiscoveryCheckpoint(scope);
    if (persisted !== null) validateCheckpointConfiguration(persisted, scope, query);
    const initialOffset = persisted?.initialOffset ?? query.initialOffset;
    const initialCursor = persisted?.initialCursor ?? query.initialCursor;
    if (persisted !== null && persisted.completedAt !== null) {
      return this.resultFromCheckpoint(persisted, startedAt, [], 0, 0, 0, 0, []);
    }
    let nextOffset = persisted?.nextOffset ?? initialOffset;
    let nextCursor = persisted?.nextCursor ?? initialCursor;
    let checkpoint = persisted;
    let pagesFetched = 0;
    let candidatesFetched = 0;
    let pagesCommitted = 0;
    let candidatesCommitted = 0;
    const candidates: CandidateIngestionResult[] = [];
    const warnings: string[] = [];
    while (pagesFetched < maxPages && candidatesFetched < maxCandidates) {
      assertNotAborted(signal);
      const requestedLimit = Math.min(query.pageSize, maxCandidates - candidatesFetched);
      const pageQuery: EightHundredFourScanQuery = {
        ...query.base,
        limit: requestedLimit,
        ...(nextOffset === null ? {} : { offset: nextOffset }),
        ...(nextCursor === null ? {} : { cursor: nextCursor }),
        signal
      };
      let page: Awaited<ReturnType<EightHundredFourScanAdapter["fetchPage"]>>;
      try {
        page = await this.adapter!.fetchPage(pageQuery);
      } catch (error) {
        if (signal.aborted) throw cancelledError();
        throw error;
      }
      assertNotAborted(signal);
      const positionOffset = nextOffset;
      const positionCursor = nextCursor;
      const validated = validatePage(page, positionOffset, positionCursor, requestedLimit);
      const nextCheckpoint: ScanDiscoveryCheckpoint = {
        scope,
        queryDigest: query.queryDigest,
        initialOffset,
        initialCursor,
        nextOffset: validated.nextOffset,
        nextCursor: validated.nextCursor,
        pageSize: query.pageSize,
        total: validated.total,
        pagesProcessed: (checkpoint?.pagesProcessed ?? 0) + 1,
        candidatesProcessed: (checkpoint?.candidatesProcessed ?? 0) + page.candidates.length,
        lastPageDigest: pageDigest(scope, query.queryDigest, positionOffset, positionCursor, page),
        cursorVersion: (checkpoint?.cursorVersion ?? 0) + 1,
        completedAt: validated.nextOffset === null && validated.nextCursor === null ? this.now() : null,
        updatedAt: this.now()
      };
      let pageCandidates: readonly CandidateIngestionResult[] = [];
      assertNotAborted(signal);
      await this.repository.withTransaction(async (unitOfWork) => {
        assertNotAborted(signal);
        const ingestion = new AgentIngestionService(unitOfWork, { now: this.now });
        pageCandidates = await ingestion.ingestCandidatesWithinTransaction(unitOfWork, page.candidates);
        assertNotAborted(signal);
        const scanUnit = unitOfWork as ResumableScanRepository;
        await scanUnit.saveScanDiscoveryCheckpoint(nextCheckpoint, {
          expectedCursorVersion: checkpoint?.cursorVersion ?? null,
          expectedQueryDigest: checkpoint?.queryDigest ?? query.queryDigest,
          expectedInitialOffset: checkpoint?.initialOffset ?? initialOffset,
          expectedInitialCursor: checkpoint?.initialCursor ?? initialCursor
        });
      });
      assertNotAborted(signal);
      candidates.push(...pageCandidates);
      pagesFetched += 1;
      candidatesFetched += page.candidates.length;
      pagesCommitted += 1;
      candidatesCommitted += pageCandidates.length;
      for (const candidate of pageCandidates) {
        if (candidate.rejectedServices.length > 0) warnings.push("SERVICE_OBSERVATIONS_REJECTED");
        if (candidate.capabilityError !== null) warnings.push("CAPABILITY_OBSERVATION_REJECTED");
      }
      checkpoint = nextCheckpoint;
      nextOffset = validated.nextOffset;
      nextCursor = validated.nextCursor;
      if (nextOffset === null && nextCursor === null) break;
    }
    if (checkpoint === null) {
      throw ingestionError("REPOSITORY_FAILURE", "The 8004scan job did not persist a checkpoint.", "repair_repository_mapping");
    }
    return this.resultFromCheckpoint(
      checkpoint,
      startedAt,
      candidates,
      pagesFetched,
      candidatesFetched,
      pagesCommitted,
      candidatesCommitted,
      warnings
    );
  }

  private resultFromCheckpoint(
    checkpoint: ScanDiscoveryCheckpoint,
    startedAt: Date,
    candidates: readonly CandidateIngestionResult[],
    pagesFetched: number,
    candidatesFetched: number,
    pagesCommitted: number,
    candidatesCommitted: number,
    warnings: readonly string[]
  ): Erc8004ScanJobResult {
    const finishedAt = this.now();
    const status = checkpoint.nextOffset === null && checkpoint.nextCursor === null ? "completed" : "partial";
    return {
      status,
      scope: checkpoint.scope,
      queryDigest: checkpoint.queryDigest,
      checkpoint,
      nextOffset: checkpoint.nextOffset,
      nextCursor: checkpoint.nextCursor,
      total: checkpoint.total,
      candidates,
      metrics: {
        pagesFetched,
        candidatesFetched,
        pagesCommitted,
        candidatesCommitted,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime())
      },
      warnings: [...new Set(warnings)]
    };
  }
}

export function createErc8004ScanJob(options: Erc8004ScanJobOptions): Erc8004ScanJob {
  return new Erc8004ScanJob(options);
}

/** Return only the stable identity string needed by job evidence/tests. */
export function scanCandidateIdentityKey(candidate: CandidateIngestionResult): string {
  return erc8004IdentityKey(candidate.identity.identity);
}
