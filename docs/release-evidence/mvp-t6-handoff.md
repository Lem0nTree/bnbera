# T6 CI and preview handoff

**Owner:** A-OPS-QA
**Task:** T6 — CI database coverage and reachable preview topology
**Base SHA:** `3695310a0c5687325a9d899189938a1f1a624d1d`
**Working branch:** `codex/mvp-ci-preview`
**Head SHA:** reported with the commit that adds this handoff

## Gate and risk

- Delivery vertical: QA, Deployment and Submission preparation.
- Feature gate: Core Marketplace only. Ingestion, 8004scan discovery and
  semantic retrieval remain independently disabled.
- Risk tier: R1 for disposable database/test changes; R2 for preview topology
  and deployment preparation. No deployment, credential, DNS, paid-resource,
  wallet, payment, custody or chain-write action was taken.

## Documentation gate

Before editing, this checkout was inspected at the assigned base and the
following files were read in full or at the focused contract scope required by
`AGENTS.md`:

```text
AGENTS.md
docs/01-marketplace-donor-merge-plan.md
docs/03-no-code-agent-deployer-plan.md
docs/04-bnbera-master-implementation-plan.md
docs/05-subagent-delivery-plan.md
docs/06-erc8004-pipeline-integration-plan.md
docs/07-mvp-live-marketplace-task-plan.md
config/standards.lock.json
docs/adr/0001-altana-studio-custody-bootstrap.md
docs/adr/0003-wave1-legacy-migration-repair.md
docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md
docs/operations/mvp-core-marketplace-runbook.md
docs/release-evidence/mvp-ops-qa-handoff.md
.github/workflows/ci.yml
package.json
apps/web/package.json
apps/web/next.config.mjs
apps/web/src/lib/marketplace-server.ts
packages/config/src/runtime.ts
packages/db/package.json
packages/db/src/client.ts
packages/db/src/migrate.ts
packages/db/src/schema.ts
tests/vitest.config.ts
tests/integration/marketplace-read-model-contracts.test.ts
tests/integration/w0-w1-marketplace-contracts.test.ts
tests/integration/web-marketplace-contracts.test.ts
tests/integration/web-marketplace-postgres.test.ts
tests/security/w0-w1-boundaries.test.ts
scripts/marketplace-readiness.ts
scripts/ingestion-postgres-smoke.ts
scripts/validate-release-evidence.ts
packages/db/src/__tests__/schema.test.ts
packages/db/src/__tests__/wave1-legacy-upgrade.test.ts
packages/db/src/__tests__/commerce-schema.test.ts
packages/db/migrations/0000_round_wallflower.sql
packages/db/migrations/0001_wave1_combined.sql
packages/db/migrations/0002_wave1_legacy_repair.sql
packages/db/migrations/0003_scan_discovery_checkpoint.sql
```

The unresolved lock entries affecting T6 are the embedding provider/model/
version/dimension, direct registry finality and reorg policy, 8004scan key
rotation, qualifying public service supply, and an approved public preview
topology. They remain disabled or explicitly blocked; no values were guessed.

## Implemented

- `.github/workflows/ci.yml` provisions a disposable PostgreSQL/pgvector
  service using the reviewed digest
  `pgvector/pgvector@sha256:3f0a88823465866f5f48e3c91edd273fb883a8715367e80b0d314b68fa592989`.
  The service is loopback-bound to the GitHub runner, uses job-local
  PostgreSQL `trust` authentication, and receives no live credential.
- CI injects a test-only `DATABASE_URL`, waits for `pg_isready`, builds the
  database package prerequisites, runs migrations, executes the ADR-0003
  disposable legacy/fresh-install smoke, and runs the PostgreSQL ingestion
  replay/rollback smoke.
- `BNBERA_REQUIRE_DATABASE_TESTS=true` makes the existing PostgreSQL web
  integration test fail when CI forgot to inject a database instead of
  silently skipping. The test now asserts persisted category/name/provenance
  from the actual read API while accepting truthful empty/degraded state when
  synchronization is disabled.
