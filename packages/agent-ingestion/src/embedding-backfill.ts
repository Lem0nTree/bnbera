import pg from "pg";
import {
  agentCategorySchema,
  canonicalSha256Hex,
  erc8004IdentityKey,
  normalizeErc8004Identity,
  type AgentCategory,
  type Erc8004Identity
} from "@bnbera/domain";
import { AppError } from "@bnbera/config";
import { ingestionError } from "./errors.js";
import {
  buildSemanticDocument,
  semanticDocumentSchemaVersion,
  validateEmbeddingProvider,
  type EmbeddingProvider,
  type SemanticDocumentInput
} from "./semantic.js";
import type { CanonicalSemanticDocument } from "./semantic.js";
import { ensureSemanticVector, type SemanticVectorRepository, type SemanticVectorRecord } from "./vector.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^[0-9a-f]{64}$/iu;
const maxPageSize = 128;
const maxPagesPerRun = 100;
const maxItemsPerRun = 10_000;
const maxRunMs = 600_000;
const maxRetries = 5;
const maxDbInteger = 2_147_483_647;
const defaultPageSize = 32;
const defaultPagesPerRun = 10;
const defaultItemsPerRun = 1_000;
const defaultRunMs = 120_000;
const defaultRetries = 2;
const defaultBackoffMs = 250;
const maxBackoffMs = 8_000;

/**
 * A verified immutable agent version projected into the semantic index. The
 * source is deliberately a public allow-list; live prices, balances, health,
 * prompts, runtime logs, and credentials are not part of this contract.
 */
export type EmbeddingBackfillCandidate = {
  readonly agentVersionId: string;
  readonly identity: Erc8004Identity;
  readonly category: AgentCategory;
  readonly publicMetadata: Readonly<Record<string, unknown>>;
  readonly capabilityManifest?: unknown;
  readonly protocols?: readonly unknown[];
  readonly actions?: readonly unknown[];
  readonly services?: readonly unknown[];
  readonly riskSummary?: Readonly<Record<string, unknown>>;
  readonly authoritySummary?: Readonly<Record<string, unknown>>;
  readonly evidenceSummary?: Readonly<Record<string, unknown>>;
  readonly classifierVersion?: string | null;
};

export type EmbeddingBackfillCandidatePage = {
  readonly candidates: readonly EmbeddingBackfillCandidate[];
};

export interface EmbeddingBackfillSource {
  listCandidates(input: {
    readonly afterAgentVersionId: string | null;
    readonly limit: number;
  }): Promise<EmbeddingBackfillCandidatePage | readonly EmbeddingBackfillCandidate[]>;
}

export type EmbeddingBackfillCheckpoint = {
  readonly scope: string;
  readonly configurationDigest: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  readonly semanticDocumentSchemaVersion: string;
  /** UUID cursor in the stable agent-version ordering. */
  readonly lastAgentVersionId: string | null;
  readonly attempted: number;
  readonly generated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly cursorVersion: number;
  readonly completedAt: Date | null;
  readonly updatedAt: Date;
};

export type EmbeddingBackfillCheckpointWriteCondition = {
  readonly expectedCursorVersion: number | null;
  readonly expectedConfigurationDigest: string;
};

export interface EmbeddingBackfillCheckpointRepository {
  getEmbeddingBackfillCheckpoint(scope: string): Promise<EmbeddingBackfillCheckpoint | null>;
  saveEmbeddingBackfillCheckpoint(
    input: EmbeddingBackfillCheckpoint,
    condition: EmbeddingBackfillCheckpointWriteCondition
  ): Promise<EmbeddingBackfillCheckpoint>;
  withEmbeddingBackfillRunLock<T>(scope: string, work: () => Promise<T>): Promise<T>;
}

export type EmbeddingBackfillRepository = EmbeddingBackfillSource & EmbeddingBackfillCheckpointRepository;

export type EmbeddingBackfillGate = "ERC8004_INGESTION_ENABLED" | "MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED";
export type EmbeddingBackfillGates = Readonly<Record<EmbeddingBackfillGate, boolean>>;

export const disabledEmbeddingBackfillGates: EmbeddingBackfillGates = Object.freeze({
  ERC8004_INGESTION_ENABLED: false,
  MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED: false
});

export type EmbeddingBackfillRunOptions = {
  readonly scope: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly maxRunMs?: number;
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
};

export type EmbeddingBackfillFailure = {
  readonly agentVersionId: string;
  readonly code: string;
  readonly retriable: boolean;
};

export type EmbeddingBackfillResult = {
  readonly status: "disabled" | "completed" | "partial";
  readonly scope: string;
  readonly configurationDigest: string | null;
  readonly checkpoint: EmbeddingBackfillCheckpoint | null;
  readonly nextAgentVersionId: string | null;
  readonly attempted: number;
  readonly generated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly pagesFetched: number;
  readonly failures: readonly EmbeddingBackfillFailure[];
  readonly warnings: readonly string[];
};

export type EmbeddingBackfillJobOptions = {
  readonly source: EmbeddingBackfillSource;
  readonly vectorRepository: SemanticVectorRepository;
  readonly checkpointRepository?: EmbeddingBackfillCheckpointRepository;
  /** Optional so a disabled gate does not require provider configuration. */
  readonly provider?: EmbeddingProvider;
  readonly gates?: Partial<EmbeddingBackfillGates>;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
};

