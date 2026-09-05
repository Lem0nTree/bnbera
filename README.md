# BNBEra

An ERC-8004 agent marketplace for BNB Chain. MVP delivery order: persistent enriched listings, paid ERC-8183 hiring, one no-code Altana Creator, then Greenfield profile/result storage.

Start with the [master plan](docs/MVP-MASTER-PLAN.md), [nine tasks](docs/MVP-TASKS.md), and [runbook](docs/MVP-RUNBOOK.md). Superseded plans are archived and excluded from ordinary agent reading/search. The new plans describe intended behavior; consult their baseline and gate criteria before making feature claims.

Node 22, pnpm 10.15.1, Next.js, PostgreSQL/pgvector. Reuse the existing Docker database.

```bash
pnpm install --frozen-lockfile
pnpm check
```

Load server environment through `scripts/run-with-repo-env.mjs`. See the runbook for existing startup/ingestion commands and the scheduled operations still to implement. No production fixture fallback, invented agent metrics or plaintext wallet/session credentials.
