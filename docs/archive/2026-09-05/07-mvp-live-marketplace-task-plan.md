# MVP live marketplace: assignable task plan

Status: ready for assignment; implementation has not started under this plan.
Date: 2026-09-05.
Coordinator: A0. Capacity: A0 plus at most three active subagents.
Scope: finish W1 and the Marketplace Data + Web / QA + Deployment + Submission verticals.

## 1. Outcome and verified starting point

Deliver the existing frontend connected to retained, fetched ERC-8004 records in PostgreSQL, then verify the same journey through a production-like preview. Reuse the existing routes and components. No frontend rebuild, new database service, Creator implementation, or payment integration is required for this milestone.

Read the latest [daily handoff](release-evidence/2026-09-04-w0-w1-erc8004-handoff.md) before assigning tasks.

| Observation from this planning run | Value / implication |
| --- | --- |
| Checkout | `/home/ubuntu/bnbera-w0-w1` |
| Branch | `codex/erc8004-pipeline` |
| Planning base SHA | `948446121bf4c8546331d1109eded6847e375e2d` |
| Latest implementation SHA | `5b7a3c5e127234bdd5b28693eb7d8bfb33197ca5` |
| Working tree before planning | Only untracked `apps/web/.next/`; preserve it |
| Docker container | `bnbera_erc8004_pgvector`, currently running and healthy |
| Binding | `127.0.0.1:55432` to container port 5432 |
| Database / development role | `bnbera_erc8004` / `bnbera_local` |
| pgvector | `0.8.6`, confirmed by SQL |
| Retained row counts | 4 identities, 4 agents, **0 agent versions**; counts do not prove these rows are qualifying live supply |
| Existing scan command | Runs `Erc8004ScanJob`; does not compose the full enrichment and publication workflow |
| Existing read model | Requires presentation metadata and a valid capability observation; eligibility additionally checks publication, identity, runtime and health |
| Existing E2E artifact | 22 passed, 2 blocked, 1 skipped; `pipelineComplete: false` |
| Git remote observation | No upstream configured for this branch. `git ls-remote origin refs/heads/codex/erc8004-pipeline` returned no branch. The user reports a push; A0 must resolve the intended remote/ref and verify ancestry before remote-based assignments. Do not infer that another ref cannot contain the commit. |

The immediate missing link is:

`bounded discovery -> durable enrichment -> explicit version/publication service -> existing DB read model -> API -> browser`

Existing discovery, RPC, metadata, probes, classifier and read-model components should be composed and repaired where tests identify gaps. The successful rollback smoke must not be used as the preview data-population command.

## 2. Milestones and non-goals

### M1 — Working local database-backed marketplace

- Run the existing web application in `MARKETPLACE_DATA_MODE=live` against the existing Docker database.
- Persist at least one qualifying fetched or manually imported real identity through the complete workflow and demonstrate it in browse and detail. Target three qualifying agents for a useful real comparison; never fabricate supply to meet the target.
- Retain data across application/worker process restart. Re-importing the same content must not create duplicate identities or versions.
- All four category routes work. Unfilled categories show truthful empty states. A route existing does not prove live category coverage.
- Keep semantic retrieval, activation, commerce, Creator/Altana, evidence publication and all onchain writes disabled.
- Record limited synchronization/finality capabilities honestly. M1 is a controlled development milestone, not full ingestion or production release acceptance.

### M2 — Production-like public preview accepted

- Production build serves the same persisted dataset through a reachable preview URL with server-side credentials and no production fixture fallback.
- Complete the selected release ingestion/finality/reconciliation checks before enabling continuous release synchronization. M1 does not waive Plan 06's unfulfilled requirements.
- Browser/API/database evidence identifies exact source and deployed SHAs, environment, flags, identity tuples and observation times.
- The live comparison target is three qualifying records; if supply remains below this, record partial acceptance and retain the unresolved supply task. Do not report the target passed using fixture records.
- No unresolved P0/P1 defect in the included feature set. Excluded integrations remain visibly unavailable.

