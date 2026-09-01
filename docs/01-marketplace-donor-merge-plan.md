# BNBEra Marketplace Donor Merge Plan

**Status:** Approved implementation plan
**Revision:** 1.0
**Date:** 2026-09-01

This document defines how BNBEra will combine the useful parts of TwinMarket and AgentTrust into a BNB Chain agent marketplace. It is intentionally selective: incompatible sponsor integrations, unsafe key custody, incomplete contracts, mocks, and both donor frontends are excluded.

Related plans:

- [Greenfield data and evidence](./02-greenfield-data-and-evidence-plan.md)
- [No-code agent deployer](./03-no-code-agent-deployer-plan.md)
- [Complete BNBEra implementation plan](./04-bnbera-master-implementation-plan.md)

## 1. Locked decisions

| Area | Decision |
|---|---|
| Application base | TwinMarket's Next.js, tRPC, Drizzle, BetterAuth/SIWE, wagmi, and marketplace foundation |
| AgentTrust contribution | Capability manifests, requester/provider lifecycle, deterministic hashes, evidence verification, and audit vocabulary |
| Frontend | Complete BNBEra redesign; do not reuse either donor frontend |
| Chain | BSC testnet first |
| Identity | Official ERC-8004 |
| Jobs and escrow | Official ERC-8183 |
| Per-call payments | x402/B402 |
| Agent authority | Altana scoped sessions |
| Evidence | IPFS deliverables plus canonical Greenfield evidence |
| Search | Structured hard filters, PostgreSQL full-text search, and pgvector over public agent metadata |
| Runtime | AWS AgentCore plus a keyless public service |
| Custom contracts | None for identity, trust, or escrow |

## 2. Donor findings

### 2.1 TwinMarket

Useful foundation:

- Next.js 16, React 19, and TypeScript.
- tRPC 11 with React Query.
- Drizzle ORM and PostgreSQL.
- BetterAuth and SIWE schema patterns.
- wagmi, viem, and RainbowKit.
- Public marketplace, protected creator area, detail pages, and creation-wizard structure.
- x402-protected HTTP route pattern.

Required removals:

- World ID gate and Worldchain AgentBook.
- ENS Sepolia and NameStone.
- Circle Arc testnet gateway.
- World-specific ZK commitments.
- Open-ended digital-twin system prompts and private knowledge blocks.
- Mock agent records, metrics, reviews, revenue, and badges.
- Donor layout, styling, and visual identity.

Critical security replacement:

TwinMarket generates an agent wallet, returns its private key to the browser, accepts it in a later API call, persists it in PostgreSQL, and reconstructs a payment client from that database value. BNBEra must remove this complete flow. No browser response, request schema, database column, log, or public service may contain an unrestricted private key.

### 2.2 AgentTrust

Useful concepts:

- Machine-readable capability manifests.
- JSON input and output schemas.
- Requester/provider lifecycle terminology.
- Deterministic service and output hashes.
- Append-only interaction and audit events.
- Evidence retrieval and integrity verification patterns.
- End-to-end demo scenarios that can become test fixtures.

Required exclusions:

- `AgentRegistry`, `ServiceAgreement`, and `TrustNFT` contracts.
- Base-specific network assumptions.
- ENS/Basenames.
- AXL networking and Akash deployment.
- KeeperHub-specific execution.
- 0G Storage and 0G Compute.
- AgentTrust frontend.
- The mocked trust client that always reports a score of 50.
- Trust-gating or requester checks that fail open.
- Incomplete settlement and dispute behavior.

## 3. Target workspace

Use Node 22 and pnpm 10:

```text
bnbera/
├── apps/
│   ├── web/
│   ├── deployer/
│   ├── agent-service/
│   └── health-monitor/
├── packages/
│   ├── db/
│   ├── domain/
│   ├── marketplace/
│   ├── agent-commerce/
│   ├── agent-runtime/
│   ├── agent-templates/
│   ├── altana/
│   ├── greenfield/
│   ├── data-sources/
│   └── ui/
├── infra/
│   ├── aws/
│   └── vercel/
├── scripts/
└── docs/
```

The application workspace uses pnpm. Bun is present only in the controlled Agent Studio deployment image where current tooling requires it.

## 4. Selective merge procedure

### Stage A: provenance

1. Inventory both donor snapshots.
2. Record source paths, upstream URLs when known, import date, and content hashes.
3. Add `THIRD_PARTY_NOTICES.md` and a donor-provenance document.
4. Keep the donor directories unchanged.
5. Separate the initial TwinMarket import from subsequent BNBEra changes in Git history.

### Stage B: TwinMarket base

1. Move the application foundation into `apps/web`.
2. Standardize scripts and workspace dependencies on pnpm.
3. Preserve tRPC, Drizzle, BetterAuth/SIWE, React Query, wagmi, and viem integration patterns.
4. Replace the donor agent domain with BNBEra domain types.
5. Remove obsolete sponsor packages, routes, schema fields, components, configuration, and environment variables.
6. Delete the plaintext `privateKey` field and every dependent function.
7. Remove donor seed data rather than presenting it as real marketplace state.

