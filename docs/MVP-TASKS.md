# MVP tasks and gates

Active backlog for [MVP-MASTER-PLAN.md](MVP-MASTER-PLAN.md). Merged GitHub `main` baseline: `41f9d4521ca4391b9fdfe9fe1d949d5652ceb3b5`. The local retained `main` checkout also contains follow-up reputation projection fix `84c2c6a`; that local commit is not treated as a GitHub merge claim. Current unmerged T5 checkout: `task/t5-browser-commerce` at `717730bc0e6859f43d1610222928884dfc785363`; reconciled 2026-09-07. Two implementation agents maximum; coordinator reviews each handoff before dispatching its dependent replacement.

Status key: **Completed** means the source and stated retained/live evidence meet the accepted scope; **Pending** means implementation or verification remains without the required acceptance evidence; **Blocked** names an external or safety prerequisite; **Planned** has no accepted implementation yet. A branch test is never a substitute for a live gate. Scope qualifiers distinguish retained/local acceptance from a public or paid claim.

## T5 strategy decision (2026-09-07)

The buyer does not need an Altana smart wallet or passkey to browse or hire an external marketplace agent. T5 uses one WalletConnect QR/mobile connector; MetaMask and other compatible wallets are selected through WalletConnect. The connector establishes one normalized EOA and SIWE session on BSC testnet (chain 97), then signs one sequential, standards-locked APEX/ERC-8183 path. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is public runtime configuration for this connector; it is not a secret or a standards-lock value.

The current T5 passkey/bootstrap implementation is not wholesale-reverted. Its browser/reload/recovery and public-evidence pieces remain useful groundwork for T6/T7 Creator custody, while the 2206 tunnel/card/reingestion/publication evidence remains valid. T5 must add the EOA adapter and re-use the existing canonical job/operation persistence; do not reset migrations, delete retained data or introduce a second escrow/x402 rail. The provider may retain the pinned Altana SDK for its own execution/submission authority. `releaseEnabled=false` remains until the new live paid journey passes.

## Current delivery status

This table distinguishes code merged to GitHub `main`, retained-runtime evidence, and a gate that users can complete from a public browser. A task is not complete merely because a supporting package or unit test exists.

| Task | Status | Current result | Remaining acceptance |
| --- | --- | --- | --- |
| T1 | Completed (retained scope) | Independent locked discovery and health cron, durable cursor/retry state, bounded work and freshness expiry are merged and retained-runtime accepted. | **Pending follow-up:** reinstall the two jobs from the immutable public-preview checkout and attach final-host evidence; this does not reopen the accepted retained scope. |
| T2 | Completed (retained scope; follow-ups pending) | Real enrichment, multi-category evidence, persistent vectors, deterministic fallback, marketplace read models and provenance-separated ERC-8004 Reputation Registry ingestion/display are merged. The bounded live read advanced the checkpoint and observed zero feedback events, shown as unknown rather than a fabricated score. | **Pending:** grow qualified four-category supply. **Blocked:** production semantic release until the standards lock is released. |
| T3 | Completed (retained/local scope) | Retained database pipeline, restart-safe cron behavior, local API/SSR path and `MVP-STATUS.md` evidence were accepted for the demonstrated scope. No public HTTPS claim is inferred. | **Pending follow-up:** keep stable authorized HTTPS/deployed-browser evidence aligned before making a final public-preview claim. |
| T4 | Completed (backend/canary scope; G2 pending) | PR #18 is merged. The pinned SDK boundary, safe APIs, PostgreSQL lifecycle, reconciliation and one distinct-actor chain-97 hire -> submit -> explicit buyer approval -> settlement canary passed. | **Blocked until T5:** keep `releaseEnabled=false`; T4 does not prove useful work by a discovered marketplace agent. |
| T5 | Pending (EOA adapter/live paid acceptance; 2206 marketplace sub-gate passed) | Adds exact registry-log/identity-ordering fixes, guarded 2206 reference registration, quote/hire/reload/approval/review UI and APIs, persisted results/reviews, and a disabled-by-default reference-provider worker. The branch's passkey bootstrap/recovery is retained as future T6/T7 groundwork, not the buyer path. Focused branch tests pass. The authorized quick tunnel/card, finalized reingestion and publication evidence for 2206 now pass. | Implement one WalletConnect QR/mobile -> wagmi/viem-style EOA/SIWE boundary (MetaMask and other compatible wallets are selected through WalletConnect), then complete the sequential `createJob`/actual-ID -> router registration -> `setBudget` -> bounded approval -> `fund` flow, provider submit and EOA settle/dispute/refund. Verify reload, duplicate, account/chain change and unknown-step recovery. The quick tunnel is canary-only with no uptime guarantee; `releaseEnabled=false` remains. |
| T6 | Planned | Altana boundaries and pinned candidate package exist; no live authority proof. | Implement browser-controlled grant/status/revoke and prove allowed, revoked, expired and over-cap behavior. |
| T7 | Planned | No-code Creator is planned; no end-to-end Creator exists. | Use the pinned BNB Agent Studio CLI/runtime integration for one audited template, then register, publish and hire the created agent. |
| T8 | Planned | Publisher abstractions exist only. | Publish and verify one profile plus one completed-job bundle on Greenfield. |
| T9 | Planned | Requirements and gate structure exist. | Public walkthrough, current evidence/status, Agent Advantage Report and submission package. |