### Later optional gates

Activation + Commerce, Creator + Altana + Reference Agent, and Evidence Publication are separately assigned only after their prerequisites are available. Evidence Publication remains part of QA + Deployment + Submission in the four-vertical model; this plan does not invent a formal numbered W2.

Main-track four-category activation coverage and chain-56/97 eligibility remain separate submission gates. A working read-only preview is not a claim that all hackathon requirements are met.

## 3. Staffing and ownership

Use separate worktrees from A0's verified integration base. Proposed branch names below are new assignment names, not claims that branches already exist. A0 alone integrates and allocates migration filenames. No agent switches, commits, rebases or merges in another agent's checkout.

| Agent | Assignment branch | Owns | First tasks |
| --- | --- | --- | --- |
| A0 — coordinator | chosen integration branch | `config/standards.lock.json`, `packages/config/`, shared domain/contract changes, root manifests/lockfile, migration allocation, integration record | T0; contract freeze; reviews and merge order |
| A-DATA — ingestion | `codex/mvp-persistent-ingestion` | `packages/agent-ingestion/`, `scripts/erc8004scan-ingestion.ts`, new bounded enrichment/import scripts, ingestion unit tests | T2, then T5 |
| A-WEB — publication and existing web | `codex/mvp-live-publication-web` | `packages/marketplace/`, `apps/web/`, `packages/ui/`, publication unit tests | T3, then T4 |
| A-OPS-QA — runtime and acceptance | `codex/mvp-preview-qa` | `.github/workflows/`, `tests/integration/`, `tests/e2e/`, `tests/security/`, preview/readiness scripts and configuration, task-specific operational/evidence documents | T1 and T6 setup; then T7 |

Shared file rules:

- `packages/db/src/schema.ts` and migrations require A0 allocation; prefer existing schema. A0 implements or explicitly delegates each change to one owner.
- A0 owns changes to `packages/agent-ingestion/src/types.ts` and `packages/marketplace/src/types.ts` when they alter a cross-agent contract, even though their parent packages have feature owners.
- A-DATA owns `PgCategoryPredictionSink` repairs; A-WEB supplies real version IDs; A-OPS-QA owns its actual PostgreSQL integration test.
- A-DATA owns the new composition/import command and calls A-WEB's publication service explicitly. Do not introduce a package cycle from ingestion to marketplace; composition belongs in the script/application layer.
- A-OPS-QA reports feature defects to the owner rather than rewriting feature code. A0 independently reviews deployment/security acceptance because A-OPS-QA also prepares the runtime.
- Each agent writes only its own `docs/release-evidence/mvp-<agent>-handoff.md`. A0 owns shared status/index updates.

## 4. Task packets

### T0 — Freeze the baseline and minimum contracts

Owner: A0. Risk: R0 for planning; R1 for shared runtime/contracts. Starts immediately.

1. Resolve the remote/ref containing the user's latest pushed work. Verify the handoff and implementation ancestry, not just matching a branch-tip SHA. Record the actual integration base; do not branch agents from the older advertised `codex/platform-integration` without integrating the current work.
2. Preserve the existing checkout and Docker data. Give each agent its absolute worktree, base SHA, owned paths and task IDs.
3. Freeze a minimal enrichment-to-publication boundary using existing identity, service, capability, state and marketplace schemas. If the pipeline needs a new typed output/callback for sanitized resolved metadata and classification, define it once and merge it before consumers.
4. Define explicit ordering: persist observed identity/services/capabilities; create or reuse an immutable public version; attach classification to that real version; evaluate publication; update current version/state transactionally. No random version IDs or fixture metadata in the runtime path.
5. Separate acceptance of bounded deterministic ingestion from semantic retrieval. Update the contradictory Plan 06 gate wording through a reviewed plan/contract change; do not simply enable all flags.
6. Pin or record as unresolved the selected network's finality configuration; preserve provisional versus finalized observations. Keep unresolved entries disabled. Registry ABI/bytecode pins already exist and should be verified, not reinvented.
7. Record selected preview chain(s), secret-reference names, credential-rotation status, and the intended preview topology. Chain-97 development evidence cannot silently become a chain-56 submission claim.

