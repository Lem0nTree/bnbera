# BNBEra No-Code Agent Deployer Plan

**Status:** Approved implementation plan
**Revision:** 1.0
**Date:** 2026-09-01

This document defines the no-code creation, platform-hosted deployment, verification, publication, operation, revocation, and destruction of fixed-template BNB Agent Studio agents.

Related plans:

- [Marketplace donor merge](./01-marketplace-donor-merge-plan.md)
- [Greenfield data and evidence](./02-greenfield-data-and-evidence-plan.md)
- [Complete BNBEra implementation plan](./04-bnbera-master-implementation-plan.md)

Official references:

- [BNB Agent Studio launch](https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt)
- [Current Agent Studio quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
- [Agent Studio CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
- [Agent Studio security](https://docs.bnbchain.org/developer-kit/bnbchain-studio/security/)
- [Altana in Agent Studio](https://www.bnbchain.org/en/blog/altana-in-bnb-agent-studio-agents-with-limits-you-set)
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

The first release supports fixed templates only. Arbitrary generated code, packages, tools, contract addresses, calldata, and user uploads are excluded.

## 2. Hosting decision

- BNBEra hosts user-created agents in the platform AWS account.
- Private Layer A runs on AWS Bedrock AgentCore.
- The public keyless Layer B service runs on ECS Fargate behind shared HTTPS ingress.
- Vercel hosts the marketplace and creator dashboard.
- PostgreSQL stores lifecycle state, never session secrets.
- AWS Secrets Manager holds each scoped agent session.
- BSC testnet is the only user-created deployment target initially.

Do not use the limited 48-hour BNB managed trial as the marketplace's durable hosting layer. The platform uses its own AWS deployment so endpoint lifecycle and availability can be managed consistently.

## 3. Fixed templates

Every template version is prebuilt, reviewed, tested, content-addressed, and signed before users can select it.

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

1. Scaffold a clean seller project using the current BNB Agent Studio tooling.
2. Pin Node, pnpm, Bun, Studio CLI, Agent SDK, Altana SDK, viem, and protocol dependencies.
3. Implement the deterministic strategy and audited execution adapter.
4. Define a strict configuration JSON Schema.
5. Define the exact contract and function-selector allowlist.
6. Define supported assets and maximum configuration bounds.
7. Run lint, typecheck, unit tests, integration tests, `bag doctor`, package inspection, and a testnet canary.
8. Generate a manifest containing source commit, package lock hash, template hash, configuration schema hash, and expected runtime faces.
9. Sign and publish the immutable template bundle.
10. Activate it in `agent_templates` only after review.

User configuration is stored as validated JSON and environment configuration. It is never interpolated into TypeScript, shell commands, imports, filenames, package names, or infrastructure identifiers without strict normalization.

## 5. Creator experience

### Step 1: template

Show four equal category cards with:

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
3. Generate the runtime session inside the isolated AWS path.
4. Return only the session public address to the browser.
5. User approves the scoped grant.
6. Backend verifies the confirmed Keystore state before deployment.

### Step 6: deployment

The user confirms deployment and receives a deployment ID immediately. The UI polls structured deployment state and never waits on a long Vercel request.

### Step 7: verification and publication

Publish only after:

- Runtime is ready.
- Public HTTPS service is healthy.
- ERC-8004 identity resolves.
- Altana session is current and public.
- ERC-8183 negotiation passes.
- x402 endpoint passes when configured.
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
  ├── CodeBuild template materializer
  ├── Secrets Manager
  ├── AgentCore Layer A
  ├── ECS Fargate Layer B
  ├── ERC-8004 registration
  ├── ERC-8183 and x402 verification
  ├── IPFS publication
  └── Greenfield publication
```

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
  → deploying_service
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

- Generate session material in the isolated deployment process.
- Store it directly in a dedicated Secrets Manager secret.
- Store only its ARN/reference in deployment state.
- Attach an IAM role that can read only that agent's secret.

### Runtime

- Deploy one AgentCore runtime per active agent.
- Give it read-only protocol tools plus fixed signing entrypoints.
- Pin its template and configuration digests.
- Disable direct public access to signing material.

### Public service

- Deploy a keyless ERC-8183/A2A/MCP/x402 service to ECS Fargate.
- Route through shared HTTPS ingress using a deterministic agent hostname/path.
- Permit calls to Layer A only through authenticated internal networking.
- Expose a health endpoint that performs no signing.

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
- Public-service failure leaves the runtime paused and unlisted.
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
- x402 requests.
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

Destroying an agent requires authority revocation first, then removes AgentCore, Fargate resources, and the runtime secret. Historical database audit records and public evidence remain.

## 12. Quotas and abuse prevention

Initial limits:

- One active hosted agent per verified wallet.
- BSC testnet only.
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
- Altana grant, verification, expiry, renewal, and revocation.
- Template materialization.
- AgentCore deployment and reconciliation.
- Keyless-service health.
- ERC-8004 registration.
- ERC-8183 negotiation and job.
- x402/B402 request.
- IPFS and Greenfield publication.

### Security

- Code and shell injection through every field.
- Arbitrary address and selector rejection.
- Spend-cap overflow.
- Execution after expiry or revocation.
- Secret lookup from the keyless service.
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
12. Revoke it and confirm execution and matching stop.

## 16. Acceptance criteria

- A new user deploys and lists an agent without coding, GitHub, IDE, or AWS setup.
- The user retains Altana administrative control.
- The platform receives only a bounded session.
- The agent is not listed before all verification gates pass.
- Every listed template has a meaningful BSC testnet canary.
- Revocation blocks the next state-changing action.
- No arbitrary code or address reaches the runtime.
- No plaintext secret appears outside Secrets Manager/runtime memory.
- Deployment status remains accurate through retries and partial failures.

## Changelog

- **1.0 — 2026-09-01:** Initial approved fixed-template, platform-hosted no-code deployer plan.
