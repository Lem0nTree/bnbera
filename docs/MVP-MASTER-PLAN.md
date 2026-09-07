# BNBEra MVP master plan

Status: active scope, following the user's simplified MVP direction. Updated: 2026-09-07.
Implementation baselines: merged GitHub `main` at `41f9d4521ca4391b9fdfe9fe1d949d5652ceb3b5`; the local retained `main` checkout also contains follow-up reputation projection fix `84c2c6a` (not treated as a GitHub merge claim); current unmerged T5 checkout `task/t5-browser-commerce` at `df92d4931de6197f0fbaef64c1e97486e1775b5c`.
This plan supersedes the archived plans. It defines the intended MVP; branch-only implementation and unit tests are not gate acceptance. The source-of-truth interpretation of the competition rubric is [HACKATHON-REQUIREMENTS.md](HACKATHON-REQUIREMENTS.md).

## Product and delivery order

Build one useful ERC-8004 marketplace: find an agent, understand its data and record, pay it for a task, receive a result, then create an agent without code. Finish with a small Greenfield integration.

1. **G1 — Persistent marketplace:** scheduled discovery -> filter -> enrich -> categorize -> vectorize -> persist/publish -> browse/detail/compare with real metrics.
2. **G2 — Paid hiring:** one ERC-8183 escrow journey from quote and funding to useful result and confirmed settlement.
3. **G3 — No-code Creator:** one audited template, Agent Studio deployment and user-owned Altana wallet/session controls.
4. **G4 — Greenfield:** store a public profile and completed-job bundle, verify readback and link them in the marketplace.

Use the existing Next.js UI, PostgreSQL/pgvector Docker database and packages. Use ordinary cron with process locks, bounded work and small persisted retry state. No new broker, database, multi-cloud framework, second payment rail or general-purpose builder.

The main-track product goal remains four useful categories: rebalancing, grid trading, yield optimisation and health-factor monitoring. Start each integration with one real agent, then apply the same flow across the four categories. One-agent technical acceptance does not claim full category coverage. The published hackathon rubric prioritizes category discovery, useful current data and activation; the final demo must be public. [Official requirements](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks).

## Gate status at this reconciliation

| Gate | Status | Tasks | Evidence and blocker |
| --- | --- | --- | --- |
| G1 | Completed (accepted demonstrated scope) | T1–T3 | T1/T2/T3 retained/local acceptance is complete. Stable public HTTPS/deployed-browser alignment remains a final public-preview follow-up and is not claimed here. |
| G2 | Pending; live tunnel acceptance required | T4–T5 | T4 backend and authorized chain-97 canary are accepted on merged `main`. T5 browser/result/review code is present in the unmerged branch, but no accepted browser-to-chain useful-result, settlement and review run exists yet. |
| G3 | Planned | T6–T7 | Passkey bootstrap is a T5 authentication prerequisite; no Altana grant/revoke or Agent Studio creation flow is accepted. |
| G4 | Planned | T8–T9 | Greenfield pins, upload/readback evidence and final public walkthrough remain open. |

### Task status checklist

| Task | Status | Evidence | Missing acceptance or follow-up |
| --- | --- | --- | --- |
| T1 | Completed (retained scope) | Locked discovery/health jobs, durable cursor/retry state, bounded restart-safe work and freshness expiry are accepted. | Reinstall from the immutable public-preview checkout for final-host alignment. |
| T2 | Completed (retained scope) | Enrichment, evidence-backed categories, vectors, deterministic fallback, marketplace projections and three provenance-separated reputation views are accepted. | Grow qualified four-category supply; semantic release remains blocked by the candidate standards lock. |
| T3 | Completed (retained/local scope) | Production build/read model, local API/SSR routes, restart persistence, stale-health and fallback checks are accepted for the demonstrated scope. | Stable authorized HTTPS/deployed-browser evidence is still required before a final public-preview claim. |
| T4 | Completed (backend/canary scope) | Merged ERC-8183 boundary and authorized chain-97 hire -> submit -> explicit approval -> settlement canary passed, with reload/duplicate/unknown-outcome safeguards. | T5 must prove useful work from a callable marketplace agent; `releaseEnabled=false` remains. |
| T5 | Pending (branch implementation; live acceptance) | Browser quote/fund/result/settle/review composition, root-backed WebAuthn, fresh passkey bootstrap/recovery, exact registry fixes, guarded 2206 registration, reference provider and disabled worker are implemented and focused-tested. | 2206 needs an authorized HTTPS tunnel/card and finalized reingestion, followed by the browser-to-chain useful-result, settlement, review and Agent Advantage evidence. |
| T6 | Planned | Altana/Creator boundaries and candidate pins only. | Implement and live-test grant/status/revoke, expiry and cap behavior. |
| T7 | Planned | No accepted no-code Creator flow. | Ship one audited Agent Studio template with idempotent register/list/hire. |
| T8 | Planned | Publisher abstractions only. | Pin Greenfield provider/SDK and verify profile/result seal/readback hashes. |
| T9 | Planned | Requirements and gate structure only. | Complete public walkthrough, current evidence and submission package. |

