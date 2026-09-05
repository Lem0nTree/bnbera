import {
  erc8004IdentityKey,
  normalizeEvmAddress,
  type Erc8004Identity
} from "@bnbera/domain";
import { ingestionError } from "./errors.js";
import { AgentIngestionService, type RegistrySyncResult } from "./ingestion.js";
import type { RegistryChainReader, RegistryFinalityMode } from "./adapters/registry.js";
import type { IdentityCandidate, IngestionRepository } from "./types.js";

export type Erc8004DirectRegistrySyncGates = {
  readonly ERC8004_INGESTION_ENABLED: boolean;
  /** Local operational gate; it is deliberately separate from 8004scan. */
  readonly ERC8004_DIRECT_REGISTRY_SYNC_ENABLED: boolean;
};

export type DirectRegistrySyncForwarder = (
  candidates: readonly IdentityCandidate[],
  sync: RegistrySyncResult
) => Promise<unknown>;

export type DirectRegistrySyncJobOptions = {
  readonly repository: IngestionRepository;
  readonly reader?: RegistryChainReader;
  readonly ingestion?: AgentIngestionService;
  readonly gates: Erc8004DirectRegistrySyncGates;
  readonly chainId: number;
  readonly identityRegistry: string;
  readonly startBlock: number;
  /** Must come from the standards lock; this seam has no fallback value. A
   * finalized-tag policy uses zero only as the legacy checkpoint marker. */
  readonly confirmationThreshold: number;
  readonly finalityMode?: RegistryFinalityMode;
  readonly indexerVersion?: string;
  readonly normalizedIngestionVersion?: string;
  readonly maxBlockRange?: number;
  readonly maxEvents?: number;
  readonly maxCandidates?: number;
  readonly forwardCandidates?: DirectRegistrySyncForwarder;
  readonly now?: () => Date;
};

export type DirectRegistrySyncRunOptions = {
  readonly signal?: AbortSignal;
};

export type DirectRegistrySyncJobResult = {
  readonly status: "disabled" | "completed" | "degraded";
  readonly reason: string | null;
  readonly sync: RegistrySyncResult | null;
  readonly forwardedCount: number;
  readonly forwardedIdentityKeys: readonly string[];
  readonly composition: "not_configured" | "completed" | "failed";
};

const MAX_CANDIDATES = 20;

function bounded(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", `The ${field} bound is invalid.`, "fix_registry_sync_configuration");
  }
  return result;
}

function disabled(reason: string): DirectRegistrySyncJobResult {
  return {
    status: "disabled",
    reason,
    sync: null,
    forwardedCount: 0,
    forwardedIdentityKeys: [],
    composition: "not_configured"
  };
}

function directCandidate(identity: Erc8004Identity, observedAt: Date): IdentityCandidate {
  const key = erc8004IdentityKey(identity);
  return {
    identity,
    source: "registry_event",
    // This reference is stable across retries; event provenance remains in
    // the append-only observation row and is not replaced by this projection.
    sourceReference: `registry-sync:${key}`,
    observedAt,
    normalizedIngestionVersion: "registry-event-v1"
  };
}

function normalizedRegistry(value: string): string {
  try {
    return normalizeEvmAddress(value);
  } catch (cause) {
    throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The direct-sync registry address is invalid.", "repair_registry_lock", cause);
  }
}

/**
 * Bounded orchestration seam for direct ERC-8004 registry events. Durable
 * cursor, canonical block hashes, confirmation promotion, and reorg replay
 * stay in AgentIngestionService; this job only applies gates and forwards the
 * resulting full ERC-8004 tuple into the T2 composition callback.
 */
export class Erc8004DirectRegistrySyncJob {
  private readonly maxBlockRange: number;
  private readonly maxEvents: number;
  private readonly maxCandidates: number;
  private readonly registry: string;
  private readonly ingestion: AgentIngestionService;

  public constructor(private readonly options: DirectRegistrySyncJobOptions) {
    this.registry = normalizedRegistry(options.identityRegistry);
    this.maxBlockRange = bounded(options.maxBlockRange, 100_000, 100_000, "registry block range");
    this.maxEvents = bounded(options.maxEvents, 10_000, 100_000, "registry event");
    this.maxCandidates = bounded(options.maxCandidates, MAX_CANDIDATES, MAX_CANDIDATES, "composition candidate");
    this.ingestion = options.ingestion ?? new AgentIngestionService(
      options.repository,
      options.now === undefined ? {} : { now: options.now }
    );
  }

