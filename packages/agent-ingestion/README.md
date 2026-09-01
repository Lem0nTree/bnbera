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
  A block-hash mismatch rewinds to a provider-selected common ancestor,
  orphaning replaced observations and rereading affected identities.
- `InMemoryIngestionRepository` is a deterministic contract fixture. The
  application persistence adapter should implement the same repository ports
  over the identity-scoped observation tables in `@bnbera/db`.

## Adapter usage

`createEightHundredFourScanAdapter` requires an injected transport and mapper.
The default mapper accepts only a canonical mapped record; a production mapper
must be written against the current 8004scan API contract and must not copy raw
provider responses into public metadata. `ManualImportAdapter` applies the
same validation and never claims or verifies an identity as an import side
effect.

`RegistryChainReader` requires explicit `getBlockHash`, event retrieval,
current identity reads, and common-ancestor discovery. Missing block hashes or
an invalid ancestor fail closed with a structured ingestion error.

## Verification

Unit and contract tests cover replay idempotency, full-key deduplication,
credential rejection, dynamic service normalization, bounded probes, owner
claim verification, NFT-owner/`agentWallet` separation, stale and revoked
claims, finality promotion, checkpointing, reorg rewind, orphan exclusion,
and replacement-chain replay.