type RunBudget = {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly maxItems: number;
  readonly maxRunMs: number;
  readonly maxRetries: number;
};

type TimerSignal = {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
};

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw ingestionError("EMBEDDING_BACKFILL_CONFIG_INVALID", `The embedding backfill ${field} is outside its safe bound.`, "fix_embedding_backfill_configuration");
  }
  return result;
}

function boundedScope(value: string): string {
  const scope = value.trim();
  if (scope.length === 0 || scope.length > 160 || /[\u0000-\u001f\u007f]/u.test(scope)) {
    throw ingestionError("EMBEDDING_BACKFILL_CONFIG_INVALID", "The embedding backfill scope is invalid.", "fix_embedding_backfill_configuration");
  }
  return scope;
}

function boundedUuid(value: string, field: string): string {
  if (!uuidPattern.test(value)) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", `The embedding backfill ${field} is invalid.`, "repair_embedding_source");
  }
  return value.toLowerCase();
}

function boundedDigest(value: string, field: string): string {
  if (!digestPattern.test(value)) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", `The embedding backfill ${field} is invalid.`, "repair_embedding_checkpoint");
  }
  return value.toLowerCase();
}

function normalizeCategory(value: unknown): AgentCategory {
  const parsed = agentCategorySchema.safeParse(value);
  if (!parsed.success) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source category is invalid.", "repair_embedding_source", parsed.error);
  }
  return parsed.data;
}

function dateValue(value: Date, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", `The embedding backfill ${field} timestamp is invalid.`, "repair_embedding_checkpoint");
  }
  return value;
}

function normalizeGates(input: Partial<EmbeddingBackfillGates> | undefined): EmbeddingBackfillGates {
  return {
    ...disabledEmbeddingBackfillGates,
    ...(input ?? {})
  };
}

function configurationDigest(provider: EmbeddingProvider): string {
  return canonicalSha256Hex({
    provider: provider.provider,
    model: provider.model,
    modelVersion: provider.modelVersion,
    dimension: provider.dimension,
    semanticDocumentSchemaVersion
  });
}

function timerSignal(parent: AbortSignal | undefined, durationMs: number): TimerSignal {
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort();
  if (parent?.aborted === true) controller.abort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), durationMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}

function cancelledError(): ReturnType<typeof ingestionError> {
  return ingestionError(
    "EMBEDDING_BACKFILL_CANCELLED",
    "The embedding backfill was cancelled or exceeded its time limit.",
    "resume_embedding_backfill",
    undefined,
    true
  );
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledError();
}

function sourcePage(value: EmbeddingBackfillCandidatePage | readonly EmbeddingBackfillCandidate[]): readonly EmbeddingBackfillCandidate[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && "candidates" in value && Array.isArray(value.candidates)) return value.candidates;
  throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source returned an invalid page.", "repair_embedding_source");
}

function normalizeCandidate(candidate: EmbeddingBackfillCandidate): EmbeddingBackfillCandidate {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source candidate is not an object.", "repair_embedding_source");
  }
  const agentVersionId = boundedUuid(candidate.agentVersionId, "agent version id");
  let identity: Erc8004Identity;
  try {
    identity = normalizeErc8004Identity(candidate.identity);
  } catch (cause) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source identity is invalid.", "repair_embedding_source", cause);
  }
  const category = normalizeCategory(candidate.category);
  if (typeof candidate.publicMetadata !== "object" || candidate.publicMetadata === null || Array.isArray(candidate.publicMetadata) ||
      (Object.getPrototypeOf(candidate.publicMetadata) !== Object.prototype && Object.getPrototypeOf(candidate.publicMetadata) !== null)) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The semantic source metadata is not a public object.", "repair_embedding_source");
  }
  return {
    ...candidate,
    agentVersionId,
    identity,
    category,
    publicMetadata: candidate.publicMetadata
  };
}

function semanticInput(candidate: EmbeddingBackfillCandidate): SemanticDocumentInput {
  const metadata = candidate.publicMetadata;
  const name = metadata.name;
  const description = metadata.description;
  return {
    identity: candidate.identity,
    category: candidate.category,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(candidate.capabilityManifest === undefined ? {} : { capabilityManifest: candidate.capabilityManifest }),
    ...(candidate.protocols === undefined ? {} : { protocols: candidate.protocols }),
    ...(candidate.actions === undefined ? {} : { actions: candidate.actions }),
    ...(candidate.services === undefined ? {} : { services: candidate.services }),
    ...(candidate.riskSummary === undefined ? {} : { riskSummary: candidate.riskSummary }),
    ...(candidate.authoritySummary === undefined ? {} : { authoritySummary: candidate.authoritySummary }),
    ...(candidate.evidenceSummary === undefined ? {} : { evidenceSummary: candidate.evidenceSummary }),
    ...(candidate.classifierVersion === undefined || candidate.classifierVersion === null
      ? {}
      : { classifierVersion: candidate.classifierVersion })
  };
}

