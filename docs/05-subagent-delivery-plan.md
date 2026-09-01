# BNBEra Subagent Delivery and Branch Plan

- **Status:** Execution plan for implementation
- **Audience:** Integration lead, coding subagents, reviewers, and release owner
- **Scope:** Complete the BNBEra hackathon platform described by the four architecture plans
- **Last updated:** 2026-09-01

## 1. Purpose

This document turns the BNBEra architecture into independently assignable workstreams. It defines:

- the branch and isolated worktree each subagent should use;
- the files and contracts each subagent owns;
- the local and external documentation each subagent must read;
- the access, test funds, and environments each subagent needs;
- dependencies, merge order, and release gates;
- the evidence required before a workstream is considered complete.

It is an implementation coordination document, not a replacement for the architecture plans. If this plan conflicts with an accepted architecture decision record (ADR) or a newer architecture revision, the ADR or newer revision wins and this document must be updated.

## 2. Architecture baseline must be created first

At the time this plan was written, the revised architecture documents were modified in the working tree but not yet committed. The visible `main` HEAD, `7b8d4b5`, predates those revisions and **must not** be used as an implementation base.

Before any implementation subagent starts, the integration lead must:

1. review and commit the four revised architecture plans together with this delivery plan;
2. record the resulting commit as `ARCHITECTURE_BASE_SHA` in the coordination issue or project board;
3. create `codex/platform-integration` from that exact SHA;
4. create or approve `config/standards.lock.json` before any onchain integration is merged;
5. publish the initial shared domain, API, event, and database contracts before dependent UI work begins.

No subagent may branch from an uncommitted working tree or from `7b8d4b5`. No implementation subagent commits directly to `main`.

## 3. Branch and worktree model

### 3.1 Permanent branches

| Branch | Owner | Purpose |
|---|---|---|
| `main` | Release owner | Protected, demonstrable releases only |
| `codex/platform-integration` | A0 Integration Lead | Accepted workstream merges and integrated verification |

Each feature branch is short-lived and is deleted only after its work is merged and its evidence is retained.

### 3.2 Branch-cut rule

Wave 0 branches are cut from `ARCHITECTURE_BASE_SHA`. Later branches are cut from the latest green commit on `codex/platform-integration` after their dependency gate has passed. The exact base SHA must be written in every handoff.

Example for an isolated Windows worktree:

```powershell
git fetch origin
git worktree add ..\bnbera-foundation -b codex/foundation-domain <BASE_SHA>
```

An agent may not reuse another agent's worktree. Before opening a merge request, the branch must incorporate the latest accepted integration branch and rerun its required checks.

### 3.3 Parallel-agent safety

True branch-level parallelism requires a separate checkout or Git worktree for each agent. In-thread subagents that share one working directory also share the checked-out branch; they must not run concurrent `git switch`, `git checkout`, commit, rebase, or merge commands there.

Use one of these safe modes:

- **Preferred:** one Codex task or terminal per isolated worktree and branch.
- **Shared-working-tree fallback:** subagents edit only disjoint owned paths, never change branches, and the integration lead alone stages and commits their changes.

The planned execution limit is one integration lead plus no more than three active implementation agents in a wave. More named workstreams can be staffed sequentially by the same trusted agent; the names below describe ownership, not a requirement to run twelve agents at once.

## 4. Required reading for every subagent

Every subagent must read these files before changing code:

1. [`01-marketplace-donor-merge-plan.md`](./01-marketplace-donor-merge-plan.md)
2. [`02-greenfield-data-and-evidence-plan.md`](./02-greenfield-data-and-evidence-plan.md)
3. [`03-no-code-agent-deployer-plan.md`](./03-no-code-agent-deployer-plan.md)
4. [`04-bnbera-master-implementation-plan.md`](./04-bnbera-master-implementation-plan.md)
5. this delivery plan;
6. the repository `AGENTS.md`, if one is added;
7. `config/standards.lock.json`, once created;
8. relevant accepted ADRs under `docs/adr/`;
9. any shared schemas or interfaces their code consumes.

Agents using copied or adapted donor code must also read the donor repository's license, notice files, dependency manifests, and provenance notes. Code must not be copied until reuse rights and attribution requirements are recorded.

## 5. Non-negotiable implementation rules

All workstreams must preserve these architecture decisions:

- An ERC-8004 identity is keyed by the complete identity tuple, not by a shortened token or wallet address.
- ERC-8004 NFT ownership and the verified `agentWallet` are distinct concepts.
- `origin_type`, `claim_status`, `verification_status`, `runtime_status`, `authority_status`, and `listing_status` remain independent state axes.
- Agent endpoints and capabilities come from registered service metadata and probing. No code assumes universal `/a2a`, `/apex`, or `/health` routes.
- Marketplace eligibility is a public contract and must not be confused with BNBEra Creator implementation details.
- External agents can enter through 8004scan discovery, direct registry events, or manual import without being redeployed by BNBEra.
- The platform uses one pinned Agent Studio runtime and signer model for the hackathon. A second Fargate runtime tier is out of scope.
- Altana is the custody and delegated-authority boundary: the builder controls the root keys; runtime actions use scoped, limited, revocable authority.
- ERC-8183 commerce and X402/B402 request payment are separate rails with separate lifecycle and receipt models.
- Paid X402/B402 tests must prove the complete gateway, relay, payment, destination, asset, network, and settlement path.
- Greenfield publication is successful only after seal confirmation and readback/hash verification. “Submitted” is not “published.”
- BNBEra keeps embeddings over its verified and enriched marketplace representation; 8004scan search is an upstream discovery source, not a replacement for marketplace retrieval.
- No mock, placeholder, simulated transaction, or health response may be presented as a live capability.
- No secret, private key, passkey export, raw credential, or session token may be committed, pasted into prompts, stored in logs, or persisted in the application database. Persist secret references only.
- Mainnet writes, production DNS changes, paid external resources, and irreversible contract actions require explicit release-owner approval.

## 6. Shared contracts owned by the integration lead

The integration lead freezes the first usable version of these contracts before dependent branches start:

- canonical ERC-8004 identity type and serialization;
- marketplace state enums and legal transitions;
- discovered service and capability schema;
- public marketplace eligibility result with reason codes;
- deployment, job, payment, evidence, and health event envelopes;
- tRPC/HTTP API boundary and error envelope;
- database migration ownership and ordering convention;
- chain and contract-address lock format;
- feature-flag naming and default behavior;
- evidence locator and verification-result schema.

Changes to a frozen shared contract require an ADR or a clearly marked contract-change merge request. A feature agent may propose a change, but must not silently redefine a shared type inside its own package.

## 7. Workstream assignments

| Agent | Branch | Primary outcome | Wave | Requiredness |
|---|---|---|---:|---|
| A0 Integration Lead | `codex/platform-integration` | Baseline, contracts, integration, release promotion | All | Required |
| A1 Foundation | `codex/foundation-domain` | Buildable workspace, domain, database, auth, donor provenance | 0 | Required |
| A2 Altana | `codex/altana-bootstrap` | Proven scoped-session bootstrap and revocation path | 0 | Required |
| A3 Identity | `codex/identity-discovery` | Discovery, claims, services, finality, and reorg handling | 1 | Required |
| A4 Marketplace | `codex/marketplace-search` | Enriched retrieval, filters, ranking, and explanations | 2 | Required |
| A5 Commerce | `codex/commerce-rails` | ERC-8183 lifecycle and paid X402/B402 path | 1 | Required |
| A6 Creator | `codex/creator-studio` | Thin Studio deploy/register/verify/list lifecycle | 2 | Required |
| A7 Strategies | `codex/reference-strategies` | Protocol adapters and gap-driven reference strategies | 2 | Adapters required; extra agents conditional |
| A8 Evidence | `codex/greenfield-evidence` | Canonical artifacts and verified Greenfield/IPFS publication | 1 | Required |
| A9 Web | `codex/web-product` | Integrated marketplace, Creator, commerce, and evidence UX | 3 | Required |
| A10 Operations | `codex/infra-operations` | Least-privilege deployable infrastructure and observability | 3 | Required |
| A11 QA | `codex/qa-release` | Independent end-to-end and security release evidence | 3–4 | Required |
| A12 Submission | `codex/hackathon-evidence` | Claim-to-evidence index, demo, and optional bounty proofs | 4 | Core evidence required; extra bounties conditional |

### A0 — Integration and Architecture Lead

- **Branch:** `codex/platform-integration`
- **Concurrency role:** Coordinator; does not count as a feature workstream
- **Base:** `ARCHITECTURE_BASE_SHA`

**Goal**

Create the implementation baseline, establish shared contracts, integrate reviewed branches, resolve cross-package decisions, and promote only a reproducible release candidate.

**Owned paths**

- root workspace and repository governance files that are not delegated to A1;
- `config/standards.lock.json`;
- `docs/adr/`;
- shared contract definitions after A1's foundation merge;
- CI integration and release gates;
- integration merge log and release checklist.

**Must read**

