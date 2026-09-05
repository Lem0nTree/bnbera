# ERC-8004 marketplace: audited status and MVP completion tasks

Date: 2026-09-05. Status: proposed execution backlog, based on inspected code and read-only database evidence; not release acceptance.
Coordinator: A0. Execution capacity: two implementation agents at a time, with coordinator review before replacing a completed agent.

## 1. Decision

The marketplace has a working bounded ingestion/publication demonstration. The ERC-8004 pipeline is **not complete as a continuously operated, fully integrated release feature**. W0 is implemented; W1 has a demonstrated local slice but still needs sustained live operation and public acceptance. The next integration is **a usable activation-to-result journey**, supported by reliable health refresh and four-category supply. A full Creator implementation is not the next critical-path task.

Keep the existing frontend, PostgreSQL/pgvector database, identity model, ingestion components and explicit publication service. Complete their missing operational and verification boundaries. Do not start a replacement marketplace or database.

Altana remains optional for external discovery, browsing, search, comparison, claims and ordinary external-agent activation. For BNBEra-created autonomous agents it covers the entire authority lifecycle: grant, runtime checks, renewal, expiry, revocation and subsequent-write rejection. An external agent that already uses Altana may expose verified authority without being recreated by BNBEra.

## 2. Baseline and evidence levels

| Check | Observation |
| --- | --- |
| Checkout / branch | `/home/ubuntu/bnbera-w0-w1`, `codex/erc8004-pipeline` |
| Local and GitHub feature-branch HEAD | `31d112fdcb3e6b99032f479a9274472e910cf445` |
| Latest commit | `feat: publish validated A2A ERC-8004 agents`; four ingestion source/test files; no updated acceptance artifact |
| Remote `main` | `d2d7a840b79152794a9028645f142de519bb4b65`; feature-branch push does not prove release deployment |
| Preserved untracked files | `.pnpm-store`, `apps/web/.next/` |
| Read-only DB audit around 19:17 UTC | 25 identities, 25 agents, 2 versions, 2 embeddings, 0 chain-ingestion checkpoints |
| Only published record | `eip155:97:0x8004a818bfb912233c491871b3d84c89a494bd9e:2097`; category `health-factor`, current version 2, two capabilities, current vector dimension 1536 |
| Current service evidence | Latest recorded healthy probe: `2026-09-05T15:49:29.586Z`; over three hours old at audit |
| Other supply | 24 drafts, pending/unavailable and uncategorized; no retained qualifying chain-56 supply in this DB |
| Fresh tests in this audit | `pnpm --filter @bnbera/agent-ingestion --filter @bnbera/marketplace --filter @bnbera/web test`: 96 + 32 + 6 passed |
| Previous session evidence | Authenticated 8004scan search fetched/committed one candidate; composition published agent 2097; local API and rendered HTML served it; later runs reused embeddings |
| What was not rerun here | Live vendor calls, ingestion writes, browser automation, full CI, production build/deployment, transactions, paid services |

The previous live results are useful historical evidence. The fresh DB audit confirms retained data, not current endpoint availability or successful financial analysis. Both publication and read-side endpoint health expire after 60 seconds, so the old healthy probe cannot currently make agent 2097 eligible. A stored `runtime_status=live` is not sufficient.

## 3. Hackathon target and scope

The official main track asks for a public category-to-activation journey, meaningful current data and equally developed rebalancing, grid trading, yield optimisation and health-factor experiences. Surfaced agents must be live on BSC. The page lists 5 August–9 September 2026; confirm the exact submission cutoff separately. Altana is an independently judged partner track requiring bounded sessions, actual onchain activity and user revocation controls; its text explicitly accepts testnet. It does not explicitly resolve the main track's chain-97 eligibility. [Official Smart Money Era requirements](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks), checked 2026-09-05.

Consequences for this project:

- Four working category routes are a UI milestone; one testnet health-factor listing is not four-category submission coverage.
- Use the master plan's conservative chain policy: qualifying chain-56 reads/supply unless organizer confirmation accepts chain 97. This does not authorize mainnet writes.
- A successful Agent Card GET is discovery evidence. A quote or funding acknowledgement is not proof of completed health-factor monitoring, rebalancing, trading or yield analysis.
- Neither both payment rails nor a no-code Creator is a universal main-track prerequisite. Every included payment, custody or execution claim still needs its own proof.
- Aim first for a dependable public marketplace and a real result from each category. Add paid escrow and optional partner integrations only through their separate gates.

