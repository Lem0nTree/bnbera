# T7 pre-acceptance evidence — 2026-09-05

Status: **partial / blocked; not final MVP acceptance**.

This report records the bounded QA checks run from `/home/ubuntu/bnbera-mvp-t7-pre` on `codex/mvp-preacceptance` at base `3c023858e40beb3c8fde724b463c44ab5207eb69`. It does not claim continuous synchronization, qualifying live supply, pipeline completion, four live categories, deployment, or any optional feature gate.

## Scope and documentation gate

- Assignment: T7 pre-acceptance QA, QA + Deployment + Submission vertical, W0 onward.
- Risk: R1 flow validation; R2 deployment review.
- Required reads: `/home/ubuntu/bnbera-w0-w1/AGENTS.md`, `docs/04-bnbera-master-implementation-plan.md`, `docs/05-subagent-delivery-plan.md`, `docs/07-mvp-live-marketplace-task-plan.md`, `config/standards.lock.json`, `docs/01-marketplace-donor-merge-plan.md`, and accepted `docs/adr/0003-wave1-legacy-migration-repair.md`.
- Consumed interfaces read in full: `packages/domain/src/identity.ts`, `packages/domain/src/states.ts`, `packages/domain/src/services.ts`, `packages/agent-ingestion/src/types.ts`, `packages/marketplace/src/types.ts`, `packages/marketplace/src/source.ts`, `packages/marketplace/src/read-model.ts`, `packages/marketplace/src/eligibility.ts`, `packages/db/src/schema.ts`, `apps/web/src/lib/marketplace-contract.ts`, and `apps/web/src/lib/marketplace-server.ts`.
- Additional context read: `docs/06-erc8004-pipeline-integration-plan.md`, `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`, and proposed `docs/adr/0001-altana-studio-custody-bootstrap.md` (not accepted).
- Core Marketplace and QA + Deployment + Submission are the applicable gates. Activation + Commerce, Creator + Altana, Evidence Publication, semantic retrieval, and continuous synchronization remain disabled.
- Unresolved lock entries include candidate lock status, Studio runtime integrity, ERC-8183 addresses/policy, B402 facilitator/settlement, Greenfield SDK/provider, Altana addresses, and the chain-56/chain-97 main-track decision. No unresolved entry was enabled.

## Baseline and retained-data observation

The coordinator reports T2 composition at `a51bf2c`; that commit is **not in this checkout** and was not cherry-picked. The coordinator's bounded run against the shared retained database reported 4 candidates, 4 exact registry reads, 4 metadata resolutions, 0 failures, and all 4 withheld for `CAPABILITY_INVALID`/missing capability and `SERVICE_MISSING`; registry reads remain provisional.

Read-only SQL against the retained `bnbera_erc8004` database confirmed:

```text
pgvector=0.8.6
identities=4
agents=4
versions=0
capabilities=0
published=0
live=0
```

The retained database was not modified by this QA lane. The temporary `bnbera_t7_qa` database used for an isolated migration attempt was dropped after the attempt; no retained data was removed.

## Commands and results

| Command | Result | Evidence level / limitation |
| --- | --- | --- |
| `pnpm check` on the untouched checkout | Blocked: dependencies were not installed (`tsc: not found`). | Environment setup failure, not a source result. |
| `pnpm install --frozen-lockfile` | Blocked by host `ENOSPC`. | Full install was not reproducible in this constrained host. |
| `pnpm install --frozen-lockfile --config.optional=false` | Completed. | Optional arm64 native packages were skipped; not production-equivalent. |
| Prerequisite package builds for domain/config/evidence/agent-ingestion/marketplace/db | Passed. | Local compile evidence only. |
| `pnpm test` | Passed: all package suites; 218 tests passed, with the UI package reporting no test files. | Automated unit/package evidence. |
| `pnpm exec vitest run --config tests/vitest.config.ts` | Passed: 5 files, 51 passed, 1 skipped. | The PostgreSQL integration test was skipped because no database URL was injected for that invocation. |
| `pnpm db:check` | Passed (`Everything's fine`). | Migration structure check, not a live migration. |
| `pnpm evidence:release-check` | Passed; 4 JSON and 23 PNG artifacts validated, 0 issues. | Validates existing offline artifacts; creates no new browser/live proof. |
| `sudo -n docker ps ...`; narrow `docker exec` pgvector/count SQL | Passed: container healthy, pgvector `0.8.6`, counts above. | Read-only retained-database observation. |
| `pnpm ops:standards-check` | Blocked: `BSC_MAINNET_RPC_URL` is required. | No chain standards readiness claim. |
| `pnpm --filter @bnbera/web build` | Blocked by host `ENOSPC` while Next downloaded arm64 SWC. | No production build or deployed preview evidence. |

No browser automation or production-like preview was produced in this lane. Existing browser screenshots remain historical artifacts and are not relabelled as current retained-data acceptance.

## Gate disposition

- **M1 local database-backed marketplace:** partial/blocked. Retained identities exist, but no version, capability-complete projection, published listing, or live runtime qualified for browse/detail acceptance.
- **M2 production-like public preview:** blocked. The production web build and reachable preview topology were not verified.
- **Core Marketplace:** not signed off. The code-level contracts preserve truthful empty/degraded and unavailable activation states, but current browser-to-API-to-database evidence is absent for the retained state.
- **QA + Deployment + Submission:** blocked pending a successful production build, database-backed API/browser run, and a T2-inclusive integration SHA.
- **Optional gates:** remain disabled; no payment, Creator/Altana, Greenfield, semantic, synchronization, signing, or onchain-write claim is made.

## Disable and rollback

Keep `ERC8004_INGESTION_ENABLED=false`, `ERC8004SCAN_DISCOVERY_ENABLED=false`, and `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false` until their independent evidence gates pass. No application or database rollback is required for this evidence-only change. If the report itself must be removed, revert the single documentation commit; preserve the retained database and historical evidence.
