# BNBEra MVP status

Updated: `2026-09-06T13:00:06Z`

This record captures the T3/G1 acceptance evidence at checkout
`/home/ubuntu/bnbera-t3-public-preview`, branch `task/t3-public-preview`,
HEAD `d9069c17b5d9d0b3e0294a950c2d40f709b2abca`. It is retained-host/local
evidence, not a claim that a public HTTPS preview or any later gate is live.

## Gate result

| Scope | Result | Evidence |
| --- | --- | --- |
| Production build | Pass | `pnpm build` completed after the normal workspace package build; Next.js reported all web/API routes compiled. `pnpm db:check` passed. |
| Retained PostgreSQL/read model | Pass (read-only) | Existing `bnbera_erc8004` database answered a read-only query; no migration, ingestion, health job, or other writer was run from this checkout. |
| API and server-rendered marketplace | Pass locally | API contract, filters, all four category routes, detail, compare, degraded labels, unavailable metrics, and full identity values were checked over HTTP against the production build. |
| Web restart persistence | Pass locally | The built web process was restarted with the same SHA; the DB-backed listing count and detail remained available after the same-origin configuration was aligned. |
| Cron/restart/freshness | Retained host evidence | Existing host cron has run for more than seven hours with bounded discovery/health records. Stale expiry/recovery is covered by the current source test; a retained-DB stop-health mutation was not performed. |
| Semantic fallback | Pass | Preview with semantic retrieval disabled returns `retrievalMode=deterministic`; forcing semantic retrieval with the candidate lock fails closed with `MARKETPLACE_CONFIGURATION_INVALID`. Hybrid/fallback unit tests pass. |
| Public HTTPS preview | Blocked | No stable HTTPS URL, DNS/certificate, or approved private API connection is present. The host exposes only a private address and loopback PostgreSQL. |

The public G1 gate remains open only for the missing authorized HTTPS topology
and deployed-browser walkthrough. The local/retained marketplace acceptance is
not promoted to a public claim.

## Build and focused checks

Runtime: Node `v22.22.1`, pnpm `10.15.1`, Next.js `16.0.1`.

```text
pnpm install --frozen-lockfile                         pass
pnpm db:check                                          pass
pnpm build                                             pass
pnpm --filter @bnbera/web test                         8/8 pass
pnpm --filter @bnbera/config test                     7/7 pass
pnpm --filter @bnbera/marketplace test                34/34 pass
pnpm typecheck                                         pass (14 workspace projects)
pnpm lint                                               pass (14 workspace projects)
```

The first direct `@bnbera/web build` attempt failed because workspace `dist/`
exports had not been generated in the fresh checkout. The ordinary recursive
`pnpm build` generated those outputs and then completed the web production
build; this is a clean-checkout bootstrap prerequisite, not a source failure.

## Retained database snapshot

The configured database is `bnbera_erc8004` on `127.0.0.1:55432`; the URL and
credentials were never printed or committed. The migration journal is in the
`drizzle` schema with five applied rows; `db:check` passed and no migration was
run for this acceptance.

Read-only counts observed while the host jobs continued to refresh health:

| Projection | Count |
| --- | ---: |
| ERC-8004 identities | 1,621 |
| Agents | 1,621 |
| Published listings | 25 |
| Agent versions | 39 |
| 1536-dimensional vectors | 29 |
| Service probe rows | 10,880 |
| Probe rows in the latest two-minute window | 78 (at the snapshot query) |

All observed identities are chain `97` and use the standards-lock registry
`0x8004a818bfb912233c491871b3d84c89a494bd9e`. Published category supply at the
snapshot was:

| Category | Published agent IDs |
| --- | --- |
| Rebalancing | `1825`, `2095` |
| Grid trading | `1826`, `2096`, `2159` |
| Yield optimisation | `1827`, `2098` |
| Health factor | `1828`, `2097` |
| Uncategorized | `1691`, `1838`, `1866`, `1923`, `1924`, `1925`, `1926`, `1935`, `1936`, `1937`, `2055`, `2056`, `2057`, `2058`, `2059`, `2102` |