## 4. Position against master plan 04

| Master-plan area | Status at HEAD | Remaining acceptance |
| --- | --- | --- |
| W0, section 18 | Implemented foundation and local database/API/web slice | Reproduce exact production artifact; preserve public deployment evidence |
| W1, sections 5–6 and 18 | Browse/category/detail/compare, deterministic retrieval, identity axes and bounded live publication exist | Continuous freshness, useful real comparison, complete API/browser evidence and honest capability labels |
| Marketplace Data + Web | Partially integrated | Durable work scheduling; direct-event completion; broader supply; measured category/search quality; usable current-data enrichment |
| Activation + Commerce, section 10 | Contract/state-machine foundations only; UI explicitly returns activation unavailable | Actual request/result flow; production repositories and receipt verification for a selected paid rail |
| Creator + Altana, sections 8–9 | Policy/handoff primitives and simulated spike contracts | Official adapters, accepted ADR 0001, browser grant/action/revoke/deny, one deployed audited strategy |
| Evidence Publication, section 11 | Canonical publication abstractions and tests | Pinned Greenfield SDK/provider and live IPFS/Greenfield seal/readback/hash evidence |
| QA + Deployment + Submission, sections 16–19 | CI/runbooks and historical artifacts exist | Current CI outcome, reachable production build, migration/backup recovery, mobile/browser acceptance and claim-to-evidence index |

Do not assign a percentage: the remaining work includes external supply and authority gates that do not scale with files or test counts. Core Marketplace is not yet accepted as an unattended public release; Activation, Creator and Evidence gates remain unaccepted.

## 5. Pipeline audit: what works and what is missing

| Boundary | Evidence and finding | Follow-up |
| --- | --- | --- |
| 8004scan discovery | HTTP adapter, fallback, bounded jobs, source persistence and semantic candidate collector exist; filtered live search previously succeeded | Separate slow vendor semantic discovery from immediate enrichment; persistent retry/backpressure and query-scoped checkpoints |
| Full identity + finalized reads | Official registry/ABI pins and BSC finalized-tag reader exist | Reproduce two-provider checks and continuously reconcile changes |
| Metadata + services | Bounded resolver and service probes exist; latest commit maps ERC-8004 `name`/`endpoint`/`version` | Keep card discovery URL distinct from callable URL; validate advertised transport/security/version |
| A2A capability enrichment | Latest adapter copies skill descriptions and supplies `{message: object}` input / `object` output for A2A 0.3 | These are broad envelopes, not complete protocol validation or skill-specific schemas. No safe functional result is proved; avoid presenting descriptions as tested capabilities |
| Categorization | Versioned deterministic rules with confidence/review state, four categories and `uncategorized` | Gold-set measurement, false-positive checks and real supply in all categories; `semanticScore` here is text/rule evidence, not an LLM classifier |
| Embeddings | Provider adapter, canonical documents, pgvector/backfill and two retained 1536 vectors | Release flag remains false; measured relevance and actual API hybrid retrieval acceptance missing |
| Semantic lock enforcement | Ingestion command calls `validateSemanticEmbeddingLock`; `apps/web/src/lib/marketplace-server.ts:createLiveReadService` constructs a provider without calling it | Shared release validation must apply to the read API and every worker/backfill entry point |
| Publication + serving | Explicit immutable version service; one published record was served by local API/HTML | Audit current-version binding and refresh idempotency, keep stale/incomplete candidates from degrading all valid results unnecessarily |
| Health/uptime | Persisted point-in-time probe records; eligibility TTL 60 seconds | No checked-in recurring health worker; uptime history/coverage is not a demonstrated metric |
| Direct-event composition | `scripts/erc8004-registry-sync.ts` creates a pipeline without a service probe, category sink or embeddings; registry reader is omitted from that pipeline | Reuse full enrichment composition and preserve proven finality. New A2A-only candidates cannot traverse the same complete path through this command |
| Durable direct handoff | Job commits sync, slices affected identities to 20 and awaits a callback; callback's degraded result is not inspected | Persist all affected work before checkpoint advance; acknowledge only completed work; retry crashes/failures; avoid claiming composition completed merely because a Promise resolved |
| Continuous operation | Existing commands are one-shot; DB has no direct-sync checkpoint | Supervised workers, separate cadences, leases, restart recovery, backlog/health metrics |
| Release evidence | `erc8004-e2e.json` still records 22 pass / 2 blocked / 1 skipped and `pipelineComplete:false` from September 4 | Add a new current-SHA artifact; do not rewrite historical failures into passes |

