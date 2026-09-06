# BNBEra MVP status

Updated: `2026-09-06T05:31:00Z`

This is the retained-development runtime evidence for G1. It is not a claim
that semantic retrieval is release-enabled, that payment/Creator/Greenfield
gates pass, or that external reviews/jobs exist.

## T3/G1 retained runtime

- Checkout: `task/t3-retained-runtime`
- Base: GitHub `main` at `079e7a961a6e7892110adfa9f391a09663737fa5` (includes `ff8dd2d`)
- Database: existing `bnbera_erc8004` PostgreSQL/pgvector container; retained data was not reset or deleted
- Migration journal: `0000` through `0004`, 5/5 applied, hashes match; no forward migration was needed
- Backup: `.runtime/t3-backups/retained-20260906T050216Z.dump`
- Backup size: `180536` bytes
- Backup SHA-256: `b6e36470ea3261c43e5d2efa86057bafecc14dd170d6b164584dcfb68b7412fa`
- Backup verification: `pg_restore --list` succeeded (325 TOC entries)

Disposable safety checks passed before retained writes:

```text
db-migration-legacy-smoke: freshInstall=true, restartNoOp=true, adr0003LegacyRepair=true
ingestion-postgres-smoke: migration replay, rollback, discovery replay, registry replay,
  persistence restart and cleanup all passed
```

## Counts

| Readiness count | Before | After |
| --- | ---: | ---: |
| ERC-8004 identities | 25 | 140 |
| Exact finalized identity reads | 25 | 140 |
| Agent rows | 25 | 140 |
| Published listings | 1 | 11 |
| Verified/live listings | 1 / 1 | 11 / 11 |
| Agent versions | 2 | 25 |
| Capability observations | 1 | 11 |
| Discovery sources | 46 | 192 |
| Service observations | 1 | 36 |
| Healthy service observations | 1 | 11 |
| Service probes | 5 | 65 |
| Healthy service probes | 5 | 39 |
| Category predictions | 2 | 47 |
| 1536-d listing embeddings | 2 | 15 |

All 11 current published versions have a compatible 1536-dimensional vector;
the total includes vectors on historical versions. Category backfill v3 ran
successfully over 11 current versions. The current published primary labels
are:

```text
rebalancing=1, grid-trading=2, yield-optimisation=1, health-factor=1,
uncategorized=6
```

Category evidence remains truthful. No label was assigned merely to fill a
route. The classifier/read model supports `applicableCategories` for
evidence-backed multi-category agents; this sample had no qualifying
multi-category match.

The retained 8004scan cursor advanced through seven bounded pages (offsets
`0,20,40,60,80,100,120`) to `next_offset=140` of provider total `2133`.
The finalized registry reader, 8004scan source, metadata resolver, service
probe, category sink, publication service and pgvector storage all ran
against retained PostgreSQL. Withheld candidates were not promoted: the
dominant reasons were missing/invalid capability or missing/unhealthy service.

## API and restart evidence

Using the local live Next.js server and direct HTTP requests (no Chromium or
browser scraper):

- `/api/marketplace?limit=20`: 11 records after a fresh health run; all four
  categories are represented. The response is marked degraded because 129
  indexed identities are honestly withheld from the marketplace projection.
- `/api/marketplace?q=health%20factor`: one result, identity `2097`,
  `retrievalMode=hybrid` with the development semantic canary.
- Category API filters returned: rebalancing 1, grid-trading 2,
  yield-optimisation 1, health-factor 1.
- `/api/marketplace/b8x-health-factor-agent`: identity `eip155:97`, registry
  `0x8004a818bfb912233c491871b3d84c89a494bd9e`, agent `2097`, with observed
  uptime/probe metrics and unavailable reviews/jobs explicitly labeled.
- After a web-process restart, the API first returned zero records when the
  two-minute health window expired; one health refresh restored the two
  grid-trading records. This proves stale-to-fresh and web restart behavior.

The health job completed `11` agents, `11` services, `11` healthy, `0`
unhealthy. The semantic provider/model/dimension remains a development
canary (`releaseEnabled=false`); production/preview must use deterministic
fallback until release evidence changes the standards lock.

## Operational correction

The runner previously invoked the optional four-query 8004scan semantic
candidate fan-out even when semantic retrieval was disabled. A slow vendor
fan-out could consume the bounded run budget before composition. The runner
now keeps that fan-out opt-in with
`ERC8004SCAN_SEMANTIC_DISCOVERY_ENABLED=true`; ordinary scan candidates still
run through enrichment, category, publication and gated vector generation.
The MVP cron should leave this optional fan-out disabled.

## Remaining G1 limitations

- This is a retained development runtime, not a public HTTPS preview.
- 8004scan credential rotation remains a release prerequisite.
- External reviews, completed jobs and current financial data remain
  unavailable and are shown as unavailable; no synthetic values were added.
- Host cron was not installed from this unmerged checkout. Install the two
  documented wrappers after the accepted commit is merged, with the runtime
  environment explicitly loaded.
- Repeated bounded canary retries produced historical versions/predictions;
  the current read model is complete and vectors are current, but a clean
  long-run no-churn measurement should be made after cron installation.