- all architecture and delivery documents;
- official BNB Hackathon rules and current track requirements;
- official ERC-8004 and ERC-8183 specifications;
- pinned Agent Studio, Altana, 8004scan, Greenfield, B402, and AWS AgentCore documentation used by the implementation.

**Required access**

- repository administration and branch-protection settings;
- read access to all development environments and test evidence;
- organizer clarification channel for the BNB Chain 56/97 main-track requirement;
- authority to approve testnet configuration, but not automatic authority for mainnet writes.

**Deliverables and exit criteria**

- recorded `ARCHITECTURE_BASE_SHA` and integration branch;
- standards lock containing verified chain IDs, registry addresses, ABI/version hashes, payment asset, Greenfield network, and pinned dependency versions;
- initial contracts and migration allocation;
- green integration CI after each wave;
- explicit decision on the BNB Chain 56/97 eligibility gate before release promotion;
- release candidate merged to `main` only after A11 signs off.

### A1 — Foundation, Donor Intake, and Domain Model

- **Branch:** `codex/foundation-domain`
- **Base gate:** `ARCHITECTURE_BASE_SHA`
- **Wave:** 0

**Goal**

Create the buildable monorepo foundation and canonical domain layer, and extract only licensed, useful donor components behind BNBEra-owned interfaces.

**Owned paths**

- root `package.json`, workspace configuration, TypeScript configuration, lint/test configuration, and initial CI scripts;
- `packages/domain/`;
- `packages/db/` base client, migration runner, and migration conventions;
- `packages/config/` and common error/result utilities;
- authentication skeleton, including BetterAuth/SIWE integration boundaries;
- `docs/provenance/` for donor intake.

**Must read**

- Marketplace plan: repository strategy, donor extraction, data model, authentication, and security sections;
- Master plan: repository architecture, domain model, interface contracts, security, and testing sections;
- donor source license, notices, dependency manifests, and relevant implementation files;
- current BetterAuth and SIWE documentation for the versions pinned in the lockfile.

**Required access**

- read access to the donor repository and its Git history;
- development PostgreSQL with `pgvector` available;
- CI environment with no production secrets.

**Deliverables and exit criteria**

- clean install, lint, typecheck, unit test, and migration commands;
- canonical complete identity type and independent state enums;
- initial database schema with constraints and migration tests;
- authentication/session interfaces without embedded wallet secrets;
- donor provenance ledger showing source path, commit, license, modifications, and retained attribution;
- no imported component that bypasses the agreed domain or security model.

### A2 — Altana Bootstrap and Custody Boundary

- **Branch:** `codex/altana-bootstrap`
- **Base gate:** `ARCHITECTURE_BASE_SHA`
- **Wave:** 0

**Goal**

Complete the phase-zero Altana-to-Agent-Studio spike and select a technically proven bootstrap path before Creator implementation begins.

**Owned paths**

- `packages/altana/`;
- `spikes/altana-studio/`;
- custody and bootstrap ADRs under `docs/adr/` proposed through review;
- sanitized phase-zero evidence under `docs/evidence/altana/`.

**Must read**

- Creator plan sections covering custody, bootstrap alternatives, deployment sequence, security, and phase-zero acceptance;
- Master plan sections covering Creator, Altana, deployment, security, tests, and phase gates;
- pinned Agent Studio 0.0.13 CLI, deployment, `--wallet-kind altana`, A2A/MCP/X402, ERC-8004, and ERC-8183 documentation;
- official Altana SDK and scoped-session documentation.

**Required access**

- Altana developer environment and browser/passkey-capable test account;
- BNB testnet wallet with tightly bounded test funds;
- Agent Studio 0.0.13 environment;
- isolated AWS development account or sandbox secret store;
- permission to create and immediately revoke test sessions.

**Deliverables and exit criteria**

- reproducible evidence for: browser/passkey admin authorization → scoped session creation → Studio/AWS consumption → one permitted testnet action → revocation → next equivalent action rejected;
- documented session constraints, expiry, allowed targets/methods/value, and revocation behavior;
- explicit selection of bootstrap Alternative A or B with failure modes;
- no root key or reusable raw session credential in Git, logs, database, or evidence artifacts;
- an interface that A6 and A10 can implement without guessing custody behavior.

### A3 — Identity, Discovery, Claiming, and Reorg Indexer

- **Branch:** `codex/identity-discovery`
- **Base gate:** A1 merged and shared identity/state contracts frozen
- **Wave:** 1

**Goal**

Build external-agent ingestion and canonical identity synchronization across 8004scan, direct registry events, manual imports, ownership changes, and chain reorgs.

