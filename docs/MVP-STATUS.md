# MVP status — T3/G1 acceptance

Updated: 2026-09-05T23:08:32Z  
Task: T3 / G1 marketplace acceptance  
Evidence source SHA: `5db33273f66672ca6fd2e3547345c3b7a719cd5e`  
Common base: `github/main` at `5db33273f66672ca6fd2e3547345c3b7a719cd5e`  
Checkout: `/home/ubuntu/bnbera-task-t3`, branch `task/t3-g1-acceptance`

## Gate result

**G1 is not accepted for retained data or a public preview.** The isolated
acceptance below proves the migration, read, retry/cursor, health-refresh,
API and browser behavior that can be exercised without mutating the retained
PostgreSQL. The user-directed retained-DB read-only constraint prevents the
required 30-minute retained cron run, retained refresh, and public deployment
claim. No public host was configured or verified in this run.

The demonstrated scope is one restored testnet marketplace identity. Four
category coverage is intentionally partial: `health-factor` has one qualified
identity; `rebalancing`, `grid-trading`, and `yield-optimisation` have zero
qualified identities in the restored snapshot. The remaining 24 identities are
`uncategorized`; they are not counted as category supply.

## Evidence and results

### Retained database safety

- Existing PostgreSQL topology was inspected read-only: retained container
  `bnbera_erc8004_pgvector`, PostgreSQL 16, loopback port `55432`, retained
  Docker volume preserved. No volume reset or recreation was performed.
- A recoverable custom-format backup was created before acceptance work:
  `.runtime/t3-backups/retained-20260905T2245Z.dump`, 180,536 bytes,
  SHA-256 `095156d51cc5e6274942847c0c563e196c23b0133bc693a0ba93e850a9b51465`.
- Before the urgent read-only constraint was received, the following command
  was started once and immediately interrupted: `pnpm db:migrate` through
  `scripts/run-with-repo-env.mjs` with the root environment. It was already at
  migrations 0000–0004. A read-only post-check found the migration journal,
  required tables, and counts unchanged; no pending migration was applied.
  There were no subsequent retained ingestion, health, retry, cursor, cleanup,
  or schema writes. This attempted command is disclosed so the safety boundary
  is auditable; observed retained effect: **none**.
- All stateful acceptance commands after that point used an independent
  disposable PostgreSQL container and volume. The retained volume remains
  untouched.

### Disposable migration, restore and persistence checks

- Independent container: `bnbera-t3-disposable-pg`, pgvector image, tmpfs data
  directory, loopback port `55433`; it is not connected to the retained Docker
  volume. The container was kept for coordinator review.
- Fresh migration `0000` through `0004`: **PASS**. The journal contains five
  rows, 45 public tables exist, and the pgvector extension is available.
- Legacy forward-repair/restart smoke: **PASS** —
  `{"ok":true,"freshInstall":true,"restartNoOp":true,"adr0003LegacyRepair":true,"disposableDatabase":true}`.
- The retained dump was restored into a second database inside this independent
  container. Restore compatibility required filtering the PostgreSQL 18
  `SET transaction_timeout = 0` line from the local dump stream before loading
  into PostgreSQL 16. Restored counts matched the retained pre-check: 25
  identities, 25 agents, 2 versions, 2 embeddings, and 5 historical service
  probes. The restore database is disposable and isolated.
- A repeated migration check and web-process stop/start preserved the restored
  read model. No identity or version churn was observed.

### Discovery, finalized read, retries and cursor

The bounded real 8004scan run used finalized registry reads and one page of five
candidates on chain 97. It returned `status=degraded` because the bounded
120-second budget expired while semantic discovery was still running; the
checkpoint was committed at one page/five candidates, with `cursorVersion=1`.
The run persisted five identities, five discovery-source records, five retry
rows, five agents and two cursors. The cursor advanced to offset 5 of a
reported total 2132; no scan reset was performed. Every timed-out candidate had
`RUN_CANCELLED` recorded as its retry reason.

The persisted retry rows were made due in the disposable database and a
separate replay scope was run with discovery disabled. One candidate reached
chain read and metadata resolution, but was withheld because capability,
service, category-version and/or version requirements were not complete. No
unsupported capability or publication was fabricated.

The accepted identity tuple in the restored snapshot is:

`(namespace=eip155, chainId=97, identityRegistry=0x8004a818bfb912233c491871b3d84c89a494bd9e, agentId=2097)`

Its finalized identity observation is block `129281901`, and its current
version is 2. The public metadata names it **B8X Health Factor Agent**. It has
one A2A service and one persisted 1536-dimensional listing embedding. The
other 24 restored identities have no current version/vector and remain
unpublished.