## Current implementation — what we can rely on

| Area | Current evidence | Remaining MVP work |
| --- | --- | --- |
| Frontend | Browse, four category routes, detail, search/filter and compare already exist. The unmerged T5 branch adds authenticated browser commerce with root-backed WebAuthn, fresh passkey `execute([])` activation whose SDK supplies `initialRegisterKey`, reload/recovery, quote/fund/result/approval/review controls. | Live activation/results remain unproven; no redesign |
| Discovery/publication | 8004scan transport and bounded composition runner; T1/T2 are merged. The T5 branch fixes exact ERC-8004 registry-log decoding and identity upsert ordering, and adds a guarded owner-authorized reference-registration harness for the chain-97 reference identity 2206. | A public card/service URI is still required for 2206: its current `http://localhost` URI is rejected by safe ingestion. Reingestion/publication and live data refresh remain pending. |
| Retained database | September 6 retained snapshot: 2,120 identities/agents, 25 published listings, 39 versions, 29 locked 1536-dimensional vectors, zero reputation events and one durable reputation checkpoint | More useful supply and fresh observations |
| Categories/vectors | Deterministic classifier, provider adapter and 1536-dimensional pgvector storage | API lock enforcement, a real semantic query and four-category supply checks |
| Health | The retained status record reports 14,216 service probes (13,216 healthy) and 39/39 healthy services at its snapshot; public-preview alignment and a current deployed run remain unaccepted | Scheduled measurements, honest uptime and freshness |
| A2A | Valid card fields and skill descriptions are parsed | Card availability is not tested skill execution; retain callable endpoint and verify the real result |
| Direct events | Reader/reorg/checkpoint components exist; audit found no retained checkpoint | Reuse only after missing probe/category wiring and bounded handoff are fixed; not a separate platform project |
| Hiring | Merged ERC-8183 SDK boundary, PostgreSQL lifecycle/reconciliation, safe APIs and a confirmed chain-97 operator canary. The T5 branch adds quote reservations, browser-owned SDK signing/reload recovery, persisted result/review projection and a disabled-by-default reference-provider worker. | A live tunnel run must show authenticated browser authority, useful callable-agent work, exact result evidence, confirmed settlement and a verified-purchase review. `releaseEnabled` remains false. |
| Altana/Creator | T5 adds browser passkey bootstrap/reconciliation and a server WebAuthn session boundary; this is not Creator acceptance. | One real bounded Altana grant/action/revoke path, then one Creator template |
| Greenfield | Publisher abstractions and integrity tests | Pin SDK/provider and publish/read back two real artifacts |

Focused T5 checkout tests passed: `@bnbera/agent-commerce` 54/54, `@bnbera/web` 55/55, `@bnbera/agent-ingestion` 115/115, and the reference-registration/worker scripts 12/12. These are implementation evidence only; they do not prove live paid execution, custody, uptime or public deployment. The old complete-pipeline artifact remains false; new gate evidence must be captured at the accepted implementation SHA.

## G1 — Persistent discovery and enriched marketplace

Status: Completed for the previously accepted retained/local scope. Stable public HTTPS/deployed-browser alignment remains an explicit final-preview follow-up; the T5 pipeline fixes are not a replacement for that follow-up.