Exit: integration SHA, path allocation, contract, flags and gate decisions are written down. T1 can start read-only inspection immediately; T2/T3 dependent changes start after the shared boundary is frozen.

### T1 — Reuse and verify Docker DB plus web startup

Owner: A-OPS-QA. Risk: R1 runtime verification; R2 if changing secret/deployment infrastructure. Dependency: T0 baseline.

1. Recheck the existing container and pgvector. Use narrow Docker commands; do not dump container environment or credentials.
2. Check migration journal, existing row counts and connection from the web process. Preserve the database and volume; never recreate it to clear an error.
3. Before an upgrade, preserve a backup and apply ADR 0003's fresh/legacy checks on disposable databases. Allocate migrations only if an actual gap is found.
4. Verify server-side environment loading for the root scripts and `apps/web`; merely having a root `.env` is not proof that both load it. Use injected environment/secret references without printing values.
5. Start the existing application against the DB with semantics off. Diagnose structured empty/degraded results; zero eligible rows is a data result, not a reason to switch to fixtures.
6. Write a core-only runbook with exact setup/start/stop/readiness commands, local URL, expected mode and sanitized failure codes. Reuse Node 22 / pnpm 10.15.1 and existing package scripts.

Existing non-destructive commands:

```bash
sudo -n docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo -n docker exec bnbera_erc8004_pgvector psql -U bnbera_local -d bnbera_erc8004 -Atqc "select extversion from pg_extension where extname = 'vector';"
pnpm db:check
pnpm --filter @bnbera/web dev
```

The final command requires the task's server environment first. `pnpm ops:ingestion-smoke` applies migrations and creates/cleans synthetic rows; run it only against its designated test target, not as a harmless health probe or supply importer.

Exit: DB connection and web mode confirmed, exact startup reproduced, baseline counts recorded, and no existing rows removed. A-WEB receives the local URL and read-only diagnostics.

### T2 — Compose durable discovery and enrichment

Owner: A-DATA. Risk: R1. Dependencies: T0 contract; T1 DB connection for retained runs. T3 publication service is needed for the final composition.

1. Keep the existing `Erc8004ScanJob` pagination, bounds, locks, retry/cancellation and checkpoint behavior.
2. Add a resumable composition command that enriches candidates through the existing `Erc8004Pipeline`, reviewed direct registry reader, bounded metadata resolver and safe service probes. Successful records must commit and remain readable after the process exits.
3. Support a small explicit identity-tuple import list via the existing manual-import boundary so vendor credential rotation/outage does not stop independent development. Manual import supplies an identity, not proof of ownership, health or capability.
4. Persist validated capability observations derived from supported registration/Agent Card/MCP contracts. Identify unsupported schema/adapter cases precisely; do not invent generic capabilities to satisfy the read model.
5. Call T3's explicit version/publication service from the composition layer. Wire the category sink to persisted version IDs and test its SQL against PostgreSQL, including the `createdAt` identifier quoting concern.
6. Emit sanitized counts and reason codes for discovered, chain-read, metadata-resolved, capability-complete, service-healthy, versioned, published and withheld records. Track category counts and provenance for each qualified candidate.
7. Keep embeddings disabled and use a bounded candidate count/runtime. Begin with up to 20 candidates per run; broaden only when the rejection report explains why it will help. Do not repeatedly probe the same rejected endpoint indefinitely.
8. Never use the rollback-only E2E harness as the retained-data writer. Reuse its components and assertions, not its temporary transaction or generated version IDs.

