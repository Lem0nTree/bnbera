import { AppError } from "@bnbera/config";
import { erc8004IdentityKey } from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import {
  type EightHundredFourScanAdapter,
  type EightHundredFourScanSemanticQuery
} from "./adapters/8004scan.js";
import type { IdentityCandidate } from "./types.js";

/**
 * Upstream semantic discovery terms. These are candidate-search labels only;
 * they do not assign a BNBEra marketplace category or relax publication and
 * health eligibility.
 */
export const erc8004SemanticDiscoveryCategories = [
  "trading",
  "liquidity",
  "yield",
  "health-factor"
] as const;

export type Erc8004SemanticDiscoveryCategory = (typeof erc8004SemanticDiscoveryCategories)[number];

export type SemanticDiscoveryCategoryResult = {
  readonly category: Erc8004SemanticDiscoveryCategory;
  readonly status: "completed" | "failed" | "cancelled";
  readonly candidateCount: number;
  /** Stable diagnostic code only; upstream text and payloads never escape. */
  readonly diagnostic: string | null;
};

export type Erc8004SemanticCandidateCollectionResult = {
  readonly status: "completed" | "degraded";
  readonly candidates: readonly IdentityCandidate[];
  readonly categories: readonly SemanticDiscoveryCategoryResult[];
  readonly diagnostics: readonly string[];
};

export type Erc8004SemanticCandidateCollectorOptions = {
  readonly adapter: EightHundredFourScanAdapter;
  readonly maxCandidatesPerCategory?: number;
  readonly maxCandidates?: number;
  readonly maxRunMs?: number;
  readonly now?: () => Date;
};

export type Erc8004SemanticCandidateCollectionOptions = {
  readonly chainId?: number;
  readonly isTestnet?: boolean;
  readonly signal?: AbortSignal;
};

const DEFAULT_MAX_CANDIDATES_PER_CATEGORY = 5;
const MAX_CANDIDATES_PER_CATEGORY = 20;
const DEFAULT_MAX_CANDIDATES = 20;
const MAX_CANDIDATES = 20;
const DEFAULT_MAX_RUN_MS = 120_000;
const MAX_RUN_MS = 600_000;

function bounded(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw ingestionError("SCAN_JOB_CONFIG_INVALID", `The semantic discovery ${field} bound is invalid.`, "fix_scan_configuration");
  }
  return resolved;
}

function diagnosticCode(error: unknown): string {
  if (error instanceof AppError && /^[A-Z][A-Z0-9_]{2,63}$/u.test(error.code)) return error.code;
  return "SEMANTIC_DISCOVERY_FAILED";
}

function timerSignal(parent: AbortSignal | undefined, maxRunMs: number): { readonly signal: AbortSignal; readonly dispose: () => void } {
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

function withCategoryProvenance(candidate: IdentityCandidate, category: Erc8004SemanticDiscoveryCategory): IdentityCandidate {
  return {
    ...candidate,
    // The identity key remains the full tuple. The suffix makes the semantic
    // route/category observable in the persisted discovery-source reference.
    sourceReference: `${candidate.sourceReference}|category=${category}`
  };
}

/**
 * Collect one bounded semantic page for each of the four marketplace search
 * terms. Calls are sequential to respect provider rate limits; a failed term
 * is isolated and does not prevent the remaining terms from contributing
 * candidates. The caller feeds the returned candidates into the existing T2
 * composition/publication runner.
 */
export class Erc8004SemanticCandidateCollector {
  private readonly maxCandidatesPerCategory: number;
  private readonly maxCandidates: number;
  private readonly maxRunMs: number;
  private readonly now: () => Date;

  public constructor(private readonly options: Erc8004SemanticCandidateCollectorOptions) {
    this.maxCandidatesPerCategory = bounded(options.maxCandidatesPerCategory, DEFAULT_MAX_CANDIDATES_PER_CATEGORY, MAX_CANDIDATES_PER_CATEGORY, "per-category candidate");
    this.maxCandidates = bounded(options.maxCandidates, DEFAULT_MAX_CANDIDATES, MAX_CANDIDATES, "candidate");
    this.maxRunMs = bounded(options.maxRunMs, DEFAULT_MAX_RUN_MS, MAX_RUN_MS, "run time");
    this.now = options.now ?? (() => new Date());
  }

  public async collect(options: Erc8004SemanticCandidateCollectionOptions = {}): Promise<Erc8004SemanticCandidateCollectionResult> {
    const timed = timerSignal(options.signal, this.maxRunMs);
    const candidates: IdentityCandidate[] = [];
    const seen = new Set<string>();
    const categories: SemanticDiscoveryCategoryResult[] = [];
    const diagnostics: string[] = [];
    try {
      for (const category of erc8004SemanticDiscoveryCategories) {
        if (timed.signal.aborted) {
          categories.push({ category, status: "cancelled", candidateCount: 0, diagnostic: "RUN_CANCELLED" });
          diagnostics.push("RUN_CANCELLED");
          continue;
        }
        const query: EightHundredFourScanSemanticQuery = {
          query: category,
          ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
          offset: 0,
          limit: this.maxCandidatesPerCategory,
          semanticWeight: 0.5,
          similarityThreshold: 0.5,
          signal: timed.signal
        };
        try {
          const page = await this.options.adapter.fetchSemanticPage(query);
          let accepted = 0;
          for (const candidate of page.candidates) {
            const key = erc8004IdentityKey(candidate.identity);
            if (seen.has(key)) continue;
            seen.add(key);
            if (candidates.length >= this.maxCandidates) continue;
            candidates.push(withCategoryProvenance(candidate, category));
            accepted += 1;
          }
          categories.push({ category, status: "completed", candidateCount: accepted, diagnostic: null });
        } catch (error) {
          const code = timed.signal.aborted ? "RUN_CANCELLED" : diagnosticCode(error);
          categories.push({ category, status: timed.signal.aborted ? "cancelled" : "failed", candidateCount: 0, diagnostic: code });
          diagnostics.push(code);
        }
      }
    } finally {
      timed.dispose();
    }
    const failed = categories.some((result) => result.status !== "completed");
    return {
      status: failed ? "degraded" : "completed",
      candidates,
      categories,
      diagnostics: [...new Set(diagnostics)]
    };
  }

  /** Exposed for diagnostics/tests without leaking provider credentials. */
  public limits(): { readonly maxCandidatesPerCategory: number; readonly maxCandidates: number; readonly maxRunMs: number; readonly observedAt: string } {
    return {
      maxCandidatesPerCategory: this.maxCandidatesPerCategory,
      maxCandidates: this.maxCandidates,
      maxRunMs: this.maxRunMs,
      observedAt: this.now().toISOString()
    };
  }
}

export function createErc8004SemanticCandidateCollector(
  options: Erc8004SemanticCandidateCollectorOptions
): Erc8004SemanticCandidateCollector {
  return new Erc8004SemanticCandidateCollector(options);
}
