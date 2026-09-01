# Donor intake and provenance

Status: reviewed for A1 foundation work on 2026-09-01.

This record distinguishes source review from source reuse. The A1 foundation
branch contains BNBEra-owned interfaces and reimplementations; it does not copy
donor application code. Any later reuse must preserve this record, the
security exclusions below, and the project owner's authorization.

## Reuse basis and rights boundary

The project owner stated on 2026-09-01:

> I own both TwinMarket and AgentTrust and authorize BNBEra to copy all code
> needed; the repositories were provided license-free from a past ETHGlobal
> hackathon.

This is recorded as project-owner authorization for BNBEra. It is not an
assertion that either snapshot carries a standard SPDX license. Neither
checkout contained a top-level `LICENSE`, `LICENCE`, `NOTICE`, `COPYING`, or
`THIRD_PARTY` file at review time. AgentTrust's `package.json` advertises MIT,
but the absent license text means this document does not treat that field as a
complete license grant. A release owner should confirm attribution and notice
requirements before distributing any donor-derived files.

## Exact inputs

| Donor | Read-only snapshot | Commit | Upstream |
| --- | --- | --- | --- |
| TwinMarket | `C:\Users\CASTAN~1\AppData\Local\Temp\bnbera-donor-snapshots\twinmarket` | `032eba382bc26b8243d3ae80616a35535736220a` | https://github.com/kodylabs/twinmarket |
| AgentTrust | `C:\Users\CASTAN~1\AppData\Local\Temp\bnbera-donor-snapshots\agenttrust` | `ae91fbc2eea751dd433dfc4ed6e31eb17eafedc7` | https://github.com/ToXMon/agenttrust |

The snapshots were inspected read-only. Their commit metadata was retained in
the task handoff; the hashes below provide a stable audit anchor for the
relevant files examined during intake.

## Reviewed files and disposition

SHA-256 values are for the exact files in the snapshots above.

