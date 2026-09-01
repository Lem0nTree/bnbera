# BNBEra: Ultra-Detailed Marketplace, No-Code Agent Deployer, and Greenfield Plan

**Status:** Approved implementation plan
**Revision:** 1.1
**Date:** 2026-09-01

Focused plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [Greenfield data and evidence](./02-greenfield-data-and-evidence-plan.md)
- [No-code agent deployer](./03-no-code-agent-deployer-plan.md)

## 1. Outcome and locked decisions

Create a new production-oriented application at:

`C:\Users\loren\Documents\ChatGPT\bnbhack\bnbera`

The result will be a public BNB Chain agent marketplace where users can:

1. Discover and compare live agents across all four Smart Money categories.
2. Inspect real-time data, verified capabilities, prices, execution history, and onchain authority.
3. Hire agents through ERC-8183 or pay per request through x402/B402.
4. Create and deploy an agent without writing code, opening an IDE, or configuring AWS.
5. Control the deployed agent through a user-owned Altana wallet with an onchain allowlist, spend cap, and expiry.
6. Publish agent profiles, decisions, deliverables, benchmarks, and execution evidence through BNB Greenfield.

The implementation is optimized for the official [Smart Money Era tracks](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks) and the current [BNB Agent Studio workflow](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/).

| Decision | Selected approach |
|---|---|
| Application base | TwinMarket backend and application skeleton |
| AgentTrust contribution | Selective port of capability, audit, verification, and requester/provider patterns |
| Frontend | Entirely new BNBEra interface; no donor frontend reuse |
| Creator experience | Fixed no-code templates |
| Hosting | Platform-hosted AWS AgentCore |
| Initial chain | BSC testnet |
| Wallet authority | User-controlled Altana wallet with scoped runtime session |
| Agent identity | Official ERC-8004 |
| Hiring | Official ERC-8183 |
| Per-request payments | x402/B402 |
| Protocol focus | PancakeSwap, Venus, and Lista |
| Deliverable compatibility | IPFS |
| Canonical public evidence | BNB Greenfield |
| Web deployment | Vercel |
| Database | PostgreSQL with pgvector |
| User-created limits | One active hosted agent per verified wallet |
| Arbitrary generated code | Excluded |
| Custom escrow/identity contracts | Excluded |
| Mainnet | Disabled until explicit post-testnet gates pass |

---

## 2. Documentation publication

Execution begins by publishing four Markdown documents inside `bnbera\docs`.

### `01-marketplace-donor-merge-plan.md`

Contains:

- TwinMarket and AgentTrust audit.
- Exact retain, transform, replace, and delete decisions.
- Target monorepo structure.
- Authentication, database, marketplace, commerce, and matching architecture.
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
- BSC cross-chain evidence anchoring.
- Cost, batching, retention, and failure behavior.

### `03-no-code-agent-deployer-plan.md`

Contains:

- Creator UX.
- The four fixed templates and their configurable fields.
- Altana wallet and session setup.
- Platform-hosted AWS architecture.
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
│   ├── agent-service/               # Keyless public ERC-8183/A2A/x402 service
│   └── health-monitor/              # Endpoint, authority and evidence watcher
├── packages/
│   ├── db/                          # Drizzle schema, migrations and repositories
│   ├── domain/                      # Shared types, schemas and lifecycle rules
│   ├── marketplace/                 # Search, ranking and listing verification
│   ├── agent-commerce/              # ERC-8004, ERC-8183 and x402 integrations
│   ├── agent-runtime/               # Shared safe execution and decision engine
│   ├── agent-templates/             # Four versioned fixed templates
│   ├── altana/                      # Wallet, session, policy and revocation support
│   ├── greenfield/                  # Evidence publisher and integrity verifier
│   ├── data-sources/                # PancakeSwap, Venus and Lista adapters
│   └── ui/                          # New BNBEra design system
├── infra/
│   ├── aws/                         # AgentCore, CodeBuild, ECS and workflow IaC
│   └── vercel/                      # Web deployment configuration
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
- The creator wizard becomes the fixed-template no-code deployment wizard.
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
- Live, degraded, paused, or unavailable state.
- BSC network.
- ERC-8004 identity.
- Supported protocol.
- Agent Studio template/version.
- Last successful health check.
- Last successful execution time.
- Price or price range.
- Altana authority status and expiry.
- Spend-cap summary.
- Evidence freshness.
- Successful and disputed ERC-8183 jobs.
- Greenfield evidence link.
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
- Who owns and can revoke it?
- Is the endpoint healthy now?
- How was its latest decision derived?