### Gate mapping

| Gate | Status | Tasks | Current acceptance boundary |
| --- | --- | --- | --- |
| G1 — Persistent marketplace | Completed (accepted demonstrated scope) | T1–T3 | T1/T2/T3 retained/local acceptance is complete. Stable public HTTPS/deployed-browser alignment remains a final public-preview follow-up and is not claimed here. |
| G2 — Paid hiring | Pending; interactive browser acceptance required | T4–T5 | T4 backend/canary is accepted. The 2206 tunnel/card/reingestion/publication sub-gate passed; T5 must still prove the EOA connector/SIWE path, useful callable result, exact settlement and verified review from an authenticated browser, including reload/duplicate, account/chain-change and unknown-step checks. |
| G3 — No-code Creator | Planned | T6–T7 | No accepted Altana grant/revoke/deny or Agent Studio create/list/hire flow. Altana passkey/delegated authority is not required for G1 browsing or G2 external-agent hiring. |
| G4 — Greenfield | Planned | T8–T9 | No accepted public profile/result objects or final walkthrough. |

### Immediate critical path

1. Preserve the accepted T1–T3/G1 scope and close any final public-preview follow-up without weakening the truthful listing gate.
2. Preserve the completed 2206 authorized tunnel/card and finalized reingestion/publication sub-gate, then complete T5's WalletConnect (MetaMask/compatible wallet) EOA/SIWE browser-to-chain paid journey. Do not call G2 complete from T4 or marketplace/tunnel evidence alone.
3. Complete T6, then T7. **T7 is the task that uses BNB Agent Studio to let a user create an agent; T6 supplies the user-controlled Altana authority used during and after deployment.**
4. Complete the bounded T8 integration and T9 submission evidence.

Competition acceptance and partner-track distinctions are summarized in [HACKATHON-REQUIREMENTS.md](HACKATHON-REQUIREMENTS.md).

## Remaining integration checklist

Use these items as the bounded handoff for the next implementation agent. `[x] **Completed**` is accepted for the stated scope; `[ ] **Pending**` is implemented or testable but lacks required acceptance evidence; `[ ] **Blocked**` names an external or safety prerequisite; `[ ] **Planned**` has no accepted implementation yet. Every task still follows its detailed gate below.

### T1 remaining

- [x] Merge independent locked discovery and health jobs with durable cursor/retry state.
- [x] Verify bounded retained operation, restart safety and honest freshness expiry.
- [ ] **Pending:** Reinstall the two jobs from the immutable public-preview checkout and attach their current operational evidence to T3.

### T2 remaining

- [x] Merge enrichment, evidence-based multi-category classification, vector persistence, semantic canary/fallback and marketplace projections.
- [x] Ingest ERC-8004 Reputation Registry feedback and revocations with full identity, reviewer/index, fixed-point value, tags, URI/hash, block/time and reorg provenance. Revoked entries remain in history and leave active aggregates.
- [x] Display raw permissionless feedback, recognized reviewer/validator evidence and T5 verified-purchase reviews as separate views, with truthful unknown/unavailable states and no trusted aggregate over raw feedback.
- [ ] **Pending:** Continue bounded discovery to improve qualified four-category depth without weakening capability, service or health gates.
- [ ] **Blocked:** Release-enable semantic retrieval only after the shared standards lock has production evidence; deterministic fallback remains valid meanwhile.

### T3 remaining follow-up

