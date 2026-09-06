# BNBEra MVP status

Updated: `2026-09-06T14:54:23Z`

This record captures the T3/G1 acceptance evidence at checkout
`/home/ubuntu/bnbera-t3-public-https`, branch `task/t3-public-https`, HEAD
`7a79b3b4d1b943d2380491d7778f2dff12cc30ab`. It is retained-host/local
evidence, not a claim that a public HTTPS preview or any later gate is live.

## Gate result

| Scope | Result | Evidence |
| --- | --- | --- |
| Production build | Pass | `pnpm build` completed all 14 workspace builds; Next.js compiled all web/API routes. `pnpm db:check` passed. |
| Retained PostgreSQL/read model | Pass (read-only) | `marketplace-readiness.ts --database-only` read the existing `bnbera_erc8004` database; seven migrations match their expected hashes. No migration or writer ran from this checkout. |
| API and server-rendered marketplace | Pass locally | The immutable production process served the API verifier, all four category filters, detail, compare, degraded labels, unavailable metrics, and full identity tuples over HTTP. |
| Web restart persistence | Pass locally | Restarting the same built SHA on port `3103` preserved the DB-backed 25-listing projection and detail identity. |
| Cron/restart/freshness | Retained host evidence | Existing host cron has bounded health/discovery records through `2026-09-06T14:43Z`; latest health record reports 25 agents, 25 services, 25 healthy, 0 unhealthy. Stale expiry/recovery remains source-test evidence; no retained-DB stop-health mutation was performed. |
| Semantic fallback | Pass | With retrieval disabled, the local API reports `retrievalMode=deterministic`; explicit development canary mode reports hybrid retrieval; production-style enablement without canary returns HTTP 503 `MARKETPLACE_CONFIGURATION_INVALID`. Hybrid/fallback unit tests pass. |
| Public HTTPS preview | Blocked | IMDSv2 confirms an EC2 public IPv4/public hostname, but no proxy/tunnel/deployment config or listener on 80/443 exists; self-probes to public-IP ports 80/443/3103 fail. No stable HTTPS origin, certificate, DNS route, or approved private API connection is configured. |

The public G1 gate remains open only for the missing authorized HTTPS topology
and deployed-browser walkthrough. The local/retained marketplace acceptance is
not promoted to a public claim.

## Build and focused checks

Runtime: Node `v22.22.1`, pnpm `10.15.1`, Next.js `16.0.1`.

```text
pnpm install --frozen-lockfile                         pass
pnpm db:check                                          pass
pnpm build                                             pass (14 workspace builds)
pnpm --filter @bnbera/web test                         8/8 pass
pnpm --filter @bnbera/config test                     7/7 pass
pnpm --filter @bnbera/marketplace test                34/34 pass
pnpm typecheck                                         pass (14 workspace projects)
pnpm lint                                               pass (14 workspace projects)
```

The recursive build generated workspace `dist/` outputs before the Next.js
production build; this is the expected clean-checkout bootstrap sequence.

## Retained database snapshot

The configured database is `bnbera_erc8004` on `127.0.0.1:55432`; the URL and
credentials were never printed or committed. The readiness check found seven
applied migration rows matching all seven expected files and hashes; no
migration was run for this acceptance.

Read-only counts observed while the host jobs continued to refresh health:

| Projection | Count |
| --- | ---: |
| ERC-8004 identities | 2,080 |
| Agents | 2,080 |
| Published listings | 25 |
| Agent versions | 39 |
| 1536-dimensional vectors | 29 |
| Service observations | 698 |
| Service probes | 13,925 |
| Healthy service probes | 12,929 |

All observed identities are chain `97` and use the standards-lock registry
`0x8004a818bfb912233c491871b3d84c89a494bd9e`. Published category supply at the
snapshot was:

| Category | Published agent IDs |
| --- | --- |
| Rebalancing | 2 (`1825`, `2095`) |
| Grid trading | 3 (`1826`, `2159`, `2096`) |
| Yield optimisation | 2 (`2098`, `1827`) |
| Health factor | 2 (`2097`, `1828`) |
| Uncategorized | 16 (not counted as category coverage) |

Thus each listed tuple is exactly
`eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:<agentId>`.
Representative full tuples used in the API/detail checks were:

