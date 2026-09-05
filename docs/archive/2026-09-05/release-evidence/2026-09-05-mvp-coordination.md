# MVP live marketplace coordination record — 2026-09-05

Status: implementation in progress.

## Baseline

- Coordinator checkout: `/home/ubuntu/bnbera-w0-w1`.
- Integration branch: `codex/erc8004-pipeline`.
- Assignment base: `0333528c93e78d09279ba5b1a0db8672515212d9`.
- Remote ref: `github/codex/erc8004-pipeline`; its SHA matched the assignment base before dispatch.
- The base contains implementation commit `5b7a3c5e127234bdd5b28693eb7d8bfb33197ca5` and handoff commit `948446121bf4c8546331d1109eded6847e375e2d` as ancestors.
- Pre-existing untracked path `apps/web/.next/` remains untouched.

## Documentation-read evidence

The coordinator read these files before this coordination edit:

- `AGENTS.md`
- `docs/01-marketplace-donor-merge-plan.md`
- `docs/03-no-code-agent-deployer-plan.md`
- `docs/04-bnbera-master-implementation-plan.md`
- `docs/05-subagent-delivery-plan.md`
- `docs/06-erc8004-pipeline-integration-plan.md`
- `docs/07-mvp-live-marketplace-task-plan.md`
- `docs/adr/0001-altana-studio-custody-bootstrap.md`
- `docs/adr/0003-wave1-legacy-migration-repair.md`
- `docs/release-evidence/2026-09-04-w0-w1-erc8004-handoff.md`
- `config/standards.lock.json`
- `packages/domain/src/identity.ts`
- `packages/domain/src/states.ts`
- `packages/domain/src/services.ts`
- `packages/agent-ingestion/src/types.ts`
- `packages/db/src/schema.ts`
- `packages/marketplace/src/types.ts`
- `packages/marketplace/src/source.ts`
- `packages/marketplace/src/eligibility.ts`
- `packages/marketplace/src/read-model.ts`
- `apps/web/src/lib/marketplace-contract.ts`
- `apps/web/src/lib/marketplace-server.ts`

Assigned wave/vertical: W1 completion, Marketplace Data + Web, and QA + Deployment + Submission. Core Marketplace is the applicable mandatory feature gate. Coordination documentation is R0; ingestion, persistence, API, and browser integration are R1. Preview deployment or secret/network changes are R2.

Constraints affecting the assignments: semantic configuration is not locked for release; continuous direct-event finality/reorg synchronization is incomplete; the chain-56/97 main-track decision is unresolved; the rotated release 8004scan credential and public preview topology are not yet recorded. Activation/commerce, Creator/Altana, Greenfield publication, and all writes remain disabled.

## Frozen minimum boundary

The first implementation round consumes the existing complete identity tuple, service/capability schemas, six state axes, `agent_versions` schema, and marketplace listing/read contracts. No new shared type or migration is authorized by default.

The runtime ordering is:

1. Persist candidate and discovery provenance.
2. Verify the identity through an exact-block registry read.
3. Resolve bounded public metadata and validate advertised services/capabilities.
4. Create or reuse an immutable public `agent_versions` row through an explicit marketplace publication service.
5. Attach category output to that real version identifier.
6. Apply conservative state transitions and set `current_version_id` transactionally.
7. Project through the existing database-backed marketplace source, API, and frontend.

Discovery does not publish automatically. A registry read does not imply healthy, verified, live, or published state. Unknown price, evidence, authority, capability, or endpoint state remains unknown/unavailable. Semantic retrieval is outside the first deterministic preview gate.

The first two assignments use isolated worktrees:

| Task | Worktree | Branch | Agent model |
| --- | --- | --- | --- |
| T1 | `/home/ubuntu/bnbera-mvp-t1` | `codex/mvp-db-startup` | `gpt-5.6-luna`, max reasoning |
| T3 | `/home/ubuntu/bnbera-mvp-t3` | `codex/mvp-publication` | `gpt-5.6-luna`, max reasoning |

A0 will inspect each commit, diff, tests, and handoff before integration or dispatching the next task. Exactly two implementation agents are active in this round.

## Environment observations

The existing `bnbera_erc8004_pgvector` container was observed healthy with loopback binding `127.0.0.1:55432`. PostgreSQL reported pgvector `0.8.6`. It contained four identity rows, four agent rows, and zero agent-version rows during planning. These are local state observations, not qualifying live-supply evidence.

Rollback: discard only task branches/worktrees that fail review. Do not delete the database volume or existing rows. Disable ingestion and semantic flags independently. Any schema repair must be a reviewed forward migration.
