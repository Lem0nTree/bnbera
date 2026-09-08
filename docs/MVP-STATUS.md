# BNBEra MVP status

Updated: `2026-09-07` (current audited state at merged `main` `3cbd4135d809fe865e2a88285e9b79b8e357085a`)

## Current audited state — merged main

This section is the current source of truth for the reconciled checkout. GitHub
`main` is `3cbd4135d809fe865e2a88285e9b79b8e357085a`, and PRs #20–#24 are
merged. Those merges include the T5 WalletConnect-only EOA/SIWE buyer boundary,
sequential ERC-8183 commerce implementation, provider-readiness/card fixes,
and the guarded 2206 marketplace provider path.

### Current gate result

| Scope | Result | Evidence and remaining boundary |
| --- | --- | --- |
| G1 persistent marketplace | Retained/local scope only | T1–T3 discovery, enrichment, category, vector, publication, API/SSR, restart and freshness evidence remains accepted for the retained/local scope. No stable public HTTPS/deployed-browser claim is made. |
| G2 paid hiring | Pending interactive WalletConnect browser acceptance | The merged T5 implementation and authorized operator EOA canary provide live chain evidence for agent 2206, including useful health-factor work, paid cycle `job1103`, settlement and a verified-purchase review. The operator harness is not interactive WalletConnect pairing, browser SIWE/session binding or browser recovery acceptance. |
| G3 Creator | Planned | Altana grant/status/revoke and Agent Studio creation remain unaccepted. Template 1.1.0 stores only bounded public configuration (curated pairs, amount, slippage, quote freshness and deadline); its runtime is plan-only pending the Studio session-permission mismatch. |
| G4 Greenfield | Planned | Greenfield pins, upload/seal/readback and final walkthrough remain unaccepted. |
| ERC-8183 release | Disabled | The standards-lock `releaseEnabled` value remains `false`; the quick tunnel and operator canary are development evidence only. |

### T5 implementation and operator EOA evidence

The buyer implementation is merged, but the release gate is not. The browser
path uses wagmi's single `walletConnect` connector with public
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, normalizes one EOA and chain-97 SIWE
session, and drives named sequential APEX/ERC-8183 calls. There is no separate
`injected()` or MetaMask-specific connector. WalletConnect may reach compatible
extension wallets or mobile wallets through QR/deep links; extension
availability is not guaranteed.

The authorized operator EOA canary exercised agent `2206` as a published,
callable health-factor service and completed useful live work in paid
`job1103`. The full identity tuple is
`eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2206`. This is
operator-harness evidence, not an interactive browser acceptance.

#### Paid cycle `job1103` (operator EOA canary, chain 97)

| Step | Public evidence |
| --- | --- |
| Quote | `695c1be6-a6bb-4deb-b9b8-9eabd60b0ae7` |
| `createJob` | `0xb95b22905005e6fdb430a15f48c4c53f6e127013c7ccac8725af1fdc049b19a4` |
| Router `registerJob` | `0x35559fab1f7a196a2beeb1d53179f9d5fff721c4340b99e902d23929737c631e` |
| Commerce `setBudget` | `0xcd7e35f97e1a7d5aad25ca83200af1494944244bae5103f749bf5e38f90e48e2` |
| ERC-20 `approve` | `0x89b28913748cd04eebd7f0c503dd40eae3648361c184576aea747bb76f7de1b1` |
| Commerce `fund` | `0x0b005abb90ee3238204b2b989ca36e0924b9e0842b3464961d1def3a9ac67afc` |
| Provider submit/result | `0x8343f2402aa567f274340538fb4798125a67d93d10f308017659dc84bc0fddf1` |
| Buyer/operator settlement | `0x8f580a37cb22ec2f5c19c78cb9f3371caee02426e60c499bd9b18064ede3f26f` |

Result integrity evidence: local SHA-256
`3d73b7286e9207de2c76906e1eaf216850ad20aafb3b32026cfe1a25d780b42d` and
on-chain/SDK deliverable Keccak
`0xe3064c53a95081f9c882ff611944ba9dd768b24c47cd783bea4f804db590c65`.
The verified-purchase review is score `5`, active revision `1`.

#### Refund cycle `job1101`

