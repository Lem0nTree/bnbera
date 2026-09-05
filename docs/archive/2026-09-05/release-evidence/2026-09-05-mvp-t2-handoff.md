# T2 persistent ERC-8004 marketplace ingestion handoff — 2026-09-05

Status: implementation complete on the task branch; integration review remains
with the coordinator.

## Assignment and documentation gate

- Checkout: `/home/ubuntu/bnbera-mvp-t2`
- Branch: `codex/mvp-persistent-ingestion`
- Base SHA: `e6acbc8a91b67b77764e8979766fd59075e0e6b8`
- Head SHA: recorded after the task commit below
- Delivery: W1 completion / Marketplace Data + Web, Core Marketplace gate, R1
- Documentation read before edits: `AGENTS.md`,
  `docs/01-marketplace-donor-merge-plan.md`,
  `docs/04-bnbera-master-implementation-plan.md`,
  `docs/05-subagent-delivery-plan.md`, `docs/06-erc8004-pipeline-integration-plan.md`,
  `docs/07-mvp-live-marketplace-task-plan.md`, `config/standards.lock.json`,
  `docs/adr/0003-wave1-legacy-migration-repair.md`,
  `docs/operations/mvp-core-marketplace-runbook.md`,
  `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`,
  `docs/release-evidence/2026-09-05-mvp-coordination.md`, and all consumed
  domain, database, ingestion, registry, metadata, probe, category, and
  marketplace source/type files.

## Delivered

Changed paths: `package.json`, `packages/agent-ingestion/src/category-repository.ts`,
`packages/agent-ingestion/src/index.ts`, `packages/agent-ingestion/src/pipeline.ts`,
`packages/agent-ingestion/src/adapters/8004scan.ts`,
`packages/agent-ingestion/src/__tests__/8004scan.test.ts`,
`packages/agent-ingestion/src/composition.ts`,
`packages/agent-ingestion/src/__tests__/composition.test.ts`,
`scripts/erc8004-marketplace-ingestion.ts`, and this handoff.

- Added `Erc8004MarketplaceCompositionRunner`, exported by
  `@bnbera/agent-ingestion`, with a bounded batch (maximum 20), identity-tuple
  deduplication, cancellation checks, per-candidate failure isolation, and
  sanitized stage/reason counts.
- Kept `Erc8004ScanJob` as the discovery/checkpoint path and added restart
  composition from persisted manual, 8004scan, and registry-event sources.
- Added `scripts/erc8004-marketplace-ingestion.ts` and the
  `ops:erc8004-marketplace` command. It reads the standards lock for the
  registry and ABI hash, accepts explicit identity tuples independently of the
  vendor, uses bounded metadata resolution and safe service probes, and closes
  both PostgreSQL pools.
- Extended the existing pipeline to return/persist the explicitly observed
  public metadata, capability manifest, services, and probes. No manifest,
  endpoint, health result, or state is fabricated.
- Tightened the reviewed 8004scan mapper so incomplete service descriptors and
  capability entries without explicit input/output schemas are withheld
  rather than filled with generic values.
- Publication runs before category persistence and category writes receive a
  real immutable version ID through `PgCategoryPredictionSink`.
- Quoted the mixed-case `"createdAt"` category column to match the checked-in
  schema and migrations.
- Semantic embeddings remain disabled in this command. Registry reads are
  marked `provisional` because finality/reorg handling is unresolved in the
  standards lock.

## Verification

Successful focused evidence:

```text
pnpm --filter @bnbera/agent-ingestion typecheck       PASS
pnpm --filter @bnbera/agent-ingestion test            PASS (13 files, 79 tests)
pnpm --filter @bnbera/agent-ingestion build           PASS
pnpm --filter @bnbera/domain build                    PASS
pnpm --filter @bnbera/config build                    PASS
ERC8004_INGESTION_ENABLED=false pnpm exec tsx scripts/erc8004-marketplace-ingestion.ts
  {"status":"disabled","reason":"ERC8004_INGESTION_DISABLED"}
git diff --check                                      PASS
```

ESLint could not start in this constrained checkout because the partial
dependency layout lacks `@typescript-eslint/parser`; this is an environment
limitation, not a source diagnostic. Docker access was unavailable to this
agent. A disposable local PostgreSQL migration was attempted and stopped at
the host's missing `vector` extension; the disposable database and role were
dropped afterward. No retained Docker database or development volume was
modified.

## Can this persist a qualifying record?

Yes, once configured with a candidate whose exact identity tuple is in the
locked network, a direct registry read supplies finalized block/hash evidence,
the URI resolves to valid public metadata, the document contains a valid
explicit capability manifest, at least one advertised service has a bounded
healthy probe, and `DATABASE_URL` points at the migrated PostgreSQL/pgvector
database. The runner persists identity/provenance, capabilities, services, and
probe observations before invoking publication, and then attaches categories
to the returned version ID.

The current lock leaves finality unresolved, so the command intentionally uses
`readConsistency: "provisional"`; with that current setting the publication
service withholds the version (`IDENTITY_READ_NOT_FINALIZED`) rather than
claiming a published listing. It can therefore persist the qualifying
observations now, but a published qualifying record requires the reviewed
finality configuration/reader path to be enabled. Scan discovery additionally
requires the rotated 8004scan credential; manual tuple import does not.

## Gates, limitations, and rollback

- `ERC8004_INGESTION_ENABLED=false` is the immediate fail-closed disable.
- `ERC8004SCAN_DISCOVERY_ENABLED=false` disables vendor discovery while
  allowing explicit manual/persisted candidates when ingestion is enabled.
- Semantic retrieval is forcibly disabled by this bounded command.
- No chain writes, payment writes, Creator/Altana actions, evidence uploads,
  or fixture fallback are performed.
- Persisted-candidate selection currently reads the identity list and then
  bounds processing to 20 candidates; a future scale-up can add a repository
  query limit without changing the composition contract.
- Revert the task commit on the integration branch to roll back the code;
  disabling the ingestion gate rolls back runtime behavior without touching
  stored observations.