**Owned paths**

- `packages/agent-ingestion/`;
- identity, discovery-source, claim, service, probe, block-checkpoint, and reorg repositories;
- migrations allocated to this workstream by A0;
- discovery and claim contract tests.

**Must read**

- Marketplace plan in full;
- Master plan discovery, marketplace, state model, contracts, security, migration, and testing sections;
- official ERC-8004 specification and deployed registry ABIs from `standards.lock.json`;
- 8004scan developer/API documentation available to the project;
- BNB RPC finality and reorg guidance relevant to the chosen provider.

**Required access**

- 8004scan API/Pro credentials if required, stored only in the secret manager;
- at least two BNB testnet RPC providers for failover/comparison tests;
- registry deployment addresses and ABI/version hashes from the standards lock;
- test identities whose NFT ownership and `agentWallet` can be changed safely.

**Deliverables and exit criteria**

- idempotent ingestion from 8004scan, direct events, and manual import;
- deduplication by full ERC-8004 identity;
- dynamic service/capability discovery without hard-coded universal routes;
- claim verification that keeps NFT ownership distinct from `agentWallet`;
- stale/revoked claim behavior after transfer or authorization change;
- finality checkpoints, rewind/replay, reorg compensation, and source reconciliation tests;
- no marketplace publication side effect hidden inside ingestion.

### A4 — Marketplace Search, Filtering, and Matching

- **Branch:** `codex/marketplace-search`
- **Base gate:** A1 and A3 merged; marketplace eligibility and service schemas frozen
- **Wave:** 2

**Goal**

Build BNBEra's verified marketplace representation, semantic retrieval, hard filters, deterministic ranking, comparison data, and human-readable match explanations.

**Owned paths**

- `packages/marketplace/`;
- embedding, enrichment, category, health, price, and ranking repositories;
- marketplace API router/contract implementation;
- retrieval fixtures and relevance tests.

**Must read**

- Marketplace plan in full;
- Master plan sections for product behavior, categories, discovery, ranking, protocols, data model, interfaces, security, and tests;
- the A3 ingestion and eligibility contracts;
- pinned embedding-provider and `pgvector` documentation.

**Required access**

- development PostgreSQL with `pgvector`;
- scoped embedding-provider credential supplied through the secret manager;
- sanitized agent corpus and explicit relevance fixtures;
- pricing/health sources defined in the standards lock or an accepted ADR.

**Deliverables and exit criteria**

- embeddings generated from BNBEra's verified/enriched representation, not blindly from upstream search results;
- semantic candidates combined with authority, protocol, health, price, runtime, and execution constraints;
- strict hard-filter behavior before ranking where required;
- stable ranking explanation and exclusion reason codes;
- deterministic tests for filtering and tie-breaking plus measured retrieval fixtures;
- graceful behavior when embeddings or an upstream source are unavailable.

### A5 — Commerce and Payment Rails

- **Branch:** `codex/commerce-rails`
- **Base gate:** A1 merged; standards lock and commerce event contracts frozen
- **Wave:** 1

**Goal**

Implement ERC-8183 job commerce and the complete paid X402/B402 request path as distinct but observable rails.

**Owned paths**

- `packages/agent-commerce/`;
- `packages/payment-gateway/` and relay configuration;
- commerce, payment-attempt, receipt, settlement, and reconciliation repositories;
- migrations allocated to this workstream;
- paid-canary and commerce lifecycle tests.

**Must read**

- Creator plan sections for B402/X402, ERC-8183, deployment security, and acceptance tests;
- Master plan commerce, payment, interfaces, data model, security, and testing sections;
- official ERC-8183 specification and deployed contract information from the standards lock;
- current X402/B402 gateway, relay, AgentCore, and merchant documentation used by the project.

**Required access**

- testnet BNB and the exact test payment asset selected in the standards lock;
- B402 merchant/gateway sandbox and fixed-egress test environment;
- test buyer/provider identities and approved payout addresses;
- an AgentCore test endpoint or equivalent accepted runtime target;
- read-only settlement explorer/API access.

**Deliverables and exit criteria**

- ERC-8183 create/fund/accept/submit/complete or dispute lifecycle with indexed receipts;
- X402/B402 challenge, payment authorization, relay, protected request, payout/settlement, retry, and reconciliation path;
- chain, token contract, amount, recipient, method, destination, and expiry pinned before payment;
- replay, duplicate payment, wrong asset/network/recipient, timeout, and partial-failure tests;
- one complete paid testnet canary with transaction and application receipt correlation;
- no claim that a generic HTTP 402 alone proves B402 integration.