```text
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1825  (rebalancing)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1826  (grid-trading)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1827  (yield-optimisation)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:1828  (health-factor)
eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097  (manual-import health-factor detail)
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

They run from the retained `main` checkout, not this unmerged branch. At
`2026-09-06T14:43Z`, the health log contained 532 completed JSON records; its
latest record reports `25` agents, `25` services, `25` healthy, `0` unhealthy.
The discovery log contained 126 bounded records; its latest record reports
`20` candidates, `20` completed, `0` failed, `budgetExpired=false`, and
finalized registry reads. Top-level discovery status is `degraded` because
the candidates that fail capability/service gates remain withheld; this is not
a fabricated success.

The existing discovery crontab explicitly enables a development semantic
canary. That is retained-host development evidence only. Before preview or
production installation, use the accepted immutable checkout, load its runtime
environment, and set `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false` unless the
standards lock has separately acquired release evidence.

The host is EC2 with private interface `172.31.18.215`; IMDSv2 returned
`200` for public IPv4 and public hostname metadata. The tested web process was
local `*:3103`, while PostgreSQL listens on loopback (`127.0.0.1:55432`). No
reverse proxy, tunnel, HTTPS listener, certificate, DNS route, repository
deployment target, or approved remote API/private-network bridge is configured.
Self-probes to the instance public-IP ports `80`, `443`, and `3103` failed.
PostgreSQL must remain private.

## API/SSR acceptance

The immutable build was started locally with the retained environment supplied
by reference and these non-secret safety overrides:

```text
PORT=3103
APP_URL=http://127.0.0.1:3103
MARKETPLACE_API_URL=http://127.0.0.1:3103/api
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false
ERC8004_INGESTION_ENABLED=false
ERC8004SCAN_DISCOVERY_ENABLED=false
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
GET /api/marketplace/b8x-health-factor-agent           200, real identity 2097/health/metrics
GET /marketplace                                      200, live rendered listing HTML
GET /marketplace/{all four categories}                200, live rendered listing HTML
GET /agents/b8x-health-factor-agent                   200, real identity 2097/detail HTML
GET /compare                                          200, rendered compare page
```

The checked-in verifier passed:

```text
BNBERA_MARKETPLACE_API_URL=http://127.0.0.1:3103/api/marketplace \
  node scripts/verify-marketplace-api.mjs
# ok=true, readStatus=degraded, dataMode=degraded, itemCount=12, total=25
```

The verifier after the controlled web-process restart again observed `25`
published records and detail identity
`eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097`. This is a live
retained projection, not a fixture.

The HTTP/SSR probe found no application/HTML error signal and confirmed the
locked identity, service URL, endpoint health timestamp, observed uptime and
explicit `unavailable` reviews/completed-jobs/result fields. No deployed-browser
check was run because no stable HTTPS URL exists; browser evidence remains
pending the owner-supplied route.

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
  `retrievalMode=deterministic` and remains useful. Explicit development
  canary mode returned hybrid retrieval; with the candidate lock's
  `releaseEnabled=false` and canary disabled, semantic enablement returned
  HTTP 503 with `MARKETPLACE_CONFIGURATION_INVALID` rather than serving an
  unsafe preview. Marketplace hybrid tests cover no-compatible-embedding and
  mixed model-version fallback paths.

## Honest gaps and owner request

- **Single owner input required:** authorize/provide one stable HTTPS origin
  with an approved routing path to this host's web process (domain,
  certificate, and ingress authority as one topology input). PostgreSQL must
  remain private. Once that route exists, build/start this SHA, reinstall only
  the BNBEra cron entries from this immutable checkout with semantic release
  disabled, and rerun the deployed browser/API checks. No other T3
  credential, domain, or infrastructure request is made here.

The standards lock remains candidate/canary-only, so deterministic fallback is
the only preview-safe semantic mode. The installed cron still points at
`/home/ubuntu/bnbera-w0-w1` and explicitly enables a development canary; this
is retained-host evidence and is not a release claim. Published category
counts are truthful but small; 2,075 indexed identities were withheld for
incomplete marketplace metadata/capability/service/health evidence, and
uncategorized listings are not category coverage. External reviews,
verified-purchase reviews, completed BNBEra jobs/results, and current
financial observations remain unavailable; activation is disabled. ERC-8183
paid hire, Altana/Creator, and Greenfield remain disabled and unaccepted.

Rollback is application-only: stop the preview process and/or remove only the
two installed BNBEra cron lines, then restore the prior application artifact.
Do not reset, delete, or roll back retained PostgreSQL history.
