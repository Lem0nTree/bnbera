# BNBEra No-Code Agent Deployer Plan

**Status:** Approved implementation plan
**Revision:** 1.2
**Date:** 2026-09-01

This document defines a thin BNBEra Creator MVP for no-code creation, platform-hosted deployment, verification, publication, operation, revocation, and destruction of audited-strategy BNB Agent Studio agents. It does not define a general-purpose agent-building platform.

Related plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [Greenfield data and evidence](./02-greenfield-data-and-evidence-plan.md)
- [Complete BNBEra implementation plan](./04-bnbera-master-implementation-plan.md)

Official references:

- [BNB Agent Studio launch](https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt)
- [Current Agent Studio quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
- [Agent Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
- [Pinned Agent Studio CLI package](https://www.npmjs.com/package/@bnbagent/studio-cli)
- [Agent Studio security](https://docs.bnbchain.org/developer-kit/bnbchain-studio/security/)
- [Altana in Agent Studio](https://www.bnbchain.org/en/blog/altana-in-bnb-agent-studio-agents-with-limits-you-set)
- [Altana SDK](https://www.npmjs.com/package/@altananetwork/sdk)
- [Smart Money Era tracks](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks)

## 1. Product boundary

Users can create an agent without:

- Writing code.
- Opening Cursor or Claude Code.
- Installing Agent Studio.
- Creating a GitHub repository.
- Configuring AWS.
- Handling an agent private key.
- Entering RPC or contract addresses.

Users still must:

- Connect and authenticate a wallet.
- Review the strategy configuration.
- Review the exact Altana authority.
- Confirm wallet transactions.
- Understand that the hosted runtime can act within the approved scope.

The Creator starts only after the marketplace core, discovery pipeline, category coverage gate, and one complete activation/hire flow pass. Its first release supports audited, operator-activated strategy versions only. Arbitrary generated code, packages, tools, contract addresses, calldata, and user uploads are excluded.

Explicitly excluded from the hackathon Creator:

- General-purpose prompt-to-agent generation.
- Arbitrary skills or dependency installation.
- Arbitrary contracts, RPC endpoints, tools, or callbacks.
- A visual programming language.
- A multi-cloud deployment framework.
- Unbounded combinations of capability modules.

## 2. Hosting and network decision

- BNBEra hosts user-created agents in the platform AWS account.
- Each created agent is one current BNB Agent Studio TypeScript runtime on AWS Bedrock AgentCore: one seller core, one fixed signing boundary, and one bounded Altana session.
- AWS ingress, Cognito authentication, WAF, and rate limiting protect the public edge. They are not a second agent runtime or keyless service tier.
- Vercel hosts the marketplace and creator dashboard.
- PostgreSQL stores lifecycle state, never session secrets.
- Studio's delegated AWS secret channel/Secrets Manager holds only the serialized bounded Altana runtime session and other required runtime secrets, never the user's administrative key.
- BSC testnet is the default write target for the created Altana demo while the main-track network gate is resolved.

Release-blocking network gate:

```text
Confirm with hackathon organizers whether "live on BSC"
accepts chain-97 agents for main-track marketplace coverage.

If confirmed:
  chain 97 may satisfy category coverage.

If not confirmed or rejected:
  main-track category coverage uses verified chain-56 agents;
  BNBEra-created autonomous execution remains a clearly labelled
  chain-97 Altana demonstration unless mainnet is separately approved.
```

Never match, price, compare execution authority, or present evidence across chain 56 and chain 97 as though they were the same environment.

Do not use the limited 48-hour BNB managed trial as the marketplace's durable hosting layer. The platform uses its own AWS deployment so endpoint lifecycle and availability can be managed consistently.

### 2.1 Phase-zero Altana browser-to-Studio spike

The desired custody model is approved, but the exact session bootstrap is not assumed. Before Creator implementation, prove this complete path with the pinned Studio and Altana SDK versions:

```text
browser/passkey-controlled Altana administrator
  → BNBEra displays the exact call, spend, and expiry policy
  → user grants a bounded runtime session
  → only bounded session material enters the Studio/AWS secret path
  → AgentCore executes one permitted transaction
  → user revokes in BNBEra
  → the next state-changing action is rejected
```

Accept one of two evidenced implementations:

1. Studio accepts an externally prepared Altana runtime session directly; use that supported path.
2. If Studio does not expose that bootstrap, use the pinned Altana SDK in the browser/user-approval flow and Studio only for runtime and deployment, injecting the resulting bounded session through the reviewed Studio/AWS secret path.

The spike must record the exact APIs, serialized-session format, handoff boundary, secret destination, revocation observation, and CLI/runtime versions. The user's passkey, administrative signer, and admin keystore never enter BNBEra, logs, PostgreSQL, build artifacts, or the runtime. Creator implementation is blocked until this spike passes.

## 3. Audited strategy catalog

Every strategy version is prebuilt, reviewed, tested, content-addressed, and signed before users can select it. Marketplace category coverage is independent from Creator template count: the thin Creator MVP needs one complete activated strategy, while additional strategies are activated only after their own testnet canaries pass. The following four strategies are candidates and gap-filling reference implementations, not a requirement to author four agents before marketplace launch.

### 3.1 PancakeSwap LP Rebalancing

Purpose:

- Monitor a PancakeSwap V3 LP position.
- Detect when the price exits or approaches the configured range.
- Estimate fees, movement cost, price impact, and expected benefit.
- Collect, remove, rebalance, and recreate liquidity only when policy allows.

User configuration:

- Approved pool and position.
- Range width.
- Rebalance trigger.
- Maximum position value.
- Maximum swap amount.
- Slippage limit.
- Minimum expected net benefit.
- Cooldown.
- Automatic execution toggle.

### 3.2 PancakeSwap Grid Trading

Purpose:

- Maintain a virtual grid around an approved pair.
- Execute a bounded buy or sell when a verified band is crossed.
- Track consumed levels, inventory, turnover, and risk.

User configuration:

- Approved pair.
- Lower and upper price.
- Three to twenty grid levels.
- Per-level amount.
- Maximum inventory.
- Maximum daily turnover.
- Slippage limit.
- Cooldown.
- Stop-loss boundary.

### 3.3 Yield Optimisation

Purpose:

- Compare net yield across vetted Venus, Lista, and PancakeSwap opportunities.
- Include base yield, incentives, fees, liquidity, movement cost, and risk.
- Move capital only when improvement exceeds the configured threshold.

User configuration:

- Principal asset.
- Approved venues.
- Maximum principal.
- Minimum net-yield improvement.
- Minimum liquidity.
- Minimum holding period.
- Movement cooldown.
- Slippage limit.
- Risk floor.

### 3.4 Venus Health Factor Monitoring

Purpose:

- Monitor collateral, debt, oracle prices, liquidation thresholds, and health factor.
- Warn before danger.
- Perform a bounded repayment or top-up when authorized.

User configuration:

- Venus account and market.
- Collateral and debt assets.
- Warning threshold, default `1.50`.
- Action threshold, default `1.25`.
- Target post-action health factor, default `1.70`.
- Maximum remediation amount.
- Monitoring cadence.
- Automatic execution toggle.

## 4. Template release pipeline

For every version:

1. Scaffold a clean seller project using the exact BNB Agent Studio release pinned in `config/standards.lock.json`; the initial reviewed target is Studio CLI `0.0.13`, configured with the pinned CLI's `--wallet-kind altana` path.
2. Pin Node, pnpm, Bun, Studio CLI/runtime, Agent SDK, Altana SDK, viem, deployed ERC-8004/ERC-8183 contracts and ABIs, and protocol dependencies.
3. Implement the deterministic strategy and audited execution adapter.
4. Define a strict configuration JSON Schema.
5. Define the exact contract and function-selector allowlist.
6. Define supported assets and maximum configuration bounds.
7. Run lint, typecheck, unit tests, integration tests, `bag doctor`, package inspection, and a testnet canary.
8. Generate a manifest containing source commit, package lock hash, template hash, configuration schema hash, and expected runtime faces.
9. Sign and publish the immutable template bundle.
10. Activate it in `agent_templates` only after review.

User configuration is stored as validated JSON and environment configuration. It is never interpolated into TypeScript, shell commands, imports, filenames, package names, or infrastructure identifiers without strict normalization.

Current Studio is under active development. A version upgrade creates a new reviewed toolchain lock, reruns the complete release pipeline, and produces a new template artifact; production workers never install an unpinned `latest` release.

## 5. Creator experience

### Step 1: template

Show only operator-activated audited strategies, with:

- What the agent monitors.
- What it can execute.
- Required protocol position/assets.
- Evidence produced.
- Example cost and authority shape, clearly labeled as examples.

### Step 2: strategy

Render a schema-driven form. Reject values outside the template's audited bounds.

### Step 3: pricing

Configure:

- ERC-8183 minimum and maximum job price.
- x402/B402 per-request price where supported.
- Payment token and atomic decimals.

The initial release takes no platform fee and never holds buyer funds.

### Step 4: authority

Display the derived policy before requesting a signature:

- Smart-wallet address.
- Session public address.
- Chain.
- Allowlisted contracts.
- Allowed selectors/action names.
- Per-token spend cap.
- Native-value cap.
- Expiry.
- Immediate revocation control.

Expiry choices:

- 1 hour.
- 24 hours, default.
- 7 days.

There is no unlimited option.

### Step 5: wallet approval

1. Authenticate through SIWE.
2. Create or select the user-controlled Altana smart wallet.
3. Show the exact proposed runtime-session public key, calls, spend limits, and expiry.
4. User approves the scoped grant through the spike-validated browser/Altana flow.
5. Send only the resulting bounded session through the reviewed one-time secret handoff into the Studio/AWS secret path.
6. Backend verifies the confirmed Keystore state and secret destination before deployment.

Identity ownership is a separate approval. BNBEra uses the pinned Studio/Altana custody-specific ERC-8004 registration flow so the resulting ERC-721 owner is the user's intended owner address. The runtime session receives only the narrowly required registration/update permission, if that permission is part of the reviewed flow. Generic runtime signing and post-registration transfer are not the default. Any fallback transfer must pause publication, account for the automatic clearing of `agentWallet`, and re-establish `agentWallet` before verification.

### Step 6: deployment

The user confirms deployment and receives a deployment ID immediately. The UI polls structured deployment state and never waits on a long Vercel request.

### Step 7: verification and publication

Publish only after:

- Runtime is ready.
- Authenticated public ingress and the selected runtime faces are healthy.
- ERC-8004 identity resolves.
- ERC-8004 owner equals the intended user-controlled owner and `agentWallet` is independently verified where required.
- Altana session is current and public.
- ERC-8183 negotiation passes.
- The advertised X402 endpoint passes when configured; paid mode also proves its gateway, authenticated AgentCore relay, B402 settlement, and expected payout recipient.
- Template-specific testnet canary succeeds.
- Initial Greenfield profile and evidence are sealed and read back.

## 6. Architecture

```text
Browser
  ├── SIWE and Altana grant ─────────────► BSC / Altana Keystore
  └── Creator requests
             ▼
Vercel Next.js + tRPC
  ├── PostgreSQL state
  └── authenticated deployment message
             ▼
AWS SQS
             ▼
AWS Step Functions
  ├── ephemeral worker: verify signed strategy + standards lock
  ├── pinned Agent Studio CLI: init/configure/doctor/deploy
  ├── delegated secret channel: bounded Altana session
  ├── AWS AgentCore: one TypeScript runtime / one signer
  ├── AWS ingress + Cognito + WAF
  ├── custody-specific ERC-8004 ownership/registration verification
  ├── ERC-8183 and x402/B402 verification
  ├── IPFS publication
  └── Greenfield publication
```

Studio owns the generated runtime and deployment workflow. BNBEra owns queueing, idempotency, signed strategy/configuration materialization, progress, policy review, reconciliation, verification, and listing. BNBEra does not recreate Studio's runtime topology.

## 7. Deployment lifecycle

```text
draft
  → awaiting_authority
  → authority_confirming
  → queued
  → validating
  → building
  → provisioning_secrets
  → deploying_runtime
  → configuring_ingress
  → health_checking
  → registering_identity
  → configuring_commerce
  → executing_canary
  → publishing_evidence
  → verifying
  → listed
```

Terminal/operational states:

- `failed`
- `paused`
- `revoked`
- `destroying`
- `destroyed`

Every transition records the deployment ID, attempt, timestamp, input and template digests, previous and next state, external resource references, transaction hash, sanitized error, and retryability.

Deployment state is not the marketplace listing state. Persist these independent axes for every created agent:

```text
origin_type         created
claim_status        unclaimed | claimed | stale
verification_status pending | verified | degraded | rejected
runtime_status      live | unavailable | paused
authority_status    none | active | expired | revoked
listing_status      draft | published | paused | suspended | delisted
```

`origin_type=created` never implies `claim_status=claimed`, `verification_status=verified`, or `listing_status=published`. A failed canary, unhealthy ingress, identity mismatch, ownership change, or expired authority changes only the relevant axes and eligibility rules.

## 8. AWS workflow

### Validation

- Confirm creator and ownership.
- Confirm one-active-agent quota.
- Revalidate template version and configuration.
- Verify Altana authority at a confirmed block.
- Reserve deterministic deployment identifiers.

### Materialization

- Fetch the signed template bundle.
- Verify its content hash and signature.
- Write validated configuration without source interpolation.
- Use the immutable lockfile.
- Run checks in an ephemeral CodeBuild environment.

### Secrets

- Use the phase-zero spike's selected Studio/Altana bridge to create the bounded session without exposing the user's administrative key to BNBEra.
- Store the serialized runtime session directly through Studio's delegated AWS secret channel/Secrets Manager.
- Store only its ARN/reference in deployment state.
- Attach an IAM role that can read only that agent's secret.

### Runtime

- Deploy one AgentCore runtime per active agent.
- Serve the selected A2A, MCP, and X402 faces from the same Studio runtime and seller core.
- Give the LLM read-only protocol tools; keep state-changing operations in fixed signing and execution entrypoints.
- Pin its template and configuration digests.
- Inject only the bounded Altana session through Studio's delegated secret channel.
- Disable every generic signing surface and prevent public requests from reaching arbitrary transaction methods.

### Ingress and public faces

- Configure AWS ingress/Cognito and WAF in front of AgentCore using the pinned Studio deployment path.
- Route through a deterministic agent hostname/path or a BNBEra relay that authenticates its AgentCore invocation.
- Apply per-agent and global rate limits, body limits, timeouts, and fixed egress where the B402 integration requires it.
- Expose a BNBEra reference-runtime readiness check that performs no signing or state change; do not present its path as a universal external-agent standard.
- Do not introduce a second Fargate agent/service runtime.

### B402 seller configuration

Paid X402 is a public Studio face backed by B402 settlement, not an alias for ERC-8183. Store a validated per-agent configuration mapped to the exact pinned Studio `[payments.b402_seller]` schema:

```text
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

Merchant credentials and relay secrets are secret references, never database values. Network, asset, decimals, facilitator host, payout recipient, amount, and retry policy are pinned independently of an incoming payment challenge. For Altana, verify and display that Studio pays the administrator address. The B402 test asset is not interchangeable with ERC-8183 testnet `U`; configure and account for the two rails separately.

On self-hosted AgentCore, the buyer-facing gateway authenticates its relay into AgentCore and uses the configured fixed-egress path to B402. A paid canary must observe the challenge, buyer payment, authenticated replay, B402 receipt/settlement, expected payout recipient, and delivered response. Because current Studio settles before work and provides no automatic refund if work later fails, the UI discloses that behavior and the runtime never automatically retries an unknown post-payment outcome.

## 9. Signing boundary

```text
Current protocol data
  → deterministic strategy
  → candidate action
  → simulation
  → template-policy validation
  → Altana-policy validation
  → fixed signing entrypoint
  → transaction
  → receipt and outcome verification
```

The LLM may explain results. It cannot:

- Choose an arbitrary contract.
- Construct arbitrary calldata.
- Sign.
- Change prices or limits.
- Widen session authority.
- Override stale-data or simulation failures.

One runtime does not collapse the logical boundaries: public request parsing, deterministic commerce checks, strategy decisions, simulation, policy validation, and signing remain separate modules with narrow typed interfaces.

## 10. Idempotency and recovery

- `creator.deploy` requires an idempotency key.
- Duplicate requests return the original deployment.
- Persist resource IDs and transaction hashes before polling.
- Check ERC-8004 registration before attempting a retry.
- Reconcile an existing AgentCore runtime instead of creating another.
- Resume Greenfield publishing from the last confirmed step.
- Never repeat an onchain transaction merely because a response timed out.

Failure behavior:

- Build failure creates no runtime.
- Ingress, endpoint, or selected-face verification failure leaves the runtime paused and unlisted and reconciles the existing Studio deployment.
- Paid-X402 gateway, relay-authentication, fixed-egress, settlement, or payout-recipient failure leaves that face unpublished and cannot fall back to ERC-8183 or free mode silently.
- A registered ERC-8004 identity is reused after recovery.
- Canary failure prevents listing.
- Greenfield seal delay produces `evidence_pending`, not a false success.
- A non-retryable failure exposes a safe user action rather than a raw stack trace.

## 11. Runtime controls

The “My Agents” dashboard provides:

- Runtime and endpoint status.
- Template/configuration version.
- Last current-data update.
- Latest decision and execution.
- ERC-8004 identity.
- ERC-8183 jobs and earnings.
- X402 requests, B402 settlement state, configured asset/network, and expected payout address.
- Altana call scope, spend cap, and expiry.
- Renew authority.
- Pause runtime.
- Revoke authority.
- Destroy hosted resources.
- Greenfield evidence.

Revocation or expiry automatically:

1. Removes the agent from eligible matchmaking.
2. Prevents new execution.
3. Marks the listing paused.
4. Preserves public historical evidence.

Destroying an agent requires authority revocation first, then removes the AgentCore deployment, BNBEra-managed ingress resources, and the runtime secret/session artifact. Historical database audit records and public evidence remain.

## 12. Quotas and abuse prevention

Initial limits:

- One active hosted agent per verified wallet.
- BSC testnet writes by default; any mainnet Creator path is disabled until separately approved after the main-track network gate and mainnet security gates.
- One rate-limited sponsorship of at most 0.005 tBNB.
- Mandatory bounded authority.
- Operator-configured global capacity.
- Deployment and request rate limits.
- Maximum task, payload, log, and evidence sizes.

Requests are queued when capacity is full. They are not reported as deployed.

## 13. UI identity

BNBEra uses purple for creation progress, primary buttons, selected templates, and owned-agent controls.

- Primary purple: `#7C3AED`
- Purple hover: `#6D28D9`
- Purple highlight: `#A78BFA`

BSC yellow `#F0B90B` identifies chain transactions and ERC identity. Greenfield green `#22C55E` identifies storage and verified evidence.

Every deployment stage uses a label and icon in addition to color.

## 14. APIs

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

All errors return a structured JSON envelope with code, safe message, request ID, retryability, and next action.

## 15. Tests

### Unit

- Every template field and boundary.
- Derived allowlist and spend caps.
- Lifecycle transitions.
- Idempotency and retry classification.
- Safe identifier generation.
- Secret redaction.

### Integration

- SIWE.
- Browser/passkey-controlled Altana grant, one-time bounded-session handoff, Studio/AWS injection, verification, expiry, renewal, and revocation.
- Template materialization.
- AgentCore deployment and reconciliation.
- Authenticated ingress and each selected single-runtime face.
- Custody-specific ERC-8004 registration, intended-owner verification, `agentWallet` verification, and transfer-fallback re-verification.
- ERC-8183 negotiation and job.
- Paid X402 gateway challenge, authenticated AgentCore relay, fixed-egress B402 verification/settlement, payout-recipient check, and response delivery.
- IPFS and Greenfield publication.

### Security

- Code and shell injection through every field.
- Arbitrary address and selector rejection.
- Spend-cap overflow.
- Execution after expiry or revocation.
- Unauthenticated or malformed ingress calls reaching signing code.
- B402 challenge tampering with network, asset, amount, facilitator host, or payout recipient.
- Replay or automatic retry after an unknown post-payment outcome.
- Attempts to invoke a generic signing or arbitrary transaction surface.
- Cross-agent secret access.
- Duplicate deployment requests.
- SSRF through endpoints and callbacks.
- Verification that no secret appears in PostgreSQL, logs, browser responses, build artifacts, or Greenfield.

### Browser end-to-end

1. Connect wallet.
2. Select a template.
3. Configure strategy and pricing.
4. Review the exact authority.
5. Approve it.
6. Start deployment.
7. Follow progress without terminal access.
8. Observe the canary transaction.
9. Open sealed Greenfield evidence.
10. Find the agent in the marketplace.
11. Hire it.
12. Complete one paid X402 request and inspect its B402 settlement and payout recipient.
13. Revoke it and confirm execution and matching stop.

## 16. Acceptance criteria

- A new user deploys and lists an agent without coding, GitHub, IDE, or AWS setup.
- The thin Creator starts only after the marketplace, category coverage, and activation/hire gates pass.
- The phase-zero browser-controlled Altana-to-Studio session bootstrap passes with the pinned versions before Creator implementation starts.
- The user retains Altana administrative control.
- The platform receives only a bounded session.
- The ERC-8004 identity is directly controlled by the intended user owner through the pinned custody-specific flow; transfer is a tested fallback only and `agentWallet` is re-established after any transfer.
- The agent is not listed before all verification gates pass.
- Origin, owner claim, verification, runtime, authority, and listing states remain independent.
- Every activated Creator strategy has a meaningful BSC testnet canary.
- Revocation blocks the next state-changing action.
- No arbitrary code or address reaches the runtime.
- No administrative signer leaves the user's wallet; bounded session material exists only in the approved transient handoff, Secrets Manager, and runtime memory and is never logged or stored in PostgreSQL.
- Paid X402 has a complete per-agent B402 configuration, authenticated gateway/relay, fixed egress, distinct settlement asset, verified Altana-admin payout, and one successful settlement canary.
- Deployment status remains accurate through retries and partial failures.
- The deployed Studio CLI/runtime, Agent SDK, Altana SDK, standards revisions, contract addresses, and ABI hashes match `config/standards.lock.json`.
- The main-track network gate is closed and recorded before release: explicit organizer acceptance may allow chain 97; otherwise Creator testnet agents do not satisfy the category gate by themselves and qualifying chain-56 supply is required.

## Changelog

- **1.2 — 2026-09-01:** Added the browser-controlled Altana-to-Studio integration spike, complete paid-X402/B402 deployment and settlement requirements, independent origin/claim/listing state, and reference-only readiness semantics.
- **1.1 — 2026-09-01:** Recast the deployer as a thin audited-strategy Creator MVP, adopted Studio v0.0.13's single-runtime topology, added authenticated ingress, independent marketplace state axes, custody-specific user-owned ERC-8004 registration, standards locking, and the release-blocking BSC network gate.
- **1.0 — 2026-09-01:** Initial approved fixed-template, platform-hosted no-code deployer plan.