### A6 — Creator and Agent Studio Deployment

- **Branch:** `codex/creator-studio`
- **Base gate:** A1 and A2 merged; A5 interfaces available; Altana bootstrap alternative accepted
- **Wave:** 2

**Goal**

Build the thin Creator MVP from validated configuration through Studio deployment, identity registration, verification, optional listing, pause, revocation, and destruction.

**Owned paths**

- `apps/deployer/`;
- `packages/creator/`;
- runtime/template manifests and audited reference-agent release tooling;
- deployment job orchestration and Creator-specific repositories;
- Creator API implementation, excluding UI components owned by A9.

**Must read**

- Creator plan in full;
- Master plan Creator, custody, deployment, protocols, interfaces, data model, infrastructure, security, and test sections;
- A2 custody ADR and bootstrap evidence;
- A5 payment/commerce contracts;
- pinned Agent Studio 0.0.13 deployment and protocol documentation;
- current AWS AgentCore, CodeBuild, SQS, and Step Functions documentation for the selected architecture.

**Required access**

- isolated AWS development account with least-privilege roles;
- Agent Studio 0.0.13 runtime and deployment tooling;
- Altana scoped-session integration established by A2;
- BNB testnet registry access and bounded test funds;
- test payment configuration from A5.

**Deliverables and exit criteria**

- versioned configuration schema and deterministic validation;
- idempotent deploy → wait → register → verify → list workflow with compensating cleanup;
- exactly one audited reference strategy in the first successful Creator path;
- deployment state visible through stable events and APIs;
- pause, authority revoke, listing pause/delist, and infrastructure destroy paths tested;
- complete testnet evidence from browser-authorized custody through a callable registered agent;
- no arbitrary user-supplied code execution in the thin MVP.

### A7 — Protocol Data and Reference Strategies

- **Branch:** `codex/reference-strategies`
- **Base gate:** A1 merged; standards lock and strategy interface frozen
- **Wave:** 2

**Goal**

Provide typed protocol data adapters and only the minimum deterministic reference strategies needed to fill verified marketplace supply gaps.

**Owned paths**

- `packages/data-sources/`;
- `packages/reference-strategies/`;
- protocol fixtures, simulations, and strategy risk documents;
- category coverage report.

**Must read**

- Master plan category inventory, strategy selection, protocol integration, security, and testing sections;
- Marketplace plan eligibility and capability rules;
- Creator strategy schema and runtime interface from A6;
- official PancakeSwap, Venus, and Lista documentation and contract references pinned by the project.

**Required access**

- reliable BNB RPC and any approved protocol indexers;
- read-only historical/test fixtures;
- testnet or forked positions funded only as needed for bounded tests;
- marketplace category inventory from A3/A4.

**Deliverables and exit criteria**

- typed adapters with explicit units, decimals, block numbers, freshness, and error semantics;
- category coverage report that distinguishes discovered supply from BNBEra-created supply;
- reference strategies only for documented gaps, with deterministic constraints and fail-closed behavior;
- fork/simulation evidence for transaction construction and risk boundaries;
- no unsupported profitability, APY, safety, or execution guarantee;
- optional protocols remain disabled until their data and transaction paths pass the same gates.

### A8 — Greenfield Publication and Evidence

- **Branch:** `codex/greenfield-evidence`
- **Base gate:** A1 merged; canonical evidence locator and event contracts frozen
- **Wave:** 1

**Goal**

Implement canonical artifacts, IPFS plus Greenfield publication, seal/readback verification, immutable hashes, and the evidence index consumed by APIs and UI.

**Owned paths**

- `packages/greenfield/`;
- `packages/evidence/` if split from the Greenfield package;
- evidence, publication-attempt, verification, and locator repositories;
- migrations allocated to this workstream;
- publication and corruption/retry tests.

**Must read**

- Greenfield and evidence plan in full;
- Master plan data/evidence, interfaces, data model, security, operations, and test sections;
- official BNB Greenfield SDK, object, permission, seal, and readback documentation;
- pinned IPFS provider documentation.

**Required access**

- Greenfield testnet wallet with bounded funds;
- dedicated test bucket and approved provider endpoint;
- scoped IPFS pinning credential;
- test fixtures containing no secret or personal data.

**Deliverables and exit criteria**

- versioned canonical schemas and deterministic byte/hash generation;
- independent IPFS and Greenfield publication attempts with explicit states;
- Greenfield seal confirmation followed by readback and hash verification;
- retry/reconciliation behavior without automatic cross-network mirroring;
- corruption, missing object, timeout, duplicate, and provider-failure tests;
- API-ready verification result with timestamps, block/transaction references where applicable, and immutable locators;
- evidence artifacts that are sufficient for A11 to reproduce the check.

