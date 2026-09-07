# MVP runbook

Scope: existing commands at `31d112f` plus the T1 persistent operational layer. A one-shot run is still not a completed G1 acceptance.

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

The cron wrappers inherit `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` from the
runtime environment. They do not force semantic work off. The ingestion and
web entry points validate `config/standards.lock.json` before enabling it. The
current lock is canary-only (`releaseEnabled=false`), so a local development
canary must opt into both gates:

```bash
ERC8004_INGESTION_ENABLED=true ERC8004SCAN_DISCOVERY_ENABLED=true \
MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=true MARKETPLACE_SEMANTIC_CANARY_ENABLED=true \
node scripts/run-with-repo-env.mjs -- pnpm ops:erc8004-marketplace
```

Do not set those canary flags in preview/production. Until separately
reviewed release evidence changes the standards lock, those environments
must keep semantic retrieval disabled and use deterministic fallback ranking.

The optional 8004scan semantic candidate fan-out is disabled by default with
`ERC8004SCAN_SEMANTIC_DISCOVERY_ENABLED=false`. It is not required for
vectorization: ordinary scan candidates still run through enrichment,
category classification, publication and (when the semantic canary/release
gate is enabled) embedding generation. Keep the fan-out disabled for the MVP
cron so four slow provider searches cannot consume the bounded composition
budget; enable it only for an explicitly bounded development run.

For existing current versions, run the bounded v3 category reclassification
command in explicit development/maintenance windows:

```bash
ERC8004_INGESTION_ENABLED=true ERC8004_CATEGORY_BACKFILL_ENABLED=true \
ERC8004_CATEGORY_BACKFILL_MAX_CANDIDATES=20 \
node scripts/run-with-repo-env.mjs -- pnpm ops:erc8004-category-backfill
```

The command uses the persisted public registration/capability/service-card
evidence, records all evidence-backed applicable categories, and is safe to
replay. Continue from the emitted `nextAfterAgentVersionId` with
`ERC8004_CATEGORY_BACKFILL_AFTER_VERSION`; never reset or delete the retained
history.

## T5 browser commerce — EOA canary

The T5 buyer path does not require an Altana smart wallet, passkey or Altana
session. Configure wagmi with its `walletConnect` connector as the only wallet
connector, using public `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. WalletConnect
may reach compatible extension wallets in a desktop browser and mobile wallets
through QR/deep links; availability varies, so not every extension is
guaranteed. Do not add `injected()` or a MetaMask-specific connector. The
connector must resolve to one normalized buyer EOA and one SIWE session bound to
BSC testnet (chain 97). Do not put the project ID in
`config/standards.lock.json`, a server secret store or any application secret
reference. No supplied project ID belongs in this runbook.

Start the existing web process as shown above. For the canary, verify the
connector reports chain 97 before requesting a quote, and have the buyer
explicitly sign each transaction. The server creates the quote and persists a
public operation intent; the browser wallet signs the following sequential
APEX/ERC-8183 calls:

1. `createJob` with the server-quoted client/provider/evaluator/hook, task,
   deadline and bounded budget. Wait for the confirmed receipt, decode the
   `JobCreated` event and persist its actual protocol job ID.
2. Call the pinned Router `registerJob` for that exact job ID and policy; verify
   `JobRegistered`.
3. Call Commerce `setBudget` for the exact quoted atomic U amount.
4. Send an exact, bounded ERC-20 `approve` to the pinned spender required by
   the reviewed APEX path. Never request an unlimited allowance.
5. Call Commerce `fund` for the same job ID and amount; verify `JobFunded` and
   the `FUNDED` read state.

Persist each step before sending and after confirmation with connector, EOA,
chain, contract, operation kind, request digest, transaction hash, block,
receipt status and operation-specific event evidence. A generic successful
receipt, quote or nonce does not establish the job ID or a funded job. After
the provider performs useful work, retain the existing provider submission
boundary (the provider may use `@altananetwork/sdk@0.9.0` and its own Altana
execution authority), verify the result digest/manifest and `JobSubmitted`,
then let the buyer EOA explicitly settle/approve or dispute. Only after the
pinned protocol expiry may the buyer EOA claim a refund; reconcile `JobExpired`
and `Refunded`.

On page reload, resume from the persisted operation step and receipt. On an
account or chain change, pause the job, reject silent rebinding, require a new
chain-97 SIWE session and obtain a fresh server quote before continuing. On a
wallet/RPC timeout or unknown response, use the persisted operation ID,
transaction hash, nonce and job/event reads to reconcile first; mark the step
confirmed, reverted or unknown before any retry. Never blindly rebroadcast a
possibly funded or settled step, and never auto-approve or auto-settle for the
buyer.

This is an authorized development canary only. Preserve the completed 2206
quick-tunnel card/invocation, finalized reingestion and publication evidence;
the tunnel has no uptime guarantee. Keep `releaseEnabled=false` until the full
EOA browser journey, useful result, settlement/review and recovery evidence
passes. Do not wholesale-revert the recent T5 passkey changes, reset
migrations or delete retained database evidence; passkey/bootstrap work is
deferred to T6/T7 Creator custody.

## Target cron behavior — implemented by T1

| Job | Cadence | Behavior |
| --- | --- | --- |
| Discovery/enrichment | Every five minutes | Separate process lock; resume provider cursor and due retries; bounded registry/metadata/category/vector/publication work |
| Published-service health | Every minute | Separate lock/budget; refresh service observations without running vendor discovery or regenerating unchanged profiles |

Use host cron and ordinary `flock` process locks. The wrappers are [discovery.sh](../ops/marketplace-cron/discovery.sh), [health.sh](../ops/marketplace-cron/health.sh), and the reference [crontab](../ops/marketplace-cron/bnbera-marketplace.crontab). Discovery and health have independent lock files and timeouts; a provider timeout cannot hold the health lock. Progress is persisted in `scan_discovery_checkpoints` plus `marketplace_discovery_cursors`, and per-identity backoff/failure codes are in `marketplace_ingestion_retries`. Health rotates its persisted batch offset so a `maxAgents` bound does not permanently favor the oldest page. No broker or extra service is needed.

Apply the forward migration once, after the retained database has been backed up and on a disposable copy first:

```bash
node scripts/run-with-repo-env.mjs -- pnpm db:migrate
```

Install the two entries without replacing unrelated user cron jobs. This command removes only prior BNBEra wrapper lines, then installs the accepted checkout's absolute paths:

```bash
REPO_ROOT=/home/ubuntu/bnbera-w0-w1
CRON_DIR="$REPO_ROOT/ops/marketplace-cron"
(crontab -l 2>/dev/null | awk -v d="$CRON_DIR" 'index($0,d "/discovery.sh")==0 && index($0,d "/health.sh")==0'; \
  printf '%s\n' "*/5 * * * * $CRON_DIR/discovery.sh" "* * * * * $CRON_DIR/health.sh") | crontab -
