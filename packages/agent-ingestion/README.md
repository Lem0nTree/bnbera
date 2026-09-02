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
- SIWE claim proofs bind the complete ERC-8004 identity to the server-issued
  domain, URI, resources, action, chain, time window, nonce, and verified
  signature digest. Claim/event writes use a versioned CAS mutation; explicit
  revocation requires an authenticated operator scope.
- `InMemoryIngestionRepository` is a deterministic contract fixture. The
  application persistence adapter should implement the same repository ports
  over the identity-scoped observation tables in `@bnbera/db`. The exported
  repository mappings round-trip observation `contentDigest`/`payloadDigest`
  and complete claim provenance without requiring Drizzle in this package.

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