The page includes:

- Live data panel.
- Capability manifest.
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

### 6.1 Hard eligibility

An agent is excluded before scoring if any of these fail:

- Wrong BSC environment.
- Wrong category.
- Required protocol unsupported.
- Endpoint unhealthy.
- ERC-8004 identity unresolved.
- Altana session missing, expired, revoked, or unverifiable for an execution request.
- Requested amount exceeds the agent policy.
- Required contract or selector is outside the allowlist.
- Price exceeds the buyer’s maximum.
- Required data is stale.
- Template or capability version is unsupported.
- Listing is paused, suspended, transferred, or under verification.

### 6.2 Scoring

Score eligible candidates from 0–100:

| Component | Weight |
|---|---:|
| Capability and task fit | 35 |
| Endpoint and runtime health | 20 |
| Current-data quality and provenance | 15 |
| Authority and budget compatibility | 15 |
| Fresh successful onchain execution | 10 |
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

Store the agent-version ID, `vector(1536)`, embedding model, source-text hash, and creation time. Regenerate the vector when the published profile version changes, not when a live metric changes. If embedding generation fails, structured filters and PostgreSQL full-text search remain available.

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

### 6.3 Data freshness

Use consistent block-number snapshots where possible.

Maximum execution freshness:

- DEX price and executable quote: 30 seconds.
- Lending position and health factor: one block or 15 seconds.
- Wallet balances: one block or 15 seconds.
- Pool APR/APY and incentive state: five minutes.
- Endpoint health: one minute.
- Altana authority: confirmed current chain state before every execution.

Stale data may still be shown with a warning, but execution fails closed.

---

## 7. Four first-class agent templates

All four share the same depth:

- Current-data adapter.
- Deterministic decision engine.
- Simulation.
- Risk validation.
- Bounded execution.
- Before/after validation.
- ERC-8183 job support.
- x402 analysis endpoint.
- Greenfield evidence.
- Live BSC testnet reference deployment.
- Marketplace comparison fields.

The LLM may explain a deterministic decision. It cannot choose arbitrary contracts, sign transactions, modify price limits, or bypass policy.

### 7.1 PancakeSwap LP Rebalancing

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

### 7.2 PancakeSwap Grid Trading

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

### 7.3 Yield Optimisation

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

### 7.4 Health Factor Monitoring

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

### 8.1 User experience

The user performs no programming or cloud setup.

Wizard steps:

1. Choose one of the four templates.
2. Configure strategy parameters.
3. Configure ERC-8183 and x402 pricing.
4. Review current-data sources.
5. Review derived Altana authority.
6. Connect and authenticate wallet.
7. Create/select the Altana smart wallet.
8. Approve the scoped session.
9. Confirm deployment.
10. Follow live progress.
11. Review the validation transaction and evidence.
12. Publish automatically after all gates pass.

The user must approve wallet transactions. “No code” does not mean silent financial authorization.

### 8.2 Agent Studio template release process

Do not generate arbitrary production code from user prompts.

For every template version:

1. Scaffold a clean official Agent Studio seller project.
2. Pin the Agent Studio, Agent SDK, Altana SDK, viem, and protocol package versions.
3. Implement the audited template behavior.
4. Generate a strict JSON Schema for configuration.
5. Generate the contract and selector manifest.
6. Run lint, typecheck, unit tests, integration tests, `bag doctor`, package inspection, and testnet canary.
7. Produce a content-addressed immutable template bundle.
8. Sign the template manifest.
9. Publish the version to `agent_templates`.
10. Make it selectable only after an administrator activates it.

User input is stored as data and never interpolated into executable TypeScript.

### 8.3 Deployment architecture

```text
Browser
  │
  ├── SIWE and Altana authorization ───────────► BSC / Altana Keystore
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
            ├── CodeBuild: materialize and validate template
            ├── Secrets Manager: scoped session material
            ├── AgentCore: private signing/decision runtime
            ├── ECS Fargate: keyless public service
            ├── ERC-8004 registration
            ├── ERC-8183/x402 verification
            ├── IPFS publishing
            └── Greenfield publishing and seal verification
```

Vercel never runs the long deployment inline. The creation mutation returns a deployment ID immediately.

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
9. `deploying_service`
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

If AgentCore succeeds but the public service fails:

- Keep the runtime paused.
- Retry the keyless service.
- Do not register an unusable public endpoint.

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

- BSC testnet only.
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
- The EOA remains the Altana administrator.
- The user controls grant, renewal, and revocation.
- The marketplace cannot broaden the policy.
- The platform holds only the scoped agent session required for autonomous execution.

### 9.2 Session lifecycle

1. The isolated deployer generates a session keypair.
2. The private component is immediately encrypted in AWS Secrets Manager.
3. Only the session address and proposed policy reach the browser.
4. The user grants that address authority through Altana.
5. The backend verifies the confirmed Keystore state.
6. AgentCore receives secret access through its dedicated IAM role.
7. The session is revalidated before every write.
8. Expiry or revocation disables execution and listing eligibility.

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

Register each created agent after obtaining its public HTTPS endpoint.

Metadata includes:

- Name and description.
- Category.
- BSC chain.
- A2A, MCP, ERC-8183, and x402 endpoints.
- Capability-manifest digest.
- Template slug and version.
- Runtime/template digest.
- Pricing summary.
- Altana smart-wallet address.
- Greenfield profile URI.
- Marketplace profile URL.

External agents can be imported using an existing ERC-8004 ID only after:

- Resolving the owner and metadata onchain.
- Proving control through SIWE.
- Verifying the endpoint.
- Verifying advertised protocols.
- Running a safe capability test.
- Checking that the listing data matches the identity.

### 10.2 ERC-8183 jobs

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

Use for bounded analysis and data services, such as:

- Current LP rebalance analysis.
- Grid status and next-action report.
- Yield comparison.
- Health-factor risk report.

Controls include:

- Expected chain pinned independently.
- Expected recipient pinned independently.
- Maximum value per call.
- Cumulative session budget.
- Quote expiry.
- Replay protection.
- Payment receipt in the evidence bundle.

---

## 11. Greenfield architecture

