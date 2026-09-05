# MVP core marketplace runtime runbook

**Owner:** A-OPS-QA
**Task:** T1 — reuse and verify Docker DB plus web startup
**Scope:** read-only live marketplace mode with semantic retrieval disabled

This runbook covers the retained local PostgreSQL/pgvector database and the
existing `apps/web` application. It does not import records, apply migrations,
enable an optional rail, or delete/recreate a database or volume. A healthy
database connection proves connectivity only; it does not prove that an agent
is eligible, healthy, published, or externally reachable.

## Preconditions

Use the repository checkout and toolchain pinned by the plan:

```bash
cd /home/ubuntu/bnbera-mvp-t1
node --version                 # Node 22.x
corepack pnpm --version        # pnpm 10.15.1
corepack pnpm install --frozen-lockfile
```

The command above must complete before starting the web process. If the
filesystem is full, stop and resolve capacity with the operator; do not point
the checkout at a partial dependency tree or remove another checkout's data.

Inject the following names through the approved local secret/configuration
channel. Values must not be printed, committed, or placed in browser-visible
configuration:

```text
DATABASE_URL
DATABASE_SSL
MARKETPLACE_DATA_MODE
MARKETPLACE_API_URL
BNBERA_MARKETPLACE_API_URL
ERC8004_INGESTION_ENABLED
ERC8004SCAN_DISCOVERY_ENABLED
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED
```

For this core run the required values are `DATABASE_SSL=false`,
`MARKETPLACE_DATA_MODE=live`, and all three `*_ENABLED` gate names are
`false`. `MARKETPLACE_API_URL` is the browser-facing API base (normally the
local `/api` path); `BNBERA_MARKETPLACE_API_URL` is the direct JSON endpoint
used by the readiness probe (normally `/api/marketplace`). The database URL
must identify the retained development database or an explicitly approved
disposable database. Never use this runbook's retained target for destructive
failure tests.

## Verify environment inheritance

The repository does not rely on Next.js or pnpm implicitly loading a root
`.env`. `scripts/run-with-repo-env.mjs` loads the root `.env` (or the path in
`BNBERA_ENV_FILE`) once and passes the resulting process environment to both
root commands and the web child process. It reports only whether a known name
is set:

```bash
node scripts/run-with-repo-env.mjs --check
```

The expected result is JSON with `DATABASE_URL`, `MARKETPLACE_DATA_MODE`, and
the gate names shown as `set`; no secret values should appear. An `envFile` of
`absent` is acceptable when the names were injected into the shell by the
approved secret channel. An invalid file returns `ENV_FILE_INVALID` and must
be corrected before continuing.

Verify the root script receives the same environment:

```bash
node scripts/run-with-repo-env.mjs -- corepack pnpm db:check
```

`Everything's fine` is a schema-diff check; it is not a database connection or
web readiness result. The wrapper's child inherits the exact environment that
will be used by the web process.

## Inspect the retained database without mutation

First confirm the named container and health state. The retained data volume
must remain attached:

```bash
sudo -n docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo -n docker exec bnbera_erc8004_pgvector psql -U bnbera_local -d bnbera_erc8004 -Atqc \
  "select extversion from pg_extension where extname = 'vector';"
```

Do not use `docker rm`, `docker compose down -v`, `dropdb`, `TRUNCATE`,
`DELETE`, or migration/ingestion commands against this retained target as a
health check. The narrow readiness probe checks connectivity, pgvector,
migration-journal alignment, and sanitized row counts:

```bash
node scripts/run-with-repo-env.mjs -- corepack pnpm exec tsx scripts/marketplace-readiness.ts --database-only
```

The output contract is `bnbera.marketplace-readiness/v0.1`. It includes the
database name/role, pgvector version, applied/expected migration counts and
IDs, whether migration hashes match, counts, a data diagnosis, gate state, and
reason codes. It never includes a URL, password, token, response body, or
stack trace. Exit code `0` means the database checks completed; `1` means a
database or migration check was blocked; `2` means configuration or the core
feature gate was invalid.

## Start and verify the web process

Start the existing Next application from the repository root. Keep the
terminal attached so Ctrl-C stops only this process:

```bash
node scripts/run-with-repo-env.mjs -- corepack pnpm --filter @bnbera/web dev
```

If a constrained local dependency layout causes Turbopack to reject a
symlinked package path outside this checkout, use the webpack compatibility
command for this verification only:

```bash
node scripts/run-with-repo-env.mjs -- corepack pnpm --filter @bnbera/web exec next dev --webpack
```

This does not change application behavior. Do not commit the generated
`.next` directory or alter the retained database to work around a local
dependency/filesystem problem.

Open the local URL:

```text
http://localhost:3000/marketplace
```

In a second terminal with the same injected environment, verify the API and
the DB-backed read mode:

```bash
node scripts/run-with-repo-env.mjs -- corepack pnpm exec tsx scripts/marketplace-readiness.ts
```