function failureDetails(error: unknown): { readonly code: string; readonly retriable: boolean } {
  if (error instanceof AppError) return { code: error.code, retriable: error.retriable };
  return { code: "EMBEDDING_BACKFILL_FAILED", retriable: false };
}

function shouldRetry(error: unknown): boolean {
  return error instanceof AppError && error.retriable;
}

function baseCheckpoint(
  scope: string,
  provider: EmbeddingProvider,
  digest: string,
  now: Date
): EmbeddingBackfillCheckpoint {
  return {
    scope,
    configurationDigest: digest,
    provider: provider.provider,
    model: provider.model,
    modelVersion: provider.modelVersion,
    dimension: provider.dimension,
    semanticDocumentSchemaVersion,
    lastAgentVersionId: null,
    attempted: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    cursorVersion: 0,
    completedAt: null,
    updatedAt: now
  };
}

function assertCheckpointMatches(checkpoint: EmbeddingBackfillCheckpoint, scope: string, provider: EmbeddingProvider, digest: string): void {
  if (
    checkpoint.scope !== scope ||
    checkpoint.configurationDigest !== digest ||
    checkpoint.provider !== provider.provider ||
    checkpoint.model !== provider.model ||
    checkpoint.modelVersion !== provider.modelVersion ||
    checkpoint.dimension !== provider.dimension ||
    checkpoint.semanticDocumentSchemaVersion !== semanticDocumentSchemaVersion
  ) {
    throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The persisted embedding backfill checkpoint uses a different index configuration.", "start_new_embedding_backfill_scope");
  }
  if (checkpoint.lastAgentVersionId !== null) boundedUuid(checkpoint.lastAgentVersionId, "checkpoint cursor");
  if (!Number.isSafeInteger(checkpoint.attempted) || checkpoint.attempted < 0 || checkpoint.attempted > maxDbInteger || !Number.isSafeInteger(checkpoint.generated) || checkpoint.generated < 0 || checkpoint.generated > maxDbInteger || !Number.isSafeInteger(checkpoint.skipped) || checkpoint.skipped < 0 || checkpoint.skipped > maxDbInteger || !Number.isSafeInteger(checkpoint.failed) || checkpoint.failed < 0 || checkpoint.failed > maxDbInteger || !Number.isSafeInteger(checkpoint.cursorVersion) || checkpoint.cursorVersion < 0 || checkpoint.cursorVersion > maxDbInteger) {
    throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The persisted embedding backfill counters are invalid.", "repair_embedding_checkpoint");
  }
  dateValue(checkpoint.updatedAt, "checkpoint updated");
  if (checkpoint.completedAt !== null) dateValue(checkpoint.completedAt, "checkpoint completed");
}

function checkpointCondition(checkpoint: EmbeddingBackfillCheckpoint | null, digest: string): EmbeddingBackfillCheckpointWriteCondition {
  return {
    expectedCursorVersion: checkpoint?.cursorVersion ?? null,
    expectedConfigurationDigest: checkpoint?.configurationDigest ?? digest
  };
}

function checkpointWith(
  previous: EmbeddingBackfillCheckpoint | null,
  base: EmbeddingBackfillCheckpoint,
  input: Partial<Pick<EmbeddingBackfillCheckpoint, "lastAgentVersionId" | "attempted" | "generated" | "skipped" | "failed" | "completedAt">>,
  now: Date
): EmbeddingBackfillCheckpoint {
  return {
    ...(previous ?? base),
    ...input,
    cursorVersion: (previous?.cursorVersion ?? 0) + 1,
    updatedAt: now
  };
}

async function retryBounded<T>(
  operation: () => Promise<T>,
  retries: number,
  sleep: (milliseconds: number) => Promise<void>,
  random: () => number,
  signal: AbortSignal
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    assertNotAborted(signal);
    try {
      return await operation();
    } catch (error) {
      if (!shouldRetry(error) || attempt >= retries) throw error;
      const exponential = Math.min(maxBackoffMs, defaultBackoffMs * (2 ** attempt));
      const jitter = Math.round(exponential * 0.25 * Math.max(0, Math.min(1, random())));
      await sleep(Math.min(maxBackoffMs, exponential + jitter));
    }
  }
}

/**
 * Bounded, resumable embedding generation. Vectors are written before the
 * cursor advances; replaying after a crash is safe because
 * `ensureSemanticVector` checks the complete provider/model/version/dimension
 * and semantic-document hash identity. A failed item leaves the cursor before
 * that item so a later invocation can retry after the source/provider is fixed.
 */