Run discovery about every five minutes and health refresh every minute as independent, locked cron jobs. Persist progress, per-identity retry/next-attempt and failure reasons in PostgreSQL. Twenty candidates is a batch size; later runs must progress through the remaining candidates rather than repeat the same twenty. A vendor timeout must not block health refresh or serving.

Use 8004scan as discovery and direct finalized registry reads as identity truth. Normalize the complete identity, reject wrong network/registry and unsafe URLs, resolve registration metadata and advertised services, then store category, capabilities, public enrichment, versions and vectors. Reuse the same pipeline for manual identities. Direct-event replay can be added after this normal path works; do not claim continuous event synchronization until its handoff is durable.

Keep all four categories plus `uncategorized`; do not assign unrelated agents just to populate a category. Copy public skill descriptions accurately, distinguish advertised from tested capabilities, and preserve both the card URL and actual invocation URL. A card GET or a broad JSON object schema cannot prove a useful service result.

The web/API and workers must use the same pinned embedding provider/model/version/dimension. Enable release semantics after testing one real query and fallback; fix the API's current missing lock validation. Embed stable public descriptions/capabilities, never prices, balances, live financial data, private inputs or secrets. Unchanged profiles and health ticks must reuse the current version/vector.

### Data shown on cards and detail

| Field | MVP source and behavior |
| --- | --- |
| Identity, category, description, capabilities/services | Finalized ERC-8004 reads plus validated public registration/card data, with source and observation time |
| Current agent/protocol data | Timestamped provider response or verified protocol read; include units/network/block when relevant; unavailable is explicit |
| Availability | Last real service check and its result; distinguish card reachability from tested task availability |
| Uptime | Successful checks / attempted checks for a displayed monitoring window, plus sample count/coverage. Missing periods are unknown; never imply a continuous record from one probe |
| Reviews/reputation | Keep three provenance-separated views: non-revoked raw ERC-8004 feedback, feedback from allowlisted/recognized reviewers or validators, and BNBEra verified-purchase reviews bound to a confirmed G2 job/result. Show score/count/tags/reviewer/observation time and revocation status when available. Never present an unfiltered permissionless aggregate as a trusted rating or mix vendor feedback with verified jobs |
| Completed jobs | Confirmed BNBEra job results/settlements from G2; external counts may be shown separately with their source. Do not mix sources or count registrations/acknowledgements as completed work |
| Price, recent result and receipt | Advertised/confirmed quote and actual task/chain records. Unknown price is not free |

Proposed cron-friendly policy: mark **browse availability** stale after two minutes without a successful current check, replacing the current 60-second listing-health window during T1. Display the actual timestamp. Execution still rechecks the service and any required current financial/authority state immediately before action; this does not relax execution-data freshness.

**Gate G1:** a real fetched identity survives cron and web restarts; enrichment/category/vector are persisted and shown through API and UI; unchanged refresh creates no duplicate identities/versions; failed candidates are isolated; fresh healthy supply stays visible for a 30-minute run; stopping health checks makes availability stale. Semantic query and deterministic fallback both work. Four category routes work, a category supply report exists, and missing external reviews/jobs/data are honestly labeled. Public preview setup starts here.

### ERC-8004 reputation projection

Ingest Reputation Registry feedback by the full identity scope and configured registry address. Preserve `clientAddress`, `feedbackIndex`, signed fixed-point value/decimals, tags, revocation state, feedback URI/hash and observation block/time. A feedback URI is evidence, not trusted application data; fetch it through the same bounded public-URL safety controls as other metadata. Index chain events incrementally and make replay/reorg handling idempotent.

Permissionless feedback is Sybil-prone. The UI may show its raw count and distribution, but the primary trust panel must distinguish: **raw on-chain feedback**, **recognized-reviewer/validator evidence**, and **verified BNBEra job reviews**. A verified-job review requires the authenticated G2 buyer, a confirmed completed settlement, the matching agent identity/version and result digest, and at most one active review per job. Revoked feedback is excluded from active aggregates but retained in history. Do not collapse these sources into one star rating.

## G2 — Hire, escrow, result, settlement

Status: T4 backend/canary complete; T5 implementation is present in the unmerged checkout; G2 remains pending. Do not mark G2 complete until an authorized HTTPS tunnel run drives agent 2206 from the browser through escrow, a useful callable result, exact result verification, confirmed settlement and one authenticated verified-purchase review, with reload/duplicate and unknown-outcome evidence.

