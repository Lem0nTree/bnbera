# `@bnbera/evidence`

This package defines BNBEra's public evidence boundary. It validates versioned
agent profiles, capabilities, authority summaries, run bundles, deliverables,
benchmark comparisons, and submission indexes before any bytes are published.

`digestArtifact` produces deterministic UTF-8 JSON bytes, a SHA-256 digest, and
an EVM Keccak-256 digest. `deterministicObjectName` creates an immutable,
versioned object path. Public evidence is allowlisted by the versioned Zod
schemas and recursively rejects secret-bearing field names.

The package does not contain storage credentials or provider SDKs. It is safe to
use in API validation and local tests; provider publication is implemented by
`@bnbera/greenfield` adapters.
