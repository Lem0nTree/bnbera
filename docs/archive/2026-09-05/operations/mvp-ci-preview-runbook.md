# MVP CI database and local preview runbook

**Owner:** A-OPS-QA
**Task:** T6 — CI database coverage and reachable preview topology
**Scope:** disposable PostgreSQL/pgvector CI coverage and a local
production-mode marketplace checkpoint

This runbook verifies the existing read-only marketplace against PostgreSQL.
It does not deploy publicly, expose PostgreSQL, enable ingestion/semantic
retrieval, perform a wallet or chain write, or import a production credential.

## CI database topology

The workflow provisions one disposable service container for the job:

| Setting | Value |
| --- | --- |
| Image | `pgvector/pgvector@sha256:3f0a88823465866f5f48e3c91edd273fb883a8715367e80b0d314b68fa592989` |
| Database | `bnbera_ci` |
| Role | `bnbera_ci` |
| Host binding | `127.0.0.1:5432` on the GitHub runner |
| Authentication | PostgreSQL `trust`, service-job only |
| External access | none; the service is not published or used as a preview database |

The `trust` setting is limited to this disposable CI container. It avoids
putting even a test password in the repository. The workflow injects the
test-only URL `postgresql://bnbera_ci@127.0.0.1:5432/bnbera_ci` into the job
environment. This URL must never be replaced with a retained-preview or
production URL in CI.

The database lifecycle is:

```text
fresh service → migrate → ADR-0003 disposable migration smoke
             → ingestion replay/rollback smoke → integration/API tests
             → job teardown
```

`scripts/db-migration-legacy-smoke.ts` creates only a generated database whose
name starts with `bnbera_t6_adr0003_`, runs fresh and restart migrations,
models the three branch-local surfaces from ADR 0003, applies the repair, and
drops that generated database. It never drops, truncates, or migrates the
configured `bnbera_ci` database or the retained development container.

## Required CI environment

Only non-secret test configuration is used by this workflow:

```text
DATABASE_URL=postgresql://bnbera_ci@127.0.0.1:5432/bnbera_ci
DATABASE_SSL=false
BNBERA_REQUIRE_DATABASE_TESTS=true
BNBERA_DISPOSABLE_DB_TEST=true
MARKETPLACE_DATA_MODE=live
ERC8004_INGESTION_ENABLED=false
ERC8004SCAN_DISCOVERY_ENABLED=false
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false
```

No 8004scan, embedding, RPC, wallet, payment, Greenfield, Altana, AWS, or
hosting credential is required. The database integration test fails instead
of silently skipping when `BNBERA_REQUIRE_DATABASE_TESTS=true` and
`DATABASE_URL` is absent. Outside CI, the test remains opt-in and skips when
no database URL is injected.

## Reproduce the CI checks locally

Run these commands from the dedicated T6 checkout. Do not run them from the
shared `/home/ubuntu/bnbera-w0-w1` checkout or against its retained database:

```bash
cd /home/ubuntu/bnbera-mvp-t6
CI=true pnpm install --frozen-lockfile
pnpm --filter @bnbera/domain --filter @bnbera/config build
pnpm db:migrate
BNBERA_DISPOSABLE_DB_TEST=true pnpm exec tsx scripts/db-migration-legacy-smoke.ts
pnpm ops:ingestion-smoke
BNBERA_REQUIRE_DATABASE_TESTS=true pnpm exec vitest run --config tests/vitest.config.ts
pnpm db:check
pnpm evidence:release-check
```

For local reproduction, inject `DATABASE_URL` and `DATABASE_SSL` for an
explicit disposable PostgreSQL/pgvector target first. The ingestion smoke is
synthetic and must report successful rollback, replay idempotency, persistence
restart, and zero scoped rows after cleanup. It is not a marketplace supply
population command and is not network health evidence.

## Production-mode local web checkpoint

