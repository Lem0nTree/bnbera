# ERC-8004 registry ABI snapshots

These ABI snapshots preserve the official ABI entries from the official
[erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts)
repository at commit
[b9e466c250744a7e06b13dff9d3c2844ed64f825](https://github.com/erc-8004/erc-8004-contracts/tree/b9e466c250744a7e06b13dff9d3c2844ed64f825).

The recorded digest is SHA-256 of the canonical JSON serialization
(`JSON.stringify(JSON.parse(bytes))`), so line-ending/formatting changes cannot
silently alter the ABI identity.

| Artifact | Upstream path | Upstream blob | Upstream raw SHA-256 | Canonical JSON SHA-256 |
| --- | --- | --- | --- | --- |
| Identity Registry | `abis/IdentityRegistry.json` | `ea5ccdf359405a24b9540bb67e22f3583fe67267` | `cdb8e30f41a56ed53421126dab87551ff2a178b8463646f69f75bc5dc9620564` | `6d5974b564d266507a53f65951adcd0ab288904d5a716a354ea237176ece8f83` |
| Reputation Registry | `abis/ReputationRegistry.json` | `c7d8affbc3628fcf09d4e2dbf3e05812ab3e81e0` | `867b7975a5f2f9fee38c4a148a84471b141f4de91409ccc0c6bebe3df4f04001` | `867b7975a5f2f9fee38c4a148a84471b141f4de91409ccc0c6bebe3df4f04001` |

The ABI files are inputs to read-only exact-block verification. They do not
authorize transactions or expose signing methods. The implementation source
and deployment metadata used for the bytecode review are also pinned in
`config/standards.lock.json` and the sanitized release evidence.
