# BNBEra: Ultra-Detailed Marketplace, No-Code Agent Deployer, and Greenfield Plan

**Status:** Approved implementation plan
**Revision:** 1.3
**Date:** 2026-09-01

Focused plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [Greenfield data and evidence](./02-greenfield-data-and-evidence-plan.md)
- [No-code agent deployer](./03-no-code-agent-deployer-plan.md)

## 1. Outcome and locked decisions

Create a new production-oriented application at:

`C:\Users\Castanova\Desktop\Personal\bnbera`

The result will be a public BNB Chain agent marketplace where users can:

1. Discover and compare live agents across all four Smart Money categories.
2. Inspect real-time data, verified capabilities, prices, execution history, and onchain authority.
3. Hire agents through ERC-8183 or pay per request through x402/B402.
4. Add supply through 8004scan/direct discovery, owner-claimed import, or a thin audited-strategy Creator.
5. Control the deployed agent through a user-owned Altana wallet with an onchain allowlist, spend cap, and expiry.
6. Publish agent profiles, decisions, deliverables, benchmarks, and execution evidence through BNB Greenfield.

The implementation is optimized for the official [Smart Money Era tracks](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks) and the current [BNB Agent Studio workflow](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/).

| Decision | Selected approach |
|---|---|
| Application base | TwinMarket backend and application skeleton |
| AgentTrust contribution | Selective port of capability, audit, verification, and requester/provider patterns |
| Frontend | Entirely new BNBEra interface; no donor frontend reuse |
| Agent sourcing | 8004scan, direct ERC-8004 events, manual claim/import, and BNBEra Creator |
| Creator experience | Thin audited-strategy no-code MVP after marketplace and category gates; no general-purpose builder |
| Hosting | One current BNB Agent Studio TypeScript runtime per created agent on AWS AgentCore behind authenticated ingress/WAF |
| Network | Release-blocking organizer clarification; write-capable Creator demos default to BSC testnet, and main-track category coverage falls back to BSC mainnet if testnet eligibility is not confirmed |
| Wallet authority | User-controlled Altana wallet with scoped runtime session |
| Agent identity | Official ERC-8004 |
| Hiring | Official ERC-8183 |
| Per-request payments | X402 public face with pinned B402 settlement; configured independently from ERC-8183 |
| Protocol focus | PancakeSwap, Venus, and Lista |
| Deliverable compatibility | IPFS |
| Canonical public evidence | BNB Greenfield |
| Web deployment | Vercel |
| Database | PostgreSQL with pgvector |
| User-created limits | One active hosted agent per verified wallet |
| Arbitrary generated code | Excluded |
| Custom escrow/identity contracts | Excluded |
| Mainnet writes | Disabled until explicit post-testnet security gates pass; read-only chain-56 discovery remains allowed |
| Standards stability | Pin Studio CLI/runtime, Agent SDK, Altana SDK, ERC revisions, deployed contracts, and ABI hashes in `config/standards.lock.json` |

---

## 2. Documentation publication

Execution begins by publishing four Markdown documents inside `bnbera\docs`.

### `01-marketplace-donor-merge-plan.md`

Contains:

- TwinMarket and AgentTrust audit.
- Exact retain, transform, replace, and delete decisions.
- Target monorepo structure.
- Authentication, database, marketplace, commerce, and matching architecture.
- 8004scan/direct-event ingestion with reorg handling and independent origin, claim, verification, runtime, authority, and listing states.
- Donor security defects and their replacements.
- Provenance and licensing handling.
- Migration and testing strategy.

### `02-greenfield-data-and-evidence-plan.md`

Contains:

- Greenfield’s role and limitations.
- Public versus private data policy.
- Bucket and object naming.
- Canonical evidence schemas.
- Upload, sealing, retry, readback, and integrity verification lifecycle.
- IPFS and Greenfield dual-publishing.
- Marketplace and transaction linking without Greenfield mirroring or ambiguous BSC digest anchoring.
- Cost, batching, retention, and failure behavior.

### `03-no-code-agent-deployer-plan.md`

Contains:

- Creator UX.
- The audited strategy catalog and thin Creator MVP boundary.
- Altana wallet and session setup.
- Single-runtime Agent Studio deployment behind AWS ingress/Cognito/WAF.
- Deployment state machine.
- Agent Studio template release process.
- Secrets, isolation, quotas, teardown, retries, and user controls.
- Automatic listing and verification gates.

### `04-bnbera-master-implementation-plan.md`

Contains the complete consolidated plan represented here, with links to the preceding three focused plans.

Each document will include:

- Title, status, date, and revision.
- Locked decisions.
- Official resources.
- Dependencies on the other plans.
- Acceptance criteria.
- Explicit exclusions.
- A changelog section for later plan revisions.

---

## 3. Target repository structure

Convert `bnbera` into a Node 22 and pnpm 10 workspace:

```text
bnbera/
├── apps/
│   ├── web/                         # Next.js marketplace and creator dashboard
│   ├── deployer/                    # AWS deployment orchestration worker
│   └── health-monitor/              # Endpoint, authority and evidence watcher
├── packages/
│   ├── db/                          # Drizzle schema, migrations and repositories
│   ├── domain/                      # Shared types, schemas and lifecycle rules
│   ├── marketplace/                 # Search, ranking and listing verification
│   ├── agent-ingestion/             # 8004scan, direct registry events and endpoint resolution
│   ├── agent-commerce/              # ERC-8004, ERC-8183 and x402 integrations
│   ├── agent-runtime/               # Shared safe execution and decision engine
│   ├── agent-templates/             # Audited, operator-activated Creator strategies
│   ├── altana/                      # Wallet, session, policy and revocation support
│   ├── greenfield/                  # Evidence publisher and integrity verifier
│   ├── binance/                     # Optional typed enrichment adapters
│   ├── data-sources/                # PancakeSwap, Venus and Lista adapters
│   └── ui/                          # New BNBEra design system
├── infra/
│   ├── aws/                         # AgentCore, ingress/Cognito/WAF, worker and workflow IaC
│   └── vercel/                      # Web deployment configuration
├── config/
│   └── standards.lock.json          # Pinned draft specs, contracts, ABI hashes and SDK/tool versions
├── scripts/
│   ├── seed-templates.ts
│   ├── verify-deployment.ts
│   └── build-advantage-report.ts
├── docs/
│   ├── 01-marketplace-donor-merge-plan.md
│   ├── 02-greenfield-data-and-evidence-plan.md
│   ├── 03-no-code-agent-deployer-plan.md
│   └── 04-bnbera-master-implementation-plan.md
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

Use pnpm for the application workspace. Bun remains installed only in the controlled deployment image where required by current Agent Studio tooling.

---

## 4. Donor merge

### 4.1 TwinMarket as the application base

Retain and adapt:

- Next.js 16 and React 19 foundation.
- TypeScript configuration.
- tRPC 11 and React Query wiring.
- Drizzle/PostgreSQL integration.
- BetterAuth session structure.
- SIWE wallet authentication patterns.
- wagmi, viem, and RainbowKit integration.
- Existing public/protected route separation.
- General marketplace CRUD and detail-page structure.
- Server-side JSON error handling patterns.

Transform:

- `agents` becomes the canonical agent/listing domain rather than a private “digital twin.”
- The creator wizard becomes the audited-strategy no-code Creator MVP.
- The generic chat endpoint becomes category-specific A2A, ERC-8183, and x402 service interaction.
- Simple latest/trending ordering becomes verified capability matchmaking.
- Dollar strings become typed token, chain, atomic amount, and decimal structures.
- Call counts become verified execution statistics.
- Existing creator dashboard becomes “My Agents,” including deployment, authority, earnings, evidence, health, and revocation.

Remove completely:

- World ID gate and Worldchain AgentBook.
- ENS Sepolia and NameStone.
- Circle Arc testnet gateway.
- World-specific ZK commitments.
- Open-ended system-prompt and knowledge-block creation.
- Mock cards, reviews, revenue, trust badges, and marketplace metrics.
- Existing visual identity and donor frontend composition.
- Plaintext agent private-key storage.
- APIs that return generated private keys.
- APIs that accept private keys from a browser.
- Server functionality that reconstructs a wallet from a database field.

The replacement schema never contains a `private_key` column.

### 4.2 Selective AgentTrust port

Port the concepts behind:

- JSON capability manifests.
- Structured input and output schemas.
- Requester/provider job lifecycle.
- Deterministic service and output hashes.
- Append-only audit events.
- Deliverable verification and integrity checks.
- Agent interaction demo fixtures.
- Clear success, failure, dispute, and settlement terminology.

Reimplement these concepts using BNBEra domain types and official BNB standards.

Do not import:

- `AgentRegistry.sol`.
- `ServiceAgreement.sol`.
- `TrustNFT.sol`.
- The hardcoded `TrustClient.getScore()` result.
- Base-specific chain configuration.
- ENS/Basenames logic.
- 0G Storage or 0G Compute.
- AXL networking.
- Akash deployment files.
- KeeperHub-specific orchestration.
- AgentTrust frontend.
- Custom escrow and trust-based transfer limits.
- Any fail-open trust or verification behavior.

ERC-8004 replaces AgentTrust identity. ERC-8183 replaces its custom service escrow. Greenfield replaces 0G storage. Altana replaces unrestricted backend wallet keys.

### 4.3 Provenance

Because the supplied snapshots do not include Git history and their licensing files are incomplete:

- Record donor source directories, file inventory hashes, upstream repository URLs, and import date in `docs/donor-provenance.md`.
- Add `THIRD_PARTY_NOTICES.md`.
- Treat the user’s merge request as authorization to work with the local source.
- Do not claim upstream authorship.
- Do not publish donor code externally until its reuse rights have been documented.
- Preserve a clear commit separating the donor-base import from BNBEra modifications.

---

## 5. Marketplace product

### 5.1 Public routes

Implement:

- `/` — concise product landing page.
- `/marketplace` — searchable agent marketplace.
- `/marketplace/rebalancing`
- `/marketplace/grid-trading`
- `/marketplace/yield-optimisation`
- `/marketplace/health-factor`
- `/agents/[slug]` — complete agent profile.
- `/compare` — comparison of up to three eligible agents.
- `/create` — no-code template wizard.
- `/dashboard/agents` — owned agents.
- `/dashboard/agents/[id]` — deployment and authority console.
- `/jobs/[id]` — ERC-8183 job progress and deliverable.
- `/evidence/[runId]` — human-readable Greenfield evidence.
- `/agent-advantage` — TermiX comparison report.

### 5.2 Marketplace cards

Every card must display observed facts rather than promotional placeholders:

- Agent name and category.
- Origin: discovered, manually imported, or created.
- Independent owner-claim, verification, runtime, authority, and listing states.
- Exact BSC network.
- Full ERC-8004 identity: namespace, chain ID, registry address, and agent ID.
- Supported protocol.
- Agent Studio template/version only for verified Studio-created provenance.
- Last successful health check.
- Last successful execution time.
- Price or price range.
- Wallet provider and authority status; Altana expiry and spend-cap summary only when applicable.
- Evidence freshness.
- Successful and disputed ERC-8183 jobs.
- Evidence links and integrity state; a Greenfield link only when the object was sealed and read-back verified.
- “Created with BNB Agent Studio” badge only when provenance is verified.

No fabricated reviews, revenue, APR, win rate, activity, or success count will be seeded.

### 5.3 Agent detail

The profile must answer:

- What does this agent do?
- Which current data does it use?
- What can it execute?
- Which contracts and selectors are allowlisted?
- How much can it spend?
- When does authority expire?
- What does a job cost?
- What result does a buyer receive?
- Which execution records prove it works?
- Who owns the ERC-8004 identity, which wallet receives/executes, and who can revoke authority?
- Is the endpoint healthy now?
- How was its latest decision derived?

The page includes:

- Live data panel.
- Capability manifest.
- Origin, owner-claim, verification, runtime, authority, and listing state.
- Input/output example.
- Pricing.
- Risk configuration.
- Authority explorer.
- Recent verified runs.
- ERC-8004 explorer link.
- Altana explorer link.
- BSC transaction links.
- Greenfield evidence.
- Hire and x402 actions.
- Compare control.

### 5.4 Visual identity

BNBEra uses purple as the product identity, with BSC yellow and Greenfield green reserved for their integration contexts.

Core palette:

| Role | Color |
|---|---|
| Primary purple | `#7C3AED` |
| Purple hover | `#6D28D9` |
| Purple highlight | `#A78BFA` |
| Dark background | `#0B0714` |
| Main surface | `#151020` |
| Elevated surface | `#1D1630` |
| Primary text | `#F8F7FC` |
| Muted text | `#A8A1B5` |
| Border | `#302742` |

