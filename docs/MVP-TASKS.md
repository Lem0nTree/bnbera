# MVP tasks and gates

Active backlog for [MVP-MASTER-PLAN.md](MVP-MASTER-PLAN.md). Current GitHub `main` baseline: `7a0a480`; reconciled 2026-09-06. Two implementation agents maximum; coordinator reviews each handoff before dispatching its dependent replacement.

## Current delivery status

This table distinguishes code merged to GitHub `main`, retained-runtime evidence, and a gate that users can complete from a public browser. A task is not complete merely because a supporting package or unit test exists.

| Task | Status | Current result | Remaining acceptance |
| --- | --- | --- | --- |
| T1 | Implemented; retained acceptance passed | Independent locked discovery and health cron, durable cursor/retry state, bounded work and freshness expiry are merged. | Reinstall from the final deployed checkout and keep operational evidence with T3. |
| T2 | Core and reputation implemented; supply growth remains | Real enrichment, multi-category evidence, persistent vectors, deterministic fallback, marketplace read models and provenance-separated ERC-8004 Reputation Registry ingestion/display are implemented. A bounded live read advanced the checkpoint but observed zero feedback events, which is shown as unknown rather than a fabricated score. | Continue bounded qualified-supply growth and keep production semantic mode disabled until its standards lock is released. |
| T3 | In progress | Retained database pipeline, restart-safe cron behavior and local API path have been exercised. | Deploy a stable public HTTPS preview and verify browser -> API -> PostgreSQL plus restart, stale-health and fallback behavior at the deployed SHA. Create `MVP-STATUS.md`. |
| T4 | Backend and authorized canary complete | PR #18 is merged. The pinned SDK boundary, safe APIs, PostgreSQL lifecycle, reconciliation and one distinct-actor chain-97 hire -> submit -> explicit buyer approval -> settlement canary passed. | Keep release disabled. T5 must connect authenticated browser authority and prove a useful result from a callable marketplace agent; T4 alone does not pass G2. |
| T5 | Open | Existing detail page has a read-only/disabled activation surface. | Complete the browser hire/result/approval/settlement journey, confirmed-job projection and verified-purchase review. |
| T6 | Open | Altana boundaries and pinned candidate package exist; no live authority proof. | Implement browser-controlled grant/status/revoke and prove allowed, revoked, expired and over-cap behavior. |
| T7 | Open | No-code Creator is planned; no end-to-end Creator exists. | Use the pinned BNB Agent Studio CLI/runtime integration for one audited template, then register, publish and hire the created agent. |
| T8 | Open | Publisher abstractions exist only. | Publish and verify one profile plus one completed-job bundle on Greenfield. |
| T9 | Open | Requirements and gate structure exist. | Public walkthrough, current evidence/status, Agent Advantage Report and submission package. |

### Immediate critical path

1. Finish T3 public preview acceptance without weakening the truthful listing gate.
2. Complete T4 and T5 as one browser-to-chain paid journey.
3. Complete T6, then T7. **T7 is the task that uses BNB Agent Studio to let a user create an agent; T6 supplies the user-controlled Altana authority used during and after deployment.**
4. Complete the bounded T8 integration and T9 submission evidence.

Competition acceptance and partner-track distinctions are summarized in [HACKATHON-REQUIREMENTS.md](HACKATHON-REQUIREMENTS.md).

## Remaining integration checklist

Use these unchecked items as the bounded handoff for the next implementation agent. Checked items are already merged or supported by retained evidence; every task still follows its detailed gate below.

### T1 remaining

- [x] Merge independent locked discovery and health jobs with durable cursor/retry state.
- [x] Verify bounded retained operation, restart safety and honest freshness expiry.
- [ ] Reinstall the two jobs from the immutable public-preview checkout and attach their current operational evidence to T3.

### T2 remaining