Exit:

- A bounded real read-only import persists registry block/hash provenance, resolved public metadata and probe/capability observations.
- Same candidate/content replay is idempotent; restart resumes without losing failed candidates or duplicating successful ones.
- Partial failure is isolated and visible. Disabled gates make no vendor/embedding calls.
- At least one qualifying real record reaches T3/T4; target three. If none qualify, hand off exact supply/adapter failures without declaring the live milestone complete.

### T3 — Explicit immutable versions and publication policy

Owner: A-WEB. Risk: R1. Dependency: T0 contract. Can develop against deterministic contract tests while T2 is implemented.

1. Implement an explicit marketplace publication service under `packages/marketplace/`; keep discovery itself free of automatic publication side effects.
2. Create immutable `agent_versions` from observed, allowlisted metadata and validated capabilities. Map unknown price/evidence/authority to existing unavailable/unknown representations.
3. Reuse a version for identical normalized content; create the next version for changed content. Make replay/concurrent writes and the `current_version_id` update safe and transactional.
4. Attach category predictions to the real version. Insufficient structured evidence stays `uncategorized` / review-needed. A name match alone cannot establish PancakeSwap, Venus or Lista support.
5. Apply existing domain transition and marketplace verification rules before publication. Preserve origin, claim, verification, runtime, authority and listing as separate axes. A chain identity read alone does not set `verified`, `live` or `published`.
6. Ensure `PostgresMarketplaceMetadataSource` and `IngestionMarketplaceSource` can read the output without a parallel metadata store or local schema substitute.
7. Provide sanitized diagnostics for missing versions/capabilities and eligibility exclusions. Keep rejected or unavailable candidates out of eligible ranking. Do not relax health/publication policy merely to populate the grid; a broader unverified registry-directory product requires a separate A0 contract decision.

Exit:

- Real version rows exist; the same full identity tuple flows into the DB-backed read model.
- Same-content replay produces no extra version; a changed profile produces a new immutable version.
- Publication is evidence-backed and auditable. Missing metadata, capability, health or identity proof remains explicitly withheld.
- A-OPS-QA tests real SQL, concurrent/replayed publication and failed transaction behavior on disposable PostgreSQL.

### T4 — Verify the existing frontend with retained records

Owner: A-WEB. Risk: R1 API/data wiring; R0 for isolated accessibility/style fixes. Dependencies: T1, T2, T3 for live acceptance.

1. Reuse `/marketplace`, all four category routes, `/agents/{slug}`, `/compare`, `/api/marketplace`, and `/api/marketplace/{slug}`.
2. Verify live mode and existing API-forwarding configuration independently; prevent self-referential API forwarding. Keep database/provider packages server-only.
3. Trace exact DB identity/version records through browse, deterministic search, chain/protocol/freshness filters, detail and compare. Test missing detail and zero-result queries.
4. Distinguish connected database mode from a healthy external agent. Preserve timestamps, provisional/finalized provenance, all state axes and unavailable activation messages.
5. Fix the recorded compact BrandMark accessible-name issue and marketplace heading structure; verify keyboard controls and mobile layouts with real metadata lengths.
6. Measure the bounded dataset read path. Repair demonstrable latency/query problems needed for the demo; defer broad search/index redesign and cosmetic rebuilding.

Exit: screenshots plus API/DB correlation for a real retained record; up to three-agent comparison behaves correctly; all four categories have honest results; no browser console/page errors, mobile overflow, fixture fallback or enabled payment CTA.

### T5 — Complete direct reconciliation and maintain freshness

Owner: A-DATA. Risk: R1. Dependencies: T2 integrated; T0 reviewed finality/lock configuration. Required for continuous release synchronization, not a prerequisite for T1 startup.