Use purple for primary actions, navigation selection, filters, creator progress, focus rings, and BNBEra branding.

Integration accents:

- BSC yellow `#F0B90B` identifies BSC network badges, gas, transactions, ERC-8004/ERC-8183 records, and explorer links.
- Greenfield green `#22C55E`, with dark surface `#10261A`, identifies storage, sealed evidence, integrity, provenance, and Greenfield links.

Semantic status colors:

- Information: `#38BDF8`.
- Warning: `#FB923C`.
- Error: `#F87171`.
- Neutral/inactive: `#787080`.

Purple remains the default call-to-action color. Yellow and green must not become general action colors. Every state also includes a text label and icon so color is never the only signal.

---

## 6. Matchmaking and discovery

### 6.1 Supply ingestion and state model

Supply enters through:

1. 8004scan list/filter/semantic candidate discovery.
2. Direct ERC-8004 registry events and reads.
3. Manual import or owner claim.
4. BNBEra Creator.

8004scan is a discovery accelerator, not marketplace truth. Every candidate is normalized and deduplicated by `(namespace, chainId, identityRegistry, agentId)`, verified directly against the configured registry, resolved to bounded untrusted metadata, and then subjected to endpoint, capability, protocol, health, and evidence checks.

Even when 8004scan supplies semantic retrieval, BNBEra retains pgvector over its own verified and enriched marketplace representation. BNBEra's index and deterministic matcher incorporate authority, protocol, health, price, freshness, and execution constraints that a generic registry-search ranking cannot decide for BNBEra.

Discovery does not require SIWE. The current ERC-721 owner proves control only to claim a listing, change owner-controlled marketplace data, or receive an owner-verified label.

Persist independent state dimensions:

```text
origin_type         discovered | manual_import | created
claim_status        unclaimed | claimed | stale
verification_status pending | verified | degraded | rejected
runtime_status      live | unavailable | paused
authority_status    none | active | expired | revoked
listing_status      draft | published | paused | suspended | delisted
```

`origin_type` records the initial ingestion path and does not change when an owner claims a listing. A canonical onchain ownership change makes the previous claim `stale`; it removes owner-management privileges and the owner-verified label but does not automatically reject an otherwise independently verified listing. Creation never implies claim, verification, liveness, active authority, or publication.

Resolve public services from ERC-8004 metadata, A2A Agent Cards, MCP metadata, and reviewed protocol adapters. Normalize each advertised service by kind, URL, protocol version, source, and validation state. Studio conventions are used to verify Studio-created reference agents, not imposed on external agents.

Registry events are provisional until the configured network confirmation threshold. Store block number, block hash, transaction hash, log index, and `provisional | canonical | orphaned` state for each observation, with per-chain/registry cursors and a last-finalized block. On block-hash mismatch, rewind, mark orphaned observations, replay canonical events, re-read owner/metadata/`agentWallet`, invalidate displaced owner claims, and rerun affected verification. Do not hardcode the confirmation count; pin it per network.

### 6.2 Hard eligibility

An agent is excluded before scoring if any of these fail:

- Wrong BSC environment.
- Wrong category.
- Required protocol unsupported.
- Endpoint unhealthy.
- ERC-8004 identity unresolved.
- Required execution authority missing, expired, revoked, or unverifiable for an execution request; Altana is preferred for BNBEra-created and Altana-track agents but is not a universal listing requirement.
- For an execution request, the requested amount exceeds an advertised and verified policy bound.
- For an execution request that exposes contract-level constraints, the required contract or selector is outside the advertised allowlist or reviewed adapter policy.
- Price exceeds the buyer’s maximum.
- Required data is stale.
- Advertised capability or protocol version is incompatible with the request or unsupported by a reviewed adapter.
- Listing state is not `published`, or verification is pending/rejected. An ownership transfer alone makes the prior claim stale and triggers revalidation; it does not automatically delist a still-valid external service.

### 6.3 Scoring

Score eligible candidates from 0–100:

| Component | Weight |
|---|---:|
| Capability and task fit | 35 |
| Endpoint and runtime health | 20 |
| Current-data quality and provenance | 15 |
| Authority and budget compatibility when relevant | 15 |
| Fresh verified result or execution evidence | 10 |
| Price fit | 5 |

Semantic similarity is used only after hard eligibility. It cannot rescue an incompatible agent.

Store capability/profile embeddings using pgvector. The embedded text is generated from normalized public metadata, not user reviews or runtime logs.

Vectorize only:

- Agent name and verified description.
- Category and capability manifest.
- Supported protocols and actions.
- Public input/output schema descriptions.
- Public risk and authority summary.
- Verified evidence summary.

Do not vectorize:

- Prices, APR/APY, balances, liquidity, health factors, or other live financial data.
- Raw transactions and receipts.
- Private configuration, prompts, secrets, session data, or user identity.
- Unverified user claims.

Pin one embedding provider/model/version and dimension for the hackathon. Store the agent-version ID, embedding provider/model/version, dimension, source-text hash, classifier version, and creation time. A future dimension change creates a versioned table/index migration. Regenerate the vector when the published semantic profile changes, not when a live metric changes. If embedding generation fails, structured filters and PostgreSQL full-text search remain available.

Current endpoint state, price, balances, remaining spend, expiry, and other live financial values stay structured and never enter the semantic document.

Within the 35-point capability score, exact structured compatibility contributes 20 points and semantic similarity contributes 15 points. Hard eligibility always runs before vector retrieval.