export class EmbeddingBackfillJob {
  private readonly source: EmbeddingBackfillSource;
  private readonly vectorRepository: SemanticVectorRepository;
  private readonly checkpointRepository: EmbeddingBackfillCheckpointRepository;
  private readonly provider: EmbeddingProvider | undefined;
  private readonly gates: EmbeddingBackfillGates;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  public constructor(options: EmbeddingBackfillJobOptions) {
    this.source = options.source;
    this.vectorRepository = options.vectorRepository;
    this.checkpointRepository = options.checkpointRepository ?? new InMemoryEmbeddingBackfillRepository();
    this.provider = options.provider === undefined ? undefined : validateEmbeddingProvider(options.provider);
    this.gates = normalizeGates(options.gates);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  public featureGates(): EmbeddingBackfillGates {
    return this.gates;
  }

  public async run(options: EmbeddingBackfillRunOptions): Promise<EmbeddingBackfillResult> {
    const scope = boundedScope(options.scope);
    const started = this.now();
    if (!this.gates.ERC8004_INGESTION_ENABLED || !this.gates.MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED) {
      return {
        status: "disabled",
        scope,
        configurationDigest: null,
        checkpoint: null,
        nextAgentVersionId: null,
        attempted: 0,
        generated: 0,
        skipped: 0,
        failed: 0,
        pagesFetched: 0,
        failures: [],
        warnings: ["Embedding backfill is disabled by feature gate."]
      };
    }
    if (this.provider === undefined) {
      throw ingestionError("EMBEDDING_BACKFILL_CONFIG_INVALID", "Embedding backfill requires a configured provider.", "configure_embedding_provider");
    }
    const provider = this.provider;
    const budget: RunBudget = {
      pageSize: boundedInteger(options.pageSize, defaultPageSize, 1, maxPageSize, "page size"),
      maxPages: boundedInteger(options.maxPages, defaultPagesPerRun, 1, maxPagesPerRun, "page count"),
      maxItems: boundedInteger(options.maxItems, defaultItemsPerRun, 1, maxItemsPerRun, "item count"),
      maxRunMs: boundedInteger(options.maxRunMs, defaultRunMs, 250, maxRunMs, "run time"),
      maxRetries: boundedInteger(options.maxRetries, defaultRetries, 0, maxRetries, "retry count")
    };
    const digest = configurationDigest(provider);
    const timed = timerSignal(options.signal, budget.maxRunMs);
    try {
      assertNotAborted(timed.signal);
      return await this.checkpointRepository.withEmbeddingBackfillRunLock(scope, () => this.runLocked(scope, digest, provider, budget, timed.signal, started));
    } finally {
      timed.dispose();
    }
  }

  private async runLocked(
    scope: string,
    digest: string,
    provider: EmbeddingProvider,
    budget: RunBudget,
    signal: AbortSignal,
    started: Date
  ): Promise<EmbeddingBackfillResult> {
    const persisted = await this.checkpointRepository.getEmbeddingBackfillCheckpoint(scope);
    if (persisted !== null) assertCheckpointMatches(persisted, scope, provider, digest);
    const base = baseCheckpoint(scope, provider, digest, this.now());
    if (persisted?.completedAt !== null && persisted?.completedAt !== undefined) {
      return this.result(scope, configurationDigest(provider), persisted, 0, [], [], started);
    }
    let checkpoint = persisted;
    let cursor = persisted?.lastAgentVersionId ?? null;
    let pagesFetched = 0;
    let runAttempted = 0;
    const failures: EmbeddingBackfillFailure[] = [];
    const warnings: string[] = [];

    while (pagesFetched < budget.maxPages && runAttempted < budget.maxItems) {
      assertNotAborted(signal);
      const remaining = budget.maxItems - runAttempted;
      const pageSize = Math.min(budget.pageSize, remaining);
      let page: readonly EmbeddingBackfillCandidate[];
      try {
        page = sourcePage(await this.source.listCandidates({ afterAgentVersionId: cursor, limit: pageSize }));
      } catch (error) {
        warnings.push(failureDetails(error).code);
        return this.result(scope, digest, checkpoint, pagesFetched, failures, warnings, started);
      }
      pagesFetched += 1;
      if (page.length > pageSize) {
        throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source exceeded the requested page bound.", "repair_embedding_source");
      }
      if (page.length === 0) {
        const completed = checkpointWith(checkpoint, base, { completedAt: this.now() }, this.now());
        checkpoint = await this.checkpointRepository.saveEmbeddingBackfillCheckpoint(completed, checkpointCondition(checkpoint, digest));
        return this.result(scope, digest, checkpoint, pagesFetched, failures, warnings, started);
      }
      const seen = new Set<string>();
      for (const rawCandidate of page) {
        assertNotAborted(signal);
        const candidate = normalizeCandidate(rawCandidate);
        if (seen.has(candidate.agentVersionId) || (cursor !== null && candidate.agentVersionId <= cursor)) {
          throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The embedding source page is not strictly ordered by agent version.", "repair_embedding_source");
        }
        seen.add(candidate.agentVersionId);
        const document: CanonicalSemanticDocument = buildSemanticDocument(semanticInput(candidate));
        let vector: { readonly record: SemanticVectorRecord; readonly generated: boolean };
        try {
          vector = await retryBounded(
            () => ensureSemanticVector({
              agentVersionId: candidate.agentVersionId,
              document,
              classifierVersion: candidate.classifierVersion ?? null,
              provider,
              now: this.now()
            }, this.vectorRepository),
            budget.maxRetries,
            this.sleep,
            this.random,
            signal
          );
        } catch (error) {
          const details = failureDetails(error);
          failures.push({ agentVersionId: candidate.agentVersionId, code: details.code, retriable: details.retriable });
          warnings.push(details.code);
          // Keep the cursor before the failed candidate. Any vectors already
          // written in this invocation are idempotent on the next run.
          const failedCheckpoint = checkpointWith(checkpoint, base, {
            attempted: (checkpoint?.attempted ?? 0) + 1,
            failed: (checkpoint?.failed ?? 0) + 1
          }, this.now());
          checkpoint = await this.checkpointRepository.saveEmbeddingBackfillCheckpoint(failedCheckpoint, checkpointCondition(checkpoint, digest));
          runAttempted += 1;
          return this.result(scope, digest, checkpoint, pagesFetched, failures, warnings, started);
        }
        const next = checkpointWith(checkpoint, base, {
          lastAgentVersionId: candidate.agentVersionId,
          attempted: (checkpoint?.attempted ?? 0) + 1,
          generated: (checkpoint?.generated ?? 0) + (vector.generated ? 1 : 0),
          skipped: (checkpoint?.skipped ?? 0) + (vector.generated ? 0 : 1)
        }, this.now());
        checkpoint = await this.checkpointRepository.saveEmbeddingBackfillCheckpoint(next, checkpointCondition(checkpoint, digest));
        cursor = candidate.agentVersionId;
        runAttempted += 1;
      }
    }
    return this.result(scope, digest, checkpoint, pagesFetched, failures, warnings, started);
  }

  private result(
    scope: string,
    digest: string,
    checkpoint: EmbeddingBackfillCheckpoint | null,
    pagesFetched: number,
    failures: readonly EmbeddingBackfillFailure[],
    warnings: readonly string[],
    _started: Date
  ): EmbeddingBackfillResult {
    return {
      status: checkpoint?.completedAt === null || checkpoint === null ? "partial" : "completed",
      scope,
      configurationDigest: digest,
      checkpoint,
      nextAgentVersionId: checkpoint?.lastAgentVersionId ?? null,
      attempted: checkpoint?.attempted ?? 0,
      generated: checkpoint?.generated ?? 0,
      skipped: checkpoint?.skipped ?? 0,
      failed: checkpoint?.failed ?? failures.length,
      pagesFetched,
      failures,
      warnings: [...new Set(warnings)]
    };
  }
}

export function createEmbeddingBackfillJob(options: EmbeddingBackfillJobOptions): EmbeddingBackfillJob {
  return new EmbeddingBackfillJob(options);
}

export async function runEmbeddingBackfill(
  options: EmbeddingBackfillJobOptions,
  run: EmbeddingBackfillRunOptions
): Promise<EmbeddingBackfillResult> {
  return createEmbeddingBackfillJob(options).run(run);
}

function checkpointScope(value: string): string {
  return boundedScope(value);
}

function validateCheckpoint(input: EmbeddingBackfillCheckpoint): EmbeddingBackfillCheckpoint {
  const scope = checkpointScope(input.scope);
  const configurationDigest = boundedDigest(input.configurationDigest, "configuration digest");
  if (!Number.isSafeInteger(input.dimension) || input.dimension < 1 || input.dimension > 16_384) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The checkpoint embedding dimension is invalid.", "repair_embedding_checkpoint");
  if (!Number.isSafeInteger(input.cursorVersion) || input.cursorVersion < 0 || input.cursorVersion > maxDbInteger) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The checkpoint cursor version is invalid.", "repair_embedding_checkpoint");
  if (input.lastAgentVersionId !== null) boundedUuid(input.lastAgentVersionId, "checkpoint cursor");
  for (const [field, value] of [["attempted", input.attempted], ["generated", input.generated], ["skipped", input.skipped], ["failed", input.failed]] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxDbInteger) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", `The checkpoint ${field} counter is invalid.`, "repair_embedding_checkpoint");
  }
  dateValue(input.updatedAt, "checkpoint updated");
  if (input.completedAt !== null) dateValue(input.completedAt, "checkpoint completed");
  return { ...input, scope, configurationDigest };
}

