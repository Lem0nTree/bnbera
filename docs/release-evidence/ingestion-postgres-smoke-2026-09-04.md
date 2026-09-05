# PostgreSQL ingestion smoke — 2026-09-04

## Scope

- Workstream: W1 A11 QA, Marketplace Data + Web vertical.
- Feature gate: `ERC8004_INGESTION_ENABLED` / `ERC8004SCAN_DISCOVERY_ENABLED`.
- Risk tier: R1 — stateful PostgreSQL ingestion and migration verification.
- Checkout: `/home/ubuntu/bnbera-w0-w1`.
- Branch: `codex/erc8004-pipeline`.
- Base/head: `adfe8e1c52ca714cf6ba7f0171a90083b0f217aa` (no commit made; smoke changes remain working-tree changes).

The smoke uses a fresh random scope and a synthetic registry address on every
run. It only writes temporary local PostgreSQL rows, never calls an RPC,
wallet, signer, payment rail, deployment, or mainnet endpoint, and removes its
rows in a committed cleanup transaction. Database credentials are sourced
from the local environment and are not recorded here.

## Commands

```text
set -a; source .env; set +a; timeout 90s pnpm ops:ingestion-smoke
```

The command was run twice sequentially against the configured local
PostgreSQL/pgvector database. `DATABASE_URL`, usernames, passwords, and
connection-string query values were not printed.

## Results

| Run | Exit | Duration | Expected = actual | Rollback | Restart | Cleanup remaining rows |
|---:|---:|---:|:---:|:---:|:---:|---:|
| 1 | 0 | 316 ms | yes | pass | pass | 0 |
| 2 | 0 | 315 ms | yes | pass | pass | 0 |

Both JSON results reported these exact expected and actual counts:

```json
{
  "sourceCount": 2,
  "serviceCount": 1,
  "capabilityCount": 1,
  "observationCount": 1,
  "probeCount": 1,
  "claimEventCount": 1,
  "registryReplayDuplicateCount": 1,
  "promotedCount": 1,
  "checkpointVersion": 1
}
```

Both runs passed migration replay, transaction rollback with rows absent,
discovery replay idempotency, registry-event replay idempotency, persistence
through a fresh repository pool, and independent pending/unavailable/none/draft
state-axis assertions. Cleanup deleted one temporary agent, identity, and
checkpoint row per run and verified zero remaining identity, agent, source,
service, capability, observation, probe, claim-event, and checkpoint rows.

## Safety and limitations

- Each run applies bounded PostgreSQL `connection_timeout`, `query_timeout`,
  `statement_timeout`, `lock_timeout`, and idle-in-transaction timeouts, plus
  a 60-second smoke deadline. The external command adds a 90-second ceiling.
- The synthetic registry and event are persistence fixtures, not live
  ERC-8004 registry evidence. The healthy probe row is a stored smoke fixture,
  not a network health claim.
- Migration replay proves local migration repeatability only. It does not
  certify a production migration or any unresolved standards-lock contract.
- No semantic/vector query is performed by this ingestion-only smoke; pgvector
  extension availability is exercised indirectly by the migrated schema.
- Standards-lock status, BSC 56/97 track choice, ERC-8004 bytecode/ABI live
  verification, ERC-8183, B402, Greenfield, Altana, Creator, and all writes
  remain independently gated and disabled.

## Disable and rollback

Do not run this smoke against a production database. To disable the ingestion
path, keep `ERC8004_INGESTION_ENABLED` and `ERC8004SCAN_DISCOVERY_ENABLED`
false. A failed run reports only a sanitized code and attempts cleanup after a
successful migration; no migration rollback or destructive database command is
performed by this script. Revert the uncommitted smoke-script change through
the coordinator's normal working-tree review; do not reset or clean the shared
checkout.
