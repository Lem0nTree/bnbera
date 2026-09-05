# MVP A-OPS-QA T1 handoff

**Task:** T1 — reuse and verify Docker DB plus web startup
**Owner:** A-OPS-QA
**Checkout:** `/home/ubuntu/bnbera-mvp-t1`
**Branch:** `codex/mvp-db-startup`
**Base:** `0333528c93e78d09279ba5b1a0db8672515212d9`
**Observation time:** 2026-09-05T01:04:14Z (UTC)

## Documentation and gate evidence

The T1 documentation gate was completed before edits. The full-read paths
were `/home/ubuntu/bnbera-mvp-t1/AGENTS.md`,
`docs/04-bnbera-master-implementation-plan.md`,
`docs/05-subagent-delivery-plan.md`, `config/standards.lock.json`,
`docs/01-marketplace-donor-merge-plan.md`,
`docs/06-erc8004-pipeline-integration-plan.md`,
`docs/07-mvp-live-marketplace-task-plan.md`,
`docs/03-no-code-agent-deployer-plan.md`,
`docs/adr/0003-wave1-legacy-migration-repair.md`,
`docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`, and
`docs/release-evidence/README.md`. Consumed interfaces were
`packages/db/src/schema.ts`, `packages/db/src/client.ts`,
`packages/db/src/migrate.ts`, `packages/config/src/runtime.ts`,
`apps/web/src/lib/marketplace-server.ts`,
`apps/web/src/lib/marketplace-contract.ts`, `apps/web/next.config.mjs`,
`apps/web/package.json`, `package.json`, and `.env.example`.

The assignment is T1 in the W1 QA + Deployment + Submission vertical,
A-OPS-QA, risk R1 for runtime/stateful verification. The core Marketplace
gate is enabled in semantic-off mode. `ERC8004_INGESTION_ENABLED`,
`ERC8004SCAN_DISCOVERY_ENABLED`, and
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` remain false. Creator/Altana,
commerce, evidence publication, Greenfield/IPFS, and unresolved standards-lock
rails remain disabled. No schema or migration change was allocated to T1.

## Retained DB observation

The existing `bnbera_erc8004_pgvector` container was inspected narrowly and
not stopped, recreated, migrated, or cleaned. It was healthy and published
its development port on loopback. An in-container read-only query reported
pgvector `0.8.6`.

The Drizzle journal contained four rows. The four journal hashes matched the
SHA-256 digests of the four checked-in SQL migration files. Read-only counts
were:

| Surface | Count |
| --- | ---: |
| `erc8004_identities` | 4 |
| `agents` | 4 |
| `agent_discovery_sources` | 4 |
| `scan_discovery_checkpoints` | 1 |
| `agent_versions` | 0 |
| `agent_capability_observations` | 0 |
| `agent_service_observations` | 0 |
| `agent_service_probe_results` | 0 |
| `agent_services` | 0 |
| `agent_health_snapshots` | 0 |
| `agent_listing_embeddings` | 0 |
| `agent_category_predictions` | 0 |
| `agent_enrichment_observations` | 0 |
| `erc8004_chain_observations` | 0 |

The retained state therefore explains an empty live marketplace projection:
identities and agent shells exist, but no immutable public versions or
capability/service/health evidence exists to form eligible listings. This is
not permission to switch to fixture mode.

Container-network Node access using an injected, credential-free local
connection URL succeeded for `current_database` and `current_user`. A host
TCP connection was not claimed because the operator's local role password was
not available through the approved secret channel. No credential value was
recorded in the shell output, runbook, or handoff.

## Runtime work and evidence level

Added:

- `scripts/marketplace-readiness.ts`: read-only bounded DB/API readiness
  contract, migration hash alignment, sanitized counts, semantic-off gate
  checks, and empty/degraded reason codes.
- `scripts/run-with-repo-env.mjs`: root `.env`/injected-environment wrapper
  for both root scripts and `apps/web`; `--check` reports presence only.
- `docs/operations/mvp-core-marketplace-runbook.md`: exact setup, startup,
  stop, readiness, diagnosis, failure-code, and rollback instructions.

Evidence level is **retained-live DB read + deterministic local web/API
diagnostics + headless browser smoke**. With the approved environment loaded,
`next dev --webpack` served the existing application successfully. The
readiness probe returned exit `0`, HTTP `200`, contract
`bnbera.marketplace-read/v0.1`, response status/mode `degraded`, zero records,
`meta.fixtureCount: 0`, and `meta.retrievalMode: deterministic`. The DB-backed
routes `/marketplace`, all four category paths, `/agents/missing-agent`,
`/compare`, `/api/marketplace`, and `/api/marketplace/missing-agent` each
returned HTTP `200`. A local Chromium `--dump-dom` smoke observed the
marketplace heading, degraded-preview label, zero-eligible state, contract
label, and honest incomplete-metadata warning. The browser MCP/agent-browser
path was unavailable because its managed Chrome binary was not installed; the
Chromium fallback emitted only host AppArmor/DBus warnings.

The webpack command is a local compatibility workaround for this constrained
checkout's dependency symlink layout; the canonical runbook command remains
the package `dev` script. No browser preview, public deployment, semantic
retrieval, ingestion, payment, custody, or chain-write claim is made.

## Flags, limitations, and rollback

The required core flags are `MARKETPLACE_DATA_MODE=live`,
`DATABASE_SSL=false`, and all three optional pipeline/semantic flags false.
The local API must report the existing
`bnbera.marketplace-read/v0.1` contract, deterministic retrieval, and zero
fixture records. If the DB remains at the observed counts, the expected
readiness result is `empty` while the API truthfully reports `degraded`, with
explicit reason codes. The unresolved standards locks remain: embedding
provider/model/version/dimension, chain 56/97 track choice and registry
finality/reorg replay, ERC-8183 addresses/policy, B402, Greenfield/IPFS
provider, Altana/Agent Studio, and production runtime integrity/preview.

Do not delete or recreate the retained container/volume. To roll back the
task-owned runtime diagnostics, stop the local web process, restore the prior
environment values, and revert this task commit. The diagnostic scripts do not
write to PostgreSQL. Destructive migration/transaction tests belong on an
explicit disposable pgvector database only.