Every result exposes a score explanation:

```json
{
  "eligible": true,
  "score": 86,
  "components": {
    "capability": 33,
    "health": 20,
    "dataQuality": 13,
    "authority": 12,
    "execution": 5,
    "price": 3
  },
  "reasons": [
    "Supports PancakeSwap V3 LP range management",
    "Live endpoint verified 28 seconds ago",
    "Authority permits the requested position and amount",
    "Latest verified execution is 19 hours old"
  ]
}
```

Category prediction uses ERC-8004 metadata, OASF skills, A2A Agent Cards, MCP capability schemas, known protocols/actions, deterministic rules, and semantic evidence. Persist category, structured score, semantic score, confidence, evidence, method, classifier version, and review state. A description-only match remains `uncategorized` when structured evidence is insufficient.

### 6.4 Data freshness

Use consistent block-number snapshots where possible.

Maximum execution freshness:

- DEX price and executable quote: 30 seconds.
- Lending position and health factor: one block or 15 seconds.
- Wallet balances: one block or 15 seconds.
- Pool APR/APY and incentive state: five minutes.
- Endpoint health: one minute.
- Altana authority: confirmed current chain state before every execution.

Stale data may still be shown with a warning, but execution fails closed.

### 6.5 Optional Binance enrichment

Do not treat one Binance MCP endpoint as a universal gateway to every Binance product. Keep product-specific, pinned, typed, validated adapters under `packages/binance/`:

```text
market-data-adapter
web3-data-adapter
token-audit-adapter
smart-money-adapter
optional later: cex-adapter
```

Normalize responses into BNBEra domain types and record provider, version, source time, validation state, and payload digest. Binance data can enrich discovery, explanations, and comparisons. PancakeSwap, Venus, or other target-protocol state plus simulation and confirmed receipts remain execution truth. Failure of optional Binance enrichment cannot fabricate, authorize, or silently change an execution decision.

---

## 7. Four first-class categories and reference strategies

The main-track requirement is four equally deep marketplace categories, not four BNBEra-authored agents. Before building reference supply, inventory discovered agents for each category and record discovered, chain-verified, endpoint-healthy, hireable, execution-capable, and evidence-backed counts.

Each category must pass this coverage gate:

- Live ERC-8004 identity on the BSC network accepted by the main-track network gate.
- Healthy usable endpoint and supported public face.
- Understood and normalized capability plus input/output schemas.
- Pricing or activation flow.
- Verified advertised protocol support.
- Comparable marketplace detail and current-data provenance.
- At least one end-to-end activation or hire path.

If external supply passes, use it. If it does not, deploy the minimum BNBEra reference supply required to close the gap. At least one Studio-created reference agent remains desirable to prove the Creator flywheel, but no category requires BNBEra ownership when external supply qualifies.

### 7.1 Marketplace eligibility contract

All four category pages have equal marketplace depth. A qualifying external, imported, claimed, or created agent exposes observable facts BNBEra can normalize and verify:

- Complete ERC-8004 identity and accepted BSC network.
- Discovered, validated service endpoint and protocol face.
- Understood capability plus input/output contract.
- Category and advertised protocol support.
- Price or activation mechanism.
- Current-data provenance and freshness where relevant.
- Execution constraints and authority where execution is offered.
- Health and an observable result/evidence history appropriate to the service.
- A usable activation or hire path.
- Comparable marketplace fields and exclusion reasons.

This contract does not require external agents to use Studio, Altana, BNBEra's strategy engine, simulation stack, Greenfield, ERC-8183, X402, or any fixed URL path unless that feature is advertised or required by the selected activation path.

### 7.2 BNBEra Creator/reference strategy contract

BNBEra-created and gap-filling reference strategies additionally require:

- Deterministic strategy and current-data adapter.
- Simulation and risk validation before writes.
- Fixed signing plus bounded Altana policy.
- Before/after protocol-state validation.
- Pinned Studio deployment and dynamically advertised faces.
- ERC-8183 and paid X402/B402 canaries when those rails are enabled.
- Sealed, read-back-verified Greenfield evidence.

The remaining subsections define those audited gap-filling strategies. The LLM may explain a deterministic decision. It cannot choose arbitrary contracts, sign transactions, modify price limits, or bypass policy.

### 7.3 PancakeSwap LP Rebalancing

Purpose:

- Monitor PancakeSwap V3 LP positions.
- Detect when price exits or approaches the configured range.
- Estimate uncollected fees and rebalance costs.
- Reset the range only when expected benefit exceeds cost and risk thresholds.

Configurable fields:

- Approved pool.
- LP position.
- Range width.
- Rebalance trigger.
- Maximum position value.
- Maximum swap amount.
- Slippage limit.
- Minimum expected net benefit.
- Cooldown.
- Execution enabled/disabled.

Allowed action sequence:

1. Read position and pool state.
2. Simulate liquidity removal.
3. Collect fees.
4. Remove liquidity.
5. Perform a bounded balancing swap if required.
6. Mint the replacement range.
7. Validate the resulting position.

The policy allowlist contains only the required PancakeSwap contracts and selectors.

### 7.4 PancakeSwap Grid Trading

Purpose:

- Maintain a virtual grid around an approved pair.
- Execute bounded buys or sells as verified price bands are crossed.
- Track inventory, realized result, and remaining risk.

Configurable fields:

- Approved pair.
- Lower and upper price.
- Three to twenty grid levels.
- Per-level amount.
- Maximum total inventory.
- Maximum daily turnover.
- Slippage limit.
- Cooldown.
- Stop-loss boundary.

Execution is rejected if:

- Price data is stale.
- Liquidity is insufficient.
- Quote impact exceeds the limit.
- Inventory or daily cap would be exceeded.
- The action repeats an already consumed grid level.
- The session expires before the quote deadline.

### 7.5 Yield Optimisation

Purpose:

- Compare current net yield across vetted opportunities.
- Account for base yield, incentives, fees, liquidity, protocol risk, and movement cost.
- Move capital only when the improvement exceeds the configured threshold.

Initial vetted venues:

- Venus lending.
- Lista liquid staking.
- Approved PancakeSwap liquidity opportunities.

Configurable fields:

- Principal asset.
- Approved venues.
- Maximum principal.
- Minimum net-yield improvement.
- Minimum venue liquidity.
- Minimum holding period.
- Maximum movement frequency.
- Maximum slippage.
- Risk floor.

No “highest APR” claim is shown without timestamp, block, source, assumptions, and net-yield calculation.

### 7.6 Health Factor Monitoring

Purpose:

- Protect a Venus lending position from liquidation.
- Monitor collateral, debt, oracle prices, liquidation thresholds, and health factor.
- Warn early and execute a bounded remediation if authorized.

Configurable fields:

- Venus account/market.
- Collateral and debt assets.
- Warning threshold.
- Action threshold.
- Target post-action health factor.
- Maximum repayment/top-up.
- Monitoring cadence.
- Execution enabled/disabled.

Default thresholds:

- Warning: 1.50.
- Action: 1.25.
- Target after remediation: 1.70.

The remediation must be simulated and revalidated immediately before submission.

---

## 8. No-code creation and deployment

The hackathon ships a thin audited-strategy Creator only after marketplace ingestion/search, the four-category coverage gate, and one complete activation/hire path pass. It does not ship a general-purpose builder, arbitrary code/skills/dependencies/contracts, a visual programming language, or a multi-cloud framework.

### Prerequisite: Altana browser-to-Studio spike

Before Creator implementation, prove with the pinned versions that a browser/passkey-controlled Altana administrator can review and grant the exact call, spend, and expiry policy; only bounded runtime-session material reaches the Studio/AWS secret path; AgentCore can execute one permitted transaction; and browser revocation rejects the next state-changing action.

Prefer Studio's supported externally prepared-session path if it exists. If the pinned Studio release does not expose that bootstrap, use the pinned Altana SDK for browser/user-wallet provisioning and Studio for runtime/deployment, still injecting only the bounded session through the reviewed secret path. Record the exact APIs, serialized-session format, handoff boundary, secret destination, revocation observation, and versions. The user's passkey, administrative signer, and admin keystore never enter BNBEra, logs, PostgreSQL, build artifacts, or runtime.

### 8.1 User experience

The user performs no programming or cloud setup.

Wizard steps:

1. Choose an operator-activated audited strategy.
2. Configure strategy parameters.
3. Configure ERC-8183 and x402 pricing.
4. Review current-data sources.
5. Review derived Altana authority.
6. Connect and authenticate wallet.
7. Create/select the Altana smart wallet.
8. Approve the scoped session through the spike-validated browser flow.
9. Confirm deployment.
10. Follow live progress.
11. Review the validation transaction and evidence.
12. Publish automatically after all gates pass.

The user must approve wallet transactions. “No code” does not mean silent financial authorization.

### 8.2 Agent Studio template release process

Do not generate arbitrary production code from user prompts.

For every template version:

1. Scaffold a clean official Agent Studio seller project using the exact release pinned in `config/standards.lock.json`; the initial reviewed target is Studio CLI `0.0.13`, configured with the pinned CLI's `--wallet-kind altana` path.
2. Pin the Agent Studio CLI/runtime, Agent SDK, Altana SDK, deployed ERC-8004/ERC-8183 contracts and ABIs, viem, and protocol package versions.
3. Implement the audited template behavior.
4. Generate a strict JSON Schema for configuration.
5. Generate the contract and selector manifest.
6. Run lint, typecheck, unit tests, integration tests, `bag doctor`, package inspection, and testnet canary.
7. Produce a content-addressed immutable template bundle.
8. Sign the template manifest.
9. Publish the version to `agent_templates`.
10. Make it selectable only after an administrator activates it.

User input is stored as data and never interpolated into executable TypeScript.

Studio is under active development. Every toolchain upgrade creates a new reviewed lock, reruns the complete template release pipeline, and produces a new template artifact. Workers never install an unpinned `latest` release.

### 8.3 Deployment architecture

```text
Browser
  │
  ├── SIWE and Altana authorization ───────────► BSC / Altana Keystore
  ├── one-time bounded-session handoff ────────► Studio/AWS secret path
  │
  ▼
Vercel Next.js application
  │
  ├── PostgreSQL deployment record
  └── authenticated queue request
            │
            ▼
        AWS SQS
            │
            ▼
      Step Functions
            │
            ├── ephemeral worker: verify strategy + standards lock
            ├── pinned Studio CLI: init/configure/doctor/deploy
            ├── delegated secret channel: bounded Altana session
            ├── AgentCore: one TypeScript runtime / one signer
            ├── AWS ingress + Cognito + WAF
            ├── custody-specific ERC-8004 ownership/registration
            ├── ERC-8183 and x402/B402 verification
            ├── IPFS publishing
            └── Greenfield publishing and seal verification
```

Vercel never runs the long deployment inline. The creation mutation returns a deployment ID immediately. Studio owns the generated runtime and cloud deployment topology; BNBEra owns queueing, signed strategy/configuration materialization, idempotency, policy review, progress, reconciliation, verification, and listing.

### 8.4 Deployment state machine

States:

1. `draft`
2. `awaiting_authority`
3. `authority_confirming`
4. `queued`
5. `validating`
6. `building`
7. `provisioning_secrets`
8. `deploying_runtime`
9. `configuring_ingress`
10. `health_checking`
11. `registering_identity`
12. `configuring_commerce`
13. `executing_canary`
14. `publishing_evidence`
15. `verifying`
16. `listed`

Alternative terminal states:

- `failed`
- `paused`
- `revoked`
- `destroying`
- `destroyed`

Each transition records:

- Deployment ID.
- Attempt number.
- Timestamp.
- Template digest.
- Input digest.
- Previous and next state.
- Sanitized status message.
- Internal error code.
- Whether retry is safe.
- External resource identifiers.
- Relevant transaction hash.

Deployment state remains separate from marketplace state. A created agent has `origin_type=created`; its `claim_status`, verification, runtime, authority, and listing states change independently. Creation never implies owner claim, verification, liveness, active authority, or publication.

### 8.5 Idempotency

- `creator.deploy` requires an idempotency key.
- Template materialization uses a deterministic deployment slug.
- External resource IDs are persisted before advancing.
- Onchain transactions store nonce and hash before polling.
- Retrying identity registration checks the registry first.
- Retrying object publishing checks the expected Greenfield object and checksum.
- Retrying AgentCore deployment reconciles existing runtime status.
- Duplicate browser clicks return the original deployment.

### 8.6 Failure and compensation

If build validation fails:

- Create no runtime.
- Preserve the sanitized diagnostic.
- Mark the deployment retryable only after configuration changes.

If AgentCore succeeds but ingress, endpoint, or selected-face verification fails:

- Keep the runtime paused.
- Reconcile the existing Studio deployment and ingress configuration.
- Do not register an unusable public endpoint.

If paid X402 gateway, relay authentication, fixed egress, B402 settlement, or payout-recipient verification fails:

- Keep that face unpublished.
- Do not silently downgrade it to free mode or substitute ERC-8183.
- Preserve an unknown post-payment outcome for reconciliation and never retry payment automatically.

If ERC-8004 registration succeeds and a later step fails:

- Persist the identity.
- Resume using the same identity.
- Never create a duplicate token.

If the initial canary fails:

- Keep the listing inactive.
- Retain evidence and diagnostic state.
- Do not claim the agent is live.

If Greenfield sealing fails:

- Retain the IPFS deliverable.
- Mark evidence as pending.
- Retry asynchronously.
- Do not mark the listing fully verified until the initial profile is sealed and read back.

### 8.7 Hosting limits

Hackathon release limits:

- BSC testnet writes by default; a Creator mainnet path remains disabled until separately approved after the main-track network gate and mainnet security gates.
- One active user-created agent per verified wallet.
- One initial testnet gas sponsorship of at most 0.005 tBNB.
- Mandatory spend cap.
- Authority expiry choices of 1 hour, 24 hours, or 7 days.
- Default expiry of 24 hours.
- Global operator-configured capacity ceiling.
- Queue new deployments when capacity is exhausted.
- No arbitrary source uploads.
- No arbitrary packages.
- No arbitrary RPC endpoints.
- No arbitrary contract addresses.

A paused session removes the agent from eligible matchmaking. A revoked or expired session automatically pauses the runtime and listing.

---

## 9. Wallet and signing security

### 9.1 Ownership

- The connected EOA authenticates through SIWE.
- The ERC-8004 identity owner is the intended user-controlled address.
- The user remains the Altana administrator.
- The execution wallet is the user-controlled Altana Smart Agentic Wallet.
- The user controls grant, renewal, and revocation.
- The marketplace cannot broaden the policy.
- The platform holds only the scoped agent session required for autonomous execution.
- Platform ownership of AWS runtime resources does not imply ownership of the ERC-8004 identity, Altana wallet, assets, or administrative authority.

BNBEra uses the current pinned Studio/Altana custody-specific registration flow to satisfy this invariant. Register-then-transfer is a fallback only because ERC-8004 transfer clears the verified `agentWallet`; any fallback transfer pauses publication and re-establishes `agentWallet` before verification.

### 9.2 Session lifecycle

1. BNBEra displays the exact runtime-session public key, calls, spend limits, and expiry in the browser.
2. The user grants that session through the phase-zero spike's validated Studio or Altana SDK flow.
3. The user's passkey, administrative signer, and admin keystore remain in the user-controlled wallet and never enter BNBEra.
4. Only serialized bounded-session material crosses the reviewed one-time handoff into Studio's delegated AWS secret channel/Secrets Manager.
5. The backend verifies the confirmed Keystore state and secret destination.
6. AgentCore receives secret access through its dedicated IAM role.
7. The session is revalidated before every write.
8. Expiry or revocation disables execution eligibility and pauses the created listing.

The platform must disclose that its hosted runtime can act within the exact authorized scope, although it cannot access or widen the user’s administrative authority.

### 9.3 Deterministic signing boundary

The LLM receives only read tools.

State-changing execution follows:

```text
Current data
  → deterministic strategy
  → candidate action
  → simulation
  → template policy validation
  → Altana onchain policy validation
  → fixed signing entrypoint
  → transaction submission
  → receipt and outcome verification
```

No prompt or model output becomes raw calldata.

---

## 10. ERC-8004, ERC-8183, and x402/B402

### 10.1 ERC-8004 identity

ERC-8004 and ERC-8183 are draft standards. `config/standards.lock.json` pins their spec revisions, deployed network contracts, ABI hashes, Studio CLI/runtime, Agent SDK, and Altana SDK. An upgrade requires compatibility tests and a new reviewed lock.

The lock must contain, without placeholder values:

```text
schemaVersion
agentStudio
  ├── cli
  └── runtime
packages
  ├── agentSdk
  └── altanaSdk
networks
  ├── "56"
  │   ├── confirmationThreshold
  │   ├── erc8004 { specRevision, identityRegistry, abiHash }
  │   └── erc8183 { specRevision, commerceContract, paymentToken, abiHash, evaluatorProfile }
  └── "97"
      ├── confirmationThreshold
      ├── erc8004 { specRevision, identityRegistry, abiHash }
      └── erc8183 { specRevision, commerceContract, paymentToken, abiHash, evaluatorProfile }
```

Omit an unsupported deployment rather than inventing an address. CI resolves every configured contract, hashes the checked-in ABI, and fails on a lock/runtime mismatch.

Identify every agent by:

```text
namespace + chainId + identityRegistry + agentId
```

Register each created agent after obtaining its public HTTPS endpoint, using the custody-specific ownership flow described above.

Metadata includes:

- Name and description.
- Category.
- BSC chain.
- Normalized advertised service descriptors for A2A, MCP, ERC-8183, X402, or other supported faces.
- Capability-manifest digest.
- Template slug and version.
- Runtime/template digest.
- Pricing summary.
- Altana smart-wallet address.
- Greenfield profile URI.
- Marketplace profile URL.