Code references: `packages/agent-ingestion/src/{pipeline,probe,composition,registry-sync-job,categorization}.ts`, `scripts/erc8004-{marketplace-ingestion,registry-sync}.ts`, `packages/marketplace/src/{source,publication,eligibility}.ts`, `apps/web/src/lib/marketplace-server.ts`, `config/standards.lock.json`.

## 6. Dispatchable tasks

Estimates below are focused engineer-hours, excluding external wait time and coordinator review. They are planning ranges, not delivery promises. A0 owns shared schemas, the standards lock and migration allocation. Keep two implementation agents active; use isolated worktrees or disjoint paths with coordinator-only Git operations.

### P0 — Freeze scope, contracts and fresh acceptance ledger

Owner A0; R0 planning / R1 shared contracts; 1–2 hours; no dependency.

- Start from the verified feature SHA above and record selected feature claims and network policy.
- Specify evidence distinctions: registration resolved, card validated, protocol reachable, skill tested, execution authorized, result verified. Preserve the six existing axes; propose any additional evidence fields centrally.
- Update current-status links in plans 06/07; preserve their historical baselines and historical release artifacts.
- Reconcile plan 03 with master revision 1.4 as described in section 7 below. Record requirements conditionally by selected feature.
- Record credential rotation as verified/unverified using secret references only; the presence of an API key does not prove rotation.

Done: accepted task/contract ledger and named owners; no disabled gate is marked passed. This assessment document completes the audit portion, not all P0 decisions.

### P1 — Correct capability evidence and callable-service contracts

Owner DATA; Marketplace Data + Web; R1; 4–8 hours; depends P0.
Paths: ingestion pipeline/probe/metadata adapters and tests; shared domain fields via A0.

- Preserve the standard registration service mapping from HEAD.
- Pin the supported A2A schema revision/hash and validate card version, transport, input/output modes and required security declarations against it.
- Store the registration/card URL separately from the advertised invocation URL. Apply SSRF/redirect/size controls independently to both; never infer invocation paths.
- Replace the broad envelope shortcut with reviewed protocol schema references/validation. Label skill-specific schemas unavailable where not supplied; descriptions/tags never establish working strategy behavior.
- Treat card availability and authenticated RPC/tool usability separately. Audit MCP GET 405 handling: method rejection alone cannot establish a working MCP capability.
- Require a reviewed safe functional check for capability-verification claims. Integrate result evidence from P7 without allowing health probes to invoke paid or state-changing actions.

Done: malformed cards, unsupported transports, security mismatches and false capability claims are rejected or explicitly limited; a valid external card remains discoverable. Demonstrate that an HTML page, generic JSON response, quote acknowledgement or arbitrary object cannot pass functional-result acceptance. Re-evaluate existing adapter-derived versions without deleting history.

### P2 — Durable discovery/enrichment queue and independent schedules

Owner DATA; Marketplace Data + Web; R1; 5–9 hours; depends P0, integrates P1.
Paths: discovery/composition scripts and ingestion job/repository code; migrations only through A0.

- Persist work by full identity and observed content/change reference; use transactional enqueue/checkpoint semantics and claimable leases.
- Run bounded vendor list discovery independently from optional vendor semantic search. Begin enrichment immediately after candidates are persisted.
- Scope provider checkpoints by chain, registry, route and normalized filter query; test changed queries and fallback routes.
- Persist attempt count, retry time, safe reason, last success and completion state. Retry outages with jitter; quarantine unsupported metadata without repeatedly consuming the full budget.
- Page through the corpus across runs; 20 is a batch bound, not a permanent coverage ceiling. Deduplicate manual/vendor/event sources and test zero-capacity selection.

Done: a process killed after discovery resumes enrichment; >20 queued candidates are eventually attempted; concurrent workers do not duplicate publication; vendor semantic timeout cannot stall published-agent refresh. Supply metrics distinguish discovered, rejected, queued, processed and published.

### P3 — Independent health refresh and honest availability

Owner OPS; Marketplace Data + Web / QA; R1, R2 for deployment config; 4–7 hours; depends P0, integrates P1.
Paths: new `apps/health-monitor/` or scoped worker under `scripts/`, marketplace health source/tests; coordinate source edits with WEB.