| Donor path and digest | Observation | BNBEra disposition |
| --- | --- | --- |
| TwinMarket `package.json` — `3715f828ca76c45098b41c67c2b210c684c9a50a8386bd8fbd0da0c97010beac` | Bun/Next application with sponsor integrations and dependency versions that are not BNBEra's pinned baseline. | Not copied. A0 owns the BNBEra dependency lock. |
| TwinMarket `src/lib/db/schema.ts` — `586491525670c6e6c115907ef9e9aa3770d9d0aa09b220354311e9e0f10ad580` | Includes user/session data, wallet fields, raw session token material, private-key fields, and simple agent state. | Reimplemented as BNBEra-owned `packages/db/src/schema.ts`; raw tokens/private keys are excluded, and the complete ERC-8004 identity tuple plus independent state axes are used. |
| TwinMarket `src/lib/auth/auth.ts` — `b2a7f23e8893fda6d796a82ecab6b20c83b2f9a572e68c3cab61eb94b8ab1908` | Concrete Better Auth/SIWE wiring with a different dependency/API baseline and raw session handling. | Reimplemented as the narrow `packages/auth/src/boundary.ts`; concrete adapter wiring remains an A0/A1 follow-up. |
| TwinMarket `src/lib/x402.ts` — `30a1440c795729c041984a3cc7de6add4b2e9a35f6b17065f2c8d829d37b39d8` | Circle Gateway/Arc testnet payment helper. | Not ported. BNBEra separates X402/B402 commerce from ERC-8183 and will validate the selected testnet adapter in the commerce workstream. |
| TwinMarket `src/trpc/routers/agents.ts` — `17562ae8abe9673222dc4d410a8dd26880acb4dca1396868781cd7b5b8633c1d` | AgentBook/ENS/World integration, generated wallet/private-key round trips, and mock statistics. | Not ported. Sponsor-specific identity, unrestricted key handling, and mock behavior are outside the approved architecture. |
| TwinMarket `drizzle/0003_daily_ultimo.sql` — `c45df313ac9d4ded302b5d4f4ee016f07421e36e3e5623da97f938ca6231cbd8` | Adds a `private_key` column to an agent table. | Explicitly rejected. BNBEra stores authority references and scoped execution metadata, never private key material in the application database. |
| TwinMarket `src/lib/mock-data.ts` — `3fe6a0dbcfc280bd87ac1f36413ee8d156f7a3c4a4880c03c196f87d328b3ed5` | Fake cards, ratings, revenue, and health-like marketplace values. | Not ported. Marketplace ranking must use verified/enriched evidence and explicit unknown/degraded states. |
| AgentTrust `package.json` — `9a278c2ca411479593f3a203005fe601c8084f3b9514c90986cd5b6e8a6ba9db` | Declares MIT in package metadata but has no accompanying license file; includes several sponsor-specific dependencies. | Metadata retained only for intake. No license conclusion beyond the owner authorization above; no dependency or sponsor integration copied. |
| AgentTrust `sdk/trust.ts` — `db46712c56d7413c523d4303df5fdaa731b98702f448f27d16979bb3f4867eec` | Trust lookup returns a fixed score/tier rather than evidence-backed evaluation. | Not ported. BNBEra's later ranking/evidence layer must expose component scores and exclusion reasons. |
| AgentTrust `sdk/erc8004.ts` — `a8d2d298a64e2d10a6608e1f78cc5c4f9091e6ba89056fecf4bd92fccf7ef8a2` | Hard-coded Base-mainnet registry/reputation addresses and a partial identity model. | Not ported. BNBEra reimplements the chain-agnostic complete identity key in `packages/domain/src/identity.ts` and persists NFT owner separately from `agentWallet`. |
| AgentTrust `sdk/verification.ts` — `896ec39e7f154d5e11a687eaead85d23d6fedc79ccb12349e3dee210c63bf80d` | 0G verification/storage path requiring a private key. | Not ported. Greenfield evidence is a separate sealed/readback-verified workstream. |
| AgentTrust `sdk/keeperhub.ts` — `de31733be1a39c2bf1f77311a1ad9aa6b7a8fc849a0e1170db13a3bfa9ee96c1` | API-key transport, an address header, universal `/health` assumptions, retries, and detailed logging. | Not ported. BNBEra models service-specific readiness, health evidence, and commerce execution explicitly; no universal endpoint or fail-open behavior. |
| AgentTrust `contracts/src/AgentRegistry.sol` — `c760b0143ec07a729af84319a61c47308c028e50354a91c9df8e266a95a7620a` | Custom registry contract. | Excluded. ERC-8004 is the identity source of truth. |
| AgentTrust `contracts/src/ServiceAgreement.sol` — `ec4313827df5384f95c52a3cc7c561d6c47cddfe61a2261feaf1d1a36378da0a` | Custom service-agreement/escrow contract. | Excluded. ERC-8183 is the commerce contract boundary and is not replaced by a donor contract. |
| AgentTrust `contracts/src/TrustNFT.sol` — `21aa898a0c03610a8a03660981bf96a163e5ab71d68ffd97025fec5f6552a610` | Custom trust NFT. | Excluded. ERC-8004 ownership and evidence-backed marketplace authority remain separate concerns. |
| AgentTrust `agents/requester-agent/types.ts` — `3d9b4cbf6632cd798766039433df35622c9955e2f7fbdaeb3a6bfa29142dcf90` | Requester shape includes `privateKey`, RPC, and sponsor-specific fields. | Not ported. BNBEra authority is represented through provider-scoped references and session limits. |

## Current branch mapping

The following BNBEra files are greenfield/reimplemented A1 outputs, not copied
donor source:

- `packages/domain/src/identity.ts` — canonical ERC-8004 identity tuple and
  owner/`agentWallet` distinction.
- `packages/domain/src/states.ts` and `packages/domain/src/constants.ts` —
  independent origin, claim, verification, runtime, authority, and listing
  axes.
- `packages/auth/src/boundary.ts` and `docs/auth-boundary.md` — narrow SIWE /
  Better Auth integration boundary with token-digest-only session storage.
- `packages/db/src/schema.ts` and `packages/db/migrations/` — BNBEra-owned
  schema, authority references, evidence, health, embeddings, and commerce
  job boundaries.

No donor file was copied into this A1 branch. If later work elects to reuse an
implementation rather than reimplement a concept, add a source-path to
destination-path mapping, the exact source commit/hash, modifications, and
release attribution before merging it.

## Open rights and review actions

1. A0/release ownership should confirm whether any donor-derived implementation
   is actually needed and, if so, add the appropriate attribution/notice before
   a distributable build.
2. Keep the two donor snapshots out of the BNBEra repository and build context
   unless a future workstream explicitly documents a permitted source mapping.
3. Re-review dependencies and security boundaries if an upstream donor commit
   is selected; the hashes in this document apply only to the snapshots listed
   above.
