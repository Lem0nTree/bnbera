# MVP tasks and gates

Active backlog for [MVP-MASTER-PLAN.md](MVP-MASTER-PLAN.md). Baseline `31d112f`; updated 2026-09-05. All tasks below are open integration work, even where components already exist. Two implementation agents maximum; coordinator reviews each handoff before dispatching its dependent replacement.

## G1 — Marketplace pipeline

### T1 — Persistent cron and health refresh

Owner: DATA/OPS. Start now. Paths: ingestion/composition scripts, job/repository code, cron/supervisor config. Risk: stateful; deployment/secret changes require the corresponding review.

- Add two ordinary locked cron jobs: bounded discovery/enrichment every five minutes; published-service health every minute. Separate locks/timeouts so vendor discovery cannot block health. Reuse existing database/reader/probe/publication code.
- Persist scan progress and per-identity retry state. Resume after restart, process more than one batch and do not repeatedly select only the same failures. Avoid overlapping invocations and log only safe counts/reasons.
- Align browse-health staleness to two minutes as specified in the master plan; keep real timestamps and immediate pre-action checks. Refresh unchanged listings without new versions/vectors.
- Keep direct events disabled until the current runner has the same probe/category/publication wiring and durable overflow/retry handling. Fix it within this task if used; scheduled finalized reads are sufficient for the first MVP.
- Document install/start/stop/status/recovery commands and start the public preview configuration while inspecting existing host access.

Done: cron runs against retained data for 30 minutes, survives process restart, shows new/updated real agents, preserves history and expires stale health accurately. No lost batch or false success. Test any new migration on disposable DBs first.

### T2 — Enriched listing, search and real metrics

Owner: WEB/DATA. Parallel with T1; disjoint files agreed by coordinator. Paths: marketplace read/publication model, web API/components, scoped enrichment adapters. Shared schema/lock changes assigned to one owner.

- Use current cards/detail/compare UI. Display category, public capabilities/services, current-data source/time, last check, observed uptime/window, real reviews, completed jobs and last result/price.
- Normalize available ERC-8004/vendor feedback and external job statistics with provenance. Keep missing data explicit; BNBEra's own jobs/reviews arrive in T5. No invented ratings, revenue, task results or zero-price assumptions.
- Distinguish card and invocation URL and advertised versus tested skills. Fix the latest adapter's broad-schema shortcut without requiring every agent to invent a BNBEra-specific manifest. A usable service check is separate from an Agent Card GET.
- Enforce the same embedding lock at API/worker/backfill entry points. Verify current-version vectors and hard filters before semantic ranking; deterministic fallback must work.
- Build a bounded four-category real-supply inventory. Check labels on representative agents and ambiguous cases; show truthful empty categories until qualified supply exists. Reuse external supply before proposing a new reference agent.

Done: a real listing shows persisted enrichment and truthful metrics; semantic search retrieves it; refresh does not churn versions; unsupported skills are not described as tested. UI works for all four categories with explicit coverage gaps. Source-owned evidence changes coordinate with T1.

### T3 — G1 acceptance and running public preview

Owner: QA/OPS. After T1/T2. Paths: targeted integration/browser checks, deployment/runbook, `docs/MVP-STATUS.md` created by this task.

- Run the production build against retained data and expose the web/API through the existing authorized topology. Vercel cannot reach the host's loopback DB; use a supported HTTPS API or approved private connection. Do not expose PostgreSQL publicly.
- Verify one full real flow: discovery -> finalized identity -> enrichment -> category -> embedding -> publication -> API -> browser. Confirm persistence after cron/web restart and semantic failure fallback.
- Check filters, category routes, compare, detail, current metrics and stale health; keep partial supply acceptance explicit. Use a small real sample and existing tests, not a new test platform.
- Record public/deployed SHA, the 30-minute cron result, identity tuples and exact missing categories. Complete the G1 checklist in the master plan.

Done: G1 accepted for the actual demonstrated scope and public preview kept running. Missing supply remains tracked through T5; do not equate four empty routes with four working categories.

## G2 — Paid hiring

### T4 — ERC-8183 escrow backend

Owner: COMMERCE. After G1; read-only contract feasibility can begin during T3. Paths: commerce package, persistent job repository, API/chain adapters; standards lock owned by coordinator.