- `scripts/db-migration-legacy-smoke.ts` creates and drops only a generated
  `bnbera_t6_adr0003_*` database. It proves fresh install, repeat migration,
  the applicable ADR-0003 legacy shape/repair, and migration-journal
  completion without touching the configured CI or retained development DB.
- CI runs the cross-package integration/security suite, offline release
  evidence validation, and a production web build/start/readiness checkpoint.
- `docs/operations/mvp-ci-preview-runbook.md` records the exact environment,
  local topology, preview networking decision, T3 publication-test boundary,
  readiness contract, rollback and disable procedures.

## Verification

All local checks used the task-owned disposable container bound to
`127.0.0.1:55433`; the retained `bnbera_erc8004_pgvector` container at
`127.0.0.1:55432` was not modified.

```text
pnpm --filter @bnbera/domain --filter @bnbera/config build       PASS
pnpm db:migrate                                                  PASS
pnpm exec tsx scripts/db-migration-legacy-smoke.ts               PASS
pnpm ops:ingestion-smoke                                         PASS
pnpm test                                                         PASS (all package suites; 236 assertions, UI had no tests)
pnpm exec vitest run --config tests/vitest.config.ts             PASS (5 files, 48 tests; DB test executed)
pnpm lint                                                        PASS
pnpm typecheck                                                   PASS
pnpm db:check                                                    PASS
pnpm evidence:release-check                                     PASS (valid=true, issues=[])
git diff --check                                                 PASS
PyYAML workflow parse                                            PASS
```

The ingestion smoke reported migration replay, transaction rollback,
rollback-row absence, discovery replay idempotency, registry replay
idempotency, persistence restart, and zero scoped rows after cleanup. Its
`publicationOrVerificationSideEffect=false` result is intentional: this is a
synthetic DB smoke, not an ingestion/publication claim.

The local production web checkpoint built successfully with Next Webpack and
`next start` served `/api/marketplace` from the isolated T6
`apps/web/.next`. Readiness returned HTTP 200, deterministic retrieval, zero
fixtures, and an honest empty/degraded database state. The normal `next build`
script could not run in this checkout's generated shared pnpm install because
Turbopack rejects the external `/dev/shm` virtual-store symlink; a fresh CI
checkout installs inside its own workspace and uses the normal build script.
The Webpack build/start result verifies the application/runtime path without
writing the root user's `.next`.

An additional read-only attempt to point the isolated server at the retained
container was stopped after the API returned its truthful 503 unavailable
contract: that external process was not given the retained database's secret
reference. The retained container stayed healthy and unchanged. A retained
database-backed external process therefore remains an environment handoff
item, while the disposable trust-authenticated path is the completed local
CI-equivalent evidence.

## Limits and follow-up ownership

- CI service health and local checks are deterministic/disposable evidence,
  not public availability or live-vendor evidence. Remote GitHub Actions
  execution still needs to be observed after merge.
- T6 does not populate real ERC-8004 supply, enable ingestion, enable
  embeddings, or claim four live categories. The CI read model is empty until
  an approved ingestion/import path supplies records.
- T3 remains the owner of immutable version/publication semantics. The current
  PostgreSQL API test directly seeds one sanitized `agent_versions` row to
  test the existing read API. After T3 acceptance, A-OPS-QA must add actual
  PostgreSQL coverage for same-content reuse, changed-content versioning,
  category attachment, transactional `current_version_id`, and concurrent or
  replayed publication writes using T3's reviewed interface. No unmerged T3
  code was imported here.
- A public M2 preview remains blocked pending an approved managed/private DB or
  authenticated HTTPS server-side API, hosting access, deployment URL and
  release-owner approval. Raw PostgreSQL must never be exposed.

## Disable and rollback

Use the existing flags independently: disable
`ERC8004SCAN_DISCOVERY_ENABLED` for vendor discovery,
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` for semantic retrieval, and
`ERC8004_INGESTION_ENABLED` for synchronization. Stop only the task-owned
local web process. For a deployed artifact, roll back to the last verified
application SHA; use reviewed forward migrations for database changes. CI's
service and generated ADR-0003 database are disposable and are removed at job
teardown.