- [x] Merge enrichment, evidence-based multi-category classification, vector persistence, semantic canary/fallback and marketplace projections.
- [x] Ingest ERC-8004 Reputation Registry feedback and revocations with full identity, reviewer/index, fixed-point value, tags, URI/hash, block/time and reorg provenance. Revoked entries remain in history and leave active aggregates.
- [x] Display raw permissionless feedback, recognized reviewer/validator evidence and T5 verified-purchase reviews as separate views, with truthful unknown/unavailable states and no trusted aggregate over raw feedback.
- [ ] Continue bounded discovery to improve qualified four-category depth without weakening capability, service or health gates.
- [ ] Release-enable semantic retrieval only after the shared standards lock has production evidence; deterministic fallback remains valid meanwhile.

### T3 remaining

- [ ] Deploy an immutable production build behind stable HTTPS without exposing PostgreSQL.
- [ ] Verify browser -> API -> PostgreSQL for browse, filters, categories, compare and detail at the deployed SHA.
- [ ] Verify pipeline/web restart, stale-health expiry/recovery and semantic-provider fallback.
- [ ] Create `docs/MVP-STATUS.md` with deployed SHA, cron evidence, real identity tuples, category counts and honest gaps.

### T4 remaining

- [x] Refresh the T4 implementation onto the common `9af240b` base in isolated checkout `task/t4-core-integration` (PR #18); preserve migration history.
- [x] Confirm from the installed `@altananetwork/sdk@0.9.0` and official documentation that application code should use the SDK directly; the Altana MCP is a thin AI-host wrapper and is not required by BNBEra runtime code.
- [x] Resolve the source-level chain-97 address conflict against the standards-lock APEX commit: Commerce `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, Router `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`, OptimisticPolicy `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea`, token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`.
- [x] Repair PR #18's disposable legacy migration smoke failure (`42P07`) without editing migration history or the retained database.
- [x] Record all four chain-97 addresses in the standards lock and fail closed unless SDK addresses match and read-only bytecode/proxy-linkage/policy-allowlist/token checks pass.
- [x] Use only SDK `hireErc8183Agent`, `submitErc8183Deliverable`, `settleErc8183Job`, `buildClaimRefundCall` and `getErc8183Job` for the APEX flow; duplicate direct transaction writers remain disabled.
- [x] Persist one canonical marketplace job/result through hire, reload, submit, approval/dispute, settlement/refund and reconciliation, bound to the full agent identity/version.
- [x] Bind execution authority to the persisted buyer/provider and on-chain actors, and include actor, chain, contracts, job and material parameters in idempotency identity. Public routes still fail closed until T5 provides authenticated authority.
- [x] Persist the SDK canonical-manifest Keccak separately from the local SHA-256 evidence digest; serve and verify the exact SDK `manifestText` bytes.
- [x] Verify operation-specific receipt events against contract/job/actor/digest as applicable, preserve calls IDs/transaction hashes, and reconcile pending/unknown outcomes before retry.
- [x] Keep approval explicit, allow dispute without prior approval, and use the SDK refund call only after protocol expiry.
- [x] Add the minimal job APIs and bounded health-factor task/result contract required by T5. This deterministic fixture proves escrow/data plumbing, not execution by a discovered marketplace agent.
- [x] Prepare distinct buyer/provider testnet actors, required gas and capped testnet U funding without exposing keys.
- [x] Complete one authorized `<= 0.01 U` hire -> submit -> explicit approval -> settlement cycle, PostgreSQL reload, same-key duplicate protection and a deterministic unknown-outcome no-rebroadcast test.
- [ ] Keep `releaseEnabled=false` until T5 supplies authenticated browser authority and a useful result from a callable marketplace agent.

### T5 remaining

- [ ] Implement task -> quote -> explicit fund -> progress -> result -> buyer approval -> confirmed settlement with reload recovery.
- [ ] Project only confirmed completed jobs, result/receipt links and one authenticated verified-purchase review per completed job.
- [ ] Connect T2 reputation views without combining their trust levels.
- [ ] Capture the first real Agent Advantage comparison and record any unavailable category honestly.

### T6 remaining

- [ ] Verify the exact Altana wallet/session exports, runtime addresses and browser/passkey environment.
- [ ] Implement user-controlled call allowlist, spend cap and expiry grant plus public authority status.
- [ ] Prove one allowed action, revoke it in-product, then prove revoked, expired and over-cap actions fail.
- [ ] Give T7 a tested grant/status/revoke and Agent Studio handoff interface; store secret references only.

### T7 remaining

- [ ] Verify the pinned Agent Studio runtime integrity and supported deploy/register interface.
- [ ] Implement one validated audited template and persisted, idempotent deployment progress.
- [ ] Connect T6 authority -> Agent Studio deploy/runtime -> intended ERC-8004 owner/agentWallet.
- [ ] Reuse G1 to verify, enrich, categorize, vectorize and publish the created agent.
- [ ] Reuse G2 to hire it and prove revocation rejects the next delegated write.

### T8 remaining

- [ ] Pin the Greenfield SDK, provider and network.
- [ ] Publish one approved public profile and one completed-job bundle.
- [ ] Verify seal, readback and matching hash; persist status/locator and show links.
- [ ] Prove interrupted retry does not create a duplicate object and storage failure does not break browsing or hiring.

### T9 remaining

- [ ] Verify current migrations, build, deployed SHA, cron and public browser journey.
- [ ] Walk through four-category discovery, one paid cycle/review, one Creator grant/revoke flow and two Greenfield links.
- [ ] Complete three real Agent Advantage comparisons, including one trading, stock/equities or security task.
- [ ] Finish the submission script, evidence references, honest blockers and rollback commands.

## G1 — Marketplace pipeline

### T1 — Persistent cron and health refresh

Status: implemented and retained-runtime accepted; final-host operation is recorded by T3.

Owner: DATA/OPS. Paths: ingestion/composition scripts, job/repository code, cron/supervisor config. Risk: stateful; deployment/secret changes require the corresponding review.

- Add two ordinary locked cron jobs: bounded discovery/enrichment every five minutes; published-service health every minute. Separate locks/timeouts so vendor discovery cannot block health. Reuse existing database/reader/probe/publication code.
- Persist scan progress and per-identity retry state. Resume after restart, process more than one batch and do not repeatedly select only the same failures. Avoid overlapping invocations and log only safe counts/reasons.
- Align browse-health staleness to two minutes as specified in the master plan; keep real timestamps and immediate pre-action checks. Refresh unchanged listings without new versions/vectors.
- Keep direct events disabled until the current runner has the same probe/category/publication wiring and durable overflow/retry handling. Fix it within this task if used; scheduled finalized reads are sufficient for the first MVP.
- Document install/start/stop/status/recovery commands and start the public preview configuration while inspecting existing host access.

Done: cron runs against retained data for 30 minutes, survives process restart, shows new/updated real agents, preserves history and expires stale health accurately. No lost batch or false success. Test any new migration on disposable DBs first.

### T2 — Enriched listing, search and real metrics

Status: core plus ERC-8004 reputation ingestion/display implemented; bounded qualified-supply growth and semantic-provider release remain.

Owner: WEB/DATA. Parallel with T1; disjoint files agreed by coordinator. Paths: marketplace read/publication model, web API/components, scoped enrichment adapters. Shared schema/lock changes assigned to one owner.

- Use current cards/detail/compare UI. Display category, public capabilities/services, current-data source/time, last check, observed uptime/window, real reviews, completed jobs and last result/price.
- Normalize available ERC-8004/vendor feedback and external job statistics with provenance. Keep missing data explicit; BNBEra's own jobs/reviews arrive in T5. No invented ratings, revenue, task results or zero-price assumptions.
- Ingest non-revoked ERC-8004 Reputation Registry feedback with reviewer, feedback index, fixed-point value/decimals, tags, URI/hash, block/time and revocation provenance. Show separate views for raw permissionless feedback, recognized reviewer/validator evidence, and the verified-purchase reviews created by T5; never expose a Sybil-prone unfiltered average as a trusted rating.
- Distinguish card and invocation URL and advertised versus tested skills. Fix the latest adapter's broad-schema shortcut without requiring every agent to invent a BNBEra-specific manifest. A usable service check is separate from an Agent Card GET.
- Enforce the same embedding lock at API/worker/backfill entry points. Verify current-version vectors and hard filters before semantic ranking; deterministic fallback must work.
- Build a bounded four-category real-supply inventory. Check labels on representative agents and ambiguous cases; show truthful empty categories until qualified supply exists. Reuse external supply before proposing a new reference agent.

Done: a real listing shows persisted enrichment and truthful metrics; semantic search retrieves it; refresh does not churn versions; unsupported skills are not described as tested. UI works for all four categories with explicit coverage gaps. Source-owned evidence changes coordinate with T1.

Reputation acceptance: the standards-locked bounded sync advances durable checkpoints, preserves reorg/revocation history and projects three provenance-separated views through the marketplace API and detail UI. The current bounded live sample observed zero feedback events; this is valid empty-chain evidence and the UI reports unknown rather than zero or a trusted rating.

### T3 — G1 acceptance and running public preview

Status: retained/local acceptance substantially passed; public HTTPS deployment and deployed browser acceptance remain.

Owner: QA/OPS. After T1/T2. Paths: targeted integration/browser checks, deployment/runbook, `docs/MVP-STATUS.md` created by this task.

- Run the production build against retained data and expose the web/API through the existing authorized topology. Vercel cannot reach the host's loopback DB; use a supported HTTPS API or approved private connection. Do not expose PostgreSQL publicly.
- Verify one full real flow: discovery -> finalized identity -> enrichment -> category -> embedding -> publication -> API -> browser. Confirm persistence after cron/web restart and semantic failure fallback.
- Check filters, category routes, compare, detail, current metrics and stale health; keep partial supply acceptance explicit. Use a small real sample and existing tests, not a new test platform.
- Record public/deployed SHA, the 30-minute cron result, identity tuples and exact missing categories. Complete the G1 checklist in the master plan.

Done: G1 accepted for the actual demonstrated scope and public preview kept running. Missing supply remains tracked through T5; do not equate four empty routes with four working categories.

## G2 — Paid hiring

### T4 — ERC-8183 escrow backend

Status: backend implementation and authorized chain-97 canary are complete on merged PR #18 (`main` merge `7a0a480`). G2 remains pending on T5.

Owner: COMMERCE. After G1; read-only contract feasibility can begin during T3. Paths: commerce package, persistent job repository, API/chain adapters; standards lock owned by coordinator.

- Resolve official deployment/ABI/token/policy pins. The APEX source at pinned commit `b40b18011407ba13516661d3784bcb727a0c7794` and the installed `@altananetwork/sdk@0.9.0` agree on chain-97 Commerce `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, Router `0xd7d36d66d2F1B608A0F943f722D27e3744f66F25`, OptimisticPolicy `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` and token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`. Record and runtime-verify all four before enabling a development canary; source agreement is not bytecode/linkage/token or paid-cycle evidence.
- Use the SDK's `hireErc8183Agent`, `submitErc8183Deliverable`, `settleErc8183Job`, `buildClaimRefundCall` and `getErc8183Job`. The MCP package exposes these to chat hosts but official guidance says application code should use the SDK directly; do not add MCP to the runtime path.
- Keep only a thin application boundary around the SDK. Its purpose is to persist the marketplace job and idempotency key, bind it to the full ERC-8004 identity/version, reconcile receipts after timeout/reload, verify results and expose safe APIs for T5. It is not a second escrow or transaction implementation. Direct contract reads may independently verify SDK outcomes; duplicate direct transaction-writing paths stay disabled or are removed.
- Wire quote, explicit buyer funding, provider work, deliverable submission, buyer approval/dispute and settlement into one canonical PostgreSQL job/transaction lifecycle that recovers after restart.
- Bind authenticated buyer/provider identities to both persisted and on-chain actors. Keep the local SHA-256 evidence digest separate from the SDK canonical-manifest Keccak; persist the expected Keccak before submit and verify the exact returned `manifestText` bytes.
- Validate actor/network/token/recipient/amount and operation-specific contract events. A generic successful receipt plus current job state is not enough, and reconciliation must accept a job that legitimately advanced after the original operation. Preserve calls IDs/transaction hashes after post-check failures. Handle expiry/refund and unknown outcomes without duplicate charge or auto-approval; dispute must not require a prior approval.
- Return an input/output contract and a small real task fixture to T5. Use a service that produces a useful result; a funding acknowledgement is insufficient.

Done: real authorized testnet hire, submit and buyer settlement were confirmed; disposable-PostgreSQL reload, same-key duplicate protection and deterministic unknown-outcome no-rebroadcast behavior passed. The bounded fixture proves escrow plumbing, not useful execution by a discovered agent. Release remains disabled and G2 is not accepted until T5 completes that browser journey.

### T5 — Hire UI, result, jobs and reviews

Status: open; current activation remains read-only.

Owner: WEB. Parallel with T4 after their API contract is agreed; real acceptance depends on T4. Paths: existing detail CTA, job/result routes, review/read-model projection.

- Add task form -> quote/price confirmation -> wallet funding -> progress -> result -> buyer approval -> confirmed settlement. Preserve state on reload.
- Count only confirmed completed marketplace jobs; link the receipt/result. Allow one authenticated buyer review per completed job. Keep external reputation separate.
- Bind each verified-purchase review to the completed ERC-8183 job, exact ERC-8004 identity/version and result digest. Project three labeled reputation views on cards/detail: raw ERC-8004 feedback, recognized reviewer/validator evidence, and BNBEra verified-job reviews; revoked feedback leaves active aggregates without erasing history.
- Verify one agent first, then complete the same useful activation/result journey across the four category candidates from T2. An unavailable category remains an explicit submission blocker, not a fake listing.
- Record G2 evidence and ensure the public preview stays usable.
- Capture the first of the three required Agent Advantage comparisons: same task with the marketplace agent and without it, including elapsed time, cost, output and quality assessment. T9 completes the report; at least one comparison must be trading, stock/equities or security-related.

Done: a user completes the real paid journey inside the app; job count and review update correctly; errors and cancellation are intelligible. G2 requires T4 and T5; four-category coverage has its own explicit row in the status document.

## G3 — No-code Creator with Altana

### T6 — Altana wallet/session bootstrap

Status: open; this task owns custody/session authority, not agent creation.

Owner: CUSTODY. After G2. Paths: Altana package, existing Studio spike and a small authority UI; pins through coordinator.

- Pin the SDK/runtime/contract details actually used. Prove user-controlled browser wallet, exact call/spend/expiry approval and bounded session handoff through the supported Studio secret path.
- Confirm one allowed testnet action, revoke in the product, and prove the next equivalent write is rejected. Verify expiry/over-cap denial; never expose root/session secrets.
- Give T7 the tested grant/status/revoke interface and supported deployment/session handoff. Keep external marketplace use independent of Altana.

Done: real grant/action/revoke/deny evidence, public authority display and only secret references in PostgreSQL. Local policy tests alone do not pass.

### T7 — One-template no-code creation

Status: open. **This is the BNB Agent Studio user-creation task.**

Owner: CREATOR/WEB. After T6; form/template preparation can run in the second slot against agreed interfaces. Paths: Creator/deployment persistence, Studio integration, create/dashboard UI.

- Use one audited template, ideally filling a supply gap. Accept validated parameters only; invoke the pinned `@bnbagent/studio-cli` / `@bnbagent/studio-runtime` supported deployment path rather than building a general orchestration service. Verify the runtime package integrity before enabling deployment.
- Connect the user-controlled Altana grant from T6 to the Agent Studio deployment/runtime handoff. Store only secret references; external marketplace discovery and browsing must remain independent of Altana and Agent Studio.
- Persist deploy progress/retries, intended ERC-8004 owner and agentWallet. Reuse G1 verification/publication and G2 hiring; no duplicate runtime or token on retry.
- Provide authority status/expiry, pause, renewal and revoke controls. Keep one active created agent per wallet; no arbitrary user code.

Done: create -> deploy -> register -> list -> hire works from the browser; user controls Altana and revocation stops writes. Gate G3 passes with one template; Greenfield is not a prerequisite.

If G1-G3 and the Agent Advantage evidence are already working, expose one
existing agent capability through Altana's x402/B402 server SDK and prove one
tiny paid request. This is a partner-track bonus, not a reason to delay the
ERC-8183 hire or create a second generic commerce subsystem.

## G4 — Greenfield and final demo

### T8 — Publish two useful Greenfield artifacts

Status: open.

Owner: EVIDENCE. After G3. Paths: current evidence/Greenfield publisher, profile/job evidence panel; pins through coordinator.

- Pin provider/SDK/network. Publish one public profile and one completed-job bundle with approved public fields, result digest and receipt references.
- Verify seal, readback and matching hash; persist locator/status and show links. Resume an interrupted upload. If the same deliverable is in IPFS, compare hashes.
- Keep raw monitoring data, secrets and unapproved private task inputs out. No mirrors or custom contracts.

Done: two real verified artifacts visible in the app. Gate G4 passes without making storage availability a prerequisite for browsing or hiring.

### T9 — Final public walkthrough and submission

Status: open.

Owner: QA/RELEASE. Prepare in parallel with T8; final verification after all selected gates.

- Run relevant build/tests and current migration checks. Verify the public deployed SHA and cron remain running.
- Walk through four-category find/compare/understand/activate, one paid escrow cycle with review/job update, one Altana Creator/revoke flow and the two Greenfield links.
- Produce a short demo script and current `MVP-STATUS.md`: each gate pass/fail, evidence references, unresolved network/category/access gaps and rollback command. Confirm submission cutoff and avoid cosmetic work during the final verification window.
- Complete the required Agent Advantage Report with at least three real paired runs (agent versus manual/baseline), attached outputs and time/cost/quality measurements; include at least one trading, stock/equities or security task.

Done: publicly accessible MVP and honest evidence for every claimed feature. Functional gaps block their claim; minor visual polish does not block the demo.

## Two-agent dispatch

Before dispatch, check only the prerequisites for the next milestone:

- G1: existing Docker DB access, working BSC RPC and 8004scan credentials, pinned embedding configuration, and an authorized public-preview host. Rotate the previously flagged 8004scan credential before release; never copy its value into a handoff.
- G2: reviewed ERC-8183 deployment/ABI/policy, asset/recipient/network, funded test wallet and explicit authorization for the paid canary. Missing pins block payment, not browsing.
- G3: pinned Altana/Studio versions, supported browser/passkey environment, deployment access and explicit testnet-write authorization.
- G4: pinned Greenfield provider/SDK, storage credentials and approval for any paid resources.

Record a missing prerequisite with its exact owner/request in `MVP-STATUS.md`; continue independent work without inventing configuration or passing the affected gate.

| Round | Slot A | Slot B | Exit |
| --- | --- | --- | --- |
| 1 | T1 cron/health | T2 enriched web/search | Coordinator reviews both; T3 verifies G1 |
| 2 | T4 escrow | T5 hire UI | G2 paid result and metrics |
| 3 | T6 Altana | T7 template/form preparation, then integration | G3 real Creator and revoke/deny |
| 4 | T8 Greenfield | T9 demo/QA preparation | G4 and final walkthrough |

Replace a finished agent only after reviewing its work. Give the replacement task ID, isolated checkout/base SHA, owned paths, current contracts, gate, required secret names only and concrete acceptance. Use the requested Luna/max configuration when available and report actual availability. This planning update does not itself launch implementation agents.
