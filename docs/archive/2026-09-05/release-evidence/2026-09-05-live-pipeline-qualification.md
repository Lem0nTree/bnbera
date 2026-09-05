# Live pipeline qualification — 2026-09-05

This record belongs to the `codex/live-pipeline-qualification` checkout and is
not a release sign-off. It separates the live provider canary from the
disposable PostgreSQL fixture test and keeps unresolved BSC finality fail
closed.

## Checkout and gate

- Checkout: `/home/ubuntu/bnbera-live-qualification`
- Branch: `codex/live-pipeline-qualification`
- Base: `7720c92c194d4da2f7be2b31e659822862d0133b`
- Vertical: Marketplace Data + Web / QA
- Risk tier: R1 stateful application; provider configuration is release-gated
- Feature gates: `ERC8004_INGESTION_ENABLED` and
  `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` remain explicit runtime gates and
  default false. The lock records `semanticEmbedding.releaseEnabled: false`.

## Bounded live embedding canary

The configured sibling environment was read only for the named provider
reference; the API key was never printed, persisted, or included in this
record. One request was sent to the configured OpenRouter embeddings endpoint
with the configured model and one short public test input. The response was
sanitized to the following fields:

```json
{
  "ok": true,
  "responseModel": "text-embedding-3-small",
  "items": 1,
  "vectorLength": 1536,
  "finite": true,
  "usage": { "prompt_tokens": 12, "total_tokens": 12 }
}
```

Configuration and checked-in contracts agree:

| Field | Observed/configured value |
| --- | --- |
| provider | `openrouter` |
| model | `openai/text-embedding-3-small` |
| configured model version label | `openrouter-openai-text-embedding-3-small-v1` |
| response model alias | `text-embedding-3-small` |
| configured and migration dimension | `1536` |
| semantic document schema | `bnbera-agent-semantic-v1` |

Disposition: **pass, live-read-only canary only**. The semantic embedding pin
was added to `config/standards.lock.json` with `releaseEnabled: false`. The
configured model-version label is reproducible configuration evidence; it is
not a claim of an independently verified upstream model release identifier.

## Composition and backfill qualification

`Erc8004MarketplaceCompositionRunner` now performs semantic indexing only after
the publication service returns a real immutable published version ID and the
versioned category sink succeeds. Withheld versions and versions without a
persisted category are never sent to the provider. The PostgreSQL backfill
source now selects only `verified`, `live`, `published` agents whose
`current_version_id` is the selected immutable version.

Focused deterministic evidence:

```text
vitest composition.test.ts embedding-backfill.test.ts   PASS (10 tests)
vitest hybrid.test.ts                                    PASS (4 tests)
agent-ingestion TypeScript check                         PASS
marketplace-ingestion script TypeScript check            PASS
git diff --check                                         PASS (expected before commit)
```

`tests/integration/erc8004-live-pipeline-postgres.test.ts` is a disposable,
fixture-labelled end-to-end test. When an explicitly supplied development
`DATABASE_URL` is available, it migrates the schema, runs discovery candidate →
registry/metadata enrichment → category → deterministic 1536-vector
embedding → immutable version/publication, and reads through
`IngestionMarketplaceSource` plus `MarketplaceReadService`/pgvector hybrid
retrieval. It deletes all generated rows in `finally`. This checkout did not
have `DATABASE_URL`, so the integration test was **skipped by configuration**;
no PostgreSQL pass is claimed here. The deterministic provider in that test is
fixture evidence, not live-provider evidence.

## Finality and unresolved locks

Finality remains **blocked / fail-closed**. `config/standards.lock.json` has no
authoritative `confirmationThreshold` or finality policy under either BSC
network. `packages/agent-ingestion/src/registry-sync-config.ts` therefore
retains `REGISTRY_FINALITY_UNRESOLVED`, and the marketplace ingestion script
continues to mark exact-block registry reads `provisional`. Existing supply
evidence also records historical `missing trie node` failures. No threshold was
invented and no on-chain write was attempted.

## Rollback and limitations

Disable `ERC8004_INGESTION_ENABLED` or
`MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED` to stop the optional pipeline and
retain deterministic reads. Revert this scoped change through coordinator
review if needed. This evidence does not claim production deployment, live
registry finality, live service health, retained database writes, paid action,
or semantic release enablement.