- Resolve official deployment/ABI/token/policy pins, including the existing conflicting policy addresses. Report an exact external blocker if unresolved; do not build another rail.
- Wire quote, explicit buyer funding, provider work, deliverable submission, buyer approval and settlement into the existing lifecycle with PostgreSQL job/transaction persistence.
- Validate actor/network/token/recipient/amount and confirmed receipts. Handle protocol-supported rejection/expiry/refund and unknown outcomes; prevent duplicate charge or auto-approval.
- Return an input/output contract and a small real task fixture to T5. Use a service that produces a useful result; a funding acknowledgement is insufficient.

Done: real authorized testnet/sandbox paid cycle with receipt/result evidence plus duplicate/unknown-outcome recovery. No simulated escrow success.

### T5 — Hire UI, result, jobs and reviews

Owner: WEB. Parallel with T4 after their API contract is agreed; real acceptance depends on T4. Paths: existing detail CTA, job/result routes, review/read-model projection.

- Add task form -> quote/price confirmation -> wallet funding -> progress -> result -> buyer approval -> confirmed settlement. Preserve state on reload.
- Count only confirmed completed marketplace jobs; link the receipt/result. Allow one authenticated buyer review per completed job. Keep external reputation separate.
- Verify one agent first, then complete the same useful activation/result journey across the four category candidates from T2. An unavailable category remains an explicit submission blocker, not a fake listing.
- Record G2 evidence and ensure the public preview stays usable.

Done: a user completes the real paid journey inside the app; job count and review update correctly; errors and cancellation are intelligible. G2 requires T4 and T5; four-category coverage has its own explicit row in the status document.

## G3 — No-code Creator with Altana

### T6 — Altana wallet/session bootstrap

Owner: CUSTODY. After G2. Paths: Altana package, existing Studio spike and a small authority UI; pins through coordinator.

- Pin the SDK/runtime/contract details actually used. Prove user-controlled browser wallet, exact call/spend/expiry approval and bounded session handoff through the supported Studio secret path.
- Confirm one allowed testnet action, revoke in the product, and prove the next equivalent write is rejected. Verify expiry/over-cap denial; never expose root/session secrets.
- Give T7 the tested grant/status/revoke interface and supported deployment/session handoff. Keep external marketplace use independent of Altana.

Done: real grant/action/revoke/deny evidence, public authority display and only secret references in PostgreSQL. Local policy tests alone do not pass.

### T7 — One-template no-code creation

Owner: CREATOR/WEB. After T6; form/template preparation can run in the second slot against agreed interfaces. Paths: Creator/deployment persistence, Studio integration, create/dashboard UI.

- Use one audited template, ideally filling a supply gap. Accept validated parameters only; use Studio's supported deployment path rather than building a general orchestration service.
- Persist deploy progress/retries, intended ERC-8004 owner and agentWallet. Reuse G1 verification/publication and G2 hiring; no duplicate runtime or token on retry.
- Provide authority status/expiry, pause, renewal and revoke controls. Keep one active created agent per wallet; no arbitrary user code.

Done: create -> deploy -> register -> list -> hire works from the browser; user controls Altana and revocation stops writes. Gate G3 passes with one template; Greenfield is not a prerequisite.

## G4 — Greenfield and final demo

### T8 — Publish two useful Greenfield artifacts

Owner: EVIDENCE. After G3. Paths: current evidence/Greenfield publisher, profile/job evidence panel; pins through coordinator.

- Pin provider/SDK/network. Publish one public profile and one completed-job bundle with approved public fields, result digest and receipt references.
- Verify seal, readback and matching hash; persist locator/status and show links. Resume an interrupted upload. If the same deliverable is in IPFS, compare hashes.
- Keep raw monitoring data, secrets and unapproved private task inputs out. No mirrors or custom contracts.

Done: two real verified artifacts visible in the app. Gate G4 passes without making storage availability a prerequisite for browsing or hiring.

### T9 — Final public walkthrough and submission

Owner: QA/RELEASE. Prepare in parallel with T8; final verification after all selected gates.

- Run relevant build/tests and current migration checks. Verify the public deployed SHA and cron remain running.
- Walk through four-category find/compare/understand/activate, one paid escrow cycle with review/job update, one Altana Creator/revoke flow and the two Greenfield links.
- Produce a short demo script and current `MVP-STATUS.md`: each gate pass/fail, evidence references, unresolved network/category/access gaps and rollback command. Confirm submission cutoff and avoid cosmetic work during the final verification window.

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
