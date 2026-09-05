# 8004scan live discovery runner handoff

Date: 2026-09-05
Vertical: Marketplace Data + Web
Delivery wave: W1 discovery/search/detail
Branch: `codex/live-discovery-runner`
Base SHA: `7720c92c194d4da2f7be2b31e659822862d0133b`
Head SHA: reported by the coordinator with the final commit handoff (`git rev-parse HEAD`)

## Documentation and contract gate

Before editing, this checkout read the required instructions and contracts in full:

- `AGENTS.md`
- `docs/04-bnbera-master-implementation-plan.md`
- `docs/05-subagent-delivery-plan.md`
- `config/standards.lock.json`
- `docs/01-marketplace-donor-merge-plan.md`
- `docs/06-erc8004-pipeline-integration-plan.md`
- `docs/07-mvp-live-marketplace-task-plan.md`
- `docs/adr/0003-wave1-legacy-migration-repair.md` (accepted)
- `docs/adr/0001-altana-studio-custody-bootstrap.md` (reviewed for relevant gates)
- `docs/release-evidence/2026-09-05-mvp-t2-handoff.md`
- `docs/release-evidence/2026-09-05-mvp-t5-handoff.md`
- `docs/release-evidence/2026-09-05-mvp-supply-qualification.md`
- `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`
- Shared contracts read: `packages/domain/src/{identity,states,services,canonical,events}.ts`; `packages/agent-ingestion/src/{types,normalize,metadata,pipeline,probe,ingestion,composition,scan-job,registry-sync-config,registry-sync-job}.ts`; `packages/marketplace/src/{source,types,eligibility,read-model,publication}.ts`; `packages/db/src/{schema,client}.ts`; `packages/config/src/runtime.ts`; and the checked-in 8004scan OpenAPI contract review.

Applicable gate/risk: read-only W1 discovery remains behind the existing vendor discovery gate; evidence is R1 deterministic unit/contract coverage. Publication, health, capability, identity, semantic-retrieval, embeddings, and finality gates are unchanged.

Unresolved locks remain fail-closed: candidate registry/finality thresholds, rotated 8004scan credential, chain 56/97 confirmation, embeddings, ERC-8183/B402, Greenfield, and Altana/Studio integrity. No standards, address, ABI, provider, or capability was guessed.

## Delivered

- Added a route-scoped 8004scan HTTP circuit so a failing `/agents` route does not prevent reviewed fallback routes from being tried.
- Added authenticated `/agents/latest` pagination using the current root `{items,total,limit,offset}` response shape, with bounded query parameters and the existing mapper.
- Added bounded fallback from primary `/agents` on retryable timeout, unavailable, rate-limit, or open-circuit errors; non-retryable validation/authentication failures still fail closed.
- Added four-category semantic candidate collection (`trading`, `liquidity`, `yield`, `health-factor`) with per-category isolation, global candidate/run bounds, deterministic full ERC-8004 tuple dedupe, and sanitized route/category provenance.
- Fed semantic candidates into the existing T2 composition input without changing publication, health, capability, identity, or semantic-retrieval gates.

## Changed paths

- `packages/agent-ingestion/src/adapters/8004scan.ts`
- `packages/agent-ingestion/src/semantic-discovery.ts`
- `packages/agent-ingestion/src/index.ts`
- `packages/agent-ingestion/src/__tests__/8004scan.test.ts`
- `packages/agent-ingestion/src/__tests__/semantic-discovery.test.ts`
- `scripts/erc8004-marketplace-ingestion.ts`
- `docs/release-evidence/2026-09-05-live-discovery-runner-handoff.md`

## Verification

- `node_modules/.bin/tsc --noEmit -p packages/agent-ingestion/tsconfig.json` — **PASS**.
- `node_modules/.bin/vitest run packages/agent-ingestion/src/__tests__/8004scan.test.ts packages/agent-ingestion/src/__tests__/semantic-discovery.test.ts` — **PASS**, 2 files / 11 tests.
- `node_modules/.bin/vitest run packages/agent-ingestion/src/__tests__` — **PASS**, 15 files / 90 tests.
- `git diff --check` — **PASS**.

Tests used the retained workspace dependency binaries through temporary local symlinks; those symlinks were removed before commit. No dependency was installed.

No live database run, paid action, deployment, on-chain write, or live canary was performed in this handoff. Evidence level is deterministic fixture/unit/typecheck coverage. The previously observed vendor behavior remains the reason for the fallback: `/agents` may return 500/time out while `/agents/latest` and semantic routes are independently attempted.

## Gates, limitations, and rollback

The existing vendor discovery gate remains the only command-level switch for these candidates. The semantic collector is bounded and diagnostic-only; it does not enable `MARKETPLACE_SEMANTIC_RETRIEVAL_ENABLED`, infer a category, or publish a candidate. The mapper continues to require a complete ERC-8004 identity tuple and existing downstream health/capability/publication checks.

To disable/rollback, leave the existing vendor discovery gate false or revert this commit. No database migration or persisted schema change was introduced; checkpoint/provenance fields remain owned by the existing ingestion/T2 paths.
