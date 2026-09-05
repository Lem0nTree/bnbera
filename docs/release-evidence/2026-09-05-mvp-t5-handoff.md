# T5 direct ERC-8004 registry sync handoff

Date: 2026-09-05
Vertical: Marketplace Data + Web (direct registry-event sync)
Branch: `codex/mvp-direct-event-sync`
Base SHA: `a51bf2caa89975083954ddb79e70b218f737aa8d`
Head SHA: reported with the final coordinator handoff (`git rev-parse HEAD` after this evidence commit)

## Documentation and contract gate

Before editing, this checkout read the required instructions and contracts:

- `/home/ubuntu/bnbera-w0-w1/AGENTS.md`
- `docs/04-bnbera-master-implementation-plan.md`
- `docs/05-subagent-delivery-plan.md`
- `docs/07-mvp-live-marketplace-task-plan.md`
- `config/standards.lock.json`
- `docs/01-marketplace-donor-merge-plan.md`
- `docs/06-erc8004-pipeline-integration-plan.md`
- `docs/adr/0001-altana-studio-custody-bootstrap.md`
- `docs/adr/0003-wave1-legacy-migration-repair.md`
- `docs/release-evidence/2026-09-05-mvp-t2-handoff.md`
- `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`
- `docs/operations/mvp-core-marketplace-runbook.md`
- `docs/release-evidence/2026-09-05-mvp-coordination.md`
- `packages/agent-ingestion/src/types.ts`
- `packages/agent-ingestion/src/normalize.ts`
- `packages/agent-ingestion/src/ingestion.ts`
- `packages/agent-ingestion/src/composition.ts`
- `packages/agent-ingestion/src/pipeline.ts`
- `packages/agent-ingestion/src/adapters/registry.ts`
- `packages/agent-ingestion/src/adapters/registry-rpc.ts`
- `packages/agent-ingestion/src/adapters/erc8004-codec.ts`
- `packages/agent-ingestion/src/identity-provenance.ts`
- `packages/agent-ingestion/src/memory-repository.ts`
- `packages/agent-ingestion/src/postgres-repository.ts`
- `packages/agent-ingestion/src/repository-mapping.ts`
- `packages/db/src/schema.ts`
- `packages/domain/src/identity.ts`
- `packages/domain/src/states.ts`
- `packages/config/src/runtime.ts`

Assigned gate/risk: Core Marketplace direct ingestion remains disabled until the standards lock resolves finality; R1 read-only ingestion. ERC-8004 registry addresses and ABI hashes are present and verified in the candidate lock, but `confirmationThreshold` is absent. The implementation therefore never derives finality from an environment default or guessed value. `8004scan` and manual paths remain independent, and semantic embeddings remain disabled in the direct command.

## Delivered

- Added official Identity Registry event topics/decoder for `Registered`, `Transfer`, `URIUpdated`, `MetadataSet`, and `MetadataUpdate`, sourced from the checked-in ABI and wired into the official reader factory.
- Added provider log-address validation and safe decoded payload handling.
- Added bounded block-range and decoded-event limits to `AgentIngestionService.syncRegistry`; events are deterministically ordered before persistence.
- Added a gated `Erc8004DirectRegistrySyncJob` seam that delegates durable checkpoint, trusted block-hash confirmation, reorg rewind/orphaning, and canonical replay to the existing ingestion transaction, then forwards affected complete identity tuples to an optional T2 composition callback.
- Added standards-lock-only registry/finality resolution and a read-only command at `scripts/erc8004-registry-sync.ts`. With the current lock, the command fails closed with `REGISTRY_FINALITY_UNRESOLVED` when its direct gate is enabled.
- Added focused decoder, lock-resolution, gate, bounded-range, persistence, and T2-forwarding tests. No schema or migration changed; no disposable PostgreSQL test was required.

## Changed paths

- `packages/agent-ingestion/src/adapters/erc8004-codec.ts`
- `packages/agent-ingestion/src/adapters/registry-rpc.ts`
- `packages/agent-ingestion/src/errors.ts`
- `packages/agent-ingestion/src/index.ts`
- `packages/agent-ingestion/src/ingestion.ts`
- `packages/agent-ingestion/src/registry-sync-config.ts`
- `packages/agent-ingestion/src/registry-sync-job.ts`
- `packages/agent-ingestion/src/__tests__/registry-sync-job.test.ts`
- `scripts/erc8004-registry-sync.ts`
- `docs/release-evidence/2026-09-05-mvp-t5-handoff.md`

## Verification

- `vitest run packages/agent-ingestion/src/__tests__/registry-sync-job.test.ts` — **PASS**, 1 file / 5 tests.
- `tsc --noEmit -p packages/agent-ingestion/tsconfig.json` — **PASS**.
- No live RPC, database, paid service, deployment, or chain write was performed. Evidence level is deterministic unit/typecheck only.

## Gates, limitations, and rollback

Required runtime gates are `ERC8004_INGESTION_ENABLED=true` and the separate operational `ERC8004_DIRECT_REGISTRY_SYNC_ENABLED=true`. Missing or malformed values disable the command. The command also requires an explicit lock-derived confirmation threshold and a lock-matching official ABI hash/address; the current candidate lock intentionally blocks execution because finality is unresolved. `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` is forced false by the direct command.

The seam does not claim live or continuous sync, provider pagination beyond one bounded block window, or production publication evidence. Ordinary event canonicalization uses event fields; authoritative finality rereads beyond the existing reorg-ancestor reconciliation remain a follow-up gate. T2 forwarding is callback-based and is reported degraded if composition fails after the direct transaction commits.

To disable/rollback, set either gate false (or omit it); this performs no provider or repository work. Code rollback is a normal revert of this commit. Existing checkpoint CAS, trusted hash checks, finalized-boundary reorg refusal, orphan marking, and transaction rollback remain the safety controls.
