# `@bnbera/agent-ingestion`

This package is the identity-scoped supply boundary for BNBEra. It accepts
candidate records from 8004scan, direct ERC-8004 registry observations, and
manual imports, then normalizes them around the complete identity key:

```text
namespace + chainId + identityRegistry + agentId
```

The package deliberately does not assume an 8004scan URL, registry address,
event ABI, A2A route, MCP route, `/health`, `/a2a`, or `/apex` path. Provider
and chain transports are injected through typed ports. The configured registry,
ABI, confirmation threshold, and provider credentials belong in the reviewed
standards lock and secret manager, not in this package.

## Boundaries

- 8004scan is candidate discovery. Direct chain reads and finalized registry
  observations are the identity authority.
- Discovery is allowed while an identity is unclaimed. SIWE proof is required
  only for the current ERC-721 owner to claim owner control.
- The ERC-721 owner and `agentWallet` are separate fields. Claiming never
  rewrites `agentWallet`.
- A canonical owner transfer changes an active claim to `stale`; it does not
  automatically reject an independently verified service or delist it.
- Claim revocation is represented in the append-only claim event log as a
  `revoked` event while the shared claim axis uses the approved `stale` state.
- Advertised services are normalized from explicit metadata/card/adapter input.
  Probes call the exact advertised URL and persist bounded, non-secret
  telemetry; they do not invent a universal readiness endpoint.
- Registry observations are provisional until the configured finality depth.
  A trusted block-hash mismatch rewinds only the unfinalized scan cursor to a
  provider-selected common ancestor, orphaning replaced observations and
  rereading affected identities at an explicit ancestor block tag. A reorg
  below finalized history fails closed for manual review.
- Registry sync is one atomic unit of work: event ingestion, trusted-hash
  validation, finality promotion, identity/claim transitions, and checkpoint
  persistence commit together or roll back together. Checkpoint updates use a
  cursor/hash CAS, predecessor continuity, and an immutable confirmation
  threshold per indexer configuration version.
- Direct identity reads carry an explicit `finalized` or `provisional`
  consistency marker plus the exact observed block hash. Owner, `agentWallet`,
  URI, and content-digest fields retain their own observed-block provenance;
  claim CAS mutations must still reference the exact canonical read that was
  applied.
- SIWE claim proofs bind the complete ERC-8004 identity to the server-issued
  domain, URI, resources, action, chain, time window, nonce, and verified
  signature digest. Claim/event writes use a versioned CAS mutation; explicit
  revocation requires an authenticated operator scope.
- `InMemoryIngestionRepository` is a deterministic contract fixture. The
  exported `PostgresIngestionRepository` implements the same ports over the
  identity-scoped observation tables in `@bnbera/db`, including transaction
  boundaries and claim/checkpoint compare-and-set behavior. Construct it with
  a `DATABASE_URL`, use `withTransaction` around ingestion/reconciliation or
  claim mutations, and close it during worker shutdown. The exported
  repository mappings round-trip observation `contentDigest`/`payloadDigest`,
  lossless identity field/read provenance, and complete claim provenance
  without requiring Drizzle in this package.

## Adapter usage

`createEightHundredFourScanAdapter` requires an injected transport and mapper.
The default mapper accepts only a canonical mapped record; a production mapper
must be written against the current 8004scan API contract and must not copy raw
provider responses into public metadata. `ManualImportAdapter` applies the
same validation and never claims or verifies an identity as an import side
effect.

`RegistryChainReader` requires explicit `getTrustedBlockHash`, event retrieval,
current identity reads, and common-ancestor discovery. Finality promotion
requires a `finalizedBlockTag`; reorg identity rereads receive an ancestor
tag. Missing block hashes, head-state returned for an ancestor tag, or an
invalid ancestor fail closed with a structured ingestion error.

## Verification

Unit and contract tests cover replay idempotency, full-key deduplication,
credential rejection, dynamic service normalization, bounded probes, owner
claim verification, NFT-owner/`agentWallet` separation, stale and revoked
claims, finality promotion, checkpointing, reorg rewind, orphan exclusion,
and replacement-chain replay.