Implement **one ERC-8183 rail** using the pinned `@altananetwork/sdk@0.9.0` against the reviewed APEX deployment. The policy-address conflict is resolved at the source level: the APEX `scripts/addresses.ts` file at the standards-lock commit and the installed SDK agree on chain-97 Commerce `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de`, Router `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25`, OptimisticPolicy `0xd6a4217588f6b1f5657a92a3e94e6422ad771cea` and payment token `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`. Bytecode, proxy/linkage, policy allowlisting and token metadata are runtime-verified; the authorized canary passed. Release remains disabled pending T5 browser/useful-result acceptance. Do not add x402/B402 to this MVP.

T4 backend acceptance is complete on merged PR #18 (`7a0a480`): the deployment checks, canonical persistence, operation-specific reconciliation, explicit buyer decision and one distinct-actor chain-97 hire -> submit -> settle canary passed, including database reload and no-rebroadcast guards. This is backend evidence only. Its deterministic health-factor fixture does not prove that a discovered marketplace agent performed useful work, and the web authority boundary intentionally remains closed. T5 owns that browser-to-useful-result proof; `releaseEnabled` remains false until it passes.

The unmerged T5 checkout now supplies the browser-owned composition around that boundary: a server-created quote/reservation, explicit buyer funding, root-backed WebAuthn session, fresh passkey activation through browser-owned SDK `execute([])` (with SDK-supplied `initialRegisterKey`), persisted pre-send relay intent and read-only reload/recovery, exact result and receipt projection, buyer approval/dispute, settlement and one-per-job verified-purchase review. It also supplies a guarded registration harness and reference-provider worker for the health-factor reference identity. These features have focused tests but no live gate evidence yet. Agent 2206's current `http://localhost` registration URI is intentionally rejected by the safe ingestion path; a temporary authorized HTTPS card/tunnel and a fresh finalized ingest are prerequisites to the canary.

Use the Altana SDK directly in application code. `hireErc8183Agent` performs the atomic buyer batch; `submitErc8183Deliverable` canonicalizes and submits the provider result; `settleErc8183Job` approves or disputes; `buildClaimRefundCall` handles the expiry refund; and `getErc8183Job` supplies the chain read model. The Altana MCP exposes the same capabilities to AI chat hosts and is not an application dependency or a second integration path. Do not maintain a duplicate direct transaction writer.

BNBEra's thin commerce boundary still owns application safety and durability. Persist the canonical job, full ERC-8004 identity/version, calls ID, transaction hashes, actor and expected parameters before/through each transition. Bind buyer operations to the authenticated requester, execution wallet and both persisted/on-chain client; bind submission to the provider. Persist the SDK manifest Keccak separately from any local SHA-256 evidence digest and verify the exact served manifest bytes against the on-chain deliverable. A successful generic receipt plus a current job status is insufficient: reconciliation must verify the operation-specific contract event/job and tolerate a valid later state. Unknown outcomes are reconciled before retry. Settlement is never automatic buyer approval; dispute does not require a prior approval. Refund is allowed only under the pinned protocol's expiry rules.

ERC-8183 is selected because this milestone sells outcome-based work: escrowed budget, named client/provider/evaluator, explicit `Open -> Funded -> Submitted -> terminal` state, deliverable digest, rejection and expiry/refund. Those records map directly to completed-job evidence and an ERC-8004 verified review. The official Altana track also names ERC-8183 hiring as a bonus. x402 is an HTTP payment challenge/authorization mechanism optimized for paying to access a request or resource; by itself it does not provide the job, result acceptance, dispute or refund lifecycle required here. Keep it out of G2, then add at most one bounded paid capability after the core hire and Altana session flow if time permits; this targets the separate x402/B402 partner bonus without replacing ERC-8183.

User flow: select agent -> enter task -> review quote/budget -> explicitly fund escrow -> agent performs work -> result/deliverable appears -> buyer verifies its exact canonical bytes and approves or disputes -> settlement confirmed. Persist job ID, buyer/provider, full agent identity/version, quote, status, calls ID, transaction hashes, local evidence digest, on-chain deliverable Keccak and result URL. Use IPFS only if the selected Studio/ERC-8183 deliverable path needs it; Greenfield comes later.