A successful API probe requires HTTP JSON with contract
`bnbera.marketplace-read/v0.1`, `mode: "live"` (or an explicitly reported
`empty`/`degraded` live result), and retrieval mode `deterministic`. If the
response includes `meta.fixtureCount`, it must be zero. A successful HTTP
response with zero records is still an honest data result. It must not trigger
fixture mode or report an error response. The readiness report's `status` becomes
`empty` when the retained projection has no versions, `degraded` when rows are
present but required evidence is withheld, and `ready` only when the DB
projection is structurally complete. A missing/unreachable API is a blocked
runtime check even when the DB-only check passes.

Stop the web process with Ctrl-C. Leave the retained Docker container and
volume running and unchanged.

## Diagnose empty or degraded results

Use the reason codes and counts from the readiness JSON. Common causes are:

| Signal | Meaning | Safe action |
| --- | --- | --- |
| `READ_MODEL_EMPTY_NO_IDENTITIES` | No identity rows are present | Report empty supply; do not add fixtures |
| `READ_MODEL_EMPTY_NO_VERSIONS` | Identity/agent rows exist but no immutable public version has been persisted | Assign the missing ingestion/publication work to the owner |
| `READ_MODEL_WITHHELD_NO_CAPABILITY_OBSERVATION` | The adapter cannot form a capability manifest | Keep the record withheld |
| `READ_MODEL_WITHHELD_NO_SERVICE_OBSERVATION` or `READ_MODEL_WITHHELD_NO_HEALTHY_SERVICE_PROBE` | No service evidence satisfies health eligibility | Report degraded/withheld state; do not call an endpoint repeatedly |
| `READ_MODEL_WITHHELD_INCOMPLETE_IDENTITY_PROVENANCE` | Exact block, hash, and consistency are incomplete | Keep the identity unresolved |
| `READ_MODEL_WITHHELD_NO_PUBLISHED_LISTING` | The projection has no published listing state | Do not infer publication from discovery |
| `READ_MODEL_WITHHELD_NO_LIVE_RUNTIME` | No agent has live runtime state | Do not present an unavailable endpoint as healthy |
| `ERC8004_INGESTION_DISABLED_READ_MODEL_MAY_BE_STALE` | The read-only synchronization gate is off | Preserve the last known data and disclose staleness |
| `ERC8004SCAN_DISCOVERY_DISABLED_DISCOVERY_MAY_BE_STALE` | Vendor discovery is off | Do not enable it without the standards-lock/credential gate |
| `WEB_API_FIXTURE_FALLBACK` | Live-mode probe reported fixture mode or fixture records | Keep live mode fail-closed; populate the DB through the assigned ingestion work |
| `WEB_API_RETRIEVAL_MODE_UNEXPECTED` | API did not report deterministic retrieval | Keep semantic retrieval disabled and assign the API/configuration mismatch |
| `WEB_API_RESPONSE_ERROR` | API explicitly reported an error response | Preserve the response state and diagnose the named server failure |

The retained baseline observed by T1 has four identities and four agent rows,
but zero versions, capability observations, services/probes, and health
snapshots. That is an empty live read model caused by the missing version and
evidence projections, not a database-startup failure.

## Failure codes and rollback

The diagnostic uses sanitized codes including:

```text
RUNTIME_CONFIGURATION_INVALID
DATABASE_URL_MISSING
DATABASE_URL_INVALID
DATABASE_UNAVAILABLE
PGVECTOR_EXTENSION_MISSING
MIGRATION_FILES_UNAVAILABLE
MIGRATION_JOURNAL_UNAVAILABLE
MIGRATION_JOURNAL_MISMATCH
DATABASE_COUNTS_UNAVAILABLE
MARKETPLACE_DATA_MODE_NOT_LIVE
*_ENABLED_CORE_GATE_VIOLATION
WEB_API_URL_MISSING
WEB_API_URL_INVALID
WEB_API_UNREACHABLE
WEB_API_HTTP_ERROR
WEB_API_NON_JSON
WEB_API_CONTRACT_INVALID
WEB_API_FIXTURE_FALLBACK
WEB_API_RETRIEVAL_MODE_UNEXPECTED
WEB_API_RESPONSE_ERROR
```

For an error, stop the local web process, preserve the output, and correct
only the named configuration or owner-assigned code. Rerun the read-only
checks. Rollback is to stop the process and restore the prior environment
values; there is no DB rollback step for this diagnostic because it performs
no writes. If migration testing or transaction-failure testing is required,
create a disposable PostgreSQL/pgvector database, apply the migrations there,
and remove only that explicitly named disposable database after the test.

This is a local production-like checkpoint. A public Vercel runtime cannot
reach a database bound to this host's `127.0.0.1:55432`; do not expose raw
PostgreSQL or change public DNS to work around that topology limitation.