/** In-memory source/checkpoint implementation used by deterministic tests. */
export class InMemoryEmbeddingBackfillRepository implements EmbeddingBackfillRepository {
  private readonly candidates: readonly EmbeddingBackfillCandidate[];
  private readonly checkpoints = new Map<string, EmbeddingBackfillCheckpoint>();
  private readonly activeScopes = new Set<string>();

  public constructor(candidates: readonly EmbeddingBackfillCandidate[] = []) {
    const normalized = candidates.map(normalizeCandidate);
    this.candidates = [...normalized].sort((left, right) => left.agentVersionId.localeCompare(right.agentVersionId));
  }

  async listCandidates(input: { readonly afterAgentVersionId: string | null; readonly limit: number }): Promise<readonly EmbeddingBackfillCandidate[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxPageSize) throw ingestionError("EMBEDDING_BACKFILL_CONFIG_INVALID", "The embedding source page size is invalid.", "fix_embedding_backfill_configuration");
    const after = input.afterAgentVersionId === null ? null : boundedUuid(input.afterAgentVersionId, "source cursor");
    return this.candidates.filter((candidate) => after === null || candidate.agentVersionId > after).slice(0, input.limit);
  }

  async getEmbeddingBackfillCheckpoint(scope: string): Promise<EmbeddingBackfillCheckpoint | null> {
    return this.checkpoints.get(checkpointScope(scope)) ?? null;
  }

  async saveEmbeddingBackfillCheckpoint(input: EmbeddingBackfillCheckpoint, condition: EmbeddingBackfillCheckpointWriteCondition): Promise<EmbeddingBackfillCheckpoint> {
    const normalized = validateCheckpoint(input);
    const expectedDigest = boundedDigest(condition.expectedConfigurationDigest, "expected configuration digest");
    const existing = this.checkpoints.get(normalized.scope);
    if (existing === undefined) {
      if (condition.expectedCursorVersion !== null || expectedDigest !== normalized.configurationDigest || normalized.cursorVersion !== 1) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The backfill checkpoint create condition does not match an empty cursor.", "reload_embedding_backfill_checkpoint");
    } else {
      if (condition.expectedCursorVersion !== existing.cursorVersion || expectedDigest !== existing.configurationDigest || normalized.cursorVersion !== existing.cursorVersion + 1) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The backfill checkpoint changed before this update completed.", "reload_embedding_backfill_checkpoint");
      if (existing.completedAt !== null) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "A completed embedding backfill checkpoint cannot advance.", "start_new_embedding_backfill_scope");
      if (normalized.configurationDigest !== existing.configurationDigest || normalized.scope !== existing.scope) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The embedding backfill checkpoint configuration is immutable.", "start_new_embedding_backfill_scope");
      if (normalized.attempted < existing.attempted || normalized.generated < existing.generated || normalized.skipped < existing.skipped || normalized.failed < existing.failed) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The embedding backfill counters cannot move backwards.", "repair_embedding_checkpoint");
      if (normalized.lastAgentVersionId !== null && existing.lastAgentVersionId !== null && normalized.lastAgentVersionId < existing.lastAgentVersionId) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The embedding backfill cursor cannot move backwards.", "repair_embedding_checkpoint");
    }
    this.checkpoints.set(normalized.scope, normalized);
    return normalized;
  }

  async withEmbeddingBackfillRunLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const normalized = checkpointScope(scope);
    if (this.activeScopes.has(normalized)) throw ingestionError("EMBEDDING_BACKFILL_ALREADY_RUNNING", "An embedding backfill is already active for this scope.", "wait_for_embedding_backfill", undefined, true);
    this.activeScopes.add(normalized);
    try { return await work(); } finally { this.activeScopes.delete(normalized); }
  }
}

type PgQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

/**
 * PostgreSQL source/checkpoint adapter. The vector write itself is delegated
 * to `PgVectorSemanticRepository`, allowing the backfill cursor and vector
 * row to be tested/transactioned independently. Apply the exported DDL in a
 * reviewed database migration before enabling this worker.
 */
export const embeddingBackfillCheckpointTableSql = `
CREATE TABLE IF NOT EXISTS agent_embedding_backfill_checkpoints (
  scope varchar(160) PRIMARY KEY,
  configuration_digest varchar(64) NOT NULL,
  provider varchar(128) NOT NULL,
  model varchar(128) NOT NULL,
  model_version varchar(128) NOT NULL,
  dimension integer NOT NULL,
  semantic_document_schema_version varchar(64) NOT NULL,
  last_agent_version_id uuid,
  attempted integer NOT NULL DEFAULT 0,
  generated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  cursor_version integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (configuration_digest ~ '^[0-9A-Fa-f]{64}$'),
  CHECK (dimension > 0 AND dimension <= 16384),
  CHECK (attempted >= 0 AND attempted <= 2147483647
     AND generated >= 0 AND generated <= 2147483647
     AND skipped >= 0 AND skipped <= 2147483647
     AND failed >= 0 AND failed <= 2147483647
     AND cursor_version >= 0 AND cursor_version <= 2147483647)
)`;

type PgCandidateRow = {
  agent_version_id: string;
  namespace: string;
  chain_id: number;
  identity_registry: string;
  agent_id: string;
  category: string;
  public_metadata: unknown;
  capability_manifest: unknown;
  services: unknown;
  risk_summary: unknown;
  authority_summary: unknown;
  evidence_summary: unknown;
  classifier_version: string | null;
};

type PgCheckpointRow = {
  scope: string;
  configuration_digest: string;
  provider: string;
  model: string;
  model_version: string;
  dimension: number | string;
  semantic_document_schema_version: string;
  last_agent_version_id: string | null;
  attempted: number;
  generated: number;
  skipped: number;
  failed: number;
  cursor_version: number;
  completed_at: Date | null;
  updated_at: Date;
};

function jsonValue(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", `The persisted ${field} JSON is invalid.`, "repair_embedding_source"); }
}

function objectValue(value: unknown, field: string): Readonly<Record<string, unknown>> {
  const parsed = jsonValue(value, field);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", `The persisted ${field} is not a public object.`, "repair_embedding_source");
  return parsed as Readonly<Record<string, unknown>>;
}

function arrayValue(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : undefined;
}

