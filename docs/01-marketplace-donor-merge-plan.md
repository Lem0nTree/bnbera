# BNBEra Marketplace Donor Merge Plan

**Status:** Approved implementation plan
**Revision:** 1.2
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
| Chain | Treat chain 56 and chain 97 as distinct environments; never merge their identity, price, authority, or execution claims |
| Identity | Official ERC-8004 |
| Jobs and escrow | Official ERC-8183 |
| Per-call payments | X402 public face with pinned B402 settlement; configured independently from ERC-8183 |
| Agent authority | Altana scoped sessions |
| Evidence | IPFS deliverables plus canonical Greenfield evidence for BNBEra-published runs; Greenfield is not required for external discovery |
| Search | Structured hard filters, PostgreSQL full-text search, and pgvector over public agent metadata |
| Binance | Optional pinned, typed enrichment adapters only; protocol state, simulation, and receipts remain execution truth |
| Agent sourcing | 8004scan, direct ERC-8004 events, manual import, and BNBEra Creator |
| Runtime | One BNB Agent Studio TypeScript runtime per created agent on AWS AgentCore, behind authenticated ingress/WAF |
| Creator | Thin audited-strategy Studio MVP after the marketplace core passes; no general-purpose builder |
| Network | Release-blocking organizer clarification; created write demos default to BSC testnet, while main-track coverage falls back to verified BSC mainnet agents if testnet eligibility is not confirmed |
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
│   └── health-monitor/
├── packages/
│   ├── db/
│   ├── domain/
│   ├── marketplace/
│   ├── agent-ingestion/
│   ├── agent-commerce/
│   ├── agent-runtime/
│   ├── agent-templates/
│   ├── altana/
│   ├── greenfield/
│   ├── binance/
│   ├── data-sources/
│   └── ui/
├── infra/
│   ├── aws/
│   └── vercel/
├── config/
│   └── standards.lock.json
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
- Full ERC-8004 identity: namespace, chain ID, registry address, and agent ID.
- Origin: discovered, manually imported, or created.
- Independent owner-claim, verification, runtime, authority, and listing states.
- Agent Studio template and version only when Studio provenance is verified.
- Price or price range.
- Wallet provider and public authority summary; Altana wallet, call scope, spend cap, and expiry when applicable.
- Last verified execution.
- ERC-8183 outcome history.
- Evidence links and integrity state; a Greenfield link only when the object was sealed and read-back verified.

No unverified record receives a “verified,” “successful,” “trending,” or “high-performing” label.

### 5.1 Supply ingestion and independent state axes

Use four supply paths:

1. 8004scan candidate discovery.
2. Direct ERC-8004 registry events and reads.
3. Manual import by identity.
4. BNBEra Creator output.

8004scan accelerates discovery; direct chain reads are the identity authority. Normalize and deduplicate by the complete ERC-8004 key `(namespace, chainId, identityRegistry, agentId)`.

Do not overload one `status` field. Origin is immutable classification, while claim and listing state can change independently:

```text
origin_type         discovered | manual_import | created
claim_status        unclaimed | claimed | stale
verification_status pending | verified | degraded | rejected
runtime_status      live | unavailable | paused
authority_status    none | active | expired | revoked
listing_status      draft | published | paused | suspended | delisted
```

Discovery does not require owner participation. A current ERC-721 owner proves control through SIWE only to set `claim_status=claimed`, edit owner-controlled metadata, or receive an owner-verified label. An onchain ownership change makes the prior claim `stale`; it removes owner-management privileges and the owner-verified label but does not automatically reject an otherwise independently verified listing. Creation by BNBEra never implies verification automatically.

Resolve services from ERC-8004 metadata, an A2A Agent Card, MCP metadata, or a reviewed protocol adapter. Persist the advertised service kind, URL, protocol version, discovery source, and validation result. Do not require external agents to expose Studio-specific paths or a universal `/health` route.

Direct registry ingestion is reorg-aware. Store block number, block hash, transaction hash, log index, and `provisional | canonical | orphaned` confirmation state for each chain observation, plus a per-chain/registry cursor and last finalized block. The confirmation threshold is network configuration. A block-hash mismatch rewinds the cursor, marks orphaned observations, replays canonical events, re-reads current ERC-8004 owner/metadata/`agentWallet`, and marks any displaced owner claim `stale`.

For each of the four required categories, maintain a coverage gate for a live BSC identity, usable endpoint, normalized capability and schemas, pricing or activation, verified protocol support, comparable detail, and at least one end-to-end activation or hire path. Use external supply when it passes; deploy reference supply only for gaps.

