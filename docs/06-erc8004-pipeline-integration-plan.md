# ERC-8004 Pipeline Integration and Verification Plan

Status: proposed implementation plan

Delivery scope: W1 A3 Identity Discovery + A4 Marketplace Search

Risk tier: R1 — stateful application

Feature gates: `ERC8004_INGESTION_ENABLED`, `ERC8004SCAN_DISCOVERY_ENABLED`, and `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED`, all disabled until their exit criteria pass

## 1. Decision

Use the architecture in `docs/04-bnbera-master-implementation-plan.md`. Integrate 8004scan as a read-only discovery and candidate-search accelerator, not as BNBEra's source of identity truth and not as a replacement for BNBEra retrieval.

The target is a hybrid pipeline:

1. 8004scan list and semantic-search endpoints find candidate identities.
2. Direct reads from the registry pinned in `config/standards.lock.json` verify the complete `(namespace, chainId, identityRegistry, agentId)` tuple, owner, `agentWallet`, and `agentURI` at an identified block.
3. BNBEra resolves and validates bounded public metadata and advertised services.
4. BNBEra categorizes the verified representation, builds a versioned semantic document, generates its own embedding, and stores it in pgvector.
5. Hard eligibility and structured filters run before full-text/vector ranking. Results retain score explanations and provenance.

An 8004scan-only design is rejected because its index is eventually consistent, its ranking cannot enforce BNBEra-specific eligibility or freshness constraints, and it cannot replace block-bound registry verification. A direct-chain-only design is also rejected as the normal discovery path because it gives up 8004scan's useful cross-chain indexing and semantic candidate discovery. Direct events remain the independent reconciliation and recovery path.

## 2. Source review and API compatibility warning

Authoritative references for implementation:

- ERC-8004 specification: <https://eips.ethereum.org/EIPS/eip-8004>
- 8004scan Builder Hub: <https://8004scan.io/developers>
- 8004scan OpenAPI document linked by the Builder Hub; vendor and snapshot the reviewed schema before implementing the transport
- Agent metadata parsing guidance: <https://best-practices.8004scan.io/docs/implementation/agent-metadata-parsing>
- Repository lock: `config/standards.lock.json`

The reviewed `jiayaoqijia/8004` plugin is useful background material but its bundled `8004scan` skill is not an implementation pin. At review time it described `https://www.8004scan.io/api/v1/public`, `/agents/search`, cursor pagination, and older rate limits. The current official Builder Hub instead documents `https://api.8004scan.io/api/v1`, `/agents/search/semantic`, offset pagination, and different limits. Tests must be generated from a reviewed, committed OpenAPI snapshot, not from the plugin examples or an invented response shape.

The plugin uses the environment name `EIGHTSCAN_API_KEY` and the `X-API-Key` header. The implementation may retain that server-only environment name if confirmed by the reviewed OpenAPI/authentication documentation. No key may enter browser bundles, source control, fixtures, snapshots, logs, raw-response evidence, or database rows. Any key pasted into chat is considered compromised and must be rotated before use.

## 3. Current implementation baseline

Already implemented:

- A transport-independent `EightHundredFourScanClient` and mapping boundary in `packages/agent-ingestion/src/adapters/8004scan.ts`.
- Full-tuple normalization, candidate idempotency, source provenance, service/capability normalization, direct registry reads, block-bound observations, finality checkpoints, reconciliation, and reorg handling in `packages/agent-ingestion`.
- PostgreSQL tables for identities, discovery sources, chain observations/checkpoints, services/probes, category predictions, and 1536-dimension listing embeddings in `packages/db`.
- Deterministic marketplace eligibility, filtering, ranking explanations, detail/comparison projections, API contracts, browser states, and explicit fixture labelling.

Still missing for a complete live pipeline:

- A production HTTP transport and mapper generated against the current 8004scan OpenAPI schema.
- A scheduled/page-resumable discovery job with rate-limit, retry, timeout, cache, and circuit-breaker policy.
- A metadata resolver covering allowed `https`, `ipfs`, and bounded `data:` forms with SSRF, redirect, MIME, byte, nesting, and timeout limits.
- The production category classifier, semantic-document builder, embedding provider adapter, pgvector repository/query, versioned re-index job, and measured relevance corpus.
- Application wiring from ingested records through classification/vectorization into the marketplace read model.
- Live read-only BSC evidence. Registry ABI hashes and deployed bytecode are not yet verified in the standards lock.

Blocked or deliberately disabled:

- BSC main-track network selection is unresolved.
- Identity and reputation registry ABI hashes/bytecode verification are pending.
- The ERC-8004 Validation Registry is disabled because no official BSC address is locked.
- Embedding provider/model/version/dimension has not been accepted and pinned. The existing database dimension is scaffolding, not provider approval.
- Creator, Altana activation, ERC-8183, x402/B402, payments, custody, signing, broadcasting, deployment, and all mainnet writes are outside this read-only pipeline gate.

## 4. Pipeline stages and contracts