The T6 worktree is the isolated runtime checkout. Its build output is
`/home/ubuntu/bnbera-mvp-t6/apps/web/.next`; it is separate from the user's
`/home/ubuntu/bnbera-w0-w1/apps/web/.next`. Do not start a build in the shared
checkout concurrently and do not commit the generated output.

Use the same injected database values and semantic-off flags shown above:

```bash
cd /home/ubuntu/bnbera-mvp-t6
pnpm --filter @bnbera/web build
PORT=3000 pnpm --filter @bnbera/web start
```

The CI command above is the canonical clean-checkout path. If a local
worktree's generated pnpm install resolves its virtual store outside the
checkout, Next Turbopack rejects that symlink; use the equivalent local
production build `pnpm --filter @bnbera/web exec next build --webpack` before
the same `next start` command. Both paths write only this checkout's
`apps/web/.next`.

In a second shell, use the same environment and point only the readiness
probe at the local server:

```bash
BNBERA_MARKETPLACE_API_URL=http://127.0.0.1:3000/api/marketplace \
  pnpm exec tsx scripts/marketplace-readiness.ts
```

The expected result is JSON contract `bnbera.marketplace-readiness/v0.1`,
database connectivity and migration hashes passing, `mode` live/degraded or
empty, retrieval mode deterministic, and zero fixture records. An empty
database is an honest empty/degraded result; it is not permission to switch
to fixtures. Stop only this `next start` process after the check. Leave any
retained Docker container and volume unchanged.

## Preview networking decision

The local checkpoint keeps both processes on one host:

```text
Next production server ── 127.0.0.1:55433/CI service ── PostgreSQL + pgvector
          │
          └── /api/marketplace (server-side read model)
```

The retained development database in the shared environment is bound to
`127.0.0.1:55432`; that address is intentionally not a public preview path.
A Vercel deployment cannot connect to this host's loopback address. A public
M2 preview therefore requires one of the following reviewed topologies:

1. Vercel server functions use a managed/private PostgreSQL+pgvector endpoint
   reachable from the deployment, with least-privilege credentials injected
   server-side; or
2. Vercel uses the existing server-side `MARKETPLACE_API_URL` forwarding mode
   to an authenticated HTTPS read API whose own database connection is
   private and whose response is validated against the marketplace contract.

Raw PostgreSQL must not be exposed to the internet. The browser must never
receive `DATABASE_URL`, 8004scan/embedding credentials, or any secret
reference. No public hosting access, HTTPS API host, deployment URL, DNS
change, or release credential was available or exercised by T6; M2 remains
blocked until the release owner supplies and approves that topology.

## T3 publication integration boundary

T3 is the owner of the explicit immutable version/publication service. T6
does not import unmerged T3 code or create a parallel publication contract.
The current PostgreSQL API test directly seeds one sanitized `agent_versions`
row and its category-bearing public metadata solely to prove that the existing
read API can consume actual PostgreSQL state; it does not claim that ingestion
or publication is complete.

After T3 is accepted, A-OPS-QA adds the disposable PostgreSQL integration
coverage for version creation/reuse, changed-content versioning, category
prediction attachment, transactional `current_version_id` publication, and
concurrent/replayed writes. The test consumes T3's reviewed service interface
and remains under `tests/integration/`; no local substitute is valid.

## Rollback and disable

- Stop only the T6-owned web process and restore injected environment values.
- Disable `ERC8004SCAN_DISCOVERY_ENABLED` to stop vendor calls,
  `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` to use deterministic retrieval, and
  `ERC8004_INGESTION_ENABLED` to stop synchronization while retaining reads.
- Roll back the application to the previously verified artifact/SHA. Apply a
  reviewed forward database migration for schema changes; do not drop
  provenance, version, or vector tables.
- The CI service and generated ADR-0003 database are disposable. CI teardown
  removes them; no retained preview database or Docker volume is a cleanup
  target.

Evidence produced by this task is deterministic, disposable-DB, retained-live
read, or local-browser/runtime evidence as labelled. It is not production
deployment, live vendor, payment, custody, chain-write, or public availability
evidence.