- Poll selected published services approximately every 30 seconds with per-host limits, bounded concurrency and leases. Respect the existing 60-second TTL and leave margin for request latency.
- Discovery cadence can start at five minutes, direct-sync at roughly 30 seconds, and metadata refresh at five minutes or on change; measure and adjust. Do not run the entire expensive pipeline every 30 seconds.
- Refresh only observations for unchanged content; avoid new listing versions/embeddings on each health tick.
- Persist failed/unknown/stale states and derive availability from fresh evidence. Page reads must never refresh timestamps.
- Separate normal rejected-candidate inventory from system outage status. A working published record should not acquire a global outage label solely because other registry identities are incomplete.
- If reporting uptime, record the window, observed samples and monitoring coverage; missing observations remain unknown.

Done: a 30-minute unattended run keeps a healthy listing eligible; worker interruption expires it within the existing policy; restart restores eligibility after a real probe; unrelated vendor outages do not stop health checks. Retained data remains intact.

### P4 — Complete direct-event reconciliation through publication

Owner DATA; Marketplace Data + Web; R1; 5–9 hours; depends P2 and P1; P3 for sustained freshness.
Paths: registry-sync job/config, registry command and composition tests.

- Enqueue every affected identity durably, including overflow beyond the batch limit, before acknowledging synchronization progress.
- Reuse the accepted enrichment/probe/publication/category pipeline. Carry finalized block provenance explicitly; do not substitute a provisional head read.
- Inspect composition outcomes, retry partial failures, and retain work if forwarding fails after the chain transaction commits.
- Reconcile owner, URI and agentWallet changes, stale claims, removed/changed services and current-version/vector invalidation.
- Persist per-chain checkpoints and verify restart, deterministic fork/reorg replay, finalized-boundary refusal and provider disagreement. Use deterministic forks for reorg testing; no real chain reorg is required.

Done: a bounded live read-only registry run leaves a checkpoint; >20 affected identities and a failed callback are recovered; changed metadata reaches API/detail through the same complete flow. No silent dropped identities or false completed status.

### P5 — Finish semantic integration and ranking evidence

Owner WEB/SEARCH; Marketplace Data + Web; R1; 4–7 hours; depends P0 and P1; uses P3 for live eligibility.
Paths: `apps/web/src/lib/marketplace-server.ts`, vector/read-model integration, backfill tests; lock/config edits via A0.

- Apply identical lock validation to ingestion, backfill and API query providers. Include endpoint, document version and stored vector dimension compatibility; production must not accept the development canary exception.
- Produce an exact current-version vector mapping and test refresh/replay invalidation. Investigate why the canary now has two versions/embeddings before claiming no-churn behavior.
- Verify a real API semantic query and its reported retrieval/model version; vector storage alone is insufficient.
- Measure a small reviewed corpus across all four categories plus ambiguous/irrelevant agents; report category precision/recall and retrieval results against deterministic search. Do not force non-DeFi agents into the four categories.
- Preserve structured fallback for provider failure, absent vectors and disabled semantic release. Keep price, financial values and live health out of semantic input.

Done: semantic-on/off API evidence, hard-filter precedence, model mismatch refusal, measured relevance and exact-version retrieval. A0 enables semantic release only after this acceptance; deterministic marketplace delivery proceeds independently.

### P6 — Qualify four-category supply and useful current data

Owner DATA/PRODUCT; Marketplace Data + Web; R1; first inventory 2–4 hours, remaining supply-dependent; depends P1/P2; uses P3/P7 for full acceptance.
Paths: bounded discovery profiles, classification corpus, category coverage artifact; typed data adapters if a real gap requires them.

- Search and paginate authenticated 8004scan supply on the selected BSC networks, preserving the registration tuple and source. Prefer a useful structured query before an optional semantic expansion.
- Record a matrix per category: discovered, identity verified, card validated, protocol usable, skill tested, current data, activation/pricing, result evidence, accepted network.
- Inspect agent 2097's actual service result first. A health-factor description, zero-price quote or funded-job acknowledgement does not meet health-analysis acceptance.
- Normalize block/time/source, units and freshness for each category's relevant data: LP position/range, grid/inventory, yield assumptions/venues and lending risk. Use read-only protocol adapters where appropriate; optional Binance enrichment is secondary.
- Target at least one qualifying agent per category and at least three for real comparison. More generic 8004scan registrations do not close category coverage.
- After the bounded inventory, assign explicit missing service/adapter/provider work. Use reference supply only for documented gaps; do not silently start cloud/chain writes or the full Creator.