This gate evaluates observable marketplace behavior. It does not require an external agent to use Studio, Altana, BNBEra's deterministic strategy engine, Greenfield, ERC-8183, or X402 unless that feature is advertised or required by the selected activation path.

## 6. Search and matchmaking

### 6.1 Pgvector boundary

Pgvector is retained for semantic discovery of public agent metadata only.

8004scan semantic search remains useful for candidate discovery, but its ranking is not reused as BNBEra marketplace truth. BNBEra embeds its own verified and enriched listing representation, then combines retrieval with authority, protocol, health, price, freshness, and execution constraints that are outside a generic registry search.

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

Pin one embedding model and dimension for the hackathon. Store the embedding provider, model, model version, dimension, source-text hash, classifier version, and agent-version ID. A future dimension change creates a versioned table/index migration rather than mixing dimensions. Refresh the vector when the published semantic profile changes, not whenever a live metric changes. If embedding generation fails, structured and full-text discovery continue to work.

Keep current health, price, balances, remaining spend, session expiry, and live financial values out of the embedding. They remain structured ranking and eligibility inputs.

### 6.2 Retrieval order

1. Apply hard eligibility filters.
2. Apply full-text and vector retrieval to eligible agents.
3. Calculate the deterministic score.
4. Return score components and exclusion reasons.

The capability component allocates 20 points to exact structured compatibility and 15 points to semantic similarity. A vector match cannot override a failed chain, protocol, required execution-authority, health, price, or freshness requirement.

Category prediction combines ERC-8004 metadata, OASF skills, A2A Agent Cards, MCP capability schemas, known protocol/actions, deterministic rules, and semantic evidence. Persist the predicted category, structured and semantic scores, confidence, evidence, method, classifier version, and review state. A generic description alone cannot promote an agent out of `uncategorized`.

## 7. Data model

Create clean Drizzle migrations for:

- Users and wallet addresses.
- ERC-8004 identities keyed by namespace, chain, registry, and agent ID.
- Agent discovery sources, normalized advertised services, reorg-aware chain observations, and finalized ingestion checkpoints.
- Templates and immutable template versions.
- Agent drafts.
- Altana authorities.
- Deployments and deployment events.
- Agents and immutable listing versions.
- Independent origin, owner-claim, verification, runtime, authority, and listing states.
- Listing embeddings and category predictions.
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
- Verify that unclaimed discovered agents can be listed without SIWE and that claiming requires the current ERC-721 owner.
- Verify source deduplication by namespace, chain, registry, and agent ID.
- Verify advertised service discovery without assuming `/apex`, `/a2a`, or `/health` paths.
- Verify provisional-to-canonical event handling, reorg rollback/replay, and stale-claim invalidation.
- Verify structured and semantic retrieval independently.
- Verify hard filters always run before vector ranking.
- Verify ERC-8004 identity, ERC-8183 hiring, x402/B402, Altana policy, and Greenfield evidence against the configured live integration networks; created autonomous-write canaries remain on testnet unless separately approved.
- Resolve the main-track network gate with organizers. If BSC testnet is not explicitly accepted, require chain-56 agents for main-track category coverage while retaining chain 97 for the created Altana demo.

## 10. Acceptance criteria

- The application builds from the clean BNBEra workspace.
- Donor code provenance is recorded.
- Neither donor frontend is present.
- No plaintext wallet key is stored or returned.
- Only official BNB identity and commerce standards are used.
- The exact deployed contract, ABI, SDK, Studio CLI/runtime, and specification revisions are pinned in `config/standards.lock.json`.
- All four categories appear with equal depth and pass the category coverage gate; BNBEra ownership is not required.
- Marketplace rankings are evidence-backed and explainable.
- Pgvector contains only public semantic metadata.
- Live financial data remains structured, timestamped, and block-referenced.
- Origin and claim state never imply verification, liveness, active authority, or publication.

## Changelog

- **1.2 — 2026-09-01:** Split immutable origin from owner-claim and listing state, made external service interfaces discoverable rather than path-assumed, separated external eligibility from BNBEra internals, and added ERC-8004 finality/reorg handling.
- **1.1 — 2026-09-01:** Added 8004scan and direct-event ingestion, independent provenance/verification/runtime/authority states, full ERC-8004 identifiers, model-aware embeddings and category predictions, the category supply gate, the main-track network gate, and the single-runtime Studio architecture.
- **1.0 — 2026-09-01:** Initial approved donor-merge plan; clarified pgvector scope and BNBEra visual identity.