Greenfield is the canonical public evidence layer. It is not represented as BSC transaction calldata storage: Greenfield records object metadata, integrity and ownership on its chain while storage providers retain the payload. Use the official [Greenfield JavaScript SDK](https://docs.bnbchain.org/bnb-greenfield/for-developers/apis-and-sdks/sdk-js/).

### 11.1 Dual-publishing

- IPFS remains the Agent Studio-compatible ERC-8183 deliverable location.
- Greenfield stores the complete versioned audit bundle.
- ERC-8183 output metadata contains the IPFS URI, Greenfield URI, and matching content hash.
- The marketplace verifies both copies.
- A final evidence index is mirrored or anchored to BSC through Greenfield’s [cross-chain integration](https://docs.bnbchain.org/bnb-greenfield/for-developers/cross-chain-integration/dapp-integration/).

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
agents/{chainId}/{agentId}/versions/{version}/profile.json
agents/{chainId}/{agentId}/versions/{version}/capabilities.json
agents/{chainId}/{agentId}/versions/{version}/authority.json
runs/{jobId}/bundle.json
runs/{jobId}/deliverable.json
benchmarks/{taskId}/comparison.json
submission/evidence-index.json
```

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
- Altana smart wallet.
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
- Public service ID and URL.
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

- Creator or external owner.
- Source: `platform_template` or `external`.
- Category.
- Current version.
- BSC chain.
- Status.
- ERC-8004 identity.
- Altana wallet.
- Public endpoints.

`agent_versions`

- Immutable versioned public metadata.
- Capability and pricing manifests.
- Greenfield profile reference.
- Template provenance.

`agent_listing_embeddings`

- Agent version.
- Embedding.
- Embedding model/version.
- Source-text digest.

`agent_health_snapshots`

- Endpoint status.
- Protocol checks.
- Authority status.
- Data freshness.
- Latency.
- Observed block/time.

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
marketplace.importExisting
marketplace.verifyExisting
marketplace.publishExisting
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

### Public agent faces

```text
GET  /.well-known/agent-card.json
POST /a2a
POST /mcp
POST /x402
POST /apex/negotiate
GET  /apex/jobs/{jobId}
GET  /health
```

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

All web, tRPC, worker, and agent-service failures use a structured envelope:

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

- Fixed templates only.
- Immutable lockfiles.
- Pinned package versions.
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
- Keyless public service cannot read session material.
- Vercel uses short-lived AWS federation rather than permanent AWS keys where supported.
- Cloud resources tagged with agent and deployment IDs.
- Explicit resource ceilings.
- Destroy workflow removes runtime, service, and secret after authority is revoked.

### Onchain

- Current chain ID pinned.
- Official contract addresses pinned by environment.
- Contract bytecode/config checked at startup.
- No arbitrary calldata.
- Simulation before state change.
- Independent recipient verification for x402.
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
- AgentCore and public service health.
- ERC-8004 resolution.
- Altana session expiry and revocation.
- ERC-8183 job conversion and completion.
- x402 verification failures.
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
- ERC-8004 ownership/metadata change detection.

Alerts:

- Agent listed but endpoint unavailable.
- Session revoked while runtime still active.
- Greenfield evidence hash mismatch.
- Signing attempt outside policy.
- Unexpected contract address.
- Build artifact digest mismatch.
- Repeated deployment failures.
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
- Idempotency.
- Evidence canonicalization and hashing.
- Match hard filters and weighted score.
- Data freshness.
- Error envelopes.
- Secret redaction.

### Integration tests

- BetterAuth SIWE.
- Drizzle migrations and constraints.
- BSC RPC fallback.
- ERC-8004 identity reads/writes.
- ERC-8183 quote, fund, fulfill, and settle.
- Altana wallet, session, Keystore verification, expiry, and revocation.
- PancakeSwap quoting/simulation.
- Venus health-factor reads.
- Lista and yield-data reads.
- IPFS upload/readback.
- Greenfield create/upload/seal/readback.
- AWS deployment-state retries.

### Security tests

- Attempt to exceed the spend cap.
- Call a non-allowlisted contract.
- Call an allowlisted contract with a forbidden selector.
- Execute after expiry.
- Execute after revocation.
- Replay an x402 proof.
- Change x402 recipient.
- Submit a stale quote.
- Inject code through every creator field.
- Inject URLs targeting internal infrastructure.
- Force duplicate deployment requests.
- Confirm no secret appears in database, logs, browser responses, build archives, or Greenfield.

### Template end-to-end tests

For each of the four templates:

1. Obtain current BSC testnet state.
2. Produce a deterministic decision.
3. Record rejected alternatives.
4. Simulate the action.
5. Execute through an Altana session.
6. Confirm the transaction.
7. Verify resulting protocol state.
8. Publish IPFS deliverable.
9. Publish and seal Greenfield evidence.
10. Confirm marketplace profile and search eligibility.
11. Hire through ERC-8183.
12. Complete buyer verification and settlement.

### Browser acceptance

Verify:

- Public marketplace.
- Four equally complete categories.
- Agent comparison.
- Existing-agent import.
- Wallet sign-in.
- Template configuration.
- Authority review.
- Deployment progress.
- Automatic listing.
- Hire flow.
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
- Market and block timestamp.
- Manual workflow.
- Agent workflow.
- Time to completion.
- Direct cost.
- Gas/payment cost.
- Output.
- Decision quality rubric.
- Risk violations.
- Transaction result.
- Greenfield evidence.

The report must not claim an advantage unless the measurements demonstrate it.

---

## 18. Implementation sequence

### Phase 0 — Documentation and provenance

- Write the four plan documents.
- Record donor hashes and provenance.
- Confirm package and licensing notices.
- Initialize Git and pnpm workspace.
- Establish CI and branch protection.

Exit condition: plans and donor decisions are reviewable before source migration.

### Phase 1 — TwinMarket base import

- Import the modern application skeleton.
- Move it into `apps/web`.
- Standardize on pnpm and Node 22.
- Remove World, AgentBook, ENS, Arc, ZK, mock, and private-key dependencies.
- Replace the donor visual layer with a minimal BNBEra shell.
- Establish shared domain and database packages.

Exit condition: clean application builds with no obsolete sponsor runtime.

### Phase 2 — Database and identity

- Create the new Drizzle schema.
- Add initial additive migration.
- Configure BetterAuth SIWE.
- Add creator, template, listing, deployment, authority, commerce, health, evidence, audit, and match repositories.
- Seed only the four template definitions.

Exit condition: authentication and empty marketplace work without fake records.

### Phase 3 — Marketplace and matching

- Implement category views, detail pages, compare, filters, and explanations.
- Add external ERC-8004 import.
- Add endpoint and ownership verification.
- Add pgvector embeddings.
- Implement hard gates and weighted scoring.
- Add health monitoring.

Exit condition: only verified live agents can rank.

### Phase 4 — Four reference agents

- Implement shared runtime.
- Implement all four template strategies.
- Add protocol adapters.
- Add simulations and deterministic action validation.
- Deploy one reference agent per category on BSC testnet.
- Verify at least one meaningful testnet execution per agent.

Exit condition: main-track category coverage is real and balanced.

### Phase 5 — Commerce

- Add ERC-8183 provider and buyer flows.
- Add x402/B402 services.
- Add job pages, receipts, output hashes, and settlement.
- Verify complete paid interactions.

Exit condition: a marketplace user can find, hire, receive, verify, and settle.

### Phase 6 — Greenfield

- Implement canonical evidence schemas.
- Implement the publisher, seal watcher, and readback verifier.
- Dual-publish deliverables.
- Add profile and run evidence to the UI.
- Mirror/anchor the final evidence index to BSC testnet.

Exit condition: public evidence can be independently retrieved and hash-verified.

### Phase 7 — No-code deployer

- Release signed template bundles.
- Build Step Functions and CodeBuild workflow.
- Deploy AgentCore and keyless Fargate services.
- Add Altana authority setup.
- Add progress, retry, pause, renewal, revocation, and destroy controls.
- Add automatic verification and publication.

Exit condition: a new user deploys and lists an agent without code or AWS credentials.

### Phase 8 — Hardening and benchmark

- Run security and revocation drills.
- Add capacity and sponsorship controls.
- Complete TermiX paired tasks.
- Verify PancakeSwap benefit.
- Remove remaining placeholders and demo-only claims.
- Conduct accessibility and mobile review.

Exit condition: all rubric evidence exists and no fake or unverified state is presented.

### Phase 9 — Production release

- Apply the production database migration.
- Deploy AWS infrastructure and worker.
- Run infrastructure verification.
- Deploy Vercel application.
- Run browser-to-chain-to-Greenfield verification.
- Commit and push the final release branch.
- Open and review the merge.
- Merge only after CI passes.
- Verify the remote SHA independently.
- Verify production deployment independently.
- Run post-deploy canaries for all four categories.
- Keep mainnet disabled unless separately approved after the documented gates.

---

## 19. Release gates

The release is complete only when:

- The public application is accessible.
- All four categories are equally represented.
- Every surfaced reference agent is live on BSC.
- Each agent exposes current decision-quality data.
- At least one ERC-8183 hire completes end to end.
- At least one x402/B402 request completes.
- Altana sessions show real allowlists, caps, expiry, and Keystore registration.
- A user can inspect and revoke authority inside BNBEra.
- Revocation prevents the next execution.
- Each reference template has a verified live transaction.
- PancakeSwap users or LPs receive a demonstrable benefit.
- Greenfield profiles and evidence are sealed and readable.
- Evidence hashes match local, IPFS, and Greenfield records.
- The three TermiX paired tasks and actual outputs are published.
- A user-created fixed-template agent can progress from configuration to listing without a terminal, IDE, GitHub, or AWS setup.
- No private key is stored in PostgreSQL or returned through an API.
- No mock metric appears as real data.
- CI, remote commit, migration, deployment, and production behavior are independently verified.

## 20. Explicit assumptions

- “Merge the donor repositories” means TwinMarket base plus selective AgentTrust port, as chosen.
- The donor frontends will not be reused.
- The user is authorized to use the supplied donor code, with provenance documented before external publication.
- User-created agents use fixed templates only.
- Platform-hosted creation is BSC-testnet-only for the hackathon.
- The platform pays initial AWS and testnet operating costs.
- One active hosted agent is allowed per verified wallet.
- Users must approve wallet operations but perform no coding.
- The user retains Altana administrative control.
- The platform runtime holds only a bounded, expiring session key.
- ERC-8004 and ERC-8183 replace donor identity and escrow contracts.
- IPFS remains the Studio-compatible deliverable path.
- Greenfield is the canonical evidence and provenance layer.
- The latest Agent Studio documentation supersedes older commands in the launch article.
- Mainnet execution, arbitrary generated code, user-provided dependencies, unrestricted keys, custom escrow contracts, fake reputation, and automatic buyer settlement are excluded from the initial release.

## Changelog

- **1.1 — 2026-09-01:** Added the exact BNBEra purple, BSC yellow, and Greenfield green design roles; constrained pgvector to public semantic agent metadata and kept live DeFi data structured.
- **1.0 — 2026-09-01:** Initial consolidated marketplace, no-code deployer, and Greenfield plan.