1. Wire the existing event codec, checkpoint and reorg mechanisms to bounded direct registry-event reads. Audit current implementations before adding replacements.
2. Pin per-network confirmation thresholds and scan bounds via A0. Store block/hash/transaction/log identity and distinguish provider pagination from chain cursors.
3. Persist progress, restart from checkpoint, detect hash divergence, rewind to a verified common ancestor, orphan displaced observations and replay canonical events.
4. Re-read owner, URI and `agentWallet`; stale displaced owner claims and re-evaluate affected publication/eligibility through T3's service.
5. Add bounded recurring refresh for the selected published supply. Stopping synchronization must leave retained reads available with stale/degraded disclosure, not refresh observation timestamps merely because a page was requested.
6. A-OPS-QA wires the accepted worker into the preview runtime only after its bounds, lock and failure behavior pass.

Exit: deterministic two-provider/reorg/restart tests plus a bounded live read-only reconciliation observation. Disable/re-enable does not erase history or repeat publication. Record which evidence is synthetic versus observed onchain; do not require generating a real chain reorg.

### T6 — CI database coverage and reachable preview topology

Owner: A-OPS-QA. Risk: R1 tests; R2 deployment/secrets. Dependencies: T0/T1; preparation runs alongside T2/T3.

1. Add a disposable PostgreSQL/pgvector CI service using the reviewed image pin. Inject a test-only DB URL, apply migrations and ensure DB integration tests execute rather than skip.
2. Cover fresh installation, applicable ADR 0003 legacy upgrades, version/category persistence, replay, rollback, and API reads against actual PostgreSQL. Do not point CI cleanup at the retained preview database.
3. Add the offline release-evidence check to CI. Keep live vendor credentials outside routine CI; use deterministic HTTP/RPC test servers for reproducibility.
4. Build and run the web production server in a dedicated runtime checkout/output directory, avoiding the user's existing `.next/` and concurrent dev/build processes.
5. Resolve networking explicitly: a Vercel deployment cannot connect to this host's `127.0.0.1:55432`. Evaluate the existing server-side `MARKETPLACE_API_URL` mode with an authenticated/appropriately protected HTTPS host API, or an already authorized private DB path. Never expose raw PostgreSQL publicly to make the preview work.
6. Keep Vercel as the planned public web host. A same-host app is the immediate local production-mode checkpoint; a different public hosting topology must be recorded as a concrete architecture exception, not silently substituted.
7. Prepare exact deploy/start/stop/rollback commands, env-name inventory, least-privilege connectivity, logs and readiness checks. Reuse existing authorized infrastructure. Identify any remaining hosting access, paid resource or DNS action precisely and seek only the required approval after preparation is reviewable.

Exit: CI runs DB tests; production build starts against retained data; preview networking is proven from its actual runtime; deployment SHA, URL and rollback are recorded. No credential appears in browser output, logs or evidence.

### T7 — Integrated acceptance and demo handoff

Owner: A-OPS-QA, with A0 independent release review. Risk: R1 flow validation / R2 deployment review. Dependencies: T2/T3/T4/T6; T5 for release synchronization claims.

1. Verify the actual preview URL with a production build and live data mode. Record source SHA, deployed SHA and DB migration state separately.
2. Correlate at least one real identity across discovery source, registry observation, retained version, API result and rendered detail. Demonstrate three real eligible records in compare when supply supports the target.
3. Cover all category routes, search, filters, freshness, unavailable activation, missing detail, empty results, desktop/mobile, keyboard interaction and console/page errors.
4. Verify application restart retains data, repeated import is idempotent, ingestion-disabled reads stay available, and DB/provider failure produces truthful degraded/error states without production fixtures. Use isolated failure injection; do not stop a shared DB used by other agents.
5. Record category coverage counts and unresolved external supply gaps. Do not treat four functioning routes as four proven live categories.
6. Run integrated `pnpm check`, `pnpm db:check`, DB integration checks, `pnpm evidence:release-check` and `git diff --check` on the accepted SHA. A0 checks that DB suites did not silently skip.
7. Produce a short demo runbook and claim-to-evidence index. Preserve historical artifacts and create new timestamped evidence; never overwrite blocked results with invented passes.