### Health expiry and recovery

- Immediately after restore, the last recorded successful probe was
  `2026-09-05T15:49:29.586Z`; the isolated API therefore excluded the listing
  as stale/unhealthy.
- Running the documented health job against the restored database only returned
  `{"status":"completed","agents":1,"services":1,"healthy":1,"unhealthy":0,"skipped":0}`.
- The resulting health snapshot at `2026-09-05T22:56:22.271Z` was healthy,
  HTTP 200, latency 300 ms. The API then showed one eligible listing with
  observed uptime `1/1`; it did not imply continuous coverage beyond that one
  attempted check. This demonstrates isolated stale expiry and recovery.

### API and browser

With `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`, the live API against the
restored disposable database returned a degraded but usable read model with
deterministic retrieval, one listing, explicit source/timestamp metadata, and
24 withheld identities. The following routes were checked with direct
Playwright browser automation against the webpack development server:

- `/marketplace` — HTTP 200, meaningful listing/filter UI, no Next error overlay;
- `/marketplace/health-factor` — HTTP 200, qualified listing present;
- `/agents/b8x-health-factor-agent` — HTTP 200, detail and service data present;
- `/compare?agents=b8x-health-factor-agent` — HTTP 200, comparison UI present;
- `/marketplace?q=health` — HTTP 200, matching listing present.

The requested `agent-browser` executable is not installed in this checkout, so
Playwright was used as the browser fallback. Development-only diagnostics
included one likely favicon 404 and one hydration attribute mismatch; no
production browser overlay appeared, and these diagnostics did not change the
read results. This is not a public-preview verification.

### Semantic lock and fallback

- Deterministic fallback is **PASS** with the lock release gate left disabled;
  API metadata reported deterministic retrieval and `semanticModelVersion=null`.
- The runtime lock validator itself accepted the explicitly enabled development
  canary as `mode=development-canary`, `releaseEnabled=false`,
  `verificationStatus=verified-live-read-only-canary`.
- The actual semantic-canary API is **BLOCKED** by a source defect in
  `apps/web/src/lib/marketplace-server.ts:697`: reading
  `../../../../config/standards.lock.json` from the Next runtime resolves
  outside the checkout and is surfaced as `MARKETPLACE_CONFIGURATION_INVALID`.
  The standards lock was not changed, and semantic release was not enabled.
  This is a substantive source fix requiring coordinator authorization before
  editing outside the T3 evidence paths.

## Build and focused checks

- `pnpm db:check`: **PASS**.
- `pnpm --filter @bnbera/agent-ingestion test`: **PASS**, 16 files / 102 tests.
- `pnpm --filter @bnbera/marketplace test`: **PASS**, 3 files / 32 tests.
- `pnpm --filter @bnbera/web test`: **PASS**, 2 files / 7 tests.
- `pnpm --filter @bnbera/web exec next build --webpack`: **PASS** with only
  baseline-browser-mapping and Autoprefixer warnings. The default Turbopack
  build was not usable in this workspace because Next inferred a workspace
  root through the `/dev/shm` package symlink and could not resolve its own
  package; the webpack build is the verified production build.

## Missing prerequisites and rollback

- Retained-data 30-minute cron/restart proof: **blocked by explicit read-only
  constraint**. Owner: coordinator/user must authorize a separately backed-up
  retained run, if still desired.
- Public HTTPS preview/deployed SHA: **not configured or verified**. Owner:
  release/coordinator; no DNS, deploy, or PostgreSQL exposure was attempted.
- Semantic development canary: **blocked** by the source path defect above;
  semantic release remains disabled by `config/standards.lock.json`.
- Four-category supply: exact missing qualified categories are rebalancing,
  grid-trading, and yield-optimisation; no substitute identities were assigned.
- Rollback/disable flags from the runbook: set
  `ERC8004SCAN_DISCOVERY_ENABLED=false`,
  `ERC8004_DIRECT_REGISTRY_SYNC_ENABLED=false`,
  `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`, and, if necessary,
  `ERC8004_INGESTION_ENABLED=false`; stop only the installed marketplace cron
  wrappers. Preserve retained history, cursors, retries, versions and
  observations. The disposable acceptance container can be removed with
  `sudo -n docker rm -f bnbera-t3-disposable-pg`; this does not target the
  retained container or volume.

Changed path for this handoff: `docs/MVP-STATUS.md` only. No source, migration,
standards-lock, deployment, DNS, on-chain, or retained-data change was made.