Thus each listed tuple is exactly
`eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:<agentId>`.
Representative full tuples used in the API/detail checks were:

```text
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1825  (discovered, rebalancing)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1826  (discovered, grid-trading)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1827  (discovered, yield-optimisation)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1828  (discovered, health-factor)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097  (manual import with 8004scan source, health-factor)
```

The vector rows all use the locked tuple
`openrouter / openai/text-embedding-3-small /
openrouter-openai-text-embedding-3-small-v1 / 1536 /
bnbera-agent-semantic-v1`. Preview semantic retrieval remains disabled by the
standards lock; persisted vectors do not by themselves enable release mode.

## Cron evidence and topology

The currently installed host entries are:

```text
* * * * * ... /home/ubuntu/bnbera-w0-w1/ops/marketplace-cron/health.sh
*/5 * * * * ... /home/ubuntu/bnbera-w0-w1/ops/marketplace-cron/discovery.sh
```

They run from the retained `main` checkout, not this unmerged branch. The
health log spans `2026-09-06T05:52:01Z` through `2026-09-06T12:50:17Z` and
contains 411 completed JSON records; its latest records report `25` agents,
`25` services, `25` healthy, `0` unhealthy. The discovery log spans
`2026-09-06T05:52:24Z` through `2026-09-06T12:50:02Z` and contains 100 bounded
JSON records. Its latest records report `20` candidates, `20` completed,
`0` failed, `budgetExpired=false`, and finalized registry reads; candidates
that fail capability/service gates remain withheld.

The existing discovery crontab explicitly enables a development semantic
canary. That is retained-host development evidence only. Before preview or
production installation, use the accepted immutable checkout, load its runtime
environment, and set `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false` unless the
standards lock has separately acquired release evidence.

The host name resolves only to private `172.31.18.215`; the tested web process
was local `*:3103`, while PostgreSQL listens on loopback (`127.0.0.1:55432`).
No public hostname/certificate or approved remote API/private-network bridge is
configured. PostgreSQL must remain private.

## API/SSR acceptance

The immutable build was started locally with the retained environment supplied
by reference and these non-secret safety overrides:

```text
PORT=3103
APP_URL=http://localhost:3103
MARKETPLACE_API_URL=http://localhost:3103/api
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false
```

The same-origin URL/port alignment is required for server-rendered pages; a
stale `localhost:3000` URL correctly fails closed rather than self-forwarding.

Read-only HTTP checks against the running production build:

```text
GET /api/marketplace?limit=12                         200, degraded, 12/25, deterministic
GET /api/marketplace?category=rebalancing             200, 2 records
GET /api/marketplace?category=grid-trading             200, 3 records
GET /api/marketplace?category=yield-optimisation       200, 2 records
GET /api/marketplace?category=health-factor            200, 2 records
GET /api/marketplace/proofera-lp-risk-evidence-agent   200, real identity/health/metrics
GET /marketplace                                      200, live rendered listing HTML
GET /marketplace/{all four categories}                200, live rendered listing HTML
GET /agents/b8x-health-factor-agent                   200, real identity 2097/detail HTML
GET /compare?agents={three published slugs}           200, selected slugs rendered
```

The checked-in verifier passed:

```text
BNBERA_MARKETPLACE_API_URL=http://127.0.0.1:3103/api/marketplace \
  node scripts/verify-marketplace-api.mjs
# ok=true, readStatus=degraded, dataMode=degraded, itemCount=12, total=25
```

The final verifier after the controlled web-process restart observed `25`
published records; one immediately post-restart poll observed `24` while the
retained host cron refreshed the read model. This is why the status is labeled
as a live retained projection rather than a fixed fixture.

