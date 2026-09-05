# MVP runbook

Scope: existing commands at `31d112f` and the small operational layer to add in T1. No command below installs a persistent cron job yet. Do not confuse a one-shot run with completed G1.

## Existing local commands

From `/home/ubuntu/bnbera-w0-w1`, use Node 22 and pnpm 10.15.1. Reuse the existing Docker PostgreSQL/pgvector database; do not recreate its volume. The root `.env` is loaded by `run-with-repo-env.mjs`; never print its values.

```bash
node scripts/run-with-repo-env.mjs --check
pnpm db:check
node scripts/run-with-repo-env.mjs -- pnpm exec tsx scripts/marketplace-readiness.ts --database-only
```

Start the existing web application with direct local database reads:

```bash
MARKETPLACE_DATA_MODE=live MARKETPLACE_API_URL=/api \
node scripts/run-with-repo-env.mjs -- pnpm --filter @bnbera/web dev
```

Routes: `/marketplace`, `/marketplace/{category}`, `/agents/{slug}`, `/compare`, `/api/marketplace`, `/api/marketplace/{slug}`. Stop only this web process with Ctrl-C. Preserve the database.

Existing bounded discovery/enrichment writer, for the authorized development database and configured reviewed providers:

```bash
ERC8004_INGESTION_ENABLED=true ERC8004SCAN_DISCOVERY_ENABLED=true \
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false \
node scripts/run-with-repo-env.mjs -- pnpm ops:erc8004-marketplace
```

This command writes retained observations and eligible listings. It is not a read-only diagnostic. It currently processes at most 20 candidates per invocation. T1 must make repeated work resumable/fair and T2 must finish semantic integration. The standards lock currently disables semantic release; use the existing explicit development canary only for its authorized development tests, not production acceptance.

## Target cron behavior — implemented by T1

| Job | Cadence | Behavior |
| --- | --- | --- |
| Discovery/enrichment | Every five minutes | Separate process lock; resume provider cursor and due retries; bounded registry/metadata/category/vector/publication work |
| Published-service health | Every minute | Separate lock/budget; refresh service observations without running vendor discovery or regenerating unchanged profiles |

Use host cron and ordinary process locks. Persist progress/retry state in the existing DB. No broker or extra service is needed. T1 supplies exact installed commands, cron file, lock locations, timeouts and stop/recovery instructions after verification. Until then no persistent worker is claimed.

At HEAD, health expires after 60 seconds. T1 changes browse staleness consistently to two minutes for minute-based cron, with real timestamps and immediate pre-action checks. T3 verifies expiry and recovery through the public API/UI.

## Verification and rollback

Run focused package tests plus real DB/API/browser checks for changed behavior. `pnpm evidence:release-check` checks historical artifacts, not current gate completion. Never run synthetic cleanup or migration failure tests against the retained data; use an explicitly disposable DB. Back up retained data before any migration and preserve existing fresh/legacy forward-repair behavior.

For public deployment, build/start an immutable artifact from the accepted SHA and use authorized HTTPS API or private DB networking; a remote Vercel process cannot reach this host's loopback DB. Keep server credentials out of browser bundles.

Disable vendor discovery with `ERC8004SCAN_DISCOVERY_ENABLED=false`, direct events with `ERC8004_DIRECT_REGISTRY_SYNC_ENABLED=false`, and semantic operations with `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`. Disabling `ERC8004_INGESTION_ENABLED` stops the ingestion path. Stop the specific installed cron entries/worker processes; preserve the DB, cursors, versions and evidence. Expired health remains stale until a real successful check occurs. Roll back application artifacts, not retained history. Paid/Creator/Greenfield disable procedures are supplied with T4/T6/T8.