### A9 — Web Product and User Experience

- **Branch:** `codex/web-product`
- **Base gate:** A3, A4, A5, A6, and A8 API contracts frozen; foundation UI shell available
- **Wave:** 3

**Goal**

Implement the real browser experience for discovery, comparison, identity/claim state, Creator, jobs, payments, deployments, and evidence without fabricating backend state.

**Owned paths**

- `apps/web/`;
- `packages/ui/`;
- browser mocks used only in tests and clearly isolated from production builds;
- browser E2E page objects jointly reviewed with A11.

**Must read**

- product-facing and UI sections of all four architecture plans;
- frozen APIs, state enums, reason codes, and event envelopes from A0 and feature agents;
- authentication/session contract from A1;
- accessibility and responsive-design requirements adopted by the project.

**Required access**

- integrated preview API environment containing synthetic, non-secret test data;
- wallet and SIWE test accounts;
- design tokens/assets approved for the submission;
- browser test environment with desktop and mobile viewports.

**Deliverables and exit criteria**

- marketplace search, filters, results, compare, and agent detail flows;
- clear ownership, claim, verification, runtime, authority, and listing state presentation;
- Creator configuration/deployment flow and deployment status timeline;
- ERC-8183 job and X402/B402 payment status/receipt views that keep the rails distinct;
- Greenfield/IPFS verification view with honest pending, failed, and verified states;
- responsive and keyboard-accessible critical flows;
- browser E2E tests using the integrated API, plus explicit empty/error/degraded states;
- no production fallback to fixture data or fake success responses.

### A10 — Infrastructure, Security Controls, and Operations

- **Branch:** `codex/infra-operations`
- **Base gate:** A2 custody choice accepted; A5 and A6 runtime/network contracts frozen
- **Wave:** 3

**Goal**

Create reproducible least-privilege infrastructure for the web, deployer, gateway/relay, indexers, workers, health monitoring, fixed egress, secrets, logs, and alerts.

**Owned paths**

- `infra/aws/`;
- `infra/vercel/`;
- `apps/health-monitor/`;
- infrastructure deployment/destroy scripts;
- operational runbooks, dashboards, and alert definitions.

**Must read**

- Creator plan infrastructure, custody, deployment, observability, security, and recovery sections;
- Master plan architecture, infrastructure, security, observability, operations, and release gates;
- A2 custody ADR;
- A5 gateway/relay network requirements;
- current official documentation for AWS AgentCore, IAM, Secrets Manager, SQS, Step Functions, CodeBuild, CloudWatch, WAF, VPC/fixed egress, and the selected web host.

**Required access**

- isolated AWS development account with role-scoped credentials;
- non-production web-host project and DNS only if explicitly authorized;
- secret-manager administration for development scopes;
- budget/usage limits and alert destinations;
- no production root credentials.

**Deliverables and exit criteria**

- repeatable provision, deploy, rollback, and destroy procedures;
- least-privilege IAM boundaries and separate build/runtime roles;
- secrets injected by reference and redacted from application/CI logs;
- fixed-egress and ingress restrictions required by the paid gateway path;
- queue retry/dead-letter behavior and idempotency support;
- service, dependency, chain-lag, payment, and publication observability;
- tested alerts and a concise incident/recovery runbook;
- infrastructure cost guardrails suitable for the hackathon.

### A11 — Integration QA, Security, and Release Verification

- **Branch:** `codex/qa-release`
- **Base gate:** Test harness may start after A1; final verification starts after Waves 1–3 merge
- **Wave:** 3 for harnesses, 4 for release sign-off

**Goal**

Independently verify the full user and data story from browser to API, database, chain, runtime, payment, and evidence storage. This agent owns verification, not feature implementation.

**Owned paths**

- `tests/e2e/`;
- `tests/security/`;
- `tests/integration/` for cross-package scenarios;
- `scripts/verify-*`;
- `docs/release-evidence/` and release-readiness reports.

**Must read**

- all architecture and delivery documents;
- all accepted ADRs and shared contracts;
- each feature branch's handoff and evidence package;
- current hackathon judging and submission requirements.

**Required access**

- integrated preview environment and read-only observability;
- separate buyer, provider, creator, and unprivileged test accounts;
- bounded testnet funds and Greenfield/IPFS test credentials;
- browser automation and API/database read-only verification access;
- no production write access.

**Deliverables and exit criteria**