Handle cancel/expiry/refund or rejection according to the pinned deployment, and reconcile unknown outcomes before retrying. A quote, HTTP 200, funding acknowledgement or settlement without useful work is not successful task completion. The backend never auto-approves for the buyer. Reviews attach to confirmed completed jobs and preserve reviewer/job provenance.

**Gate G2:** one real authorized paid cycle passes from browser to escrow to useful result and confirmed settlement, including page reload and duplicate-submit protection; one negative/unknown-outcome recovery is verified. Completed-job count and buyer review appear in the profile. Then prove the same usable activation/result flow for each category selected for the main-track demo; record category gaps explicitly.

## G3 — No-code creation with Altana

Status: planned (T6–T7). The T5 browser passkey bootstrap is only an authenticated commerce prerequisite; it does not prove an Altana grant, revocation/deny path or Agent Studio deployment.

Altana is required for this created-agent custody path, not for external agent discovery or ordinary marketplace use. It also governs the created agent after setup: current session checks, renewal, expiry and revocation. Externally discovered Altana agents may show verified authority without being redeployed.

First prove the pinned browser-controlled wallet -> bounded session -> Studio/runtime handoff -> one permitted testnet action -> user revoke -> next equivalent action denied. Resolve the existing Altana address/runtime pins and use supported SDK APIs. The user keeps administrative control; the platform receives only the bounded session through the secret channel.

Then ship one audited template: choose template -> enter validated parameters -> review call allowlist, spend cap and expiry -> approve Altana -> deploy with Agent Studio -> register intended ERC-8004 owner/agentWallet -> run existing verification/publication -> see agent in marketplace. Prefer a template that fills a category supply gap. Reuse supported Studio deployment and the existing server; no custom orchestration framework is required for the MVP. Store deployment steps and retry state in PostgreSQL, with secrets stored by reference.

**Gate G3:** a user creates one listed, callable agent without coding; intended identity ownership is verified; duplicate deploy does not duplicate runtime/registration; dashboard shows progress and authority; revocation rejects the next write. The created agent uses the G2 hiring path. No requirement to build four templates or integrate Greenfield first.

## G4 — Small Greenfield integration

Status: planned (T8–T9). No Greenfield SDK/provider pin or seal/readback evidence is accepted yet.

Publish only a versioned public agent profile and one completed-job result/receipt bundle. Reuse the publisher, pin SDK/provider/network, upload, wait for sealing, read back and compare the content hash. Store the locator/hash/verification time in PostgreSQL and show a link on the profile/job. If the deliverable also uses IPFS, verify matching bytes where the same artifact is copied.

Greenfield stores object metadata/integrity on its chain and payloads with storage providers; do not claim the JSON is inside BSC transaction calldata. No mirroring, custom anchoring contract, raw monitoring uploads or benchmark platform. Private task data is excluded unless the user explicitly approves its public publication.

**Gate G4:** both real objects are sealed and hash-verified after readback, with working public links. An interrupted upload resumes without a duplicate object; pending/failed evidence does not break hiring or browsing.

## Release and essential safeguards

Keep later gates disabled until they pass. Record a short result per gate: code/deployed SHA, identities/job/object IDs, commands, pass/fail and remaining limitation. No separate large audit program.

Use clearly labeled testnet for authorized paid/Creator canaries. The existing main-track chain-56/97 question remains unresolved: obtain organizer acceptance of chain 97 or use verified chain-56 supply for main-track claims. Read-only mainnet discovery is allowed; it does not authorize mainnet payments or strategy writes. No invented contract pins or automatic use of paid resources.

Before demo: public production build, persistent DB and cron, all four categories with useful real supply and activation evidence, one paid cycle, one Creator flow and the required three-task Agent Advantage Report. Add the two Greenfield links and one x402 seller canary only after that core path works. Run relevant build/tests plus one real browser walkthrough. Back up the retained DB before migrations, verify any changed migration on disposable data, and preserve the existing forward-repair history. Keep all six state axes and secret-reference boundaries. Remaining cosmetic polish is deferred.

Tasks: [MVP-TASKS.md](MVP-TASKS.md). Operations: [MVP-RUNBOOK.md](MVP-RUNBOOK.md).
