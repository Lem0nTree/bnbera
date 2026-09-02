# `@bnbera/greenfield`

Provider-neutral publication orchestration for BNBEra evidence.

The `EvidencePublisher` accepts injected IPFS and Greenfield adapters plus a
standards-locked `PublicationConfiguration`. Each configured provider has its
own idempotency key, state, locator, and verification result,
so one provider can fail without being silently mirrored to the other. A
Greenfield attempt remains unverified until the adapter confirms sealing and a
readback matches the canonical SHA-256, Keccak-256, and byte length.

The package contains deterministic fakes for unit tests only. No fake result is
reported as a live Greenfield or IPFS publication. Production adapters must be
added only after the SDK version, provider allowlist, bucket, wallet, and
credential references are pinned in `config/standards.lock.json`. Requests
cannot override providers, networks, buckets, or deterministic object names. A
persistent adapter must implement atomic create-or-get and a compare-and-set
lease before provider calls are enabled.