- automated browser-to-chain-to-evidence happy-path test;
- negative tests for authorization, revoked sessions, replay, wrong network/asset/recipient, stale claims, reorg replay, duplicate jobs, failed deploys, and corrupt evidence;
- migration-from-clean and upgrade migration tests;
- dependency/license, secret scanning, and high-risk security review;
- live evidence that distinguishes HTTP/service availability from actual end-to-end behavior;
- zero unresolved P0/P1 defects and explicit disposition of lower-severity issues;
- signed release-readiness report with exact SHAs, commands, environment, transaction/object locators, known limitations, and rollback status.

Feature defects found by A11 are fixed on the owning feature branch or a new scoped branch owned by that feature agent. A11 should not quietly rewrite feature code on the QA branch.

### A12 — Hackathon Benchmarks and Submission Evidence

- **Branch:** `codex/hackathon-evidence`
- **Base gate:** Integrated release candidate available
- **Wave:** 4
- **Requiredness:** Conditional for bounty-specific work; the core submission evidence index is required

**Goal**

Assemble reproducible judging evidence and implement only those bounty-specific proofs that have a verified requirement and a real technical path.

**Owned paths**

- `benchmarks/`;
- `docs/submission/`;
- submission evidence manifests and demo runbook;
- benchmark/result pages, coordinated with A9 for any production route changes.

**Must read**

- Master plan hackathon, benchmark, release, and track-gate sections;
- Greenfield evidence benchmark plan;
- current official BNB Hackathon, TermiX Agent Advantage, PancakeSwap, and other targeted bounty rules;
- A11 release-readiness report.

**Required access**

- actual integrated runs and their read-only evidence;
- benchmark environment with pinned fixtures;
- organizer answers about ambiguous main-track or bounty conditions;
- no authority to invent or relabel unsupported integrations.

**Deliverables and exit criteria**

- concise evidence index mapping every submission claim to code, test, transaction, object, or benchmark proof;
- repeatable demo script with degraded-path fallback that remains truthful;
- Greenfield, Altana, Agent Studio, marketplace, payment, and commerce proof where actually completed;
- TermiX or other optional bounty evidence only when the requirement and implementation are both verified;
- benchmark methodology, inputs, versions, raw results, and limitations;
- no unsupported “live,” “decentralized,” “secured,” “paid,” or performance claim.

## 8. Dependency waves and merge gates

The waves are designed to keep no more than three implementation agents active beside A0.

| Wave | Parallel workstreams | Start condition | Merge gate |
|---|---|---|---|
| 0 | A1 Foundation, A2 Altana spike; A0 baseline/contracts | Architecture baseline committed | Buildable foundation, accepted custody/bootstrap ADR, standards lock skeleton |
| 1 | A3 Identity, A5 Commerce, A8 Evidence | A1 foundation merged; applicable shared contracts frozen | Reorg-safe identity ingestion, testable commerce rails, sealed/readback evidence |
| 2 | A4 Marketplace, A6 Creator, A7 Strategies | Wave 1 interfaces merged; A2 bootstrap accepted | Search/matching, one Creator path, minimum data/strategy coverage pass integration tests |
| 3 | A9 Web, A10 Infrastructure, A11 QA harness | Backend/API contracts frozen | Integrated preview deploys and critical browser/API paths are testable |
| 4 | A11 final verification, A12 submission evidence; A0 stabilization | All required feature work merged | Release report passes, chain/track gate resolved, submission claims evidenced |

An agent may begin fixtures, interface review, or test-harness scaffolding early, but must not implement against guessed contracts. A0 records every gate decision and the integration SHA that satisfied it.

## 9. Expected merge order

1. A0 architecture baseline and initial governance.
2. A1 foundation/domain.
3. A2 custody/bootstrap spike and accepted ADR.
4. A3 identity/discovery, A5 commerce, and A8 evidence in the order their migration/API conflicts permit.
5. A4 marketplace, A6 Creator, and A7 data/strategies.
6. A9 web product and A10 infrastructure.
7. A11 test-only additions, followed by fixes on the owning branches.
8. A12 evidence/submission package.
9. A0 release-candidate stabilization and promotion to `main` after A11 approval.

Parallel branches must not allocate migration numbers independently without A0 assigning a range or filename prefix. Shared API/schema changes merge before their consumers. Incomplete features remain disabled by default behind documented feature flags.

## 10. Access allocation

Access is granted just in time and at the least privilege needed for the workstream.