function candidateFromRow(row: PgCandidateRow): EmbeddingBackfillCandidate {
  const metadata = objectValue(row.public_metadata, "public metadata");
  let identity: Erc8004Identity;
  try {
    identity = normalizeErc8004Identity({ namespace: row.namespace, chainId: row.chain_id, identityRegistry: row.identity_registry, agentId: row.agent_id });
  } catch (cause) {
    throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The persisted embedding identity is invalid.", "repair_embedding_source", cause);
  }
  const capabilityManifest = row.capability_manifest ?? metadata.capabilityManifest;
  const protocols = arrayValue(metadata.protocols ?? metadata.supportedProtocols);
  const actions = arrayValue(metadata.actions);
  const services = arrayValue(row.services) ?? arrayValue(metadata.services);
  const riskSummary = row.risk_summary === null || row.risk_summary === undefined
    ? recordValue(metadata.riskSummary)
    : objectValue(row.risk_summary, "risk summary");
  const authoritySummary = row.authority_summary === null || row.authority_summary === undefined
    ? recordValue(metadata.authoritySummary)
    : objectValue(row.authority_summary, "authority summary");
  const evidenceSummary = row.evidence_summary === null || row.evidence_summary === undefined
    ? recordValue(metadata.evidenceSummary)
    : objectValue(row.evidence_summary, "evidence summary");
  return normalizeCandidate({
    agentVersionId: row.agent_version_id,
    identity,
    category: normalizeCategory(row.category),
    publicMetadata: metadata,
    ...(capabilityManifest === undefined ? {} : { capabilityManifest: jsonValue(capabilityManifest, "capability manifest") }),
    ...(protocols === undefined ? {} : { protocols }),
    ...(actions === undefined ? {} : { actions }),
    ...(services === undefined ? {} : { services }),
    ...(riskSummary === undefined ? {} : { riskSummary }),
    ...(authoritySummary === undefined ? {} : { authoritySummary }),
    ...(evidenceSummary === undefined ? {} : { evidenceSummary }),
    classifierVersion: row.classifier_version
  });
}

function dimensionValue(value: number | string): number {
  const result = typeof value === "number" ? value : /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 1 || result > 16_384) throw ingestionError("EMBEDDING_BACKFILL_SOURCE_INVALID", "The persisted embedding dimension is invalid.", "repair_embedding_checkpoint");
  return result;
}

function checkpointFromRow(row: PgCheckpointRow): EmbeddingBackfillCheckpoint {
  return validateCheckpoint({
    scope: row.scope,
    configurationDigest: row.configuration_digest,
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
    dimension: dimensionValue(row.dimension),
    semanticDocumentSchemaVersion: row.semantic_document_schema_version,
    lastAgentVersionId: row.last_agent_version_id,
    attempted: row.attempted,
    generated: row.generated,
    skipped: row.skipped,
    failed: row.failed,
    cursorVersion: row.cursor_version,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  });
}

function pgCheckpointColumns(): string {
  return "scope, configuration_digest, provider, model, model_version, dimension, semantic_document_schema_version, last_agent_version_id, attempted, generated, skipped, failed, cursor_version, completed_at, updated_at";
}

export class PgEmbeddingBackfillRepository implements EmbeddingBackfillRepository {
  public constructor(private readonly queryable: PgQueryable) {}

  async listCandidates(input: { readonly afterAgentVersionId: string | null; readonly limit: number }): Promise<readonly EmbeddingBackfillCandidate[]> {
    const limit = boundedInteger(input.limit, input.limit, 1, maxPageSize, "page size");
    const cursor = input.afterAgentVersionId === null ? null : boundedUuid(input.afterAgentVersionId, "source cursor");
    const result = await this.queryable.query<PgCandidateRow>(
      `SELECT av.id AS agent_version_id, i.namespace, i.chain_id, i.identity_registry, i.agent_id,
              COALESCE(cp.predicted_category, a.category) AS category,
              av.public_metadata, av.capability_manifest,
              COALESCE(svc.services, '[]'::jsonb) AS services,
              jsonb_build_object(
                'verificationStatus', a.verification_status,
                'runtimeStatus', a.runtime_status,
                'listingStatus', a.listing_status
              ) AS risk_summary,
              jsonb_build_object('authorityStatus', a.authority_status) AS authority_summary,
              jsonb_build_object('verificationStatus', a.verification_status, 'source', 'verified-database') AS evidence_summary,
              cp.classifier_version
         FROM agent_versions AS av
         JOIN agents AS a ON a.id = av.agent_id
         JOIN erc8004_identities AS i ON i.id = a.identity_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
                    'kind', s.kind,
                    'url', s.url,
                    'protocolVersion', s.protocol_version
                  ) ORDER BY s.id) AS services
             FROM agent_services AS s
            WHERE s.agent_version_id = av.id
         ) AS svc ON true
         LEFT JOIN LATERAL (
           SELECT predicted_category, classifier_version
             FROM agent_category_predictions
            WHERE agent_version_id = av.id
            ORDER BY "createdAt" DESC, id DESC
            LIMIT 1
         ) AS cp ON true
        WHERE a.verification_status = 'verified'
          AND ($1::uuid IS NULL OR av.id > $1::uuid)
        ORDER BY av.id
        LIMIT $2`,
      [cursor, limit]
    );
    return result.rows.map(candidateFromRow);
  }