The HTTP/SSR probe found no application/HTML error signal and confirmed the
locked identity, service URL, endpoint health timestamp, observed uptime and
explicit `unavailable` reviews/completed-jobs/result fields. No Chromium or
browser automation was run in this host acceptance because the lightweight
HTTP/SSR checks were sufficient and no approved browser runner was available;
deployed-browser evidence remains pending the public URL.

## Restart, freshness, and fallback evidence

- Restarting the production web process from the same built SHA preserved the
  DB-backed listing/detail response after the same-origin environment was
  aligned.
- The source projection uses the two-minute browse-health bound. The current
  `@bnbera/marketplace` test suite includes a read-model clock advance beyond
  that bound and observes `endpointStatus=unknown`, then a fresh probe restores
  health. This test passed as part of `34/34`. A retained-DB stop-health test
  was intentionally not run because the host cron owns the retained writer and
  the acceptance must not mutate that database.
- With semantic retrieval disabled, the live API reports
  `retrievalMode=deterministic` and remains useful. With the candidate lock's
  `releaseEnabled=false`, forcing semantic retrieval returns a structured
  `MARKETPLACE_CONFIGURATION_INVALID` error rather than serving an unsafe
  preview. Marketplace hybrid tests cover no-compatible-embedding and mixed
  model-version fallback paths.

## Honest gaps and owner requests

- **Public HTTPS/deployed browser (owner: coordinator/release + authorized
  host owner):** provide a stable HTTPS origin and certificate, and either run
  the web/API beside the private DB or provide an approved private connection.
  Do not expose PostgreSQL. Then build/start this SHA, reinstall cron from the
  immutable accepted checkout, and rerun the API/browser checks.
- **Cron branch alignment (owner: coordinator/ops):** the running entries still
  point at `/home/ubuntu/bnbera-w0-w1`; they must be reinstalled from the final
  accepted public-preview checkout before claiming deployed T1/T3 operation.
- **Semantic release (owner: standards/coordinator):** the lock remains
  candidate/canary-only; deterministic fallback is the only preview-safe mode.
- **Supply depth:** published category counts are truthful but small; the
  1,580--1,616 withheld indexed identities in the observed API responses lack
  complete valid metadata/capability/service/health evidence. Uncategorized
  listings are not counted as category coverage.
- **Reviews/jobs/current data:** external reviews, verified-purchase reviews,
  completed BNBEra jobs/results and current financial observations remain
  unavailable. Activation remains disabled; no synthetic metrics were added.
- **Later gates:** ERC-8183 paid hire, Altana/Creator, and Greenfield remain
  disabled and unaccepted.

Rollback is application-only: stop the preview process and/or remove only the
two installed BNBEra cron lines, then restore the prior application artifact.
Do not reset, delete, or roll back retained PostgreSQL history.

## T2 retained reputation rollout addendum

Updated: `2026-09-06T14:54:28Z`

This addendum records the forward rollout from the merged reputation code at
`7a79b3b4d1b943d2380491d7778f2dff12cc30ab` in the isolated checkout
`/home/ubuntu/bnbera-t2-reputation-rollout`, branch
`task/t2-reputation-rollout`. It does not change eligibility, semantic release,
cron topology, or any later gate.

### Backup and migration evidence

- Retained PostgreSQL container: `bnbera_erc8004_pgvector`, healthy, loopback
  `127.0.0.1:55432`, retained volume `bnbera_erc8004_pgdata`; database/role
  observed as `bnbera_erc8004` / `bnbera_local`. Credentials were not printed
  or recorded.
- Pre-migration retained journal: five rows (through `0004`); no reputation
  event or checkpoint rows existed.
- Backup: `/home/ubuntu/bnbera-backups/bnbera_erc8004_retained_20260906T143826Z.dump`;
  4,221,289 bytes; SHA-256
  `c42aacfc43c6a8ff09b48a36a7dc191b3484c1786e3cce6efec60186f04a6ffe`;
  `pg_restore --list` returned 336 entries.