Exit: M1/M2 checklist with explicit pass/partial/blocked results and no unsupported claims. Gate scope matters: a semantic-off core preview can pass its own checklist while the larger optional pipeline artifact remains incomplete.

## 5. Execution order and bounded checkpoints

Effort bands are planning estimates per agent, not promises or an assumed hackathon deadline. A0 records the real demo cutoff before dispatch.

| Round | A-DATA | A-WEB | A-OPS-QA | Coordinator checkpoint |
| --- | --- | --- | --- | --- |
| Setup, roughly 30–60 minutes | Read contracts and inspect runner | Read contracts and inspect publication gap | T1 DB/runtime verification | T0 base/ref, ownership and boundary frozen |
| First implementation block, roughly 3–6 hours | T2 enrichment/composition | T3 version/publication service | T6 CI and preview preparation | First retained qualified identity; reasons if absent |
| Integration block, roughly 2–4 hours | T2 retained import and supply report | T4 real-data frontend verification | DB/API/browser integration checks | M1 accepted or exact remaining blocker assigned |
| Preview hardening, separately estimated after audit | T5 reconciliation/freshness | Fix owner-assigned API/UI defects | T6 runtime + T7 preview acceptance | M2 and selected ingestion gates evaluated |

Merge order: minimum shared contract -> independently verified data/publication/CI work -> composition and retained import -> frontend fixes -> reconciliation/runtime -> final evidence. Shared-type/schema changes merge before dependent consumers.

After the first implementation block, stop expanding vendor search or optional features if no complete version is visible. Use stage counts to assign the exact failing boundary. If only external health/supply remains, keep the technical preview running and report that limitation; do not weaken verification or start an unapproved reference-agent deployment.

## 6. External dependencies and fallback work

| Dependency | Owner | Required for | Independent work while unavailable |
| --- | --- | --- | --- |
| Rotated 8004scan credential in secret channel | Release owner + A0 | Release vendor discovery | Manual identity import, deterministic transport tests, DB/publication/UI work; do not use a known compromised key |
| Existing local DB access | A-OPS-QA | Retained local run | Already observed healthy; reuse it and diagnose access locally |
| Two reviewed BSC RPC endpoints and finality policy | A0 + A-DATA | Verified reads and reconciliation | Deterministic RPC tests; unresolved configuration stays disabled |
| Qualifying public endpoint/capability supply | A-DATA | Eligible real browse/comparison | Bounded candidate audit with reason codes; honest empty/degraded views |
| Hosting access and preview URL | A-OPS-QA + release owner | M2 public preview | Local production-mode acceptance and deployment preparation |
| Embedding provider/model/version/dimension lock | A0, later semantic task | Optional semantic enablement | Deterministic retrieval; no embedding call required for M1/M2 |
| Main-track chain decision | A0 + release owner | Submission chain/category claims | Clearly labelled read-only chain-specific preview; no mainnet writes |

## 7. Deferred assignable packets

Do not dispatch these ahead of the core critical path. Each requires a fresh scoped assignment and its focused plan/skill reads.

| Packet | Owner mapping | Concrete output | Start gate |
| --- | --- | --- | --- |
| S1 Semantic retrieval | A-DATA/A4 slot after T5 | Reviewed lock pin, real version-linked vectors, resumable backfill, relevance corpus, semantic-on/off degradation evidence | M1 green; model accepted; provider access/budget authorized |
| C1 One activation/commerce rail | A5 | One quote/request-to-result-and-receipt lifecycle, exact recipient/asset/network, dispute/unknown-outcome behavior, UI integration | Core green; reviewed contracts or approved B402 sandbox; required testnet-write authorization |
| C2 Creator + Altana reference | A2 then A6/A7, sequential slots | Browser grant -> bounded action -> revoke/deny evidence, then one audited reference Creator lifecycle | Core green; bootstrap access/pins; ADR 0001 accepted before dependent Creator work; authorized testnet/cloud actions |
| E1 Evidence Publication | A8 within QA/Submission vertical | One schema-approved bundle published to IPFS/Greenfield with seal, readback and matching hashes | Selected claim requires it; provider/SDK pins and authorized resources available |
| Q1 Submission | A12 slot | Demo, chain/category gap report, claim-to-evidence index and only supported bounty claims | M2 and each included optional gate accepted |