  async getEmbeddingBackfillCheckpoint(scope: string): Promise<EmbeddingBackfillCheckpoint | null> {
    const normalized = checkpointScope(scope);
    const result = await this.queryable.query<PgCheckpointRow>(
      `SELECT ${pgCheckpointColumns()} FROM agent_embedding_backfill_checkpoints WHERE scope=$1`,
      [normalized]
    );
    return result.rows[0] === undefined ? null : checkpointFromRow(result.rows[0]);
  }

  async saveEmbeddingBackfillCheckpoint(input: EmbeddingBackfillCheckpoint, condition: EmbeddingBackfillCheckpointWriteCondition): Promise<EmbeddingBackfillCheckpoint> {
    const normalized = validateCheckpoint(input);
    const expectedDigest = boundedDigest(condition.expectedConfigurationDigest, "expected configuration digest");
    if (condition.expectedCursorVersion !== null && (!Number.isSafeInteger(condition.expectedCursorVersion) || condition.expectedCursorVersion < 0)) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The expected checkpoint cursor is invalid.", "reload_embedding_backfill_checkpoint");
    if (normalized.configurationDigest !== expectedDigest) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The embedding backfill checkpoint configuration changed before this update completed.", "start_new_embedding_backfill_scope");
    if (condition.expectedCursorVersion === null && normalized.cursorVersion !== 1) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The initial embedding backfill checkpoint cursor is invalid.", "reload_embedding_backfill_checkpoint");
    const result = await this.queryable.query<PgCheckpointRow>(
      `INSERT INTO agent_embedding_backfill_checkpoints AS existing_checkpoint
       (${pgCheckpointColumns()})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (scope) DO UPDATE SET
         configuration_digest=EXCLUDED.configuration_digest,
         provider=EXCLUDED.provider,
         model=EXCLUDED.model,
         model_version=EXCLUDED.model_version,
         dimension=EXCLUDED.dimension,
         semantic_document_schema_version=EXCLUDED.semantic_document_schema_version,
         last_agent_version_id=EXCLUDED.last_agent_version_id,
         attempted=EXCLUDED.attempted,
         generated=EXCLUDED.generated,
         skipped=EXCLUDED.skipped,
         failed=EXCLUDED.failed,
         cursor_version=EXCLUDED.cursor_version,
         completed_at=EXCLUDED.completed_at,
         updated_at=EXCLUDED.updated_at
       WHERE existing_checkpoint.configuration_digest=$2
         AND existing_checkpoint.cursor_version=$16
         AND existing_checkpoint.completed_at IS NULL
         AND EXCLUDED.cursor_version=existing_checkpoint.cursor_version + 1
         AND EXCLUDED.attempted >= existing_checkpoint.attempted
         AND EXCLUDED.generated >= existing_checkpoint.generated
         AND EXCLUDED.skipped >= existing_checkpoint.skipped
         AND EXCLUDED.failed >= existing_checkpoint.failed
         AND (existing_checkpoint.last_agent_version_id IS NULL
              OR (EXCLUDED.last_agent_version_id IS NOT NULL
                  AND EXCLUDED.last_agent_version_id >= existing_checkpoint.last_agent_version_id))
       RETURNING ${pgCheckpointColumns()}`,
      [normalized.scope, normalized.configurationDigest, normalized.provider, normalized.model, normalized.modelVersion, normalized.dimension, normalized.semanticDocumentSchemaVersion, normalized.lastAgentVersionId, normalized.attempted, normalized.generated, normalized.skipped, normalized.failed, normalized.cursorVersion, normalized.completedAt, normalized.updatedAt, condition.expectedCursorVersion]
    );
    const row = result.rows[0];
    if (row === undefined) {
      const existing = await this.getEmbeddingBackfillCheckpoint(normalized.scope);
      if (existing !== null && (existing.configurationDigest !== expectedDigest || existing.cursorVersion !== condition.expectedCursorVersion)) throw ingestionError("EMBEDDING_BACKFILL_CHECKPOINT_CONFLICT", "The embedding backfill checkpoint changed before this update completed.", "reload_embedding_backfill_checkpoint");
      throw ingestionError("REPOSITORY_FAILURE", "The embedding backfill checkpoint was not persisted.", "retry_embedding_backfill", undefined, true);
    }
    return checkpointFromRow(row);
  }

  async withEmbeddingBackfillRunLock<T>(scope: string, work: () => Promise<T>): Promise<T> {
    const normalized = checkpointScope(scope);
    // The adapter is intended to receive a transaction-scoped client. A
    // caller using a pool should wrap the whole job in its own transaction so
    // this advisory lock remains held while source/checkpoint work runs.
    await this.queryable.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [normalized]);
    return work();
  }
}

/** Convert a source candidate into the canonical text/hash persisted with a vector. */
export function buildBackfillSemanticDocument(candidate: EmbeddingBackfillCandidate): CanonicalSemanticDocument {
  return buildSemanticDocument(semanticInput(normalizeCandidate(candidate)));
}

/** Stable identity used in metrics/evidence without exposing source payloads. */
export function embeddingBackfillIdentityKey(candidate: EmbeddingBackfillCandidate): string {
  const normalized = normalizeCandidate(candidate);
  return erc8004IdentityKey(normalized.identity);
}
