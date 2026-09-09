# MVP runbook

Scope: existing commands at `31d112f` plus the T1 persistent operational layer. A one-shot run is still not a completed G1 acceptance.

For the current `bnbera-ui-light` preview, protocol refresh and the bounded testnet reference commerce lifecycle, use [the protocol/commerce operations addendum](PROTOCOL-COMMERCE-REVIEW.md). Its three permanent task reservations, supervised worker/readiness and mainnet release limitations are authoritative for that preview; the retained older commands below do not grant additional transaction authority. Two reservations remain after completed acceptance job 1177. Check live capacity before use: admission automatically closes for a stale/unhealthy worker or exhausted allowance. Stop signing with `systemctl --user disable --now bnbera-reference-provider.service`; never reset allowance rows to restore capacity.

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
migrations or delete retained database evidence; the passkey/bootstrap work
supports the completed T6/T7 Creator custody path and remains separate from G2.

## G3 Creator browser/Studio trial

The active documented G3/T6/T7 scope is complete. The Studio trial is
temporary, and this result does not claim G2 WalletConnect browser acceptance.
The Creator form accepts only the audited tBNB→CAKE and tBNB→BUSD pairs, plus
bounded amount, slippage, quote-freshness and deadline values. Chain, router,
token addresses, selectors and caps remain server-locked. Verify that the
persisted public configuration, canonical digest, exact job binding, compiled
Studio configuration and runtime action all describe the same selected pair.

The Studio 0.0.13 trial agent is
`01M212RS9NVG13X6JQM5BS00AF`. Verify its public card without exposing managed
OAuth or Altana material:

Managed Studio uses the contextual `toolchain.agentStudioAltanaSdk`
`@altananetwork/sdk@0.7.1` integrity pin; the app/browser/provider boundary
continues to use `toolchain.altanaSdk` `@altananetwork/sdk@0.9.0`. The Studio
template must not consume the 0.7.1 SDK registry's obsolete policy address: it
uses the standards-locked local ERC-8183 ABI reads, local submit encoding and
Router policy allowlisting instead.

```bash
CREATOR_ENDPOINT='https://bnbagent-api.bnbchain.world/v1/rt/01M212RS9NVG13X6JQM5BS00AF/.well-known/agent-card.json'
curl --fail --show-error --silent --include "$CREATOR_ENDPOINT"
```

The trial card returned HTTP 200 with healthy A2A protocol `0.3`. The browser
tBNB→BUSD configuration used exact digest `5f2fe561...f93e`; ERC-8004 identity
`2283` on chain 97/registry `0x8004...bd9e` reached `registered` after exact
reconciliation, with owner and agentWallet `0x8fe691...1b0be`. Mint transaction
`0x2ef91e...ef939` and URI transaction `0xb54693...b7439` are the public
operation references.
When invoking the runtime, use the canonical A2A `message/send` JSON-RPC
envelope with the exact inner action/job binding and the managed OAuth
credential loaded from its secret reference. Do not send a raw action body, log
the bearer token, or persist a raw session.

Browser/trial reconciliation evidence:

- Browser grant used wallet `0x1a295...d370`, grant `0xdb9118...20e9e` and revoke `0xdcfa54...5d911`; persisted status is `revoked`.
- A subsequent worker attempt was denied before Studio with `CREATOR_DEPLOYMENT_BINDING_MISSING`; the platform list remained unchanged at three existing agents including the final agent.
- The pipeline completed finalized chain read, metadata, capability, service health, version, publication and category; API live total is `1`, detail is healthy A2A `0.3`, category is `rebalancing`, and OpenRouter `text-embedding-3-small` persisted a 1536-dimensional vector.
- Existing explicit over-cap/expiry denial and managed action/settle/refund evidence remains valid. Keep any post-revoke unknown runtime outcome classified as unknown, never as an invented relay error.

Reconcile current chain/job state before any retry. Do not blindly retry the
unknown post-revoke action or settle/refund automatically. The active browser
Creator registration/grant/revoke and exact reconciliation path is complete for
G3/T6/T7; keep G2's separate WalletConnect browser gate and `releaseEnabled=false`
unchanged.

For the local Creator worker, use an absolute private workspace outside the
repository and load the root environment explicitly. Studio 0.0.13 also needs
Bun on `PATH`. Enable these switches only for the bounded G3 run:

```bash
export PATH="/home/ubuntu/.bun/bin:$PATH"
export T5_ALTANA_AUTH_ENABLED=true
export CREATOR_RUNTIME_AUTHORITY_ENABLED=true
export CREATOR_WORKER_ENABLED=true
export CREATOR_STUDIO_WORKSPACE_ROOT=/var/lib/bnbera/creator-studio
node scripts/run-with-repo-env.mjs -- pnpm ops:creator-worker
```

The generated workspace pins a unique Studio project slug and the confirmed
Altana wallet address, keeps `.studio/` out of the deploy artifact, and stores
the session only in the owner-only Studio secret file. The Studio trial is
temporary. Before a live deploy,
run `bag deploy prepare --provider bnb --project-root <generated-runtime-root>
--json --no-info --force`; proceed only with `ready_to_deploy: true` and zero
BLOCKED/CRITICAL checks.

## T8 Greenfield canary

The bounded testnet integration uses public-read bucket `bnbera-t8-230072625f8090d5271c5f882748ce11134ac2ba` (bucket ID `25041`) and the Greenfield runtime pinned in `standards.lock.json`. Keep `GREENFIELD_PUBLISHER_PRIVATE_KEY_REF` as an environment-variable name; never place the key value in arguments, logs or application data. Live operations additionally require the three explicit T8 enable/approval flags. `reconcile-bucket` is read-only and never broadcasts.

Prepare persisted inputs with `ops:t8-greenfield-inputs`: preview first, use exact `--write` only for the deterministic settled-job projection, then export profile/run rows into `.runtime/t8-greenfield-inputs` or `/tmp`. Publish with `scripts/t8-greenfield-publish.ts`; reuse the same deterministic idempotency keys and reconcile unknown outcomes before retrying. Current canary evidence is agent 2206/version 11 and settled commerce job `695c1be6-a6bb-4deb-b9b8-9eabd60b0ae7` (protocol job 1103).

Successful public readback SHA-256 values are `69e0294f83908f355a1a883c98768b52786a3f88439cf6f02fcd5b63e70279d8` for the profile and `12cba7d6a989d2603a525bb4965d84fe5bff4569f106a0ce3decb84d56e24446` for the run bundle. Greenfield returned an all-zero seal transaction field; the adapter normalizes it to unavailable and accepts sealing only from sealed object status plus matched readback/hash/size evidence. Historical evidence is shown only through exact agent/version/job joins and labeled as a historical snapshot.

Disable new publication with `T8_GREENFIELD_ENABLED=false` or `T8_GREENFIELD_LIVE_WRITE_ENABLED=false`. This does not delete the public bucket or objects and must not disable marketplace browsing or hiring.

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
<!-- Bounded provider continuation: operational source of truth is linked below. -->

The chain-97 reference provider's three-slot lifetime allowance, exact gas caps, systemd service, readiness, recovery and disable commands are documented in [PROTOCOL-COMMERCE-REVIEW.md](PROTOCOL-COMMERCE-REVIEW.md#three-slot-supervised-allowance-continuation). Never recycle its persisted slots or run the legacy signer to bypass admission.