### Stage A — discover

- Poll 8004scan with bounded pages and chain filters; persist only a source reference, response digest, observation time, and normalized public fields.
- Support anonymous contract tests. Use the rotated API key only in a server-side live-test profile.
- Treat 400 as a contract/configuration failure, 401/403 as secret configuration failure, 429 as backpressure using vendor reset headers, and 5xx/timeouts as retryable with capped exponential backoff and jitter.
- A provider outage degrades discovery without taking down existing marketplace reads.

### Stage B — normalize and deduplicate

- Parse the provider payload with strict schemas and preserve unknown vendor fields only in a bounded, redacted diagnostic digest.
- Construct the canonical identity from namespace, chain ID, configured registry address, and agent ID. Never key by token ID, owner, wallet, name, or endpoint alone.
- Replaying a page or candidate must be idempotent. 8004scan, registry-event, and manual sources converge on one identity while retaining separate provenance rows.
- Discovery must not publish a listing or assert verification, ownership, liveness, authority, or trust.

### Stage C — verify on chain

- Reject candidates outside configured networks/registries.
- Read owner, `agentWallet`, and `agentURI` from the pinned identity registry at an explicit block number/hash through two configured RPC providers for evidence runs.
- Keep ownership distinct from the verified `agentWallet`. An ownership transfer stales a claim and clears/revalidates wallet state according to ERC-8004.
- Store provisional observations until the configured confirmation threshold; on hash mismatch rewind, orphan displaced observations, replay, and reconcile current identity fields.

### Stage D — resolve metadata and services

- Fetch only public registration metadata. Apply an address allow/deny policy that rejects loopback, link-local, private, metadata-service, and post-redirect forbidden targets.
- Bound redirects, compressed and decoded bytes, JSON depth/keys, data-URI size, IPFS gateway attempts, and wall-clock time.
- Validate registration type and registrations, but tolerate documented legacy shapes with explicit warnings rather than silently rewriting them.
- Normalize each service independently. Probe only safe, non-mutating capability/readiness endpoints; a failed service does not fabricate an unhealthy result for an unprobed service.
- Store content hashes, parser version, warnings, timestamps, and provenance. Never persist fetched secrets or authorization headers.

### Stage E — categorize

- Build structured evidence from registration metadata, OASF skills/domains, A2A Agent Cards, MCP capabilities, and reviewed protocol adapters.
- Run deterministic rules first. Semantic classification may add evidence but cannot overcome missing structured support.
- Persist category, structured score, semantic score, confidence, evidence, method, classifier version, and review state.
- Low-confidence or description-only records remain `uncategorized`; the classifier must not force one of the four marketplace categories.

### Stage F — construct and vectorize

- Produce a canonical semantic document from verified name/description, category, capability manifest, protocols/actions, public schemas, public risk/authority summary, and verified evidence summary.
- Exclude prices, yields, balances, liquidity, health factors, live financial state, raw transactions, reviews, runtime logs, prompts, private configuration, sessions, user data, and unverified claims.
- Hash the canonical document. Skip generation when the hash and embedding version already exist.
- Store agent version, provider/model/model-version, dimension, source hash, semantic-document schema version, classifier version, and creation time.
- A model or dimension change creates a new versioned index migration and resumable backfill; it never mutates incompatible vectors in place.
- Embedding failure leaves deterministic filters and PostgreSQL full-text retrieval available.

### Stage G — retrieve and rank

- Apply hard eligibility first: chain, category, protocol, endpoint health, identity resolution, execution authority when requested, verified limits, price, freshness, compatibility, and publication/verification state.
- Retrieve structured/full-text candidates on every request. Add pgvector candidates only when the semantic gate and matching index version are healthy.
- Deduplicate by the complete identity tuple and compute the documented 100-point score. Within capability fit, structured compatibility contributes 20 and semantic similarity at most 15.
- Return stable reason and exclusion codes, provenance, source freshness, vector/model version, and degraded-mode warnings. Upstream 8004scan rank is never presented as BNBEra rank.

### Stage H — expose and observe

- Serve the existing marketplace API/read model; the browser never calls 8004scan with a credential.
- Record counts and latency per stage, page cursor/offset, retries, rate-limit remaining, last successful registry block, reconciliation lag, metadata rejection reasons, classifier confidence, embedding backlog/failures, index version, retrieval mode, and zero-result rate.
- Logs use request/source references and digests, not raw provider payloads or headers. Evidence identifies fixture, contract, read-only live, or blocked status explicitly.

## 5. Required tests and evidence

### Deterministic tests

