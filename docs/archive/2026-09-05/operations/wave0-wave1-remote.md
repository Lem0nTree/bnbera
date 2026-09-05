# Wave 0 and Wave 1 remote operations

**Status:** operational baseline
**Validated:** 2026-09-02
**Scope:** the checked-in Wave 0 foundation and Wave 1 identity, commerce,
and evidence contract surfaces on the authorized AWS development host.

For the operator-facing credential collection and live activation sequence,
see [Wave 0 and Wave 1 activation guide](./wave0-wave1-activation-guide.md).

This runbook records reproducible checks for the current repository. It does
not turn a disabled external rail into a live feature: ERC-8183, B402, Altana,
Greenfield, and IPFS remain gated until their standards-lock entries,
credentials, and canaries are approved.

## Host prerequisites

The validation host is Ubuntu ARM64 with:

- Node 22.x;
- pnpm 10.15.1 through Corepack;
- PostgreSQL 18.x;
- the PostgreSQL `vector` extension (pgvector 0.8.x);
- Git, build tools, and `jq`.

Do not place wallet keys, passkey exports, RPC API keys, or provider tokens in
the repository or shell history. Use a secret manager or an ephemeral shell
environment for any future credential-dependent canary.

## Workspace and database

From `/home/ubuntu/bnbera`:

```bash
corepack pnpm install --frozen-lockfile

export DATABASE_URL='postgresql:///bnbera?host=/var/run/postgresql'
corepack pnpm db:migrate
```

The database role must have access only to the development database. Enable
pgvector once in each database before migrations:

```bash
sudo -u postgres psql -d bnbera -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

`db:migrate` is safe to rerun. It handles a fresh database and the recognized
branch-local Wave 1 histories, including the legacy repair path. It never logs
the connection string.

## Deterministic verification

Run the complete package gate:

```bash
corepack pnpm check
```

The identity package now has a PostgreSQL adapter with transaction and
compare-and-set semantics. Exercise it against a disposable database rather
than the shared development database:

```bash
sudo -u postgres createdb --owner=ubuntu bnbera_wave1_smoke
sudo -u postgres psql -d bnbera_wave1_smoke -c 'CREATE EXTENSION IF NOT EXISTS vector;'
export DATABASE_URL='postgresql:///bnbera_wave1_smoke?host=/var/run/postgresql'
corepack pnpm db:migrate
corepack pnpm ops:ingestion-smoke
sudo -u postgres dropdb bnbera_wave1_smoke
```

The smoke covers identity upsert, registry observation, finality promotion,
canonical owner/`agentWallet` state, owner claim CAS and event, checkpoint CAS,
source/service persistence, probe persistence, and pool-reopen durability. It
uses a generated test-only agent ID and does not require a wallet or chain
write.

## Read-only BSC readiness

The standards check reads only public JSON-RPC methods. Supply endpoints
through the environment; URLs with embedded credentials or query-string
credentials are rejected and endpoint output is reduced to its origin.

```bash
export BSC_MAINNET_RPC_URL='https://bsc-dataseed.bnbchain.org'
export BSC_TESTNET_RPC_URL='https://data-seed-prebsc-1-s1.bnbchain.org:8545'
corepack pnpm ops:standards-check
```

The check fails closed if either endpoint reports the wrong chain, has no
latest block/hash, or lacks bytecode for a configured ERC-8004 identity or
reputation registry (including the EIP-1967 implementation when present). It
prints the observed chain IDs, block evidence, contract addresses, and the
remaining lock-gate statuses without printing secrets.

## Current boundary and disabled rails

What is operational on this host:

- clean Node/pnpm workspace installation;
- fresh and recognized legacy PostgreSQL migrations;
- pgvector-enabled schema;
- durable ERC-8004 ingestion, claims, observations, services, probes,
  checkpoints, and reorg records;
- read-only BSC mainnet/testnet chain and ERC-8004 contract probes;
- all Wave 0/1 unit, migration, lint, typecheck, and package checks.

What remains intentionally disabled or contract-only:

- ERC-8183 deployment and chain writes: the lock has no verified BSC address;
- hosted X402/B402 settlement: disabled until a real facilitator and paid
  canary are pinned and verified;
- Altana/Agent Studio custody: no external SDK/session credentials are
  installed on this host;
- Greenfield/IPFS publication: provider, bucket, SDK, wallet, and readback
  credentials are not pinned;
- commerce, payment, and evidence repositories: their checked-in in-memory
  implementations are deterministic contract fixtures; production adapters
  still require the approved provider/contract configuration.

Do not report a passing package test, HTTP response, or read-only RPC probe as
proof of a paid transaction, hosted agent, Greenfield object, or Altana session.
Those claims require the corresponding testnet evidence and release gates.

## Recovery and escalation

- A failed migration: inspect the exact migration error, keep the database,
  and rerun after correcting the schema/configuration. Do not reset or delete
  a shared database.
- A failed ingestion smoke: drop only the explicitly named disposable smoke
  database after collecting the failure output; never drop `bnbera` as a
  cleanup shortcut.
- A chain mismatch or missing contract bytecode: stop the check and repair the
  endpoint or standards lock. Do not bypass the guard with a fixture.
- Any request to enable a write rail, install a wallet key, or use a paid
  provider needs a separately approved secret and canary plan.
