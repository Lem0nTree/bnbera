# ADR 0003: Repair branch-local Wave 1 database histories forward

## Status

Accepted for the Wave 1 integration branch. It is implementation-tested only
at SQL-structure level until it is exercised against disposable PostgreSQL
databases representing each historical journal.

## Context

Identity (A3), commerce (A5), and evidence (A8) were developed in isolated
worktrees. Each branch generated its own migration history from the same
foundation migration. The integration branch instead contains
`0001_wave1_combined`, whose timestamp predates A3's `0006`, A5's legacy
migration, and A8's `0002`. Drizzle therefore skips the combined migration on
those already-upgraded databases. Retimestamping or renaming the combined file
would make fresh and upgraded databases diverge and is not a safe repair.

## Decision

Keep `0001_wave1_combined` as the fresh-install baseline. Add
`0002_wave1_legacy_repair` after every known branch-local timestamp. Before
Drizzle runs, the migration client detects an incomplete Wave 1 footprint and
replays the combined baseline statement-by-statement in one transaction. It
uses a savepoint for every statement and accepts only PostgreSQL
duplicate-object/catalog errors; all data, type, permission, constraint, and
integrity errors abort the transaction.

The repair migration then adds columns that `CREATE TABLE IF NOT EXISTS` cannot
backfill on legacy tables, initializes explicit `legacy/unverified` or zero
digest placeholders, applies the current check constraints, and removes old
relationships only after integrity checks pass:

- `payment_attempts.receipt_id` is removed only when every non-null pointer
  matches the receipt's canonical `attempt_id`.
- `commerce_erc8183_job_unique` is removed only after the canonical
  deployment-scoped ERC-8183 and parent-link unique indexes exist.

## Consequences

Fresh databases apply `0000`, `0001`, then a no-op-safe `0002`. Historical A3,
A5, A8, and mixed histories skip old `0001` through normal Drizzle timestamp
rules, are baselined safely by the preflight, and then receive `0002`.

This does not assert a live migration result. Before any environment is
upgraded, run the reproducible migration harness against an empty PostgreSQL
database and fixtures initialized from A3-through-0006, A5 legacy, A8 legacy,
and each mixed combination. Preserve a backup and stop on an integrity
exception; never manually delete migration-journal rows to bypass this path.
