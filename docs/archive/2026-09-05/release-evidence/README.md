# BNBEra release-evidence index — 2026-09-04

Status: Core Marketplace evidence is locally reproducible but this checkout is
not a release sign-off. Optional ERC-8004 ingestion, 8004scan discovery,
semantic retrieval, commerce, Creator/Altana, Greenfield, and mainnet-write
claims remain independently gated.

## Capture and validation

- Checkout: `/home/ubuntu/bnbera-w0-w1`.
- Branch: `codex/erc8004-pipeline`.
- Capture head before coordinator integration: `adfe8e1c52ca714cf6ba7f0171a90083b0f217aa`.
- The working tree was already dirty; no commit, reset, branch switch,
  deployment, signing, wallet use, or external write was performed for this
  index.
- Validation command: `pnpm evidence:release-check`.
- Last validation result at index capture: `valid: true`, four JSON files and
  24 PNG files checked. The command reads only checked-in evidence, the
  standards lock, and checked-in ERC-8004 ABI JSON; it does not load `.env` or
  resolve any secret reference.

## Claim map

| Evidence | Level and result | What it supports | What it does not support |
| --- | --- | --- | --- |
| `task10-browser-verification-2026-09-04.json` plus the 24 `task10-*.png` files | Local rendered fixture/API contract; partial Core Marketplace evidence | Browse, four category routes, search/filter, detail, compare, responsive states, explicit unavailable/error behavior, and zero browser console/page errors for the recorded local run | Live discovery, chain identity, endpoint health, execution, payment, custody, deployment, Greenfield, or production availability |
| `ingestion-postgres-smoke-2026-09-04.md` | Local PostgreSQL/pgvector stateful smoke; R1 | Migration replay, transaction rollback, restart persistence, source/service/capability/observation idempotency, and expected-versus-actual counts for synthetic rows | A live ERC-8004 registry, live service health, production migration, or published evidence |
| `8004scan-contract-review.json` | Contract-only; not a live canary | Reviewed API base/path, pagination, schema version, and sanitized OpenAPI digests | Authenticated discovery, provider uptime, registry verification, or BNBEra ranking |
| `erc8004-registry-verification.json` | Read-only chain observation | Two-provider BSC chain 56/97 bytecode/linkage, ABI selector/topic, and public identity reads at recorded blocks | Any write, ownership claim, liveness, authority, commerce, Creator, or main-track network decision |
| `erc8004-e2e.json` | Mixed contract, deterministic, and read-only checks; `pipelineComplete: false` | Explicit pass/blocked/skipped outcomes for the attempted harness; failures remain visible and database rows are not claimed when the rollback check is blocked | A complete pipeline, live marketplace API, browser preview, service health, semantic release gate, or enabled production integration |

The `erc8004-e2e.json` harness may exercise gate-enabled code in a bounded
developer run when configuration is supplied. That exercise is not release
enablement. Its current artifact records the missing preview configuration and
blocked or skipped checks explicitly; the unresolved standards-lock entries
continue to fail closed.

## Truthfulness and sanitization rules

- Fixture records and screenshots carry an explicit non-live label. The
  `liveModeProbe` records a fail-closed `503` when live mode lacks its required
  database configuration.
- Read-only chain evidence records observed chain IDs, block numbers/hashes,
  provider comparison, public contract addresses, and bytecode/ABI digests.
  It contains no signing material or credential-bearing URL.
- The 8004scan artifact records only an authentication method/reference and
  digests; no API key, raw response, or request header is stored.
- The PostgreSQL smoke records expected/actual counts and sanitized outcome
  codes only. Its synthetic registry and healthy probe are fixtures, not live
  network claims.
- `pass` means only that the named check passed at its stated evidence level.
  A blocked or skipped check is not promoted to a pass by this index.
- The validator rejects malformed JSON/PNG, credential-shaped strings,
  credential-bearing URLs, missing lock-aligned registry/hash observations,
  non-chronological E2E timestamps, fixture references to missing screenshots,
  and inconsistent blocked/skipped evidence levels.

## Gate disposition and rollback

Keep `ERC8004_INGESTION_ENABLED`, `ERC8004SCAN_DISCOVERY_ENABLED`, and
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` disabled for release until their
contract, registry, provider, database, API, browser, and degradation exit
criteria pass. Keep Activation + Commerce, Creator + Altana, Evidence
Publication, and mainnet writes disabled until their own evidence gates pass.

If a source or optional integration misbehaves, disable its feature flag and
retain the last deterministic marketplace read model. Do not delete provenance
or observations, retry an unknown payment, or relabel a local fixture as live.
The validator is read-only; removing its invocation does not alter runtime
behavior. Revert only the validator/index/test changes through the coordinator
review process, preserving the shared dirty tree.

## Reproduction sources

The release artifacts are produced or checked by:

- `scripts/erc8004-e2e.ts` — bounded read-only ERC-8004 pipeline harness.
- `scripts/verify-erc8004-registries.ts` — standards-lock/ABI/bytecode read
  verifier.
- `scripts/ingestion-postgres-smoke.ts` — synthetic PostgreSQL rollback and
  idempotency smoke.
- `scripts/validate-release-evidence.ts` — offline release-evidence validator.
- `packages/evidence/src/release-evidence.ts` and
  `packages/evidence/test/release-evidence.test.ts` — reusable checks and
  tamper-boundary coverage.

No artifact in this directory is evidence of Altana browser/passkey
acceptance, Agent Studio handoff, ERC-8183 settlement, X402/B402 payment,
Greenfield seal/readback, or production deployment. Those claims remain
blocked until the exact independent gate evidence is available.