The canonical job state reached expiry/refund with transaction
`0xc1a051eeb933ec6f7711fce9448bdb1e7563685fd23503cdf00d9ca3a3093628`.
The parent summary still reporting `funded` is a known P1 projection issue
being fixed separately; it must not override the canonical expired/refund
state or be used as current funded-job evidence.

#### Operator harness limitation and release gate

The canary is driven by the operator EOA harness and therefore does not prove
WalletConnect browser pairing, browser-owned SIWE session continuity, page
reload/account-change handling or unknown-wallet-response recovery in the UI.
It proves useful live 2206 work and the pinned chain journey, including
settlement/review, but G2 remains pending until the interactive WalletConnect
browser flow is accepted. Keep `releaseEnabled=false`; the authorized quick
HTTPS tunnel remains canary-only with no uptime guarantee. A redundant second
web build in CI is tracked as a nonblocking P2 note; CI was not changed by this
documentation reconciliation.

## Historical retained/local snapshots

The sections below are preserved historical evidence captured before the
current `main` reconciliation. Their timestamps, checkouts, counts, and gate
wording are not current branch or release claims.

### Historical T3/G1 acceptance snapshot

This record captures the T3/G1 acceptance evidence at checkout
`/home/ubuntu/bnbera-t3-public-preview`, branch `task/t3-public-preview`,
HEAD `d9069c17b5d9d0b3e0294a950c2d40f709b2abca`. It is retained-host/local
evidence, not a claim that a public HTTPS preview or any later gate is live.

### Historical T3/G1 gate result

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

### Historical build and focused checks

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

### Historical retained database snapshot

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

### Historical cron evidence and topology

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

### Historical API/SSR acceptance

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

### Historical restart, freshness, and fallback evidence

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

### Historical honest gaps and owner requests

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

### Historical T2 retained reputation rollout addendum

Updated: `2026-09-06T14:54:28Z`

This addendum records the forward rollout from the merged reputation code at
`7a79b3b4d1b943d2380491d7778f2dff12cc30ab` in the isolated checkout
`/home/ubuntu/bnbera-t2-reputation-rollout`, branch
`task/t2-reputation-rollout`. It does not change eligibility, semantic release,
cron topology, or any later gate.

#### Historical backup and migration evidence

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

#### Historical retained read snapshot

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

#### Historical reputation sync result and blocker

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

#### Historical read/restart checks

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

At the original configured provider, T2 reputation ingestion remains blocked
on bounded `eth_getLogs`/finalized-state behavior. Raw, recognized-reviewer,
and verified-purchase views remain provenance-separated and explicitly
unknown/unavailable; no rating or review count was fabricated. The follow-up
recovery addendum below records a successful process-only endpoint override.

#### Historical RPC retry audit from the retained main environment

Updated: `2026-09-06T15:08:00Z`

The current main environment was inspected by variable name only. The HTTP
candidate names present were `BSC_TESTNET_RPC_URL`; the configured transport
name `BSC_TESTNET_WSS_URL` is not consumable by the read-only HTTP JSON-RPC
client. `BSC_TESTNET_RPC_URL_SECONDARY` and `BSC_TESTNET_RPC_URL_2` were unset.
No endpoint value, credential, or private key was printed.

| Candidate | Chain ID | Head | Finalized | Latest `eth_getCode` | Finalized `eth_getCode` | One-block `eth_getLogs` |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `BSC_TESTNET_RPC_URL` | `97` | `129467600` | `129467592` | pass; bytecode present (130 bytes) | `CHAIN_PROVIDER_ERROR` | `CHAIN_PROVIDER_ERROR` |
| `BSC_TESTNET_RPC_URL_SECONDARY` | — | — | — | unset | unset | unset |
| `BSC_TESTNET_RPC_URL_2` | — | — | — | unset | unset | unset |

The log probe addressed the standards-locked chain-97 Reputation Registry for
exactly the finalized block. Both the reviewed topic-filtered range query and
the block-hash form also returned the same sanitized provider error. The
candidate therefore proves head/finalized block reads and a head bytecode read,
but cannot provide the finalized state and bounded log reads required by the
locked `rpc-finalized-tag` sync policy.