Done: four category evidence rows each point to usable supply and a result through P7 on an accepted network. Until then report the exact gap; truthful empty pages satisfy UI behavior but not this supply gate.

### P7 — First real activation and persisted result journey

Owner WEB/ACTIVATION; Activation + Commerce; R1 for approved read-only tasks, R2 for paid/signing paths; 6–12 hours; depends P0/P1, P6 candidate contract; integrates P3.
Paths: marketplace activation contracts via A0, web API/UI, persistent agent-run repository and result tests.

- Select one inspected service with a documented usable operation; begin with health-factor analysis if 2097 can actually supply it, otherwise use a better qualified agent.
- Validate inputs against the actual supported contract. Negotiate/confirm price and task bounds; an explicitly advertised free action may be enabled as free analysis, never represented as escrow or paid execution.
- Implement request -> pending/running -> completed/failed/unknown -> result, with request ID, full identity, immutable version, input/output digest, timestamps, data provenance and reload-safe persistence.
- Verify the actual returned result against a task rubric. A quote or receipt without work is not completion. Do not execute `notify_funded` as a casual health check.
- Add an enabled CTA for this verified method, result/status page, duplicate-submit protection and timeout reconciliation. Keep wallet confirmation explicit where required.
- Reuse the journey across P6's four categories with category-specific schemas/results; keep no-authority analysis separate from autonomous state-changing execution.

Done: a new user finds an agent, submits a task and receives a meaningful verified result inside the product; reloading and retrying do not lose or duplicate work. Paid claims require P10, and four-category completion requires P6.

### P8 — Deploy a supervised public preview

Owner OPS; QA + Deployment + Submission; R2; 4–8 hours excluding access; preparation starts after P0, integrates P2/P3/P7.
Paths: operational deployment files/runbook, CI and readiness checks; keep the existing web architecture.

- Pin and build an immutable application artifact from a green SHA; run migrations against disposable fresh/legacy histories before upgrading a backed-up retained DB.
- Configure public web/API and durable worker supervision, restart policies, process health and bounded shutdown. Keep discovery and service-health loops independent.
- Resolve Vercel-to-backend networking explicitly: `127.0.0.1:55432` is host-local. Use the supported HTTPS API topology or approved private DB connectivity; never publish raw PostgreSQL.
- Inject secrets server-side; ensure root ops scripts and web resolve the intended environment. Same-process web uses `MARKETPLACE_DATA_MODE=live` and the documented local `/api` base.
- Expose sanitized status for last scan, health refresh, checkpoint lag, queue backlog, embedding failures and release SHA. Document backup, restore and rollback.

Done: publicly reachable production build remains usable across restarts with continuous workers and retained real data; source/deployed SHA, migration state and rollback are independently recorded. No deployment is claimed from a Git push.

### P9 — Independent integrated acceptance

Owner QA; QA + Deployment + Submission; R1/R2 by enabled boundary; 4–8 hours; depends P1–P4/P6–P8; P5 if claiming semantic retrieval.
Paths: integration/security/browser tests and a new timestamped release artifact.

- Run required workspace checks, current CI, fresh/upgrade migration tests, secret checks and release-evidence validation on the exact candidate SHA. Confirm DB tests actually ran.
- Trace vendor/event source -> finalized identity -> metadata/card -> evidence-qualified capability -> category -> immutable version -> optional vector -> API -> rendered detail -> task -> verified result.
- Verify all category routes, filters, three-agent comparison, keyboard/mobile flows, missing/empty/error states and console errors through an actual browser.
- Test vendor and embedding outage, worker restart, TTL expiry/recovery, duplicate discovery/task, changed owner/URI and denied/unknown outcomes. Use disposable environments for destructive failure injection.
- Capture the 30-minute operational evidence, current identities, data freshness, deployed SHA and realistic limitations. Preserve earlier artifacts.

Done: explicit gate report with no unresolved P0/P1 defects in the selected scope. A successful basic canary does not set the complete pipeline flag while direct sync, functional capability, scheduling or claimed semantic retrieval remains unverified.

### P10 — Optional paid escrow: one ERC-8183 lifecycle