Automatically discovered and manually supplied ERC-8004 identities can enter the ingestion pipeline without owner participation. Before an unclaimed record becomes `verified`, BNBEra requires:

- Resolving the owner and metadata onchain.
- Verifying the endpoint.
- Verifying advertised protocols.
- Running a safe capability test.
- Checking that the listing data matches the identity.

SIWE proof by the current ERC-721 owner is required only to set `claim_status=claimed`, edit owner-controlled data, or obtain an owner-verified label. A canonical owner change sets the prior claim to `stale`. Claiming does not change `origin_type` and does not imply verification or publication.

### 10.2 ERC-8183 jobs

Use the exact BNB Agent SDK deployment and evaluator/policy profile pinned in the standards lock; do not assume every ERC-8183 deployment has identical settlement or dispute semantics.

Implement:

1. Agent discovery.
2. Quote negotiation.
3. Explicit min/max pricing.
4. Buyer funding.
5. Provider detection of funded status.
6. Work execution.
7. IPFS deliverable publication.
8. Greenfield evidence publication.
9. Output-hash submission.
10. Buyer fetch and verification.
11. Buyer approval, rejection, dispute, and settlement.

Never auto-settle on behalf of the buyer.

### 10.3 x402/B402

Treat X402 as a selected public request/payment face and B402 as its BNB settlement rail. They are related but not interchangeable labels.

Use for bounded analysis and data services, such as:

- Current LP rebalance analysis.
- Grid status and next-action report.
- Yield comparison.
- Health-factor risk report.

Controls include:

- Expected chain pinned independently.
- Settlement asset, decimals, facilitator host, and expected recipient pinned independently of the payment challenge.
- Maximum value per call.
- Cumulative session budget.
- Quote expiry.
- Replay protection.
- No automatic retry after an unknown post-payment outcome.
- Payment receipt in the evidence bundle.

Paid mode requires a complete per-agent record mapped to the pinned Studio `[payments.b402_seller]` schema:

```text
B402SellerConfiguration
  merchantEnvironment
  merchantAccountReference
  facilitatorEndpoint
  settlementNetwork
  settlementAsset
  settlementDecimals
  payoutAddress
  fixedEgressProfile
  publicX402Url
  agentCoreRelayAuthenticationReference
  priceUsd
```

Merchant credentials and relay secrets are secret references only. A self-hosted AgentCore seller uses a buyer-facing X402 gateway, authenticated relay into AgentCore, and fixed-egress connectivity to B402. For Altana, the expected payout is the administrator address and the UI must show and verify it. ERC-8183 testnet `U` and the B402/X402 settlement asset are separate rails and must never share token assumptions or accounting fields.

The paid canary observes the challenge, payment, authenticated replay, B402 settlement receipt, expected payout recipient, and delivered response. Current Studio settles before work and does not automatically refund a later work failure, so BNBEra discloses that behavior and fails closed on ambiguous settlement state.

---

## 11. Greenfield architecture