Two bounded sync attempts used the finalized policy, start block
`129462600`, max range `10,000`, and max events `10,000`. Both exited `1` with
only `{"errorCode":"CHAIN_PROVIDER_ERROR"}`. A read-only retained-DB query
after the first and retry attempts reported `erc8004_reputation_events=0`,
`erc8004_reputation_checkpoints=0`, and `erc8004_identities=2120`; no partial
transaction was committed. The current command's exact unblock requirement is
an HTTPS/HTTP endpoint in `BSC_TESTNET_RPC_URL` that serves chain `97`, the
locked registry bytecode at `finalized`, and bounded one-block `eth_getLogs`.
Secondary variable names are not currently consumed by this reputation-sync
script, so merely adding one does not silently change provider selection.

The read-only API projection was checked on port `3111` before and after
stopping/restarting only the local web process. Both checks returned HTTP `200`
with degraded live mode, `25` published records, and the representative full
tuple `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097`. Its raw
permissionless reputation view remained `unknown`; recognized-reviewer and
verified-purchase views remained `unavailable` with their explicit reasons.
This confirms the RPC failure did not alter marketplace identity/listing data
or collapse the three reputation provenance views.

### Historical T2 reputation RPC recovery and retained sync

Updated: `2026-09-06T15:12:08Z`

The coordinator supplied an official BSC testnet HTTPS endpoint as a
process-only `BSC_TESTNET_RPC_URL` override. The repository `.env` was not
modified, and the endpoint value was not emitted or persisted. The existing
`scripts/erc8004-reputation-sync.ts` already consumes this supported variable,
so no source fallback or additional configuration was necessary.

Sanitized preflight for the override passed chain ID `97`, head block
`129468538`, finalized block `129468537`, finalized Reputation Registry
`eth_getCode` with bytecode present (130 bytes), and one-block
`eth_getLogs` against the locked registry (`0` logs). The standards lock's
`rpc-finalized-tag` policy remained in force; no write-capable RPC method or
private key was used.

The first bounded sync used start block `129463537`, max range `10,000`, and
max events `10,000`. It completed with `scannedThroughBlock=129468571`,
`insertedEventCount=0`, `promotedEventCount=0`, and a checkpoint at block
`129468571` (`cursorVersion=1`). The immediate idempotent replay scanned only
newly finalized blocks `129468572` through `129468601`, again inserted and
promoted `0` events, and advanced the same checkpoint stream to
`cursorVersion=2`. No duplicate events were created.

The retained read-only DB check after both runs reported `events=0`,
`canonical_events=0`, `checkpoints=1`, `last_scanned_block=129468601`,
`cursor_version=2`, and `identities=2120`. Migration journal/hash verification
remained `7/7`; retained history and the pre-existing backup were preserved.

The API projection after the successful sync and a local web-process restart
remained HTTP `200`, degraded/live, with `25` published listings and the full
representative tuple
`eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097`. Because the
bounded finalized window contained no feedback, raw permissionless reputation
remained `unknown`; recognized-reviewer and verified-purchase views remained
`unavailable` with explicit reasons. To enable retained cron operation, replace
the failing repository value under the already-supported `BSC_TESTNET_RPC_URL`
name only after the authorized environment owner approves that configuration
change; do not add a second provider silently.

Focused verification after the recovery passed: agent-ingestion `111/111`
tests, database schema/legacy tests `17/17`, and `pnpm db:check` (`Everything's
fine`).
# G3 composition update (not live acceptance)

The Creator code has disabled scaffolding only: a bounded opt-in worker and tuple-bound reconciliation seams to ERC-8004/G1 and ERC-8183/G2. It does not hold an operator key: an absent browser caller or uncomposed T6 authority gateway blocks status, revoke, deployment and the worker; missing exact browser-persisted identity/owner/agent-wallet/endpoint/version evidence leaves reconciliation pending. The reviewed handoff is Studio-owned `.studio/wallets/altana-session.json`, managed as `ALTANA_SESSION`; no raw session reaches HTTP, PostgreSQL or logs. PostgreSQL stores only the T6 secret reference and public policy/receipt metadata. No testnet deployment, browser grant/revoke/deny, useful execution, registration, listing or paid hire evidence has been collected, so G3 remains planned and unaccepted.