- OpenAPI-derived response fixtures for list, detail, semantic search, pagination, empty results, malformed payload, renamed/missing fields, 400, 401, 403, 404, 429, 5xx, timeout, and abort.
- Full-tuple normalization, address casing, large agent IDs, duplicate pages, replay, conflicting provider identity, and source reconciliation.
- Registry event ordering, exact-block reads, owner/`agentWallet` separation, transfer, URI update, provisional promotion, provider disagreement, reorg rewind/replay, and restart from checkpoint.
- Metadata URI variants, content digests, malformed JSON, oversized/decompression-bomb payloads, redirect loops, private-network redirects, MIME mismatch, schema warnings, and partial service failures.
- Category gold set covering all four categories plus adversarial ambiguous and `uncategorized` cases; report precision/recall and version the corpus.
- Semantic-document snapshots proving prohibited fields and secrets are absent; hashing/idempotency, provider failure, dimension mismatch, retry, and backfill-resume tests.
- Retrieval gold set proving hard filters precede vectors, stable tie-breaking, deterministic fallback, score bounds/explanations, stale data, duplicate semantic candidates, and upstream outage behavior.

### Integration tests

- Disposable PostgreSQL with pgvector: empty migration, upgrade migration, write/read all provenance, vector insert/query, incompatible dimension failure, transaction rollback, and concurrent idempotent ingestion.
- Mock HTTP server driven by the pinned OpenAPI fixture set; no dependency on vendor availability in normal CI.
- Two deterministic RPC servers for finality/reorg/failover scenarios.
- Browser-to-API-to-database coverage for browse, category, search, detail, comparison, provenance, freshness, empty/degraded/error states, and semantic-on versus semantic-off results.

### Read-only live canary

Run only after the exposed key is rotated and the standards-lock read gate is satisfied:

1. Fetch the current OpenAPI document and verify its SHA-256 equals the reviewed snapshot.
2. Call `/agents`, `/agents/search/semantic`, `/agents/{chainId}/{tokenId}`, and `/chains` from a backend process with bounded limits.
3. Select a BSC candidate and independently verify registry bytecode, chain ID, identity tuple, owner, `agentWallet`, and `agentURI` at recorded blocks through two RPC providers.
4. Resolve and parse metadata under the production safety policy, classify it, generate a vector with the pinned provider, and retrieve it through BNBEra.
5. Verify the same identity and provenance in API and browser detail/comparison views.
6. Save sanitized commands, timestamps, response/schema digests, block numbers/hashes, test results, and screenshots under `docs/release-evidence/`. Do not save the API key, headers, raw sessions, or unredacted payloads.

The canary is read-only. It performs no wallet access, signing, transaction simulation presented as execution, broadcasting, registration, feedback, validation, payment, deployment, or mainnet write.

## 6. Delivery sequence and exit gates

1. **Contract pin:** review current OpenAPI, commit its sanitized snapshot/hash and generated schemas, lock base URL/auth/pagination semantics, and add drift detection.
2. **Discovery transport:** implement server-only HTTP client, mapper, backoff, rate-limit handling, cursor/offset checkpoint, contract tests, and disabled configuration.
3. **Chain authority:** complete bytecode/ABI verification, direct reads, two-provider evidence, finality/reorg tests, and reconciliation.
4. **Metadata and category:** implement bounded resolver, service discovery/probes, deterministic classifier, review state, and category corpus report.
5. **Semantic index:** accept and pin provider/model/version/dimension, implement canonical documents, pgvector repository/backfill, fallback, and relevance measurements.
6. **End-to-end verification:** run fixture CI, disposable database, API/browser path, and sanitized read-only canary; record release evidence.

The pipeline gate passes only when stages A–H are wired together; deterministic tests are green; database/API/browser evidence is recorded; degradation is truthful; the vendor contract and embedding configuration are pinned; and rollback is exercised. Until then, leave the three feature gates disabled and retain the current deterministic marketplace/fixture behavior.

## 7. Rollback and disable procedure

- Disable `ERC8004SCAN_DISCOVERY_ENABLED` to stop vendor calls while preserving direct/manual ingestion and existing indexed data.
- Disable `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` to stop embedding generation/vector queries and use deterministic full-text/filter ranking.
- Disable `ERC8004_INGESTION_ENABLED` to stop all new synchronization while preserving the last verified read model with an explicit stale/degraded banner.
- Cancel resumable workers at page/block/document checkpoints; do not delete provenance or chain observations.
- Roll back application code to the prior commit. Apply database rollback only through a reviewed forward-compatible migration; never drop the existing index or provenance tables as an operational shortcut.

## 8. Definition of done

- Current 8004scan contract is pinned and drift-tested; credentials are rotated, server-only, and referenced through secret management.
- 8004scan discovery and direct registry events converge idempotently on full ERC-8004 identities.
- Every verified field is tied to direct-chain provenance and block consistency.
- Metadata resolution and probes pass adversarial network/content tests.
- Categorization is versioned, evidence-backed, and permits `uncategorized`.
- BNBEra semantic documents and vectors are versioned, reproducible, and exclude prohibited data.
- Hard eligibility precedes hybrid retrieval, with deterministic fallback and explanations.
- Fixture, contract, database, read-only live API/RPC, and browser evidence are clearly separated and reproducible.
- No disabled integration, payment, custody, signing, mainnet write, or deployment capability is enabled by this work.