- [x] **Completed (accepted retained/local scope):** Run the production build/read model and verify API/SSR browse, filters, categories, compare, detail, stale-health labeling and deterministic fallback without exposing PostgreSQL.
- [x] **Completed (accepted retained/local scope):** Verify pipeline/web restart persistence and retained cron/restart/freshness evidence at the accepted checkout.
- [ ] **Pending:** Refresh `docs/MVP-STATUS.md` with the deployed SHA, cron evidence, real identity tuples, category counts and honest gaps; the existing file is retained/local evidence only.
- [ ] **Pending:** Establish stable authorized HTTPS/deployed-browser alignment before making a final public-preview claim.

### T4 remaining

- [x] Refresh the T4 implementation onto the common `9af240b` base in isolated checkout `task/t4-core-integration` (PR #18); preserve migration history.
- [x] Confirm from the installed `@altananetwork/sdk@0.9.0` and official documentation that the existing T4 canary and provider execution may use the SDK directly; the Altana MCP is a thin AI-host wrapper and is not required by BNBEra runtime code.
- [x] Resolve the source-level chain-97 address conflict against the standards-lock APEX commit: Commerce `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, Router `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`, OptimisticPolicy `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea`, token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`.
- [x] Repair PR #18's disposable legacy migration smoke failure (`42P07`) without editing migration history or the retained database.
- [x] Record all four chain-97 addresses in the standards lock and fail closed unless SDK addresses match and read-only bytecode/proxy-linkage/policy-allowlist/token checks pass.
- [x] Keep the pinned Altana SDK boundary for the existing T4 canary and provider execution/submission; do not add MCP to the application runtime.
- [ ] **Pending T5 replacement:** Add the named, bounded EOA APEX adapter for buyer writes. It may use the reviewed viem/wagmi-compatible ABIs and direct `walletClient` sends, but must not accept arbitrary calldata or create a second escrow implementation.
- [x] Persist one canonical marketplace job/result through hire, reload, submit, approval/dispute, settlement/refund and reconciliation, bound to the full agent identity/version.
- [x] Bind execution authority to the persisted buyer/provider and on-chain actors, and include actor, chain, contracts, job and material parameters in idempotency identity. Public routes still fail closed until T5 provides authenticated authority.
- [x] Persist the SDK canonical-manifest Keccak separately from the local SHA-256 evidence digest; serve and verify the exact SDK `manifestText` bytes.
- [x] Verify operation-specific receipt events against contract/job/actor/digest as applicable, preserve calls IDs/transaction hashes, and reconcile pending/unknown outcomes before retry.
- [x] Keep approval explicit and allow dispute without prior approval in the retained T4 boundary; T5's EOA adapter must use the same pinned expiry/refund rules and never refund before protocol expiry.
- [x] Add the minimal job APIs and bounded health-factor task/result contract required by T5. This deterministic fixture proves escrow/data plumbing, not execution by a discovered marketplace agent.
- [x] Prepare distinct buyer/provider testnet actors, required gas and capped testnet U funding without exposing keys.
- [x] Complete one authorized `<= 0.01 U` hire -> submit -> explicit approval -> settlement cycle, PostgreSQL reload, same-key duplicate protection and a deterministic unknown-outcome no-rebroadcast test.
- [ ] **Pending release gate:** Keep `releaseEnabled=false` until T5 supplies authenticated EOA browser authority and a useful result from a callable marketplace agent.

### T5 remaining

- [x] Implement the task -> server quote -> explicit fund -> progress -> result -> buyer approval/dispute -> confirmed settlement composition with durable operation reload/recovery in the unmerged T5 branch. Focused web/commerce tests pass; live chain acceptance is separate.
- [x] Project only confirmed completed jobs, exact result/receipt links and at most one authenticated verified-purchase review per completed job; connect the three T2 reputation views without combining their trust levels.
- [x] **Retained, deferred from T5 acceptance:** Keep the browser passkey wallet bootstrap/reconciliation and WebAuthn session binding as future T6/T7 groundwork; it is not a T5 buyer prerequisite or acceptance path. Persisted public relay evidence remains safe to retain.
- [ ] **Pending:** Implement the single WalletConnect QR/mobile buyer connector. MetaMask and other compatible wallets are reached through it; it must yield one normalized EOA and SIWE session bound to chain 97.
- [ ] **Pending:** Keep account/chain change explicit: pause the current job, reject silent rebinding, require chain-97 reauthentication and a fresh server quote when the buyer EOA or network changes.
- [ ] **Pending:** Persist a public operation intent before every EOA send and the confirmed receipt/event after it. Persist connector, EOA, chain, contract, operation kind, request digest, transaction hash, block/receipt and reconciliation status; never persist signer/session secrets.
- [ ] **Pending sequential buyer funding checklist:**
  - [ ] Send pinned Commerce `createJob` with the server-quoted client/provider/evaluator/hook, task, deadline and bounded budget; wait for a confirmed receipt and decode `JobCreated` to persist the **actual** protocol job ID before sending any job-specific call.
  - [ ] Send pinned Router `registerJob` for that exact job ID and standards-locked policy; reconcile the `JobRegistered` event and actor/contract/job fields.
  - [ ] Send Commerce `setBudget` for the exact quoted atomic U amount; reconcile the job read and receipt before continuing.
  - [ ] Send a bounded ERC-20 `approve` for only the exact budget to the pinned spender required by the reviewed APEX path; never use an unlimited approval. Reconcile token owner/spender/allowance and receipt.
  - [ ] Send Commerce `fund` for the same exact job ID and budget; reconcile `JobFunded`, client/provider, amount and `FUNDED` state.
  - [ ] Do not infer the job ID from a quote, local counter, transaction nonce or a generic successful receipt; only the confirmed `JobCreated` event supplies it.
- [ ] **Pending provider/result and buyer terminal checklist:**
  - [ ] Provider performs the useful task for the published 2206 endpoint and submits the canonical result through the existing provider boundary (the provider may use `@altananetwork/sdk@0.9.0` and its own execution authority).
  - [ ] Verify the exact local SHA-256 result digest, SDK/on-chain deliverable Keccak/manifest bytes, provider actor and `JobSubmitted` receipt before presenting a buyer decision.
  - [ ] Buyer EOA explicitly sends settle/approve after verifying the result, or dispute without requiring prior approval; reconcile router settlement/finalization and Commerce completion events.
  - [ ] After protocol expiry only, buyer EOA may send the pinned claim-refund path; reconcile `JobExpired` and `Refunded`. Never auto-approve, auto-settle or blindly retry a refund.
- [ ] **Pending recovery checklist:** reload the page at every boundary and resume only from persisted step/receipt state; for an unknown wallet/RPC response, search by persisted operation ID, transaction hash, nonce and protocol event/job ID, read the pinned contracts and mark the step confirmed/reverted/unknown before any retry; duplicate idempotency keys must not rebroadcast a confirmed step.
- [x] Add exact ERC-8004 registry-log decoding and identity upsert ordering fixes plus a guarded owner-authorized registration harness for reference identity 2206. The harness is plan/read-only by default and does not itself prove a registration or listing.
- [x] Add the guarded reference health-factor provider and disabled-by-default PostgreSQL worker; it resolves only a secret reference and uses the existing ERC-8183 submission boundary.
- [x] **Completed (2206 marketplace/tunnel sub-gate):** Serve the 2206 card and invocation through the authorized quick HTTPS tunnel, register the URI, run finalized reingestion and publish only after ownership, capability and healthy service evidence pass. Evidence: URI transaction `0xe023...c9b` at block `129625704`; finalized sync `129619955–129625757` with 65 observations across 8 identities; 2206 is verified/live/published as a health-factor service with healthy card/invocation; persisted vector/hybrid evidence from the prior run remains available; the fixed `0.001 U` local ERC-8183 activation offer is enabled.
- [ ] **Pending:** Complete the real interactive WalletConnect (MetaMask/compatible wallet) EOA/SIWE buyer `createJob` -> actual-ID/register/budget/approve/fund -> provider submit -> 900-second dispute wait -> EOA settle/dispute/refund -> verified-purchase review run, including reload, duplicate-submit, account/chain-change and unknown-step recovery evidence. Do not mark T5 or G2 complete before this passes. The quick tunnel is canary-only with no uptime guarantee, and `releaseEnabled=false` remains.
- [ ] **Pending:** Capture the first real Agent Advantage comparison and record any unavailable category honestly.

### T6 remaining

- [ ] **Planned:** Verify the exact Altana wallet/session exports, runtime addresses and browser/passkey environment for Creator custody; this is not needed for T5 buyer hiring.
- [ ] **Planned:** Implement user-controlled call allowlist, spend cap and expiry grant plus public authority status.
- [ ] **Planned:** Prove one allowed action, revoke it in-product, then prove revoked, expired and over-cap actions fail.
- [ ] **Planned:** Give T7 a tested grant/status/revoke and Agent Studio handoff interface; store secret references only.

### T7 remaining

- [ ] **Planned:** Verify the pinned Agent Studio runtime integrity and supported deploy/register interface.
- [ ] **Planned:** Implement one validated audited template and persisted, idempotent deployment progress.
- [ ] **Planned:** Connect T6 authority -> Agent Studio deploy/runtime -> intended ERC-8004 owner/agentWallet; this is the first path that requires Altana passkey/delegated authority.
- [ ] **Planned:** Reuse G1 to verify, enrich, categorize, vectorize and publish the created agent.
- [ ] **Planned:** Reuse the EOA buyer G2 hiring path to hire it and prove T6 revocation rejects the next delegated provider/agent write.

### T8 remaining

- [ ] **Planned:** Pin the Greenfield SDK, provider and network.
- [ ] **Planned:** Publish one approved public profile and one completed-job bundle.
- [ ] **Planned:** Verify seal, readback and matching hash; persist status/locator and show links.
- [ ] **Planned:** Prove interrupted retry does not create a duplicate object and storage failure does not break browsing or hiring.

### T9 remaining

- [ ] **Planned:** Verify current migrations, build, deployed SHA, cron and public browser journey.
- [ ] **Planned:** Walk through four-category discovery, one paid cycle/review, one Creator grant/revoke flow and two Greenfield links.
- [ ] **Planned:** Complete three real Agent Advantage comparisons, including one trading, stock/equities or security task.
- [ ] **Planned:** Finish the submission script, evidence references, honest blockers and rollback commands.

## G1 — Marketplace pipeline (T1–T3)

Status: Completed for the previously accepted retained/local scope. Stable public HTTPS/deployed-browser alignment remains a final-preview follow-up and is not claimed here.

### T1 — Persistent cron and health refresh

Status: Completed (retained-runtime scope); final-host operation remains a documented follow-up.

Owner: DATA/OPS. Paths: ingestion/composition scripts, job/repository code, cron/supervisor config. Risk: stateful; deployment/secret changes require the corresponding review.

- Add two ordinary locked cron jobs: bounded discovery/enrichment every five minutes; published-service health every minute. Separate locks/timeouts so vendor discovery cannot block health. Reuse existing database/reader/probe/publication code.
- Persist scan progress and per-identity retry state. Resume after restart, process more than one batch and do not repeatedly select only the same failures. Avoid overlapping invocations and log only safe counts/reasons.
- Align browse-health staleness to two minutes as specified in the master plan; keep real timestamps and immediate pre-action checks. Refresh unchanged listings without new versions/vectors.
- Keep direct events disabled until the current runner has the same probe/category/publication wiring and durable overflow/retry handling. Fix it within this task if used; scheduled finalized reads are sufficient for the first MVP.
- Document install/start/stop/status/recovery commands and start the public preview configuration while inspecting existing host access.

Done: cron runs against retained data for 30 minutes, survives process restart, shows new/updated real agents, preserves history and expires stale health accurately. No lost batch or false success. Test any new migration on disposable DBs first.

### T2 — Enriched listing, search and real metrics

Status: Completed for the accepted retained scope; bounded qualified-supply growth and semantic-provider release remain follow-ups.

Owner: WEB/DATA. Parallel with T1; disjoint files agreed by coordinator. Paths: marketplace read/publication model, web API/components, scoped enrichment adapters. Shared schema/lock changes assigned to one owner.

- Use current cards/detail/compare UI. Display category, public capabilities/services, current-data source/time, last check, observed uptime/window, real reviews, completed jobs and last result/price.
- Normalize available ERC-8004/vendor feedback and external job statistics with provenance. Keep missing data explicit; BNBEra's own jobs/reviews are surfaced by T5 only after a confirmed settlement. No invented ratings, revenue, task results or zero-price assumptions.
- Ingest non-revoked ERC-8004 Reputation Registry feedback with reviewer, feedback index, fixed-point value/decimals, tags, URI/hash, block/time and revocation provenance. Show separate views for raw permissionless feedback, recognized reviewer/validator evidence, and the verified-purchase reviews created by T5; never expose a Sybil-prone unfiltered average as a trusted rating.
- Distinguish card and invocation URL and advertised versus tested skills. Fix the latest adapter's broad-schema shortcut without requiring every agent to invent a BNBEra-specific manifest. A usable service check is separate from an Agent Card GET.
- Enforce the same embedding lock at API/worker/backfill entry points. Verify current-version vectors and hard filters before semantic ranking; deterministic fallback must work.
- Build a bounded four-category real-supply inventory. Check labels on representative agents and ambiguous cases; show truthful empty categories until qualified supply exists. Reuse external supply before proposing a new reference agent.

Done: a real listing shows persisted enrichment and truthful metrics; semantic search retrieves it; refresh does not churn versions; unsupported skills are not described as tested. UI works for all four categories with explicit coverage gaps. Source-owned evidence changes coordinate with T1.

Reputation acceptance: the standards-locked bounded sync advances durable checkpoints, preserves reorg/revocation history and projects three provenance-separated views through the marketplace API and detail UI. The current bounded live sample observed zero feedback events; this is valid empty-chain evidence and the UI reports unknown rather than zero or a trusted rating.

### T3 — G1 acceptance and running public preview

Status: Completed for the accepted retained/local scope; public HTTPS deployment and deployed browser acceptance remain final-preview follow-ups.

Owner: QA/OPS. After T1/T2. Paths: targeted integration/browser checks, deployment/runbook, `docs/MVP-STATUS.md` created by this task.

- Run the production build against retained data and expose the web/API through the existing authorized topology. Vercel cannot reach the host's loopback DB; use a supported HTTPS API or approved private connection. Do not expose PostgreSQL publicly.
- Verify one full real flow: discovery -> finalized identity -> enrichment -> category -> embedding -> publication -> API -> browser. Confirm persistence after cron/web restart and semantic failure fallback.
- Check filters, category routes, compare, detail, current metrics and stale health; keep partial supply acceptance explicit. Use a small real sample and existing tests, not a new test platform.
- Record public/deployed SHA, the 30-minute cron result, identity tuples and exact missing categories. Complete the G1 checklist in the master plan.

Done: G1 accepted for the actual demonstrated scope and public preview kept running. Missing supply remains tracked through T5; do not equate four empty routes with four working categories.

## G2 — Paid hiring (T4–T5)

Status: Pending; the 2206 marketplace/tunnel sub-gate passed, while interactive EOA browser acceptance remains. T4 backend/canary is accepted; T5 does not pass the gate until agent 2206 completes the connector/SIWE browser-to-chain useful-result, settlement and review run.

### T4 — ERC-8183 escrow backend

Status: Completed (backend/canary scope) on merged PR #18 (`main` merge `7a0a480`); G2 remains pending on T5.

Owner: COMMERCE. After G1; read-only contract feasibility can begin during T3. Paths: commerce package, persistent job repository, API/chain adapters; standards lock owned by coordinator.

- Resolve official deployment/ABI/token/policy pins. The APEX source at pinned commit `b40b18011407ba13516661d3784bcb727a0c7794` and the installed `@altananetwork/sdk@0.9.0` agree on chain-97 Commerce `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, Router `0xd7d36d66d2F1B608A0F943f722D27e3744f66F25`, OptimisticPolicy `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` and token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`. Record and runtime-verify all four before enabling a development canary; source agreement is not bytecode/linkage/token or paid-cycle evidence.
- Keep the pinned SDK calls (`hireErc8183Agent`, `submitErc8183Deliverable`, `settleErc8183Job`, `buildClaimRefundCall`, `getErc8183Job`) for the retained T4 canary and provider-side execution where applicable. The MCP package exposes these to chat hosts but is not an application runtime dependency. T5 buyer writes use the named EOA adapter below; do not route them through the SDK's atomic relay.
- Keep only a thin application boundary around both paths. Its purpose is to persist the marketplace job and idempotency key, bind it to the full ERC-8004 identity/version, reconcile receipts after timeout/reload, verify results and expose safe APIs for T5. The EOA adapter is a single named APEX/ERC-8183 transaction boundary, not a second escrow or arbitrary calldata writer. Direct contract reads may independently verify outcomes.
- Wire quote, explicit buyer funding, provider work, deliverable submission, buyer approval/dispute and settlement into one canonical PostgreSQL job/transaction lifecycle that recovers after restart.
- Bind authenticated buyer/provider identities to both persisted and on-chain actors. Keep the local SHA-256 evidence digest separate from the SDK canonical-manifest Keccak; persist the expected Keccak before submit and verify the exact returned `manifestText` bytes.
- Validate actor/network/token/recipient/amount and operation-specific contract events. A generic successful receipt plus current job state is not enough, and reconciliation must accept a job that legitimately advanced after the original operation. Preserve calls IDs/transaction hashes after post-check failures. Handle expiry/refund and unknown outcomes without duplicate charge or auto-approval; dispute must not require a prior approval.
- Return an input/output contract and a small real task fixture to T5. Use a service that produces a useful result; a funding acknowledgement is insufficient.

Done: real authorized testnet hire, submit and buyer settlement were confirmed; disposable-PostgreSQL reload, same-key duplicate protection and deterministic unknown-outcome no-rebroadcast behavior passed. The bounded fixture proves escrow plumbing, not useful execution by a discovered agent. Release remains disabled and G2 is not accepted until T5 completes that browser journey.

### T5 — Hire UI, result, jobs and reviews

Status: Pending: implementation is present in unmerged `task/t5-browser-commerce` (`717730b`), the 2206 marketplace/tunnel sub-gate passed, and interactive EOA live acceptance remains release-gated.

Owner: WEB. Parallel with T4 after their API contract is agreed; real acceptance depends on T4. Paths: existing detail CTA, job/result routes, review/read-model projection.

Current branch evidence: commerce 54/54, web 55/55, ingestion 115/115, and reference-registration/worker scripts 12/12 focused tests pass. The authorized quick-tunnel marketplace evidence also passed: URI transaction `0xe023...c9b` at block `129625704`; finalized sync `129619955–129625757` with 65 observations across 8 identities; 2206 verified/live/published health-factor status with healthy card/invocation; persisted vector/hybrid evidence from the prior run; and the fixed `0.001 U` local ERC-8183 activation offer enabled. These checks establish the marketplace/tunnel sub-gate only, not the interactive EOA connector/SIWE-to-chain commerce gate; the quick tunnel is canary-only with no uptime guarantee and `releaseEnabled=false` remains.

- Add task form -> quote/price confirmation -> WalletConnect (MetaMask/compatible wallet) EOA/SIWE -> sequential wallet funding -> progress -> result -> buyer approval -> confirmed settlement. Preserve state on reload. The branch contains the browser composition and safe dispatch/recovery APIs; the EOA adapter and live chain proof are pending.
- Count only confirmed completed marketplace jobs; link the receipt/result. Allow one authenticated buyer review per completed job. Keep external reputation separate. The persisted projection and one-review guard are implemented and test-covered.
- Bind each verified-purchase review to the completed ERC-8183 job, exact ERC-8004 identity/version and result digest. Project three labeled reputation views on cards/detail: raw ERC-8004 feedback, recognized reviewer/validator evidence, and BNBEra verified-job reviews; revoked feedback leaves active aggregates without erasing history.
- [x] Verify agent 2206 through the authorized HTTPS tunnel/card, finalized reingestion and publication; the marketplace sub-gate passed with healthy card/invocation and verified/live/published health-factor status.
- [ ] Complete the same useful activation/result journey across the four category candidates from T2. An unavailable category remains an explicit submission blocker, not a fake listing.
- Record the remaining G2 evidence and ensure the public preview stays usable. The current quick tunnel is canary-only with no uptime guarantee and is not a final public-preview claim.
- Capture the first of the three required Agent Advantage comparisons: same task with the marketplace agent and without it, including elapsed time, cost, output and quality assessment. T9 completes the report; at least one comparison must be trading, stock/equities or security-related.

Acceptance target (not yet met): a user completes the real paid journey inside the app; job count and review update correctly; errors and cancellation are intelligible. G2 requires T4 and T5; four-category coverage has its own explicit row in the status document.

## G3 — No-code Creator with Altana (T6–T7)

Status: Planned. T5 passkey bootstrap is not an authenticated commerce prerequisite; no Altana grant/revoke/deny or Agent Studio end-to-end evidence is accepted. External discovery, browsing and hiring remain independent of Altana.

### T6 — Altana wallet/session bootstrap

Status: Planned; this task owns custody/session authority, not agent creation.

Owner: CUSTODY. After G2. Paths: Altana package, existing Studio spike and a small authority UI; pins through coordinator.

- Pin the SDK/runtime/contract details actually used. Prove user-controlled browser wallet, exact call/spend/expiry approval and bounded session handoff through the supported Studio secret path.
- Confirm one allowed testnet action, revoke in the product, and prove the next equivalent write is rejected. Verify expiry/over-cap denial; never expose root/session secrets.
- Give T7 the tested grant/status/revoke interface and supported deployment/session handoff. Keep external marketplace use independent of Altana.

Done: real grant/action/revoke/deny evidence, public authority display and only secret references in PostgreSQL. Local policy tests alone do not pass.

### T7 — One-template no-code creation

Status: Planned. **This is the BNB Agent Studio user-creation task.**

Owner: CREATOR/WEB. After T6; form/template preparation can run in the second slot against agreed interfaces. Paths: Creator/deployment persistence, Studio integration, create/dashboard UI.

- Use one audited template, ideally filling a supply gap. Accept validated parameters only; invoke the pinned `@bnbagent/studio-cli` / `@bnbagent/studio-runtime` supported deployment path rather than building a general orchestration service. Verify the runtime package integrity before enabling deployment.
- Connect the user-controlled Altana grant from T6 to the Agent Studio deployment/runtime handoff. Store only secret references; external marketplace discovery and browsing must remain independent of Altana and Agent Studio.
- Persist deploy progress/retries, intended ERC-8004 owner and agentWallet. Reuse G1 verification/publication and G2 hiring; no duplicate runtime or token on retry.
- Provide authority status/expiry, pause, renewal and revoke controls. Keep one active created agent per wallet; no arbitrary user code.

Done: create -> deploy -> register -> list -> hire works from the browser; user controls Altana and revocation stops writes. Gate G3 passes with one template; Greenfield is not a prerequisite.

Do not add Altana x402/B402 or another payment rail in this MVP. Any partner-track
payment experiment remains disabled and cannot delay or alter the single
ERC-8183 buyer path.

## G4 — Greenfield and final demo (T8–T9)

Status: Planned; no Greenfield or final public walkthrough evidence is accepted.

### T8 — Publish two useful Greenfield artifacts

Status: Planned.

Owner: EVIDENCE. After G3. Paths: current evidence/Greenfield publisher, profile/job evidence panel; pins through coordinator.

- Pin provider/SDK/network. Publish one public profile and one completed-job bundle with approved public fields, result digest and receipt references.
- Verify seal, readback and matching hash; persist locator/status and show links. Resume an interrupted upload. If the same deliverable is in IPFS, compare hashes.
- Keep raw monitoring data, secrets and unapproved private task inputs out. No mirrors or custom contracts.

Done: two real verified artifacts visible in the app. Gate G4 passes without making storage availability a prerequisite for browsing or hiring.

### T9 — Final public walkthrough and submission

Status: Planned.

Owner: QA/RELEASE. Prepare in parallel with T8; final verification after all selected gates.

- Run relevant build/tests and current migration checks. Verify the public deployed SHA and cron remain running.
- Walk through four-category find/compare/understand/activate, one WalletConnect (MetaMask/compatible wallet) EOA paid escrow cycle with review/job update, one separate Altana Creator/revoke flow and the two Greenfield links.
- Produce a short demo script and current `MVP-STATUS.md`: each gate pass/fail, evidence references, unresolved network/category/access gaps and rollback command. Confirm submission cutoff and avoid cosmetic work during the final verification window.
- Complete the required Agent Advantage Report with at least three real paired runs (agent versus manual/baseline), attached outputs and time/cost/quality measurements; include at least one trading, stock/equities or security task.

Done: publicly accessible MVP and honest evidence for every claimed feature. Functional gaps block their claim; minor visual polish does not block the demo.

## Two-agent dispatch

Before dispatch, check only the prerequisites for the next milestone:

- G1: existing Docker DB access, working BSC RPC and 8004scan credentials, pinned embedding configuration, and an authorized public-preview host. Rotate the previously flagged 8004scan credential before release; never copy its value into a handoff.
- G2: reviewed ERC-8183 deployment/ABI/policy, asset/recipient/network, funded EOA test wallet, WalletConnect connector and explicit authorization for the paid canary. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is public runtime configuration for the connector, not a secret or standards-lock pin.
- G3: pinned Altana/Studio versions, supported browser/passkey environment, deployment access and explicit testnet-write authorization. These are Creator prerequisites, not external-agent browsing/hiring prerequisites.
- G4: pinned Greenfield provider/SDK, storage credentials and approval for any paid resources.

Record a missing prerequisite with its exact owner/request in `MVP-STATUS.md`; continue independent work without inventing configuration or passing the affected gate.

| Round | Slot A | Slot B | Exit |
| --- | --- | --- | --- |
| 1 | T1 cron/health | T2 enriched web/search | Coordinator reviews both; T3 verifies G1 |
| 2 | T4 escrow | T5 hire UI | G2 paid result and metrics |
| 3 | T6 Altana | T7 template/form preparation, then integration | G3 real Creator and revoke/deny |
| 4 | T8 Greenfield | T9 demo/QA preparation | G4 and final walkthrough |

Replace a finished agent only after reviewing its work. Give the replacement task ID, isolated checkout/base SHA, owned paths, current contracts, gate, required secret names only and concrete acceptance. Use the requested Luna/max configuration when available and report actual availability. This planning update does not itself launch implementation agents.
