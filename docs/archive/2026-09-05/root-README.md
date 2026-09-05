# BNBEra

BNBEra is a BNB Chain agent marketplace and thin audited-strategy Creator. The
architecture and delivery boundaries are documented in [`docs/`](./docs/).

## Foundation workspace

The repository is a Node 22 / pnpm workspace. The first implementation layer
contains four packages:

- `@bnbera/domain`: canonical identity, independent marketplace states,
  service/capability contracts, deterministic JSON, and shared events.
- `@bnbera/config`: runtime configuration validation and safe error/result
  envelopes.
- `@bnbera/auth`: BetterAuth/SIWE integration boundary. It deliberately does
  not accept or persist private keys, passkey exports, or raw session tokens.
- `@bnbera/db`: Drizzle/PostgreSQL schema, migration conventions, and a
  connection/migration runner. Secrets are represented only by references.

Install and verify the workspace with:

```text
pnpm install --frozen-lockfile
pnpm check
```

`DATABASE_URL` is required only when running database migrations or live
repository integration tests. The foundation unit tests do not connect to a
database and use no production credentials. Apply the checked-in migrations
explicitly with `DATABASE_URL=... pnpm db:migrate`; the command never logs the
connection string. `pnpm db:check` validates schema/migration consistency only
and does not connect to PostgreSQL.

Remote Wave 0/1 operations are documented in
[`docs/operations/wave0-wave1-remote.md`](./docs/operations/wave0-wave1-remote.md).
The guided credential collection and activation sequence is in
[`docs/operations/wave0-wave1-activation-guide.md`](./docs/operations/wave0-wave1-activation-guide.md).
After migrations, use `pnpm ops:ingestion-smoke` with a disposable database to
verify durable identity ingestion, and `pnpm ops:standards-check` with explicit
read-only BSC RPC endpoints to verify the configured ERC-8004 contracts.

## Security boundary

The complete ERC-8004 identity key is `(namespace, chainId,
identityRegistry, agentId)`. ERC-721 ownership and the verified `agentWallet`
are stored as separate observations. `origin_type`, `claim_status`,
`verification_status`, `runtime_status`, `authority_status`, and
`listing_status` are independent fields. A private key is not a domain or
database field.