### Stage C: AgentTrust concept port

1. Recreate capability manifests as versioned Zod and JSON Schemas.
2. Recreate service input/output hashes using canonical JSON.
3. Map requester/provider lifecycle events to ERC-8183 states.
4. Port audit vocabulary into an append-only `audit_events` table.
5. Convert demo flows into integration fixtures.
6. Replace 0G storage calls with the Greenfield evidence publisher.
7. Replace custom trust and escrow logic with verified ERC-8004 identity, ERC-8183 outcomes, Altana policy, endpoint health, and evidence freshness.

## 5. Marketplace behavior

Public routes:

- `/marketplace`
- `/marketplace/rebalancing`
- `/marketplace/grid-trading`
- `/marketplace/yield-optimisation`
- `/marketplace/health-factor`
- `/agents/[slug]`
- `/compare`
- `/create`
- `/dashboard/agents`
- `/jobs/[id]`
- `/evidence/[runId]`
- `/agent-advantage`

Every listing must expose observed facts:

- Live status and last health check.
- BSC chain and protocol.
- ERC-8004 identity.
- Agent Studio template and version.
- Price or price range.
- Altana wallet, call scope, spend cap, and expiry.
- Last verified execution.
- ERC-8183 outcome history.
- Greenfield evidence.

No unverified record receives a “verified,” “successful,” “trending,” or “high-performing” label.

## 6. Search and matchmaking

### 6.1 Pgvector boundary

Pgvector is retained for semantic discovery of public agent metadata only.

Vectorize:

- Agent name and verified description.
- Category and capability manifest.
- Supported protocols and actions.
- Input/output schema descriptions.
- Public risk and authority summary.
- Verified evidence summary.

Do not vectorize:

- Prices, APR/APY, balances, liquidity, health factors, or other live financial data.
- Private configuration, prompts, secrets, session data, or user identity.
- Raw transaction payloads or receipts.
- Unverified claims.

Store `vector(1536)`, embedding model, source-text hash, and agent-version ID. Refresh the vector when the published profile version changes, not whenever a live metric changes. If embedding generation fails, structured and full-text discovery continue to work.

### 6.2 Retrieval order

1. Apply hard eligibility filters.
2. Apply full-text and vector retrieval to eligible agents.
3. Calculate the deterministic score.
4. Return score components and exclusion reasons.

The capability component allocates 20 points to exact structured compatibility and 15 points to semantic similarity. A vector match cannot override a failed chain, protocol, authority, health, price, or freshness requirement.

## 7. Data model

Create clean Drizzle migrations for:

- Users and wallet addresses.
- Templates and immutable template versions.
- Agent drafts.
- Altana authorities.
- Deployments and deployment events.
- Agents and immutable listing versions.
- Listing embeddings.
- Health snapshots.
- ERC-8183 jobs.
- Agent runs.
- Evidence objects.
- Audit events.
- Match events and score explanations.

The database stores a Secrets Manager reference when required, never secret contents.

## 8. UI identity

BNBEra uses purple as its primary product identity:

- Primary purple: `#7C3AED`
- Purple hover: `#6D28D9`
- Purple highlight: `#A78BFA`
- Background: `#0B0714`
- Surface: `#151020`
- Elevated surface: `#1D1630`
- Primary text: `#F8F7FC`
- Muted text: `#A8A1B5`
- Border: `#302742`

Integration accents:

- BSC yellow `#F0B90B` for chain badges, transactions, gas, ERC identity, and explorer links.
- Greenfield green `#22C55E` for sealed evidence, storage provenance, integrity, and Greenfield links.

Purple remains the main call-to-action color. Color is always accompanied by an icon or text label.

## 9. Verification

Before accepting the merge:

- Search the schema, routes, logs, and bundles for private-key fields.
- Confirm obsolete World, ENS, Arc, Base, Akash, AXL, and 0G runtime dependencies are absent.
- Confirm no donor mock is shown as live data.
- Verify SIWE authentication and ownership checks.
- Verify structured and semantic retrieval independently.
- Verify hard filters always run before vector ranking.
- Verify ERC-8004 identity, ERC-8183 hiring, x402/B402, Altana policy, and Greenfield evidence using live testnet integrations.

## 10. Acceptance criteria

- The application builds from the clean BNBEra workspace.
- Donor code provenance is recorded.
- Neither donor frontend is present.
- No plaintext wallet key is stored or returned.
- Only official BNB identity and commerce standards are used.
- All four categories appear with equal depth.
- Marketplace rankings are evidence-backed and explainable.
- Pgvector contains only public semantic metadata.
- Live financial data remains structured, timestamped, and block-referenced.

## Changelog

- **1.0 — 2026-09-01:** Initial approved donor-merge plan; clarified pgvector scope and BNBEra visual identity.