Owner COMMERCE; Activation + Commerce; R2; 12–24+ hours excluding external gates; depends P7 and verified deployment pins.
Paths: `packages/agent-commerce/`, persistent adapters, jobs API/UI; contracts/lock via A0.

- First time-box a 2–3 hour read-only feasibility check of official contracts, ABI, router/policy linkage and token. Resolve the testnet policy-address conflict with evidence; do not choose a candidate arbitrarily.
- Implement production persistence and chain receipt verification around the existing tested lifecycle contracts.
- Deliver quote -> explicit buyer funding -> work -> deliverable -> buyer verification/approval or rejection -> confirmed settlement/refund as supported by the selected deployment. Do not auto-settle for the buyer.
- Test idempotency, wrong network/token/recipient, stale quote, timeout/unknown payment, replay and reconciliation; retain correlated result/transaction evidence.

Done: one real authorized sandbox/testnet paid job, persisted and shown in the UI. If the pin/access gate cannot close, keep escrow disabled and continue P7's verified alternative activation. X402/B402 is a separate later task with its own asset, recipient and settlement canary; it is not a shortcut around unresolved escrow semantics.

### P11 — Optional Altana bootstrap

Owner CUSTODY; Creator + Altana; R2; 8–16+ hours plus external access; after Core Marketplace acceptance and pinned browser/Studio/AWS inputs.
Paths: `packages/altana/`, `spikes/altana-studio/`, ADR 0001 and sanitized evidence.

- Pin actual SDK/runtime versions, integrity, deployed Altana addresses and code; close the existing unresolved lock entries.
- Prove browser owner approval -> bounded session -> one-time Studio/AWS secret handoff -> one allowlisted action with receipt/state -> owner revocation -> rejected next equivalent write.
- Test expiry, excess spend, forbidden selector and stale authority; store references only.

Done: ADR 0001 accepted with independently reproduced live evidence. Existing policy tests or an installed SDK do not satisfy this gate. Scope includes authority display/renewal/revocation for ongoing operation, not only a creation wizard.

### P12 — Optional one-template Creator

Owner CREATOR; Creator + Altana + Reference Agent; R2; 16–32+ hours plus infrastructure; depends P11, core and reviewed template; any selected commerce/evidence paths depend on P10/P13.
Paths: Creator/deployer packages and dashboard routes, deployment persistence, signed template tooling.

- Choose one audited strategy from a documented supply gap. Validate configuration, quota and derived policy.
- Implement queued idempotent deploy -> register intended owner/agentWallet -> verify -> list using the existing ingestion/publication path.
- Deliver progress, pause, renewal, revoke/deny and teardown controls. No arbitrary code or unrestricted signer.
- Require only the explicitly selected faces/rails; inactive optional features remain unavailable.

Done: user deploys a callable, verified registered agent without development tools; retries do not duplicate resources/identity; revocation blocks the next write. Additional templates wait for their own canaries.

### P13 — Optional Greenfield/IPFS publication

Owner EVIDENCE; QA + Deployment + Submission; R2; 6–12+ hours plus provider access; depends real P7/P10/P12 output for the selected claim.
Paths: existing evidence/Greenfield packages and evidence UI; required focused read: plan 02.

- Pin provider/SDK and approved resources; publish one schema-allowed immutable result bundle.
- Verify Greenfield seal and readback, IPFS readback and matching hashes; persist pending/failure/retry states.

Done: real verifiable locators and matching content; optional storage failure cannot take down marketplace browsing. Local hashes alone are not Greenfield publication.

### P14 — Submission and demo package

Owner QA/SUBMISSION; R0/R1; 3–5 hours; depends P9 and evidence for every optional included claim.
Paths: `docs/submission/`, current evidence index and demo instructions.

- Record public URL, source/deployed SHA, accepted networks, four-category activation results and exact optional gates passed.
- Provide a short judge journey and recovery instructions, with screenshots and result artifacts from the deployed app.
- Reconcile all product wording against evidence: registration verification, uptime, analysis, custody, payment and profitability are different claims.
- Confirm actual submission cutoff; aim for code freeze September 8 with September 9 reserved for verification/submission if consistent with the organizer cutoff.

Done: reproducible accessible product and accurate evidence package, with explicit unresolved category/network limitations if they remain. Optional partner work must not consume the release verification window.

## 7. Plan 03 alignment and Altana boundary

Apply these documentation corrections through P0, following newer master revision 1.4:

| Plan 03 section | Required clarification |
| --- | --- |
| 1 and 16 | Core Marketplace and accepted Altana bootstrap are Creator prerequisites. Four-category coverage is a submission goal, not a circular reason to forbid a gap-filling reference agent. Selected activation dependencies remain explicit |
| 5 step 3 and step 7 | Configure and verify pricing/payment only for selected rails; do not require both ERC-8183 and B402 for the first Creator |
| 5 step 7, 7 and 10 | Greenfield publication is mandatory only when that created-agent flow enables/claims canonical evidence; optional steps must record an explicit not-selected state |
| 11 | Keep owner-facing grant/renew/revoke and runtime deny behavior. This is the ongoing authority lifecycle, not an isolated setup step |
| 15 and 16 | Make payment/evidence acceptance conditional on selected features; retain unconditional custody, identity ownership and revoke/deny guarantees for Creator |

Altana must not become mandatory login, custody, payment wallet or listing eligibility for every external ERC-8004 agent. ERC-8004 registration does not imply Altana support. Optional Altana-backed buying/hiring can be added later through its own bounded authority and payment gate.

## 8. Two-agent execution order

P0 contract decisions happen first. Start P8 access/topology discovery early through the coordinator; do not wait until the end to discover the hosting environment is unavailable.

| Dispatch round | Slot A | Slot B | Coordinator acceptance before dependent work |
| --- | --- | --- | --- |
| 1 | P1 capability/service evidence | P3 health worker scaffolding using existing probe ports | Freeze evidence fields; healthy listing survives unattended checks |
| 2 | P2 durable queue/discovery | P5 semantic read-path gate, or P8 preparation if semantics deferred | No provider timeout blocks fresh published reads; lock honored in API |
| 3 | P4 direct synchronization | P7 first activation/result flow | Durable event handoff and actual useful task result |
| 4 | P6 four-category supply + adapter closure | P8 production preview integration | Real category matrix and deployed SHA |
| 5 | Owning agent fixes defects | P9 independent QA, then P14 | Current enabled-gate sign-off; no self-certified feature evidence |

P6's initial read-only inventory can be performed by the coordinator earlier to give P7 a viable target. Do not idle an agent on external access: assign the next independent packet after reviewing its previous handoff. P10 is the next major integration if paid hiring is selected. P11–P13 use freed slots only after core is stable and their external gates can close; Creator is not part of the remaining core critical path.

For every assignment include absolute worktree, branch/base SHA, task ID, owned files, shared-contract decisions, feature gates, highest risk tier, required documentation, expected test/evidence commands, secret-reference names only and rollback. Use the requested Luna/max configuration when available; record actual agent configuration and report unavailability rather than implying agents ran. Every agent independently reads the documentation gate before editing.

## 9. Operating acceptance and disable procedure

- Retained listing milestone: at least one real full tuple is persisted and served; historically demonstrated, but capability semantics require P1 review.
- Operable core: independent workers maintain freshness, queues survive restart, event changes reach projections, API/browser remain usable and no fixtures appear in production.
- Complete claimed pipeline: P1–P5 plus current live/API/browser evidence; vendor semantic outages can remain an explicitly degraded optional discovery source if other discovery and BNBEra semantic retrieval are independently proved.
- Hackathon-ready marketplace: four qualified category journeys with useful current data/results, accepted network and public production deployment; P6–P9/P14 passed.
- Optional gate: paid escrow, Creator/Altana and canonical evidence each need their own tasks; one gate cannot stand in for another.

Disable vendor calls with `ERC8004SCAN_DISCOVERY_ENABLED=false`; direct sync with `ERC8004_DIRECT_REGISTRY_SYNC_ENABLED=false`; semantic operations with `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=false`. Stop task-owned workers through the supervisor. Preserve identities, versions, observations and pending work. Return stale/unavailable states when freshness expires. Roll back application artifacts; use reviewed forward-compatible migrations rather than deleting retained data. New worker gates/commands must be documented by their implementation owner; none are claimed to exist yet.

Planning handoff: this R0 document changes no runtime, lock, database row or deployment. The audit read AGENTS.md, plans 01/03/04/05/06/07, the standards lock, ADRs 0001/0003, relevant release handoffs and the consumed identity/service/ingestion/publication/read contracts. ADR 0001 remains proposed. Tests above were rerun; DB observation used a read-only transaction. Historical live evidence is labeled separately. No new payment, signing, cloud resource or external message is authorized by this plan.