- Disposable migration smoke on the separate healthy `bnbera-t3-disposable-pg`
  passed: `freshInstall=true`, `restartNoOp=true`,
  `adr0003LegacyRepair=true`, `disposableDatabase=true`.
- `pnpm db:migrate` applied only the forward `0005_outgoing_ezekiel.sql` and
  `0006_reputation_replacement_log.sql` changes to retained data. Final
  journal: seven rows, IDs `1`–`7`, all seven checked-in migration hashes
  match. `erc8004_reputation_events`,
  `erc8004_reputation_checkpoints`, and the replacement unique index are
  present; event/checkpoint counts remain `0` / `0`.

### Retained read snapshot

The final read-only readiness snapshot used one-off safety overrides
`ERC8004_INGESTION_ENABLED=false`,
`ERC8004SCAN_DISCOVERY_ENABLED=false`, and
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`; this did not modify the
retained environment or cron. `marketplace-readiness.ts --database-only`
reported `status=degraded`, `dataState=degraded`, `appliedCount=7`,
`expectedCount=7`, `hashesMatch=true`, and pgvector `0.8.6`.

| Projection | Count |
| --- | ---: |
| ERC-8004 identities / agents | 2,120 / 2,120 |
| Exact identity reads | 1,594 |
| Published / verified / live agents | 25 / 25 / 25 |
| Agent versions | 39 |
| Capabilities / category predictions | 25 / 75 |
| Discovery sources | 3,054 |
| Service observations / healthy | 701 / 37 |
| Services / healthy | 39 / 39 |
| Service probes / healthy | 14,216 / 13,216 |
| Listing embeddings (1536-dimensional lock) | 29 |
| Reputation events / checkpoints | 0 / 0 |

Published category supply at the snapshot was rebalancing `2`, grid-trading
`3`, yield-optimisation `2`, health-factor `2`, and uncategorized `16`.

### Reputation sync result and blocker

The bounded command used the standards-locked BSC testnet identity/reputation
registries, chain `97`, finalized RPC tag, max block range `10,000`, max events
`10,000`, and an explicitly derived 5,000-block development read window. It
was run with `ERC8004_INGESTION_ENABLED=true` and
`ERC8004_REPUTATION_SYNC_ENABLED=true`; no private key or write-capable RPC
method was used. The configured provider returned JSON-RPC `-32005 limit
exceeded` from `eth_getLogs` even for a one-block query (with and without the
reviewed event-topic filter), and `-32000 missing trie node` for finalized
`eth_getCode`. The sync therefore returned sanitized `CHAIN_PROVIDER_ERROR`
and did not commit a checkpoint or event. A retry returned the same error;
reputation counts stayed `0 / 0` before and after (`retry_sync_exit=1`).
Latest/finalized block preflight reads succeeded at the same block/hash before
the provider log failure, so this is an RPC log/archive limitation rather than
a standards-lock or migration failure. No fallback provider was invented.

### Read/restart checks

- `pnpm db:check` passed.
- Targeted ERC-8004 reputation/RPC tests passed `5/5`; DB schema/legacy
  migration tests passed `14/14`; isolated SHA production build passed.
- A local web process on port `3110` passed the API verifier: HTTP `200`,
  contract `bnbera.marketplace-read/v0.1`, degraded live read, deterministic
  retrieval, `12/25` returned/total, zero fixture records. Detail read for
  `b8x-health-factor-agent` returned the full tuple
  `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097`.
- After stopping and restarting only that local process, the API projection,
  ordered identity list, and explicit raw/recognized/verified reputation-view
  statuses were unchanged. Readiness database+web remained HTTP/API pass with
  7/7 migration hashes matching. The local process was stopped after checks.

T2 reputation ingestion remains blocked on the configured provider's bounded
`eth_getLogs`/finalized-state behavior. Raw, recognized-reviewer, and verified
purchase views remain provenance-separated and explicitly unknown/unavailable;
no rating or review count was fabricated. Retry after provider repair should
resume from the still-empty checkpoint using the same finalized and bounded
configuration.