```

The wrappers create `.runtime/marketplace/{locks,logs}` (ignored by Git), load the root `.env` through `run-with-repo-env.mjs`, and log only bounded JSON status/reason codes. Discovery defaults to an end-to-end 180-second budget (`ERC8004_MARKETPLACE_MAX_RUN_MS`, bounded below the wrapper's 240-second timeout); on expiry it aborts provider work, preserves the last committed page/cursor, and records retry outcomes for completed composition candidates before exit. Test each job immediately with `"$CRON_DIR/discovery.sh"` and `"$CRON_DIR/health.sh"`; inspect status with `crontab -l`, `pgrep -af 'marketplace-(health|ingestion)'`, and `tail -n 40 "$REPO_ROOT/.runtime/marketplace/logs/health.log"`. Stop future invocations by removing only these two lines with the same `awk` filter and `crontab -`; an already-running process exits at its wrapper timeout. For recovery, preserve the DB, inspect the last safe error code/cursor, repair configuration or provider access, and rerun the affected wrapper. Do not delete cursors, retries, versions, or observations.

Health observations expire from browse projections after two minutes, with real timestamps and immediate pre-action checks. T3 verifies expiry and recovery through the public API/UI.

## Verification and rollback

Run focused package tests plus real DB/API/browser checks for changed behavior. `pnpm evidence:release-check` checks historical artifacts, not current gate completion. Never run synthetic cleanup or migration failure tests against the retained data; use an explicitly disposable DB. Back up retained data before any migration and preserve existing fresh/legacy forward-repair behavior.

For public deployment, build/start an immutable artifact from the accepted SHA and use authorized HTTPS API or private DB networking; a remote Vercel process cannot reach this host's loopback DB. Keep server credentials out of browser bundles.

Disable vendor discovery with `ERC8004SCAN_DISCOVERY_ENABLED=false`, direct events with `ERC8004_DIRECT_REGISTRY_SYNC_ENABLED=false`, and semantic operations with `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`. Disabling `ERC8004_INGESTION_ENABLED` stops the ingestion path. Stop the specific installed cron entries/worker processes; preserve the DB, cursors, versions and evidence. Expired health remains stale until a real successful check occurs. Roll back application artifacts, not retained history. Paid/Creator/Greenfield disable procedures are supplied with T4/T6/T8.