Greenfield is the canonical public evidence layer. It is not represented as BSC transaction calldata storage: Greenfield records object metadata, integrity and ownership on its chain while storage providers retain the payload. Use the official [Greenfield JavaScript SDK](https://docs.bnbchain.org/bnb-greenfield/for-developers/apis-and-sdks/sdk-js/).

### 11.1 Dual-publishing

- IPFS remains the Agent Studio-compatible ERC-8183 deliverable location.
- Greenfield stores the complete versioned audit bundle.
- ERC-8183 output metadata contains the IPFS URI, Greenfield URI, and matching content hash.
- The marketplace verifies both copies.
- A final evidence index is sealed, read back, hash-verified, and linked from BNBEra profiles, jobs, and evidence pages.

Greenfield resource mirroring and custom BSC digest anchoring are outside the hackathon path. Mirroring has ownership and management semantics and is not a lightweight checksum operation.

### 11.2 Public objects

Publish:

- Versioned agent profile.
- Capability manifest.
- Template and configuration digest.
- Data-source provenance.
- Decision record.
- Candidate and rejected actions.
- Simulation.
- Risk checks.
- Transaction receipt.
- Before/after state.
- ERC-8183 deliverable metadata.
- x402 receipt.
- TermiX benchmark inputs and outputs.
- Submission evidence index.

Never publish:

- Private keys.
- Session serialization.
- Wallet passwords.
- AWS secrets.
- Private portfolio identifiers not already public.
- Email, IP address, or authentication records.
- Raw internal prompts.
- Unredacted stack traces.
- Cloud resource credentials.
- Drafts not approved for publication.

### 11.3 Object layout

```text
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/profile.json
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/capabilities.json
agents/{namespace}/{chainId}/{identityRegistry}/{agentId}/versions/{version}/authority.json
runs/{jobId}/bundle.json
runs/{jobId}/deliverable.json
benchmarks/{taskId}/comparison.json
submission/evidence-index.json
```

Namespace and registry-address path segments are canonicalized and validated so the storage key preserves the complete ERC-8004 identity without collisions.

Bundle related small records to account for Greenfield’s minimum charged object size described in its [FAQ](https://docs.bnbchain.org/bnb-greenfield/getting-started/general-faqs/).

### 11.4 Canonicalization and integrity

For every object:

1. Validate against a versioned Zod/JSON schema.
2. Remove secrets and disallowed fields.
3. Canonicalize JSON using deterministic key ordering.
4. Compute SHA-256 and keccak256.
5. Create the Greenfield object transaction.
6. Upload the bytes to the selected storage provider.
7. Poll until sealed.
8. Read the object back.
9. Recalculate hashes.
10. Store the Greenfield transaction, object, seal state, size, and hashes in PostgreSQL.
11. Expose the object as verified only after readback succeeds.

### 11.5 Publisher security

- Run the publisher on AWS, not Vercel.
- Store its Greenfield signing material in Secrets Manager.
- Use a dedicated low-balance publisher identity.
- Do not reuse an agent session or user treasury key.
- Apply rate limits and maximum object sizes.
- Reject unexpected MIME types.
- Publish JSON and explicitly approved deliverable assets only.

### 11.6 Retention

- Profiles and evidence are immutable and versioned.
- Updating an agent creates a new profile version.
- Removing a listing creates a public status/tombstone version rather than rewriting history.
- Runtime secrets are destroyed when an agent is destroyed.
- Public evidence remains available for audit.
- Private operational logs follow a shorter configurable retention policy and never enter Greenfield.

---

## 12. Database model

Use Drizzle migrations with PostgreSQL enums, foreign keys, unique constraints, and JSONB schemas.

### Core identity

`users`

- BetterAuth user identity.
- Username/display information.
- No World ID fields.

`wallet_addresses`

- User.
- Checksummed address.
- Chain.
- Primary status.
- Last ownership verification.

`erc8004_identities`

- Namespace.
- Chain ID.
- Identity Registry address.
- Agent ID.
- ERC-721 owner and owner-observed block.
- Verified `agentWallet` and verification-observed block.
- Agent URI and content digest.
- Unique constraint over namespace, chain ID, registry address, and agent ID.

`agent_discovery_sources`

- Agent identity.
- Source: `8004scan`, `registry_event`, `manual`, or `creator`.
- Source-specific cursor/reference.
- First and last observed timestamps.
- Raw-response digest and normalized-ingestion version.

`erc8004_chain_observations`

- Agent identity, event type, transaction hash, and log index.
- Observed block number and block hash.
- Confirmation state: `provisional`, `canonical`, or `orphaned`.
- Normalized owner, Agent URI, and `agentWallet` values affected by the observation.
- First-observed and canonicalized/orphaned timestamps.

`chain_ingestion_checkpoints`

- Chain ID and registry address.
- Last scanned block/hash and last finalized block/hash.
- Configured confirmation threshold.
- Cursor version and last reconciliation timestamp.

### Templates

`agent_templates`

- Template UUID.
- Slug.
- Semantic version.
- Category.
- Display metadata.
- Configuration JSON Schema.
- Capability manifest.
- Protocol manifest.
- Contract/selector allowlist.
- Template artifact digest.
- Source commit.
- Release status.
- Created and activated timestamps.

### Creation

`agent_drafts`

- Creator.
- Template/version.
- Name and slug.
- Description.
- Validated configuration.
- Pricing configuration.
- Derived policy.
- Draft status.
- Idempotency key.
- Publication consent.

`agent_authorities`

- Agent or draft.
- Chain.
- Wallet provider and execution wallet.
- Altana smart wallet when applicable.
- Admin wallet.
- Session public address.
- Calls allowlist.
- Spend limits.
- Expiry.
- Keystore registration transaction.
- Last verified block.
- Status.
- Secrets Manager reference only—never secret content.

### Runtime

`agent_deployments`

- Agent/draft.
- Provider.
- Region.
- AgentCore ARN.
- Ingress/gateway identifiers and public URL.
- Template and configuration digests.
- State and current step.
- Attempt.
- Sanitized error code/message.
- Started and completed timestamps.

`deployment_events`

- Append-only deployment transition log.
- External resource references.
- Transaction hashes.
- Retryability.

### Marketplace

`agents`

- Optional creator and current observed external owner.
- ERC-8004 identity foreign key.
- Origin type: `discovered`, `manual_import`, or `created`.
- Claim status: `unclaimed`, `claimed`, or `stale`.
- Verification status: `pending`, `verified`, `degraded`, or `rejected`.
- Runtime status: `live`, `unavailable`, or `paused`.
- Authority status: `none`, `active`, `expired`, or `revoked`.
- Listing status: `draft`, `published`, `paused`, `suspended`, or `delisted`.
- Owner-claim verification and timestamp.
- Category.
- Current version.
- Exact BSC chain.
- Execution wallet/provider summary.
- Current normalized service-set version.

`agent_services`

- Agent/version and service kind: A2A, MCP, X402, MPP, readiness, or reviewed adapter; advertised commerce capabilities record ERC-8183 support separately.
- Advertised URL and protocol version.
- Discovery source: ERC-8004 metadata, Agent Card, MCP metadata, Creator, or adapter.
- Validation status, observed timestamp, latency, and safe capability-probe result.
- No assumption that an external agent exposes Studio-specific paths.

`agent_versions`

- Immutable versioned public metadata.
- Capability and pricing manifests.
- Greenfield profile reference.
- Template provenance.

`agent_listing_embeddings`

- Agent version.
- Embedding.
- Embedding provider, model, model version, and dimension.
- Source-text digest.
- Semantic document schema version.
- Created timestamp.

The hackathon pins one dimension for this table/index. A dimension change uses a versioned table/index migration.

`agent_category_predictions`

- Agent version.
- Predicted category.
- Structured and semantic scores.
- Confidence.
- Evidence list and method.
- Classifier version.
- Review state and reviewer.

`agent_health_snapshots`

- Endpoint status.
- Protocol checks.
- Authority status.
- Data freshness.
- Latency.
- Observed block/time.

`agent_enrichment_observations`

- Agent/version and provider.
- Observation type and normalized public payload.
- Source timestamp/block where available.
- Freshness and validation state.
- Payload digest.

Binance observations are optional enrichment and never replace canonical protocol state, simulation, or receipts.

`b402_seller_configurations`

- Agent and enabled X402 face.
- Merchant environment and secret account reference.
- Facilitator endpoint and fixed-egress profile.
- Settlement network, asset, and decimals.
- Expected payout address and its derivation/verification state.
- Public X402 URL and AgentCore relay-authentication secret reference.
- USD price, configuration version, and last paid-canary result.
- No merchant credential or relay secret content.

### Commerce and evidence

`commerce_jobs`

- ERC-8183 job ID.
- Buyer/provider.
- Quote and price.
- Task/input hash.
- Lifecycle status.
- Funding, fulfillment, dispute, and settlement hashes.

`agent_runs`

- Agent and job.
- Template/version.
- Input snapshot.
- Decision summary.
- Selected action.
- Before/after state.
- Transaction hash.
- Success/failure.
- Started/finished timestamps.

`evidence_objects`

- Run/profile/benchmark owner.
- IPFS URI.
- Greenfield bucket/object.
- Content hashes.
- Creation transaction.
- Seal state.
- Readback state.
- Size and MIME type.

`audit_events`

- Actor.
- Action.
- Resource.
- Input/output digests.
- Request ID.
- Block and transaction context.
- Timestamp.

`match_events`

- Buyer request.
- Eligible/excluded agents.
- Component scores.
- Exclusion reasons.
- Selected agent.

No donor seed record is migrated as live marketplace data.

---

## 13. Interfaces

### Creator tRPC procedures

```text
creator.listTemplates
creator.createDraft
creator.updateDraft
creator.prepareAuthority
creator.confirmAuthority
creator.prepareIdentityOwnership
creator.confirmIdentityOwnership
creator.deploy
creator.getDeployment
creator.retryDeployment
creator.renewAuthority
creator.pause
creator.revoke
creator.destroy
```

### Marketplace procedures

```text
marketplace.search
marketplace.compare
marketplace.getAgent
marketplace.getLiveMetrics
marketplace.getEvidence
marketplace.ingestCandidate
marketplace.importExisting
marketplace.verifyExisting
marketplace.claimExisting
marketplace.publishClaimed
```

### Commerce procedures

```text
commerce.requestQuote
commerce.createJob
commerce.fundJob
commerce.getJob
commerce.fetchDeliverable
commerce.approve
commerce.reject
commerce.dispute
commerce.settle
```

### Public agent service contract

Public interfaces are discovered and validated, not globally hardcoded.

For Studio-created reference agents:

- A2A uses the Agent Card and its advertised JSON-RPC endpoint.
- MCP uses the advertised Streamable HTTP endpoint; Studio commonly mounts it at `/mcp`.
- X402 uses `/x402` only when that face is selected and configured.
- ERC-8183 seller operations are exposed through the selected A2A/MCP face, not a BNBEra-assumed `/apex/*` service.
- A readiness endpoint is a BNBEra/reference-runtime operational feature and is not advertised as a universal agent standard.

For external agents, resolve services from ERC-8004 metadata, A2A Agent Cards, MCP metadata, or a reviewed adapter. Persist the discovered URL and protocol version and probe it safely. Do not require Studio-specific paths. MPP may be recorded when externally advertised, but it is outside the initial BNBEra Creator scope and must not be silently substituted for X402.

### Marketplace MCP tools

```text
search_agents
get_agent
compare_agents
request_quote
hire_agent
get_job
get_evidence
```

Hiring tools must return an unsigned action for user approval unless an already valid Altana buyer session explicitly covers it.

### Error format

All web, tRPC, ingestion, deployment-worker, and agent-runtime failures use a structured envelope:

```json
{
  "error": {
    "code": "AUTHORITY_EXPIRED",
    "message": "The agent session expired and must be renewed.",
    "requestId": "req_...",
    "retriable": false,
    "nextAction": "renew_authority"
  }
}
```

HTML error pages must never be parsed as JSON by the client.

---

## 14. Security controls

### Application

- SIWE nonce, domain, chain, issued-at, and expiry validation.
- Secure, HTTP-only session cookies.
- CSRF protection.
- Strict Zod validation at every boundary.
- Rate limits on creation, deployment, quote, and paid endpoints.
- Administrator authorization separate from creator authorization.
- Content Security Policy.
- No HTML injection from agent metadata.
- URL and endpoint SSRF protections.
- No arbitrary callback targets.

### Build and supply chain

- Audited, operator-activated strategy versions only.
- Immutable lockfiles.
- Pinned package versions.
- Verified `config/standards.lock.json` containing Studio CLI/runtime, Agent SDK, Altana SDK, draft spec revisions, deployed contract addresses, and ABI hashes.
- Signed template manifests.
- Dependency and container scanning.
- Secret scanning.
- No user-controlled shell fragments, filenames, imports, packages, or environment names.
- Ephemeral build environment.
- Sanitized build logs.
- Reproducible artifact digest.

### AWS

- Separate IAM role per runtime.
- Runtime access limited to its own secret.
- One Studio runtime serves all selected faces and can read only its bounded Altana session; the user's administrative key never enters BNBEra or the runtime.
- Ingress/Cognito/WAF authenticates and rate-limits public invocations without becoming a second agent runtime.
- Public input cannot invoke generic signing or arbitrary transaction methods.
- Paid X402 gateway credentials, B402 merchant credentials, and AgentCore relay authentication are isolated per agent and represented in PostgreSQL only by secret references.
- Fixed egress permits only the pinned B402/facilitator destinations required by the selected environment.
- Vercel uses short-lived AWS federation rather than permanent AWS keys where supported.
- Cloud resources tagged with agent and deployment IDs.
- Explicit resource ceilings.
- Destroy workflow removes the runtime, BNBEra-managed ingress resources, and runtime secret/session artifact after authority is revoked.

### Onchain

- Current chain ID pinned.
- Contract addresses, ABI hashes, draft spec revisions, and SDK versions pinned by environment.
- Contract bytecode/config checked at startup.
- No arbitrary calldata.
- Simulation before state change.
- Independent facilitator host, network, settlement-asset, decimals, amount, and recipient verification for X402/B402.
- Maximum token amount and native value.
- Nonce and replay controls.
- Receipt confirmation and reorg handling.
- Fail closed on RPC disagreement, stale data, or authority verification failure.

### Data and AI

- LLM receives read-only structured inputs.
- LLM output cannot trigger execution directly.
- Prompt-injected external data remains untrusted text.
- Decision engine uses normalized protocol data.
- Public evidence is redacted through schema allowlisting.
- No secret-bearing object can enter Greenfield.

---

## 15. Observability and operations

Track:

- Deployment success rate and duration by step.
- AgentCore runtime, authenticated ingress, and selected-face health.
- ERC-8004 resolution.
- Altana session expiry and revocation.
- ERC-8183 job conversion and completion.
- X402 gateway/relay failures, B402 settlement state, unknown post-payment outcomes, and payout-recipient mismatches.
- Protocol-data staleness.
- Transaction simulation and execution failures.
- Greenfield creation, upload, sealing, and readback latency.
- Matcher exclusion reasons.
- Cost per hosted agent.

Every request, job, deployment, run, and evidence publication carries a shared correlation ID.

Background monitors:

- Endpoint health every minute.
- Authority state before every match and execution.
- Session-expiry scan at least every five minutes.
- Greenfield pending-seal reconciliation.
- ERC-8183 funded-job watcher.
- Runtime resource reconciliation.
- ERC-8004 ownership/metadata/`agentWallet` change detection.
- 8004scan/direct-event ingestion cursor, finality lag, block-hash continuity, reorg rollback/replay, deduplication, and normalization failures.

Alerts:

- Agent listed but endpoint unavailable.
- Session revoked while runtime still active.
- Greenfield evidence hash mismatch.
- Signing attempt outside policy.
- Unexpected contract address.
- Build artifact digest mismatch.
- Repeated deployment failures.
- Chain reorg reconciliation failure or a stale claim still shown as owner-verified.
- Paid X402 face published without complete B402 configuration or a verified payout recipient.
- Sponsorship or cloud quota abuse.

---

## 16. Test plan

### Unit tests

- Every template configuration boundary.
- Policy derivation.
- Spend-cap calculations.
- Selector allowlist generation.
- Pricing serialization.
- Lifecycle transitions.
- Independent origin, owner-claim, verification, runtime, authority, and listing transitions.
- Idempotency.
- Evidence canonicalization and hashing.
- Match hard filters and weighted score.
- Structured-plus-semantic category prediction and low-confidence review routing.
- Data freshness.
- Error envelopes.
- Secret redaction.

### Integration tests

- BetterAuth SIWE.
- Drizzle migrations and constraints.
- BSC RPC fallback.
- 8004scan ingestion, advertised-service discovery, and deduplication by namespace/chain/registry/agent ID.
- Direct-event provisional/canonical handling, configurable finality, block-hash mismatch rollback/replay, canonical state reread, and stale-claim invalidation.
- ERC-8004 identity reads/writes, unclaimed discovery, owner claim, custody-specific created-agent registration, and post-transfer `agentWallet` re-verification.
- ERC-8183 quote, fund, fulfill, and settle.
- Browser/passkey Altana administration, bounded-session handoff into Studio/AWS, Keystore verification, expiry, and revocation.
- PancakeSwap quoting/simulation.
- Venus health-factor reads.
- Lista and yield-data reads.
- IPFS upload/readback.
- Greenfield create/upload/seal/readback.
- AWS deployment-state retries.
- Single-runtime A2A, MCP, and X402 faces behind authenticated ingress.
- Paid X402 gateway, authenticated AgentCore relay, fixed-egress B402 settlement, distinct rail asset, Altana-admin payout, and delivered response.
- `config/standards.lock.json` address, ABI-hash, draft-revision, SDK, and Studio toolchain verification.

### Security tests

- Attempt to exceed the spend cap.
- Call a non-allowlisted contract.
- Call an allowlisted contract with a forbidden selector.
- Execute after expiry.
- Execute after revocation.
- Replay an x402 proof.
- Change X402/B402 facilitator host, network, settlement asset, amount, decimals, or payout recipient.
- Force an unknown post-payment response and confirm there is no automatic payment retry.
- Submit a stale quote.
- Inject code through every creator field.
- Inject URLs targeting internal infrastructure.
- Feed oversized, recursive, malicious, and redirecting ERC-8004 metadata/endpoints into the ingestion sandbox.
- Attempt to reach generic signing or arbitrary transaction behavior through every public face.
- Force duplicate deployment requests.
- Confirm no secret appears in database, logs, browser responses, build archives, or Greenfield.

### Category and Creator end-to-end tests

For each of the four marketplace categories:

1. Resolve a live agent on the BSC network accepted by the main-track gate.
2. Verify identity, endpoint, capability, protocol support, pricing/activation, and comparable detail.
3. Exercise at least one activation or hire path and verify the returned result.
4. Confirm hard filters, category prediction, semantic retrieval, and score explanation.

For every activated Creator strategy, with at least one required for the thin Creator MVP:

1. Obtain current BSC testnet state.
2. Produce a deterministic decision and record rejected alternatives.
3. Simulate and execute through a bounded Altana session.
4. Confirm the transaction and resulting protocol state.
5. Publish the IPFS deliverable and sealed/read-back Greenfield evidence.
6. Confirm direct user-controlled ERC-8004 ownership and independently verified `agentWallet`.
7. Confirm marketplace listing and ERC-8183 hire with buyer verification/settlement.
8. Complete one paid X402 request and verify the B402 receipt and expected payout recipient.
9. Revoke the Altana session and confirm the next state-changing action fails.

### Browser acceptance

Verify:

- Public marketplace.
- Four equally complete categories.
- Agent comparison.
- Automatically discovered unclaimed agent, owner claim, and manually supplied identity flows.
- Wallet sign-in.
- Template configuration.
- Authority review.
- Deployment progress.
- Automatic listing.
- Hire flow.
- Paid X402 challenge, settlement disclosure, receipt, and payout display.
- Evidence viewer.
- Authority renewal.
- Revocation.
- Automatic pause after revocation.
- Mobile layout.
- No console errors.
- No unexpected HTML error parsing.

---

## 17. TermiX Agent Advantage Report

Run at least three paired tasks both manually and through a hired marketplace agent.

Recommended tasks:

1. Determine and execute a safe PancakeSwap V3 LP range rebalance.
2. Compare available yield and select a bounded allocation.
3. Detect and remediate a Venus health-factor risk.

For each pair, capture:

- Exact starting inputs.
- Market/block timestamp and measurement window.
- Sample size.
- Manual workflow.
- Agent workflow.
- Time to completion.
- Direct cost.
- Gas and marketplace/service fees.
- Output.
- Wins/losses where meaningful.
- Realized benefit or PnL, capital at risk, and maximum drawdown for trading records.
- Failure count and retry treatment.
- Decision quality rubric.
- Risk violations.
- Transaction result.
- Methodology and linked transactions.
- Greenfield evidence.

If the TermiX bounty is targeted, at least one paired task is explicitly from trading, stock, or security, and any trading-agent claim includes a real measurement window, win rate where meaningful, and risk taken. The report must not claim an advantage unless the measurements demonstrate it.

---

## 18. Implementation sequence

### Phase 0 — Documentation, provenance, and standards lock

- Write the four plan documents.
- Record donor hashes and provenance.
- Confirm package and licensing notices.
- Resolve the release-blocking main-track network question with the organizer: whether “live on BSC” accepts chain `97`, or requires chain `56`.
- Create `config/standards.lock.json` with the reviewed Studio CLI/runtime, Agent SDK, Altana SDK, draft revisions, deployed registry addresses, and ABI hashes.
- Complete the browser-controlled Altana-to-Studio session spike: one grant, one permitted AgentCore transaction, browser revocation, and rejection of the next write. Record whether Studio accepts an externally prepared session or the Altana SDK must provision it before Studio deployment.
- Initialize Git and pnpm workspace.
- Establish CI and branch protection.

Exit condition: donor decisions, the standards snapshot, the main-track network rule, and the evidenced Altana/Studio bootstrap path are reviewable before source migration. If the organizer has not explicitly accepted chain `97`, plan main-track eligibility around chain `56`.

### Phase 1 — TwinMarket base import

- Import the modern application skeleton.
- Move it into `apps/web`.
- Standardize on pnpm and Node 22.
- Remove World, AgentBook, ENS, Arc, ZK, mock, and private-key dependencies.
- Replace the donor visual layer with a minimal BNBEra shell.
- Establish shared domain and database packages.

Exit condition: the clean application builds with no obsolete sponsor runtime.

### Phase 2 — Database, identity, and state model

- Create the new Drizzle schema and additive migration.
- Configure BetterAuth SIWE for account access and owner claim flows.
- Store the complete ERC-8004 identity namespace: namespace, chain ID, registry address, and agent ID.
- Add discovery-source/service records, finality checkpoints, reorg-aware chain observations, and independent origin, claim, verification, runtime, authority, and listing states.
- Add creator, strategy, listing, deployment, commerce, health, evidence, audit, match, prediction, and embedding repositories.

Exit condition: authentication and an empty marketplace work without fake records, and the database cannot collapse origin, owner claim, verification, runtime, authority, or publication into one field.

### Phase 3 — Supply ingestion, marketplace, and matching

- Ingest registered agents through 8004scan, direct registry event/indexer reads, and manual import.
- Permit discovered listings without SIWE; require a wallet signature only to claim or manage an owner-controlled listing.
- Resolve public services from advertised metadata/cards or reviewed adapters instead of assuming Studio paths.
- Implement configurable event finality, reorg rollback/replay, canonical state rereads, and stale-claim invalidation.
- Implement category views, detail pages, compare, filters, and explanations.
- Add endpoint, capability, protocol, health, price, and execution-constraint verification.
- Add model-versioned pgvector embeddings over BNBEra’s verified and enriched representation.
- Persist category predictions and their evidence separately from human or owner-provided categories.
- Implement hard gates and weighted scoring.

Exit condition: discovered supply is useful before owner claim, and only listings that pass the relevant verification and runtime gates can rank or execute.

### Phase 4 — Four-category coverage gate

- Inventory eligible external supply for LP Rebalancing, Grid Trading, Yield Optimisation, and Health Factor Monitoring.
- Validate at least one credible, live listing in every category against the observable marketplace eligibility contract, with comparable detail and results/evidence appropriate to its service.
- Build and deploy a BNBEra reference strategy only where external supply leaves a coverage or demo-quality gap.
- Ensure at least one Studio-created reference agent exists for the Creator, Altana, and evidence demonstrations.
- Apply the resolved main-track chain rule independently of the Creator demo’s chain.

Exit condition: all four categories are equally credible without requiring BNBEra to implement or own four agents.

### Phase 5 — Commerce

- Add the pinned ERC-8183 provider and buyer flow.
- Add the paid X402 gateway, authenticated AgentCore relay, complete per-agent B402 merchant/settlement configuration, fixed egress, and Altana-admin payout verification.
- Keep ERC-8183 and B402 settlement assets/configuration distinct.
- Add job pages, receipts, output hashes, and settlement state.
- Verify at least one complete paid interaction against the locked deployment profile.

Exit condition: a marketplace user can find, hire, receive, verify, and settle with at least one eligible agent.

### Phase 6 — Reference agent, Altana, and Greenfield evidence

- Deploy the selected reference agent through the pinned Agent Studio workflow.
- Register it with direct user-controlled ERC-8004 ownership through the tested Studio/Altana custody path.
- If registration must originate from an operational wallet, transfer ownership and then explicitly re-establish and verify `agentWallet` before enabling execution.
- Demonstrate one bounded Altana session, one permitted transaction, revocation, and rejection of the next attempted execution.
- Publish canonical evidence, wait for sealing, read it back, and verify its hash and marketplace link.
- Keep Greenfield outside discovery eligibility; external agents need not have BNBEra-published Greenfield evidence.

Exit condition: one real reference flow proves ownership, bounded execution authority, revocation, and independently retrievable evidence without mirroring or a custom anchor contract.

### Phase 7 — Thin Creator MVP

Start this phase only after the marketplace, category-coverage, and hire-flow gates pass.

- Expose only audited strategies that have been explicitly activated for Creator use.
- Build Step Functions and CodeBuild orchestration around the pinned Agent Studio CLI.
- Deploy the single Studio runtime and place it behind the existing AWS ingress, Cognito, and WAF edge.
- Add Altana setup, identity-ownership confirmation, progress, retry, pause, renewal, revocation, and destroy controls.
- Add automatic verification and publication using the same marketplace state model.

Exit condition: a new user configures, deploys, owns, and lists one audited-strategy agent without code, a terminal, GitHub, or personal AWS setup. A generalized agent builder remains deferred.

### Phase 8 — Optional enrichment, hardening, and benchmark

- Add Binance data adapters only as typed, optional enrichment when they materially improve a category flow.
- Run security, ownership, and revocation drills.
- Add capacity and sponsorship controls.
- Complete the TermiX paired tasks if targeting that prize.
- Verify any claimed PancakeSwap benefit.
- Remove remaining placeholders and demo-only claims.
- Conduct accessibility and mobile review.

Exit condition: every published claim has evidence and no fake or unverified state is presented.

### Phase 9 — Release

- Apply the production database migration.
- Deploy AWS infrastructure and the worker.
- Run infrastructure verification.
- Deploy the Vercel application.
- Run browser-to-API-to-chain-to-Greenfield verification for the flows actually included in the release.
- Run category canaries under the resolved main-track network rule.
- Keep autonomous write execution on testnet unless mainnet execution is separately reviewed and approved.
- Complete commit, CI, review, merge, remote-SHA, and production-deployment verification when publication is authorized.

---

## 19. Release gates

The release is complete only when:

- The public application is accessible.
- The chain `56` versus chain `97` main-track gate is closed and recorded. Explicit organizer acceptance may allow chain `97`; without it, every agent counted toward the main-track category gate is on chain `56`.
- All four categories pass the documented coverage gate with at least one credible eligible listing and activation/hire path; qualifying agents may be externally discovered, manually imported, owner-claimed, or BNBEra-created.
- Every surfaced listing accurately reports origin, owner claim, verification, runtime, authority, and listing state independently.
- An unclaimed registered agent can be discovered and listed without SIWE, and its owner can later claim it with a wallet signature.
- A canonical ERC-8004 ownership change makes the prior claim stale, and reorg rollback/replay cannot leave orphaned ownership or `agentWallet` data presented as canonical.
- Every eligible agent exposes the observable capability, input/output, health, price/activation, data provenance, result/evidence, and execution-constraint information appropriate to the service it actually offers; external internal architecture is not assumed.
- At least one ERC-8183 hire completes end to end.
- At least one paid X402 request completes through the authenticated gateway/AgentCore relay and pinned B402 settlement configuration, with the distinct settlement asset, receipt, and expected payout recipient verified.
- The phase-zero browser-controlled Altana-to-Studio bootstrap is evidenced against the pinned versions before Creator implementation.
- At least one Studio-created reference agent demonstrates real Altana allowlists, caps, expiry, and the tested custody-specific setup.
- Direct user control of the reference agent’s ERC-8004 NFT is verified; if a transfer fallback was used, `agentWallet` was re-established and re-verified after transfer.
- A user can inspect and revoke authority inside BNBEra.
- Revocation prevents the next execution.
- The checked-in standards lock matches the CLI/runtime, SDKs, draft revisions, deployed addresses, and ABIs exercised by the release.
- Any PancakeSwap benefit claimed in the submission is demonstrated with measured evidence.
- Greenfield evidence for BNBEra-created or reference flows is sealed, read back, and linked from the marketplace.
- Evidence hashes match local, IPFS, and Greenfield records.
- If the TermiX prize is targeted, the three paired tasks and actual outputs are published; at least one is trading/stock/security, and any trading record reports its measurement window, sample size, win rate where meaningful, realized result, capital at risk, maximum drawdown, failures, methodology, fees, and linked transactions.
- After its prerequisite marketplace gates pass, one user-created audited-strategy agent progresses from configuration to listing without a terminal, IDE, GitHub, or personal AWS setup.
- No private key is stored in PostgreSQL or returned through an API.
- No mock metric appears as real data.
- CI, remote commit, migration, deployment, and production behavior are independently verified.

## 20. Explicit assumptions

- “Merge the donor repositories” means TwinMarket base plus selective AgentTrust port, as chosen.
- The donor frontends will not be reused.
- The user is authorized to use the supplied donor code, with provenance documented before external publication.
- The marketplace is open to eligible registered agents; audited strategies constrain only the thin Creator MVP.
- Autonomous Creator writes default to BSC testnet. The main-track category gate follows the organizer-confirmed chain rule and defaults to chain `56` in the absence of explicit chain `97` acceptance.
- Mainnet external agents may be discovered and compared without authorizing BNBEra to execute mainnet writes.
- The platform pays initial AWS and testnet operating costs.
- One active hosted agent is allowed per verified wallet.
- Users must approve wallet operations but perform no coding.
- The user retains Altana administrative control.
- The platform runtime holds only a bounded, expiring session key.
- Agent Studio `0.0.13` supplies the single TypeScript agent runtime and signer boundary; AWS ingress, Cognito, and WAF remain the public edge. No parallel Fargate execution tier is assumed.
- ERC-8004 and ERC-8183 replace donor identity and escrow contracts.
- IPFS remains the Studio-compatible deliverable path.
- Greenfield is BNBEra’s canonical evidence layer for records it publishes, not a prerequisite for discovering external agents.
- 8004scan accelerates discovery, while direct chain reads remain the registry truth and BNBEra retains its own verified/enriched retrieval index.
- Draft standards and deployed contracts are used only through the reviewed versions recorded in `config/standards.lock.json`; “latest documentation” is not a reproducible dependency.
- Mainnet execution, arbitrary generated code, user-provided dependencies, unrestricted keys, custom escrow contracts, fake reputation, and automatic buyer settlement are excluded from the initial release.

## Changelog

- **1.3 — 2026-09-01:** Made public agent interfaces discovery-driven, separated external marketplace eligibility from BNBEra strategy internals, added the browser Altana-to-Studio bootstrap spike and complete paid-X402/B402 deployment contract, split origin/claim/listing state, added ERC-8004 finality/reorg semantics, and completed the conditional TermiX track-record fields.
- **1.2 — 2026-09-01:** Separated provenance, verification, runtime, and authority; expanded external agent ingestion; made four-category coverage supply-driven; retained a gated thin Creator MVP; adopted the single Studio runtime; clarified direct ERC-8004 ownership and transfer recovery; removed Greenfield mirroring; added a standards lock and a release-blocking chain-eligibility gate.
- **1.1 — 2026-09-01:** Added the exact BNBEra purple, BSC yellow, and Greenfield green design roles; constrained pgvector to public semantic agent metadata and kept live DeFi data structured.
- **1.0 — 2026-09-01:** Initial consolidated marketplace, no-code deployer, and Greenfield plan.