  public async run(runOptions: DirectRegistrySyncRunOptions = {}): Promise<DirectRegistrySyncJobResult> {
    if (this.options.gates.ERC8004_INGESTION_ENABLED !== true) {
      return disabled("ERC8004_INGESTION_DISABLED");
    }
    if (this.options.gates.ERC8004_DIRECT_REGISTRY_SYNC_ENABLED !== true) {
      return disabled("ERC8004_DIRECT_REGISTRY_SYNC_DISABLED");
    }
    if (runOptions.signal?.aborted === true) return disabled("RUN_CANCELLED");
    if (this.options.reader === undefined) {
      throw ingestionError("REGISTRY_READER_NOT_CONFIGURED", "The direct registry reader is not configured.", "configure_registry_reader");
    }
    if (!Number.isSafeInteger(this.options.chainId) || this.options.chainId <= 0) {
      throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The direct-sync chain ID is invalid.", "repair_registry_lock");
    }
    if (!Number.isSafeInteger(this.options.startBlock) || this.options.startBlock < 0) {
      throw ingestionError("REGISTRY_SYNC_CONFIG_INVALID", "The direct-sync start block is invalid.", "fix_registry_sync_configuration");
    }
    const finalityMode = this.options.finalityMode ?? "confirmations";
    if (finalityMode !== "rpc-finalized-tag" && finalityMode !== "confirmations") {
      throw ingestionError("REGISTRY_FINALITY_UNRESOLVED", "The direct-sync finality policy is unresolved.", "resolve_registry_finality_lock");
    }
    if (!Number.isSafeInteger(this.options.confirmationThreshold) || this.options.confirmationThreshold < 0 ||
      (finalityMode === "rpc-finalized-tag" && this.options.confirmationThreshold !== 0)) {
      throw ingestionError("REGISTRY_FINALITY_UNRESOLVED", "The direct-sync confirmation threshold is unresolved.", "resolve_registry_finality_lock");
    }
    if (finalityMode === "rpc-finalized-tag" && this.options.reader.getFinalizedBlockTag === undefined) {
      throw ingestionError("REGISTRY_FINALITY_UNRESOLVED", "The configured reader cannot prove the BSC finalized RPC tag.", "configure_finalized_rpc_reader");
    }

    const sync = await this.ingestion.syncRegistry(this.options.reader, {
      chainId: this.options.chainId,
      identityRegistry: this.registry,
      startBlock: this.options.startBlock,
      confirmationThreshold: this.options.confirmationThreshold,
      finalityMode,
      indexerVersion: this.options.indexerVersion ?? (finalityMode === "rpc-finalized-tag" ? "registry-indexer-v2-finalized-tag" : "registry-indexer-v1"),
      ...(this.options.normalizedIngestionVersion === undefined ? {} : { normalizedIngestionVersion: this.options.normalizedIngestionVersion }),
      maxBlockRange: this.maxBlockRange,
      maxEvents: this.maxEvents,
      ...(this.options.now === undefined ? {} : { now: this.options.now })
    });

    const identities = await this.options.repository.listIdentities({
      chainId: this.options.chainId,
      identityRegistry: this.registry
    });
    const affected = new Set(sync.affectedIdentityKeys);
    const observedAt = this.options.now?.() ?? new Date();
    const candidates = identities
      .filter((record) => affected.has(erc8004IdentityKey(record.identity)))
      .sort((left, right) => erc8004IdentityKey(left.identity).localeCompare(erc8004IdentityKey(right.identity)))
      .slice(0, this.maxCandidates)
      .map((record) => directCandidate(record.identity, observedAt));

    const cancelledAfterSync = runOptions.signal !== undefined && runOptions.signal.aborted;
    if (cancelledAfterSync) return {
      status: "degraded",
      reason: "RUN_CANCELLED",
      sync,
      forwardedCount: 0,
      forwardedIdentityKeys: [],
      composition: "not_configured"
    };

    if (this.options.forwardCandidates === undefined || candidates.length === 0) {
      return {
        status: "completed",
        reason: candidates.length === 0 ? "NO_AFFECTED_IDENTITIES" : "COMPOSITION_FORWARDER_NOT_CONFIGURED",
        sync,
        forwardedCount: 0,
        forwardedIdentityKeys: [],
        composition: "not_configured"
      };
    }

    try {
      await this.options.forwardCandidates(candidates, sync);
      return {
        status: "completed",
        reason: null,
        sync,
        forwardedCount: candidates.length,
        forwardedIdentityKeys: candidates.map((candidate) => erc8004IdentityKey(candidate.identity)),
        composition: "completed"
      };
    } catch {
      // The durable direct-sync transaction has already committed. A T2
      // composition failure is therefore degraded and retryable, not a
      // reason to roll back canonical chain observations.
      return {
        status: "degraded",
        reason: "COMPOSITION_FORWARD_FAILED",
        sync,
        forwardedCount: 0,
        forwardedIdentityKeys: [],
        composition: "failed"
      };
    }
  }
}

export const DirectRegistrySyncJob = Erc8004DirectRegistrySyncJob;
export const Erc8004RegistrySyncJob = Erc8004DirectRegistrySyncJob;

export function createErc8004DirectRegistrySyncJob(options: DirectRegistrySyncJobOptions): Erc8004DirectRegistrySyncJob {
  return new Erc8004DirectRegistrySyncJob(options);
}

export function createDirectRegistrySyncJob(options: DirectRegistrySyncJobOptions): Erc8004DirectRegistrySyncJob {
  return createErc8004DirectRegistrySyncJob(options);
}