| Resource | Agents | Access boundary |
|---|---|---|
| Repository and donor source | A0–A12 as needed | Read for all; write only to assigned branch/worktree |
| PostgreSQL/pgvector development DB | A1, A3, A4, A5, A6, A8, A11 | Dedicated development role; no production data |
| BNB RPC and registry testnet | A2, A3, A5, A6, A7, A11 | Scoped provider key; bounded funded accounts |
| 8004scan API/Pro | A3, A4, A11 | Read-only discovery/testing credential |
| Altana browser/passkey environment | A2, A6, A11 | Builder retains root control; runtime receives scoped sessions only |
| AWS development account | A2, A5, A6, A10, A11 | Role-specific IAM; no shared administrator key |
| B402/X402 merchant sandbox | A5, A6, A10, A11 | Test merchant, pinned recipient/asset/network, bounded funds |
| Greenfield test bucket | A8, A11, A12 | Test-only wallet/bucket and limited object permissions |
| IPFS pinning provider | A8, A11 | Scoped token for the test namespace |
| Embedding provider | A4, A11 | Rate/budget-limited key; no secret in fixtures |
| Vercel or selected web host | A9, A10, A11 | Preview project first; production promotion held by A0/release owner |
| Organizer channels and submission portal | A0, A12 | A0 owns technical clarifications; release owner owns final submission |

Credential values are delivered through the approved secret manager or local environment injection. Coordination documents list only environment-variable or secret-reference names, never values.

## 11. Required handoff from every subagent

Every merge request or coordinator handoff must contain:

```text
Agent/workstream:
Branch:
Worktree:
Base integration SHA:
Head SHA:

Goal completed:
Owned paths changed:
Shared contracts changed:
Migrations added:
Feature flags added or changed:

Commands run and results:
Live/testnet evidence:
Environment and pinned versions:
Secret names required (names only):

Known limitations:
Open risks or follow-up issues:
Rollback or disable procedure:
Recommended merge order:
```

The handoff must distinguish automated test evidence, simulated/fork evidence, testnet evidence, and production/mainnet evidence. A URL, transaction hash, HTTP 200, or health check is not by itself proof of an end-to-end feature.

## 12. Common definition of done

A workstream is complete only when:

- its implementation stays within the assigned scope and owned paths;
- all consumed shared contracts are current and no duplicate local variants exist;
- lint, typecheck, unit, integration, and relevant browser/onchain tests pass;
- migrations apply cleanly from an empty database and from the previous integration state;
- errors, retries, idempotency, and degraded states are covered proportionately to risk;
- logs and evidence have been inspected for secrets and sensitive data;
- documentation describes actual behavior and operational recovery;
- live or testnet claims have reproducible evidence at the appropriate boundary;
- the branch has incorporated the latest accepted integration changes;
- the handoff template is complete and reviewed by A0;
- A11 can verify the result without relying on the implementing agent's private local state.

## 13. Stop conditions and escalation

A subagent must stop and escalate to A0 when any of the following occurs:

- a required chain ID, contract address, ABI, token, protocol version, or official requirement is absent or contradictory;
- work would require a mainnet write, production credential, paid resource, DNS change, or irreversible action not already authorized;
- a shared domain/API/event contract must change;
- donor license or provenance is unclear;
- custody behavior cannot be reproduced with scoped Altana authority;
- a payment recipient, asset, network, or settlement path cannot be pinned and verified;
- Greenfield seal/readback semantics differ from the accepted evidence model;
- an external service requires storing a root key or exposing a credential beyond the agreed boundary;
- the workstream would need to modify another active agent's owned paths;
- hackathon eligibility or bounty wording would materially change the architecture or submission claim.

The agent should include the exact failing evidence and at least one safe option, but should not bypass the gate with a mock or an undocumented architectural substitution.

## 14. Release promotion checklist

A0 may propose merging `codex/platform-integration` to `main` only when:

- the BNB Chain 56/97 main-track decision is resolved and recorded;
- one external agent is discovered, verified, and searchable without BNBEra redeployment;
- one thin Creator agent completes the approved Altana and Studio deployment path;
- one ERC-8183 lifecycle and one paid X402/B402 path have complete correlated evidence;
- one Greenfield artifact is sealed, read back, and hash verified;
- browser flows expose real integrated state and honest degraded states;
- pause, revoke, retry, reconciliation, and destroy/recovery paths have been exercised;
- A11 reports no unresolved P0/P1 defects;
- A12's submission evidence index contains no unsupported claim;
- rollback, feature-disable, and credential-revocation procedures are documented and tested.

This is the minimum credible path to a complete hackathon platform. Optional bounty integrations, additional strategies, extra protocols, and polish may proceed only after these gates remain green.