These packets do not authorize payments, signing, public DNS changes, paid resources or release promotion by themselves.

## 8. Required reading and dispatch prompt

Every implementation agent reads in its own checkout, before edits:

- `AGENTS.md`
- `docs/04-bnbera-master-implementation-plan.md`
- `docs/05-subagent-delivery-plan.md`
- `config/standards.lock.json`
- `docs/01-marketplace-donor-merge-plan.md`
- `docs/06-erc8004-pipeline-integration-plan.md`
- `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`
- This plan and all shared schemas/interfaces consumed by its assignment.
- ADR 0003 for database/migration work; `docs/03-no-code-agent-deployer-plan.md` and relevant ADRs for deployment work. ADR 0001 remains proposed; reading it does not accept the custody gate.
- The appropriate browser, framework or deployment skill and official pinned documentation when performing those tasks. No need to load custody/payment skills for isolated core UI work.

Useful shared starting paths: `packages/domain/src/{identity,states,services}.ts`, `packages/agent-ingestion/src/types.ts`, `packages/marketplace/src/{types,source,read-model,eligibility}.ts`, `packages/db/src/schema.ts`, `apps/web/src/lib/{marketplace-contract,marketplace-server}.ts`.

Copy this dispatch template and fill all fields:

```text
You own <agent> tasks <IDs> from docs/07-mvp-live-marketplace-task-plan.md.
Worktree: <absolute isolated path>; branch: <branch>; base: <verified SHA>.
Read AGENTS.md and every required document/schema in this checkout before edits.
Report exact read paths, vertical, feature gate, risk tier and unresolved pins.
Owned paths: <explicit paths>; shared files are A0-owned unless delegated.
Reuse the existing frontend, Docker database and reviewed pipeline components.
Implement and verify your packet's acceptance criteria. Preserve existing data.
Do not create substitute contracts, invent service health, enable optional rails,
or perform unauthorized external writes. Coordinate changes at shared boundaries.
Use a disposable DB for destructive/failure tests, not the retained preview DB.
Return exact base/head SHAs, changed paths, commands/results, evidence level,
flags, limitations, required secret names only, and rollback/disable steps.
Commit only in your assigned isolated worktree if A0 has assigned that operation.
```

## 9. Rollback and plan handoff

- Disable vendor discovery, semantic retrieval and synchronization independently using the existing flags. Preserve retained versions, sources, observations and audit history.
- Stop only the task-owned worker/web service when reverting runtime configuration. Leave the existing Docker database and its volume intact.
- Roll back application deployment to the previously verified artifact/SHA; database changes require a reviewed forward migration. Do not blindly revert the entire 109-file implementation commit to undo one task.
- Every handoff distinguishes deterministic, disposable-DB, retained-live-read, browser and deployed evidence. A screenshot or HTTP 200 alone does not satisfy the whole journey.

Planning edit evidence: this document is R0 and changes no code, configuration, schema, database rows or deployment. The planning pass read the master/delivery/marketplace/deployment/pipeline plans, standards lock, both ADRs, daily handoff, and inspected the shared identity/state/service, ingestion and marketplace contracts. A read-only subagent audited runner-to-publication wiring. Docker/SQL observations above were read-only; original `.next/` content was preserved. Implementation agents must independently complete their own documentation gate.
