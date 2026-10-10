# Marketplace recovery — 2026-10-10

G1/T2–T3 (Marketplace Data + Web and QA/Deployment), R1 reads/R2 deployment.
Base e8d5c8ae46c1ae3875697901ebd0cc90c4f2c0b7; isolated checkout
`/home/ubuntu/bnbera-recovery-20261010`, branch
`codex/marketplace-recovery-20261010`, initially clean.

Documentation read: `AGENTS.md`, `docs/MVP-MASTER-PLAN.md`,
`docs/MVP-TASKS.md`, `docs/MVP-RUNBOOK.md`, `config/standards.lock.json`,
`docs/operations/full-directory.md`, `deploy/origin/README.md`,
`docs/archive/2026-09-05/04-bnbera-master-implementation-plan.md`,
`docs/archive/2026-09-05/05-subagent-delivery-plan.md`,
`docs/archive/2026-09-05/01-marketplace-donor-merge-plan.md`,
`docs/archive/2026-09-05/03-no-code-agent-deployer-plan.md`,
`docs/archive/2026-09-05/adr/0003-wave1-legacy-migration-repair.md`,
`packages/agent-ingestion/src/directory.ts`, consumed enrichment schema in
`packages/db/src/schema.ts`, marketplace search/response schemas in
`apps/web/src/lib/marketplace-contract.ts`, and the two modified read modules.
The archive was read because the user's repository instructions explicitly
required it. Active scope and current standards lock supersede old gate status.
No contracts, gates, networks, identity/state semantics or signing scope changed.

## Cause and containment

The database retained 314,304 identities; 290,747 qualified for the directory.
Full-directory workers and a per-minute protocol refresh piled up history
reads against about 3.47 million enrichment observations. Catalogue requests
sorted/copied full registration bodies; service projection sorted probe history.
Parallel hashes exceeded Docker PostgreSQL's 64 MiB shared-memory limit.

With user authorization, scan/enrich/vector user services were disabled and
stopped, and only the per-minute `protocol-services.sh` cron line was removed.
Existing bounded health, reference-health, seller-health, tunnel and reference
provider configuration remains. Discovery/enrichment/vector growth is paused;
metadata remains timestamped and stale service evidence is not promoted to live.

A private full pg_dump backup and its verified contents are in
`/home/ubuntu/.local/state/bnbera-recovery-20261010/`. Do not publish the dump.
Database history and migration journal remain intact.

## Reproducible read repair

Apply `ops/marketplace-cron/directory-read-indexes.sql` using the existing
private database connection and psql; it adds concurrent partial latest-profile
and latest-service indexes, a covering latest-A2A-probe index and a latest-enrichment timestamp index. Set database-scoped `enable_parallel_hash=off` and
`work_mem=64MB`; create MCV/dependency statistics on enrichment observation kind,
provider and validation state and analyze that table. SQL/logs are retained in
that private recovery directory. Application connections additionally disable
parallel workers and cap their pool at four.

Apply `ops/marketplace-cron/directory-catalog-cache.sql` once with discovery
paused. It creates an additive, rebuildable materialized view of latest public
search metadata, excluding registration bodies, and a unique identity index.
Enable `BNBERA_DIRECTORY_CATALOG_CACHE_ENABLED=true` for the marketplace only.
Current finality, listing, verification and discovery membership are joined on
reads; current service checks, state axes, commerce and activation remain live.
Duplicate catalogue requests are coalesced with a bounded 15-second cache.
Reference metadata reads are scoped to the complete identity before enrichment.
Historical probes are reduced to the latest per version before selecting the
latest per identity, including versions other than the current one.

While discovery is stopped, the catalogue metadata snapshot is stable. Before
resuming any metadata writer, establish bounded locked refreshes using
`REFRESH MATERIALIZED VIEW CONCURRENTLY bnbera_directory_catalog_cache;`
followed by `ANALYZE bnbera_directory_catalog_cache;`. Do not resume the old
unbounded workers without that refresh and a reviewed smaller batch/cadence.
The view is operational read acceleration, not new live evidence or canonical
state. It can be rebuilt entirely from preserved source history.

## Verification and rollback

Evidence is real production DB/API/browser reading, never signing or payments.
Record final timings/test totals/deployment SHA in the private recovery report.
The original immutable release remains at
`/home/ubuntu/.local/state/bnbera-deploy/releases/e8d5c8ae46c1ae3875697901ebd0cc90c4f2c0b7`.
Restore `marketplace-dropin.before` from the private recovery directory to
`/home/ubuntu/.config/systemd/user/bnbera-marketplace.service.d/zzzz-autodeploy.conf`,
restore `current.before.json` to the deployment current.json, reload systemd and
restart `bnbera-marketplace.service` to restore the original application.
The separate `directory-read-cache.conf` drop-in enables only the metadata cache
and remains compatible with normal future deployments.
Disable the new cache flag to restore the prior source query (slower at this scale).
Retain additive DB indexes/cache through app rollback; drop only after verifying
no reader uses them. Reset database work_mem/enable_parallel_hash to restore
original defaults. Do not restore an older dump over later writes.
Crontab backup `crontab.before` and worker enablement permit operational rollback,
but keep heavy scans off until resource limits and bounded refresh are reviewed.
