import { describe, expect, it, vi } from "vitest";
import {
  Erc8004ScanJob,
  InMemoryIngestionRepository,
  type EightHundredFourScanAdapter,
  type IdentityCandidate
} from "../index.js";

const registry = "0x1111111111111111111111111111111111111111";

function candidate(agentId: string): IdentityCandidate {
  return {
    identity: { namespace: "eip155", chainId: 97, identityRegistry: registry, agentId },
    source: "8004scan",
    sourceReference: `agent:97:${registry}:${agentId}`,
    observedAt: new Date("2026-09-04T00:00:00.000Z"),
    normalizedIngestionVersion: "8004scan-openapi-test-v1",
    metadata: { name: `Agent ${agentId}` }
  };
}

type TestAdapter = EightHundredFourScanAdapter & { readonly fetchPage: ReturnType<typeof vi.fn> };

function adapterFor(
  fetchPage: (query: Record<string, unknown>) => Promise<unknown>
): TestAdapter {
  return { fetchPage: vi.fn(fetchPage) } as unknown as TestAdapter;
}

const enabled = {
  ERC8004_INGESTION_ENABLED: true,
  ERC8004SCAN_DISCOVERY_ENABLED: true
} as const;

describe("bounded resumable 8004scan discovery job", () => {
  it("no-ops before touching the adapter when either gate is disabled", async () => {
    const adapter = adapterFor(async () => {
      throw new Error("provider must not be called");
    });
    const repository = new InMemoryIngestionRepository();
    const disabled = new Erc8004ScanJob({ repository, adapter });
    const disabledResult = await disabled.run({ scope: "disabled", maxPages: 1 });
    expect(disabledResult.status).toBe("disabled");
    expect(adapter.fetchPage).not.toHaveBeenCalled();
  });

  it("commits one bounded page at a time and resumes after a restart", async () => {
    const pages = new Map<number, readonly IdentityCandidate[]>([
      [0, [candidate("1")]],
      [1, [candidate("2")]],
      [2, [candidate("3")]]
    ]);
    const adapter = adapterFor(async (query) => {
      const offset = Number(query.offset ?? 0);
      const items = pages.get(offset) ?? [];
      return {
        candidates: items,
        nextOffset: offset < 2 ? offset + 1 : null,
        nextCursor: offset < 2 ? String(offset + 1) : null,
        total: 3
      };
    });
    const repository = new InMemoryIngestionRepository();
    const firstJob = new Erc8004ScanJob({ repository, adapter, gates: enabled });

    const first = await firstJob.run({ scope: "resume-test", query: { chainId: 97, limit: 1 }, maxPages: 1 });
    expect(first.status).toBe("partial");
    expect(first.metrics).toMatchObject({ pagesFetched: 1, candidatesFetched: 1, pagesCommitted: 1, candidatesCommitted: 1 });
    expect(first.nextOffset).toBe(1);
    expect(first.nextCursor).toBeNull();
    expect((await repository.getScanDiscoveryCheckpoint("resume-test"))?.pagesProcessed).toBe(1);

    const second = await firstJob.run({ scope: "resume-test", query: { chainId: 97, limit: 1 }, maxPages: 1 });
    expect(second.status).toBe("partial");
    expect(second.nextOffset).toBe(2);

    const restartedJob = new Erc8004ScanJob({ repository, adapter, gates: enabled });
    const third = await restartedJob.run({ scope: "resume-test", query: { chainId: 97, limit: 1 }, maxPages: 5 });
    expect(third.status).toBe("completed");
    expect(third.nextOffset).toBeNull();
    expect(third.candidates).toHaveLength(1);

    const idempotent = await restartedJob.run({ scope: "resume-test", query: { chainId: 97, limit: 1 }, maxPages: 5 });
    expect(idempotent.status).toBe("completed");
    expect(idempotent.metrics.pagesFetched).toBe(0);
    expect(await repository.listIdentities()).toHaveLength(3);
    expect(adapter.fetchPage).toHaveBeenCalledTimes(3);
    expect(adapter.fetchPage.mock.calls.map(([query]) => query.offset)).toEqual([0, 1, 2]);
  });

  it("preserves full-scan availability and ordering across resumable pages", async () => {
    const adapter=adapterFor(async () => ({candidates:[candidate("1001")],nextOffset:1,nextCursor:null,total:2}));
    const repository=new InMemoryIngestionRepository();
    const job=new Erc8004ScanJob({repository,adapter,gates:enabled});
    const query={chainId:97,isTestnet:true,isActive:"any" as const,sortBy:"created_at" as const,sortOrder:"asc" as const,limit:1};
    await job.run({scope:"all-agents",query,maxPages:1});
    expect(adapter.fetchPage.mock.calls[0]?.[0]).toMatchObject(query);
    await expect(job.run({scope:"all-agents",query:{...query,isActive:"true"},maxPages:1})).rejects.toThrow();
    await expect(job.run({scope:"all-agents",query:{...query,sortOrder:"desc"},maxPages:1})).rejects.toThrow();
  });

  it("rolls back the page and leaves the prior checkpoint when persistence fails", async () => {
    class FailingCheckpointRepository extends InMemoryIngestionRepository {
      private failed = false;

      override async saveScanDiscoveryCheckpoint(...args: Parameters<InMemoryIngestionRepository["saveScanDiscoveryCheckpoint"]>): Promise<never> {
        if (!this.failed) {
          this.failed = true;
          throw new Error("checkpoint write failed");
        }
        return super.saveScanDiscoveryCheckpoint(...args) as Promise<never>;
      }
    }
    const repository = new FailingCheckpointRepository();
    const adapter = adapterFor(async () => ({ candidates: [candidate("4")], nextOffset: null, nextCursor: null, total: 1 }));
    const job = new Erc8004ScanJob({ repository, adapter, gates: enabled });

    await expect(job.run({ scope: "rollback-test", maxPages: 1 })).rejects.toThrow("checkpoint write failed");
    expect(await repository.listIdentities()).toHaveLength(0);
    expect(await repository.getScanDiscoveryCheckpoint("rollback-test")).toBeNull();
  });

  it("rejects a changed query scope instead of silently resuming another stream", async () => {
    const adapter = adapterFor(async () => ({ candidates: [candidate("5")], nextOffset: null, nextCursor: null, total: 1 }));
    const repository = new InMemoryIngestionRepository();
    const job = new Erc8004ScanJob({ repository, adapter, gates: enabled });
    await job.run({ scope: "query-conflict", query: { chainId: 97, search: "yield" }, maxPages: 1 });

    await expect(job.run({ scope: "query-conflict", query: { chainId: 97, search: "grid" }, maxPages: 1 })).rejects.toMatchObject({
      code: "SCAN_JOB_CHECKPOINT_CONFLICT"
    });
    expect(adapter.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("fails closed on concurrent runs for the same scope", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const adapter = adapterFor(async () => {
      await waiting;
      return { candidates: [candidate("6")], nextOffset: null, nextCursor: null, total: 1 };
    });
    const repository = new InMemoryIngestionRepository();
    const job = new Erc8004ScanJob({ repository, adapter, gates: enabled });
    const first = job.run({ scope: "concurrent-test", maxPages: 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(job.run({ scope: "concurrent-test", maxPages: 1 })).rejects.toMatchObject({ code: "SCAN_JOB_ALREADY_RUNNING" });
    release?.();
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("does not checkpoint upstream failures or accept a non-advancing page", async () => {
    const repository = new InMemoryIngestionRepository();
    const failingAdapter = adapterFor(async () => {
      throw Object.assign(new Error("rate limited"), { code: "SCAN_RATE_LIMITED" });
    });
    const failingJob = new Erc8004ScanJob({ repository, adapter: failingAdapter, gates: enabled });
    await expect(failingJob.run({ scope: "provider-failure", maxPages: 1 })).rejects.toMatchObject({ code: "SCAN_RATE_LIMITED" });
    expect(await repository.getScanDiscoveryCheckpoint("provider-failure")).toBeNull();

    const invalidAdapter = adapterFor(async () => ({ candidates: [candidate("7")], nextOffset: 0, nextCursor: "0", total: 2 }));
    const invalidJob = new Erc8004ScanJob({ repository, adapter: invalidAdapter, gates: enabled });
    await expect(invalidJob.run({ scope: "provider-invalid", maxPages: 1 })).rejects.toMatchObject({ code: "SCAN_JOB_PROVIDER_INVALID" });
    expect(await repository.getScanDiscoveryCheckpoint("provider-invalid")).toBeNull();
  });

  it("honors caller cancellation before committing a fetched page", async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const adapter = adapterFor(async () => {
      await waiting;
      return { candidates: [candidate("8")], nextOffset: null, nextCursor: null, total: 1 };
    });
    const repository = new InMemoryIngestionRepository();
    const job = new Erc8004ScanJob({ repository, adapter, gates: enabled });
    const controller = new AbortController();
    const run = job.run({ scope: "cancel-test", signal: controller.signal, maxPages: 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    release?.();
    await expect(run).rejects.toMatchObject({ code: "SCAN_JOB_CANCELLED" });
    expect(await repository.getScanDiscoveryCheckpoint("cancel-test")).toBeNull();
    expect(await repository.listIdentities()).toHaveLength(0);
  });
});