## Resumable 8004scan discovery job

`Erc8004ScanJob` is the bounded server-side page runner for the reviewed
8004scan list endpoint. It requires both `ERC8004_INGESTION_ENABLED` and
`ERC8004SCAN_DISCOVERY_ENABLED`; when either flag is absent or false it returns
an explicit disabled result without reading the provider or database.

Each stable query scope stores its offset/cursor, query digest, page size,
progress counters, and completion state in `scan_discovery_checkpoints`.
Candidates and their checkpoint commit in one repository transaction, so a
failed page is replay-safe. PostgreSQL takes a transaction-scoped advisory
lock per scope (`InMemoryIngestionRepository` has an equivalent test guard),
and a compare-and-set checkpoint rejects bypassed or overlapping writers.

Use `pnpm ops:erc8004scan` for the server-only CLI. It reads `EIGHTSCAN_API_KEY`
through `EightHundredFourScanHttpClient.fromEnvironment`, emits sanitized
metrics only, and never runs registry verification or marketplace publication.
Disable `ERC8004SCAN_DISCOVERY_ENABLED` to stop provider calls while retaining
the last checkpoint and normalized records; disable
`ERC8004_INGESTION_ENABLED` to stop all new synchronization.

## Deterministic category and semantic backfill

`classifyAgent` and `DeterministicCategoryClassifier` combine verified public
metadata, OASF skills/domains, A2A Agent Cards, MCP capability descriptors,
protocols, and actions. The ruleset is versioned as
`deterministic-rules-v3`, records bounded evidence and a digest, and leaves
description-only or ambiguous records as `uncategorized`. `PgCategoryPredictionSink`
persists append-only predictions idempotently and only refreshes the current
agent-version projection. The classifier-version idempotency key leaves
historical `deterministic-rules-v1`/`v2` rows intact when v3 predictions are added;
v3 additionally records reviewed secondary category matches without changing the
primary category field.

`EmbeddingBackfillJob` reads verified agent versions in stable UUID order,
builds the allow-listed `bnbera-agent-semantic-v1` document, calls the injected
provider, writes pgvector provenance, and advances a compare-and-set cursor
only after the vector write succeeds. Run limits, retries, cancellation,
configuration/model/dimension checks, and an advisory scope lock make restarts
bounded and replay-safe. `PgEmbeddingBackfillRepository` exposes the reviewed
checkpoint DDL as `embeddingBackfillCheckpointTableSql`; apply it through a
database migration before enabling the worker.

Both embedding gates (`ERC8004_INGESTION_ENABLED` and
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED`) are false by default. Keep semantic
retrieval disabled until the provider/model/version/dimension is accepted in
the standards lock and the pgvector migration and live read-only evidence are
available. Disable `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` to fall back to
structured/full-text retrieval without deleting vectors or checkpoints.

The current lock records a verified live read-only canary, but keeps
`semanticEmbedding.releaseEnabled` false. The scheduled marketplace wrappers
therefore inherit the explicit semantic flags from the runtime environment;
they do not overwrite them. A development-only canary requires both
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED=true` and
`MARKETPLACE_SEMANTIC_CANARY_ENABLED=true`. Preview/production rejects that
configuration until the lock is updated with separately reviewed release
evidence. A canary never changes the lock or claims release readiness.

Existing current marketplace versions can be reclassified with the bounded,
idempotent v3 command. It is disabled unless explicitly enabled and only
records public evidence from the persisted registration, capability, and
validated service-card observations:

```bash
ERC8004_INGESTION_ENABLED=true ERC8004_CATEGORY_BACKFILL_ENABLED=true \
  ERC8004_CATEGORY_BACKFILL_MAX_CANDIDATES=20 \
  pnpm ops:erc8004-category-backfill
```

Use `ERC8004_CATEGORY_BACKFILL_AFTER_VERSION` with the returned cursor to
continue a later bounded batch. Replaying a batch is safe: v3 predictions
are keyed by the evidence digest, older classifier rows remain append-only,
and evidence-backed secondary categories remain in the prediction evidence.
