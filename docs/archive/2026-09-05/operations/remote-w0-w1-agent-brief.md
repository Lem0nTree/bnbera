# Remote W0/W1 Agent Brief

This brief is the entry point for the Codex coordinator running in the clean AWS checkout. Repository `AGENTS.md` remains authoritative for documentation, security, checkout, and handoff rules.

## Objective

Implement the revised marketplace-first W0 and W1 without expanding the critical path into Creator, custody, payments, or evidence publication.

1. W0: establish the smallest runnable database/API/web slice for the public marketplace, including honest empty, fixture, loading, error, and degraded states.
2. W1: deliver one coherent browser-visible vertical slice covering browse, category, search/filter, comparison, agent detail, identity/claim state, and transparent activation availability.
3. Use existing ingestion/domain/database contracts. Change a shared contract only when necessary and record the decision and affected consumers.
4. Keep Altana, Creator, ERC-8183, X402/B402, Greenfield, and production deployment behind independent disabled-by-default feature gates unless the assigned slice explicitly proves that gate.

## Agent topology

The remote coordinator must use no more than three implementation subagents concurrently and must assign disjoint owned paths:

- Marketplace data/API agent: ingestion-to-read-model/API seam, query/filter contracts, representative test data, and deterministic tests.
- Web vertical agent: browser shell and W0/W1 routes/components consuming the agreed API, with no production fixture fallback.
- QA/integration agent: test harness, migration/build validation, contract review, and adversarial browser/API verification. This agent reports defects; feature owners fix them.

Every agent, including the coordinator, must use `gpt-5.6-luna` with `max` reasoning effort. Each agent must read the exact files required by `AGENTS.md` from this checkout and report its documentation-read evidence before editing. The coordinator must reject an agent handoff that lacks that evidence.

## Tool boundaries

- The project pins `@altananetwork/sdk` and `viem`, but W0/W1 must not create wallets, grant authority, sign, or broadcast transactions.
- The Altana MCP is configured for BNB testnet. Treat wallet creation and all state-changing tools as approval-gated and out of scope for W0/W1.
- Playwright MCP runs headless and isolated. Use it only against the local/preview BNBEra web application and do not persist authenticated state.
- BNB Agent Studio may be scanned and inspected, but do not run `bag init` at the monorepo root and do not deploy or fund anything.
- Do not configure or use AWS MCP until a least-privilege instance role and an approved control-plane scope are verified.

## Required coordinator evidence before implementation

Record in the first progress update:

- absolute checkout path, branch, base SHA, and `git status --short`;
- documentation-read evidence for coordinator and every spawned agent;
- the exact W0/W1 contracts and owned paths assigned to each agent;
- current feature gates and unresolved `config/standards.lock.json` entries;
- baseline install, database/migration, and `pnpm check` results.

## Completion boundary

Stop only after the W0/W1 implementation is integrated in this clean checkout, checks appropriate to the touched risk tiers pass, and browser/API evidence is recorded. Do not claim deployment, live chain behavior, payments, custody, or Greenfield publication unless separately authorized and directly verified.
